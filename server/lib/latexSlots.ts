// Slot-based LaTeX tailoring. Instead of letting the model rewrite the whole document body
// (which can silently drop sections), we locate the editable text "slots" in the user's own
// template — summary paragraph, each skills line, each role's bullet list — and splice new text
// into exactly those spans. Everything else (header, layout, macros, section order) is untouched.

export interface SkillSlot {
  id: string;
  label: string;
  items: string;
  start: number; // span of the items group's inner text
  end: number;
}

export interface RoleSlot {
  id: string;
  kind: 'experience' | 'project';
  heading: string; // e.g. "Acme Corp — Software Engineer"
  company: string;
  bullets: string[];
  start: number; // span between \resumeItemListStart and \resumeItemListEnd
  end: number;
  indent: string;
}

export interface Slots {
  summary?: { text: string; start: number; end: number };
  skills: SkillSlot[];
  roles: RoleSlot[];
}

/** Same length as the input, with comments blanked out, so indices map 1:1 to the original. */
function maskComments(s: string): string {
  return s
    .split('\n')
    .map(line => {
      for (let i = 0; i < line.length; i++) {
        if (line[i] === '\\') {
          i++;
          continue;
        }
        if (line[i] === '%') return line.slice(0, i) + ' '.repeat(line.length - i);
      }
      return line;
    })
    .join('\n');
}

/** Index of the "}" matching the "{" at `open`, or -1. */
function matchBrace(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') {
      i++;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i;
  }
  return -1;
}

/** Read n consecutive {…} arguments starting at `from`; returns their inner spans. */
function readArgs(s: string, from: number, n: number): { start: number; end: number }[] | null {
  const out: { start: number; end: number }[] = [];
  let i = from;
  for (let k = 0; k < n; k++) {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (s[i] !== '{') return null;
    const close = matchBrace(s, i);
    if (close < 0) return null;
    out.push({ start: i + 1, end: close });
    i = close + 1;
  }
  return out;
}

function sections(m: string): { name: string; start: number; end: number }[] {
  const re = /\\section\*?\{([^}]*)\}/g;
  const hits: { name: string; at: number; bodyStart: number }[] = [];
  let x: RegExpExecArray | null;
  while ((x = re.exec(m))) hits.push({ name: x[1], at: x.index, bodyStart: x.index + x[0].length });
  return hits.map((h, i) => ({ name: h.name, start: h.bodyStart, end: i + 1 < hits.length ? hits[i + 1].at : m.length }));
}

export function plainLatex(s: string): string {
  return s
    .replace(/\\textbf\{([^{}]*)\}|\\textit\{([^{}]*)\}|\\emph\{([^{}]*)\}/g, (_m, a, b, c) => a ?? b ?? c ?? '')
    .replace(/\\href\{[^{}]*\}\{([^{}]*)\}/g, '$1')
    .replace(/\\([&%$#_{}])/g, '$1')
    .replace(/\\[a-zA-Z]+\*?/g, ' ')
    .replace(/[{}]/g, '')
    .replace(/--/g, '–')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseSlots(body: string): Slots {
  const m = maskComments(body);
  const slots: Slots = { skills: [], roles: [] };
  let roleN = 0;

  for (const sec of sections(m)) {
    const name = sec.name.toLowerCase();
    const chunk = m.slice(sec.start, sec.end);

    if (!slots.summary && /summary|profile|about|objective/.test(name)) {
      const small = chunk.search(/\\small\s*\{/);
      let span: { start: number; end: number } | null = null;
      if (small >= 0) {
        const open = sec.start + chunk.indexOf('{', small);
        const close = matchBrace(m, open);
        if (close > 0) span = { start: open + 1, end: close };
      }
      if (!span) {
        const b = chunk.indexOf('\\begin{justify}');
        const e = chunk.indexOf('\\end{justify}');
        if (b >= 0 && e > b) span = { start: sec.start + b + '\\begin{justify}'.length, end: sec.start + e };
      }
      if (span) {
        const text = body.slice(span.start, span.end).trim();
        if (plainLatex(text).split(' ').length >= 8) slots.summary = { text, ...span };
      }
    }

    if (/skill/.test(name)) {
      const re = /\\textbf\s*\{/g;
      let x: RegExpExecArray | null;
      while ((x = re.exec(chunk))) {
        const open = sec.start + x.index + x[0].length - 1;
        const close = matchBrace(m, open);
        if (close < 0) continue;
        const items = readArgs(m, close + 1, 1);
        if (!items) continue;
        const label = plainLatex(body.slice(open + 1, close)).replace(/:\s*$/, '');
        const text = body.slice(items[0].start, items[0].end).trim();
        if (!text) continue;
        slots.skills.push({ id: `s${slots.skills.length + 1}`, label, items: text, ...items[0] });
        re.lastIndex = items[0].end - sec.start;
      }
    }

    const kind: RoleSlot['kind'] | null = /experience|employment|work/.test(name) ? 'experience' : /project/.test(name) ? 'project' : null;
    if (!kind) continue;
    const headRe = /\\resume(Sub)?heading|\\resumeProjectHeading/gi;
    const heads: { at: number; args: { start: number; end: number }[] }[] = [];
    let h: RegExpExecArray | null;
    while ((h = headRe.exec(chunk))) {
      if (/SubSubheading/i.test(chunk.slice(h.index, h.index + 22))) continue;
      const nArgs = /ProjectHeading/i.test(h[0]) ? 2 : 4;
      const args = readArgs(m, sec.start + h.index + h[0].length, nArgs);
      if (args) heads.push({ at: sec.start + h.index, args });
    }
    heads.forEach((hd, i) => {
      const limit = i + 1 < heads.length ? heads[i + 1].at : sec.end;
      const ls = m.indexOf('\\resumeItemListStart', hd.at);
      const le = m.indexOf('\\resumeItemListEnd', ls);
      if (ls < 0 || le < 0 || ls > limit || le > limit) return;
      const start = ls + '\\resumeItemListStart'.length;
      const bullets: string[] = [];
      const itemRe = /\\resumeItem\s*\{/g;
      itemRe.lastIndex = start;
      let it: RegExpExecArray | null;
      let indent = '        ';
      while ((it = itemRe.exec(m)) && it.index < le) {
        const open = it.index + it[0].length - 1;
        const close = matchBrace(m, open);
        if (close < 0 || close > le) break;
        if (!bullets.length) indent = (body.slice(body.lastIndexOf('\n', it.index) + 1, it.index).match(/^\s*/) || [''])[0] || indent;
        bullets.push(body.slice(open + 1, close).trim());
        itemRe.lastIndex = close + 1;
      }
      const a = (k: number) => plainLatex(body.slice(hd.args[k].start, hd.args[k].end));
      const company = a(0);
      const heading = kind === 'experience' && hd.args.length === 4 ? `${company} — ${a(2)}` : company;
      slots.roles.push({ id: `r${++roleN}`, kind, heading, company, bullets, start, end: le, indent });
    });
  }
  return slots;
}

// ---------------- validation helpers ----------------

const STOP = new Set('a an the and or of to in for with by on at as from into via using across that this its their our my'.split(' '));
export function words(s: string): Set<string> {
  return new Set(
    plainLatex(s)
      .toLowerCase()
      .replace(/[^a-z0-9%+ ]+/g, ' ')
      .split(' ')
      .filter(w => w.length > 2 && !STOP.has(w)),
  );
}

/**
 * How much two bullets say the same thing (0–1). Takes the larger of Jaccard overlap and a damped
 * containment score, so a short rewording of a longer bullet still counts as a repeat.
 * 0.5+ means they make the same point.
 */
export function similarity(a: string, b: string): number {
  const A = words(a);
  const B = words(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  const jaccard = inter / (A.size + B.size - inter);
  const contained = Math.min(A.size, B.size) >= 5 ? (inter / Math.min(A.size, B.size)) * 0.72 : 0;
  return Math.max(jaccard, contained);
}

export function bracesOk(s: string): boolean {
  let d = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\') {
      i++;
      continue;
    }
    if (s[i] === '{') d++;
    else if (s[i] === '}' && --d < 0) return false;
  }
  return d === 0;
}

// Math-mode-only commands models like to drop into running text (→, ×, ≈ …). Outside $…$ they
// stop the build with "Missing $ inserted".
const MATH_CMDS = 'rightarrow|leftarrow|Rightarrow|Leftarrow|leftrightarrow|to|times|approx|leq|geq|le|ge|sim|pm|cdot|uparrow|downarrow|infty|mu';

/** Escape LaTeX specials the model forgot to escape (leaves existing escapes and commands alone). */
export function escapeLoose(s: string): string {
  // Pull out math the model already wrapped correctly, so its $ signs aren't escaped.
  const math: string[] = [];
  let out = s.replace(/\$[^$\n]{1,40}\$/g, m => `\u0000${math.push(m) - 1}\u0000`);
  out = out
    .replace(/(^|[^\\])([&%$#_])/g, '$1\\$2')
    .replace(/(^|[^\\])([&%$#_])/g, '$1\\$2')
    .replace(new RegExp(`\\\\(${MATH_CMDS})(?![a-zA-Z])`, 'g'), (_m, c) => `\u0000${math.push(`$\\${c}$`) - 1}\u0000`)
    .replace(/→/g, () => `\u0000${math.push('$\\rightarrow$') - 1}\u0000`)
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'");
  return out.replace(/\u0000(\d+)\u0000/g, (_m, i) => math[Number(i)]);
}

/**
 * No em dashes, ever (—, ―, LaTeX "---", \textemdash). A short lead-in becomes a colon
 * ("Thesis Title — Beyond…" → "Thesis Title: Beyond…"); anything else becomes a comma.
 * En dashes in date ranges ("Jan 2026 -- Aug 2026") are left alone.
 */
export function noEmDash(s: string): string {
  if (!s) return s;
  const EM = /\s*(?:—|―|(?<!-)---(?!-)|\\textemdash\b\s*(?:\{\})?)\s*/g;
  return s
    .replace(EM, (m, offset: number, whole: string) => {
      // A colon only after a short Title-Case label ("Thesis Title — …"), and only if the rest
      // of the sentence has no colon already; everything else reads best with a comma.
      const lead = whole.slice(0, offset).split(/[.;:!?(]/).pop()!.replace(/\\textbf\{|\}/g, '').trim();
      const words = lead.split(/\s+/).filter(Boolean);
      const rest = whole.slice(offset + m.length).split(/[.;!?]/)[0];
      const label = words.length > 0 && words.length <= 3 && words.every(w => /^[A-Z0-9]/.test(w));
      return label && !rest.includes(':') ? ': ' : ', ';
    })
    .replace(/,\s*,/g, ',')
    .replace(/,\s*([.;:)])/g, '$1')
    .replace(/:\s*:/g, ':');
}

/** Last resort: keep only \textbf{…}, escaped specials and simple math; drop any other command. */
export function strictClean(s: string): string {
  return escapeLoose(s)
    .replace(/\\(?!textbf\{|[&%$#_{}]|(?:rightarrow|times|approx|leq|geq|pm|cdot|sim)\b)[a-zA-Z]+\*?(\[[^\]]*\])?/g, '')
    .replace(/\{\s*\}/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export interface SlotEdits {
  summary?: string;
  skills: Record<string, string>;
  roles: Record<string, string[]>;
}

export interface SlotReport {
  fixes: string[];
}

export const MAX_BULLETS = 4;
export const MIN_BULLETS = 3;

/**
 * Turn the model's proposal into safe edits: bullet counts within 3–4 (or the original count if
 * smaller), no repeated points anywhere in the resume, no empty summary/skills, balanced braces.
 */
const KW_STOP = new Set(['and', 'or', 'the', 'of', 'for', 'to', 'in', 'with', 'a', 'an', 'on', 'based', 'driven']);
const stemWord = (w: string) => (w.length > 4 ? w.replace(/ies$/, 'y').replace(/(ing|ed|es|s)$/, '') : w);

/** The meaningful, stemmed words of a keyword or phrase ("User Flows" → user, flow). */
export function keywordWords(s: string): string[] {
  return plainLatex(s)
    .toLowerCase()
    // Spellings an ATS treats as the same skill.
    .replace(/\buser experience\b/g, 'ux')
    .replace(/\buser interfaces?\b/g, 'ui')
    .replace(/\bartificial intelligence\b/g, 'ai')
    .replace(/\bfront[\s-]*end\b/g, 'frontend')
    .replace(/\bback[\s-]*end\b/g, 'backend')
    .replace(/\bfull[\s-]*stack\b/g, 'fullstack')
    .replace(/\bnext\.?js\b/g, 'nextjs')
    .replace(/\bnode\.?js\b/g, 'nodejs')
    .replace(/\.js\b/g, '')
    .replace(/[-/]/g, ' ')
    .split(/[^a-z0-9+#]+/)
    .filter(w => w && !KW_STOP.has(w))
    .map(stemWord);
}

/** Does this text cover the keyword? Every word of it in the same sentence, bullet or skills line, in any form ("qualitative user research" covers "qualitative research"). */
export function textHasKeyword(text: string, keyword: string): boolean {
  const kw = keywordWords(keyword);
  if (!kw.length) return false;
  return text
    .split(/\n|[.;•]\s|\s\|\s/)
    .some(seg => {
      const words = new Set(keywordWords(seg));
      return kw.every(w => words.has(w));
    });
}

/** Is this skill backed by something the candidate wrote (resume, notes, answers)? */
function skillKnown(item: string, known: string): boolean {
  const t = plainLatex(item).toLowerCase().replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (known.includes(t)) return true;
  const words = t.split(/[^a-z0-9+#.]+/).filter(w => w.length >= 3);
  return words.length > 0 && words.every(w => known.includes(w));
}

// The model sometimes echoes the scaffolding it was shown ("s1 [Prototyping & Design]: Figma, …",
// "SUMMARY (original): …", "2. Led …"). None of that may reach the resume.
const norm = (s: string) => plainLatex(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Remove an echoed id / label prefix from a skills line. */
export function stripSkillLabel(text: string, label: string): string {
  let t = text.trim().replace(/^s\d+\s*[:.)\-]?\s*/i, '');
  // "[Anything]:" or "(Anything):" at the start is never a skill.
  t = t.replace(/^[\[(][^\])\n]{1,80}[\])]\s*[:\-–]?\s*/, '');
  // "Prototyping \& Design:" — the line's own label, unbracketed (optionally bold).
  const m = t.match(/^(?:\\textbf\{)?([^:,{}]{1,80}?)\}?\s*:\s*/);
  if (m && norm(m[1]) === norm(label)) t = t.slice(m[0].length);
  return t.trim();
}

/** Remove echoed scaffolding from a summary or bullet. */
function stripScaffold(text: string): string {
  return text
    .trim()
    .replace(/^(?:summary(?:\s*\(original\))?|profile summary)\s*:\s*/i, '')
    .replace(/^r\d+\s*[:.)\-]\s*/i, '')
    .replace(/^(?:\d{1,2}[.)]|[-*•])\s+/, '')
    .trim();
}

export function sanitizeEdits(slots: Slots, raw: SlotEdits, opts: { hasNotes?: boolean; known?: string; skillPool?: Record<string, string>; allowSkills?: string[] } = {}): { edits: SlotEdits; report: SlotReport } {
  const fixes: string[] = [];
  const edits: SlotEdits = { skills: {}, roles: {} };

  // Summary — keep a real paragraph, never a stub.
  if (slots.summary) {
    const proposed = raw.summary ? escapeLoose(stripScaffold(raw.summary)) : '';
    const n = plainLatex(proposed).split(' ').filter(Boolean).length;
    const orig = plainLatex(slots.summary.text).split(' ').length;
    if (proposed && bracesOk(proposed) && n >= Math.max(25, Math.round(orig * 0.6)) && n <= Math.max(110, orig * 1.6)) edits.summary = proposed;
    else {
      edits.summary = slots.summary.text;
      fixes.push(`summary was ${n ? `${n} words` : 'missing'} — kept your original`);
    }
  }

  // Skills — same lines, trimmed to what the job needs, never empty, nothing invented.
  const known = (opts.known || '').toLowerCase().replace(/\s+/g, ' ');
  for (const sk of slots.skills) {
    let proposed = raw.skills?.[sk.id] ? escapeLoose(stripSkillLabel(String(raw.skills[sk.id]), sk.label)) : '';
    // Anything still looking like a label ("[…]:" or "Theme:") means the line can't be trusted.
    if (/[\[\]]|^[^,]{1,60}:\s/.test(plainLatex(proposed))) {
      fixes.push(`skills line "${sk.label}" came back with its label inside — kept your original`);
      proposed = '';
    }
    if (proposed && known) {
      const items = proposed.split(',').map(x => x.trim()).filter(Boolean);
      // Keywords you asked Hermes to work in (only where true) may appear as written in the posting.
      const asked = (x: string) => (opts.allowSkills || []).some(k => textHasKeyword(x, k) || textHasKeyword(k, x));
      const kept = items.filter(x => skillKnown(x, known) || asked(x));
      if (kept.length < items.length) fixes.push(`removed skills you never mentioned: ${items.filter(x => !kept.includes(x)).map(plainLatex).join(', ')}`);
      proposed = kept.join(', ');
    }
    // Keep the line looking full: top it up from your own resume's line with the same theme
    // (then from the current line) until it has at least min(6, what it had) items.
    if (proposed && bracesOk(proposed)) {
      const items = proposed.split(',').map(x => x.trim()).filter(Boolean);
      const pool = [...(opts.skillPool?.[sk.label.toLowerCase()] || '').split(','), ...sk.items.split(',')].map(x => x.trim()).filter(Boolean);
      const floor = Math.min(6, Math.max(sk.items.split(',').filter(x => x.trim()).length, pool.length ? Math.min(pool.length, 6) : 0));
      const before = items.length;
      for (const x of pool) {
        if (items.length >= floor) break;
        if (!items.some(i => norm(i) === norm(x))) items.push(x);
      }
      if (items.length > before) fixes.push(`skills line "${sk.label}" was down to ${before}; topped it up from your resume`);
      proposed = items.join(', ');
    }
    const count = proposed.split(',').filter(x => x.trim()).length;
    if (proposed && bracesOk(proposed) && count >= Math.min(3, sk.items.split(',').length)) edits.skills[sk.id] = proposed;
    else {
      edits.skills[sk.id] = sk.items;
      fixes.push(`skills line "${sk.label}" came back empty — kept your original`);
    }
  }

  // Bullets — count limits and global de-duplication.
  const taken: string[] = [];
  const isDup = (b: string) => taken.some(t => similarity(t, b) >= 0.5);
  for (const role of slots.roles) {
    const floor = Math.min(MIN_BULLETS, role.bullets.length);
    // A role can't grow beyond its original bullet count unless the candidate supplied new facts
    // (notes) — otherwise the extra bullet is padding. Never more than MAX_BULLETS.
    const cap = Math.min(MAX_BULLETS, Math.max(role.bullets.length, 1) + (opts.hasNotes ? 1 : 0));
    const proposed = (raw.roles?.[role.id] || []).map(b => escapeLoose(stripScaffold(String(b)))).filter(b => b && bracesOk(b));
    const out: string[] = [];
    for (const b of proposed) {
      if (out.length >= cap) {
        fixes.push(`${role.company}: trimmed to ${cap} bullet${cap === 1 ? '' : 's'} (no padding)`);
        break;
      }
      if (isDup(b) || out.some(o => similarity(o, b) >= 0.5)) {
        fixes.push(`${role.company}: removed a repeated point`);
        continue;
      }
      out.push(b);
      taken.push(b);
    }
    // Top up from the original bullets (never repeating anything already used).
    for (const ob of role.bullets) {
      if (out.length >= floor) break;
      if (out.some(o => similarity(o, ob) >= 0.35) || isDup(ob)) continue;
      out.push(ob);
      taken.push(ob);
      fixes.push(`${role.company}: restored an original bullet to keep ${floor}`);
    }
    edits.roles[role.id] = out.length ? out : role.bullets.slice(0, MAX_BULLETS);
  }
  // House rule: no em dashes anywhere in the resume — including the candidate's original wording.
  const before = JSON.stringify(edits);
  if (edits.summary) edits.summary = noEmDash(edits.summary);
  for (const k of Object.keys(edits.skills)) edits.skills[k] = noEmDash(edits.skills[k]);
  for (const k of Object.keys(edits.roles)) edits.roles[k] = edits.roles[k].map(noEmDash);
  if (JSON.stringify(edits) !== before) fixes.push('replaced em dashes');
  return { edits, report: { fixes } };
}

/** Splice edits into the body, back to front so earlier indices stay valid. */
export function applyEdits(body: string, slots: Slots, edits: SlotEdits): string {
  const ops: { start: number; end: number; text: string }[] = [];
  if (slots.summary && edits.summary) ops.push({ start: slots.summary.start, end: slots.summary.end, text: `\n    ${edits.summary}\n  ` });
  for (const sk of slots.skills) if (edits.skills[sk.id]) ops.push({ start: sk.start, end: sk.end, text: edits.skills[sk.id] });
  for (const r of slots.roles) {
    const bullets = edits.roles[r.id];
    if (!bullets) continue;
    ops.push({ start: r.start, end: r.end, text: '\n' + bullets.map(b => `${r.indent}\\resumeItem{${b}}`).join('\n') + '\n' + r.indent.replace(/ {2}$/, '') });
  }
  ops.sort((a, b) => b.start - a.start);
  let out = body;
  for (const op of ops) out = out.slice(0, op.start) + op.text + out.slice(op.end);
  return out;
}
