// Is a posting still open? For Greenhouse, Lever and Ashby links the ATS API answers exactly.
// Anything else is loaded like a browser would and read for the usual "no longer available" signs.

import type { Job, JobStatus } from '../../shared/types.ts';
import { listJobs, now, updateJob } from '../lib/store.ts';
import { askJson } from '../lib/hermes.ts';
import { renderHtml } from '../sources/jobpage.ts';

type Result = { live: boolean | null; reason: string };
/** What a check needs: a posting from the board, or one the scout just found. */
type Posting = Pick<Job, 'url' | 'applyUrl' | 'source' | 'sourceId'> & Partial<Pick<Job, 'title' | 'company'>>;

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const TIMEOUT = 15000;

/** Jobs you haven't applied to yet: the ones where a closed posting matters. */
const CHECKED: JobStatus[] = ['discovered', 'preparing', 'needs_input'];

const CLOSED_TEXT: RegExp[] = [
  /no longer (accepting applications|available|open|active|posted|listed)/i,
  /no longer (possible|able) to apply/i,
  /(can|could) no longer (be )?appl(y|ied)/i,
  /no longer (accepting|taking|considering) (applications|applicants|candidates)/i,
  /(application|recruitment) (period|window|process) (has |is )?(ended|closed|expired|finished|over)/i,
  /(application )?deadline (has )?(passed|expired)/i,
  /(this|the) (job|position|vacancy|ad|advert(isement)?|listing|opportunity) (is|has been) (no longer (active|available|open)|closed|expired|filled|unpublished|deactivated|withdrawn)/i,
  // Swedish
  /(det går|går det) inte längre att (söka|ansöka)/i,
  /ansökningstiden (har )?(gått ut|löpt ut|är slut)/i,
  /(tjänsten|annonsen|jobbet) (är|har) (inte längre (aktiv|tillgänglig)|tillsatt|avslutad|stängd)/i,
  // German
  /(stelle|position|anzeige|ausschreibung) (ist )?(leider )?(nicht mehr (verfügbar|aktiv|ausgeschrieben)|bereits besetzt|vergeben)/i,
  /bewerbungs(frist|zeitraum) (ist )?(abgelaufen|beendet|vorbei)/i,
  /(eine )?bewerbung ist (leider )?nicht mehr möglich/i,
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

/** "Last application date: 20 October 2026" (or Swedish/German) in the page text, already passed. */
function deadlinePast(text: string): string | null {
  const re = /(last (application|apply) (date|day)|application deadline|apply by|closing date|deadline|sista ansökningsdag(en)?|ansök senast|bewerbungsschluss|bewerbungsfrist)\s*[:\-]?\s*([0-9]{1,4}[./ -][0-9a-zA-Z]{1,9}[./ -][0-9]{2,4}|[A-Z][a-z]+ [0-9]{1,2},? [0-9]{4})/i;
  const m = text.match(re);
  if (!m) return null;
  const raw = m[6].replace(/(\d+)\.(\d+)\.(\d{4})/, '$3-$2-$1');
  const t = Date.parse(raw);
  return !isNaN(t) && t < Date.now() - 86_400_000 ? m[0] : null;
}

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
  let html = await res.text();
  if (validThroughPast(html)) return { live: false, reason: 'The posting has passed its closing date' };
  let text = pageText(html);
  // Pages built by scripts show almost nothing to a plain fetch: open them in a hidden browser.
  if (text.length < 1500) {
    const rendered = await rendered1(url);
    if (rendered) {
      html = rendered;
      text = pageText(rendered);
    }
  }
  const closed = closedReason(html, text);
  return closed ? { live: false, reason: closed } : { live: true, reason: 'The posting page is up' };
}

// Hidden-browser renders are heavy: at most two at a time.
let rendering = 0;
const waiting: (() => void)[] = [];
async function rendered1(url: string): Promise<string> {
  if (rendering >= 2) await new Promise<void>(r => waiting.push(r));
  rendering++;
  try {
    return await renderHtml(url).catch(() => '');
  } finally {
    rendering--;
    waiting.shift()?.();
  }
}

function pageText(html: string) {
  return html
    .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ');
}

/** Why a page reads as closed, or null. */
function closedReason(html: string, text: string): string | null {
  if (validThroughPast(html)) return 'The posting has passed its closing date';
  for (const re of CLOSED_TEXT) {
    const m = text.match(re);
    if (m) return `The page says “${m[0].trim()}”`;
  }
  const d = deadlinePast(text);
  return d ? `The application deadline has passed (“${d.trim()}”)` : null;
}

/**
 * The careful check before you apply: the pattern check, then Hermes reads the posting page itself,
 * so unusual wording ("We have found our candidate", a greyed-out apply button) isn't missed.
 */
export async function checkBeforeApply(job: Job): Promise<Result> {
  const quick = await checkJob(job);
  if (quick.live === false) return quick;
  const url = job.applyUrl || job.url;
  if (!url) return quick;
  let text = '';
  try {
    const res = await get(url);
    text = res.ok ? pageText(await res.text()) : '';
    if (text.length < 1500) text = pageText(await rendered1(url));
  } catch {}
  if (text.length < 200) return quick;
  try {
    const r = await askJson<any>({
      prompt: `Here is the text of a job posting page (${url}). Is it still possible to apply for this job?
Answer "closed" only if the page clearly says applications are closed, the position is filled or expired, the deadline has passed, or the job no longer exists. Answer "open" if it looks like a normal live posting. Otherwise "unclear".

Return ONLY JSON: {"verdict": "open"|"closed"|"unclear", "quote": "the exact sentence from the page that shows it, or empty"}

PAGE TEXT
${text.slice(0, 9000)}`,
      priority: 2,
      timeoutSec: 120,
    });
    if (r?.verdict === 'closed') return { live: false, reason: r.quote ? `The page says “${String(r.quote).slice(0, 160)}”` : 'Hermes read the page: applications are closed' };
    if (r?.verdict === 'open') return { live: true, reason: 'Hermes read the page: it is still open' };
  } catch {}
  return quick;
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
