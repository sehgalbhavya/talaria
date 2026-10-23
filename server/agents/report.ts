import type { Job, Report } from '../../shared/types.ts';
import { callHermes, finishRun, startRun } from '../lib/hermes.ts';
import { addReport, getProfile, listJobs, newId, now } from '../lib/store.ts';

export function funnel(jobs: Job[]) {
  const applied = jobs.filter(j => j.appliedAt);
  const responded = applied.filter(j => j.status === 'interviewing' || j.status === 'offer' || (j.status === 'archived' && j.archivedReason === 'rejected'));
  const interviews = applied.filter(j => j.status === 'interviewing' || j.status === 'offer');
  return {
    discovered: jobs.length,
    applied: applied.length,
    responded: responded.length,
    interviews: interviews.length,
    offers: applied.filter(j => j.status === 'offer').length,
    rejected: applied.filter(j => j.status === 'archived' && j.archivedReason === 'rejected').length,
  };
}

const score = (j: Job) => j.analysis?.score ?? j.quick?.score;

export async function generateReport(days = 7): Promise<Report> {
  const h = startRun('summary', `Writing your ${days === 7 ? 'weekly' : `${days}-day`} summary`);
  try {
    const all = listJobs();
    const to = new Date();
    const from = new Date(Date.now() - days * 86400000);
    const inPeriod = all.filter(j => j.appliedAt && Date.parse(j.appliedAt) >= +from);
    const f = funnel(all);
    const lines = inPeriod
      .sort((a, b) => Date.parse(a.appliedAt!) - Date.parse(b.appliedAt!))
      .map(j => `- ${j.appliedAt!.slice(0, 10)} · ${j.title} @ ${j.company} · ${j.location} · fit ${score(j) ?? 'n/a'} · status: ${j.status}${j.analysis?.whyNo?.[0] ? ` · main gap: ${j.analysis.whyNo[0].point}` : ''}`)
      .join('\n');
    const pipeline = ['discovered', 'preparing', 'needs_input', 'applied', 'interviewing', 'offer']
      .map(s => `${s}: ${all.filter(j => j.status === s).length}`)
      .join(', ');
    const profile = getProfile();

    h.log(`Summarising ${inPeriod.length} applications`);
    const res = await callHermes({
      handle: h,
      prompt: `You are a sharp, encouraging job-search coach writing a ${days}-day progress summary for ${profile?.name || 'the candidate'} (${profile?.headline || ''}).

APPLICATIONS SUBMITTED IN THE LAST ${days} DAYS (${inPeriod.length})
${lines || '(none)'}

ALL-TIME FUNNEL
Applied ${f.applied} · heard back ${f.responded} · interviews ${f.interviews} · offers ${f.offers} · rejections ${f.rejected}
Board right now: ${pipeline}

Write the summary in Markdown, 180–320 words, with exactly these sections:
## The short version
(2–3 sentences: volume, quality of fit, momentum)
## What you applied to
(a compact bullet list grouping the applications by theme/company type; mention notable ones by name)
## Patterns worth noticing
(2–4 bullets: recurring gaps, strongest-fit areas, response signals)
## Next moves
(3 concrete, prioritised actions for the coming week)

Be specific and honest; no filler, no emojis. Output only the Markdown.`,
      timeoutSec: 240,
      priority: 1,
    });
    const report: Report = { id: newId(), generatedAt: now(), from: from.toISOString(), to: to.toISOString(), markdown: res.text.replace(/^```(?:markdown)?\s*|\s*```$/g, '').trim() };
    addReport(report);
    finishRun(h, true, `${inPeriod.length} applications summarised`);
    return report;
  } catch (err: any) {
    finishRun(h, false, undefined, err.message);
    throw err;
  }
}
