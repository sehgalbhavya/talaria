import type { Job, Preferences, Profile } from '../../shared/types.ts';
import { truncate } from '../lib/text.ts';
import { jobTrack } from '../../shared/track.ts';

export const RULES_NO_FABRICATION = `Hard rules:
- Never invent employers, job titles, dates, degrees, certifications, metrics or skills the candidate does not have.
- You may rephrase, reorder, merge, trim and emphasise facts that ARE in the candidate's background.
- Keep every number attached to the exact achievement it came from; never move a metric onto another bullet.
- Never make a bullet vaguer: keep concrete specifics (numbers, participants, tools, scope). Prefer light edits of the original wording over rewrites; only rephrase to surface what this job cares about.
- Don't add context the source doesn't state (geography like "European markets", team setup like "cross-functional", audiences or methods) just to echo the job posting.
- Don't add colour the source doesn't support (e.g. "high-frequency", "large-scale", "mission-critical", "led").
- If something important is unknown, say so instead of guessing.`;

export function profileBrief(p: Profile, opts: { bullets?: number } = {}): string {
  const nb = opts.bullets ?? 3;
  const lines: string[] = [];
  lines.push(`Name: ${p.name || 'Unknown'}`);
  if (p.headline) lines.push(`Headline: ${p.headline}`);
  if (p.location) lines.push(`Location: ${p.location}`);
  if (p.links?.length) lines.push(`Links (public, on the resume): ${p.links.map(l => `${l.label} ${l.url}`).join(' · ')}`);
  if (p.yearsExperience != null) lines.push(`Years of experience: ${p.yearsExperience}`);
  if (p.summary) lines.push(`Summary: ${truncate(p.summary, 600)}`);
  if (p.skills?.length) lines.push(`Skills: ${p.skills.slice(0, 60).join(', ')}`);
  if (p.experience?.length) {
    lines.push('Experience:');
    for (const e of p.experience.slice(0, 8)) {
      lines.push(`- ${e.title} @ ${e.company} (${[e.start, e.end].filter(Boolean).join(' – ') || 'dates n/a'})`);
      for (const b of e.bullets.slice(0, nb)) lines.push(`  • ${truncate(b, 220)}`);
    }
  }
  if (p.projects?.length) {
    lines.push('Projects:');
    for (const pr of p.projects.slice(0, 6)) {
      lines.push(`- ${pr.name}${pr.tech?.length ? ` [${pr.tech.join(', ')}]` : ''}`);
      for (const b of pr.bullets.slice(0, Math.min(nb, 2))) lines.push(`  • ${truncate(b, 200)}`);
    }
  }
  if (p.education?.length) {
    lines.push('Education:');
    for (const ed of p.education.slice(0, 4)) {
      lines.push(`- ${[ed.degree, ed.field].filter(Boolean).join(', ')} — ${ed.school}${ed.end ? ` (${ed.end})` : ''}${ed.details ? `; ${truncate(ed.details, 160)}` : ''}`);
    }
  }
  for (const x of p.extras || []) if (x.items.length) lines.push(`${x.label}: ${x.items.slice(0, 10).join('; ')}`);
  return lines.join('\n');
}

export function preferencesBrief(prefs: Preferences): string {
  const remote = {
    remote_only: 'Remote only',
    remote_or_hybrid: 'Remote or hybrid',
    any: 'Remote, hybrid or on-site',
    onsite: 'On-site preferred',
  }[prefs.remote];
  return [
    `Target roles: ${prefs.roles.join(', ') || 'not specified'}`,
    `Seniority: ${prefs.seniority.join(', ') || 'any'}`,
    `Preferred locations: ${prefs.locations.join(', ') || 'any'}`,
    `Work mode: ${remote}`,
    prefs.minSalary ? `Minimum salary: ${prefs.minSalary} ${prefs.currency || ''}` : '',
    prefs.needsSponsorship != null ? `Needs visa sponsorship: ${prefs.needsSponsorship ? 'yes' : 'no'}` : '',
    prefs.includeKeywords.length ? `Interested in: ${prefs.includeKeywords.join(', ')}` : '',
    prefs.excludeKeywords.length ? `Avoid: ${prefs.excludeKeywords.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function jobBrief(job: Job, maxDesc = 9000): string {
  return [
    jobTrack(job) === 'phd' ? 'POSITION TYPE: PhD / doctoral research position (an academic application, not a regular job)' : '',
    `Title: ${job.title}`,
    `Company: ${job.company}`,
    `Location: ${job.location} (${job.remote})`,
    job.employmentType ? `Type: ${job.employmentType}` : '',
    job.salary ? `Salary: ${job.salary}` : '',
    job.postedAt ? `Posted: ${job.postedAt.slice(0, 10)}` : '',
    job.deadline ? `Application deadline: ${job.deadline}` : '',
    '',
    'Description:',
    truncate(job.descriptionText || '(no description available)', maxDesc),
  ]
    .filter(l => l !== null)
    .join('\n');
}

// ----- tolerant normalisers -----

export const str = (v: unknown, max = 4000): string => (typeof v === 'string' ? v.trim().slice(0, max) : v == null ? '' : String(v).slice(0, max));
export const strArr = (v: unknown, maxItems = 50, maxLen = 400): string[] =>
  Array.isArray(v) ? v.map(x => str(typeof x === 'object' && x ? (x as any).name ?? (x as any).text ?? JSON.stringify(x) : x, maxLen)).filter(Boolean).slice(0, maxItems) : [];
export const clamp = (n: unknown, lo = 0, hi = 100) => {
  const x = typeof n === 'number' ? n : parseFloat(String(n));
  return isFinite(x) ? Math.max(lo, Math.min(hi, Math.round(x))) : lo;
};
export const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(String(v).toLowerCase() as T) ? (String(v).toLowerCase() as T) : fallback;
