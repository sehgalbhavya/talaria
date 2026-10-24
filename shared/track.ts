// Two tracks on one board: full-time roles and PhD positions.
import type { Job } from './types.ts';

export type Track = 'job' | 'phd';

/** Titles that are doctoral positions, in English, Swedish and German. */
export const PHD_TITLE = /\b(ph\.?\s?d|doctoral|doctorate|doktorand(in)?|doktorandtjänst|promotionsstelle|promotion(sstudent)?|early[- ]stage researcher|industrial ph\.?d|graduate research(er)?)\b/i;

export const jobTrack = (j: Pick<Job, 'title'> & { track?: Track }): Track => j.track ?? (PHD_TITLE.test(j.title) ? 'phd' : 'job');
