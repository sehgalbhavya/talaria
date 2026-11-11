// Your story: you answer a few questions, the AI weaves the answers into the first-person story
// your cover letters are written from. Your answers stay the source; the story can be rewoven anytime.

import { composeStory, STORY_QUESTIONS } from '../../shared/story.ts';
import { askJson, callAI, finishRun, startRun } from '../lib/ai/index.ts';
import { getProfile, getSettings, now, setProfile } from '../lib/store.ts';
import { noEmDash } from '../lib/latexSlots.ts';

const WEAVE_PROMPT = (name: string, qa: string) => `Weave ${name}'s answers below into their personal story, which a job-search assistant uses to write their cover letters.

Rules:
- First person, in their own voice: keep their phrasing and words wherever you can, including any warmth or humour.
- Use ONLY what they wrote. Never add facts, numbers, feelings, names, companies or achievements, and never upgrade what they said.
- Keep every concrete detail: names of projects, places, people, tools, hobbies.
- Order it so it reads naturally (what pulled them into this work, what they're proud of, who they are outside work, what they want next), joining the answers with light transitions.
- 2 to 4 short paragraphs of plain prose, roughly as long as their answers together and never more than 350 words. No headings, no bullet points, no em dashes, no quotation marks around it.
- Return only the story.

THEIR ANSWERS
${qa}`;

// The answers the AI is weaving right now, so the same answers handed over twice are woven once.
let inProgress = '';

/** Save your answers right away, then have the AI weave them into your story in the background. `again` reweaves unchanged answers. */
export function saveStory(answers: Record<string, string>, again = false) {
  const profile = getProfile();
  if (!profile) throw new Error('Add your resume first.');
  const clean = Object.fromEntries(STORY_QUESTIONS.map(q => [q.id, (answers[q.id] || '').trim()]).filter(([, a]) => a));
  const key = JSON.stringify(clean);
  if (!again && (key === inProgress || (profile.storyWovenAt && key === JSON.stringify(profile.storyAnswers)))) return;
  const plain = composeStory(clean);
  // Until the AI is done, cover letters use your answers as they are.
  setProfile({ ...profile, storyAnswers: clean, story: plain, storyWovenAt: undefined });
  if (!plain) return;
  inProgress = key;
  weave(clean).finally(() => {
    if (inProgress === key) inProgress = '';
  });
}

async function weave(answers: Record<string, string>) {
  const h = startRun('story', 'Weaving your story');
  try {
    const qa = STORY_QUESTIONS.filter(q => answers[q.id])
      .map(q => `Q: ${q.q}\nA: ${answers[q.id]}`)
      .join('\n\n');
    const res = await callAI({ prompt: WEAVE_PROMPT(getProfile()?.name?.split(' ')[0] || 'the candidate', qa), handle: h, priority: 2, timeoutSec: 240, model: getSettings().ai.tailorModel || undefined });
    const story = noEmDash(res.text.trim().replace(/^["“]|["”]$/g, ''));
    const current = getProfile();
    // Only if your answers didn't change meanwhile: a newer save weaves its own story.
    if (!current || JSON.stringify(current.storyAnswers) !== JSON.stringify(answers) || !story) {
      finishRun(h, true, 'Answers changed meanwhile; woven again from the new ones');
      return;
    }
    setProfile({ ...current, story, storyWovenAt: now() });
    finishRun(h, true, `${story.split(/\s+/).length} words`);
  } catch (err: any) {
    // Your answers are still there as the story, so cover letters keep working.
    finishRun(h, false, undefined, err.message);
  }
}

// ====================== sorting an older story into the questions ======================

/** Your story cut into sentences, each remembering which paragraph it came from. */
function sentences(text: string): { text: string; para: number }[] {
  return text
    .split(/\n\s*\n|\n/)
    .flatMap((p, para) =>
      p
        .split(/(?<=[.!?…])\s+(?=["“(]?[A-Z0-9])/)
        .map(s => s.trim())
        .filter(Boolean)
        .map(s => ({ text: s, para })),
    );
}

/** Sentences back into prose: a space within a paragraph, a blank line between paragraphs. */
const joinSentences = (list: { text: string; para: number }[]) => list.map((s, i) => (i && s.para !== list[i - 1].para ? '\n\n' : i ? ' ' : '') + s.text).join('');

const SORT_PROMPT = (numbered: string) => `Below is a person's story about themselves, split into numbered sentences. Sort the sentences under the question each one answers best:
${STORY_QUESTIONS.filter(q => !q.optional)
  .map(q => `- "${q.id}": ${q.q}`)
  .join('\n')}

A sentence goes under at most one question. Leave out any sentence that doesn't clearly answer one of them; it is kept elsewhere, so leaving it out loses nothing.

Return ONLY JSON, with sentence numbers: {${STORY_QUESTIONS.filter(q => !q.optional)
  .map(q => `"${q.id}": [number]`)
  .join(', ')}}

SENTENCES
${numbered}`;

/**
 * An older free-text story (written before the questions existed) sorted into the questions.
 * the AI only picks which sentences go where; every answer is rebuilt from your own sentences,
 * and anything it doesn't place goes under "Anything else". Your story itself is left as it is.
 */
export async function sortStory() {
  const profile = getProfile();
  const text = profile?.story?.trim();
  if (!profile || !text || profile.storyAnswers) return profile;
  const list = sentences(text);
  const h = startRun('story', 'Sorting your story into the questions');
  try {
    const raw = await askJson<Record<string, unknown>>({ prompt: SORT_PROMPT(list.map((s, i) => `${i + 1}. ${s.text}`).join('\n')), handle: h, priority: 2, timeoutSec: 180 });
    const used = new Set<number>();
    const answers: Record<string, string> = {};
    for (const q of STORY_QUESTIONS.filter(q => !q.optional)) {
      const picked = (Array.isArray(raw?.[q.id]) ? (raw[q.id] as unknown[]) : [])
        .map(n => Number(n) - 1)
        .filter(i => Number.isInteger(i) && i >= 0 && i < list.length && !used.has(i))
        .sort((a, b) => a - b);
      picked.forEach(i => used.add(i));
      if (picked.length) answers[q.id] = joinSentences(picked.map(i => list[i]));
    }
    const rest = list.filter((_, i) => !used.has(i));
    if (rest.length) answers.more = joinSentences(rest);
    const current = getProfile();
    // You may have saved answers of your own while the AI was sorting: yours win.
    if (current && !current.storyAnswers) setProfile({ ...current, storyAnswers: answers });
    finishRun(h, true, `${used.size} of ${list.length} sentences placed under the questions`);
  } catch (err: any) {
    finishRun(h, false, undefined, err.message);
    throw err;
  }
  return getProfile();
}
