// Bridge to the locally installed Hermes Agent.
//
// Every agent task runs as a one-shot `hermes -z` process. We resolve Hermes's own runtime
// command once (bypassing the hermes.cmd wrapper, whose cmd.exe quoting mangles long prompts)
// and spawn it directly, so prompts travel as real argv with no shell in between.

import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { WORK_DIR } from './paths.ts';
import { getSettings, newId, now, saveRun } from './store.ts';
import { emit } from './events.ts';
import type { AgentRun, HermesStatus, RunKind } from '../../shared/types.ts';

const MAX_PROMPT_CHARS = 28000; // Windows caps a command line at 32,767 chars.

let runtime: string[] | null = null;
let runtimeError: string | null = null;

let status: HermesStatus = { installed: false, ok: false };
export const getHermesStatus = () => status;
function setStatus(next: Partial<HermesStatus>) {
  status = { ...status, ...next, checkedAt: now() };
  emit({ type: 'hermes', hermes: status });
}

function execText(cmd: string, args: string[], timeout = 60000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message).toString().trim()));
      else resolve(stdout.toString());
    });
  });
}

async function resolveRuntime(): Promise<string[]> {
  if (runtime) return runtime;
  const override = process.env.HERMES_RUNTIME_JSON;
  if (override) {
    runtime = JSON.parse(override);
    return runtime!;
  }
  try {
    const isWin = process.platform === 'win32';
    const out = isWin
      ? await execText('cmd.exe', ['/d', '/s', '/c', 'hermes --print-runtime-command'])
      : await execText('hermes', ['--print-runtime-command']);
    const line = out.trim().split(/\r?\n/).find(l => l.trim().startsWith('['));
    if (!line) throw new Error('Unexpected output from `hermes --print-runtime-command`.');
    const parsed = JSON.parse(line) as string[];
    // Force UTF-8 mode; -X flags survive Hermes's isolated (-I) interpreter mode.
    runtime = [parsed[0], '-X', 'utf8', ...parsed.slice(1)];
    runtimeError = null;
    return runtime;
  } catch (err: any) {
    runtimeError = err?.message || String(err);
    throw new Error(`Hermes isn't reachable: ${runtimeError}`);
  }
}

// ---------- dedicated Hermes profile ----------
// Talaria's agent work runs under its own Hermes profile so hundreds of one-shot sessions don't
// clutter the user's personal history, and so side tasks (auto-titles, self-review) that only
// add latency here can be switched off without touching the user's own config.

export const PROFILE = process.env.TALARIA_HERMES_PROFILE ?? 'talaria';
const hermesHome = () => process.env.HERMES_HOME || path.join(process.env.LOCALAPPDATA || path.join(process.env.HOME || '', '.local', 'share'), 'hermes');
let profileReady: Promise<string | null> | null = null;

const PROFILE_TUNING = `

# --- Added for Talaria: keep one-shot agent calls fast and quiet ---
auxiliary:
  title_generation:
    enabled: false
    model_upgrade_enabled: false
  background_review:
    enabled: false
`;

function ensureProfile(): Promise<string | null> {
  if (!PROFILE) return Promise.resolve(null);
  if (profileReady) return profileReady;
  profileReady = (async () => {
    const dir = path.join(hermesHome(), 'profiles', PROFILE);
    const cfg = path.join(dir, 'config.yaml');
    try {
      if (!fs.existsSync(cfg)) {
        const rt = await resolveRuntime();
        await execText(rt[0], [...rt.slice(1), 'profile', 'create', PROFILE, '--clone', '--no-alias', '--description', 'Talaria job-search app worker (auto-created)'], 180000);
      }
      let text = fs.readFileSync(cfg, 'utf8');
      if (!/^auxiliary:/m.test(text)) text += PROFILE_TUNING;
      // Fail fast on provider errors (e.g. rate limits); Talaria pauses and retries itself.
      text = text
        .replace(/^  # api_max_retries: \d+$/m, '  api_max_retries: 1  # Talaria: fail fast; the app backs off itself')
        .replace(/^  # auto_recovery_cycles: \d+$/m, '  auto_recovery_cycles: 0  # Talaria: same');
      if (text !== fs.readFileSync(cfg, 'utf8')) fs.writeFileSync(cfg, text);
      return PROFILE;
    } catch (err: any) {
      console.warn(`[hermes] couldn't prepare the "${PROFILE}" profile, using the default one: ${err.message}`);
      return null;
    }
  })();
  return profileReady;
}

// ---------- concurrency queue ----------
// User-initiated work (you clicked something) jumps ahead of background autopilot work.

type QueueItem = { start: () => void; priority: number; jobId?: string; cancel: () => void };
const waiting: QueueItem[] = [];
let active = 0;

function acquire(priority = 0, jobId?: string): Promise<() => void> {
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
    const item = { start, priority, jobId, cancel };
    const idx = waiting.findIndex(w => w.priority < priority);
    if (idx < 0) waiting.push(item);
    else waiting.splice(idx, 0, item);
    pump();
  });
}

// ---------- per-job pause ----------
// Pausing a job drops its queued Hermes calls and stops the running ones; nothing new starts until it resumes.
export const PAUSED = 'Paused by you';
export const isPausedError = (err: unknown) => (err as any)?.message === PAUSED;
const pausedJobs = new Set<string>();
const jobPids = new Map<number, string>();
export const isJobPaused = (jobId?: string) => Boolean(jobId && pausedJobs.has(jobId));

export function pauseJobCalls(jobId: string) {
  pausedJobs.add(jobId);
  for (let i = waiting.length - 1; i >= 0; i--) if (waiting[i].jobId === jobId) waiting.splice(i, 1)[0].cancel();
  for (const [pid, j] of jobPids) if (j === jobId) killTree(pid);
}

export function resumeJobCalls(jobId: string) {
  pausedJobs.delete(jobId);
}

// When the provider rate-limits us, the whole queue pauses until the reset time it reports,
// then resumes on its own. Afterwards we run one task at a time for a while to stay under it.
let pausedUntil = 0;
let slowUntil = 0;
let resumeTimer: NodeJS.Timeout | null = null;

function pump() {
  const t = Date.now();
  if (t < pausedUntil) {
    if (!resumeTimer) resumeTimer = setTimeout(() => ((resumeTimer = null), pump()), pausedUntil - t + 250);
    return;
  }
  if (status.rateLimitedUntil) setStatus({ rateLimitedUntil: undefined, message: status.ok ? 'Connected' : status.message });
  const configured = Math.max(1, getSettings().hermes.concurrency || 1);
  const limit = t < slowUntil ? 1 : configured;
  while (active < limit && waiting.length) waiting.shift()!.start();
}

const RATE_LIMIT = /rate.?limit|HTTP 429|too many requests|RESOURCE_EXHAUSTED/i;
// The provider is busy for a moment (Gemini's free tier says this a lot, mostly on Pro and preview models).
const TRANSIENT = /\b50[23]\b|overloaded|\bUNAVAILABLE\b|high demand|service unavailable|temporarily unavailable/i;
const TRANSIENT_BACKOFF_MS = [20_000, 60_000];
const QUICK_BACKOFF_MS = 10_000; // connection tests get one short retry so they still answer fast
const CHECK_TIMEOUT_SEC = 150;

const PROVIDER_LABEL: Record<string, string> = { copilot: 'GitHub Copilot', anthropic: 'Anthropic', gemini: 'Google Gemini', openrouter: 'OpenRouter', openai: 'OpenAI', 'openai-codex': 'ChatGPT / Codex', nous: 'Nous Portal' };
const providerName = (provider?: string) => {
  const p = provider || getSettings().hermes.provider;
  return PROVIDER_LABEL[p] || p || 'The AI provider';
};

/** How long the provider wants us to wait, from Hermes's message ("resets in ~41 min", "in 2h", "retry in 41.2s"). */
function rateLimitWaitMs(msg: string): number {
  const mins = msg.match(/resets? in ~?(\d+)\s*min/i) || msg.match(/\(in (\d+)m\)/i);
  if (mins) return (Number(mins[1]) + 1) * 60_000;
  const hrs = msg.match(/resets? in ~?(\d+)\s*h/i) || msg.match(/\(in (\d+)h\)/i);
  if (hrs) return Number(hrs[1]) * 3_600_000 + 60_000;
  const secs = msg.match(/retry in (\d+(?:\.\d+)?)\s*s/i);
  if (secs) return Math.ceil(Number(secs[1])) * 1000 + 5_000;
  return 5 * 60_000;
}

function pauseFor(ms: number, provider?: string) {
  const until = Date.now() + ms;
  if (until <= pausedUntil) return;
  pausedUntil = until;
  slowUntil = until + 2 * 3_600_000;
  const at = new Date(until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  setStatus({ rateLimitedUntil: new Date(until).toISOString(), message: `${providerName(provider)} rate limit — paused until ${at}, then continuing automatically` });
  if (resumeTimer) clearTimeout(resumeTimer);
  resumeTimer = setTimeout(() => ((resumeTimer = null), pump()), ms + 250);
}

export const rateLimitedUntil = () => (Date.now() < pausedUntil ? new Date(pausedUntil).toISOString() : null);

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

/** Try a provider/model pair without saving it, so a bad pick can't break every agent task. */
export async function tryModel(provider: string, model: string): Promise<{ ok: boolean; message?: string; latencyMs?: number }> {
  const t0 = Date.now();
  try {
    const res = await callHermes({ prompt: 'Reply with exactly the word READY and nothing else.', provider, model, timeoutSec: CHECK_TIMEOUT_SEC, priority: 2, noWait: true });
    return /READY/i.test(res.text) ? { ok: true, latencyMs: Date.now() - t0 } : { ok: false, message: `Unexpected reply: ${res.text.slice(0, 120)}` };
  } catch (err: any) {
    const msg: string = err?.message || String(err);
    if (provider === 'copilot' && /not supported|model_not_supported|unsupported model/i.test(msg)) {
      return {
        ok: false,
        message: `GitHub Copilot hasn't enabled ${model} on your account. Turn it on at github.com/settings/copilot/features (e.g. the Anthropic Claude toggle), then try again.`,
      };
    }
    if (provider === 'openai-codex' && /credential|auth|log ?in|token|401|unauthori[sz]ed/i.test(msg)) {
      return { ok: false, message: `Hermes isn't signed in to ChatGPT yet. In a terminal run: hermes auth add openai-codex --type oauth — sign in in the browser window it opens, then test again.` };
    }
    return { ok: false, message: explainCheckFailure(msg, provider, model) };
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

export function finishRun(h: RunHandle, ok: boolean, detail?: string, error?: string) {
  h.run.status = ok ? 'done' : 'error';
  h.run.endedAt = now();
  h.run.durationMs = Date.parse(h.run.endedAt) - Date.parse(h.run.startedAt);
  if (detail) h.run.detail = detail;
  if (error) h.run.error = error;
  saveRun(h.run);
}

// ---------- core call ----------

export interface HermesCall {
  prompt: string;
  toolsets?: string[]; // default: minimal (no external tools)
  model?: string;
  provider?: string;
  timeoutSec?: number;
  handle?: RunHandle;
  label?: string;
  priority?: number; // higher runs first; 1 = user is waiting on it
  onStart?: () => void;
  noWait?: boolean; // fail immediately on a rate limit instead of pausing (quick checks)
}

export interface HermesResult {
  text: string;
  durationMs: number;
  usage?: { apiCalls?: number; inputTokens?: number; outputTokens?: number; totalTokens?: number };
}

function killTree(pid?: number) {
  if (!pid) return;
  if (process.platform === 'win32') {
    execFile('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }, () => {});
  } else {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {}
  }
}

const running = new Set<number>();
process.on('exit', () => {
  for (const pid of running) killTree(pid);
});

export async function callHermes(call: HermesCall): Promise<HermesResult> {
  const settings = getSettings().hermes;
  const rt = await resolveRuntime();
  let prompt = `Today's date: ${new Date().toDateString()}.

${call.prompt}`;
  if (prompt.length > MAX_PROMPT_CHARS) {
    prompt = prompt.slice(0, MAX_PROMPT_CHARS - 200) + '\n\n[...input truncated for length...]';
  }

  const profile = await ensureProfile();
  const h = call.handle;
  const jobId = h?.run.jobId;
  const name = providerName(call.provider);
  const backoff = call.noWait ? [QUICK_BACKOFF_MS] : TRANSIENT_BACKOFF_MS;
  let limitRetries = 0;
  let busyRetries = 0;
  for (;;) {
    if (isJobPaused(jobId)) throw new Error(PAUSED);
    if (call.noWait && Date.now() < pausedUntil) throw new Error(status.message || `${name} is rate-limiting requests right now.`);
    const release = await acquire(call.priority ?? 0, jobId);
    try {
      return await runOnce(call, rt, prompt, profile, settings, release, h);
    } catch (err: any) {
      const msg: string = err?.message || String(err);
      const limited = RATE_LIMIT.test(msg);
      const busy = !limited && TRANSIENT.test(msg);
      if (isPausedError(err)) throw err;
      if (limited && !call.noWait && limitRetries++ < 3) {
        const wait = rateLimitWaitMs(msg);
        pauseFor(wait, call.provider);
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

async function runOnce(
  call: HermesCall,
  rt: string[],
  prompt: string,
  profile: string | null,
  settings: ReturnType<typeof getSettings>['hermes'],
  release: () => void,
  h: RunHandle | undefined,
): Promise<HermesResult> {
  const jobId = h?.run.jobId;
  if (isJobPaused(jobId)) {
    release();
    throw new Error(PAUSED);
  }
  if (h) {
    h.run.status = 'running';
    h.run.model = call.model || settings.model;
    saveRun(h.run);
  }
  try {
    call.onStart?.();
  } catch {}

  const usageFile = path.join(WORK_DIR, `usage-${newId()}.json`);
  const toolsets = call.toolsets && call.toolsets.length ? call.toolsets : ['todo'];
  const args = [
    ...rt.slice(1),
    ...(profile ? ['-p', profile] : []),
    '-z',
    prompt,
    '--provider',
    call.provider || settings.provider,
    '-m',
    call.model || settings.model,
    '-t',
    toolsets.join(','),
    '--usage-file',
    usageFile,
    '--ignore-rules',
  ];

  const t0 = Date.now();
  try {
    const text = await new Promise<string>((resolve, reject) => {
      const child = spawn(rt[0], args, {
        cwd: WORK_DIR,
        windowsHide: true,
        env: { ...process.env, NO_COLOR: '1', HERMES_ACCEPT_HOOKS: '1' },
      });
      if (child.pid) running.add(child.pid);
      if (child.pid && jobId) jobPids.set(child.pid, jobId);
      const out: Buffer[] = [];
      let err = '';
      child.stdout.on('data', d => out.push(d));
      child.stderr.on('data', d => (err += d.toString()));
      const timeoutMs = (call.timeoutSec || settings.timeoutSec || 240) * 1000;
      const timer = setTimeout(() => {
        killTree(child.pid);
        reject(new Error(`Hermes timed out after ${Math.round(timeoutMs / 1000)}s.`));
      }, timeoutMs);
      child.on('error', e => {
        clearTimeout(timer);
        reject(e);
      });
      child.on('close', code => {
        clearTimeout(timer);
        if (child.pid) running.delete(child.pid);
        if (child.pid) jobPids.delete(child.pid);
        const stdout = Buffer.concat(out).toString('utf8').trim();
        if (isJobPaused(jobId)) reject(new Error(PAUSED));
        else if (code === 0 && stdout) resolve(stdout);
        else reject(new Error(cleanError(err || stdout) || `Hermes exited with code ${code}.`));
      });
    });
    const usage = readUsage(usageFile);
    if (h) {
      h.run.usage = mergeUsage(h.run.usage, usage);
      saveRun(h.run);
    }
    if (!status.ok) setStatus({ ok: true, installed: true, message: 'Connected' });
    return { text, durationMs: Date.now() - t0, usage };
  } catch (err: any) {
    const usage = readUsage(usageFile);
    if (h && usage) {
      h.run.usage = mergeUsage(h.run.usage, usage);
      saveRun(h.run);
    }
    throw err;
  } finally {
    release();
    fs.rm(usageFile, { force: true }, () => {});
  }
}

function cleanError(s: string) {
  const text = s.replace(/\x1b\[[0-9;]*m/g, '').trim();
  const said = text.match(/Provider said:\s*(.+)/);
  if (said) return `${text.split('\n')[0]} (${said[1].trim()})`;
  return text.split('\n').filter(Boolean).slice(-3).join(' ').slice(0, 600);
}

function readUsage(file: string): HermesResult['usage'] | undefined {
  try {
    const u = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      apiCalls: u.total_including_auxiliary?.api_calls ?? u.api_calls ?? undefined,
      inputTokens: u.input_tokens ?? undefined,
      outputTokens: u.output_tokens ?? undefined,
      totalTokens: u.total_tokens ?? undefined,
    };
  } catch {
    return undefined;
  }
}

function mergeUsage(a: AgentRun['usage'], b: HermesResult['usage']) {
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
  throw new Error('Hermes did not return valid JSON.');
}

export async function askJson<T>(call: HermesCall, validate?: (v: any) => T): Promise<T> {
  const first = await callHermes(call);
  try {
    const parsed = extractJson(first.text);
    return validate ? validate(parsed) : (parsed as T);
  } catch (err: any) {
    call.handle?.log('Output was not valid JSON — asking Hermes to repair it.');
    const repair = await callHermes({
      ...call,
      toolsets: ['todo'],
      prompt:
        `Your previous answer could not be parsed (${err.message}). Return ONLY the corrected JSON, ` +
        `no prose, no code fences.\n\nPrevious answer:\n${first.text.slice(0, 20000)}`,
    });
    const parsed = extractJson(repair.text);
    return validate ? validate(parsed) : (parsed as T);
  }
}

// ---------- health check ----------

export async function checkHermes(deep = true): Promise<HermesStatus> {
  try {
    const rt = await resolveRuntime();
    let version: string | undefined;
    try {
      const v = await execText(rt[0], [...rt.slice(1), '--version'], 60000);
      version = v.match(/Hermes Agent v(\d+(?:\.\d+)*)/)?.[1];
    } catch {}
    setStatus({ installed: true, version, checking: deep && !status.ok });
    if (!deep) return status;
    const settings = getSettings().hermes;
    const t0 = Date.now();
    const res = await callHermes({ prompt: 'Reply with exactly the word READY and nothing else.', timeoutSec: CHECK_TIMEOUT_SEC, priority: 2, noWait: true });
    const ok = /READY/i.test(res.text);
    setStatus({
      ok,
      checking: false,
      provider: settings.provider,
      model: settings.model,
      latencyMs: Date.now() - t0,
      message: ok ? 'Connected' : `Unexpected reply: ${res.text.slice(0, 120)}`,
    });
  } catch (err: any) {
    const msg = err?.message || String(err);
    if (RATE_LIMIT.test(msg)) {
      // Hermes and the login are fine — the provider just wants us to slow down.
      if (Date.now() >= pausedUntil) pauseFor(rateLimitWaitMs(msg));
      setStatus({ ok: true, checking: false, installed: true, provider: getSettings().hermes.provider, model: getSettings().hermes.model });
      return status;
    }
    const { provider, model } = getSettings().hermes;
    setStatus({
      ok: false,
      checking: false,
      installed: !runtimeError,
      message: runtimeError ? msg : explainCheckFailure(msg, provider, model),
      provider: getSettings().hermes.provider,
      model: getSettings().hermes.model,
    });
  }
  return status;
}

/** The models a ChatGPT account (Hermes's openai-codex provider) accepts; others, gpt-4.1 to gpt-5.5, return HTTP 400 "not supported when using Codex with a ChatGPT account". */
const CODEX_MODELS = ['gpt-5.6-terra', 'gpt-5.6-sol', 'gpt-5.6-luna'];

export async function listProviderModels(): Promise<Record<string, string[]>> {
  try {
    const home = process.env.HERMES_HOME || path.join(process.env.LOCALAPPDATA || '', 'hermes');
    const raw = JSON.parse(fs.readFileSync(path.join(home, 'provider_models_cache.json'), 'utf8'));
    const out: Record<string, string[]> = {};
    for (const [k, v] of Object.entries<any>(raw)) if (Array.isArray(v?.models)) out[k] = v.models;
    out['openai-codex'] = CODEX_MODELS;
    return out;
  } catch {
    return { 'openai-codex': CODEX_MODELS };
  }
}
