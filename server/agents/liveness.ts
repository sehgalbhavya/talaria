// Is a posting still open? For Greenhouse, Lever and Ashby links the ATS API answers exactly.
// Anything else is loaded like a browser would and read for the usual "no longer available" signs.

import type { Job, JobStatus } from '../../shared/types.ts';
import { listJobs, now, updateJob } from '../lib/store.ts';

type Result = { live: boolean | null; reason: string };
/** What a check needs: a posting from the board, or one the scout just found. */
type Posting = Pick<Job, 'url' | 'applyUrl' | 'source' | 'sourceId'> & Partial<Pick<Job, 'title' | 'company'>>;

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const TIMEOUT = 15000;

/** Jobs you haven't applied to yet: the ones where a closed posting matters. */
const CHECKED: JobStatus[] = ['discovered', 'preparing', 'needs_input'];

const CLOSED_TEXT: RegExp[] = [
  /no longer (accepting applications|available|open|active|posted|listed)/i,
  /(job|position|posting|role|vacancy|opening|requisition) (has been|is|was) (filled|closed|removed|expired|taken down|archived)/i,
  /(job|position|posting|page|role) (not found|doesn'?t exist|does not exist|could not be found|cannot be found|is unavailable)/i,
  /this (job|position|posting|role|vacancy) (has )?(expired|closed)/i,
  /applications? (are|is|have) (now )?closed/i,
  /(we are|we're) no longer (hiring|recruiting|accepting)/i,
  /the (job|page|position) you('re| are) looking for/i,
];

async function get(url: string, accept = 'text/html,application/xhtml+xml') {
  return fetch(url, { headers: { 'User-Agent': UA, Accept: accept, 'Accept-Language': 'en-US,en;q=0.9' }, redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT) });
}

/** Greenhouse, Lever and Ashby say exactly whether a posting is still up. */
async function viaAts(url: string, job: Posting): Promise<Result | null> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const parts = u.pathname.split('/').filter(Boolean);
  const [srcSlug, srcId] = job.sourceId.split(':');
  const gone = (ats: string): Result => ({ live: false, reason: `${ats} no longer lists this job` });

  let gh: [string, string] | null = null;
  if (job.source === 'greenhouse' && srcSlug && srcId) gh = [srcSlug, srcId];
  else if (/greenhouse\.io$/.test(u.hostname) && parts[0] === 'embed' && u.searchParams.get('for') && u.searchParams.get('token')) gh = [u.searchParams.get('for')!, u.searchParams.get('token')!];
  else if (/greenhouse\.io$/.test(u.hostname) && parts[0] && (parts[2] || u.searchParams.get('gh_jid'))) gh = [parts[0], parts[2] || u.searchParams.get('gh_jid')!];
  if (gh) {
    const res = await get(`https://boards-api.greenhouse.io/v1/boards/${gh[0]}/jobs/${gh[1]}`, 'application/json');
    if (res.status === 404) return gone('Greenhouse');
    if (res.ok) return { live: true, reason: 'Open on Greenhouse' };
    return null;
  }

  let lv: [string, string] | null = null;
  if (job.source === 'lever' && srcSlug && srcId) lv = [srcSlug, srcId];
  else if (u.hostname === 'jobs.lever.co' && parts.length >= 2) lv = [parts[0], parts[1]];
  if (lv) {
    const res = await get(`https://api.lever.co/v0/postings/${lv[0]}/${lv[1]}?mode=json`, 'application/json');
    if (res.status === 404) return gone('Lever');
    if (res.ok) return { live: true, reason: 'Open on Lever' };
    return null;
  }

  let ab: [string, string] | null = null;
  if (job.source === 'ashby' && srcSlug && srcId) ab = [srcSlug, srcId];
  else if (u.hostname === 'jobs.ashbyhq.com' && parts.length >= 2) ab = [parts[0], parts[1]];
  if (ab) {
    const res = await get(`https://api.ashbyhq.com/posting-api/job-board/${ab[0]}`, 'application/json');
    if (!res.ok) return null;
    const data: any = await res.json();
    const j = (data.jobs || []).find((x: any) => x.id === ab![1]);
    return j && j.isListed !== false ? { live: true, reason: 'Open on Ashby' } : gone('Ashby');
  }
  return null;
}

/** Himalayas blocks automated page visits (403), but its public job feed lists every open posting. */
async function viaHimalayas(job: Posting): Promise<Result | null> {
  const onHimalayas = job.source === 'himalayas' || [job.url, job.applyUrl].some(u => u && /(^|\.)himalayas\.app\//.test(u.replace(/^https?:\/\//, '')));
  if (!onHimalayas || !job.title) return null;
  const res = await get(`https://himalayas.app/jobs/api/search?q=${encodeURIComponent(job.title)}&limit=20`, 'application/json');
  if (!res.ok) return null;
  const data: any = await res.json();
  const norm = (s?: string) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const ids = new Set([job.sourceId, job.url, job.applyUrl].filter(Boolean));
  const hit = (data.jobs || []).find((j: any) => ids.has(j.guid) || ids.has(j.applicationLink) || (norm(j.title) === norm(job.title) && norm(j.companyName) === norm(job.company)));
  return hit ? { live: true, reason: 'Still listed on Himalayas' } : { live: false, reason: 'Himalayas no longer lists this job' };
}

/** An id-looking piece of the posting's path (digits or a uuid), used to spot redirects away from it. */
const postingId = (path: string) => path.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d{5,}/i)?.[0];

function validThroughPast(html: string): boolean {
  for (const m of html.matchAll(/"validThrough"\s*:\s*"([^"]+)"/g)) {
    const t = Date.parse(m[1]);
    if (!isNaN(t) && t < Date.now()) return true;
  }
  return false;
}

async function viaPage(url: string): Promise<Result> {
  const res = await get(url);
  if (res.status === 404 || res.status === 410) return { live: false, reason: `The posting page is gone (${res.status})` };
  if (!res.ok) {
    const host = new URL(url).hostname.replace(/^www\./, '');
    const why = res.status === 403 || res.status === 429 ? 'blocks automated checks' : res.status >= 500 ? 'had a server error' : `answered ${res.status}`;
    return { live: null, reason: `${host} ${why} (error ${res.status}), so Talaria can't tell` };
  }
  const final = new URL(res.url || url);
  if (/login|signin|sign-in|authwall|\/auth\b|sso/i.test(final.pathname)) return { live: null, reason: `${final.hostname} wants you to sign in before showing it` };
  const id = postingId(new URL(url).pathname + new URL(url).search);
  if (id && !(final.pathname + final.search).includes(id)) return { live: false, reason: `The link now redirects to ${final.hostname}${final.pathname === '/' ? '' : final.pathname}` };
  if (final.searchParams.get('error') === 'true') return { live: false, reason: 'The link redirects to the careers page' };
  const html = await res.text();
  if (validThroughPast(html)) return { live: false, reason: 'The posting has passed its closing date' };
  const text = html
    .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');
  for (const re of CLOSED_TEXT) {
    const m = text.match(re);
    if (m) return { live: false, reason: `The page says “${m[0].trim()}”` };
  }
  return { live: true, reason: 'The posting page is up' };
}

export async function checkJob(job: Posting): Promise<Result> {
  const urls = [...new Set([job.url, job.applyUrl].filter(Boolean) as string[])];
  try {
    for (const url of urls) {
      const ats = await viaAts(url, job);
      if (ats) return ats;
    }
    const hm = await viaHimalayas(job);
    if (hm) return hm;
    return await viaPage(urls[0]);
  } catch (err: any) {
    return { live: null, reason: `Couldn't reach the posting (${err?.name === 'TimeoutError' ? 'timed out' : err?.message || 'network error'})` };
  }
}

/** Split fresh finds into open ones (or ones we couldn't check) and closed ones, a few at a time. */
export async function splitClosed<T extends Posting>(items: T[]): Promise<{ open: T[]; closed: { item: T; reason: string }[] }> {
  const results: Result[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await checkJob(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, items.length) }, worker));
  return {
    open: items.filter((_, i) => results[i].live !== false),
    closed: items.flatMap((item, i) => (results[i].live === false ? [{ item, reason: results[i].reason }] : [])),
  };
}

export interface LivenessReport {
  checked: number;
  closed: number;
  unknown: number;
  details: { id: string; company: string; title: string; live: boolean | null; reason: string }[]; // the closed and uncheckable ones
}

let running: Promise<LivenessReport> | null = null;

/** Check every job you haven't applied to (or just the ids given), a few at a time. */
export function checkLiveness(ids?: string[]) {
  if (running && !ids) return running;
  const jobs = listJobs().filter(j => (ids ? ids.includes(j.id) : CHECKED.includes(j.status)) && j.url);
  const task = (async () => {
    let closed = 0;
    let unknown = 0;
    let next = 0;
    const details: LivenessReport['details'] = [];
    const worker = async () => {
      while (next < jobs.length) {
        const job = jobs[next++];
        const r = await checkJob(job);
        if (r.live === false) closed++;
        if (r.live === null) unknown++;
        if (r.live !== true) details.push({ id: job.id, company: job.company, title: job.title, live: r.live, reason: r.reason });
        const was = job.liveCheck?.live;
        updateJob(job.id, j => void (j.liveCheck = { at: now(), ...r }), r.live === false && was !== false ? { at: now(), text: `Posting looks closed: ${r.reason}`, kind: 'agent' } : undefined);
      }
    };
    await Promise.all(Array.from({ length: Math.min(6, jobs.length) }, worker));
    return { checked: jobs.length, closed, unknown, details } as LivenessReport;
  })();
  if (!ids) running = task.finally(() => (running = null));
  return task;
}
