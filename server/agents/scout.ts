import type { Job, Preferences, Profile, ScoutState, SourceId, TargetCompany } from '../../shared/types.ts';
import { companyBoard, readPosting } from '../sources/companies.ts';
import * as S from '../sources/index.ts';
import { scoutLinkedIn } from './linkedin.ts';
import type { RawJob } from '../sources/index.ts';
import { askJson, finishRun, markRunning, startRun, type RunHandle } from '../lib/hermes.ts';
import { emit, toast } from '../lib/events.ts';
import { dedupeKey, getPreferences, getProfile, getSettings, hasSeen, insertJob, listJobs, markSeen, newId, now, setSettings } from '../lib/store.ts';
import { guessSeniority, truncate } from '../lib/text.ts';
import { clamp, preferencesBrief, profileBrief, str } from './common.ts';
import { splitClosed } from './liveness.ts';

let state: ScoutState = { running: false };
export const getScoutState = () => state;
function setState(patch: Partial<ScoutState>) {
  state = { ...state, ...patch };
  emit({ type: 'scout', scout: state });
}

// ---------- title / location matching ----------

const GENERIC = new Set(['engineer', 'analyst', 'manager', 'specialist', 'associate', 'consultant', 'officer', 'coordinator']);
const STOP = new Set(['junior', 'senior', 'sr', 'jr', 'i', 'ii', 'iii', 'iv', 'lead', 'staff', 'principal', 'entry', 'level', 'graduate', 'new', 'grad', 'intern', 'internship', 'the', 'a', 'an', 'of', 'and', 'for', 'to', 'in', 'remote', 'hybrid', 'with', 'm', 'f', 'd', 'w', 'x', 'all', 'genders']);
const SOFTWARE_HINTS = new Set(['frontend', 'backend', 'fullstack', 'software', 'web', 'mobile', 'ios', 'android', 'platform', 'infrastructure', 'product', 'application', 'applications', 'cloud', 'devops', 'ai', 'ml', 'data']);

function normWords(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/front[\s-]?end/g, 'frontend')
    .replace(/back[\s-]?end/g, 'backend')
    .replace(/full[\s-]?stack/g, 'fullstack')
    .replace(/machine learning/g, 'ml')
    .replace(/artificial intelligence/g, 'ai')
    .replace(/\bswe\b/g, 'software engineer')
    .replace(/\bsde\b/g, 'software engineer')
    .replace(/\bui\b/g, 'frontend')
    .replace(/[^a-z0-9+#.]+/g, ' ')
    .split(' ')
    .map(w => (w === 'developer' || w === 'dev' || w === 'programmer' || w === 'engineering' ? 'engineer' : w))
    .map(w => (w === 'analytics' ? 'analyst' : w))
    .filter(w => w && !STOP.has(w));
}

export function titleMatch(title: string, roles: string[], keywords: string[] = []): number {
  const tw = new Set(normWords(title));
  let best = 0;
  for (const role of roles) {
    const rw = [...new Set(normWords(role))];
    if (!rw.length) continue;
    let hit = 0;
    let specificHit = false;
    const hasSpecific = rw.some(w => !GENERIC.has(w));
    for (const w of rw) {
      const ok = tw.has(w) || (w === 'software' && [...tw].some(t => SOFTWARE_HINTS.has(t)) && tw.has('engineer'));
      if (ok) {
        hit++;
        if (!GENERIC.has(w)) specificHit = true;
      }
    }
    if (hasSpecific && !specificHit) continue;
    best = Math.max(best, hit / rw.length);
  }
  const t = title.toLowerCase();
  if (best < 0.5 && keywords.some(k => k && t.includes(k.toLowerCase()))) best = Math.max(best, 0.5);
  return best;
}

const LOC_ALIASES: Record<string, string[]> = {
  bengaluru: ['bangalore', 'bengaluru'],
  bangalore: ['bangalore', 'bengaluru'],
  gurugram: ['gurgaon', 'gurugram'],
  gurgaon: ['gurgaon', 'gurugram'],
  mumbai: ['mumbai', 'bombay'],
  'new york': ['new york', 'nyc', 'ny'],
  nyc: ['new york', 'nyc'],
  'san francisco': ['san francisco', 'sf', 'bay area'],
  'united states': ['united states', 'usa', 'us', 'u.s.', 'america'],
  usa: ['united states', 'usa', 'us'],
  us: ['united states', 'usa', 'us'],
  'united kingdom': ['united kingdom', 'uk', 'england', 'london'],
  uk: ['united kingdom', 'uk', 'england'],
  india: ['india', 'bengaluru', 'bangalore', 'hyderabad', 'pune', 'mumbai', 'delhi', 'gurgaon', 'gurugram', 'noida', 'chennai', 'kolkata', 'ahmedabad'],
  germany: ['germany', 'deutschland', 'berlin', 'munich', 'münchen', 'hamburg', 'frankfurt', 'cologne'],
  sweden: ['sweden', 'stockholm', 'gothenburg', 'göteborg', 'malmo', 'malmö', 'uppsala', 'lund'],
  stockholm: ['stockholm', 'sweden'],
  europe: ['sweden', 'stockholm', 'gothenburg', 'malmo', 'malmö', 'norway', 'oslo', 'denmark', 'copenhagen', 'finland', 'helsinki', 'germany', 'berlin', 'munich', 'hamburg', 'netherlands', 'amsterdam', 'rotterdam', 'france', 'paris', 'spain', 'madrid', 'barcelona', 'portugal', 'lisbon', 'ireland', 'dublin', 'united kingdom', 'uk', 'london', 'switzerland', 'zurich', 'austria', 'vienna', 'belgium', 'brussels', 'poland', 'warsaw', 'czech', 'prague', 'italy', 'milan', 'estonia', 'tallinn', 'lithuania', 'latvia', 'europe', 'eu', 'emea', 'nordics', 'scandinavia', 'dach', 'cet'],
  eu: ['sweden', 'stockholm', 'gothenburg', 'malmo', 'malmö', 'norway', 'oslo', 'denmark', 'copenhagen', 'finland', 'helsinki', 'germany', 'berlin', 'munich', 'hamburg', 'netherlands', 'amsterdam', 'rotterdam', 'france', 'paris', 'spain', 'madrid', 'barcelona', 'portugal', 'lisbon', 'ireland', 'dublin', 'united kingdom', 'uk', 'london', 'switzerland', 'zurich', 'austria', 'vienna', 'belgium', 'brussels', 'poland', 'warsaw', 'czech', 'prague', 'italy', 'milan', 'estonia', 'tallinn', 'lithuania', 'latvia', 'europe', 'eu', 'emea', 'nordics', 'scandinavia', 'dach', 'cet'],
};

// Places a remote posting may be restricted to. If a remote job names any of these and none
// covers the candidate, they can't legally take it.
const PLACE_WORDS = [
  'united states', 'usa', 'us', 'u.s.', 'us only', 'us-only', 'us based', 'canada', 'mexico', 'brazil', 'argentina', 'colombia', 'chile', 'peru', 'uruguay', 'costa rica',
  'united kingdom', 'uk', 'england', 'scotland', 'ireland', 'germany', 'france', 'spain', 'portugal', 'netherlands', 'belgium', 'poland', 'italy', 'sweden', 'norway',
  'denmark', 'finland', 'switzerland', 'austria', 'czech', 'romania', 'hungary', 'greece', 'ukraine', 'serbia', 'croatia', 'bulgaria', 'estonia', 'lithuania', 'latvia',
  'australia', 'new zealand', 'japan', 'singapore', 'philippines', 'south africa', 'nigeria', 'kenya', 'egypt', 'israel', 'turkey', 'uae', 'saudi', 'india',
  'pakistan', 'bangladesh', 'sri lanka', 'nepal', 'vietnam', 'indonesia', 'malaysia', 'thailand', 'china', 'hong kong', 'taiwan', 'korea',
  'europe', 'eu', 'emea', 'nordics', 'scandinavia', 'dach', 'latam', 'latin america', 'americas', 'north america', 'south america', 'apac', 'asia', 'africa', 'middle east', 'oceania', 'cet', 'est', 'pst', 'cst', 'edt', 'pdt',
];

const REGION_EXPAND: [RegExp, string[]][] = [
  [/india|pakistan|bangladesh|sri lanka|nepal/, ['asia', 'apac', 'asia pacific', 'south asia', 'ist']],
  [/singapore|philippines|vietnam|indonesia|malaysia|thailand|japan|korea|china|hong kong|taiwan/, ['asia', 'apac', 'asia pacific']],
  [/australia|new zealand/, ['apac', 'asia pacific', 'oceania']],
  [/united states|usa|\bus\b|canada/, ['north america', 'americas', 'usa', 'united states', 'us']],
  [/mexico|brazil|argentina|colombia|chile|peru/, ['latam', 'latin america', 'americas', 'south america']],
  [/united kingdom|\buk\b|england|ireland|germany|france|spain|portugal|netherlands|belgium|poland|italy|sweden|norway|denmark|finland|switzerland|austria|czech|romania|hungary|greece|europe/, ['europe', 'eu', 'emea', 'cet', 'cest']],
  [/sweden|norway|denmark|finland|iceland/, ['nordics', 'nordic', 'scandinavia']],
  [/israel|turkey|uae|saudi|egypt|south africa|nigeria|kenya/, ['emea', 'middle east', 'africa']],
];

export function candidateRegions(prefs: Preferences, profile: Profile | null): Set<string> {
  const out = new Set<string>();
  const sources = [...prefs.locations, profile?.location || ''].map(s => s.toLowerCase()).filter(s => s && s !== 'remote');
  for (const l of sources) {
    for (const [key, aliases] of Object.entries(LOC_ALIASES)) if (l.includes(key)) aliases.forEach(a => out.add(a));
    for (const part of l.split(/[,/|·]/).map(s => s.trim())) if (part.length > 1 && part !== 'remote') out.add(part);
  }
  const joined = [...out].join(' ');
  for (const [re, regions] of REGION_EXPAND) if (re.test(joined)) regions.forEach(r => out.add(r));
  return out;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordRe = (w: string) => new RegExp(`(^|[^a-z])${esc(w)}($|[^a-z])`);

export function remoteEligible(jobLoc: string, regions: Set<string>): boolean {
  if (!regions.size) return true;
  const l = jobLoc.toLowerCase();
  if (/worldwide|anywhere|global|unrestricted|any location|all locations/.test(l)) return true;
  for (const r of regions) if (wordRe(r).test(l)) return true;
  const restricted = PLACE_WORDS.some(w => wordRe(w).test(l));
  return !restricted;
}

function locationMatches(jobLoc: string, prefLocs: string[]): boolean {
  const l = ` ${jobLoc.toLowerCase()} `;
  return prefLocs.some(p => {
    const key = p.toLowerCase().split(',')[0].trim();
    const opts = LOC_ALIASES[key] || [key];
    return opts.some(o => new RegExp(`[^a-z]${o.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^a-z]`).test(l));
  });
}

interface Candidate extends RawJob {
  localScore: number;
  titleScore: number;
}

export function filterAndRank(raw: RawJob[], prefs: Preferences, profile: Profile | null, opts: { trustTitles?: boolean } = {}): Candidate[] {
  const out: Candidate[] = [];
  const keys = new Set<string>();
  const perCompany = new Map<string, number>();
  const maxAgeMs = (prefs.maxAgeDays || 30) * 86400000;
  const regions = candidateRegions(prefs, profile);
  const skills = (profile?.skills || []).filter(s => s.length > 1).slice(0, 40);
  const skillRes = skills.map(s => new RegExp(`(^|[^a-z0-9+#])${s.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9+#])`, 'i'));

  for (const j of raw) {
    if (!j.title || !j.company || !j.url) continue;
    const key = dedupeKey(j.company, j.title);
    if (keys.has(key) || hasSeen(key) || hasSeen(`${j.source}:${j.sourceId}`)) continue;

    const tScore = opts.trustTitles ? Math.max(0.7, titleMatch(j.title, prefs.roles, prefs.includeKeywords)) : titleMatch(j.title, prefs.roles, prefs.includeKeywords);
    if (prefs.roles.length && tScore < 0.5) continue;

    const sen = guessSeniority(j.title);
    if (sen && prefs.seniority.length && !prefs.seniority.includes(sen as any)) continue;

    const hay = `${j.title} ${j.company} ${j.tags.join(' ')}`.toLowerCase();
    if (prefs.excludeKeywords.some(k => k && hay.includes(k.toLowerCase()))) continue;
    if (prefs.excludeCompanies.some(c => c && j.company.toLowerCase().includes(c.toLowerCase()))) continue;

    if (prefs.remote === 'remote_only' && j.remote !== 'remote') continue;
    if (prefs.remote === 'remote_or_hybrid' && j.remote === 'onsite') continue;
    if (j.remote !== 'remote' && prefs.locations.length && !locationMatches(j.location, prefs.locations)) continue;
    if (j.remote === 'remote' && prefs.remote === 'onsite' && prefs.locations.length && !locationMatches(j.location, prefs.locations)) continue;
    if (j.remote === 'remote' && !remoteEligible(j.location, regions)) continue;

    if (j.postedAt && Date.now() - Date.parse(j.postedAt) > maxAgeMs) continue;

    const company = j.company.toLowerCase();
    const count = perCompany.get(company) || 0;
    if (count >= 6) continue;

    const desc = j.descriptionText.toLowerCase();
    const hits = skillRes.filter(re => re.test(desc)).length;
    const skillRatio = skills.length ? Math.min(1, hits / Math.min(10, skills.length)) : 0.5;
    const ageDays = j.postedAt ? (Date.now() - Date.parse(j.postedAt)) / 86400000 : prefs.maxAgeDays / 2;
    const recency = Math.max(0, 1 - ageDays / (prefs.maxAgeDays || 30));
    const localScore = Math.round(100 * (0.45 * tScore + 0.4 * skillRatio + 0.15 * recency));

    keys.add(key);
    perCompany.set(company, count + 1);
    out.push({ ...j, localScore, titleScore: tScore });
  }
  return out.sort((a, b) => b.localScore - a.localScore);
}

// ---------- LLM quick scoring ----------

const SCORE_PROMPT = (profile: string, prefs: string, jobs: string, based: string) => `You are a blunt, experienced tech recruiter screening job postings for one candidate.
Score how well each job fits the candidate on a 0–100 scale:
90+ = near-perfect, apply today · 75–89 = strong · 60–74 = reasonable stretch · 40–59 = weak · <40 = poor/ineligible.
Weigh: role alignment, seniority match (years of experience vs requirements), skills overlap, eligibility, and the candidate's stated preferences.

Eligibility rules (apply strictly):
- The candidate is based in: ${based}.
- For remote roles, the Location line says where the hire must live/work from. If it names countries/regions that don't include the candidate's, they're ineligible → score at most 30. "Remote" with no restriction, "Worldwide" or "Anywhere" is fine.
- On-site/hybrid roles in a city the candidate didn't list → at most 35 unless they listed that country.
- A role demanding far more years than the candidate has (e.g. 5+ vs 0–1) → at most 45.

CANDIDATE
${profile}

PREFERENCES
${prefs}

JOBS
${jobs}

Return ONLY a JSON array, one entry per job, same ids: [{"id": string, "score": number, "reason": string}]
"reason" is ≤ 16 words, specific (name the deciding factor), no fluff.`;

function jobCard(id: string, j: RawJob) {
  return `### id=${id}
${j.title} — ${j.company}
Location: ${j.location} (${j.remote})${j.salary ? ` · Salary: ${j.salary}` : ''}
${truncate(j.descriptionText.replace(/\s+/g, ' '), 900)}`;
}

async function scoreBatch(batch: Candidate[], profile: Profile, prefs: Preferences, h: RunHandle): Promise<Map<number, { score: number; reason: string }>> {
  const cards = batch.map((j, i) => jobCard(`j${i}`, j)).join('\n\n');
  const based = [profile.location, ...prefs.locations.filter(l => !/^remote$/i.test(l))].filter(Boolean).join('; ') || 'unknown';
  const result = await askJson<any[]>({
    prompt: SCORE_PROMPT(profileBrief(profile, { bullets: 2 }), preferencesBrief(prefs), cards, based),
    handle: h,
    timeoutSec: 240,
  });
  const map = new Map<number, { score: number; reason: string }>();
  for (const r of Array.isArray(result) ? result : []) {
    const idx = parseInt(String(r?.id).replace(/\D/g, ''), 10);
    if (!isNaN(idx) && batch[idx]) map.set(idx, { score: clamp(r.score), reason: str(r.reason, 200) });
  }
  return map;
}

// ---------- Hermes web scout ----------

const WEB_PROMPT = (profile: string, prefs: string, n: number) => `You are a job scout. Use your web_search tool (and web_extract if useful) to find up to ${n} CURRENTLY OPEN job postings that fit this candidate.

CANDIDATE
${profile}

PREFERENCES
${prefs}

Search tips: run several targeted searches combining the target role and location. Look everywhere employers post: companies' OWN careers websites (e.g. careers.<company>.com, <company>.com/careers, <company>.jobs), large employers' Workday sites (myworkdayjobs.com), SmartRecruiters, Workable, Teamtailor, Recruitee, Personio, as well as Greenhouse, Lever and Ashby. Think of the well-known and mid-size employers in the candidate's locations that hire for this role, and check their sites. Prefer the direct posting page (one job per URL) over listing or search pages, and skip aggregators (Indeed, LinkedIn, Glassdoor, StepStone). Skip anything that looks expired.

Return ONLY a JSON array: [{"title": string, "company": string, "location": string, "url": string, "remote": "remote"|"hybrid"|"onsite"|"unknown", "summary": string}]
"summary" = 2–4 sentences on responsibilities and key requirements. If web search is unavailable, return [].`;

async function hermesWebScout(profile: Profile, prefs: Preferences, h: RunHandle): Promise<RawJob[]> {
  const items = await askJson<any[]>({
    prompt: WEB_PROMPT(profileBrief(profile, { bullets: 1 }), preferencesBrief(prefs), 12),
    toolsets: ['web'],
    handle: h,
    timeoutSec: 420,
  });
  const out: RawJob[] = [];
  for (const it of Array.isArray(items) ? items : []) {
    const url = str(it?.url, 500);
    if (!/^https?:\/\//.test(url)) continue;
    if (/indeed\.com\/q-|linkedin\.com\/jobs\/search|glassdoor\.[a-z.]+\/Job\//i.test(url)) continue;
    const hydrated = (await S.hydrateFromUrl(url).catch(() => null)) || (await readPosting(url, { title: str(it.title, 200), company: str(it.company, 160), location: str(it.location, 200), source: 'hermes_web' }).catch(() => null));
    if (hydrated) {
      out.push(hydrated);
      continue;
    }
    const summary = str(it.summary, 2000);
    out.push({
      source: 'hermes_web',
      sourceId: url,
      url,
      applyUrl: url,
      title: str(it.title, 200),
      company: str(it.company, 160),
      location: str(it.location, 200) || 'Unspecified',
      remote: (['remote', 'hybrid', 'onsite'].includes(it.remote) ? it.remote : 'unknown') as RawJob['remote'],
      descriptionHtml: summary ? `<p>${summary.replace(/</g, '&lt;')}</p><p><em>Summary written by Hermes from the original posting. Open the posting for full details.</em></p>` : '',
      descriptionText: summary,
      tags: [],
    });
  }
  return out;
}

// ---------- companies' own careers sites ----------

const SITE_PROMPT = (sites: TargetCompany[], roles: string[], prefs: string) => `You are a job scout. Use your web_search tool to find CURRENTLY OPEN postings for these roles on each company's OWN careers website.

ROLES: ${roles.join(', ')}
PREFERENCES
${prefs}

COMPANIES (search each one, e.g. "site:<domain> <role>" and "<company> careers <role> <location>")
${sites.map(c => `- ${c.name}: ${c.domain || c.url}`).join('\n')}

Return ONLY a JSON array of individual posting pages (one job per URL, on the company's own site or its hiring platform), at most 4 per company:
[{"title": string, "company": string, "location": string, "url": string}]
Skip listing/search pages, aggregators and anything expired. If web search is unavailable, return [].`;

export async function companySiteSearch(sites: TargetCompany[], prefs: Preferences, h: RunHandle): Promise<RawJob[]> {
  const items = await askJson<any[]>({ prompt: SITE_PROMPT(sites, prefs.roles.length ? prefs.roles : ['designer'], preferencesBrief(prefs)), toolsets: ['web'], handle: h, timeoutSec: 420 });
  const out: RawJob[] = [];
  for (const it of (Array.isArray(items) ? items : []).slice(0, 4 * sites.length)) {
    const url = str(it?.url, 500);
    if (!/^https?:\/\//.test(url)) continue;
    const site = sites.find(c => c.name.toLowerCase() === str(it.company, 160).toLowerCase()) || sites.find(c => c.domain && url.includes(c.domain));
    const job = (await S.hydrateFromUrl(url).catch(() => null)) || (await readPosting(url, { title: str(it.title, 200), company: site?.name || str(it.company, 160), location: str(it.location, 200) }).catch(() => null));
    if (job) out.push(site ? { ...job, company: site.name } : job);
  }
  return out;
}

// ---------- orchestration ----------

function searchQueries(prefs: Preferences): string[] {
  const roles = prefs.roles.length ? prefs.roles : ['software engineer'];
  return [...new Set(roles.map(r => r.replace(/\b(junior|senior|sr\.?|jr\.?|entry[- ]level|graduate)\b/gi, '').trim().toLowerCase()))].slice(0, 4);
}

export interface ScoutOptions {
  maxNew?: number;
  minScore?: number;
}

export async function runScout(opts: ScoutOptions = {}): Promise<{ added: Job[] }> {
  if (state.running) throw new Error('A search is already running.');
  const profile = getProfile();
  if (!profile) throw new Error('Add your resume first so Hermes knows what to look for.');
  const prefs = getPreferences();
  const settings = getSettings();
  const maxNew = opts.maxNew ?? 20;
  const minScore = opts.minScore ?? 45;

  setState({ running: true, phase: 'Searching job boards', progress: 0.05, found: 0, added: 0, startedAt: now(), finishedAt: undefined });
  const h = startRun('scout', 'Scouting for new jobs');
  markRunning(h);
  const added: Job[] = [];
  try {
    const queries = searchQueries(prefs);
    const src = prefs.sources;
    const tasks: { id: SourceId | string; p: () => Promise<RawJob[]> }[] = [];
    if (src.remotive) tasks.push({ id: 'remotive', p: () => S.remotive(queries) });
    if (src.remoteok) tasks.push({ id: 'remoteok', p: () => S.remoteok() });
    if (src.himalayas) tasks.push({ id: 'himalayas', p: () => S.himalayas(queries) });
    if (src.jobicy) tasks.push({ id: 'jobicy', p: () => S.jobicy(queries) });
    if (src.themuse) tasks.push({ id: 'themuse', p: () => S.themuse(prefs) });
    if (src.arbeitnow) tasks.push({ id: 'arbeitnow', p: () => S.arbeitnow() });
    // Your companies, wherever they post. The Greenhouse/Lever/Ashby switches still apply to those three.
    const needSiteSearch: TargetCompany[] = [];
    for (const c of prefs.targetCompanies) {
      if ((c.ats === 'greenhouse' || c.ats === 'lever' || c.ats === 'ashby') && !src[c.ats]) continue;
      tasks.push({
        id: `${c.name}`,
        p: async () => {
          const r = await companyBoard(c, prefs);
          if (r.needsSearch) needSiteSearch.push(c);
          return r.jobs;
        },
      });
    }

    h.log(`Querying ${tasks.length} boards for: ${queries.join(', ')}`);
    const webPromise =
      src.hermes_web && settings.hermes.webSearch
        ? (async () => {
            const wh = startRun('hermes_web', 'Hermes web search for openings');
            try {
              wh.log('Searching the open web with DuckDuckGo via Hermes');
              const jobs = await hermesWebScout(profile, prefs, wh);
              finishRun(wh, true, `${jobs.length} postings found`);
              return jobs;
            } catch (err: any) {
              finishRun(wh, false, undefined, err.message);
              return [] as RawJob[];
            }
          })()
        : Promise.resolve([] as RawJob[]);

    let done = 0;
    const settled = await Promise.all(
      tasks.map(t =>
        t
          .p()
          .then(jobs => {
            h.log(`${t.id}: ${jobs.length} postings`);
            return jobs;
          })
          .catch(err => {
            h.log(`${t.id}: failed (${err.message})`);
            return [] as RawJob[];
          })
          .finally(() => {
            done++;
            setState({ progress: 0.05 + 0.3 * (done / tasks.length), phase: `Searching job boards (${done}/${tasks.length})` });
          }),
      ),
    );
    const boardJobs = settled.flat();

    // Companies whose own site lists nothing Talaria can read directly get a web search within that site.
    const sitePromise =
      needSiteSearch.length && settings.hermes.webSearch
        ? (async () => {
            const sh = startRun('hermes_web', `Searching ${needSiteSearch.length} company website${needSiteSearch.length === 1 ? '' : 's'}`);
            try {
              sh.log(needSiteSearch.map(c => c.name).join(', '));
              const jobs = await companySiteSearch(needSiteSearch, prefs, sh);
              finishRun(sh, true, `${jobs.length} postings found`);
              return jobs;
            } catch (err: any) {
              finishRun(sh, false, undefined, err.message);
              return [] as RawJob[];
            }
          })()
        : Promise.resolve([] as RawJob[]);
    const candidates = filterAndRank(boardJobs, prefs, profile);
    h.log(`${boardJobs.length} postings → ${candidates.length} pass your filters`);

    // Score board matches right away — web search results get scored when they land, so the
    // board starts filling without waiting on the slowest source.
    const boardShortlist = candidates.slice(0, Math.max(maxNew + 6, 18));
    let total = boardShortlist.length;
    let scored = 0;
    let webDone = !(src.hermes_web && settings.hermes.webSearch);
    const progress = () => {
      const p = 0.36 + 0.6 * (scored / Math.max(1, total));
      const phase = scored >= total && !webDone ? 'Waiting for Hermes web search' : `Hermes is scoring matches (${scored}/${total})`;
      setState({ progress: Math.min(0.97, p), phase, found: boardJobs.length, added: added.length });
    };
    progress();

    const insertScored = (batch: Candidate[], scores: Map<number, { score: number; reason: string }>) => {
      batch.forEach((c, i) => {
        const s = scores.get(i);
        const score = s?.score ?? c.localScore;
        const key = dedupeKey(c.company, c.title);
        if (score < minScore || added.length >= maxNew || hasSeen(key)) {
          markSeen(key);
          return;
        }
        const ts = now();
        const { titleScore, ...rest } = c;
        const job: Job = {
          ...rest,
          id: newId(),
          status: 'discovered',
          statusChangedAt: ts,
          order: 0,
          localScore: c.localScore,
          quick: s ? { score: s.score, reason: s.reason, at: ts } : undefined,
          questions: [],
          work: {},
          timeline: [{ at: ts, text: `Found on ${sourceLabel(c.source)}`, kind: 'agent' }],
          notes: '',
          starred: false,
          createdAt: ts,
          updatedAt: ts,
        };
        insertJob(job);
        added.push(job);
      });
    };

    let skippedClosed = 0;
    const scoreAll = async (all: Candidate[], keep = all.length) => {
      // Postings that are already closed never reach the board (and aren't worth scoring).
      const { open, closed } = await splitClosed(all);
      const list = open.slice(0, keep);
      for (const c of closed) {
        markSeen(dedupeKey(c.item.company, c.item.title));
        h.log(`Skipped ${c.item.title} @ ${c.item.company}: posting closed (${c.reason})`);
      }
      skippedClosed += closed.length;
      scored += all.length - list.length;
      progress();
      const BATCH = 6;
      const batches: Candidate[][] = [];
      for (let i = 0; i < list.length; i += BATCH) batches.push(list.slice(i, i + BATCH));
      await Promise.all(
        batches.map(async batch => {
          let scores = new Map<number, { score: number; reason: string }>();
          try {
            scores = await scoreBatch(batch, profile, prefs, h);
          } catch (err: any) {
            h.log(`Scoring batch failed: ${err.message}. Using local ranking instead.`);
          }
          insertScored(batch, scores);
          scored += batch.length;
          progress();
        }),
      );
    };

    const boardScoring = scoreAll(boardShortlist);
    const known = new Set(boardShortlist.map(c => dedupeKey(c.company, c.title)));

    // LinkedIn runs in Talaria's browser window while board matches are being scored.
    const liPromise =
      src.linkedin && settings.linkedin?.connected
        ? (async () => {
            setState({ phase: 'Reading LinkedIn (in the Talaria browser window)' });
            try {
              return await scoutLinkedIn(prefs, line => h.log(line));
            } catch (err: any) {
              h.log(`LinkedIn: failed (${err.message.split('\n')[0]})`);
              return [] as RawJob[];
            }
          })()
        : Promise.resolve([] as RawJob[]);

    const webJobs = await webPromise;
    webDone = true;
    if (webJobs.length) {
      const webCandidates = filterAndRank(webJobs, prefs, profile, { trustTitles: true }).filter(w => !known.has(dedupeKey(w.company, w.title))).slice(0, 16);
      webCandidates.forEach(c => known.add(dedupeKey(c.company, c.title)));
      h.log(`Hermes web search: ${webJobs.length} postings → ${webCandidates.length} new candidates`);
      total += webCandidates.length;
      progress();
      await scoreAll(webCandidates, 8);
    }
    const siteJobs = await sitePromise;
    if (siteJobs.length) {
      const siteCandidates = filterAndRank(siteJobs, prefs, profile, { trustTitles: true }).filter(c => !known.has(dedupeKey(c.company, c.title))).slice(0, 12);
      siteCandidates.forEach(c => known.add(dedupeKey(c.company, c.title)));
      h.log(`Company websites: ${siteJobs.length} postings → ${siteCandidates.length} new candidates`);
      total += siteCandidates.length;
      progress();
      await scoreAll(siteCandidates);
    }
    const liJobs = await liPromise;
    if (liJobs.length) {
      const liCandidates = filterAndRank(liJobs, prefs, profile).filter(c => !known.has(dedupeKey(c.company, c.title))).slice(0, 12);
      h.log(`LinkedIn: ${liJobs.length} postings → ${liCandidates.length} new candidates`);
      total += liCandidates.length;
      progress();
      await scoreAll(liCandidates);
    }
    await boardScoring;

    setSettings({ autopilot: { ...getSettings().autopilot, lastScoutAt: now() } });
    const msg = (added.length ? `${added.length} new match${added.length === 1 ? '' : 'es'} added` : 'No new matches this time') + (skippedClosed ? ` · ${skippedClosed} closed posting${skippedClosed === 1 ? '' : 's'} skipped` : '');
    finishRun(h, true, `${boardJobs.length + webJobs.length + siteJobs.length + liJobs.length} scanned · ${msg}`);
    setState({ running: false, phase: undefined, progress: 1, finishedAt: now(), lastResult: msg, added: added.length });
    toast(added.length ? 'success' : 'info', msg);
    return { added };
  } catch (err: any) {
    finishRun(h, false, undefined, err.message);
    setState({ running: false, phase: undefined, finishedAt: now(), lastResult: `Search failed: ${err.message}` });
    throw err;
  }
}

export function sourceLabel(s: SourceId) {
  return (
    {
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
      company_site: 'the company website',
      hermes_web: 'Hermes web search',
      linkedin: 'LinkedIn',
      manual: 'manual entry',
    } as Record<string, string>
  )[s] || s;
}

export function existingJobCount() {
  return listJobs().length;
}
