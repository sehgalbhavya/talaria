// LinkedIn as a job source, read through Talaria's own browser window where YOU signed in.
// Read-only and deliberately slow (human-paced, small caps). It never uses Easy Apply and never
// touches your profile, messages or network. Note: LinkedIn's terms prohibit automated access,
// so this is opt-in and low-volume by design.

import type { Page } from 'playwright';
import type { Preferences } from '../../shared/types.ts';
import { browser, humanPause, newPage } from '../lib/browser.ts';
import { getSettings, setSettings, now } from '../lib/store.ts';
import { cleanHtml, guessRemote, htmlToText } from '../lib/text.ts';
import { hydrateFromUrl, type RawJob } from '../sources/index.ts';

const MAX_PER_QUERY = 8;
const MAX_TOTAL = 20;

export async function linkedinSignedIn(): Promise<boolean> {
  const ctx = await browser();
  const cookies = await ctx.cookies('https://www.linkedin.com');
  return cookies.some(c => c.name === 'li_at' && (!c.expires || c.expires === -1 || c.expires * 1000 > Date.now()));
}

/** Open LinkedIn's sign-in page in Talaria's window and wait (up to 5 min) for you to sign in. */
export async function connectLinkedIn(): Promise<{ connected: boolean }> {
  if (await linkedinSignedIn()) {
    setSettings({ linkedin: { ...getSettings().linkedin, connected: true, checkedAt: now() } });
    return { connected: true };
  }
  const page = await newPage();
  await page.goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded' });
  await page.bringToFront();
  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 2000));
    if (page.isClosed()) break;
    if (await linkedinSignedIn()) {
      setSettings({ linkedin: { ...getSettings().linkedin, connected: true, checkedAt: now() } });
      await page.goto('https://www.linkedin.com/jobs/', { waitUntil: 'domcontentloaded' }).catch(() => {});
      return { connected: true };
    }
  }
  return { connected: false };
}

export async function disconnectLinkedIn() {
  const ctx = await browser();
  await ctx.clearCookies({ domain: /linkedin\.com$/ }).catch(async () => {
    // Older Playwright: clear everything for linkedin by filtering.
    const keep = (await ctx.cookies()).filter(c => !/linkedin\.com$/.test(c.domain));
    await ctx.clearCookies();
    await ctx.addCookies(keep);
  });
  setSettings({ linkedin: { connected: false, checkedAt: now() } });
}

function searchUrl(keywords: string, location: string) {
  const q = new URLSearchParams({ keywords, location, f_TPR: 'r604800', sortBy: 'R' });
  return `https://www.linkedin.com/jobs/search/?${q}`;
}

async function collectJobIds(page: Page): Promise<string[]> {
  // The results list lazy-loads; scroll it a few times.
  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => {
      const list = document.querySelector('.jobs-search-results-list, .scaffold-layout__list, .jobs-search__results-list') as HTMLElement | null;
      (list || document.scrollingElement || document.body).scrollBy(0, 1400);
    });
    await humanPause(700, 1400);
  }
  return page.evaluate(() => {
    const ids = new Set<string>();
    document.querySelectorAll<HTMLElement>('[data-job-id], [data-occludable-job-id], [data-entity-urn*="jobPosting"]').forEach(el => {
      const v = el.getAttribute('data-job-id') || el.getAttribute('data-occludable-job-id') || el.getAttribute('data-entity-urn') || '';
      const m = v.match(/(\d{6,})/);
      if (m) ids.add(m[1]);
    });
    document.querySelectorAll<HTMLAnchorElement>('a[href*="/jobs/view/"]').forEach(a => {
      const m = a.href.match(/\/jobs\/view\/(?:[^/?]*-)?(\d{6,})/);
      if (m) ids.add(m[1]);
    });
    return [...ids];
  });
}

interface Extracted {
  title: string;
  company: string;
  location: string;
  html: string;
  easyApply: boolean;
  hasApply: boolean;
}

async function extractJob(page: Page): Promise<Extracted> {
  // "See more" expands the full description on both signed-in and public pages.
  await page.locator('button:has-text("See more"), button.show-more-less-html__button').first().click({ timeout: 2500 }).catch(() => {});
  return page.evaluate(() => {
    const txt = (sel: string) => (document.querySelector(sel)?.textContent || '').replace(/\s+/g, ' ').trim();
    const first = (...sels: string[]) => sels.map(txt).find(Boolean) || '';
    const title = first('.job-details-jobs-unified-top-card__job-title h1', '.jobs-unified-top-card__job-title', 'h1.top-card-layout__title', 'h1');
    const company = first(
      '.job-details-jobs-unified-top-card__company-name a',
      '.job-details-jobs-unified-top-card__company-name',
      '.jobs-unified-top-card__company-name',
      'a.topcard__org-name-link',
      '.topcard__flavor a',
      'a[href*="/company/"]',
    );
    let location = first(
      '.job-details-jobs-unified-top-card__primary-description-container .tvm__text',
      '.job-details-jobs-unified-top-card__tertiary-description-container span',
      '.jobs-unified-top-card__bullet',
      '.topcard__flavor--bullet',
    );
    location = location.split('·')[0].trim();
    const descEl = document.querySelector('#job-details, .jobs-description__content .jobs-box__html-content, .jobs-description__content, .show-more-less-html__markup, .description__text');
    const buttons = [...document.querySelectorAll<HTMLElement>('button, a')].map(b => (b.textContent || '').replace(/\s+/g, ' ').trim());
    return {
      title,
      company,
      location,
      html: descEl ? (descEl as HTMLElement).innerHTML : '',
      easyApply: buttons.some(t => /^Easy Apply/i.test(t)),
      hasApply: buttons.some(t => /^Apply( now| on company website)?$/i.test(t)),
    };
  });
}

/** Click LinkedIn's external "Apply" and capture where it goes (usually the company's ATS). */
async function externalApplyUrl(page: Page): Promise<string | undefined> {
  const btn = page.locator('button.jobs-apply-button, a.jobs-apply-button, button:has-text("Apply"), a:has-text("Apply")').filter({ hasNotText: /Easy Apply/i }).first();
  if (!(await btn.count())) return undefined;
  try {
    const [popup] = await Promise.all([page.context().waitForEvent('page', { timeout: 8000 }), btn.click({ timeout: 4000 })]);
    await popup.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
    const url = popup.url();
    await popup.close().catch(() => {});
    return url && !/linkedin\.com/.test(url) ? url : undefined;
  } catch {
    return undefined;
  }
}

export async function scoutLinkedIn(prefs: Preferences, log: (s: string) => void): Promise<RawJob[]> {
  if (!(await linkedinSignedIn())) {
    setSettings({ linkedin: { ...getSettings().linkedin, connected: false } });
    log('LinkedIn: not signed in — connect it in Settings to search there');
    return [];
  }
  const roles = (prefs.roles.length ? prefs.roles : ['Software Engineer']).slice(0, 3);
  const locations = (prefs.locations.filter(l => !/^remote$/i.test(l)).slice(0, 2) as string[]).concat(prefs.remote !== 'onsite' ? [] : []);
  if (!locations.length) locations.push('Europe');

  const page = await newPage();
  const ids: string[] = [];
  try {
    for (const role of roles) {
      for (const loc of locations) {
        if (ids.length >= MAX_TOTAL) break;
        await page.goto(searchUrl(role, loc), { waitUntil: 'domcontentloaded', timeout: 30000 });
        await humanPause(2500, 4000);
        if (/\/(login|checkpoint|authwall)/.test(page.url())) {
          setSettings({ linkedin: { ...getSettings().linkedin, connected: false } });
          log('LinkedIn: signed out or asked for verification — reconnect it in Settings');
          return [];
        }
        const found = (await collectJobIds(page)).filter(id => !ids.includes(id)).slice(0, MAX_PER_QUERY);
        ids.push(...found);
        log(`LinkedIn "${role}" in ${loc}: ${found.length} postings`);
      }
    }

    const out: RawJob[] = [];
    for (const id of ids.slice(0, MAX_TOTAL)) {
      await humanPause();
      const url = `https://www.linkedin.com/jobs/view/${id}/`;
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await humanPause(1200, 2200);
        const x = await extractJob(page);
        if (!x.title || !x.company) continue;
        let applyUrl: string | undefined;
        if (!x.easyApply && x.hasApply) applyUrl = await externalApplyUrl(page);
        // If it points at a Greenhouse/Lever/Ashby form, use the ATS copy — richer and auto-applicable.
        const ats = applyUrl ? await hydrateFromUrl(applyUrl).catch(() => null) : null;
        if (ats) {
          out.push({ ...ats, tags: [...ats.tags, 'via LinkedIn'] });
          continue;
        }
        const html = cleanHtml(x.html);
        out.push({
          source: 'linkedin',
          sourceId: id,
          url,
          applyUrl: applyUrl || url,
          title: x.title,
          company: x.company,
          location: x.location || 'Unspecified',
          remote: guessRemote(x.location, x.title),
          descriptionHtml: html,
          descriptionText: htmlToText(html),
          tags: x.easyApply ? ['Easy Apply'] : [],
        });
      } catch (err: any) {
        log(`LinkedIn job ${id}: ${err.message.split('\n')[0]}`);
      }
    }
    setSettings({ linkedin: { ...getSettings().linkedin, connected: true, lastScoutAt: now() } });
    return out;
  } finally {
    await page.close().catch(() => {});
  }
}
