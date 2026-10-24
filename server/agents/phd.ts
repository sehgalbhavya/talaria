// PhD positions: Hermes searches academic job boards and university pages for open, funded
// doctoral positions in your research fields, judges the fit, and each position is read from its
// own page. They land in Discovered tagged as PhDs, separate from full-time roles.
import type { Job } from '../../shared/types.ts';
import { askJson, finishRun, startRun, type RunHandle } from '../lib/hermes.ts';
import { toast } from '../lib/events.ts';
import { dedupeKey, getPreferences, getProfile, getSettings, hasSeen, insertJob, listJobs, markSeen, newId, now } from '../lib/store.ts';
import { jobTrack } from '../../shared/track.ts';
import { readPosting } from '../sources/companies.ts';
import type { RawJob } from '../sources/index.ts';
import { clamp, profileBrief, str } from './common.ts';
import { splitClosed } from './liveness.ts';

/** A starting point taken from the resume, for when you haven't set fields yet. */
export const DEFAULT_PHD_FIELDS = ['Haptics', 'XR / virtual and augmented reality', 'Automotive HMI', 'Generative UI', 'Human-computer interaction', 'Multisensory interaction'];

const PROMPT = (o: { profile: string; fields: string[]; allFields: string[]; where: string; n: number }) => `You are scouting OPEN, funded PhD positions for one candidate (including industrial PhDs and doctoral researcher roles).

CANDIDATE
${o.profile}

SEARCH NOW FOR THESE FIELDS: ${o.fields.join(', ')} (and topics that are squarely about them).
(Their full list of interests, for judging fit: ${o.allFields.join(', ')}.)
WHERE: ${o.where}

Use web_search with several targeted searches (field + "PhD position" / "doctoral student" / "doktorand" + country). Good places to look:
- EURAXESS (euraxess.ec.europa.eu/jobs), Academic Positions (academicpositions.com), jobs.ac.uk (PhDs and studentships), FindAPhD (findaphd.com), ScholarshipDb
- Varbi, used by Swedish universities (e.g. kth.varbi.com, chalmers.varbi.com, liu.varbi.com, uu.varbi.com, lu.varbi.com)
- university job pages and HCI / haptics / XR / automotive labs (e.g. TU Munich, TU Delft, TU Eindhoven, Aalto, ETH Zurich, EPFL, DTU, KTH, Chalmers, Linköping, Saarland, Stuttgart)
- industrial PhD programmes (e.g. BMW, Volvo, Bosch, Siemens, Ericsson)
Only positions accepting applications now (deadline in the future, or open until filled). Give the OFFICIAL page of the specific position: the university's or lab's own job page, Varbi, EURAXESS or Academic Positions (one position per URL). Avoid copies on aggregator sites (e.g. drjobpro, applykite, researchjobseurope, jooble, mailing-list archives) unless no official page exists.

For each, judge the fit for THIS candidate from 0 to 100, strictly:
- 80 to 100: the research topic is squarely one of their fields AND they meet the requirements.
- 60 to 79: clearly related to their fields (e.g. HCI with a strong XR, haptic or interface angle) or a small requirement gap.
- 40 to 59: loosely related.
- below 40: a different field (e.g. business, operations, pure ML, biology) even if it mentions AI or users. Don't include these.

Return ONLY a JSON array, at most ${o.n} items, best fit first:
[{"title": string, "institution": string, "location": string, "url": string, "deadline": "YYYY-MM-DD or empty", "field": string, "fit": number, "reason": string}]
"reason" is one short line on why it fits or doesn't, no em dashes. If web search is unavailable, return [].`;

const words = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(' ').filter(w => w.length > 2 && !['phd', 'position', 'positions', 'the', 'and', 'for', 'doctoral'].includes(w)));
function titleOverlap(a: string, b: string) {
  const A = words(a);
  const B = words(b);
  if (!A.size || !B.size) return 0;
  let both = 0;
  for (const w of A) if (B.has(w)) both++;
  return both / Math.min(A.size, B.size);
}
const sameInstitution = (a: string, b: string) => {
  const first = (s: string) => s.toLowerCase().replace(/[^a-z ]+/g, ' ').split(' ').filter(w => w.length > 2 && !['university', 'the', 'centre', 'center', 'technical', 'institute'].includes(w))[0] || s.toLowerCase();
  return first(a) === first(b);
};

let running: Promise<{ added: number; found: number }> | null = null;

export function phdSearch(opts: { quiet?: boolean } = {}) {
  if (running) return running;
  running = run(opts).finally(() => (running = null));
  return running;
}

export const phdSearchRunning = () => Boolean(running);

async function run(opts: { quiet?: boolean }): Promise<{ added: number; found: number }> {
  const profile = getProfile();
  if (!profile) throw new Error('Add your resume first.');
  if (!getSettings().hermes.webSearch) throw new Error('Turn on "Let Hermes search the web" in Settings to find PhD positions.');
  const prefs = getPreferences();
  const fields = prefs.phd?.fields?.length ? prefs.phd.fields : DEFAULT_PHD_FIELDS;
  const where = prefs.phd?.countries?.length ? prefs.phd.countries.join(', ') : 'anywhere in Europe';
  const h = startRun('scout', 'PhD search');
  try {
    h.log(`Fields: ${fields.join(', ')} · ${where}`);
    // One focused search per pair of fields, side by side: broader coverage than one search for everything.
    const groups: string[][] = [];
    for (let i = 0; i < fields.length; i += 2) groups.push(fields.slice(i, i + 2));
    const batches = await Promise.all(
      groups.map(g =>
        askJson<any[]>({ prompt: PROMPT({ profile: profileBrief(profile), fields: g, allFields: fields, where, n: 8 }), toolsets: ['web'], handle: h, timeoutSec: 480, priority: 1 })
          .then(r => {
            h.log(`${g.join(' + ')}: ${Array.isArray(r) ? r.length : 0} found`);
            return Array.isArray(r) ? r : [];
          })
          .catch(err => {
            h.log(`${g.join(' + ')}: search failed (${String(err.message).split('\n')[0]})`);
            return [] as any[];
          }),
      ),
    );
    const seenUrls = new Set<string>();
    const list = batches
      .flat()
      .filter(it => /^https?:\/\//.test(str(it?.url, 500)) && clamp(it?.fit) >= 50)
      .filter(it => !seenUrls.has(it.url) && seenUrls.add(it.url))
      .sort((a, b) => clamp(b.fit) - clamp(a.fit));
    h.log(`${list.length} positions found, reading each one`);

    const raws: (RawJob & { fit: number; reason: string })[] = [];
    for (const it of list) {
      const title = str(it.title, 200);
      const institution = str(it.institution, 160);
      if (!title || !institution || hasSeen(dedupeKey(institution, title))) continue;
      const deadline = /^\d{4}-\d{2}-\d{2}$/.test(str(it.deadline, 20)) ? str(it.deadline, 20) : undefined;
      if (deadline && Date.parse(deadline) < Date.now() - 86_400_000) continue;
      const url = str(it.url, 500);
      const read = await readPosting(url, { title, company: institution, location: str(it.location, 200), source: 'academic' }).catch(() => null);
      const summary = str(it.reason, 400);
      raws.push({
        ...(read || {
          source: 'academic' as const,
          sourceId: url,
          url,
          applyUrl: url,
          title,
          company: institution,
          location: str(it.location, 200) || 'Unspecified',
          remote: 'onsite' as const,
          descriptionHtml: `<p>${summary.replace(/</g, '&lt;')}</p><p><em>Open the posting for full details.</em></p>`,
          descriptionText: summary,
          tags: [],
        }),
        title,
        company: institution,
        source: 'academic',
        track: 'phd',
        deadline,
        tags: [str(it.field, 60)].filter(Boolean),
        fit: clamp(it.fit),
        reason: summary,
      });
    }

    const { open, closed } = await splitClosed(raws);
    for (const c of closed) h.log(`Skipped ${c.item.title} @ ${c.item.company}: ${c.reason}`);

    const added: Job[] = [];
    for (const r of open) {
      const key = dedupeKey(r.company, r.title);
      if (hasSeen(key)) continue;
      // The same position found on another site ("Inria" vs "Inria, Centre ...", a " - HCC" suffix).
      const twin = [...listJobs(), ...added].find(j => jobTrack(j) === 'phd' && sameInstitution(j.company, r.company) && titleOverlap(j.title, r.title) >= 0.75);
      if (twin) {
        markSeen(key);
        h.log(`Skipped ${r.title}: already on your board`);
        continue;
      }
      markSeen(key);
      if (r.fit < 55) continue;
      const ts = now();
      const { fit, reason, ...raw } = r;
      const job: Job = {
        ...raw,
        id: newId(),
        status: 'discovered',
        statusChangedAt: ts,
        order: 0,
        quick: { score: fit, reason, at: ts },
        questions: [],
        work: {},
        timeline: [{ at: ts, text: 'Found by the PhD search', kind: 'agent' }],
        notes: '',
        starred: false,
        createdAt: ts,
        updatedAt: ts,
      };
      insertJob(job);
      added.push(job);
    }
    const msg = added.length ? `${added.length} PhD position${added.length === 1 ? '' : 's'} added` : 'No new PhD positions this time';
    finishRun(h, true, `${list.length} found · ${msg}`);
    if (added.length || !opts.quiet) toast(added.length ? 'success' : 'info', msg);
    return { added: added.length, found: list.length };
  } catch (err: any) {
    finishRun(h, false, undefined, err.message);
    throw err;
  }
}
