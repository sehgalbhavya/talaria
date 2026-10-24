import fs from 'node:fs';
import path from 'node:path';
import type { Preferences, Profile, Seniority } from '../../shared/types.ts';
import { askJson, finishRun, startRun } from '../lib/hermes.ts';
import { getPreferences, getProfile, getSettings, setPreferences, setProfile } from '../lib/store.ts';
import { clamp, oneOf, str, strArr } from './common.ts';

export async function extractResumeText(filePath: string, originalName: string): Promise<string> {
  const ext = path.extname(originalName).toLowerCase();
  const buf = fs.readFileSync(filePath);
  if (ext === '.pdf') {
    const { extractText, getDocumentProxy } = await import('unpdf');
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { text } = await extractText(pdf, { mergePages: true });
    return normalizeResumeText(Array.isArray(text) ? text.join('\n') : text);
  }
  if (ext === '.docx') {
    const mammoth = await import('mammoth');
    const { value } = await mammoth.extractRawText({ buffer: buf });
    return normalizeResumeText(value);
  }
  if (['.txt', '.md', '.markdown', '.text'].includes(ext)) return normalizeResumeText(buf.toString('utf8'));
  throw new Error(`Unsupported file type "${ext}". Upload a PDF, DOCX or TXT resume.`);
}

function normalizeResumeText(t: string) {
  return t
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const PROFILE_PROMPT = (resume: string) => `You are the profile-builder for a job-search assistant. Parse the candidate's resume below into structured JSON.

Return ONLY a JSON object with exactly these keys:
{
  "name": string, "email": string, "phone": string, "location": string,
  "headline": string,            // a crisp 6–12 word professional headline based on the resume
  "summary": string,             // 2–3 sentence professional summary in first person-free resume voice
  "links": [{"label": string, "url": string}],   // LinkedIn, GitHub, portfolio, etc. Full URLs.
  "yearsExperience": number,     // professional (non-intern) years, best estimate, 0 if student
  "skills": [string],            // de-duplicated, most important first, max 40
  "experience": [{"company": string, "title": string, "location": string, "start": string, "end": string, "bullets": [string]}],
  "projects": [{"name": string, "link": string, "tech": [string], "bullets": [string]}],
  "education": [{"school": string, "degree": string, "field": string, "start": string, "end": string, "details": string}],
  "extras": [{"label": string, "items": [string]}],  // certifications, awards, publications, languages, leadership, etc.
  "suggested": {
    "roles": [string],           // 3–5 job titles this person should target, most realistic first
    "seniority": [string],       // subset of: intern, entry, mid, senior, lead
    "locations": [string],       // cities/countries implied by the resume
    "remote": string,            // one of: remote_only, remote_or_hybrid, any, onsite
    "includeKeywords": [string]  // 3–8 domains/technologies they'd likely want
  }
}

Rules:
- Copy bullets faithfully (you may fix obvious typos). Do not invent anything. Use "" or [] for missing values.
- Dates as written on the resume (e.g. "Jun 2023", "2021"); use "Present" for current roles.

RESUME:
"""
${resume.slice(0, 20000)}
"""`;

export async function buildProfileFromResume(resumeText: string, fileName?: string, latexSource?: string): Promise<{ profile: Profile; preferences: Preferences }> {
  const h = startRun('profile', 'Reading your resume');
  try {
    h.log('Parsing resume into a structured profile');
    const raw = await askJson<any>({ prompt: PROFILE_PROMPT(resumeText), handle: h, timeoutSec: 300, priority: 2 });
    const profile: Profile = {
      name: str(raw.name, 120),
      email: str(raw.email, 200),
      phone: str(raw.phone, 60),
      location: str(raw.location, 160),
      headline: str(raw.headline, 200),
      summary: str(raw.summary, 1500),
      links: Array.isArray(raw.links) ? raw.links.map((l: any) => ({ label: str(l?.label, 40) || 'Link', url: str(l?.url, 300) })).filter((l: any) => l.url) : [],
      yearsExperience: raw.yearsExperience != null ? clamp(raw.yearsExperience, 0, 60) : undefined,
      skills: strArr(raw.skills, 60, 60),
      experience: (Array.isArray(raw.experience) ? raw.experience : []).map((e: any) => ({
        company: str(e?.company, 160),
        title: str(e?.title, 160),
        location: str(e?.location, 120),
        start: str(e?.start, 40),
        end: str(e?.end, 40),
        bullets: strArr(e?.bullets, 12, 500),
      })),
      projects: (Array.isArray(raw.projects) ? raw.projects : []).map((p: any) => ({
        name: str(p?.name, 160),
        link: str(p?.link, 300),
        tech: strArr(p?.tech, 15, 40),
        bullets: strArr(p?.bullets, 8, 500),
      })),
      education: (Array.isArray(raw.education) ? raw.education : []).map((e: any) => ({
        school: str(e?.school, 200),
        degree: str(e?.degree, 160),
        field: str(e?.field, 160),
        start: str(e?.start, 40),
        end: str(e?.end, 40),
        details: str(e?.details, 400),
      })),
      extras: (Array.isArray(raw.extras) ? raw.extras : []).map((x: any) => ({ label: str(x?.label, 60), items: strArr(x?.items, 15, 300) })).filter((x: any) => x.label && x.items.length),
      resumeText,
      resumeFileName: fileName,
      latexSource,
    };
    const s = raw.suggested || {};
    const current = getPreferences();
    // During onboarding you may have answered these while Hermes was still reading: yours win.
    const confirmed = new Set(getSettings().onboarding?.confirmedPrefs || []);
    const seniority = strArr(s.seniority, 5).map(x => x.toLowerCase()).filter((x): x is Seniority => ['intern', 'entry', 'mid', 'senior', 'lead'].includes(x));
    const suggested: Partial<Preferences> = {
      roles: current.roles.length ? current.roles : strArr(s.roles, 6, 80),
      seniority: seniority.length ? seniority : current.seniority,
      locations: current.locations.length ? current.locations : strArr(s.locations, 6, 80),
      remote: oneOf(s.remote, ['remote_only', 'remote_or_hybrid', 'any', 'onsite'] as const, current.remote),
      includeKeywords: current.includeKeywords.length ? current.includeKeywords : strArr(s.includeKeywords, 8, 40),
    };
    for (const key of confirmed) delete suggested[key];
    const preferences = setPreferences(suggested);
    // Your story is yours, not the resume's: it survives replacing the resume.
    const story = getProfile()?.story;
    if (story) profile.story = story;
    setProfile(profile);
    finishRun(h, true, `${profile.experience.length} roles · ${profile.skills.length} skills`);
    return { profile, preferences };
  } catch (err: any) {
    finishRun(h, false, undefined, err.message);
    throw err;
  }
}
