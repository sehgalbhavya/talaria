import fs from 'node:fs';
import path from 'node:path';
import { customAlphabet } from 'nanoid';
import { DATA_DIR } from './paths.ts';
import { emit } from './events.ts';
import type {
  AgentRun,
  AnswerBankItem,
  Job,
  JobStatus,
  Preferences,
  Profile,
  Report,
  Settings,
  TimelineEvent,
} from '../../shared/types.ts';

export const newId = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 12);
export const now = () => new Date().toISOString();

const DB_FILE = path.join(DATA_DIR, 'db.json');

export const DEFAULT_PREFERENCES: Preferences = {
  roles: [],
  seniority: ['entry', 'mid'],
  locations: [],
  remote: 'any',
  minSalary: null,
  currency: 'USD',
  needsSponsorship: null,
  includeKeywords: [],
  excludeKeywords: [],
  excludeCompanies: [],
  targetCompanies: [], // yours to choose: add them, or let Hermes suggest some that fit your profile
  customBoards: [], // job boards you add yourself, alongside the built-in ones
  sources: {
    remotive: true,
    remoteok: true,
    himalayas: true,
    jobicy: true,
    themuse: true,
    arbeitnow: false,
    greenhouse: true,
    lever: true,
    ashby: true,
    hermes_web: true,
    linkedin: false,
  },
  maxAgeDays: 30,
};

export const DEFAULT_SETTINGS: Settings = {
  hermes: {
    provider: 'copilot',
    model: 'gpt-4.1',
    concurrency: 2,
    timeoutSec: 240,
    webSearch: true,
  },
  autopilot: {
    enabled: false,
    scoutEveryHours: 12,
    autoAnalyzeAbove: 70,
    autoPrepareAbove: null,
    maxPreparePerRun: 3,
  },
  onboarded: false,
  apply: { autoSubmit: true, interviewFirst: true },
  linkedin: { connected: false },
  gmail: { connected: false, autoCheck: true },
  theme: 'system',
};

interface DB {
  version: number;
  profile: Profile | null;
  preferences: Preferences;
  settings: Settings;
  jobs: Record<string, Job>;
  runs: AgentRun[];
  answers: AnswerBankItem[];
  reports: Report[];
  seen: Record<string, string>; // dedupe keys of jobs we've ever seen (incl. deleted)
}

function freshDb(): DB {
  return {
    version: 1,
    profile: null,
    preferences: structuredClone(DEFAULT_PREFERENCES),
    settings: structuredClone(DEFAULT_SETTINGS),
    jobs: {},
    runs: [],
    answers: [],
    reports: [],
    seen: {},
  };
}

function load(): DB {
  try {
    const raw = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) as Partial<DB>;
    const base = freshDb();
    return {
      ...base,
      ...raw,
      preferences: { ...base.preferences, ...(raw.preferences || {}), sources: { ...base.preferences.sources, ...(raw.preferences?.sources || {}) } },
      settings: {
        ...base.settings,
        ...(raw.settings || {}),
        hermes: { ...base.settings.hermes, ...(raw.settings?.hermes || {}) },
        autopilot: { ...base.settings.autopilot, ...(raw.settings?.autopilot || {}) },
        apply: { ...base.settings.apply, ...(raw.settings?.apply || {}) },
        linkedin: { ...base.settings.linkedin, ...(raw.settings?.linkedin || {}) },
        gmail: { ...base.settings.gmail!, ...(raw.settings?.gmail || {}) },
      },
    } as DB;
  } catch (err: any) {
    if (err?.code !== 'ENOENT') {
      const backup = `${DB_FILE}.corrupt-${Date.now()}`;
      try {
        fs.copyFileSync(DB_FILE, backup);
        console.error(`[store] db.json unreadable, backed up to ${backup}`);
      } catch {}
    }
    return freshDb();
  }
}

const db: DB = load();

// Any task that was mid-flight when the server stopped can't still be running.
for (const job of Object.values(db.jobs)) {
  for (const [k, t] of Object.entries(job.work || {})) {
    if (t && (t.state === 'running' || t.state === 'queued')) {
      if (k === 'analyze' || k === 'chat') delete job.work[k];
      else job.work[k as keyof Job['work']] = { state: 'error', error: 'Interrupted — the server restarted.', at: now() };
    }
  }
}
for (const run of db.runs) {
  if (run.status === 'running' || run.status === 'queued') {
    run.status = 'error';
    run.error = 'Interrupted — the server restarted.';
  }
}

let saveTimer: NodeJS.Timeout | null = null;
function persist() {
  if (saveTimer) return;
  saveTimer = setTimeout(flush, 250);
}

export function flush() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  const tmp = `${DB_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 1));
  fs.renameSync(tmp, DB_FILE);
}

process.on('exit', () => {
  try {
    flush();
  } catch {}
});

// ---------- profile / preferences / settings ----------

export const getProfile = () => db.profile;
export function setProfile(profile: Profile | null) {
  db.profile = profile ? { ...profile, updatedAt: now() } : null;
  persist();
  emit({ type: 'profile', profile: db.profile });
  return db.profile;
}

export const getPreferences = () => db.preferences;
export function setPreferences(patch: Partial<Preferences>) {
  db.preferences = { ...db.preferences, ...patch, sources: { ...db.preferences.sources, ...(patch.sources || {}) } };
  persist();
  emit({ type: 'preferences', preferences: db.preferences });
  return db.preferences;
}

export const getSettings = () => db.settings;
export function setSettings(patch: Partial<Settings>) {
  db.settings = {
    ...db.settings,
    ...patch,
    hermes: { ...db.settings.hermes, ...(patch.hermes || {}) },
    autopilot: { ...db.settings.autopilot, ...(patch.autopilot || {}) },
    apply: { ...db.settings.apply, ...(patch.apply || {}) },
    linkedin: { ...db.settings.linkedin, ...(patch.linkedin || {}) },
    gmail: { ...db.settings.gmail!, ...(patch.gmail || {}) },
    voice: { connected: false, ...db.settings.voice, ...(patch.voice || {}) },
  };
  persist();
  emit({ type: 'settings', settings: db.settings });
  return db.settings;
}

// ---------- jobs ----------

export const listJobs = () => Object.values(db.jobs);
export const getJob = (id: string) => db.jobs[id];

export function dedupeKey(company: string, title: string) {
  const norm = (s: string) => s.toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  return `${norm(company)}|${norm(title)}`;
}

export function hasSeen(key: string) {
  return Boolean(db.seen[key]);
}

export function markSeen(key: string) {
  db.seen[key] = db.seen[key] || 'skipped';
  persist();
}

export function clearSkipped() {
  for (const [k, v] of Object.entries(db.seen)) if (v === 'skipped') delete db.seen[k];
  persist();
}

export function nextOrder(status: JobStatus) {
  const orders = listJobs().filter(j => j.status === status).map(j => j.order);
  return orders.length ? Math.min(...orders) - 1 : 0;
}

export function insertJob(job: Job) {
  db.jobs[job.id] = job;
  db.seen[dedupeKey(job.company, job.title)] = job.id;
  db.seen[`${job.source}:${job.sourceId}`] = job.id;
  persist();
  emit({ type: 'job', job });
  return job;
}

export function updateJob(id: string, mutate: (job: Job) => void, timeline?: string | TimelineEvent) {
  const job = db.jobs[id];
  if (!job) return undefined;
  mutate(job);
  if (timeline) {
    const ev = typeof timeline === 'string' ? { at: now(), text: timeline } : timeline;
    job.timeline.push(ev);
    if (job.timeline.length > 200) job.timeline.splice(0, job.timeline.length - 200);
  }
  job.updatedAt = now();
  persist();
  emit({ type: 'job', job });
  return job;
}

export function deleteJob(id: string) {
  if (!db.jobs[id]) return false;
  delete db.jobs[id];
  persist();
  emit({ type: 'job:remove', id });
  return true;
}

// ---------- runs ----------

export const listRuns = () => db.runs;

export function saveRun(run: AgentRun) {
  const idx = db.runs.findIndex(r => r.id === run.id);
  if (idx >= 0) db.runs[idx] = run;
  else db.runs.unshift(run);
  if (db.runs.length > 300) db.runs.length = 300;
  persist();
  emit({ type: 'run', run });
}

// ---------- answer bank ----------

export const listAnswers = () => db.answers;

function normQ(q: string) {
  return q.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function findAnswer(question: string): AnswerBankItem | undefined {
  const q = normQ(question);
  return db.answers.find(a => normQ(a.question) === q);
}

export function upsertAnswer(question: string, answer: string) {
  const existing = findAnswer(question);
  if (existing) {
    existing.answer = answer;
    existing.updatedAt = now();
    existing.uses += 1;
  } else {
    db.answers.unshift({ id: newId(), question, answer, updatedAt: now(), uses: 1 });
  }
  persist();
  emit({ type: 'answers', answers: db.answers });
}

export function setAnswers(answers: AnswerBankItem[]) {
  db.answers = answers;
  persist();
  emit({ type: 'answers', answers: db.answers });
}

// ---------- reports ----------

export const listReports = () => db.reports;
export function addReport(report: Report) {
  db.reports.unshift(report);
  if (db.reports.length > 30) db.reports.length = 30;
  persist();
  emit({ type: 'reports', reports: db.reports });
}

export function resetAll() {
  const fresh = freshDb();
  Object.assign(db, fresh);
  flush();
}
