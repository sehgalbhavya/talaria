// Reads replies to your applications from Gmail (IMAP with an app password, read-only use),
// asks Hermes what each one says, and updates the board: rejections turn the card red,
// interview invitations move it to Interviewing, offers to Offer.
import fs from 'node:fs';
import path from 'node:path';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import type { Job, MailItem, MailKind } from '../../shared/types.ts';
import { DATA_DIR } from '../lib/paths.ts';
import { askJson, finishRun, rateLimitedUntil, startRun, type RunHandle } from '../lib/hermes.ts';
import { toast } from '../lib/events.ts';
import { getJob, getSettings, listJobs, now, setSettings, updateJob } from '../lib/store.ts';
import { moveJob } from './pipeline.ts';
import { oneOf, str } from './common.ts';
import { noEmDash } from '../lib/latexSlots.ts';

// The app password lives in its own file, never in settings (settings are sent to the browser).
const CRED_FILE = path.join(DATA_DIR, 'gmail.json');
type Creds = { email: string; appPassword: string };

function readCreds(): Creds | null {
  try {
    const c = JSON.parse(fs.readFileSync(CRED_FILE, 'utf8'));
    return c?.email && c?.appPassword ? c : null;
  } catch {
    return null;
  }
}

function client(c: Creds) {
  return new ImapFlow({ host: 'imap.gmail.com', port: 993, secure: true, auth: { user: c.email, pass: c.appPassword }, logger: false, socketTimeout: 60_000 });
}

function friendlyError(err: any): string {
  const msg = String(err?.responseText || err?.message || err);
  if (err?.authenticationFailed || /AUTHENTICATIONFAILED|Invalid credentials|auth/i.test(msg))
    return 'Gmail turned down the sign-in. Check the address, and that you pasted an app password (not your normal password).';
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|getaddrinfo/i.test(msg)) return "Couldn't reach Gmail. Check your internet connection.";
  return msg.split('\n')[0];
}

export async function connectGmail(email: string, appPassword: string) {
  const creds = { email: email.trim(), appPassword: appPassword.replace(/\s+/g, '') };
  if (!/^\S+@\S+\.\S+$/.test(creds.email)) throw new Error('That email address looks wrong.');
  if (creds.appPassword.length < 16) throw new Error('A Google app password is 16 letters. Copy it from the Google page that created it.');
  const c = client(creds);
  try {
    await c.connect();
    await c.logout();
  } catch (err) {
    throw new Error(friendlyError(err));
  }
  fs.writeFileSync(CRED_FILE, JSON.stringify(creds), { mode: 0o600 });
  setSettings({ gmail: { ...getSettings().gmail, connected: true, email: creds.email, autoCheck: getSettings().gmail?.autoCheck ?? true } });
  return getSettings().gmail;
}

export function disconnectGmail() {
  fs.rmSync(CRED_FILE, { force: true });
  setSettings({ gmail: { connected: false, autoCheck: getSettings().gmail?.autoCheck ?? true } });
  return getSettings().gmail;
}

// ---------------------------------------------------------------

const ATS_HOSTS = /greenhouse|lever\.co|ashbyhq|linkedin|workday|smartrecruiters|teamtailor|recruitee|personio|jobgether|remotive|himalayas/i;

/** A Gmail search for mail about one application: the company's name or its own domain, since you applied. */
function queryFor(job: Job): string | null {
  const name = job.company
    .replace(/\(.*?\)/g, '')
    .replace(/["“”]/g, '')
    .replace(/\b(inc|ltd|gmbh|ab|as|llc|plc|corp|co)\.?$/i, '')
    .trim();
  if (name.length < 2) return null;
  const domain = job.companyDomain && !ATS_HOSTS.test(job.companyDomain) ? job.companyDomain.replace(/^www\./, '') : '';
  const since = new Date(Date.parse(job.appliedAt || job.statusChangedAt) - 86_400_000);
  const after = `${since.getFullYear()}/${since.getMonth() + 1}/${since.getDate()}`;
  return `after:${after} -in:sent -in:chats -category:promotions -category:social ("${name}"${domain ? ` OR from:${domain}` : ''})`;
}

export interface Found {
  id: string;
  at: string;
  from: string;
  subject: string;
  text: string;
}

async function findMail(c: ImapFlow, job: Job, seen: Set<string>): Promise<Found[]> {
  const q = queryFor(job);
  if (!q) return [];
  const uids = await c.search({ gmraw: q }, { uid: true });
  if (!uids || !uids.length) return [];
  const out: Found[] = [];
  // Newest 8 that we haven't read before.
  for (const m of await c.fetchAll(uids.slice(-12), { uid: true, envelope: true, internalDate: true, source: { maxLength: 80_000 } }, { uid: true })) {
    const id = m.emailId || `${m.uid}`;
    if (seen.has(id) || !m.source) continue;
    const parsed = await simpleParser(m.source).catch(() => null);
    const text = (parsed?.text || '').replace(/\n{3,}/g, '\n\n').trim();
    const from = m.envelope?.from?.[0];
    out.push({
      id,
      at: new Date(m.internalDate || m.envelope?.date || Date.now()).toISOString(),
      from: from ? `${from.name || ''} <${from.address || ''}>`.trim() : '',
      subject: m.envelope?.subject || parsed?.subject || '',
      text: text.slice(0, 1800),
    });
  }
  return out.sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).slice(-8);
}

const KINDS: readonly MailKind[] = ['rejection', 'interview', 'next_step', 'offer', 'received', 'other'];

const CLASSIFY_PROMPT = (job: Job, mails: Found[]) => `You are sorting emails for ONE job application: "${job.title}" at ${job.company}, applied ${String(job.appliedAt || '').slice(0, 10)}.
For each email, decide whether it is about this application and what it says.

EMAILS
${mails.map((m, i) => `[e${i + 1}] From: ${m.from} | Date: ${m.at.slice(0, 10)} | Subject: ${m.subject}\n${m.text}`).join('\n\n---\n\n')}

Return ONLY JSON: {"emails": [{"id": "e1", "about": boolean, "kind": "rejection"|"interview"|"next_step"|"offer"|"received"|"other", "summary": string}]}
- "about": true only if the email comes from this company's hiring process about this application (directly or through their applicant tracking system). False for job alerts, newsletters, marketing, recommendations, or other companies.
- "kind": rejection = they won't move forward with you; interview = an invitation to schedule or attend an interview or call; next_step = an assessment, task or questionnaire; offer = a job offer; received = confirmation the application arrived; other = anything else about it.
- "summary": one short sentence for the candidate, no em dashes.
- A rejection must be a definite statement that THIS application is over ("we will not be moving forward", "we have decided to pursue other candidates"). Conditional boilerplate in an acknowledgement is NOT a rejection, e.g. "should your application be successful we will contact you; if you are not contacted within 30 days, consider it unsuccessful". That is "received".
- The company may have several openings. If the email names a different position or requisition number than this one, "about" is false.${requisitionIds(job).length ? `\n- This job's requisition number: ${requisitionIds(job).join(', ')}.` : ''}`;

/** Requisition numbers (e.g. R0134813) in the posting's address: how a company tells its openings apart. */
function requisitionIds(job: Job): string[] {
  return [...new Set((`${job.url} ${job.applyUrl || ''} ${job.sourceId}`.match(/\bR\d{5,}\b/g) || []))];
}

const CONDITIONAL = /should your application be successful|if you (?:are|have) not (?:been )?contacted|if you do not hear|not been successful for that role/i;
const DEFINITE = /unfortunately|we regret|regret to inform|will not be (?:moving|proceeding|going)|not (?:be )?(?:moving|going|proceed\w*) forward|other candidates|decided not to|no longer (?:being )?considered/i;

/** Code-side checks on the model's verdict for one email, so a misread can't reject or mismatch an application. */
function vet(job: Job, m: Found, about: boolean, kind: MailKind): { about: boolean; kind: MailKind } {
  const ids = requisitionIds(job);
  const named = [...new Set(m.text.match(/\bR\d{5,}\b/g) || [])];
  if (ids.length && named.length && !named.some(n => ids.includes(n))) return { about: false, kind }; // another opening
  if (kind === 'rejection' && CONDITIONAL.test(m.text) && !DEFINITE.test(m.text)) return { about, kind: 'received' };
  return { about, kind };
}

const LABEL: Record<MailKind, string> = {
  rejection: 'Rejection email',
  interview: 'Interview invitation',
  next_step: 'Next step',
  offer: 'Offer',
  received: 'Application received',
  other: 'Email',
};

let checking: Promise<string> | null = null;

/** Look for new replies to every application you've sent. Returns a one-line result. */
export function checkMail(opts: { quiet?: boolean } = {}): Promise<string> {
  if (checking) return checking;
  checking = run(opts).finally(() => (checking = null));
  return checking;
}

async function run(opts: { quiet?: boolean }): Promise<string> {
  const creds = readCreds();
  if (!creds) throw new Error('Connect Gmail in Settings first.');
  const jobs = listJobs().filter(j => j.appliedAt && ['applied', 'interviewing', 'offer'].includes(j.status));
  const h = startRun('mail', `Checking Gmail for replies (${jobs.length} application${jobs.length === 1 ? '' : 's'})`);
  const c = client(creds);
  let found = 0;
  const changes: string[] = [];
  try {
    await c.connect();
    const boxes = await c.list();
    const all = boxes.find(b => b.specialUse === '\\All')?.path || 'INBOX';
    const lock = await c.getMailboxLock(all);
    const batches: { job: Job; mails: Found[] }[] = [];
    try {
      for (const job of jobs) {
        const mails = await findMail(c, job, new Set(job.mailSeen || []));
        if (mails.length) batches.push({ job, mails });
      }
    } finally {
      lock.release();
    }
    await c.logout().catch(() => {});

    for (const { job, mails } of batches) {
      if (rateLimitedUntil()) {
        h.log('Hermes is paused by a rate limit; the rest waits for the next check');
        break;
      }
      found += await processMail(job, mails, h, changes);
    }

    const result = changes.length ? changes.join(' · ') : found ? `${found} email${found === 1 ? '' : 's'} about your applications, nothing that changes their status` : 'No new replies';
    setSettings({ gmail: { ...getSettings().gmail!, lastCheckAt: now(), lastResult: result, error: undefined } });
    finishRun(h, true, result);
    if (changes.length || !opts.quiet) toast(changes.length ? 'success' : 'info', `Gmail: ${result}`);
    return result;
  } catch (err: any) {
    await c.logout().catch(() => {});
    const msg = friendlyError(err);
    setSettings({ gmail: { ...getSettings().gmail!, lastCheckAt: now(), error: msg } });
    finishRun(h, false, undefined, msg);
    throw new Error(msg);
  }
}

/** Have Hermes read one application's new emails, then update the job. Returns how many were about it. */
export async function processMail(job: Job, mails: Found[], h: RunHandle, changes: string[]) {
  h.log(`${job.company}: ${mails.length} new email${mails.length === 1 ? '' : 's'}`);
  const raw = await askJson<any>({ prompt: CLASSIFY_PROMPT(job, mails), handle: h, priority: 0, timeoutSec: 180 });
  const verdicts = Array.isArray(raw?.emails) ? raw.emails : [];
  const items: MailItem[] = [];
  mails.forEach((m, i) => {
    const v = verdicts.find((x: any) => x?.id === `e${i + 1}`);
    if (!v?.about) return;
    const vetted = vet(job, m, true, oneOf(v.kind, KINDS, 'other'));
    if (!vetted.about) return;
    const summary = vetted.kind !== v.kind && vetted.kind === 'received' ? 'Application received.' : noEmDash(str(v.summary, 300)) || m.subject;
    items.push({ id: m.id, at: m.at, from: m.from, subject: m.subject, kind: vetted.kind, summary });
  });
  applyMail(job.id, mails.map(m => m.id), items, changes);
  return items.length;
}

/** Record the emails on the job and act on the newest decisive one. */
function applyMail(id: string, seenIds: string[], items: MailItem[], changes: string[]) {
  const job = getJob(id);
  if (!job) return;
  updateJob(id, j => {
    j.mailSeen = [...new Set([...(j.mailSeen || []), ...seenIds])].slice(-200);
    j.mail = [...(j.mail || []), ...items].sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).slice(-30);
    for (const m of items) j.timeline.push({ at: m.at, text: `${LABEL[m.kind]}: ${m.summary}`, kind: 'note' });
  });

  const decisive = items.filter(m => m.kind === 'rejection' || m.kind === 'interview' || m.kind === 'next_step' || m.kind === 'offer').at(-1);
  if (!decisive) return;
  const outcome = { kind: decisive.kind, at: decisive.at, summary: decisive.summary, subject: decisive.subject, from: decisive.from };
  if (decisive.kind === 'rejection') {
    updateJob(id, j => (j.outcome = outcome), { at: now(), text: 'Marked rejected from your email', kind: 'agent' });
    changes.push(`${job.company} said no`);
  } else {
    const to = decisive.kind === 'offer' ? 'offer' : 'interviewing';
    updateJob(id, j => (j.outcome = outcome));
    if (job.status !== to && !(to === 'interviewing' && job.status === 'offer')) moveJob(id, to);
    changes.push(decisive.kind === 'offer' ? `${job.company} made you an offer 🎉` : `${job.company} wants to talk: moved to ${to === 'offer' ? 'Offer' : 'Interviewing'}`);
  }
}

// ---------------------------------------------------------------

/** While Talaria runs, check every 30 minutes (and shortly after start). */
export function startMailWatch() {
  const tick = () => {
    const g = getSettings().gmail;
    if (!g?.connected || g.autoCheck === false || !readCreds()) return;
    checkMail({ quiet: true }).catch(() => {});
  };
  setTimeout(tick, 90_000);
  setInterval(tick, 30 * 60_000);
}
