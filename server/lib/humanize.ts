// Humanizer: the last pass over a tailored resume, before it becomes a PDF. Code finds what makes
// writing read as machine-made (stock AI vocabulary, tacked-on "-ing" clauses, the same opening
// verb again and again, typographic leftovers); the AI rewrites only the lines that have them,
// and code keeps a rewrite only if every number, name and job keyword survives and it reads
// cleaner than before. Strong action verbs and the candidate's own metaphors are left alone.
import { askJson, isPausedError, type RunHandle } from './ai/index.ts';
import { bracesOk, escapeLoose, noEmDash, plainLatex, textHasKeyword } from './latexSlots.ts';

/** Invisible characters, curly quotes, ellipses and odd spaces: typographic traces of generated text. */
export function cleanText(s: string, latex = false): string {
  if (!s) return s;
  return s
    .replace(/[​-‍⁠﻿­]/g, '')
    .replace(/[    ]/g, ' ')
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“‟″]/g, latex ? '``' : '"')
    .replace(/”/g, latex ? "''" : '"')
    .replace(/…/g, '...')
    .replace(/(\S) {2,}(?=\S)/g, '$1 ');
}

// Words and phrases detectors and recruiters key on. Action verbs people really use (Led,
// Spearheaded, Streamlined, Shipped) aren't here.
const JARGON: RegExp[] = [
  /\bend[\s-]to[\s-]end\b/i,
  /\brobust(ly)?\b/i,
  /\bseamless(ly)?\b/i,
  /\bcutting[\s-]edge\b/i,
  /\bstate[\s-]of[\s-]the[\s-]art\b/i,
  /\bleverag(e|ed|es|ing)\b/i,
  /\butili[sz](e|ed|es|ing|ation)\b/i,
  /\bsynerg\w*/i,
  /\bholistic(ally)?\b/i,
  /\bdynamic\b/i,
  /\bfast[\s-]paced\b/i,
  /\bever[\s-](evolving|changing)\b/i,
  /\blandscape\b/i,
  /\brealm\b/i,
  /\btapestry\b/i,
  /\bdelv(e|ed|es|ing)\b/i,
  /\bpivotal\b/i,
  /\bcrucial\b/i,
  /\bvital\b/i,
  /\bintricate\b/i,
  /\bmultifaceted\b/i,
  /\bmyriad\b/i,
  /\bplethora\b/i,
  /\bmeticulous(ly)?\b/i,
  /\bpassionate\b/i,
  /\bresults[\s-]driven\b/i,
  /\bdetail[\s-]oriented\b/i,
  /\btrack record\b/i,
  /\b(best|world)[\s-]in[\s-]class\b|\bworld[\s-]class\b/i,
  /\bgame[\s-]chang\w*/i,
  /\btransformative\b/i,
  /\bimpactful\b/i,
  /\bhigh[\s-]impact\b/i,
  /\bactionable insights?\b/i,
  /\bdeep[\s-]dive\b/i,
  /\bat the intersection of\b/i,
  /\btestament to\b/i,
  /\bshowcas(e|ed|es|ing)\b/i,
  /\bunderscor(e|ed|es|ing)\b/i,
  /\bfoster(ed|s|ing)?\b/i,
  /\bempower(ed|s|ing|ment)?\b/i,
  /\bharness(ed|es|ing)?\b/i,
  /\belevat(e|ed|es|ing)\b/i,
  /\bunlock(ed|s|ing)?\b/i,
  /\bin today's\b/i,
  /\bnavigat(e|ed|ing) (the )?complexit/i,
  /\ba (wide|broad|diverse) (range|array|variety) of\b/i,
  /\binnovative\b/i,
  /\bcomprehensive\b/i,
  /\bmeaningful\b/i,
  /\bthriv(e|ed|es|ing)\b/i,
  /\bnot only\b[^.]*\bbut also\b/i,
];

// "-ing" words that aren't a tacked-on participle after a comma.
const NOT_PARTICIPLE = new Set('including during according regarding concerning following notwithstanding thing nothing something everything anything string spring bring ring king sing wing sibling morning evening ceiling'.split(' '));
// ", ensuring …", ", enabling …", ", and reducing …": the clause AI adds to the end of a sentence.
const TRAILING_ING = /,\s+(?:and\s+|while\s+|thereby\s+|thus\s+)?(?:[a-z]+ly\s+)?([a-z]+ing)\s+(?!and\b|or\b)[a-z0-9$\\]/g;

const MAX_SAME_OPENER = 2;
const MAX_ING_PER_ROLE = 1;

export interface HumanLine {
  id: string;
  group: string; // the role (or "summary") the line belongs to
  text: string;
}

function trailingIng(plain: string): string | null {
  for (const m of plain.matchAll(TRAILING_ING)) if (!NOT_PARTICIPLE.has(m[1])) return m[1];
  return null;
}

/** Tells in one line on its own: stock words (unless the job itself uses them) and a trailing "-ing" clause. */
function lineTells(text: string, keywords: string[]): string[] {
  const plain = plainLatex(text);
  const kw = keywords.join(' | ').toLowerCase();
  const out: string[] = [];
  for (const re of JARGON) {
    const m = plain.match(re);
    if (m && !kw.includes(m[0].toLowerCase())) out.push(`stock AI wording: "${m[0]}"`);
  }
  const ing = trailingIng(plain);
  if (ing) out.push(`ends on a tacked-on "-ing" clause (", ${ing} …")`);
  return out;
}

// The opening verb, with its pair when there is one ("Designed and built" is its own opener).
const opener = (text: string) => {
  const m = plainLatex(text).match(/^(\S+)(\s+and\s+[a-z]+)?/);
  if (!m || /:$/.test(m[1])) return '';
  return m[1].replace(/[^A-Za-z-]/g, '') + (m[2] || '').replace(/\s+/g, ' ');
};
// Verbs that say less than the one they'd replace.
const VAGUE = new Set(['made', 'created', 'worked', 'did', 'helped', 'handled', 'used', 'was']);
const vague = (text: string) => VAGUE.has(opener(text).split(' ')[0].toLowerCase());

/** Every line that reads machine-made, with the reasons. Allows one trailing "-ing" per role and each opening verb twice. */
export function findTells(lines: HumanLine[], keywords: string[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const add = (id: string, why: string) => out.set(id, [...(out.get(id) || []), why]);
  const ingSeen: Record<string, number> = {};
  const openers: Record<string, number> = {};
  for (const l of lines) {
    for (const why of lineTells(l.text, keywords)) {
      if (why.startsWith('ends on') && (ingSeen[l.group] = (ingSeen[l.group] || 0) + 1) <= MAX_ING_PER_ROLE) continue;
      add(l.id, why);
    }
    if (l.group === 'summary') continue;
    const o = opener(l.text);
    if (o && (openers[o] = (openers[o] || 0) + 1) > MAX_SAME_OPENER) add(l.id, `opens with "${o}" like ${MAX_SAME_OPENER} earlier bullets`);
  }
  return out;
}

const numbers = (s: string): string[] => plainLatex(s).match(/\d+(?:[.,]\d+)?/g) || [];
// Names, tools and acronyms mid-sentence (BMW, Kotlin, Jetpack Compose): the specifics a rewrite must keep.
const names = (s: string) => plainLatex(s).split(/\s+/).slice(1).map(w => w.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9+#]+$/g, '')).filter(w => /^[A-Z0-9]/.test(w) && /[A-Za-z]/.test(w) && w.length > 1);
export const wordCount = (s: string) => plainLatex(s).split(/\s+/).filter(Boolean).length;

/** Nothing factual moved: every number, name and job keyword of the original is still there, and the LaTeX stays valid. */
export function keepsFacts(orig: string, next: string, keywords: string[], latex: boolean): boolean {
  if (!next.trim()) return false;
  const plain = plainLatex(next);
  if (numbers(orig).some(x => !numbers(next).includes(x)) || numbers(next).some(x => !numbers(orig).includes(x))) return false;
  if (names(orig).some(w => !new RegExp(`(^|[^A-Za-z0-9])${w.replace(/[+#.]/g, '\\$&')}([^A-Za-z0-9]|$)`).test(plain))) return false;
  if (keywords.some(k => textHasKeyword(orig, k) && !textHasKeyword(next, k))) return false;
  if (latex) {
    if (!bracesOk(next)) return false;
    if (/\\(?!textbf\{|[&%$#_{}])[a-zA-Z]+/.test(next)) return false;
    if ((next.match(/\\textbf\{/g) || []).length > Math.max(1, (orig.match(/\\textbf\{/g) || []).length)) return false;
  }
  return true;
}

/** A rewrite is kept only if nothing factual moved and it has fewer tells than the line it replaces. */
function acceptable(orig: string, next: string, group: string, keywords: string[], latex: boolean, openerFlagged: boolean): boolean {
  const n = wordCount(next);
  const o = wordCount(orig);
  if (n < o * 0.6 || n > Math.max(o * 1.3, o + 4) || n > (group === 'summary' ? 85 : 36)) return false;
  if (!keepsFacts(orig, next, keywords, latex)) return false;
  if (vague(next) && !vague(orig)) return false;
  const sameOpener = openerFlagged && opener(orig) === opener(next);
  return lineTells(next, keywords).length + (sameOpener ? 1 : 0) < lineTells(orig, keywords).length + (openerFlagged ? 1 : 0);
}

const HUMANIZE_PROMPT = (o: { resume: string; flagged: string; voice: string; keywords: string[]; usedOpeners: string[]; latex: boolean }) => `You are the last editor on ONE candidate's resume before it is sent. It was drafted with AI help, and the lines flagged below read machine-made. Rewrite ONLY those lines so they read like the candidate wrote them: plain, specific and varied.

THE WHOLE RESUME (context; ids in brackets)
${o.resume}

LINES TO REWRITE, and what gives each one away
${o.flagged}
${o.voice ? `\nHOW THE CANDIDATE WRITES (their own words: match the tone, not the content)\n${o.voice}\n` : ''}
Rules:
1. Same facts. Keep every fact, number, name, tool and claim; add nothing and drop nothing that matters.${o.keywords.length ? ` These job keywords must stay wherever a line already has them: ${o.keywords.join(', ')}.` : ''}
2. Fix exactly what is listed:
   - Stock AI wording: use the plain word a person would write, or cut it if it adds nothing ("robust" → say what made it reliable, or drop it).
   - A tacked-on "-ing" clause: restructure the sentence (fold it into the main clause, or use "with", "so", "by" or "to"); never swap it for another "-ing" ending.
   - A repeated opening verb: open with a different verb that is just as precise for the work.${o.usedOpeners.length ? ` Avoid these, already used: ${o.usedOpeners.join(', ')}.` : ''} Never trade down to a vaguer verb (Made, Created, Worked, Helped), and if the line was about designing AND building, say both in other words ("Prototyped and shipped", "Took ... from design to release").
3. Keep what is good: strong action verbs (Led, Spearheaded, Shipped), metaphors and the candidate's own turns of phrase stay. Don't flatten a line into something generic.
4. Correct English with no typos. Don't over-polish: no groups of three for rhythm, no "not only... but also", vary how sentences are built.
5. Each line stays about the same length (within 20%), one sentence per bullet, at most 32 words. Never use em dashes.${
  o.latex ? ' The lines are LaTeX: keep \\textbf{...} where it is (at most one per line), keep \\& \\% \\$ \\# \\_ escaped, and use no other commands.' : ''
}

Return ONLY JSON: {"lines": {"<id>": "<rewritten line>", ...}} with exactly the flagged ids.`;

export interface HumanizeResult {
  texts: Record<string, string>;
  flagged: number;
  rewritten: number;
}

/** Clean every line; rewrite the ones that still read machine-made. Never fails the tailoring run. */
export async function humanizeLines(lines: HumanLine[], ctx: { keywords: string[]; voice?: string; latex: boolean; handle: RunHandle; priority: number; model?: string }): Promise<HumanizeResult> {
  const texts = Object.fromEntries(lines.map(l => [l.id, cleanText(l.text, ctx.latex)]));
  const current = lines.map(l => ({ ...l, text: texts[l.id] }));
  const tells = findTells(current, ctx.keywords);
  if (!tells.size) return { texts, flagged: 0, rewritten: 0 };
  ctx.handle.log(`Humanizer: ${tells.size} line(s) read machine-made`);

  const openerCount: Record<string, number> = {};
  for (const l of current) if (l.group !== 'summary' && opener(l.text)) openerCount[opener(l.text)] = (openerCount[opener(l.text)] || 0) + 1;
  let raw: any;
  try {
    raw = await askJson<any>({
      prompt: HUMANIZE_PROMPT({
        resume: current.map(l => `[${l.id}] ${l.text}`).join('\n'),
        flagged: [...tells].map(([id, why]) => `[${id}] ${texts[id]}\n${why.map(w => `   - ${w}`).join('\n')}`).join('\n'),
        voice: (ctx.voice || '').trim().slice(0, 1500),
        keywords: ctx.keywords,
        usedOpeners: Object.entries(openerCount).filter(([, n]) => n >= MAX_SAME_OPENER).map(([w]) => w),
        latex: ctx.latex,
      }),
      handle: ctx.handle,
      priority: ctx.priority,
      timeoutSec: 240,
      model: ctx.model,
    });
  } catch (err: any) {
    if (isPausedError(err)) throw err;
    ctx.handle.log(`Humanizer skipped: ${err.message}`);
    return { texts, flagged: tells.size, rewritten: 0 };
  }

  let rewritten = 0;
  const proposed = raw?.lines && typeof raw.lines === 'object' ? raw.lines : {};
  for (const l of current) {
    if (!tells.has(l.id) || typeof proposed[l.id] !== 'string') continue;
    let next = noEmDash(cleanText(proposed[l.id].trim(), ctx.latex));
    if (ctx.latex) next = escapeLoose(next);
    if (!acceptable(l.text, next, l.group, ctx.keywords, ctx.latex, tells.get(l.id)!.some(w => w.startsWith('opens with')))) continue;
    // A new opening verb mustn't become the next one that's used too often.
    const [was, now] = [opener(l.text), opener(next)];
    if (l.group !== 'summary' && now !== was) {
      if (now && (openerCount[now] || 0) >= MAX_SAME_OPENER) continue;
      if (was) openerCount[was]--;
      if (now) openerCount[now] = (openerCount[now] || 0) + 1;
    }
    texts[l.id] = next;
    rewritten++;
  }
  ctx.handle.log(`Humanizer: reworded ${rewritten} of ${tells.size} (the rest kept, since a rewrite would have changed a fact or read no better)`);
  return { texts, flagged: tells.size, rewritten };
}
