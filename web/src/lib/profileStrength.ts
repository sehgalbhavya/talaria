import type { Preferences, Profile } from '@shared/types';

export type StrengthCheck = { id: string; ok: boolean; text: string; section: string };

const words = (s?: string) => (s || '').trim().split(/\s+/).filter(Boolean).length;

/** What would make the AI's resumes and letters better, as a checklist. Each item points at a Profile section. */
export function profileChecks(p: Profile, prefs?: Preferences | null): StrengthCheck[] {
  const story = words(p.story);
  const missing = [!p.email && 'email', !p.phone && 'phone', !p.location && 'location'].filter(Boolean) as string[];
  const bare = p.experience.filter(e => !e.bullets.length).length;
  const bareProjects = p.projects.filter(x => !x.bullets.length).length;
  const age = p.updatedAt ? (Date.now() - Date.parse(p.updatedAt)) / 86_400_000 : 0;
  const checks: (StrengthCheck | false)[] = [
    {
      id: 'story',
      ok: story >= 150,
      text: story >= 150 ? 'Your story has enough detail' : story ? `Your story is ${story} words. Around 150 makes letters personal.` : 'Write your story. Cover letters are built from it.',
      section: 'story',
    },
    { id: 'contact', ok: !missing.length, text: missing.length ? `Add your ${missing.join(', ')}` : 'Contact details complete', section: 'basics' },
    { id: 'summary', ok: Boolean(p.summary?.trim()), text: p.summary?.trim() ? 'Summary written' : 'Add a short summary', section: 'basics' },
    { id: 'links', ok: p.links.some(l => l.url.trim()), text: p.links.some(l => l.url.trim()) ? 'Links added' : 'Add a portfolio, GitHub or LinkedIn link', section: 'basics' },
    {
      id: 'experience',
      ok: p.experience.length > 0 && !bare,
      text: !p.experience.length ? 'Add your experience' : bare ? `${bare} role${bare === 1 ? ' has' : 's have'} no bullet points` : 'Every role has bullet points',
      section: 'experience',
    },
    p.projects.length > 0 && { id: 'projects', ok: !bareProjects, text: bareProjects ? `${bareProjects} project${bareProjects === 1 ? ' has' : 's have'} no bullet points` : 'Every project has bullet points', section: 'projects' },
    { id: 'skills', ok: p.skills.length >= 6, text: p.skills.length >= 6 ? 'Skills listed' : `List at least 6 skills (you have ${p.skills.length})`, section: 'skills' },
    prefs !== undefined && {
      id: 'sponsorship',
      ok: prefs?.needsSponsorship !== undefined,
      text: prefs?.needsSponsorship !== undefined ? 'Visa sponsorship answered' : 'Say whether you need visa sponsorship',
      section: 'answers',
    },
    { id: 'fresh', ok: age < 120, text: age < 120 ? 'Profile is recent' : `Profile last updated ${Math.round(age / 30)} months ago`, section: 'resume' },
  ];
  return checks.filter(Boolean) as StrengthCheck[];
}

export function profileScore(p: Profile, prefs?: Preferences | null) {
  const c = profileChecks(p, prefs);
  return c.length ? Math.round((c.filter(x => x.ok).length / c.length) * 100) : 100;
}
