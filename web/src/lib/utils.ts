import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { Job, JobStatus, SourceId } from '@shared/types';

export const cn = (...v: ClassValue[]) => twMerge(clsx(v));

export function timeAgo(iso?: string, short = true) {
  if (!iso) return '';
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 45) return 'just now';
  const units: [number, string, string][] = [
    [60, 'm', 'minute'],
    [3600, 'h', 'hour'],
    [86400, 'd', 'day'],
    [604800, 'w', 'week'],
    [2629800, 'mo', 'month'],
    [31557600, 'y', 'year'],
  ];
  let unit = units[0];
  for (const u of units) if (s >= u[0]) unit = u;
  const n = Math.max(1, Math.floor(s / unit[0]));
  return short ? `${n}${unit[1]} ago` : `${n} ${unit[2]}${n === 1 ? '' : 's'} ago`;
}

export function fmtDate(iso?: string, withYear = false) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(withYear ? { year: 'numeric' } : {}) });
}

export function fmtDuration(ms?: number) {
  if (ms == null) return '';
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

export const fitScore = (j: Pick<Job, 'analysis' | 'quick'>) => j.analysis?.score ?? j.quick?.score;

export function scoreTone(score?: number): { fg: string; bg: string; label: string } {
  if (score == null) return { fg: 'var(--faint)', bg: 'var(--line-2)', label: 'Unscored' };
  if (score >= 80) return { fg: 'var(--ok)', bg: 'var(--ok-soft)', label: 'Strong fit' };
  if (score >= 65) return { fg: 'var(--accent)', bg: 'var(--accent-soft)', label: 'Good fit' };
  if (score >= 50) return { fg: 'var(--gold)', bg: 'var(--gold-soft)', label: 'Stretch' };
  return { fg: 'var(--bad)', bg: 'var(--bad-soft)', label: 'Long shot' };
}

export const STATUS_META: Record<JobStatus, { label: string; hint: string; color: string }> = {
  discovered: { label: 'Discovered', hint: 'New matches Hermes found for you', color: 'var(--st-discovered)' },
  preparing: { label: 'Hermes is on it', hint: 'Tailoring resumes and writing cover letters', color: 'var(--st-preparing)' },
  needs_input: { label: 'Needs you', hint: 'Answer questions or approve before submitting', color: 'var(--st-needs_input)' },
  applied: { label: 'Applied', hint: 'Submitted — waiting to hear back', color: 'var(--st-applied)' },
  interviewing: { label: 'Interviewing', hint: 'In conversations with the company', color: 'var(--st-interviewing)' },
  offer: { label: 'Offer', hint: 'You did it', color: 'var(--st-offer)' },
  archived: { label: 'Archived', hint: 'Dismissed, rejected or withdrawn', color: 'var(--st-archived)' },
};

export const SOURCE_LABEL: Record<SourceId, string> = {
  remotive: 'Remotive',
  remoteok: 'Remote OK',
  himalayas: 'Himalayas',
  jobicy: 'Jobicy',
  arbeitnow: 'Arbeitnow',
  themuse: 'The Muse',
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  ashby: 'Ashby',
  workday: 'Workday',
  workable: 'Workable',
  smartrecruiters: 'SmartRecruiters',
  recruitee: 'Recruitee',
  company_site: 'Company website',
  hermes_web: 'Hermes web',
  linkedin: 'LinkedIn',
  manual: 'Added by you',
};

/** Hermes asked its questions and is waiting on you before writing the first draft. */
export const awaitingInterview = (j: Job) => Boolean(j.interview && !j.interview.doneAt && !j.packet);

export function pendingQuestions(j: Job) {
  const interview = awaitingInterview(j);
  return j.questions.filter(q => !q.answer?.trim() && !q.skipped && (q.required || (interview && q.stage === 'interview'))).length;
}

export function isWorking(j: Job) {
  return Object.values(j.work).some(t => t && (t.state === 'running' || t.state === 'queued'));
}

/** Mirrors server/agents/applier.ts applyTarget: can Talaria fill and submit this form itself? */
export function canAutoApply(j: Job): boolean {
  for (const raw of [j.applyUrl, j.url]) {
    if (!raw) continue;
    try {
      const u = new URL(raw);
      const parts = u.pathname.split('/').filter(Boolean);
      if (/greenhouse\.io$/.test(u.hostname) && parts[1] === 'jobs' && parts[2]) return true;
      if ((u.hostname === 'jobs.lever.co' || u.hostname === 'jobs.ashbyhq.com') && parts.length >= 2) return true;
    } catch {}
  }
  return j.source === 'greenhouse' && j.sourceId.includes(':');
}

export function workingStep(j: Job) {
  const s = j.work.submit;
  if (s && (s.state === 'running' || s.state === 'queued')) return s.step || 'Applying';
  const c = j.work.chat;
  if (c && (c.state === 'running' || c.state === 'queued')) return c.step || 'Hermes is thinking';
  const t = j.work.tailor;
  if (t && (t.state === 'running' || t.state === 'queued')) return t.step || 'Preparing application';
  const a = j.work.analyze;
  if (a?.state === 'running') return 'Analyzing fit';
  if (a?.state === 'queued') return 'Queued for analysis';
  return null;
}

export function hashHue(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}

export function greeting(name?: string) {
  const h = new Date().getHours();
  const part = h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const first = name?.split(/\s+/)[0];
  return first ? `${part}, ${first}` : part;
}

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}
