// Reading an arbitrary job-posting link from YOUR computer (not a remote extraction service, which
// many career sites block with CAPTCHAs). Order of preference:
//   1. the page's schema.org JobPosting block (Google-for-Jobs markup) — exact and instant
//   2. the page's readable text (static HTML, or rendered in a hidden browser if it needs JS),
//      handed to the caller to structure with Hermes

import type { RemoteMode } from '../../shared/types.ts';
import { cleanHtml, decodeEntities, domainFromUrl, formatSalary, guessRemote, htmlToText } from '../lib/text.ts';
import type { RawJob } from './index.ts';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

export async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'en-US,en;q=0.9,sv;q=0.8' },
    redirect: 'follow',
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.text();
}

/** All JSON-LD objects on a page, flattened through arrays and @graph. */
function jsonLd(html: string): any[] {
  const out: any[] = [];
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const walk = (v: any) => {
        if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === 'object') {
          out.push(v);
          if (Array.isArray(v['@graph'])) v['@graph'].forEach(walk);
        }
      };
      walk(JSON.parse(m[1].trim()));
    } catch {}
  }
  return out;
}

const isType = (o: any, t: string) => (Array.isArray(o?.['@type']) ? o['@type'] : [o?.['@type']]).some((x: any) => String(x).toLowerCase() === t.toLowerCase());
const text = (v: any): string => (typeof v === 'string' ? v : v && typeof v === 'object' ? text(v.name ?? v['@value'] ?? '') : '');

function placeOf(loc: any): string {
  const a = loc?.address ?? loc;
  if (!a) return '';
  if (typeof a === 'string') return a;
  return [text(a.addressLocality), text(a.addressRegion), text(a.addressCountry)].filter(Boolean).filter((v, i, arr) => arr.indexOf(v) === i).join(', ');
}

/** A job from the page's schema.org JobPosting markup, or null if it has none. */
export function fromJsonLd(html: string, url: string): RawJob | null {
  const jp = jsonLd(html).find(o => isType(o, 'JobPosting'));
  if (!jp?.title) return null;
  const locs = (Array.isArray(jp.jobLocation) ? jp.jobLocation : [jp.jobLocation]).map(placeOf).filter(Boolean);
  const remoteFlag = /telecommute/i.test(String(jp.jobLocationType || ''));
  const location = locs.join(' · ') || (remoteFlag ? 'Remote' : 'Unspecified');
  const remote: RemoteMode = remoteFlag ? 'remote' : guessRemote(location, jp.title, text(jp.description).slice(0, 2000));
  const descHtml = cleanHtml(decodeEntities(String(jp.description || '')));
  const sal = jp.baseSalary?.value;
  const salary =
    sal && (sal.minValue || sal.maxValue || sal.value)
      ? formatSalary(Number(sal.minValue ?? sal.value) || null, Number(sal.maxValue ?? sal.value) || null, jp.baseSalary.currency || 'USD', sal.unitText ? String(sal.unitText).toLowerCase() : undefined)
      : undefined;
  const employmentType = (Array.isArray(jp.employmentType) ? jp.employmentType : [jp.employmentType]).filter(Boolean).map((t: string) => t.replace(/_/g, ' ').toLowerCase()).join(', ');
  return {
    source: 'manual',
    sourceId: url,
    url,
    applyUrl: typeof jp.url === 'string' && /^https?:/.test(jp.url) ? jp.url : url,
    title: String(jp.title).replace(/\s+/g, ' ').trim(),
    company: text(jp.hiringOrganization) || domainFromUrl(url) || 'Unknown company',
    companyLogo: typeof jp.hiringOrganization?.logo === 'string' ? jp.hiringOrganization.logo : undefined,
    companyDomain: domainFromUrl(text(jp.hiringOrganization?.sameAs) || url),
    location,
    remote,
    employmentType: employmentType || undefined,
    salary,
    postedAt: jp.datePosted ? new Date(jp.datePosted).toISOString() : undefined,
    descriptionHtml: descHtml,
    descriptionText: htmlToText(descHtml),
    tags: [],
  };
}

/** The readable part of a page: main/article if present, without navigation, scripts and footers. */
export function readableText(html: string): string {
  const main = html.match(/<(main|article)\b[\s\S]*?<\/\1>/i)?.[0] || html.match(/<body\b[\s\S]*<\/body>/i)?.[0] || html;
  const stripped = main
    .replace(/<(script|style|noscript|svg|nav|header|footer|form)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  return htmlToText(stripped).replace(/\n{3,}/g, '\n\n').trim();
}

/** Render a JavaScript-only page in a hidden browser and return its HTML. */
export async function renderHtml(url: string): Promise<string> {
  const { chromium } = await import('playwright');
  const b = await chromium.launch({ headless: true });
  try {
    const ctx = await b.newContext({ userAgent: UA, locale: 'en-US' });
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    return await page.content();
  } finally {
    await b.close().catch(() => {});
  }
}
