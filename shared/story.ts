// The "your story" questions. You answer them in onboarding and on the Profile page; the AI weaves
// the answers into the story your cover letters are written from.

export interface StoryQuestion {
  id: string;
  q: string;
  hint: string;
  placeholder: string;
  optional?: boolean;
}

export const STORY_QUESTIONS: StoryQuestion[] = [
  { id: 'why', q: 'Why do you do this kind of work?', hint: 'What pulled you in? A moment, a person or a project that shaped you.', placeholder: 'e.g. I started by fixing the family computer, then built a website for my school club…' },
  { id: 'proud', q: 'What are you proudest of?', hint: 'Something you made or did, at work or not, and why it mattered to you.', placeholder: 'e.g. Leading the redesign of our checkout, which halved support tickets…' },
  { id: 'next', q: 'What do you want next, and why now?', hint: 'The problems, team or kind of company you want to be part of.', placeholder: 'e.g. A small team where I can own a product end to end, because…' },
  { id: 'life', q: 'Who are you outside work?', hint: 'What you make or do for fun, what you care about, products you love using.', placeholder: 'e.g. I bake sourdough, run on weekends and keep a sketchbook of app ideas…' },
  {
    id: 'more',
    q: 'Anything else we should know about you?',
    hint: 'Optional. Stories, values, how you work, things you would want an employer to know.',
    placeholder: 'e.g. I moved countries for my master’s and learned to ask for help early…',
    optional: true,
  },
];

export const REQUIRED_STORY_QUESTIONS = STORY_QUESTIONS.filter(q => !q.optional);

/** Your answers as they are, one after another: what cover letters fall back on until the AI has woven them. */
export const composeStory = (answers: Record<string, string> = {}) =>
  STORY_QUESTIONS.map(q => answers[q.id]?.trim())
    .filter(Boolean)
    .join('\n\n');
