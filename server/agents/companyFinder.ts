// Adding companies to watch: from a name or a careers link, and Hermes's suggestions of employers
// that hire for your roles where you want to work.
import type { TargetCompany } from '../../shared/types.ts';
import { askJson, finishRun, startRun } from '../lib/hermes.ts';
import { getPreferences, getProfile } from '../lib/store.ts';
import { detectCompany, PLATFORM_LABEL } from '../sources/companies.ts';
import { preferencesBrief, profileBrief, str } from './common.ts';

export interface AddedCompany {
  company: TargetCompany;
  count: number;
  platform: string;
}

/** A name or a link → a company Talaria can read, with how many jobs it has open right now. */
export async function resolveCompany(input: string, name?: string): Promise<AddedCompany> {
  const prefs = getPreferences();
  const text = input.trim();
  const looksLikeUrl = /^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$)/i.test(text) && !/\s/.test(text);
  let r: { company: TargetCompany; count: number };
  if (looksLikeUrl) r = await detectCompany({ url: text, name }, prefs);
  else {
    try {
      r = await detectCompany({ name: text }, prefs);
    } catch (err: any) {
      if (err.message !== 'NEEDS_URL') throw err;
      // Not on a platform with a guessable address: have Hermes find their careers site.
      const h = startRun('hermes_web', `Finding ${text}'s careers site`);
      try {
        const got = await askJson<any>({
          prompt: `Use web_search to find the official careers page of the company "${text}": the page on their own website (or their hiring platform) that lists their open jobs. Prefer a page for ${getPreferences().locations[0] || 'their main country'} if they have country sites.
Return ONLY JSON: {"url": string, "company": string}. If you can't find it, return {"url": ""}.`,
          toolsets: ['web'],
          handle: h,
          priority: 2,
          timeoutSec: 240,
        });
        const url = str(got?.url, 500);
        if (!/^https?:\/\//.test(url)) throw new Error(`Couldn't find ${text}'s careers site. Paste the link to their jobs page instead.`);
        h.log(url);
        r = await detectCompany({ url, name: str(got?.company, 120) || text }, prefs);
        finishRun(h, true, `${r.company.name}: ${PLATFORM_LABEL[r.company.ats]}`);
      } catch (e: any) {
        finishRun(h, false, undefined, e.message);
        throw e;
      }
    }
  }
  return { ...r, platform: PLATFORM_LABEL[r.company.ats] };
}

export interface CompanySuggestion {
  name: string;
  url: string;
  why: string;
}

/** Employers worth watching for your roles and locations, beyond the ones you already have. */
export async function suggestCompanies(): Promise<CompanySuggestion[]> {
  const prefs = getPreferences();
  const profile = getProfile();
  const h = startRun('hermes_web', 'Suggesting companies to watch');
  try {
    const raw = await askJson<any>({
      prompt: `You help a job seeker decide which companies to watch for openings. Use web_search to find 10 employers that regularly hire for the candidate's target roles in their preferred locations: a mix of large companies (which often run their own careers websites), established tech companies and strong scale-ups. Include companies that are hiring for these roles right now where you can tell.

CANDIDATE
${profile ? profileBrief(profile, { bullets: 1 }) : '(no resume yet)'}

PREFERENCES
${preferencesBrief(prefs)}

ALREADY WATCHED (don't repeat): ${prefs.targetCompanies.map(c => c.name).join(', ') || 'none'}

Return ONLY JSON: {"companies": [{"name": string, "url": string, "why": string}]}
"url" = the company's careers page that lists open jobs (their own site or their hiring platform). "why" = one short sentence on why it fits this candidate, no em dashes.`,
      toolsets: ['web'],
      handle: h,
      priority: 2,
      timeoutSec: 360,
    });
    const have = new Set(prefs.targetCompanies.map(c => c.name.toLowerCase()));
    const out = (Array.isArray(raw?.companies) ? raw.companies : [])
      .map((c: any) => ({ name: str(c?.name, 120), url: str(c?.url, 500), why: str(c?.why, 240).replace(/—/g, ',') }))
      .filter((c: CompanySuggestion) => c.name && /^https?:\/\//.test(c.url) && !have.has(c.name.toLowerCase()))
      .slice(0, 10);
    finishRun(h, true, `${out.length} suggestions`);
    return out;
  } catch (err: any) {
    finishRun(h, false, undefined, err.message);
    throw err;
  }
}
