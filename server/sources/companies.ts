// Any company you want to watch, wherever it posts jobs. Talaria works out where that is:
//  - a hiring platform with a public job feed (Greenhouse, Lever, Ashby, Workday, Workable,
//    SmartRecruiters, Recruitee) is read directly, and
//  - a company's own careers site is read from its page where possible, and otherwise searched
//    on the web within that site (scout.ts), with each posting then read from the company's page.

import type { Preferences, TargetCompany } from '../../shared/types.ts';
import { cleanHtml, domainFromUrl, guessRemote, htmlToText } from '../lib/text.ts';
import { ashbyBoard, greenhouseBoard, leverBoard, type RawJob } from './index.ts';
import { fetchHtml, fromJsonLd, readableText, renderHtml } from './jobpage.ts';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

async function json<T = any>(url: string, init: RequestInit = {}, timeoutMs = 25000): Promise<T> {
  const res = await fetch(url, { ...init, headers: { 'User-Agent': UA, Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.headers || {}) }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} from ${new URL(url).hostname}`);
  return (await res.json()) as T;
}

const iso = (v: any) => {
  if (!v) return undefined;
  const d = new Date(v);
  return isNaN(+d) ? undefined : d.toISOString();
};

/** Words from your target roles, to skip obviously unrelated postings before fetching their details. */
export function roleMatcher(prefs: Preferences): (title: string) => boolean {
  const stop = /^(senior|sr|junior|jr|lead|staff|principal|head|of|and|the|for|entry|level|mid|intern|graduate|associate|i|ii|iii)$/;
  // "Front-end" / "front end" / "frontend" (and full stack) read the same.
  const norm = (s: string) => ` ${s.toLowerCase().replace(/front[\s-]+end/g, 'frontend').replace(/full[\s-]+stack/g, 'fullstack').replace(/[^a-z0-9+#]+/g, ' ')} `;
  // A title matches a role when it contains every meaningful word of it ("CAD Engineer" isn't a
  // "Frontend Engineer"); "UI/UX Designer" is satisfied by either UI or UX.
  const roles = prefs.roles
    .map(r => norm(r).trim().split(' ').filter(w => w && !stop.test(w)))
    .filter(ws => ws.length)
    .map(ws => (ws.includes('ui') && ws.includes('ux') ? [...ws.filter(w => w !== 'ui' && w !== 'ux'), 'ui|ux'] : ws));
  if (!roles.length) return () => true;
  return title => {
    const t = norm(title);
    return roles.some(ws => ws.every(w => w.split('|').some(x => t.includes(` ${x} `) || t.includes(` ${x}s `))));
  };
}

export function searchTerms(prefs: Preferences): string[] {
  const roles = prefs.roles.length ? prefs.roles : ['designer'];
  return [...new Set(roles.map(r => r.replace(/\b(junior|senior|sr\.?|jr\.?|entry[- ]level|graduate)\b/gi, '').trim().toLowerCase()))].slice(0, 3);
}

// ---------------- Workday ----------------

function workdayParts(c: TargetCompany) {
  const u = new URL(c.url!);
  const segs = u.pathname.split('/').filter(Boolean).filter(s => !/^[a-z]{2}-[A-Z]{2}$/.test(s));
  return { origin: u.origin, tenant: c.slug || u.hostname.split('.')[0], site: segs[0] };
}

export async function workdayBoard(c: TargetCompany, prefs: Preferences, limit = 12): Promise<RawJob[]> {
  const { origin, tenant, site } = workdayParts(c);
  const api = `${origin}/wday/cxs/${tenant}/${site}`;
  const match = roleMatcher(prefs);
  const paths = new Map<string, any>();
  for (const q of searchTerms(prefs)) {
    const r = await json<any>(`${api}/jobs`, { method: 'POST', body: JSON.stringify({ appliedFacets: {}, limit: 20, offset: 0, searchText: q }) });
    for (const p of r.jobPostings || []) if (p.externalPath && match(p.title || '')) paths.set(p.externalPath, p);
  }
  const out: RawJob[] = [];
  for (const [path, p] of [...paths].slice(0, limit)) {
    const d = await json<any>(`${api}${path}`).catch(() => null);
    const i = d?.jobPostingInfo;
    if (!i) continue;
    const loc = [i.location, ...(i.additionalLocations || [])].filter(Boolean).join(' · ') || p.locationsText || 'Unspecified';
    const html = cleanHtml(i.jobDescription || '');
    out.push({
      source: 'workday',
      sourceId: `${tenant}:${i.jobReqId || i.id}`,
      url: i.externalUrl || `${origin}/${site}${path}`,
      applyUrl: i.externalUrl || `${origin}/${site}${path}`,
      title: i.title,
      company: c.name,
      companyDomain: c.domain,
      location: loc,
      remote: guessRemote(loc, i.remoteType, i.title),
      employmentType: i.timeType,
      postedAt: iso(i.startDate),
      descriptionHtml: html,
      descriptionText: htmlToText(html),
      tags: [],
    });
  }
  return out;
}

// ---------------- Workable ----------------

export async function workableBoard(c: TargetCompany, prefs: Preferences, limit = 12): Promise<RawJob[]> {
  const r = await json<any>(`https://apply.workable.com/api/v3/accounts/${encodeURIComponent(c.slug)}/jobs`, { method: 'POST', body: JSON.stringify({ query: '', location: [], department: [], worktype: [], remote: [] }) });
  const match = roleMatcher(prefs);
  const out: RawJob[] = [];
  for (const j of (r.results || []).filter((j: any) => match(j.title || '')).slice(0, limit)) {
    const d = await json<any>(`https://apply.workable.com/api/v2/accounts/${encodeURIComponent(c.slug)}/jobs/${j.shortcode}`).catch(() => j);
    const loc = [j.location?.city, j.location?.country].filter(Boolean).join(', ') || (j.remote ? 'Remote' : 'Unspecified');
    const html = cleanHtml([d.description, d.requirements && `<h3>Requirements</h3>${d.requirements}`, d.benefits && `<h3>Benefits</h3>${d.benefits}`].filter(Boolean).join(''));
    const url = `https://apply.workable.com/${c.slug}/j/${j.shortcode}/`;
    out.push({
      source: 'workable',
      sourceId: `${c.slug}:${j.shortcode}`,
      url,
      applyUrl: url,
      title: j.title,
      company: c.name,
      companyDomain: c.domain,
      location: loc,
      remote: j.workplace === 'hybrid' || d.workplace === 'hybrid' ? 'hybrid' : j.remote ? 'remote' : j.workplace === 'on_site' ? 'onsite' : guessRemote(loc),
      postedAt: iso(j.published),
      descriptionHtml: html,
      descriptionText: htmlToText(html),
      tags: [d.department].flat().filter(Boolean).slice(0, 3),
    });
  }
  return out;
}

// ---------------- SmartRecruiters ----------------

export async function smartrecruitersBoard(c: TargetCompany, prefs: Preferences, limit = 12): Promise<RawJob[]> {
  const match = roleMatcher(prefs);
  const found = new Map<string, any>();
  for (const q of searchTerms(prefs)) {
    const r = await json<any>(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(c.slug)}/postings?limit=50&q=${encodeURIComponent(q)}`);
    for (const p of r.content || []) if (match(p.name || '')) found.set(p.id, p);
  }
  const out: RawJob[] = [];
  for (const p of [...found.values()].slice(0, limit)) {
    const d = await json<any>(p.ref || `https://api.smartrecruiters.com/v1/companies/${c.slug}/postings/${p.id}`).catch(() => null);
    const s = d?.jobAd?.sections || {};
    const html = cleanHtml(['jobDescription', 'qualifications', 'additionalInformation'].map(k => (s[k]?.text ? `<h3>${s[k].title || ''}</h3>${s[k].text}` : '')).join(''));
    const loc = [p.location?.city, p.location?.country?.toUpperCase()].filter(Boolean).join(', ') || 'Unspecified';
    const url = d?.postingUrl || `https://jobs.smartrecruiters.com/${c.slug}/${p.id}`;
    out.push({
      source: 'smartrecruiters',
      sourceId: `${c.slug}:${p.id}`,
      url,
      applyUrl: d?.applyUrl || url,
      title: p.name,
      company: p.company?.name || c.name,
      companyDomain: c.domain,
      location: loc,
      remote: p.location?.remote ? 'remote' : p.location?.hybrid ? 'hybrid' : guessRemote(loc),
      employmentType: p.typeOfEmployment?.label,
      postedAt: iso(p.releasedDate),
      descriptionHtml: html,
      descriptionText: htmlToText(html),
      tags: [p.department?.label].filter(Boolean),
    });
  }
  return out;
}

// ---------------- Recruitee ----------------

export async function recruiteeBoard(c: TargetCompany, prefs: Preferences, limit = 15): Promise<RawJob[]> {
  const r = await json<any>(`https://${c.slug}.recruitee.com/api/offers/`);
  const match = roleMatcher(prefs);
  return (r.offers || [])
    .filter((o: any) => match(o.title || ''))
    .slice(0, limit)
    .map((o: any): RawJob => {
      const html = cleanHtml(`${o.description || ''}${o.requirements ? `<h3>Requirements</h3>${o.requirements}` : ''}`);
      const loc = o.location || [o.city, o.country].filter(Boolean).join(', ') || 'Unspecified';
      return {
        source: 'recruitee',
        sourceId: `${c.slug}:${o.id}`,
        url: o.careers_url,
        applyUrl: o.careers_apply_url || o.careers_url,
        title: o.title,
        company: o.company_name || c.name,
        companyDomain: c.domain,
        location: loc,
        remote: o.remote ? 'remote' : o.hybrid ? 'hybrid' : guessRemote(loc),
        employmentType: o.employment_type_code,
        postedAt: iso(o.published_at),
        descriptionHtml: html,
        descriptionText: htmlToText(html),
        tags: [o.department].filter(Boolean),
      };
    });
}

// ---------------- the company's own careers site ----------------

const JOB_HREF = /\/(jobs?|positions?|vacanc(y|ies)|openings?|stellen|requisitions?|career-opportunities)\/[^?#]{4,}|[?&](jobid|job_id|jid|reqid|id)=|jid-\d+|\/\d{5,}(\/|$)/i;
const LIST_HREF = /job-?search|jobfinder|search-jobs|\/jobs\/?$|\/careers\/?$|[?&](page|q|search|keywords?)=/i;

function sameSite(a: string, b: string) {
  const root = (h: string) => h.replace(/^www\./, '').split('.').slice(-2).join('.');
  try {
    return root(new URL(a).hostname) === root(new URL(b).hostname);
  } catch {
    return false;
  }
}

function harvestLinks(html: string, base: string) {
  const out = new Map<string, string>();
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let href: string;
    try {
      href = new URL(m[1].replace(/&amp;/g, '&'), base).href;
    } catch {
      continue;
    }
    const text = m[2].replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
    if (text.length < 6 || text.length > 180 || !sameSite(href, base) || !JOB_HREF.test(href) || LIST_HREF.test(href) || href === base) continue;
    if (!out.has(href)) out.set(href, text);
  }
  return [...out].map(([href, text]) => ({ href, text }));
}

/** Read one posting from any site: its JobPosting data if present, else the page text. */
export async function readPosting(url: string, fallback: { title?: string; company?: string; location?: string; source?: RawJob['source'] } = {}): Promise<RawJob | null> {
  let html = await fetchHtml(url).catch(() => '');
  let job = html ? fromJsonLd(html, url) : null;
  if (!job) {
    let text = html ? readableText(html) : '';
    if (text.length < 500) {
      html = await renderHtml(url).catch(() => '');
      job = html ? fromJsonLd(html, url) : null;
      text = html ? readableText(html) : '';
    }
    if (!job) {
      if (text.length < 400 || !fallback.title) return null;
      const body = text.slice(0, 12000);
      job = {
        source: 'company_site',
        sourceId: url,
        url,
        applyUrl: url,
        title: fallback.title,
        company: fallback.company || domainFromUrl(url) || 'Unknown company',
        companyDomain: domainFromUrl(url),
        location: fallback.location || 'Unspecified',
        remote: guessRemote(fallback.location, body.slice(0, 3000)),
        descriptionHtml: body
          .split(/\n{2,}/)
          .map(p => `<p>${p.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p>`)
          .join(''),
        descriptionText: body,
        tags: [],
      };
    }
  }
  return { ...job, source: fallback.source || 'company_site', company: fallback.company || job.company };
}

/** Postings linked from a company's careers page. needsSearch: the page shows none we can read. */
export async function siteBoard(c: TargetCompany, prefs: Preferences, limit = 10): Promise<{ jobs: RawJob[]; needsSearch: boolean }> {
  const url = c.url!;
  let html = await fetchHtml(url).catch(() => '');
  let links = harvestLinks(html, url);
  if (links.length < 3) {
    html = await renderHtml(url).catch(() => '');
    links = harvestLinks(html, url);
  }
  if (!links.length) return { jobs: [], needsSearch: true };
  const match = roleMatcher(prefs);
  const picked = links.filter(l => match(l.text)).slice(0, limit);
  const jobs: RawJob[] = [];
  for (const l of picked) {
    const j = await readPosting(l.href, { title: l.text, company: c.name }).catch(() => null);
    if (j) jobs.push({ ...j, companyDomain: c.domain || j.companyDomain });
  }
  // A careers page that lists jobs, none of them yours, still deserves a site search: it may only show page 1.
  return { jobs, needsSearch: !picked.length };
}

// ---------------- one entry point ----------------

export async function companyBoard(c: TargetCompany, prefs: Preferences): Promise<{ jobs: RawJob[]; needsSearch?: boolean }> {
  switch (c.ats) {
    case 'greenhouse':
      return { jobs: await greenhouseBoard(c) };
    case 'lever':
      return { jobs: await leverBoard(c) };
    case 'ashby':
      return { jobs: await ashbyBoard(c) };
    case 'workday':
      return { jobs: await workdayBoard(c, prefs) };
    case 'workable':
      return { jobs: await workableBoard(c, prefs) };
    case 'smartrecruiters':
      return { jobs: await smartrecruitersBoard(c, prefs) };
    case 'recruitee':
      return { jobs: await recruiteeBoard(c, prefs) };
    default:
      return siteBoard(c, prefs);
  }
}

// ---------------- working out where a company posts ----------------

const PLATFORM_PATTERNS: { ats: TargetCompany['ats']; re: RegExp; pick: (m: RegExpMatchArray) => Partial<TargetCompany> }[] = [
  { ats: 'greenhouse', re: /(?:boards|job-boards)\.greenhouse\.io\/(?:embed\/job_board(?:\/js)?\?for=)?([a-z0-9_-]+)/i, pick: m => ({ slug: m[1].toLowerCase() }) },
  { ats: 'greenhouse', re: /boards-api\.greenhouse\.io\/v1\/boards\/([a-z0-9_-]+)/i, pick: m => ({ slug: m[1].toLowerCase() }) },
  { ats: 'lever', re: /jobs\.lever\.co\/([a-z0-9_.-]+)/i, pick: m => ({ slug: m[1].toLowerCase() }) },
  { ats: 'ashby', re: /jobs\.ashbyhq\.com\/([a-z0-9_.%-]+)/i, pick: m => ({ slug: decodeURIComponent(m[1]) }) },
  { ats: 'workday', re: /https?:\/\/([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?([A-Za-z0-9_-]+)/, pick: m => ({ slug: m[1], url: `https://${m[1]}.${m[2]}.myworkdayjobs.com/${m[3]}` }) },
  { ats: 'workable', re: /apply\.workable\.com\/(?:api\/v\d\/accounts\/)?([a-z0-9_-]+)/i, pick: m => ({ slug: m[1].toLowerCase() }) },
  { ats: 'smartrecruiters', re: /(?:jobs|careers)\.smartrecruiters\.com\/([A-Za-z0-9_-]+)/, pick: m => ({ slug: m[1] }) },
  { ats: 'recruitee', re: /\b([a-z0-9-]+)\.recruitee\.com/i, pick: m => ({ slug: m[1].toLowerCase() }) },
];
const IGNORE_SLUG = /^(embed|api|v\d|jobs|careers|www|static|assets|js|css|apply|search)$/i;

export const PLATFORM_LABEL: Record<TargetCompany['ats'], string> = {
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  ashby: 'Ashby',
  workday: 'Workday',
  workable: 'Workable',
  smartrecruiters: 'SmartRecruiters',
  recruitee: 'Recruitee',
  site: 'Own website',
};

/** How many jobs a board has open (list calls only), or -1 if it isn't there. */
async function count(c: TargetCompany): Promise<number> {
  try {
    switch (c.ats) {
      case 'greenhouse':
        return (await greenhouseBoard(c)).length;
      case 'lever':
        return (await leverBoard(c)).length;
      case 'ashby':
        return (await ashbyBoard(c)).length;
      case 'workable':
        return ((await json<any>(`https://apply.workable.com/api/v3/accounts/${encodeURIComponent(c.slug)}/jobs`, { method: 'POST', body: JSON.stringify({ query: '' }) })).results || []).length;
      case 'recruitee':
        return ((await json<any>(`https://${c.slug}.recruitee.com/api/offers/`)).offers || []).length;
      case 'smartrecruiters': {
        const r = await json<any>(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(c.slug)}/postings?limit=1`);
        return r.totalFound > 0 ? r.totalFound : -1;
      }
      case 'workday': {
        const { origin, tenant, site } = workdayParts(c);
        return (await json<any>(`${origin}/wday/cxs/${tenant}/${site}/jobs`, { method: 'POST', body: JSON.stringify({ appliedFacets: {}, limit: 1, offset: 0, searchText: '' }) })).total ?? 0;
      }
      default:
        return 0;
    }
  } catch {
    return -1;
  }
}

/** Turn a careers link (or page that embeds a hiring platform) into something Talaria can read. */
export async function detectCompany(input: { name?: string; url?: string }, prefs: Preferences): Promise<{ company: TargetCompany; count: number }> {
  const name = (input.name || '').trim();
  let url = (input.url || '').trim();
  if (url && !/^https?:\/\//i.test(url)) url = `https://${url}`;

  const fromText = async (text: string) => {
    for (const p of PLATFORM_PATTERNS) {
      const m = text.match(p.re);
      if (!m || IGNORE_SLUG.test(m[1])) continue;
      const c = { name: name || '', ats: p.ats, slug: '', ...p.pick(m) } as TargetCompany;
      if (!c.name) c.name = c.slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, x => x.toUpperCase());
      const n = await count(c);
      if (n >= 0) return { company: c, count: n };
    }
    return null;
  };

  if (url) {
    const direct = await fromText(url);
    if (direct) return direct;
    // A company's own page often embeds or links to its hiring platform.
    let html = await fetchHtml(url).catch(() => '');
    let found = html ? await fromText(html) : null;
    if (!found) {
      html = await renderHtml(url).catch(() => html);
      found = html ? await fromText(html) : null;
    }
    if (found) return { ...found, company: { ...found.company, name: name || found.company.name, domain: domainFromUrl(url) } };
    const domain = domainFromUrl(url);
    const company: TargetCompany = { name: name || (domain || '').split('.')[0].replace(/\b\w/g, x => x.toUpperCase()), ats: 'site', slug: domain || url, url, domain };
    const listed = harvestLinks(html, url).length;
    return { company, count: listed };
  }

  // Only a name: try the platforms that use a guessable slug.
  const guesses = [...new Set([name.toLowerCase().replace(/[^a-z0-9]+/g, ''), name.toLowerCase().replace(/[^a-z0-9]+/g, '-')])].filter(Boolean);
  for (const slug of guesses) {
    for (const ats of ['greenhouse', 'lever', 'ashby', 'workable', 'recruitee'] as const) {
      const c: TargetCompany = { name, ats, slug };
      const n = await count(c);
      if (n > 0) return { company: c, count: n };
    }
  }
  throw new Error('NEEDS_URL');
}
