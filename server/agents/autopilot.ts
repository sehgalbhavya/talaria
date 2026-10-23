import { getProfile, getSettings, listJobs } from '../lib/store.ts';
import { rateLimitedUntil } from '../lib/hermes.ts';
import { getScoutState, runScout } from './scout.ts';
import { analyzeJob, prepareApplication } from './pipeline.ts';

const fitScore = (j: { quick?: { score: number }; analysis?: { score: number } }) => j.analysis?.score ?? j.quick?.score ?? 0;

/** After new jobs land, pre-compute fit analyses (and optionally full applications) for the best ones. */
export async function followUpOnDiscoveries() {
  const ap = getSettings().autopilot;
  const discovered = listJobs()
    .filter(j => j.status === 'discovered' && !j.paused)
    .sort((a, b) => fitScore(b) - fitScore(a));

  // Background analyses are the biggest source of provider load, so keep them few: the top 5
  // new matches per search, and none while the provider has us rate-limited.
  if (rateLimitedUntil()) return;
  let analyzed = 0;
  for (const j of discovered) {
    if (analyzed >= 5) break;
    if (!j.analysis && !j.work.analyze && (j.quick?.score ?? 0) >= ap.autoAnalyzeAbove) {
      analyzeJob(j.id).catch(() => {});
      analyzed++;
    }
  }
  if (ap.enabled && ap.autoPrepareAbove != null) {
    let n = 0;
    for (const j of discovered) {
      if (n >= ap.maxPreparePerRun) break;
      if (fitScore(j) >= ap.autoPrepareAbove && !j.work.tailor) {
        prepareApplication(j.id, { priority: 0 }).catch(() => {});
        n++;
      }
    }
  }
}

let timer: NodeJS.Timeout | null = null;

export function startAutopilot() {
  if (timer) return;
  const tick = async () => {
    const s = getSettings();
    if (!s.autopilot.enabled || !getProfile() || getScoutState().running || rateLimitedUntil()) return;
    const last = s.autopilot.lastScoutAt ? Date.parse(s.autopilot.lastScoutAt) : 0;
    if (Date.now() - last < s.autopilot.scoutEveryHours * 3600_000) return;
    try {
      await runScout();
      await followUpOnDiscoveries();
    } catch (err) {
      console.error('[autopilot] scout failed', err);
    }
  };
  timer = setInterval(tick, 5 * 60_000);
  setTimeout(tick, 30_000);
}
