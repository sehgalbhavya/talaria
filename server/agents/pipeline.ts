import type { AgentQuestion, Analysis, ArchiveReason, ChatMessage, ExperienceItem, Job, JobStatus, Packet, PrepareOptions, QuestionKind, TaskKind, TailoredResume } from '../../shared/types.ts';
import { askJson, callHermes, finishRun, isJobPaused, isPausedError, PAUSED, pauseJobCalls, resumeJobCalls, startRun, type RunHandle } from '../lib/hermes.ts';
import { compileLatex, findPdflatex, splitLatex, validateBody } from '../lib/latex.ts';
import { applyEdits, MAX_BULLETS, parseSlots, plainLatex, noEmDash, sanitizeEdits, similarity, strictClean, textHasKeyword, type SlotEdits, type Slots } from '../lib/latexSlots.ts';
import { toast } from '../lib/events.ts';
import { findAnswer, getJob, getPreferences, getProfile, getSettings, listAnswers, listJobs, newId, nextOrder, now, updateJob, upsertAnswer } from '../lib/store.ts';
import { RULES_NO_FABRICATION, clamp, jobBrief, oneOf, preferencesBrief, profileBrief, str, strArr } from './common.ts';
import { isStaleDraft, resumeHash } from '../../shared/resume.ts';

const inflight = new Map<string, Promise<unknown>>();

/** The candidate's own replies to the gaps Hermes flagged — first-hand facts that outrank the resume. */
function gapNotesBlock(job: Job): string {
  const notes = (job.gapNotes || []).filter(n => n.response.trim());
  if (!notes.length) return '';
  return notes.map(n => `- Gap: ${n.point}\n  Candidate says: ${n.response.trim()}`).join('\n');
}

function setWork(id: string, kind: TaskKind, patch: Partial<Job['work'][TaskKind]> | null) {
  updateJob(id, j => {
    if (patch === null) delete j.work[kind];
    else j.work[kind] = { ...(j.work[kind] || { state: 'queued', at: now() }), ...patch, at: now() } as any;
  });
}

// ====================== WORKSPACE CHAT ======================

function pushChat(j: Job, msg: Omit<ChatMessage, 'id' | 'at'>) {
  j.chat = [...(j.chat || []), { id: newId(), at: now(), ...msg }].slice(-200);
}

/** Post a message in the job's workspace chat. */
export function addChat(id: string, msg: Omit<ChatMessage, 'id' | 'at'>) {
  updateJob(id, j => pushChat(j, msg));
}

/** Keep the current draft as a version you can go back to. */
function pushHistory(j: Job) {
  if (!j.packet) return;
  const { approvedAt: _a, ...packet } = j.packet;
  j.packetHistory = [{ at: j.packet.generatedAt, note: j.packet.note || 'Earlier draft', packet: packet as Packet }, ...(j.packetHistory || [])].slice(0, 6);
}

/** Everything the candidate has told Hermes for this application. */
function answersBlock(job: Job): string {
  const answered = job.questions.filter(q => q.answer?.trim()).map(q => `Q: ${q.question}\nA: ${q.answer!.trim()}`);
  const skipped = job.questions.filter(q => q.skipped && !q.answer?.trim()).map(q => `- ${q.question}`);
  return [answered.join('\n'), skipped.length ? `Left to your judgment:\n${skipped.join('\n')}` : ''].filter(Boolean).join('\n\n');
}

const sameQuestion = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase() || similarity(a, b) >= 0.7;

function mergeQuestions(existing: AgentQuestion[], fresh: AgentQuestion[]) {
  return [...existing, ...fresh.filter(q => !existing.some(x => sameQuestion(x.question, q.question)))];
}

const interviewPending = (j: Job) => Boolean(j.interview && !j.interview.doneAt && !j.packet);

function once<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const p = fn().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

// ====================== FIT ANALYSIS ======================

const ANALYZE_PROMPT = (profile: string, prefs: string, job: string, notes = '') => `You are a senior technical recruiter and career coach. Assess this candidate against this job with candour — the candidate wants the truth, not flattery.

CANDIDATE
${profile}

CANDIDATE PREFERENCES
${prefs}
${notes ? `
THE CANDIDATE'S REPLIES TO GAPS YOU RAISED EARLIER (first-hand facts — weigh them; if a reply shows the gap is covered, drop or downgrade it)
${notes}
` : ''}
JOB
${job}

Return ONLY a JSON object:
{
  "score": number,          // 0–100 likelihood-weighted fit (90+ exceptional, 75–89 strong, 60–74 plausible stretch, <60 long shot)
  "verdict": string,        // 2–4 words, e.g. "Strong match", "Stretch role", "Long shot"
  "summary": string,        // 2–3 sentences: the headline judgement and the single biggest factor
  "whyYes": [{"point": string, "evidence": string}],              // 3–5 reasons they could get it; evidence = the concrete resume fact
  "whyNo": [{"point": string, "severity": "high"|"medium"|"low", "detail": string}], // 2–5 reasons they might not; be specific
  "improve": [{"action": string, "impact": "high"|"medium"|"low", "effort": "quick"|"moderate"|"significant", "detail": string}], // 3–5 concrete actions, most valuable first (what to emphasise, a project to build, a skill to brush up, who to contact, etc.)
  "mustHaves": [{"requirement": string, "met": "yes"|"partial"|"no", "note": string}], // the 4–8 most important requirements in the posting
  "keywords": [string]      // 8–15 ATS keywords from the posting (exact wording): skills, tools, technologies and methods a candidate can HAVE (e.g. "Figma", "user research", "design systems", "prototyping"). NOT product features or business terms (e.g. "subscription tiers", "in-app discovery"), job titles, program names, seniority words or company values.
}
Keep every string tight (≤ 30 words). ${RULES_NO_FABRICATION}`;

function normAnalysis(raw: any, model: string): Analysis {
  return {
    score: clamp(raw?.score),
    verdict: str(raw?.verdict, 40) || 'Assessed',
    summary: str(raw?.summary, 800),
    whyYes: (Array.isArray(raw?.whyYes) ? raw.whyYes : []).slice(0, 6).map((x: any) => ({ point: str(x?.point ?? x, 300), evidence: str(x?.evidence, 300) || undefined })).filter((x: any) => x.point),
    whyNo: (Array.isArray(raw?.whyNo) ? raw.whyNo : []).slice(0, 6).map((x: any) => ({ point: str(x?.point ?? x, 300), severity: oneOf(x?.severity, ['high', 'medium', 'low'] as const, 'medium'), detail: str(x?.detail, 300) || undefined })).filter((x: any) => x.point),
    improve: (Array.isArray(raw?.improve) ? raw.improve : []).slice(0, 6).map((x: any) => ({ action: str(x?.action ?? x, 300), impact: oneOf(x?.impact, ['high', 'medium', 'low'] as const, 'medium'), effort: oneOf(x?.effort, ['quick', 'moderate', 'significant'] as const, 'moderate'), detail: str(x?.detail, 400) || undefined })).filter((x: any) => x.action),
    mustHaves: (Array.isArray(raw?.mustHaves) ? raw.mustHaves : []).slice(0, 10).map((x: any) => ({ requirement: str(x?.requirement ?? x, 200), met: oneOf(x?.met, ['yes', 'partial', 'no'] as const, 'partial'), note: str(x?.note, 200) || undefined })).filter((x: any) => x.requirement),
    keywords: strArr(raw?.keywords, 20, 60),
    generatedAt: now(),
    model,
  };
}

export function analyzeJob(id: string, opts: { force?: boolean; handle?: RunHandle; priority?: number } = {}): Promise<Analysis> {
  return once(`analyze:${id}`, async () => {
    const job = getJob(id);
    if (!job) throw new Error('Job not found');
    if (job.analysis && !opts.force) return job.analysis;
    const profile = getProfile();
    if (!profile) throw new Error('Add your resume first.');
    const own = !opts.handle;
    if (own) unpause(id);
    const h = opts.handle || startRun('analyze', `Fit analysis · ${job.title} @ ${job.company}`, id);
    setWork(id, 'analyze', { state: 'queued', step: undefined, error: undefined });
    try {
      h.log('Comparing your background with the requirements');
      const model = getSettings().hermes.model;
      const raw = await askJson<any>({
        prompt: ANALYZE_PROMPT(profileBrief(profile), preferencesBrief(getPreferences()), jobBrief(job), gapNotesBlock(job)),
        handle: h,
        priority: opts.priority ?? 0,
        onStart: () => setWork(id, 'analyze', { state: 'running', step: 'Reading the posting' }),
      });
      const analysis = normAnalysis(raw, model);
      updateJob(id, j => {
        j.analysis = analysis;
        j.work.analyze = { state: 'done', at: now() };
      }, { at: now(), text: `Fit analysis: ${analysis.score}/100 — ${analysis.verdict}`, kind: 'agent' });
      if (own) finishRun(h, true, `${analysis.score}/100 · ${analysis.verdict}`);
      return analysis;
    } catch (err: any) {
      setWork(id, 'analyze', isPausedError(err) ? null : { state: 'error', error: err.message });
      if (own) finishRun(h, false, undefined, err.message);
      throw err;
    }
  });
}

// ====================== TAILORING ======================

const TAILOR_PROMPT = (o: { profileJson: string; prefs: string; job: string; analysis: string; known: string; userAnswers: string; refine: boolean; interviewed?: boolean; instructions?: string; previous?: string; gapNotes?: string }) => `You are an expert resume writer and application strategist working for ONE candidate. Produce a tailored application for the job below.

CANDIDATE PROFILE (source of truth — JSON)
${o.profileJson}

CANDIDATE PREFERENCES
${o.prefs}

JOB
${o.job}

FIT NOTES
${o.analysis}

${o.gapNotes ? `THE CANDIDATE'S OWN NOTES ON THE GAPS (true, first-hand facts — use them to strengthen the resume: surface this experience in summary, skills and the relevant bullets, using the candidate's specifics. Don't overstate beyond what they wrote.)
${o.gapNotes}

` : ''}FACTS THE CANDIDATE ALREADY GAVE US (reuse; never ask again)
${o.known || '(none yet)'}
${o.userAnswers ? `\nTHE CANDIDATE'S ANSWERS FOR THIS APPLICATION (true facts: personalise with them. Use their reasons for wanting this job in the cover letter, lead with what they chose to lead with, and work in the specifics they gave. Where they left something to your judgment, decide sensibly.)\n${o.userAnswers}\n` : ''}${o.instructions ? `\nTHE CANDIDATE'S REVISION REQUEST (follow it, within the hard rules)\n${o.instructions}\n` : ''}${o.previous ? `\nPREVIOUS DRAFT (revise this rather than starting over)\n${o.previous}\n` : ''}
Return ONLY a JSON object:
{
  "resume": {
    "headline": string,
    "summary": string,                                   // 2–3 sentences aimed squarely at this role
    "skills": [{"group": string, "items": [string]}],    // 3–5 groups, most relevant first; only skills the candidate has AND this job values (drop the rest)
    "experience": [{"company": string, "title": string, "location": string, "start": string, "end": string, "bullets": [string]}],
    "projects": [{"name": string, "link": string, "tech": [string], "bullets": [string]}],
    "education": [{"school": string, "degree": string, "field": string, "start": string, "end": string, "details": string}],
    "extras": [{"label": string, "items": [string]}]
  },
  "answers": [{"question": string, "answer": string}],   // 2–4 likely application-form questions for THIS role (e.g. "Why do you want to work here?", "Describe a relevant project") with strong 60–120 word answers
  "changes": [{"what": string, "why": string}],          // 3–6 notable tailoring decisions
  "questions": [{"question": string, "why": string, "kind": "text"|"longtext"|"choice"|"yesno"|"number", "options": [string], "suggested": string, "required": boolean}]
}

Resume rules:
- Keep every employer, title and date exactly as in the profile. Reorder and rewrite bullets to foreground what this job values; lead with impact; mirror the posting's keywords where they are TRUE.
- Never use em dashes (—) anywhere in the resume; use commas, colons or separate clauses.
- Keep EVERY role from the profile with the same number of bullets as the original (never more than 4; one extra only if the candidate's notes add a new true point). Start from the original points and reword them toward this job; you may swap a weak point for another true one. No point may repeat anywhere in the resume. Two pages is fine. Summary 40–75 words.
- ${RULES_NO_FABRICATION.replace(/\n/g, ' ')}

Questions rules (these are shown to the candidate before anything is submitted):
- ${o.refine ? 'This is a refinement pass: ask NOTHING new unless it is truly blocking. Usually return [].' : o.interviewed ? 'You already interviewed the candidate (their answers are above). Ask only what a real application form for this job will need and you cannot infer from the facts given. Usually return []. Maximum 3.' : 'Ask only what a real application form will need or what would materially strengthen it, and which you cannot infer: e.g. work authorization / sponsorship for the job\'s country, salary expectation, earliest start date or notice period, willingness to relocate or work on-site, or whether they have a required skill the resume doesn\'t show (ask them to describe it briefly).'}
- Maximum 5. Never ask for anything listed under facts already given. Prefer "yesno"/"choice" when possible; put a sensible draft in "suggested".`;

/** House rule: no em dashes anywhere in the resume. */
function scrubEmDashes(r: TailoredResume) {
  r.headline = noEmDash(r.headline);
  r.summary = noEmDash(r.summary);
  for (const g of r.skills) g.items = g.items.map(noEmDash);
  for (const e of r.experience) e.bullets = e.bullets.map(noEmDash);
  for (const p of r.projects) p.bullets = p.bullets.map(noEmDash);
  for (const x of r.extras) x.items = x.items.map(noEmDash);
}

function normResume(raw: any): Omit<TailoredResume, 'name' | 'contact'> {
  const r = raw || {};
  return {
    headline: str(r.headline, 200),
    summary: str(r.summary, 1200),
    skills: (Array.isArray(r.skills) ? r.skills : []).slice(0, 6).map((g: any) => ({ group: str(g?.group, 60) || 'Skills', items: strArr(g?.items, 25, 60) })).filter((g: any) => g.items.length),
    experience: (Array.isArray(r.experience) ? r.experience : []).slice(0, 10).map((e: any) => ({ company: str(e?.company, 160), title: str(e?.title, 160), location: str(e?.location, 120), start: str(e?.start, 40), end: str(e?.end, 40), bullets: strArr(e?.bullets, 8, 500) })),
    projects: (Array.isArray(r.projects) ? r.projects : []).slice(0, 6).map((p: any) => ({ name: str(p?.name, 160), link: str(p?.link, 300), tech: strArr(p?.tech, 12, 40), bullets: strArr(p?.bullets, 5, 500) })),
    education: (Array.isArray(r.education) ? r.education : []).slice(0, 4).map((e: any) => ({ school: str(e?.school, 200), degree: str(e?.degree, 160), field: str(e?.field, 160), start: str(e?.start, 40), end: str(e?.end, 40), details: str(e?.details, 400) })),
    extras: (Array.isArray(r.extras) ? r.extras : []).slice(0, 5).map((x: any) => ({ label: str(x?.label, 60), items: strArr(x?.items, 10, 300) })).filter((x: any) => x.label && x.items.length),
  };
}

/** Safety net: every original role survives, with at least 3 bullets (or all it had). */
function keepFullExperience(tailored: ExperienceItem[], original: ExperienceItem[]): ExperienceItem[] {
  if (!tailored.length) return original;
  const key = (e: ExperienceItem) => `${e.company}|${e.title}`.toLowerCase().replace(/[^a-z0-9|]+/g, '');
  const used: string[] = [];
  const out = tailored.map(t => {
    const src = original.find(o => key(o) === key(t)) || original.find(o => o.company.toLowerCase() === t.company.toLowerCase());
    // 3–4 bullets, and no point repeated anywhere in the resume.
    const bullets: string[] = [];
    for (const b of t.bullets) {
      if (bullets.length >= MAX_BULLETS) break;
      if (used.some(u => similarity(u, b) >= 0.5)) continue;
      bullets.push(b);
      used.push(b);
    }
    const need = Math.min(3, src?.bullets.length ?? 3);
    for (const b of src?.bullets || []) {
      if (bullets.length >= need) break;
      if (used.some(u => similarity(u, b) >= 0.35)) continue;
      bullets.push(b);
      used.push(b);
    }
    return { ...t, bullets };
  });
  for (const o of original) if (!out.some(t => key(t) === key(o))) out.push(o);
  return out;
}

const KINDS: readonly QuestionKind[] = ['text', 'longtext', 'choice', 'yesno', 'number'];

const CATEGORIES: [string, RegExp][] = [
  ['sponsorship', /sponsor/i],
  ['authorization', /authori[sz]|right to work|work permit|eligib\w* to work|legally/i],
  ['salary', /salary|compensation|pay expectation|\bctc\b|expected pay/i],
  ['start', /notice period|start date|available to start|earliest|join(ing)? date/i],
  ['relocate', /relocat/i],
  ['onsite', /on-?site|in[- ]office|commute|hybrid/i],
];
const category = (q: string) => CATEGORIES.find(([, re]) => re.test(q))?.[0];

function bankLookup(question: string) {
  const exact = findAnswer(question);
  if (exact) return exact;
  const cat = category(question);
  if (!cat) return undefined;
  return listAnswers().find(a => category(a.question) === cat);
}

function normQuestions(raw: any, stage: AgentQuestion['stage'] = 'draft'): AgentQuestion[] {
  return (Array.isArray(raw) ? raw : [])
    .slice(0, 6)
    .map((q: any): AgentQuestion => {
      const kind = oneOf(q?.kind, KINDS, 'text');
      const question = noEmDash(str(q?.question, 300));
      const reusable = q?.reusable == null ? stage !== 'interview' || Boolean(category(question)) : Boolean(q.reusable);
      // Only facts that hold for every application come from the answer bank.
      const hit = reusable ? bankLookup(question) : undefined;
      return {
        id: newId(),
        question,
        why: str(q?.why, 300) || undefined,
        kind,
        options: kind === 'choice' ? strArr(q?.options, 8, 100) : undefined,
        suggested: noEmDash(str(q?.suggested, 1200)) || undefined,
        answer: hit?.answer,
        fromBank: Boolean(hit),
        required: stage === 'interview' ? q?.required === true : q?.required !== false,
        stage,
        reusable,
      };
    })
    .filter(q => q.question);
}

export function resumeText(r: TailoredResume | Omit<TailoredResume, 'name' | 'contact'>) {
  return [r.headline, r.summary, ...r.skills.flatMap(s => s.items), ...r.experience.flatMap(e => [e.title, ...e.bullets]), ...r.projects.flatMap(p => [p.name, ...(p.tech || []), ...p.bullets]), ...r.extras.flatMap(x => x.items)].join(' \n ').toLowerCase();
}

/** What a "work in keywords" pass asks for: add these where true, and keep the ones already in. */
function keywordBrief(all: string[], add: string[]) {
  const keep = all.filter(k => !add.includes(k));
  return `Work these ATS keywords in where they are TRUE for the candidate, in natural wording (a skills line, or a bullet describing that work): ${add.join(', ')}. Skip any that would be untrue rather than forcing it. Keep every keyword already in the resume${keep.length ? ` (${keep.join(', ')})` : ''}: don't remove them or reword them away.`;
}

/** ATS keyword match, by meaning of the words rather than exact wording ("user flow" covers "user flows"). */
export function coverage(keywords: string[], text: string) {
  if (!keywords.length) return { pct: 0, missing: [] as string[] };
  const missing = keywords.filter(k => !textHasKeyword(text, k));
  return { pct: Math.round((100 * (keywords.length - missing.length)) / keywords.length), missing };
}

function knownFacts(): string {
  const prefs = getPreferences();
  const lines = listAnswers()
    .slice(0, 40)
    .map(a => `Q: ${a.question}\nA: ${a.answer}`);
  if (prefs.needsSponsorship != null) lines.unshift(`Q: Do you require visa sponsorship?\nA: ${prefs.needsSponsorship ? 'Yes' : 'No'}`);
  if (prefs.minSalary) lines.unshift(`Q: Minimum salary expectation?\nA: ${prefs.minSalary} ${prefs.currency || ''}`);
  return lines.join('\n');
}

// ====================== LATEX ======================

const LATEX_PROMPT = (o: { body: string; resume: string; job: string; extra?: string }) => `You are editing the BODY of a candidate's LaTeX resume so it presents the tailored content below. The preamble (fonts, macros, layout) is fixed and not shown — you must only use commands that already appear in the original body.

ORIGINAL BODY (everything between \\begin{document} and \\end{document})
<<<ORIGINAL
${o.body}
ORIGINAL>>>

TAILORED CONTENT TO PRESENT (JSON — this is what the reader should now see)
${o.resume}

TARGET ROLE: ${o.job}
${o.extra ? `\n${o.extra}\n` : ''}
Rules:
- Keep the exact structure and command usage of the original: same custom macros (\\resumeSubheading, \\resumeItem, list start/end macros, \\section, spacing commands), same header block. Do not invent new commands or packages.
- Keep the header (name, contact links, phone, location) exactly as in the original.
- Replace the summary, skills lines, bullet points and project bullets with the tailored content. You may reorder entries and bullets. Keep EVERY role and project from the original, and give each role AT LEAST 3 bullets (all of its bullets if the original has fewer than 3). Every employer, title, date, school and degree must be copied exactly from the original.
- Keep the original's emphasis style (sparing \\textbf{} on key results). Where the tailored content dropped a specific detail the original bullet had (a number, participant count, tool), keep the original detail.
- Escape LaTeX special characters in any new text: \\& \\% \\$ \\# \\_ and avoid raw ~ ^ \\.
- Length: up to two pages is fine. Don't cut content to save space.
- Remove commented-out (%) blocks.

Return ONLY the new body between these exact marker lines, nothing else:
<<<BODY
...new body...
BODY>>>`;

/** Roles (by heading) that have fewer bullets than they need: min(3, bullets in the original). */
export function thinRoles(body: string, original: string): string | null {
  const roles = (raw: string) => {
    const out: { name: string; bullets: number }[] = [];
    const tex = raw.replace(/^\s*%.*$/gm, '');
    const exp = tex.split(/\\section\{/).find(s => /^Experience/i.test(s)) || '';
    for (const chunk of exp.split('\\resumeSubheading').slice(1)) {
      const name = chunk.match(/\{([^}]*)\}/)?.[1]?.trim() || '?';
      out.push({ name, bullets: (chunk.match(/\\resumeItem\{/g) || []).length });
    }
    return out;
  };
  const before = new Map(roles(original).map(r => [r.name, r.bullets]));
  const after = roles(body);
  const short = after.filter(r => r.bullets < Math.min(3, before.get(r.name) ?? 3)).map(r => r.name);
  const missing = [...before.keys()].filter(name => !after.some(r => r.name === name)).map(name => `${name} (missing entirely)`);
  const all = [...short, ...missing];
  return all.length ? all.join(', ') : null;
}

function extractBody(text: string): string | null {
  const m = text.match(/<<<BODY\s*\n([\s\S]*?)\n\s*BODY>>>/);
  if (m) return m[1];
  const f = text.match(/```(?:latex|tex)?\s*\n([\s\S]*?)```/);
  return f ? f[1] : null;
}

async function tailorLatexWholeBody(job: Job, resume: TailoredResume, h: RunHandle, priority: number): Promise<Pick<Packet, 'latex' | 'latexStatus' | 'latexError' | 'latexPages'>> {
  const profile = getProfile();
  const parts = profile?.latexSource ? splitLatex(profile.latexSource) : null;
  if (!parts) return {};
  const { name: _n, contact: _c, ...content } = resume;
  const base = { body: parts.body, resume: JSON.stringify(content), job: `${job.title} at ${job.company}` };

  let extra: string | undefined;
  let lastError = '';
  let best: { tex: string; pages?: number } | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await callHermes({ prompt: LATEX_PROMPT({ ...base, extra }), handle: h, timeoutSec: 300, priority, model: getSettings().hermes.tailorModel || undefined });
    const body = extractBody(res.text);
    if (!body) {
      lastError = 'Hermes did not return a LaTeX body.';
      extra = 'Your previous answer was missing the <<<BODY … BODY>>> markers. Return the body between them.';
      continue;
    }
    const invalid = validateBody(body);
    if (invalid) {
      lastError = invalid;
      extra = `Your previous body was invalid: ${invalid} Fix it.`;
      continue;
    }
    const tex = parts.head + '\n' + body.trim() + '\n\n' + parts.tail;
    if (!findPdflatex()) return { latex: tex, latexStatus: 'uncompiled' };
    h.log('Compiling your LaTeX resume');
    const c = await compileLatex(tex);
    if (!c.ok) {
      lastError = c.error || 'Compile failed';
      h.log(`LaTeX error, asking Hermes to fix it: ${lastError.split('\n')[0]}`);
      extra = `Your previous body failed to compile with this error — fix it:\n${lastError}`;
      continue;
    }
    if (!best || (c.pages ?? 9) < (best.pages ?? 9)) best = { tex, pages: c.pages };
    const thin = thinRoles(body, parts.body);
    if ((c.pages ?? 1) <= 2 && !thin) break;
    if (thin) {
      h.log(`Some roles came back with fewer than 3 bullets — asking Hermes to restore them`);
      extra = `In your previous version these roles had fewer than 3 bullets: ${thin}. Every role needs at least 3 bullets (or all of its original bullets) — restore them from the original.`;
    } else {
      h.log(`Tailored resume is ${c.pages} pages — asking Hermes to tighten wording to two`);
      extra = `Your previous version ran to ${c.pages} pages. Tighten wording so it fits on TWO pages, without removing roles or going below 3 bullets per role.`;
    }
  }
  if (best) return { latex: best.tex, latexStatus: 'compiled', latexPages: best.pages };
  return { latexStatus: 'error', latexError: lastError };
}

// Slot-based tailoring: Hermes may only change the text inside the summary, skills lines and
// bullet lists of the user's own template; code enforces counts, de-duplication and non-empty
// sections before splicing. The header, layout and section structure can't be damaged.

const SLOT_PROMPT = (o: { slots: string; fromDraft?: boolean; job: string; analysis: string; gapNotes: string; answers?: string; guidance: string; keywords?: string[]; instructions?: string; extra?: string }) => `You are tailoring ONE candidate's resume for a specific job. You edit only the text slots below; the layout and everything else is fixed.

JOB
${o.job}

FIT NOTES
${o.analysis}
${o.gapNotes ? `\nTHE CANDIDATE'S OWN NOTES (true, first-hand facts — use them)\n${o.gapNotes}\n` : ''}${o.answers ? `\nTHE CANDIDATE'S ANSWERS FOR THIS APPLICATION (true facts; lead with what they chose to lead with and use the specifics they gave)\n${o.answers}\n` : ''}${o.instructions ? `\nTHE CANDIDATE'S REQUEST\n${o.instructions}\n` : ''}
DIRECTION FROM THE FIRST DRAFTING PASS (use for emphasis and angle, not as new facts)
${o.guidance}

${
  o.fromDraft
    ? `SLOTS FROM THE CURRENT DRAFT (LaTeX fragments). This is the version the candidate is reviewing, built up over earlier rounds. Revise THIS text: change what the request and answers call for and keep everything else exactly as it is, so earlier changes carry forward.`
    : `SLOTS FROM THE CANDIDATE'S RESUME (LaTeX fragments)`
}
${o.slots}

Return ONLY JSON: {"summary": string, "skills": {"s1": string, ...}, "roles": {"r1": [string, ...], ...}} — include EVERY skills id and EVERY role id. Each skills value is ONLY the comma-separated items (e.g. "Figma, Framer, Protopie"): never the id, the theme name, brackets or a colon. Bullets are plain sentences with no numbering or dashes in front.

Rules:
1. Truth: every fact must come from the original bullets, the summary, or the candidate's notes. Keep every number attached to the achievement it belongs to. Never add context the original doesn't state — no geography ("European markets", "global"), team setup ("cross-functional", "cross-European"), audience, or method ("aligned with user research") just because the job mentions it. Mirror the job's vocabulary only where it describes what the candidate actually did.
2. Bullets per role: return the SAME number of bullets as the original role (never more than 4). Only add one extra bullet when the candidate's notes give a genuinely new, true point for that role. Never pad with generic statements.
3. Start from the original points: keep each point's substance and specifics, and reword it to speak this job's language, leading with what the job cares about. You may swap a weak or irrelevant point for a different true point (from the notes, or another detail of the same role).
4. No repetition anywhere: each achievement appears once in the whole resume — including the summary vs. the bullets (the summary frames the story, it doesn't restate a bullet). Never restate a point in different words, never merge two originals into one long bullet, never repeat a bullet from another role.
5. Cohesion: the summary tells the story (who the candidate is and why they fit this role); the bullets prove it. Order bullets within each role by relevance to this job.
6. Summary: 2–3 sentences, 40–70 words (never under 35), concrete and specific to this job. It may open with \\textbf{...} for the title like the original. No filler or clichés (e.g. "portfolio available on request", "high-delivery", "robust", "proven record", "passionate", "results-driven").
7. Skills: keep each line and its theme, and keep every line FULL: 6 to 10 items (a line that started shorter keeps at least its original count). Put the skills this job values first. Swap out only what's clearly irrelevant, and fill the space with other relevant skills the candidate's work shows: tools, methods and technologies named in their experience and project bullets, notes or answers. Never drop a skill the posting asks for that the candidate has, and never add one their resume, notes or answers don't show. Comma-separated.
8. LaTeX: plain sentences; \\textbf{...} at most once per bullet on the key result, like the original. Never use em dashes (— or ---) anywhere; use a comma, colon or a new clause instead. Escape & % $ # _ as \\& \\% \\$ \\# \\_. No other commands. One sentence per bullet, at most 32 words.${
  o.keywords?.length
    ? `
9. ATS keywords: weave in as many of these as genuinely fit the candidate's real experience — most of them, in natural phrasing, never forced and never claiming experience they don't have. Prefer the summary, skills lines and existing bullets: ${o.keywords.join(', ')}.`
    : ''
}${o.extra ? `\n\nFIX FROM YOUR PREVIOUS ATTEMPT: ${o.extra}` : ''}`;

function renderSlots(slots: Slots, fromDraft = false): string {
  const out: string[] = [];
  if (slots.summary) out.push(`SUMMARY (${fromDraft ? 'current draft' : 'original'}):\n${slots.summary.text}`);
  if (slots.skills.length) out.push('SKILLS LINES (id, theme, then the current items; return only the items):\n' + slots.skills.map(s => `${s.id} | theme: ${s.label} | items: ${s.items}`).join('\n'));
  out.push(
    'ROLES:\n' +
      slots.roles.map(r => `${r.id} (${r.kind}) ${r.heading} — ${r.bullets.length} ${fromDraft ? 'current' : 'original'} bullet(s):\n${r.bullets.map((b, i) => `   ${i + 1}. ${b}`).join('\n')}`).join('\n\n'),
  );
  return out.join('\n\n');
}

interface LatexResult extends Pick<Packet, 'latex' | 'latexStatus' | 'latexError' | 'latexPages'> {
  edits?: SlotEdits;
  slots?: Slots;
}

async function tailorLatex(job: Job, resume: TailoredResume, h: RunHandle, opts: { priority: number; keywords?: string[]; instructions?: string; refine?: boolean }): Promise<LatexResult> {
  const profile = getProfile();
  if (!profile?.latexSource) return {};
  // A revision edits the draft you're looking at, so every earlier round carries forward. A first
  // draft, a fresh "start over", a draft from an older resume, or one that fell back to your
  // original wording starts from your resume instead.
  const prev = job.packet;
  const fromDraft = Boolean(opts.refine && prev?.latex && prev.latexStatus === 'compiled' && !prev.latexError && !isStaleDraft(job, profile));
  let parts = splitLatex(fromDraft ? prev!.latex! : profile.latexSource);
  let slots = parts ? parseSlots(parts.body) : null;
  if (fromDraft && (!parts || !slots?.roles.length)) {
    parts = splitLatex(profile.latexSource);
    slots = parts ? parseSlots(parts.body) : null;
  }
  if (!parts || !slots) return {};
  h.log(fromDraft ? 'Revising the current draft' : 'Starting from your resume');
  if (!slots.roles.length) {
    h.log("Couldn't find bullet lists in your template — falling back to a full rewrite");
    return tailorLatexWholeBody(job, resume, h, opts.priority);
  }
  const a = job.analysis;
  const guidance = [`Summary angle: ${resume.summary}`, ...resume.experience.map(e => `${e.company}: ${e.bullets.slice(0, MAX_BULLETS).join(' | ')}`)].join('\n').slice(0, 5000);

  let extra: string | undefined;
  let lastError = '';
  let lastEdits: SlotEdits | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await askJson<any>({
      prompt: SLOT_PROMPT({
        slots: renderSlots(slots, fromDraft),
        fromDraft,
        job: jobBrief(job, 6000),
        analysis: a ? `Fit ${a.score}/100. Gaps: ${a.whyNo.map(x => x.point).join('; ')}. Key requirements: ${a.mustHaves.map(m => m.requirement).join('; ')}` : '',
        gapNotes: gapNotesBlock(job),
        answers: answersBlock(job) || undefined,
        guidance,
        keywords: opts.keywords,
        instructions: opts.instructions,
        extra,
      }),
      handle: h,
      timeoutSec: 300,
      priority: opts.priority,
      model: getSettings().hermes.tailorModel || undefined,
    });
    const proposal: SlotEdits = {
      summary: typeof raw?.summary === 'string' ? raw.summary : undefined,
      skills: raw?.skills && typeof raw.skills === 'object' ? raw.skills : {},
      roles: raw?.roles && typeof raw.roles === 'object' ? raw.roles : {},
    };
    const { edits, report } = sanitizeEdits(slots, proposal, {
      hasNotes: Boolean(gapNotesBlock(job)),
      allowSkills: opts.keywords,
      // Skills from your own resume top up a line Hermes cut too short (matched by line theme).
      skillPool: Object.fromEntries((parseSlots(splitLatex(profile.latexSource)?.body || '').skills || []).map(s => [s.label.toLowerCase(), s.items])),
      known: [profile.resumeText, profile.skills?.join(', '), slots.skills.map(s => s.items).join(', '), gapNotesBlock(job), answersBlock(job)].filter(Boolean).join('\n'),
    });
    lastEdits = edits;
    for (const f of report.fixes) h.log(`Fixed: ${f}`);
    const tex = parts.head + applyEdits(parts.body, slots, edits) + parts.tail;
    if (!findPdflatex()) return { latex: tex, latexStatus: 'uncompiled', edits, slots };
    h.log('Compiling your LaTeX resume');
    const c = await compileLatex(tex);
    if (c.ok) return { latex: tex, latexStatus: 'compiled', latexPages: c.pages, edits, slots };
    lastError = c.error || 'Compile failed';
    h.log(`LaTeX error, retrying: ${lastError.split('\n')[0]}`);
    extra = `Your text broke the LaTeX build with this error — avoid the offending characters/commands:\n${lastError}`;
  }

  // Fallback 1: keep Hermes's wording but strip anything beyond \textbf and simple math.
  if (lastEdits) {
    const strict: SlotEdits = {
      summary: lastEdits.summary && strictClean(lastEdits.summary),
      skills: Object.fromEntries(Object.entries(lastEdits.skills).map(([k, v]) => [k, strictClean(v)])),
      roles: Object.fromEntries(Object.entries(lastEdits.roles).map(([k, v]) => [k, v.map(strictClean)])),
    };
    const tex = parts.head + applyEdits(parts.body, slots, strict) + parts.tail;
    h.log('Compiling a cleaned-up version');
    const c = await compileLatex(tex);
    if (c.ok) return { latex: tex, latexStatus: 'compiled', latexPages: c.pages, edits: strict, slots };
  }

  // A revision that won't compile leaves the current draft exactly as it was.
  if (fromDraft) {
    h.log(`Couldn't compile the revised wording (${lastError.split('\n')[0]}), so the current draft stays as it was`);
    return { latex: prev!.latex, latexStatus: 'compiled', latexPages: prev!.latexPages };
  }

  // Fallback 2: your own template with your original wording — always compiles, never the generic layout.
  h.log(`Couldn't compile the tailored wording (${lastError.split('\n')[0]}) — using your original resume text in your template`);
  const origEdits: SlotEdits = {
    summary: slots.summary && noEmDash(slots.summary.text),
    skills: Object.fromEntries(slots.skills.map(s => [s.id, noEmDash(s.items)])),
    roles: Object.fromEntries(slots.roles.map(r => [r.id, r.bullets.map(noEmDash)])),
  };
  for (const source of [parts.head + applyEdits(parts.body, slots, origEdits) + parts.tail, profile.latexSource]) {
    const c = await compileLatex(source);
    if (c.ok) return { latex: source, latexStatus: 'compiled', latexPages: c.pages, latexError: `Tailored wording didn't compile: ${lastError.split('\n')[0]}` };
  }
  return { latexStatus: 'error', latexError: lastError || 'Your original template no longer compiles.' };
}

/** Keep the on-screen preview, Apply kit and keyword meter in sync with what the PDF says. */
function syncResumeFromSlots(resume: TailoredResume, slots: Slots, edits: SlotEdits): TailoredResume {
  const byCompany = (name: string) => slots.roles.find(r => r.kind === 'experience' && r.company.toLowerCase() === name.toLowerCase());
  const byProject = (name: string) => slots.roles.find(r => r.kind === 'project' && (r.company.toLowerCase().includes(name.toLowerCase()) || name.toLowerCase().includes(r.company.toLowerCase())));
  return {
    ...resume,
    summary: edits.summary ? plainLatex(edits.summary) : resume.summary,
    skills: slots.skills.length
      ? slots.skills.map(s => ({ group: s.label, items: plainLatex(edits.skills[s.id] || s.items).split(',').map(x => x.trim()).filter(Boolean) }))
      : resume.skills,
    experience: resume.experience.map(e => {
      const r = byCompany(e.company);
      return r && edits.roles[r.id] ? { ...e, bullets: edits.roles[r.id].map(plainLatex) } : e;
    }),
    projects: resume.projects.map(p => {
      const r = byProject(p.name);
      return r && edits.roles[r.id] ? { ...p, bullets: edits.roles[r.id].map(plainLatex) } : p;
    }),
  };
}

// ====================== INTERVIEW (before drafting) ======================

const INTERVIEW_PROMPT = (o: { profile: string; prefs: string; job: string; analysis: string; known: string; gapNotes: string; story?: string }) => `You are Hermes, about to tailor ONE candidate's resume and write their cover letter for the job below. Before you write anything, interview the candidate so the application sounds like them and uses facts only they know. Don't make a choice yourself when you could ask.

CANDIDATE
${o.profile}

CANDIDATE PREFERENCES
${o.prefs}

JOB
${o.job}

FIT NOTES
${o.analysis}
${o.gapNotes ? `\nTHE CANDIDATE'S NOTES ON GAPS (already known, don't ask again)\n${o.gapNotes}\n` : ''}
WHAT THE CANDIDATE ALREADY TOLD US (never ask these again)
${o.known || '(nothing yet)'}

THEIR STORY, IN THEIR OWN WORDS (for cover letters)
${o.story || '(not written yet: ask the cover-letter questions)'}

Ask 3 to 6 questions, most valuable first. Good questions:
- what genuinely draws them to this company or role (for the cover letter's opening), with a suggested answer based on what the company actually does;
- which of their real roles or projects to lead with for this job's top requirement ("choice" between their actual entries);
- a gap from the fit notes: whether they have related experience the resume doesn't show (ask them to describe it briefly);
- a missing specific that would make a key bullet concrete: a number, scale, tool or outcome;
- for the cover letter, which tells their story rather than their resume: unless THEIR STORY below already answers it, ask about their genuine personal connection to this company or what it makes (do they use it, care about the problem, have a moment that ties them to it?), and something from their life outside work that shows why this role fits who they are;
- anything a real application form for this job will need that isn't known: work authorisation or visa sponsorship for the job's country, salary expectation, earliest start date, relocation.
Each question must be answerable in under a minute. Never ask what the resume already says. Never ask about age, gender, ethnicity, health or other personal characteristics.

Return ONLY JSON:
{"intro": string, "questions": [{"question": string, "why": string, "kind": "text"|"longtext"|"choice"|"yesno"|"number", "options": [string], "suggested": string, "required": boolean, "reusable": boolean}]}
- "intro": 1 to 2 friendly sentences to the candidate: the angle you plan to take for this role, and that a few answers will make it theirs. No em dashes.
- "why": one short line on how the answer changes the application.
- "suggested": a sensible draft answer they can accept as is (for "choice", one of the options). For questions about their experience, numbers or skills, the suggestion may only restate what the resume already says; if the resume doesn't say it, leave "suggested" empty. Never invent experience in a suggestion.
- "required": true only for facts the application form will need (logistics). Personalisation questions are optional.
- "reusable": true for facts that hold for every application (sponsorship, salary, start date, relocation, a skill they have); false for answers specific to this job.`;

/** Ask the candidate what Hermes needs to make the draft theirs. Returns true when it's now waiting on them. */
async function interviewCandidate(id: string, h: RunHandle, priority: number): Promise<boolean> {
  const job = getJob(id)!;
  const profile = getProfile()!;
  const a = job.analysis;
  setWork(id, 'tailor', { state: 'running', step: 'Working out what to ask you' });
  h.log('Interviewing you before drafting');
  const raw = await askJson<any>({
    prompt: INTERVIEW_PROMPT({
      profile: profileBrief(profile),
      prefs: preferencesBrief(getPreferences()),
      job: jobBrief(job, 7000),
      analysis: a ? `Fit ${a.score}/100 (${a.verdict}). ${a.summary}\nGaps: ${a.whyNo.map(x => x.point).join('; ')}\nKey requirements: ${a.mustHaves.map(m => `${m.requirement} [${m.met}]`).join('; ')}` : '',
      known: knownFacts(),
      gapNotes: gapNotesBlock(job),
      story: profile.story?.trim(),
    }),
    handle: h,
    priority,
    timeoutSec: 240,
    model: getSettings().hermes.tailorModel || undefined,
  });
  const qs = normQuestions(raw?.questions, 'interview');
  const open = qs.filter(q => !q.answer);
  if (!open.length) {
    updateJob(id, j => {
      j.questions = mergeQuestions(j.questions, qs);
      j.interview = { askedAt: now(), doneAt: now() };
    });
    return false;
  }
  updateJob(
    id,
    j => {
      j.questions = mergeQuestions(j.questions, qs);
      j.interview = { askedAt: now() };
      j.work.tailor = { state: 'done', at: now() };
      j.status = 'needs_input';
      j.statusChangedAt = now();
      j.order = nextOrder('needs_input');
      pushChat(j, {
        from: 'hermes',
        kind: 'interview',
        text: noEmDash(str(raw?.intro, 700)) || "Before I write anything, a few questions so this application sounds like you.",
        questionIds: qs.map(q => q.id),
      });
    },
    { at: now(), text: `Hermes has ${open.length} question${open.length > 1 ? 's' : ''} before drafting`, kind: 'agent' },
  );
  finishRun(h, true, `${open.length} question(s) before drafting`);
  toast('info', `${job.company}: Hermes has ${open.length} question${open.length > 1 ? 's' : ''} before drafting`);
  return true;
}

/** Stop interviewing and write the first draft with whatever has been answered. */
export function startDrafting(id: string, instructions?: string) {
  updateJob(id, j => {
    for (const q of j.questions) if (q.stage === 'interview' && !q.answer?.trim()) q.skipped = true;
    j.interview = { askedAt: j.interview?.askedAt || now(), doneAt: now() };
  });
  return prepareApplication(id, { priority: 1, instructions });
}

// ====================== COVER LETTER ======================

const COVER_PROMPT = (o: { name: string; company: string; job: string; story: string; resume: string; answers: string; gapNotes: string; previous?: string; instructions?: string }) => `Write ${o.name}'s cover letter for the job below.

This letter is NOT a resume summary. The resume already covers skills, tools and achievements; the reader will have it open. The letter is about the person: a short first-person story that answers "why me, and why this job".

JOB
${o.job}

THE CANDIDATE'S STORY, IN THEIR OWN WORDS (who they are beyond the resume: the main material for this letter)
${o.story || '(not written yet)'}
${o.answers ? `\nWHAT THEY TOLD YOU ABOUT THIS APPLICATION (their reasons, their connection to this company: use it)\n${o.answers}\n` : ''}${o.gapNotes ? `\nTHEIR NOTES\n${o.gapNotes}\n` : ''}
THEIR RESUME (background only: don't recite it)
${o.resume}
${o.previous ? `\nCURRENT LETTER (revise this rather than starting over)\n${o.previous}\n` : ''}${o.instructions ? `\nTHE CANDIDATE'S REQUEST\n${o.instructions}\n` : ''}
What the letter should do, as one connected narrative:
1. Open with the punch line: why THIS job at ${o.company} matters to them personally, tied to something specific about the company (a product, a decision or a problem named in the posting), not generic praise the posting already says about itself. No "I am writing to apply".
2. Show who they are beyond work: what they do, make or care about in real life, and how that shapes the way they work.
3. Look forward: why this role fits them as a person and what they want to do there, in human terms rather than a list of qualifications.
4. Close with a clear, warm next step (e.g. that they'd love to talk about it).
At most ONE short real story or example, ideally with what came of it, chosen to show who they are; no lists of achievements, metrics, tools or job titles.

Truth: use ONLY facts from their story, their answers, their notes and the resume. Never invent hobbies, experiences, feelings, places or a personal connection to the company. If the personal material is thin, write a shorter, honest letter built on what's there rather than making anything up.

Style: warm, specific, natural first person; 200 to 300 words; 3 to 4 paragraphs; plain text with a blank line between paragraphs. Greeting "Dear ${o.company} team," unless a person is named in the posting. Sign off with "${o.name}". No em dashes, no clichés ("passionate", "thrilled", "excited to apply", "dynamic", "fast-paced", "leverage", "synergy", "proven track record").

Return ONLY JSON: {"coverLetter": string}`;

function resumeForPrompt(r: TailoredResume) {
  return [
    r.headline,
    r.summary,
    `Skills: ${r.skills.map(s => `${s.group}: ${s.items.join(', ')}`).join(' | ')}`,
    ...r.experience.map(e => `${e.title} at ${e.company} (${[e.start, e.end].filter(Boolean).join(' to ')})\n${e.bullets.map(b => `- ${b}`).join('\n')}`),
    ...r.projects.map(p => `Project: ${p.name}\n${p.bullets.map(b => `- ${b}`).join('\n')}`),
  ]
    .filter(Boolean)
    .join('\n');
}

export async function writeCoverLetter(job: Job, resume: TailoredResume, h: RunHandle, opts: { priority: number; previous?: string; instructions?: string }): Promise<string> {
  const raw = await askJson<any>({
    prompt: COVER_PROMPT({
      name: resume.name,
      company: job.company,
      story: getProfile()?.story?.trim() || '',
      job: jobBrief(job, 5000),
      resume: resumeForPrompt(resume).slice(0, 7000),
      answers: answersBlock(job),
      gapNotes: gapNotesBlock(job),
      previous: opts.previous,
      instructions: opts.instructions,
    }),
    handle: h,
    priority: opts.priority,
    timeoutSec: 240,
    model: getSettings().hermes.tailorModel || undefined,
  });
  const text = noEmDash(str(raw?.coverLetter, 5000));
  if (!text) throw new Error('Hermes returned an empty cover letter.');
  return text;
}

/** Rewrite just the cover letter, leaving the resume as it is. */
export function reviseCoverLetter(id: string, instructions: string, priority = 1, opts: { fresh?: boolean } = {}): Promise<Job> {
  return once(`tailor:${id}`, async () => {
    const job = getJob(id);
    if (!job?.packet) throw new Error('No draft yet');
    const h = startRun('tailor', `Revising cover letter · ${job.title} @ ${job.company}`, id);
    setWork(id, 'tailor', { state: 'running', step: 'Rewriting your cover letter', error: undefined });
    try {
      const text = await writeCoverLetter(job, job.packet.resume, h, { priority, previous: opts.fresh ? undefined : job.packet.coverLetter, instructions: opts.fresh ? undefined : instructions });
      const updated = updateJob(
        id,
        j => {
          pushHistory(j);
          j.packet = { ...j.packet!, coverLetter: text, note: instructions.slice(0, 120), generatedAt: now(), approvedAt: undefined };
          j.work.tailor = { state: 'done', at: now() };
          pushChat(j, { from: 'hermes', kind: 'revision', text: opts.fresh ? 'Wrote a new cover letter from scratch; the resume is unchanged. The previous letter is under Versions.' : 'Rewrote the cover letter. Take a look on the right.' });
        },
        { at: now(), text: `Hermes revised the cover letter: “${instructions.slice(0, 80)}”`, kind: 'agent' },
      )!;
      finishRun(h, true, 'Cover letter revised');
      return updated;
    } catch (err: any) {
      setWork(id, 'tailor', isPausedError(err) ? null : { state: 'error', error: err.message });
      if (!isPausedError(err)) addChat(id, { from: 'hermes', kind: 'error', text: `I couldn't rewrite the cover letter: ${err.message}` });
      finishRun(h, false, undefined, err.message);
      throw err;
    }
  });
}

export function restoreVersion(id: string, index: number) {
  return updateJob(
    id,
    j => {
      const v = j.packetHistory?.[index];
      if (!v) return;
      const history = (j.packetHistory || []).filter((_, i) => i !== index);
      j.packetHistory = history;
      pushHistory(j);
      j.packet = { ...v.packet, approvedAt: undefined };
      pushChat(j, { from: 'hermes', kind: 'status', text: `Restored the earlier version: “${v.note}”.` });
    },
    { at: now(), text: 'You restored an earlier draft', kind: 'user' },
  );
}

// ====================== CHAT ======================

const CHAT_PROMPT = (o: { role: string; job: string; fit: string; draft: string; answers: string; history: string; message: string }) => `You are Hermes, a sharp, warm career agent working WITH one candidate on their application for ${o.role}. You share a workspace: they see the job posting, this chat, and the live resume and cover letter.

JOB (excerpt)
${o.job}

FIT NOTES
${o.fit}

CURRENT DRAFT
${o.draft}

WHAT THE CANDIDATE HAS TOLD YOU FOR THIS APPLICATION
${o.answers || '(nothing yet)'}

RECENT CONVERSATION
${o.history || '(none)'}

THE CANDIDATE JUST SAID
"""${o.message}"""

Decide what to do:
- "revise": they want a change to the resume and/or cover letter and you have what you need. Write a precise brief for the writer in "instructions" (what to change and where, plus any facts they just gave you) and set "target".
- "draft": there is no draft yet and they want you to go ahead, or they gave you enough to start.
- "ask": you need a fact or a preference to do it well, or the request is ambiguous in a way that changes the result. Ask 1 to 3 short questions instead of guessing.
- "none": a question or comment that only needs a reply (e.g. "why did you drop X?", "what's my weakest point here?", "how should I address that?"). Answer it, and if a change would help, offer it in one sentence and let them say yes. Never revise in response to a question: only revise when they ask you to change something.

Return ONLY JSON:
{"reply": string, "action": "revise"|"draft"|"ask"|"none", "target": "resume"|"cover"|"both", "instructions": string, "questions": [{"question": string, "why": string, "kind": "text"|"longtext"|"choice"|"yesno"|"number", "options": [string], "suggested": string, "reusable": boolean}]}
"reply": 1 to 4 sentences, first person, plain and specific: say what you'll do, or answer honestly. No em dashes. Never promise to add experience they haven't described.`;

function draftForPrompt(job: Job) {
  if (!job.packet) return '(no draft yet: you interviewed the candidate first)';
  return `RESUME\n${resumeForPrompt(job.packet.resume)}\n\nCOVER LETTER\n${job.packet.coverLetter}`.slice(0, 9000);
}

async function waitForTailor(id: string) {
  await (inflight.get(`tailor:${id}`) as Promise<unknown> | undefined)?.catch(() => {});
}

/** A message from you in the workspace. Hermes replies, asks, or revises the draft. */
export async function chatWithHermes(id: string, text: string) {
  const job = getJob(id);
  if (!job) throw new Error('Job not found');
  const message = text.trim().slice(0, 4000);
  if (!message) return job;
  unpause(id);
  updateJob(id, j => pushChat(j, { from: 'you', text: message }));
  const h = startRun('chat', `Chat · ${job.title} @ ${job.company}`, id);
  setWork(id, 'chat', { state: 'queued', step: 'Reading your message' });
  try {
    const a = job.analysis;
    const history = (job.chat || [])
      .slice(-12)
      .map(m => `${m.from === 'you' ? 'Candidate' : 'Hermes'}: ${m.text}${m.questionIds?.length ? ` [asked: ${m.questionIds.map(qid => job.questions.find(q => q.id === qid)?.question).filter(Boolean).join(' / ')}]` : ''}`)
      .join('\n');
    const raw = await askJson<any>({
      prompt: CHAT_PROMPT({
        role: `${job.title} at ${job.company}`,
        job: jobBrief(job, 3500),
        fit: a ? `Fit ${a.score}/100 (${a.verdict}). ${a.summary} Gaps: ${a.whyNo.map(x => x.point).join('; ')}` : '(not analysed)',
        draft: draftForPrompt(job),
        answers: [answersBlock(job), gapNotesBlock(job)].filter(Boolean).join('\n'),
        history,
        message,
      }),
      handle: h,
      priority: 2,
      timeoutSec: 180,
      onStart: () => setWork(id, 'chat', { state: 'running', step: 'Hermes is thinking' }),
    });
    const action = oneOf(raw?.action, ['revise', 'draft', 'ask', 'none'] as const, 'none');
    const target = oneOf(raw?.target, ['resume', 'cover', 'both'] as const, 'both');
    const questions = action === 'ask' ? normQuestions(raw?.questions, getJob(id)?.packet ? 'draft' : 'interview').slice(0, 3).map(q => ({ ...q, required: false })) : [];
    const instructions = str(raw?.instructions, 1500) || message;
    updateJob(id, j => {
      if (questions.length) j.questions = mergeQuestions(j.questions, questions);
      pushChat(j, {
        from: 'hermes',
        kind: questions.length ? 'questions' : 'reply',
        text: noEmDash(str(raw?.reply, 1500)) || (action === 'revise' ? 'On it.' : 'Okay.'),
        questionIds: questions.length ? questions.map(q => q.id) : undefined,
      });
      delete j.work.chat;
    });
    finishRun(h, true, action);

    const fresh = getJob(id)!;
    if (action === 'revise' && fresh.packet) {
      await waitForTailor(id);
      if (target === 'cover') reviseCoverLetter(id, instructions).catch(() => {});
      else prepareApplication(id, { refine: true, instructions, priority: 1, keepCoverLetter: target === 'resume' }).catch(() => {});
    } else if (action === 'draft' || (action === 'revise' && !fresh.packet)) {
      await waitForTailor(id);
      startDrafting(id, instructions).catch(() => {});
    }
    return getJob(id);
  } catch (err: any) {
    updateJob(id, j => {
      delete j.work.chat;
      if (!isPausedError(err)) pushChat(j, { from: 'hermes', kind: 'error', text: `I couldn't reply just now: ${err.message.split('\n')[0]}` });
    });
    finishRun(h, false, undefined, err.message);
    throw err;
  }
}

export function prepareApplication(id: string, opts: PrepareOptions & { priority?: number } = {}): Promise<Job> {
  return once(`tailor:${id}`, async () => {
    let job = getJob(id);
    if (!job) throw new Error('Job not found');
    const profile = getProfile();
    if (!profile) throw new Error('Add your resume first.');
    unpause(id);
    job = getJob(id)!;
    const { priority: _p, ...redoOpts } = opts;
    preparing.set(id, redoOpts);

    const h = startRun('tailor', `${opts.refine ? 'Refining' : 'Preparing'} application · ${job.title} @ ${job.company}`, id);
    if (!opts.refine && job.status !== 'preparing') {
      updateJob(id, j => {
        j.status = 'preparing';
        j.statusChangedAt = now();
        j.order = nextOrder('preparing');
      }, { at: now(), text: 'Hermes started preparing your application', kind: 'agent' });
    }
    setWork(id, 'tailor', { state: 'running', step: opts.refine ? (opts.fresh ? 'Rewriting your resume from scratch' : opts.keywords?.length ? 'Working in ATS keywords' : opts.instructions ? 'Revising your application' : 'Working your answers in') : 'Analyzing fit', error: undefined });

    try {
      if (!job.analysis) {
        h.log('Running fit analysis first');
        await analyzeJob(id, { handle: h, priority: opts.priority ?? 1 });
        job = getJob(id)!;
      }
      // Ask before deciding: Hermes interviews you once, before the first draft.
      if (!opts.refine && !opts.skipInterview && !job.packet && !job.interview && getSettings().apply?.interviewFirst !== false) {
        if (await interviewCandidate(id, h, opts.priority ?? 1)) return getJob(id)!;
        job = getJob(id)!;
      }
      setWork(id, 'tailor', { state: 'running', step: opts.refine ? (opts.fresh ? 'Rewriting your resume from scratch' : opts.keywords?.length ? 'Working in ATS keywords' : opts.instructions ? 'Revising your application' : 'Working your answers in') : 'Tailoring resume & cover letter' });
      h.log('Writing tailored resume, cover letter and answers');

      const { resumeText: _omit, ...profileForPrompt } = profile;
      const a = job.analysis!;
      const analysisNotes = [
        `Fit score: ${a.score}/100 (${a.verdict}). ${a.summary}`,
        `Gaps: ${a.whyNo.map(x => x.point).join('; ')}`,
        `Key requirements: ${a.mustHaves.map(m => `${m.requirement} [${m.met}]`).join('; ')}`,
        `ATS keywords: ${a.keywords.join(', ')}`,
      ].join('\n');
      const userAnswers = answersBlock(job);

      const raw = await askJson<any>({
        prompt: TAILOR_PROMPT({
          profileJson: JSON.stringify(profileForPrompt),
          prefs: preferencesBrief(getPreferences()),
          job: jobBrief(job, 8000),
          analysis: analysisNotes,
          known: knownFacts(),
          gapNotes: gapNotesBlock(job),
          userAnswers,
          refine: Boolean(opts.refine),
          interviewed: Boolean(job.interview?.doneAt),
          instructions: [opts.instructions, opts.keywords?.length ? keywordBrief(a.keywords, opts.keywords) : ''].filter(Boolean).join('\n').slice(0, 2000) || undefined,
          previous: opts.refine && !opts.fresh && job.packet ? JSON.stringify({ resume: { ...job.packet.resume, contact: undefined }, coverLetter: job.packet.coverLetter, answers: job.packet.answers }).slice(0, 9000) : undefined,
        }),
        handle: h,
        timeoutSec: 360,
        model: getSettings().hermes.tailorModel || undefined,
        priority: opts.priority ?? 1,
      });

      setWork(id, 'tailor', { state: 'running', step: 'Checking what to ask you' });
      const base = normResume(raw.resume);
      const resume: TailoredResume = {
        name: profile.name,
        contact: { email: profile.email, phone: profile.phone, location: profile.location, links: profile.links },
        ...base,
        experience: keepFullExperience(base.experience, profile.experience),
        education: base.education.length ? base.education : profile.education,
      };
      scrubEmDashes(resume);
      const before = coverage(a.keywords, profile.resumeText);
      const after = coverage(a.keywords, resumeText(resume));
      const packet: Packet = {
        resume,
        // A refine pass that comes back without a cover letter or answers keeps the previous ones.
        // Resume-only changes (and keyword passes) leave the letter alone; otherwise it's rewritten below.
        coverLetter: ((opts.keepCoverLetter || opts.keywords?.length) && job.packet?.coverLetter) || '',
        answers: (() => {
          const fresh = (Array.isArray(raw.answers) ? raw.answers : []).slice(0, 6).map((x: any) => ({ question: str(x?.question, 300), answer: str(x?.answer, 2500) })).filter((x: any) => x.question && x.answer);
          return fresh.length ? fresh : job.packet?.answers || [];
        })(),
        changes: (Array.isArray(raw.changes) ? raw.changes : []).slice(0, 8).map((x: any) => ({ what: str(x?.what ?? x, 300), why: str(x?.why, 300) })).filter((x: any) => x.what),
        keywordCoverage: { before: before.pct, after: after.pct, missing: after.missing },
        generatedAt: now(),
        model: getSettings().hermes.model,
        note: opts.note || (opts.refine ? (opts.keywords?.length ? 'Worked in ATS keywords' : opts.instructions?.slice(0, 120) || 'Worked in your answers') : 'First draft'),
        resumeHash: resumeHash(profile),
      };

      // Every application gets a cover letter, whether or not the form asks for one.
      if (!packet.coverLetter.trim()) {
        setWork(id, 'tailor', { state: 'running', step: 'Writing your cover letter' });
        h.log('Writing your cover letter');
        packet.coverLetter = await writeCoverLetter(job, resume, h, { priority: opts.priority ?? 1, instructions: opts.instructions, previous: opts.refine ? job.packet?.coverLetter : undefined });
      }

      if (profile.latexSource) {
        setWork(id, 'tailor', { state: 'running', step: 'Writing your LaTeX resume' });
        try {
          const lx = await tailorLatex(job, resume, h, { priority: opts.priority ?? 1, keywords: opts.keywords, instructions: opts.instructions && opts.keywords?.length ? keywordBrief(a.keywords, opts.keywords) : opts.instructions, refine: opts.refine && !opts.fresh });
          const { edits, slots, ...latexFields } = lx;
          Object.assign(packet, latexFields);
          if (edits && slots && packet.latexStatus !== 'error') {
            packet.resume = syncResumeFromSlots(packet.resume, slots, edits);
            const synced = coverage(a.keywords, resumeText(packet.resume));
            packet.keywordCoverage = { before: before.pct, after: synced.pct, missing: synced.missing };
          } else if (opts.refine && job.packet && lx.latex === job.packet.latex) {
            // The revision didn't compile and the PDF stayed as it was: so does everything else.
            packet.resume = job.packet.resume;
            packet.keywordCoverage = job.packet.keywordCoverage;
          }
        } catch (err: any) {
          packet.latexStatus = 'error';
          packet.latexError = err.message;
        }
        if (packet.latexStatus === 'error') h.log(`LaTeX version failed (${packet.latexError}); the built-in PDF is used instead.`);
      }

      // After the interview, the drafting pass may only add what an application form needs
      // (sponsorship, salary, start date…); anything else it "wonders" isn't worth blocking on.
      const drafted = opts.refine ? [] : normQuestions(raw.questions, 'draft');
      const newQuestions = job.interview?.doneAt ? drafted.filter(q => category(q.question)).slice(0, 3) : drafted.slice(0, 5);
      // A keyword pass may never lose ground, and keywords that still don't fit aren't offered again.
      if (opts.keywords?.length && job.packet && packet.keywordCoverage) {
        const prev = { ...coverage(a.keywords, resumeText(job.packet.resume)), unfit: job.packet.keywordCoverage?.unfit || [] };
        const cov = packet.keywordCoverage;
        if (cov.after < prev.pct) {
          updateJob(
            id,
            j => {
              j.packet!.keywordCoverage = { before: before.pct, after: prev.pct, missing: prev.missing, unfit: [...new Set([...prev.unfit, ...opts.keywords!])].filter(k => prev.missing.includes(k)) };
              j.work.tailor = { state: 'done', at: now() };
              pushChat(j, { from: 'hermes', kind: 'revision', text: "I couldn't work those keywords in without losing ones already there, so your current version stays. The ones left don't match your experience, so I won't push them again." });
            },
            { at: now(), text: 'Keyword pass kept your current version (it would have scored lower)', kind: 'agent' },
          );
          finishRun(h, true, `Kept the current version (${prev.pct}% vs ${cov.after}%)`);
          return getJob(id)!;
        }
        cov.unfit = [...new Set([...prev.unfit, ...opts.keywords])].filter(k => cov.missing.includes(k));
      } else if (opts.refine && job.packet?.keywordCoverage?.unfit?.length && packet.keywordCoverage) {
        packet.keywordCoverage.unfit = job.packet.keywordCoverage.unfit.filter(k => packet.keywordCoverage!.missing.includes(k));
      }
      const firstDraft = !job.packet;
      if (isJobPaused(id)) throw new Error(PAUSED);
      const updated = updateJob(
        id,
        j => {
          pushHistory(j);
          const added = newQuestions.filter(q => !j.questions.some(x => sameQuestion(x.question, q.question)));
          j.packet = packet;
          j.packet.approvedAt = undefined;
          j.questions = mergeQuestions(j.questions, newQuestions);
          j.work.tailor = { state: 'done', at: now() };
          const cov = packet.keywordCoverage;
          pushChat(j, {
            from: 'hermes',
            kind: firstDraft ? 'draft' : 'revision',
            text: firstDraft
              ? `Your first draft is ready: tailored resume and cover letter are on the right${cov && cov.after > cov.before ? `, ATS keyword match ${cov.before}% to ${cov.after}%` : ''}. Tell me anything you'd like changed.`
              : !opts.refine
                ? 'Wrote a fresh version from scratch. The previous one is under Versions if you want it back.'
                : opts.fresh
                ? 'Rewrote your resume from scratch for this job; the cover letter is unchanged. The previous version is under Versions.'
                : opts.keywords?.length
                ? `Worked in the keywords that fit${cov ? `: ATS match is now ${cov.after}%` : ''}.`
                : opts.instructions
                  ? packet.changes.length
                    ? 'Done. Here is what changed:'
                    : 'Done. The updated version is on the right.'
                  : 'Worked your answers in.',
            changes: packet.changes.length ? packet.changes : undefined,
          });
          const open = added.filter(q => !q.answer);
          if (open.length) pushChat(j, { from: 'hermes', kind: 'questions', text: 'A couple of things I need from you before this can go out:', questionIds: added.map(q => q.id) });
          if (j.status === 'preparing') {
            j.status = 'needs_input';
            j.statusChangedAt = now();
            j.order = nextOrder('needs_input');
          }
        },
        {
          at: now(),
          text: opts.refine
            ? opts.instructions
              ? `Hermes revised the application: “${opts.instructions.slice(0, 80)}”`
              : 'Hermes updated the application with your answers'
            : `Application drafted · ATS keyword match ${before.pct}% → ${after.pct}%` + (newQuestions.filter(q => !q.answer).length ? ` · ${newQuestions.filter(q => !q.answer).length} question(s) for you` : ''),
          kind: 'agent',
        },
      )!;
      const pending = updated.questions.filter(q => q.required && !q.answer).length;
      finishRun(h, true, pending ? `${pending} question(s) need your input` : 'Ready for your review');
      toast('success', pending ? `${job.company}: Hermes has ${pending} question${pending > 1 ? 's' : ''} for you` : `${job.company}: application ready for review`);
      return updated;
    } catch (err: any) {
      if (isPausedError(err)) {
        setWork(id, 'tailor', null);
        finishRun(h, false, undefined, err.message);
        throw err;
      }
      setWork(id, 'tailor', { state: 'error', error: err.message });
      addChat(id, { from: 'hermes', kind: 'error', text: `I hit a snag: ${err.message.split('\n')[0]}` });
      finishRun(h, false, undefined, err.message);
      toast('error', `Couldn't prepare ${job.company}: ${err.message}`);
      throw err;
    } finally {
      preparing.delete(id);
    }
  });
}

// ====================== PAUSE ======================

/** What each in-flight draft was asked to do, so Resume can start it again. */
const preparing = new Map<string, PrepareOptions>();

function unpause(id: string) {
  resumeJobCalls(id);
  if (getJob(id)?.paused) updateJob(id, j => void (j.paused = undefined));
}

/** Stop Hermes working on this job until you resume it. A draft you already have stays as it is. */
export function pauseJob(id: string) {
  const job = getJob(id);
  if (!job) throw new Error('Job not found');
  const busy = (k: TaskKind) => ['running', 'queued'].includes(job.work[k]?.state || '');
  const redo = busy('tailor') && preparing.has(id) ? 'tailor' : busy('analyze') ? 'analyze' : undefined;
  pauseJobCalls(id);
  return updateJob(
    id,
    j => {
      j.paused = { at: now(), redo, opts: redo === 'tailor' ? preparing.get(id) : undefined };
      for (const k of Object.keys(j.work) as TaskKind[]) if (['running', 'queued'].includes(j.work[k]?.state || '')) delete j.work[k];
      // A paused re-draft goes back to Needs you with the draft it already had.
      if (j.status === 'preparing' && j.packet) {
        j.status = 'needs_input';
        j.statusChangedAt = now();
        j.order = nextOrder('needs_input');
      }
    },
    { at: now(), text: 'You paused Hermes on this job', kind: 'user' },
  );
}

/** Pick up where the pause left off. */
export async function resumeJob(id: string) {
  const job = getJob(id);
  if (!job) throw new Error('Job not found');
  const p = job.paused;
  // Let the work the pause stopped finish unwinding first, or it would look like a failure.
  await Promise.allSettled([inflight.get(`tailor:${id}`), inflight.get(`analyze:${id}`)]);
  unpause(id);
  updateJob(id, () => {}, { at: now(), text: 'You resumed Hermes on this job', kind: 'user' });
  if (p?.redo === 'tailor') prepareApplication(id, { ...p.opts, priority: 1 }).catch(() => {});
  else if (p?.redo === 'analyze') analyzeJob(id, { force: true, priority: 1 }).catch(() => {});
  return getJob(id);
}

/** Drafts in Needs you that were tailored from an older resume. */
export function staleDrafts(): Job[] {
  const profile = getProfile();
  const hash = resumeHash(profile);
  return listJobs().filter(j => j.status === 'needs_input' && !j.paused && isStaleDraft(j, profile, hash) && !['running', 'queued'].includes(j.work.tailor?.state || ''));
}

/** Re-draft from scratch against the current resume, keeping answers, gap notes and questions. */
export function refreshStaleDrafts(ids?: string[]): string[] {
  const jobs = staleDrafts().filter(j => !ids || ids.includes(j.id));
  for (const j of jobs) {
    addChat(j.id, { from: 'hermes', kind: 'status', text: 'Your resume changed, so I am rewriting this draft from it. Your answers carry over.' });
    prepareApplication(j.id, { priority: 0, skipInterview: true, note: 'Refreshed with new resume' }).catch(() => {});
  }
  return jobs.map(j => j.id);
}

export async function answerQuestions(id: string, answers: { id: string; answer: string; remember?: boolean; skip?: boolean }[], refine = true) {
  const job = getJob(id);
  if (!job) throw new Error('Job not found');
  const given = answers.filter(a => a.answer?.trim()).length;
  updateJob(
    id,
    j => {
      for (const a of answers) {
        const q = j.questions.find(q => q.id === a.id);
        if (!q) continue;
        const text = String(a.answer || '').trim();
        q.answer = text || undefined;
        q.skipped = !text && Boolean(a.skip);
      }
    },
    { at: now(), text: given ? `You answered ${given} question${given === 1 ? '' : 's'}` : 'You left the questions to Hermes', kind: 'user' },
  );
  for (const a of answers) {
    const q = job.questions.find(q => q.id === a.id);
    const remember = a.remember ?? q?.reusable ?? true;
    if (q && remember && a.answer?.trim()) upsertAnswer(q.question, a.answer.trim());
  }
  const fresh = getJob(id)!;
  if (interviewPending(fresh)) {
    // Once every interview question is answered or left to Hermes, the first draft starts.
    const open = fresh.questions.filter(q => q.stage === 'interview' && !q.answer && !q.skipped);
    if (!open.length) startDrafting(id).catch(() => {});
  } else if (refine && fresh.packet) {
    await waitForTailor(id);
    prepareApplication(id, { refine: true, priority: 1 }).catch(() => {});
  }
  return getJob(id);
}

// ====================== STATUS MOVES ======================

export function moveJob(id: string, status: JobStatus, opts: { reason?: ArchiveReason; index?: number } = {}) {
  const job = getJob(id);
  if (!job) throw new Error('Job not found');
  const from = job.status;
  if (from === status && opts.index == null) return job;

  if (interviewPending(job) && status === 'preparing') {
    // Dragging back to Hermes while it waits on your answers means "go ahead without them".
    startDrafting(id).catch(() => {});
    return getJob(id);
  }
  if (status === 'preparing' && job.packet) {
    // Dragging a draft back to Hermes rewrites it from scratch (with your current resume).
    if (refreshStaleDrafts([id]).length) return getJob(id);
    prepareApplication(id, { skipInterview: true, note: 'Fresh draft' }).catch(() => {});
    return getJob(id);
  }
  if (status === 'preparing' || (status === 'needs_input' && !job.packet && from !== 'needs_input')) {
    // Dragging into the agent's lane starts the work.
    prepareApplication(id).catch(() => {});
    return getJob(id);
  }

  const labels: Record<JobStatus, string> = {
    discovered: 'Moved back to Discovered',
    preparing: 'Preparing',
    needs_input: 'Waiting on you',
    applied: 'Marked as applied',
    interviewing: 'Interviewing 🎉',
    offer: 'Offer received 🎉',
    archived: opts.reason === 'rejected' ? 'Closed — not selected' : opts.reason === 'withdrawn' ? 'Withdrawn' : 'Archived',
  };
  return updateJob(
    id,
    j => {
      j.status = status;
      j.statusChangedAt = now();
      j.order = opts.index ?? nextOrder(status);
      // Moving a card on yourself overrides an earlier rejection read from email.
      if ((status === 'interviewing' || status === 'offer' || status === 'discovered') && j.outcome?.kind === 'rejection') j.outcome = undefined;
      if (status === 'applied' && !j.appliedAt) {
        j.appliedAt = now();
        j.appliedVia = j.appliedVia || 'manual';
      }
      if (status === 'archived') {
        j.archivedReason = opts.reason || 'dismissed';
        j.archivedFrom = from;
      } else {
        j.archivedReason = undefined;
      }
    },
    from === status ? undefined : { at: now(), text: labels[status], kind: 'status' },
  );
}

export function reorderColumn(status: JobStatus, ids: string[]) {
  ids.forEach((id, i) => {
    const j = getJob(id);
    if (j && j.status === status && j.order !== i) updateJob(id, x => (x.order = i));
  });
}

export function markApplied(id: string, via: 'assisted' | 'auto' | 'manual') {
  const job = getJob(id);
  if (!job) throw new Error('Job not found');
  return updateJob(
    id,
    j => {
      j.status = 'applied';
      j.statusChangedAt = now();
      j.appliedAt = now();
      j.appliedVia = via;
      j.order = nextOrder('applied');
      if (j.packet && !j.packet.approvedAt) j.packet.approvedAt = now();
    },
    { at: now(), text: via === 'assisted' ? 'Application submitted with the Apply kit' : 'Marked as applied', kind: 'status' },
  );
}

// ====================== GAP NOTES ======================

export function setGapNote(id: string, point: string, response: string, remember = true) {
  const job = getJob(id);
  if (!job) throw new Error('Job not found');
  const text = response.trim();
  const updated = updateJob(id, j => {
    const notes = (j.gapNotes || []).filter(n => n.point !== point);
    if (text) notes.push({ point, response: text, at: now() });
    j.gapNotes = notes;
  });
  // Experience you describe once helps every future application, not just this one.
  if (text && remember) upsertAnswer(`Experience related to: ${point}`, text);
  return updated;
}

/** Re-score with the candidate's notes, then (re)write the application around them. */
export async function applyGapNotes(id: string) {
  const job = getJob(id);
  if (!job) throw new Error('Job not found');
  updateJob(id, () => {}, { at: now(), text: `You added notes on ${job.gapNotes?.length || 0} gap(s) — Hermes is re-scoring and rewriting`, kind: 'user' });
  await analyzeJob(id, { force: true, priority: 1 }).catch(() => {});
  const fresh = getJob(id)!;
  return prepareApplication(id, fresh.packet ? { refine: true, priority: 1, instructions: 'The candidate added notes explaining experience behind the gaps flagged in the fit analysis. Rework the resume, cover letter and answers so this experience is clearly visible.' } : { priority: 1 });
}
