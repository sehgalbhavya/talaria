// Two tracks on one board: full-time roles and PhD positions.
import type { Job, WorkKind } from './types.ts';

export type Track = 'job' | 'phd';

/** Titles that are doctoral positions, in English, Swedish and German. */
export const PHD_TITLE = /\b(ph\.?\s?d|doctoral|doctorate|doktorand(in)?|doktorandtjänst|promotionsstelle|promotion(sstudent)?|early[- ]stage researcher|industrial ph\.?d|graduate research(er)?)\b/i;

/** Whether you want jobs at all (full-time or internships), not only PhDs. Unset means yes. */
export const wantsJobs = (p: { lookingFor?: WorkKind[] }) => !p.lookingFor?.length || p.lookingFor.some(k => k !== 'phd');

export const jobTrack =(j: Pick<Job, 'title'> & { track?: Track }): Track => j.track ?? (PHD_TITLE.test(j.title) ? 'phd' : 'job');
