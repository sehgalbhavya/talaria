// Job boards you add yourself: any site that lists jobs. Talaria works out how to read it:
//  - its RSS or Atom feed, which many boards publish,
//  - its listing page: the postings it links to, each read from its own page, or
//  - when neither gives Talaria anything to read (sign-in walls, pages built oddly), Hermes searches
//    the web within that site for your roles (scout.ts).

import type { CustomBoard, Preferences } from '../../shared/types.ts';
import { askJson } from '../lib/hermes.ts';
import { newId } from '../lib/store.ts';
import { cleanHtml, decodeEntities, guessRemote, htmlToText } from '../lib/text.ts';
import { harvestLinks, roleMatcher, searchTerms } from './companies.ts';
import { hydrateFromUrl, type RawJob } from './index.ts';
import { fetchHtml, fromJsonLd, readableText, renderHtml } from './jobpage.ts';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

// Boards Talaria already searches, and hiring platforms that hold one company's jobs.
const BUILT_IN: [RegExp, string][] = [
  [/(^|\.)remotive\.com$/, 'Remotive'],
  [/(^|\.)remoteok\.com$/, 'Remote OK'],
  [/(^|\.)himalayas\.app$/, 'Himalayas'],
  [/(^|\.)jobicy\.com$/, 'Jobicy'],
  [/(^|\.)themuse\.com$/, 'The Muse'],
  [/(^|\.)arbeitnow\.com$/, 'Arbeitnow'],
];
const COMPANY_PLATFORM = /(^|\.)(greenhouse\.io|lever\.co|ashbyhq\.com|myworkdayjobs\.com|workable\.com|smartrecruiters\.com|recruitee\.com)$/i;

const hostOf = (url: string) => new URL(url).hostname.replace(/^www\./, '');

/** The board's address for each of your roles, when it has a {query} placeholder. */
function withQueries(url: string, prefs: Preferences): string[] {
  if (!url.includes('{query}')) return [url];
  return searchTerms(prefs).map(q => url.replaceAll('{query}', encodeURIComponent(q)));
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/rss+xml,application/atom+xml,application/xml,text/xml,text/html;q=0.9,*/*;q=0.8' },
    redirect: 'follow',
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} from ${new URL(url).hostname}`);
  return res.text();
}

// ---------------- feeds ----------------

interface FeedItem {
  title: string;
  link: string;
  html: string;
  date?: string;
  company?: string;
  location?: string;
}

const isFeed = (text: string) => /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<\?xml-stylesheet[^>]*>\s*)?<(rss|feed|rdf:RDF)\b/i.test(text);

const unwrap = (s: string) => decodeEntities(s.replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1')).trim();

export function parseFeed(xml: string): FeedItem[] {
  const items: FeedItem[] = [];
  for (const [block] of xml.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/gi)) {
    const tag = (name: string) => {
      const m = block.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
      return m ? unwrap(m[1]) : '';
    };
    const link = tag('link') || block.match(/<link\b[^>]*href=["']([^"']+)["']/i)?.[1] || tag('guid');
    let title = tag('title').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    let company = tag('company') || tag('job_listing:company') || tag('dc:company');
    // Boards often put the employer in the title: "Acme: Product Designer" or "Product Designer at Acme".
    if (!company) {
      const lead = title.match(/^([^:]{2,60}):\s+(.{4,})$/);
      const at = title.match(/^(.{4,}?)\s+(?:at|@)\s+([^,()|]{2,60})$/i);
      if (lead) [company, title] = [lead[1].trim(), lead[2].trim()];
      else if (at) [title, company] = [at[1].trim(), at[2].trim()];
    }
    if (!title || !/^https?:\/\//.test(link)) continue;
    items.push({
      title,
      link: decodeEntities(link),
      html: tag('content:encoded') || tag('description') || tag('content') || tag('summary'),
      date: tag('pubDate') || tag('published') || tag('updated') || tag('dc:date') || undefined,
      company: company || undefined,
      location: tag('location') || tag('job_listing:location') || tag('region') || undefined,
    });
  }
  return items;
}

/** The feed a page advertises in its <head>, if any. */
function feedLink(html: string, base: string): string | undefined {
  for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
    if (!/rel=["']?alternate/i.test(tag) || !/type=["']?application\/(rss|atom)\+xml/i.test(tag)) continue;
    const href = tag.match(/href=["']([^"']+)["']/i)?.[1];
    if (href) {
      try {
        return new URL(decodeEntities(href), base).href;
      } catch {}
    }
  }
  return undefined;
}

/** Where boards usually keep their feed: next to the page ("…/design-jobs.rss"), or at the site root. */
function feedGuesses(url: string): string[] {
  const u = new URL(url);
  const page = u.origin + u.pathname.replace(/\/$/, '');
  return [...new Set([`${page}.rss`, `${page}/feed`, `${page}/rss`, `${u.origin}/feed`, `${u.origin}/rss`, `${u.origin}/jobs.rss`])];
}

/** The first of these addresses that is a feed with items in it. */
async function firstFeed(urls: string[]): Promise<{ url: string; xml: string; items: FeedItem[] } | null> {
  const got = await Promise.all(urls.map(u => fetchText(u).catch(() => '')));
  for (const [i, xml] of got.entries()) {
    const items = isFeed(xml) ? parseFeed(xml) : [];
    if (items.length) return { url: urls[i], xml, items };
  }
  return null;
}

// ---------------- listing pages ----------------

async function listingLinks(url: string): Promise<{ html: string; links: { href: string; text: string }[] }> {
  let html = await fetchHtml(url).catch(() => '');
  let links = html ? harvestLinks(html, url, { platforms: true }) : [];
  if (links.length < 3) {
    const rendered = await renderHtml(url).catch(() => '');
    const more = rendered ? harvestLinks(rendered, url, { platforms: true }) : [];
    if (more.length > links.length) [html, links] = [rendered, more];
  }
  return { html, links };
}

/** Words in a posting's address ("/jobs/310373-Sr-Product-Designer-Mobile"), for boards whose links all say "View job". */
function slugWords(href: string): string {
  const seg = new URL(href).pathname.split('/').filter(Boolean).pop() || '';
  return decodeURIComponent(seg)
    .replace(/\.[a-z]+$/i, '')
    .replace(/[-_+]+/g, ' ')
    .replace(/\b\d+\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
const GENERIC_LINK = /^(view|see|read|apply|details|more|learn|open)\b.{0,20}$/i;
const linkTitle = (href: string, text: string) => (GENERIC_LINK.test(text) ? slugWords(href) || text : text);

type Unread ={ url: string; title: string; text: string; company?: string; location?: string; date?: string };

/** One posting linked from a board: exact when it's on a hiring platform or its page has JobPosting data, otherwise its text. */
async function readLinked(url: string, title: string): Promise<RawJob | Unread> {
  const ats = await hydrateFromUrl(url).catch(() => null);
  if (ats) return ats;
  let html = await fetchHtml(url).catch(() => '');
  const job = html ? fromJsonLd(html, url) : null;
  if (job) return job;
  let text = html ? readableText(html) : '';
  if (text.length < 500) {
    html = await renderHtml(url).catch(() => '');
    const rendered = html ? fromJsonLd(html, url) : null;
    if (rendered) return rendered;
    text = html ? readableText(html) : text;
  }
  return { url, title, text };
}

const STRUCTURE_PROMPT = (board: string, pages: Unread[]) => `Each block below is a page linked from the job board "${board}". For each one, say which job it is.
Return ONLY a JSON array, one entry per block: [{"i": number, "isJob": boolean, "title": string, "company": string, "location": string, "remote": "remote"|"hybrid"|"onsite"|"unknown"}]
"isJob" is false for anything that isn't a single open job posting. "company" is the employer, never the job board.

${pages.map((p, i) => `### i=${i} · ${p.url}\nLink text: ${p.title}\n${p.text.slice(0, 2500)}`).join('\n\n')}`;

/** Postings with no structured data: Hermes reads who is hiring, where, from each page's text (one call per board). */
async function structure(board: CustomBoard, pages: Unread[]): Promise<RawJob[]> {
  // Feed items that already name the employer don't need Hermes.
  const ready = pages.filter(p => p.company);
  const unclear = pages.filter(p => !p.company && p.text.length >= 300).slice(0, 8);
  const got = unclear.length ? await askJson<any[]>({ prompt: STRUCTURE_PROMPT(board.name, unclear), timeoutSec: 180 }).catch(() => []) : [];
  const out = ready.map(p => fromText(p, { title: p.title, company: p.company!, location: p.location }));
  for (const g of Array.isArray(got) ? got : []) {
    const p = unclear[Number(g?.i)];
    if (!p || !g.isJob || typeof g.company !== 'string' || !g.company.trim()) continue;
    out.push(fromText(p, { title: typeof g.title === 'string' && g.title.trim() ? g.title : p.title, company: g.company, location: g.location, remote: g.remote }));
  }
  return out;
}

function fromText(p: Unread, f: { title: string; company: string; location?: string; remote?: string }): RawJob {
  const looksHtml = /<[a-z][\s\S]*>/i.test(p.text);
  const html = looksHtml
    ? cleanHtml(p.text)
    : p.text
        .slice(0, 12000)
        .split(/\n{2,}/)
        .map(t => `<p>${t.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p>`)
        .join('');
  const location = typeof f.location === 'string' && f.location.trim() ? f.location.trim() : 'Unspecified';
  const date = p.date ? new Date(p.date) : null;
  return {
    source: 'custom_board',
    sourceId: p.url,
    url: p.url,
    applyUrl: p.url,
    title: f.title.trim(),
    company: f.company.trim(),
    location,
    remote: f.remote === 'remote' || f.remote === 'hybrid' || f.remote === 'onsite' ? f.remote : guessRemote(location, f.title, htmlToText(html).slice(0, 3000)),
    postedAt: date && !isNaN(+date) ? date.toISOString() : undefined,
    descriptionHtml: html,
    descriptionText: htmlToText(html),
    tags: [],
  };
}

// ---------------- reading a board ----------------

/** Postings on your board for your roles. needsSearch: Talaria found nothing it can read there, so Hermes should search it. */
export async function readBoard(b: CustomBoard, prefs: Preferences, limit = 12): Promise<{ jobs: RawJob[]; needsSearch: boolean }> {
  if (b.how === 'search') return { jobs: [], needsSearch: true };
  const match = roleMatcher(prefs);
  const unread: Unread[] = [];
  const jobs: RawJob[] = [];
  let listed = 0;

  if (b.how === 'feed') {
    const items = new Map<string, FeedItem>();
    for (const url of withQueries(b.feedUrl || b.url, prefs)) {
      const xml = await fetchText(url).catch(() => '');
      for (const it of isFeed(xml) ? parseFeed(xml) : []) items.set(it.link, it);
    }
    listed = items.size;
    for (const it of [...items.values()].filter(it => match(it.title)).slice(0, limit)) {
      // The posting's own page is better than the feed's summary when it has JobPosting data.
      const page = (await hydrateFromUrl(it.link).catch(() => null)) || (await fetchHtml(it.link).then(h => fromJsonLd(h, it.link)).catch(() => null));
      if (page) jobs.push(page);
      else unread.push({ url: it.link, title: it.title, text: it.html, company: it.company, location: it.location, date: it.date });
    }
  } else {
    const links = new Map<string, string>();
    for (const url of withQueries(b.url, prefs)) for (const l of (await listingLinks(url)).links) if (!links.has(l.href)) links.set(l.href, linkTitle(l.href, l.text));
    listed = links.size;
    for (const [href, text] of [...links].filter(([, text]) => match(text)).slice(0, limit)) {
      const r = await readLinked(href, text);
      if ('source' in r) jobs.push(r);
      else unread.push(r);
    }
  }

  if (unread.length) jobs.push(...(await structure(b, unread)));
  // Pages read from their JobPosting data come back as 'manual'; hiring-platform postings keep their platform.
  const found = jobs.map(j => ({ ...j, source: j.source === 'manual' ? ('custom_board' as const) : j.source, via: b.name }));
  // A board that lists jobs, none of them yours, still deserves a search: it may only show the newest few.
  return { jobs: found, needsSearch: !listed || !found.length };
}

// ---------------- adding a board ----------------

function siteName(html: string, url: string): string {
  const og = html.match(/<meta\b[^>]*property=["']og:site_name["'][^>]*content=["']([^"']+)["']/i)?.[1] || html.match(/<meta\b[^>]*content=["']([^"']+)["'][^>]*property=["']og:site_name["']/i)?.[1];
  if (og?.trim()) return decodeEntities(og.trim()).split(/\s+[|–—·-]\s+/)[0].slice(0, 60);
  const title = decodeEntities(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/\s+/g, ' ').trim();
  // The part of the title that looks like the address ("Search | jobs.ac.uk"), else the last: "Remote design jobs | Dribbble".
  const parts = title.split(/\s+[|–—·-]\s+/).map(s => s.trim()).filter(Boolean);
  const flat = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const host = flat(hostOf(url));
  const named = parts.find(p => p.length <= 40 && flat(p).length >= 3 && host.includes(flat(p).replace(/(com|org|net)$/, '')));
  if (named) return named;
  if (parts.length > 1 && parts[parts.length - 1].length <= 40) return parts[parts.length - 1];
  const label = hostOf(url).split('.').slice(-2, -1)[0] || hostOf(url);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** A link to any job board → how Talaria will read it, and how many jobs it can see there now. */
export async function detectBoard(input: string, name: string | undefined, prefs: Preferences): Promise<{ board: CustomBoard; count: number }> {
  let url = input.trim();
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  let host: string;
  try {
    host = hostOf(url);
  } catch {
    throw new Error("That doesn't look like a link. Paste the address of the job board's page.");
  }
  const builtIn = BUILT_IN.find(([re]) => re.test(host));
  if (builtIn) throw new Error(`${builtIn[1]} is already built in: turn it on in the list above.`);
  if (/(^|\.)linkedin\.com$/.test(host)) throw new Error('LinkedIn is built in: connect it in Settings and it is searched with the others.');
  if (COMPANY_PLATFORM.test(host)) throw new Error("That's one company's jobs page. Add it under Companies to watch instead.");

  const [target] = withQueries(url, prefs);
  const board: CustomBoard = { id: newId(), name: name?.trim() || '', url, how: 'search', domain: host, enabled: true };
  const body = await fetchText(target).catch(() => '');
  let count = 0;

  const feedTitle = (xml: string) => unwrap(xml.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').slice(0, 60);

  if (isFeed(body)) {
    board.how = 'feed';
    board.feedUrl = url;
    count = parseFeed(body).length;
    board.name ||= feedTitle(body) || siteName('', url);
  } else {
    const { html, links } = await listingLinks(target);
    const page = html || body;
    if (links.length >= 3) {
      board.how = 'page';
      count = links.length;
    } else {
      // Few readable links on the page (or the page turns robots away): its feed may still list everything.
      const advertised = feedLink(page, target);
      const [nextToPage, ...rest] = feedGuesses(target);
      const feed = await firstFeed([nextToPage, ...(advertised ? [advertised] : []), ...rest]);
      if (feed) {
        board.how = 'feed';
        board.feedUrl = feed.url;
        count = feed.items.length;
        if (!page) board.name ||= feedTitle(feed.xml);
      } else if (links.length) {
        board.how = 'page';
        count = links.length;
      }
    }
    board.name ||= siteName(page, url);
  }
  return { board, count };
}
