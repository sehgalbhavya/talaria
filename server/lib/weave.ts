// Keyword layer: after tailoring, before the humanizer. Code works out which of the posting's ATS
// keywords the resume still misses; the AI works in the ones that are true for the candidate, each
// in one line (a skills line, the bullet about that work, or the summary). Code keeps an edit only
// if the keyword is backed by something the candidate wrote themselves, the line still says what
// it said, and nothing factual moved. Keywords that don't fit are remembered and never forced.
import { askJson, isPausedError, type RunHandle } from './ai/index.ts';
import { cleanText, keepsFacts, wordCount, type HumanLine } from './humanize.ts';
import { escapeLoose, noEmDash, plainLatex, similarity, skillKnown, textHasKeyword } from './latexSlots.ts';

const items = (s: string) => s.split(',').map(x => x.trim()).filter(Boolean);
const norm = (s: string) => plainLatex(s).toLowerCase().replace(/[^a-z0-9+#]+/g, ' ').trim();

/** Keywords the lines don't cover, matched the way the keyword meter does (each skill on its own). */
export function missingKeywords(lines: HumanLine[], keywords: string[]): string[] {
  const text = lines.flatMap(l => (l.group === 'skills' ? items(l.text) : [l.text])).map(plainLatex).join('\n');
  return keywords.filter(k => !textHasKeyword(text, k));
}

/** Keywords a skills-line edit adds, or null if it drops an item or adds one that isn't a backed-up missing keyword. */
function skillsGain(orig: string, next: string, missing: string[], known: string): string[] | null {
  const o = items(orig);
  const n = items(next);
  if (o.some(x => !n.some(y => norm(y) === norm(x)))) return null;
  const fresh = n.filter(y => !o.some(x => norm(x) === norm(y)));
  if (!fresh.length || n.length > Math.max(o.length + 3, 12)) return null;
  if (fresh.some(y => !skillKnown(y, known) || !missing.some(k => textHasKeyword(y, k) || textHasKeyword(k, y)))) return null;
  return missing.filter(k => fresh.some(y => textHasKeyword(y, k) || textHasKeyword(k, y)));
}

/** Keywords a bullet or summary edit adds, or null if it says something new, loses a fact, or adds an unbacked keyword. */
function lineGain(orig: string, next: string, group: string, missing: string[], keywords: string[], known: string, latex: boolean): string[] | null {
  const n = wordCount(next);
  const o = wordCount(orig);
  if (n < o * 0.8 || n > Math.max(o * 1.35, o + 8) || n > (group === 'summary' ? 90 : 38)) return null;
  if (!keepsFacts(orig, next, keywords, latex) || similarity(orig, next) < 0.45) return null;
  const gained = missing.filter(k => !textHasKeyword(orig, k) && textHasKeyword(next, k));
  return gained.length && gained.every(k => skillKnown(k, known)) ? gained : null;
}

const WEAVE_PROMPT = (o: { job: string; resume: string; missing: string[]; evidence: string; latex: boolean }) => `You are finishing ONE candidate's resume for the job below. An applicant tracking system will score it on the posting's keywords, and these are still missing: ${o.missing.join(', ')}.

For each missing keyword, decide honestly whether it is TRUE for the candidate, using only the evidence below (what they wrote themselves). Then:
- TRUE: work it into ONE line where it belongs. A tool, method or skill goes into the matching skills line as a new item (keep every item already there). Work they did goes into the bullet that describes that work. Their field or focus goes into the summary. Use the posting's wording so the system matches it.
- NOT TRUE, or only a stretch: list it under "skipped". A claim the candidate can't back up in an interview is worse than a lower score.
- TRUE, but no line has room for it without overstating: list it under "noPlace", never under "skipped".

JOB
${o.job}

THE RESUME NOW (ids in brackets)
${o.resume}

EVIDENCE: WHAT THE CANDIDATE WROTE THEMSELVES (resume, notes, answers)
${o.evidence}

Rules:
1. Edit as few lines as you can and change only what the keyword needs. Keep every fact, number, name and keyword already there. Add no new numbers, results or claims.
2. A bullet stays one sentence of at most 32 words, keeps its meaning and keeps its opening verb.
3. Natural wording: no keyword lists squeezed into a bullet, no em dashes, and no stock words (robust, seamless, end-to-end, leverage, dynamic).${
  o.latex ? '\n4. The lines are LaTeX: keep \\textbf{...} where it is, keep \\& \\% \\$ \\# \\_ escaped, and use no other commands.' : ''
}

Return ONLY JSON: {"lines": {"<id>": "<edited line>", ...}, "skipped": [{"keyword": string, "why": string}], "noPlace": [string]}. Include only lines you changed.`;

export interface WeaveResult {
  texts: Record<string, string>;
  added: string[];
  unfit: string[]; // still missing, and the AI judged them untrue for the candidate
}

/** Work the missing keywords in where they're true. Never fails the tailoring run. */
export async function weaveKeywords(
  lines: HumanLine[],
  ctx: { keywords: string[]; skip?: string[]; job: string; evidence: string; latex: boolean; handle: RunHandle; priority: number; model?: string },
): Promise<WeaveResult> {
  const texts = Object.fromEntries(lines.map(l => [l.id, l.text]));
  const missing = missingKeywords(lines, ctx.keywords).filter(k => !ctx.skip?.includes(k));
  if (!missing.length) return { texts, added: [], unfit: [] };
  const known = ctx.evidence.toLowerCase().replace(/\s+/g, ' ');
  ctx.handle.log(`Keywords: ${missing.length} missing (${missing.join(', ')})`);

  let raw: any;
  try {
    raw = await askJson<any>({
      prompt: WEAVE_PROMPT({
        job: ctx.job,
        resume: lines.map(l => `[${l.id}]${l.group === 'skills' ? ' (skills line)' : ''} ${l.text}`).join('\n'),
        missing,
        evidence: ctx.evidence.slice(0, 9000),
        latex: ctx.latex,
      }),
      handle: ctx.handle,
      priority: ctx.priority,
      timeoutSec: 240,
      model: ctx.model,
    });
  } catch (err: any) {
    if (isPausedError(err)) throw err;
    ctx.handle.log(`Keyword layer skipped: ${err.message}`);
    return { texts, added: [], unfit: [] };
  }

  const added = new Set<string>();
  const proposed = raw?.lines && typeof raw.lines === 'object' ? raw.lines : {};
  for (const l of lines) {
    if (typeof proposed[l.id] !== 'string') continue;
    let next = noEmDash(cleanText(proposed[l.id].trim(), ctx.latex));
    if (ctx.latex) next = escapeLoose(next);
    const open = missing.filter(k => !added.has(k));
    const gain = l.group === 'skills' ? skillsGain(texts[l.id], next, open, known) : lineGain(texts[l.id], next, l.group, open, ctx.keywords, known, ctx.latex);
    if (!gain?.length) continue;
    texts[l.id] = next;
    gain.forEach(k => added.add(k));
  }
  // Only what the AI judged untrue is never offered again; a keyword your own words just don't
  // spell out stays missing, so you can still add it yourself or with a note.
  const skipped = new Set((Array.isArray(raw?.skipped) ? raw.skipped : []).map((x: any) => String(x?.keyword ?? x)));
  const unfit = missing.filter(k => !added.has(k) && skipped.has(k));
  const unbacked = missing.filter(k => !added.has(k) && !skipped.has(k));
  ctx.handle.log(
    `Keywords: worked in ${added.size} of ${missing.length}${unfit.length ? `; ${unfit.join(', ')} don't match your experience` : ''}${unbacked.length ? `; ${unbacked.join(', ')} aren't backed by anything you wrote, so they stay out` : ''}`,
  );
  return { texts, added: [...added], unfit };
}
