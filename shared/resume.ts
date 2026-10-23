// Which resume a draft was tailored from, so drafts made from an older one can be refreshed.
import type { Job, Profile } from './types.ts';

/** A short, stable fingerprint of the resume the drafts are built from (FNV-1a). */
export function resumeHash(profile: Pick<Profile, 'latexSource' | 'resumeText'> | null | undefined): string {
  const src = profile?.latexSource?.trim() || profile?.resumeText?.trim() || '';
  let h = 0x811c9dc5;
  for (let i = 0; i < src.length; i++) {
    h ^= src.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** True when the job's draft was tailored from a different resume than the current one. */
export function isStaleDraft(job: Pick<Job, 'packet'>, profile: Profile | null | undefined, hash = resumeHash(profile)): boolean {
  const p = job.packet;
  if (!p || !profile) return false;
  if (p.resumeHash) return p.resumeHash !== hash;
  // Drafts from before hashes were recorded: stale only if the profile changed after them.
  return Boolean(profile.updatedAt && profile.updatedAt > p.generatedAt);
}
