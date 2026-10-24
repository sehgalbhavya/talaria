// Job-board adapters. Every source here is a public, key-free JSON feed. Each adapter returns
// RawJobs; the scout does filtering, de-duplication and ranking.

import type { Preferences, RemoteMode, SourceId, TargetCompany } from '../../shared/types.ts';
import { cleanHtml, domainFromUrl, formatSalary, guessRemote, htmlToText } from '../lib/text.ts';

export interface RawJob {
  source: SourceId;
  sourceId: string;
  url: string;
  applyUrl?: string;
  title: string;
  company: string;
  companyLogo?: string;
  companyDomain?: string;
  location: string;
  remote: RemoteMode;
  employmentType?: string;
  track?: 'job' | 'phd';
  deadline?: string;
  seniority?: string;
  salary?: string;
  postedAt?: string;
  descriptionHtml: string;
  descriptionText: string;
  tags: string[];
}

const UA = 'Mozilla/5.0 (Talaria job assistant; personal use)';

async function getJson<T = any>(url: string, timeoutMs = 20000): Promise<T> {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} from ${new URL(url).hostname}`);
  return (await res.json()) as T;
}

function finalize(j: Omit<RawJob, 'descriptionHtml' | 'descriptionText'> & { html?: string; text?: string }): RawJob {
  const descriptionHtml = j.html ? cleanHtml(j.html) : '';
  const descriptionText = j.text?.trim() || htmlToText(descriptionHtml);
  const { html, text, ...rest } = j;
  return {
    ...rest,
    title: rest.title.trim(),
    company: rest.company.trim(),
    companyDomain: rest.companyDomain || domainFromUrl(rest.applyUrl) || undefined,
    descriptionHtml,
    descriptionText,
  };
}

const iso = (v: any) => {
  if (v == null || v === '') return undefined;
  const d = typeof v === 'number' ? new Date(v < 1e12 ? v * 1000 : v) : new Date(v);
  return isNaN(+d) ? undefined : d.toISOString();
};

// ---------- aggregators ----------

export async function remotive(queries: string[]): Promise<RawJob[]> {
  const out: RawJob[] = [];
  for (const q of queries.slice(0, 4)) {
    const data = await getJson<any>(`https://remotive.com/api/remote-jobs?search=${encodeURIComponent(q)}&limit=60`);
    for (const j of data.jobs || []) {
      out.push(
        finalize({
          source: 'remotive',
          sourceId: String(j.id),
          url: j.url,
          applyUrl: j.url,
          title: j.title,
          company: j.company_name,
          companyLogo: j.company_logo || j.company_logo_url,
          location: j.candidate_required_location || 'Remote',
          remote: 'remote',
          employmentType: j.job_type?.replace(/_/g, ' '),
          salary: j.salary || undefined,
          postedAt: iso(j.publication_date),
          html: j.description,
          tags: (j.tags || []).slice(0, 12),
        }),
      );
    }
  }
  return out;
}

export async function remoteok(): Promise<RawJob[]> {
  const data = await getJson<any[]>('https://remoteok.com/api');
  return data
    .filter(j => j && j.id && j.position)
    .map(j =>
      finalize({
        source: 'remoteok',
        sourceId: String(j.id),
        url: j.url,
        applyUrl: j.apply_url || j.url,
        title: j.position,
        company: j.company,
        companyLogo: j.company_logo || j.logo || undefined,
        location: j.location || 'Remote',
        remote: 'remote',
        salary: formatSalary(j.salary_min, j.salary_max, 'USD'),
        postedAt: iso(j.date || j.epoch),
        html: j.description,
        tags: (j.tags || []).slice(0, 12),
      }),
    );
}

export async function himalayas(queries: string[]): Promise<RawJob[]> {
  const out: RawJob[] = [];
  for (const q of queries.slice(0, 4)) {
    const data = await getJson<any>(`https://himalayas.app/jobs/api/search?q=${encodeURIComponent(q)}&limit=40`);
    for (const j of data.jobs || []) {
      out.push(
        finalize({
          source: 'himalayas',
          sourceId: j.guid || j.applicationLink,
          url: j.applicationLink || j.guid,
          applyUrl: j.applicationLink || j.guid,
          title: j.title,
          company: j.companyName,
          companyLogo: j.companyLogo,
          location: (j.locationRestrictions || []).join(', ') || 'Remote (worldwide)',
          remote: 'remote',
          employmentType: j.employmentType,
          seniority: (j.seniority || [])[0],
          salary: formatSalary(j.minSalary, j.maxSalary, j.currency || 'USD', j.salaryPeriod),
          postedAt: iso(j.pubDate),
          html: j.description,
          tags: (j.categories || []).slice(0, 10).map((c: string) => c.replace(/-/g, ' ')),
        }),
      );
    }
  }
  return out;
}

export async function jobicy(queries: string[]): Promise<RawJob[]> {
  const out: RawJob[] = [];
  const tags = queries.slice(0, 3);
  for (const tag of tags.length ? tags : ['']) {
    const data = await getJson<any>(`https://jobicy.com/api/v2/remote-jobs?count=50${tag ? `&tag=${encodeURIComponent(tag)}` : ''}`);
    for (const j of data.jobs || []) {
      out.push(
        finalize({
          source: 'jobicy',
          sourceId: String(j.id),
          url: j.url,
          applyUrl: j.url,
          title: j.jobTitle,
          company: j.companyName,
          companyLogo: j.companyLogo,
          location: j.jobGeo || 'Remote',
          remote: 'remote',
          employmentType: (j.jobType || []).join(', '),
          seniority: j.jobLevel,
          salary: formatSalary(j.annualSalaryMin, j.annualSalaryMax, j.salaryCurrency || 'USD'),
          postedAt: iso(j.pubDate),
          html: j.jobDescription,
          tags: (j.jobIndustry || []).slice(0, 6),
        }),
      );
    }
  }
  return out;
}

const MUSE_CATEGORIES: [RegExp, string][] = [
  [/data scien|machine learning|\bml\b|\bai\b/i, 'Data Science'],
  [/data (analyst|engineer)|analytics|\bbi\b/i, 'Data and Analytics'],
  [/design|ux|ui\b/i, 'Design and UX'],
  [/product manag/i, 'Product Management'],
  [/project manag|program manag/i, 'Project Management'],
  [/devops|sre|site reliab|it support|sysadmin|network/i, 'IT'],
  [/market/i, 'Marketing'],
  [/sales|account exec|business develop/i, 'Sales'],
  [/engineer|developer|software|frontend|backend|full.?stack|programmer/i, 'Software Engineering'],
];

const MUSE_LEVELS: Record<string, string> = { intern: 'Internship', entry: 'Entry Level', mid: 'Mid Level', senior: 'Senior Level', lead: 'management' };

export async function themuse(prefs: Preferences): Promise<RawJob[]> {
  const cats = new Set<string>();
  for (const role of prefs.roles) for (const [re, cat] of MUSE_CATEGORIES) if (re.test(role)) { cats.add(cat); break; }
  if (!cats.size) cats.add('Software Engineering');
  const params = new URLSearchParams();
  for (const c of cats) params.append('category', c);
  for (const s of prefs.seniority) if (MUSE_LEVELS[s]) params.append('level', MUSE_LEVELS[s]);
  for (const loc of prefs.locations.slice(0, 4)) params.append('location', loc);
  if (prefs.remote !== 'onsite') params.append('location', 'Flexible / Remote');
  const out: RawJob[] = [];
  for (const page of [0, 1]) {
    params.set('page', String(page));
    params.set('descending', 'true');
    const data = await getJson<any>(`https://www.themuse.com/api/public/jobs?${params}`);
    for (const j of data.results || []) {
      const loc = (j.locations || []).map((l: any) => l.name).join(' · ');
      out.push(
        finalize({
          source: 'themuse',
          sourceId: String(j.id),
          url: j.refs?.landing_page,
          applyUrl: j.refs?.landing_page,
          title: j.name,
          company: j.company?.name || 'Unknown',
          location: loc || 'Unspecified',
          remote: guessRemote(loc),
          seniority: (j.levels || [])[0]?.name,
          postedAt: iso(j.publication_date),
          html: j.contents,
          tags: (j.categories || []).map((c: any) => c.name),
        }),
      );
    }
    if ((data.page_count ?? 0) <= page + 1) break;
  }
  return out;
}

export async function arbeitnow(): Promise<RawJob[]> {
  const data = await getJson<any>('https://www.arbeitnow.com/api/job-board-api');
  return (data.data || []).map((j: any) =>
    finalize({
      source: 'arbeitnow',
      sourceId: j.slug,
      url: j.url,
      applyUrl: j.url,
      title: j.title,
      company: j.company_name,
      location: j.location || 'Germany',
      remote: j.remote ? 'remote' : guessRemote(j.location),
      employmentType: (j.job_types || []).join(', '),
      postedAt: iso(j.created_at),
      html: j.description,
      tags: (j.tags || []).slice(0, 8),
    }),
  );
}

// ---------- company boards (ATS) ----------

export async function greenhouseBoard(c: TargetCompany): Promise<RawJob[]> {
  const data = await getJson<any>(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(c.slug)}/jobs?content=true`, 30000);
  return (data.jobs || []).map((j: any) => greenhouseJob(j, c));
}

function greenhouseJob(j: any, c: Pick<TargetCompany, 'name' | 'slug'>): RawJob {
  const loc = j.location?.name || (j.offices || []).map((o: any) => o.name).join(', ') || 'Unspecified';
  return finalize({
    source: 'greenhouse',
    sourceId: `${c.slug}:${j.id}`,
    url: j.absolute_url,
    applyUrl: j.absolute_url,
    title: j.title,
    company: j.company_name || c.name,
    companyDomain: domainFromUrl(j.absolute_url),
    location: loc,
    remote: guessRemote(loc, j.title),
    postedAt: iso(j.first_published || j.updated_at),
    html: j.content || '',
    tags: (j.departments || []).map((d: any) => d.name.replace(/^\d+\s*/, '')).slice(0, 4),
  });
}

export async function leverBoard(c: TargetCompany): Promise<RawJob[]> {
  const data = await getJson<any[]>(`https://api.lever.co/v0/postings/${encodeURIComponent(c.slug)}?mode=json`, 30000);
  return data.map(j => leverJob(j, c));
}

function leverJob(j: any, c: Pick<TargetCompany, 'name' | 'slug'>): RawJob {
  const loc = j.categories?.allLocations?.join(' · ') || j.categories?.location || 'Unspecified';
  const lists = (j.lists || []).map((l: any) => `<h3>${l.text}</h3><ul>${l.content}</ul>`).join('');
  const sal = j.salaryRange ? formatSalary(j.salaryRange.min, j.salaryRange.max, j.salaryRange.currency, j.salaryRange.interval) : undefined;
  return finalize({
    source: 'lever',
    sourceId: `${c.slug}:${j.id}`,
    url: j.hostedUrl,
    applyUrl: j.applyUrl || j.hostedUrl,
    title: j.text,
    company: c.name,
    location: loc,
    remote: j.workplaceType === 'remote' ? 'remote' : j.workplaceType === 'hybrid' ? 'hybrid' : j.workplaceType === 'onsite' ? 'onsite' : guessRemote(loc),
    employmentType: j.categories?.commitment,
    salary: sal,
    postedAt: iso(j.createdAt),
    html: `${j.description || ''}${lists}${j.additional || ''}`,
    tags: [j.categories?.team, j.categories?.department].filter(Boolean),
  });
}

export async function ashbyBoard(c: TargetCompany): Promise<RawJob[]> {
  const data = await getJson<any>(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(c.slug)}?includeCompensation=true`, 30000);
  return (data.jobs || []).filter((j: any) => j.isListed !== false).map((j: any) => ashbyJob(j, c));
}

function ashbyJob(j: any, c: Pick<TargetCompany, 'name' | 'slug'>): RawJob {
  const locs = [j.location, ...(j.secondaryLocations || []).map((s: any) => s.location)].filter(Boolean);
  const wt = String(j.workplaceType || '').toLowerCase();
  return finalize({
    source: 'ashby',
    sourceId: `${c.slug}:${j.id}`,
    url: j.jobUrl,
    applyUrl: j.applyUrl || j.jobUrl,
    title: j.title,
    company: c.name,
    location: locs.join(' · ') || 'Unspecified',
    remote: j.isRemote && wt !== 'hybrid' ? 'remote' : wt === 'hybrid' ? 'hybrid' : wt === 'onsite' ? 'onsite' : guessRemote(locs.join(' ')),
    employmentType: j.employmentType?.replace(/([a-z])([A-Z])/g, '$1 $2'),
    salary: j.compensation?.scrapeableCompensationSalarySummary || j.compensation?.compensationTierSummary || undefined,
    postedAt: iso(j.publishedAt),
    html: j.descriptionHtml || '',
    text: j.descriptionPlain,
    tags: [j.department, j.team].filter(Boolean),
  });
}

// ---------- hydrate a single posting from an ATS URL (used for Hermes web finds + manual adds) ----------

export async function hydrateFromUrl(url: string): Promise<RawJob | null> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const parts = u.pathname.split('/').filter(Boolean);
  try {
    if (/greenhouse\.io$/.test(u.hostname)) {
      // boards.greenhouse.io/{slug}/jobs/{id} or job-boards.greenhouse.io/{slug}/jobs/{id}
      const slug = parts[0];
      const id = parts[2] || u.searchParams.get('gh_jid');
      if (!slug || !id) return null;
      const j = await getJson<any>(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs/${id}`);
      return greenhouseJob(j, { slug, name: j.company_name || titleCase(slug) });
    }
    if (u.searchParams.get('gh_jid')) {
      // Company careers page embedding Greenhouse — company slug is unknown; give up quietly.
      return null;
    }
    if (u.hostname === 'jobs.lever.co' && parts.length >= 2) {
      const [slug, id] = parts;
      const j = await getJson<any>(`https://api.lever.co/v0/postings/${slug}/${id}?mode=json`);
      return leverJob(j, { slug, name: titleCase(slug) });
    }
    if (u.hostname === 'jobs.ashbyhq.com' && parts.length >= 2) {
      const [slug, id] = parts;
      const data = await getJson<any>(`https://api.ashbyhq.com/posting-api/job-board/${slug}?includeCompensation=true`, 30000);
      const j = (data.jobs || []).find((x: any) => x.id === id);
      return j ? ashbyJob(j, { slug, name: titleCase(slug) }) : null;
    }
  } catch {
    return null;
  }
  return null;
}

const titleCase = (s: string) => s.replace(/[-_]+/g, ' ').replace(/\b\w/g, m => m.toUpperCase());

export async function verifyBoard(c: TargetCompany): Promise<number> {
  const fn = c.ats === 'greenhouse' ? greenhouseBoard : c.ats === 'lever' ? leverBoard : ashbyBoard;
  const jobs = await fn(c);
  return jobs.length;
}
