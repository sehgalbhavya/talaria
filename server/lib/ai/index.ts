// Talaria's AI: every agent task is one request to your AI provider, made from this server.
//
// The task queue, per-job pause, rate-limit pauses and run logs live here; the provider-specific
// sign-ins and requests live in providers.ts. Prompts travel as request bodies, so there's no
// command-line length limit and no separate program to start for every task.

import { getSettings, newId, now, saveRun } from '../store.ts';
import { emit } from '../events.ts';
import type { AgentRun, AIAccounts, AIStatus, RunKind } from '../../../shared/types.ts';
import { complete, DEFAULT_MODELS, isConnected, listModels, PROVIDERS, providerLabel, type Usage } from './providers.ts';
import { aiShortName } from '../../../shared/aiProviders.ts';

/** The connected AI's name ("ChatGPT", "Claude", "Copilot"…) for what it's doing: "ChatGPT is drafting". */
export const aiName = () => aiShortName(getSettings().ai.provider);

const MAX_PROMPT_CHARS = 200_000;

let status: AIStatus = { ok: false };
export const getAIStatus = () => status;
function setStatus(next: Partial<AIStatus>) {
  status = { ...status, ...next, checkedAt: now() };
  emit({ type: 'ai', ai: status });
}

// ---------- concurrency queue ----------
// User-initiated work (you clicked something) jumps ahead of background autopilot work.

type QueueItem = { start: () => void; priority: number; jobId?: string; provider: string; cancel: () => void };
const waiting: QueueItem[] = [];
let active = 0;

function acquire(priority = 0, jobId?: string, provider = getSettings().ai.provider): Promise<() => void> {
  return new Promise((resolve, reject) => {
    const cancel = () => reject(new Error(PAUSED));
    const start = () => {
      active++;
      let released = false;
      resolve(() => {
        if (released) return;
        released = true;
        active--;
        pump();
      });
    };
    const item = { start, priority, jobId, provider, cancel };
    const idx = waiting.findIndex(w => w.priority < priority);
    if (idx < 0) waiting.push(item);
    else waiting.splice(idx, 0, item);
    pump();
  });
}

// ---------- per-job pause ----------
// Pausing a job drops its queued AI calls and stops the running ones; nothing new starts until it resumes.
export const PAUSED = 'Paused by you';
export const isPausedError = (err: unknown) => (err as any)?.message === PAUSED;
const pausedJobs = new Set<string>();
const jobCalls = new Map<AbortController, string>();
export const isJobPaused = (jobId?: string) => Boolean(jobId && pausedJobs.has(jobId));

export function pauseJobCalls(jobId: string) {
  pausedJobs.add(jobId);
  for (let i = waiting.length - 1; i >= 0; i--) if (waiting[i].jobId === jobId) waiting.splice(i, 1)[0].cancel();
  for (const [ctrl, j] of jobCalls) if (j === jobId) ctrl.abort(new Error(PAUSED));
}

export function resumeJobCalls(jobId: string) {
  pausedJobs.delete(jobId);
}

// ---------- stopping one run ----------
// Ends a task's AI calls for good, e.g. a resume read you restarted with another model.
export const STOPPED = 'Stopped';
const stoppedRuns = new Set<string>();
const runCalls = new Map<AbortController, string>();
const isStopped = (h?: RunHandle) => Boolean(h && stoppedRuns.has(h.run.id));

export function stopRun(runId: string) {
  stoppedRuns.add(runId);
  for (const [ctrl, r] of runCalls) if (r === runId) ctrl.abort(new Error(STOPPED));
}

// When the provider rate-limits us, its calls pause until the reset time it reports, then resume
// on their own. Afterwards we run one task at a time for a while to stay under it. The pause
// belongs to that provider: switching to another one ends it, and testing another one skips it.
let pausedUntil = 0;
let pausedProvider = '';
let slowUntil = 0;
let resumeTimer: NodeJS.Timeout | null = null;

const pausedFor = (provider = getSettings().ai.provider) => Date.now() < pausedUntil && provider === pausedProvider;

function endPauseIfSwitched() {
  if (!pausedUntil || pausedProvider === getSettings().ai.provider) return;
  pausedUntil = slowUntil = 0;
  if (resumeTimer) clearTimeout(resumeTimer);
  resumeTimer = null;
}

function pump() {
  endPauseIfSwitched();
  const t = Date.now();
  const paused = t < pausedUntil;
  if (paused && !resumeTimer) resumeTimer = setTimeout(() => ((resumeTimer = null), pump()), pausedUntil - t + 250);
  if (!paused && status.rateLimitedUntil) setStatus({ rateLimitedUntil: undefined, message: status.ok ? 'Connected' : status.message });
  const configured = Math.max(1, getSettings().ai.concurrency || 1);
  const limit = t < slowUntil ? 1 : configured;
  for (let i = 0; active < limit && i < waiting.length; ) {
    if (paused && waiting[i].provider === pausedProvider) i++;
    else waiting.splice(i, 1)[0].start();
  }
}

const RATE_LIMIT = /rate.?limit|HTTP 429|\b429\b|too many requests|RESOURCE_EXHAUSTED|usage limit/i;
// The provider is busy for a moment (Gemini's free tier says this a lot, mostly on Pro and preview models).
const TRANSIENT = /\b50[0234]\b|overloaded|\bUNAVAILABLE\b|high demand|service unavailable|temporarily unavailable|ECONNRESET|ETIMEDOUT|fetch failed|socket hang up/i;
const TRANSIENT_BACKOFF_MS = [20_000, 60_000];
const QUICK_BACKOFF_MS = 10_000; // connection tests get one short retry so they still answer fast
const CHECK_TIMEOUT_SEC = 90;

const providerName = (provider?: string) => providerLabel(provider || getSettings().ai.provider);

/** How long the provider wants us to wait, from its message ("resets in ~41 min", "in 2h", "retry in 41.2s", "retry-after: 30"). */
function rateLimitWaitMs(msg: string): number {
  const at = msg.match(/resets?[_ ]at[":= ]+(\d{10,13})/i);
  if (at) {
    const ms = Number(at[1]) < 1e12 ? Number(at[1]) * 1000 : Number(at[1]);
    if (ms > Date.now()) return ms - Date.now() + 60_000;
  }
  const inSecs = msg.match(/resets?_in_seconds"?\s*:\s*(\d+)/i);
  if (inSecs) return Number(inSecs[1]) * 1000 + 60_000;
  const mins = msg.match(/resets? in ~?(\d+)\s*min/i) || msg.match(/\(in (\d+)m\)/i) || msg.match(/try again in (\d+)\s*min/i);
  if (mins) return (Number(mins[1]) + 1) * 60_000;
  const hrs = msg.match(/resets? in ~?(\d+)\s*h/i) || msg.match(/\(in (\d+)h\)/i) || msg.match(/try again in (\d+)\s*h/i);
  if (hrs) return Number(hrs[1]) * 3_600_000 + 60_000;
  const secs = msg.match(/(?:retry|try again) (?:in|after) (\d+(?:\.\d+)?)\s*s/i) || msg.match(/retry-after[": ]+(\d+)/i);
  if (secs) return Math.ceil(Number(secs[1])) * 1000 + 5_000;
  return 5 * 60_000;
}

function pauseFor(ms: number, provider = getSettings().ai.provider) {
  const until = Date.now() + ms;
  if (provider === pausedProvider && until <= pausedUntil) return;
  pausedUntil = until;
  pausedProvider = provider;
  slowUntil = until + 2 * 3_600_000;
  const at = new Date(until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  setStatus({ rateLimitedUntil: new Date(until).toISOString(), message: `${providerName(provider)} rate limit — paused until ${at}, then continuing automatically` });
  if (resumeTimer) clearTimeout(resumeTimer);
  resumeTimer = setTimeout(() => ((resumeTimer = null), pump()), ms + 250);
}

export const rateLimitedUntil = () => (pausedFor() ? new Date(pausedUntil).toISOString() : null);

export const queueDepth = () => ({ active, waiting: waiting.length });

// ---------- runs ----------

export interface RunHandle {
  run: AgentRun;
  log: (text: string) => void;
}

export function startRun(kind: RunKind, title: string, jobId?: string): RunHandle {
  const run: AgentRun = {
    id: newId(),
    kind,
    title,
    jobId,
    status: 'queued',
    startedAt: now(),
    log: [],
  };
  saveRun(run);
  return {
    run,
    log(text: string) {
      run.log.push({ at: now(), text });
      if (run.log.length > 60) run.log.splice(0, run.log.length - 60);
      saveRun(run);
    },
  };
}

export function markRunning(h: RunHandle) {
  h.run.status = 'running';
  saveRun(h.run);
}

export function finishRun(h: RunHandle, ok: boolean, detail?: string, error?: string) {
  h.run.status = ok ? 'done' : 'error';
  h.run.endedAt = now();
  h.run.durationMs = Date.parse(h.run.endedAt) - Date.parse(h.run.startedAt);
  if (detail) h.run.detail = detail;
  if (error) h.run.error = error;
  saveRun(h.run);
}

// ---------- trying and connecting ----------

export interface TryResult {
  ok: boolean;
  model?: string;
  message?: string;
  latencyMs?: number;
  modelRejected?: boolean; // the account works, it just doesn't offer this model
}

const MODEL_REJECTED = /not supported|model_not_supported|unsupported model|model[^.]*(not found|does not exist|not available|not enabled)|invalid model|unknown model|no endpoints found|not a valid model/i;
const NOT_SIGNED_IN = /not signed in|sign in again|\b401\b|unauthori[sz]ed|invalid api key|incorrect api key|api key not valid|valid api key|API_KEY_INVALID|invalid x-api-key|authentication/i;

/** Try a provider/model pair without saving it, so a bad pick can't break every agent task. */
export async function tryModel(provider: string, model: string): Promise<TryResult> {
  const t0 = Date.now();
  if (!isConnected(provider)) return { ok: false, model, message: `Sign in to ${providerName(provider)} first.` };
  try {
    const res = await callAI({ prompt: 'Reply with exactly the word READY and nothing else.', provider, model, timeoutSec: CHECK_TIMEOUT_SEC, priority: 2, noWait: true });
    return /READY/i.test(res.text) ? { ok: true, model, latencyMs: Date.now() - t0 } : { ok: false, model, message: `Unexpected reply: ${res.text.slice(0, 120)}` };
  } catch (err: any) {
    const msg: string = err?.message || String(err);
    if (MODEL_REJECTED.test(msg)) {
      const message =
        provider === 'copilot'
          ? `GitHub Copilot hasn't enabled ${model} on your account. Turn it on at github.com/settings/copilot/features, then try again.`
          : provider === 'openai-codex'
            ? `Your ChatGPT plan doesn't include ${model}. Pick another model.`
            : `${providerName(provider)} doesn't offer ${model} on your account. Pick another model.`;
      return { ok: false, model, message, modelRejected: true };
    }
    if (NOT_SIGNED_IN.test(msg)) return { ok: false, model, message: `${providerName(provider)} didn't accept the sign-in. Sign in again (or check the key), then try again. (${msg.slice(0, 200)})` };
    return { ok: false, model, message: explainCheckFailure(msg, provider, model) };
  }
}

/** Turn a timeout or "overloaded" error from a connection test into something the user can act on. */
function explainCheckFailure(msg: string, provider: string, model: string): string {
  const slow = /timed out/i.test(msg);
  if (!slow && !TRANSIENT.test(msg)) return msg;
  const what = slow ? `didn't answer within ${CHECK_TIMEOUT_SEC}s` : 'is overloaded right now';
  const detail = slow ? '' : ` (${msg.slice(0, 200)})`;
  if (provider === 'gemini' && !/flash/i.test(model)) {
    return `Google Gemini ${what} with ${model}. Its free tier is often busy, especially on Pro and preview models. Try a Flash model such as gemini-flash-latest, then test again.${detail}`;
  }
  return `${providerName(provider)} ${what} with ${model}. Test again in a minute, or pick a smaller, faster model.${detail}`;
}

/**
 * Connect a provider without asking the person for a model name. Given a model, only that one is
 * tried; otherwise Talaria's pick for the provider goes first, then the next couple it offers, so
 * an account that lacks one model still connects. A sign-in or network error stops the search,
 * since no other model would fare better.
 */
export async function connectProvider(provider: string, model?: string): Promise<TryResult> {
  if (model) return tryModel(provider, model);
  const offered = await listModels(provider).catch(() => [] as string[]);
  const candidates = [...new Set([DEFAULT_MODELS[provider], ...offered].filter(Boolean))].slice(0, 3);
  if (!candidates.length) return { ok: false, message: `Talaria doesn't know which models ${providerName(provider)} offers. Type a model name.` };
  let last: TryResult = { ok: false };
  for (const m of candidates) {
    last = await tryModel(provider, m);
    if (last.ok || !last.modelRejected) return last;
  }
  return last;
}

// ---------- core call ----------

export interface AICall {
  prompt: string;
  web?: boolean; // let the AI search the web and read pages
  model?: string;
  provider?: string;
  timeoutSec?: number;
  handle?: RunHandle;
  label?: string;
  priority?: number; // higher runs first; 1 = user is waiting on it
  onStart?: () => void;
  noWait?: boolean; // fail immediately on a rate limit instead of pausing (quick checks)
}

export interface AIResult {
  text: string;
  durationMs: number;
  usage?: Usage;
}

export async function callAI(call: AICall): Promise<AIResult> {
  const settings = getSettings().ai;
  let prompt = `Today's date: ${new Date().toDateString()}.

${call.prompt}`;
  if (prompt.length > MAX_PROMPT_CHARS) prompt = prompt.slice(0, MAX_PROMPT_CHARS - 200) + '\n\n[...input truncated for length...]';

  const h = call.handle;
  const jobId = h?.run.jobId;
  const provider = call.provider || settings.provider;
  const name = providerName(provider);
  const backoff = call.noWait ? [QUICK_BACKOFF_MS] : TRANSIENT_BACKOFF_MS;
  let limitRetries = 0;
  let busyRetries = 0;
  for (;;) {
    if (isJobPaused(jobId)) throw new Error(PAUSED);
    if (isStopped(h)) throw new Error(STOPPED);
    if (call.noWait && pausedFor(provider)) throw new Error(status.message || `${name} is rate-limiting requests right now.`);
    const release = await acquire(call.priority ?? 0, jobId, provider);
    try {
      return await runOnce(call, provider, prompt, release, h);
    } catch (err: any) {
      const msg: string = err?.message || String(err);
      const limited = RATE_LIMIT.test(msg);
      const busy = !limited && TRANSIENT.test(msg);
      if (isPausedError(err) || isStopped(h)) throw err;
      if (limited && !call.noWait && limitRetries++ < 3) {
        const wait = rateLimitWaitMs(msg);
        pauseFor(wait, provider);
        const at = new Date(Date.now() + wait).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        h?.log(`${name} rate limit — paused until ${at}, then continuing automatically`);
      } else if (busy && busyRetries < backoff.length) {
        // A busy provider usually clears within a minute, so wait briefly rather than fail the task.
        const wait = backoff[busyRetries++];
        h?.log(`${name} is overloaded right now — trying again in ${wait / 1000}s`);
      } else throw err;
      if (h) {
        h.run.status = 'queued';
        saveRun(h.run);
      }
      if (busy) await waitUnlessPaused(backoff[busyRetries - 1], jobId);
    }
  }
}

async function waitUnlessPaused(ms: number, jobId?: string) {
  const end = Date.now() + ms;
  while (Date.now() < end && !isJobPaused(jobId)) await new Promise(r => setTimeout(r, Math.min(1000, end - Date.now())));
}

async function runOnce(call: AICall, provider: string, prompt: string, release: () => void, h: RunHandle | undefined): Promise<AIResult> {
  const settings = getSettings().ai;
  const jobId = h?.run.jobId;
  if (isJobPaused(jobId) || isStopped(h)) {
    release();
    throw new Error(isStopped(h) ? STOPPED : PAUSED);
  }
  const model = call.model || settings.model;
  if (h) {
    h.run.status = 'running';
    h.run.model = model;
    saveRun(h.run);
  }
  try {
    call.onStart?.();
  } catch {}

  const ctrl = new AbortController();
  if (jobId) jobCalls.set(ctrl, jobId);
  if (h) runCalls.set(ctrl, h.run.id);
  const timeoutMs = (call.timeoutSec || settings.timeoutSec || 240) * 1000;
  const timer = setTimeout(() => ctrl.abort(new Error(`${aiName()} timed out after ${Math.round(timeoutMs / 1000)}s.`)), timeoutMs);
  const t0 = Date.now();
  let usage: Usage | undefined;
  try {
    const res = await complete({
      provider,
      model,
      prompt,
      web: Boolean(call.web) && settings.webSearch !== false,
      signal: ctrl.signal,
      log: h ? (t: string) => h.log(t) : undefined,
      onUsage: u => (usage = u),
    });
    if (!res.text.trim()) throw new Error(`${providerName(provider)} returned an empty answer.`);
    if (!status.ok && provider === settings.provider) setStatus({ ok: true, message: 'Connected', provider, model: settings.model });
    return { text: res.text.trim(), durationMs: Date.now() - t0, usage };
  } catch (err: any) {
    if (ctrl.signal.aborted) {
      const reason = ctrl.signal.reason;
      if (isJobPaused(jobId)) throw new Error(PAUSED);
      if (isStopped(h)) throw new Error(STOPPED);
      throw reason instanceof Error ? reason : new Error(String(reason || 'Cancelled'));
    }
    throw err;
  } finally {
    clearTimeout(timer);
    jobCalls.delete(ctrl);
    runCalls.delete(ctrl);
    if (h && usage) {
      h.run.usage = mergeUsage(h.run.usage, usage);
      saveRun(h.run);
    }
    release();
  }
}

function mergeUsage(a: AgentRun['usage'], b: Usage | undefined) {
  if (!b) return a;
  if (!a) return b;
  const add = (x?: number, y?: number) => (x ?? 0) + (y ?? 0) || undefined;
  return {
    apiCalls: add(a.apiCalls, b.apiCalls),
    inputTokens: add(a.inputTokens, b.inputTokens),
    outputTokens: add(a.outputTokens, b.outputTokens),
    totalTokens: add(a.totalTokens, b.totalTokens),
  };
}

// ---------- JSON helpers ----------

export function extractJson<T = unknown>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [fenced?.[1], text];
  for (const c of candidates) {
    if (!c) continue;
    const s = c.trim();
    const start = s.search(/[\[{]/);
    if (start < 0) continue;
    const open = s[start];
    const close = open === '{' ? '}' : ']';
    const end = s.lastIndexOf(close);
    if (end <= start) continue;
    const slice = s.slice(start, end + 1);
    try {
      return JSON.parse(slice) as T;
    } catch {
      try {
        // Tolerate trailing commas and smart quotes, the two most common model slips.
        return JSON.parse(slice.replace(/,\s*([}\]])/g, '$1').replace(/[“”]/g, '"')) as T;
      } catch {}
    }
  }
  throw new Error(`${aiName()} did not return valid JSON.`);
}

export async function askJson<T>(call: AICall, validate?: (v: any) => T): Promise<T> {
  const first = await callAI(call);
  try {
    const parsed = extractJson(first.text);
    return validate ? validate(parsed) : (parsed as T);
  } catch (err: any) {
    call.handle?.log(`Output was not valid JSON — asking ${aiName()} to repair it.`);
    const repair = await callAI({
      ...call,
      web: false,
      prompt:
        `Your previous answer could not be parsed (${err.message}). Return ONLY the corrected JSON, ` +
        `no prose, no code fences.\n\nPrevious answer:\n${first.text.slice(0, 20000)}`,
    });
    const parsed = extractJson(repair.text);
    return validate ? validate(parsed) : (parsed as T);
  }
}

// ---------- health check ----------

export async function checkAI(deep = true): Promise<AIStatus> {
  const { provider, model } = getSettings().ai;
  if (!isConnected(provider)) {
    setStatus({ ok: false, checking: false, provider, model, message: `Not signed in to ${providerName(provider)} yet.` });
    return status;
  }
  setStatus({ checking: deep && !status.ok, provider, model });
  if (!deep) return status;
  try {
    const t0 = Date.now();
    const res = await callAI({ prompt: 'Reply with exactly the word READY and nothing else.', timeoutSec: CHECK_TIMEOUT_SEC, priority: 2, noWait: true });
    const ok = /READY/i.test(res.text);
    setStatus({ ok, checking: false, provider, model, latencyMs: Date.now() - t0, message: ok ? 'Connected' : `Unexpected reply: ${res.text.slice(0, 120)}` });
  } catch (err: any) {
    const msg = err?.message || String(err);
    if (RATE_LIMIT.test(msg)) {
      // The sign-in is fine — the provider just wants us to slow down.
      if (!pausedFor()) pauseFor(rateLimitWaitMs(msg));
      setStatus({ ok: true, checking: false, provider, model });
      return status;
    }
    setStatus({ ok: false, checking: false, provider, model, message: NOT_SIGNED_IN.test(msg) ? `${providerName(provider)} didn't accept the sign-in. Sign in again in Settings.` : explainCheckFailure(msg, provider, model) });
  }
  return status;
}

/** Which accounts are signed in (names only, never the credentials) and what each offers. */
export async function listAccounts(): Promise<AIAccounts> {
  const signedIn = PROVIDERS.filter(p => isConnected(p.id)).map(p => p.id);
  const models: Record<string, string[]> = {};
  await Promise.all(
    signedIn.map(async p => {
      models[p] = await listModels(p).catch(() => (DEFAULT_MODELS[p] ? [DEFAULT_MODELS[p]] : []));
    }),
  );
  return { signedIn, models, defaults: DEFAULT_MODELS };
}

export async function listProviderModels(): Promise<Record<string, string[]>> {
  return (await listAccounts()).models;
}
