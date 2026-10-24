import * as React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check, FileText, Loader2, Pencil, RefreshCw, Sparkles, UploadCloud } from 'lucide-react';
import type { AgentRun, OnboardingProgress, Preferences, Profile, RemotePreference, Seniority } from '@shared/types';
import { api } from '@/lib/api';
import { useApp } from '@/lib/store';
import { navigate } from '@/lib/router';
import { cn } from '@/lib/utils';
import { Button, ChipInput, Field, Input, Segmented, Switch, Textarea } from '@/components/ui';
import { Logo } from '@/components/brand';
import { useElapsed } from '@/components/drawer/hooks';
import { BOARDS, SourcesEditor } from '@/views/Profile';
import { ConnectStep, FooterSlot, NextButton, SkipLink, StepFooter, StepHeader, WelcomeStep } from '@/views/OnboardingSetup';

// The sidebar's sections and the screens inside them. Every step number on screen comes from here.
const SECTIONS = ['Welcome', 'Connect the AI', 'Your resume', 'Your story', "What you're after", 'Is this you?', 'Where to look', 'Review & start'];

type Screen = 'welcome' | 'connect' | 'resume' | 'story' | 'roles' | 'where' | 'matters' | 'you' | 'sources' | 'launch';

const SCREENS: { id: Screen; section: number }[] = [
  { id: 'welcome', section: 0 },
  { id: 'connect', section: 1 },
  { id: 'resume', section: 2 },
  { id: 'story', section: 3 },
  { id: 'roles', section: 4 },
  { id: 'where', section: 4 },
  { id: 'matters', section: 4 },
  { id: 'you', section: 5 },
  { id: 'sources', section: 6 },
  { id: 'launch', section: 7 },
];

const sectionOf = (screen: Screen) => SCREENS.find(s => s.id === screen)!.section;

function kickerFor(screen: Screen) {
  const section = sectionOf(screen);
  const inSection = SCREENS.filter(s => s.section === section);
  const part = inSection.length > 1 ? ` (${inSection.findIndex(s => s.id === screen) + 1} of ${inSection.length})` : '';
  return `Step ${section + 1} of ${SECTIONS.length} · ${SECTIONS[section]}${part}`;
}

type Nav = { kicker: string; next: () => void; back: () => void; go: (screen: Screen) => void };

/** Remembers where you are, so closing the window halfway loses nothing. */
function saveProgress(patch: Partial<OnboardingProgress>) {
  const onboarding = { ...(useApp.getState().settings?.onboarding || {}), ...patch };
  useApp.setState(s => (s.settings ? { settings: { ...s.settings, onboarding } } : s));
  return api.put('/api/settings', { onboarding }, { quiet: true }).catch(() => {});
}

// ---------------- resume reading in the background ----------------

type Reading = { state: 'idle' | 'reading' | 'done' | 'error'; run?: AgentRun };

/** Whether Hermes is reading your resume right now, read from its task so it survives a reload. */
function useResumeReading(): Reading {
  const runs = useApp(s => s.runs);
  const profile = useApp(s => s.profile);
  const resumeName = useApp(s => s.settings?.onboarding?.resumeName);
  const run = runs.filter(r => r.kind === 'profile').sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  if (run && (run.status === 'queued' || run.status === 'running')) return { state: 'reading', run };
  if (run?.status === 'error' && !(profile?.updatedAt && profile.updatedAt > (run.endedAt || run.startedAt))) return { state: 'error', run };
  if (profile) return { state: 'done', run };
  // Just uploaded: the task's first event hasn't arrived yet.
  return { state: resumeName && !run ? 'reading' : 'idle', run };
}

const READING_LINES = ['Reading every line', 'Pulling out your experience', 'Cataloguing your skills', 'Working out which roles fit you', 'Almost there'];

/**
 * Pinned to the top of each screen while Hermes reads your resume, and the place it tells you how
 * that went. It sits in the page rather than in a corner toast, so it never covers a button.
 */
function ReadingBanner({ reading, onRetry, invite }: { reading: Reading; onRetry: () => void; invite?: string }) {
  const { state, run } = reading;
  const elapsed = useElapsed(run?.startedAt, state === 'reading');
  const [justDone, setJustDone] = React.useState(false);
  const prev = React.useRef(state);
  React.useEffect(() => {
    const was = prev.current;
    prev.current = state;
    if (state !== 'done') setJustDone(false);
    else if (was === 'reading') {
      setJustDone(true);
      const t = setTimeout(() => setJustDone(false), 6000);
      return () => clearTimeout(t);
    }
  }, [state]);

  const mode = state === 'reading' ? 'reading' : state === 'error' ? 'error' : justDone ? 'done' : null;
  const line = READING_LINES[Math.min(READING_LINES.length - 1, Math.floor(elapsed / 8))];

  return (
    <AnimatePresence initial={false}>
      {mode && (
        <motion.div
          key="banner"
          initial={{ opacity: 0, height: 0, marginBottom: 0 }}
          animate={{ opacity: 1, height: 'auto', marginBottom: 24 }}
          exit={{ opacity: 0, height: 0, marginBottom: 0 }}
          transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          className="sticky top-4 z-10"
        >
          <div
            className={cn(
              'inline-flex max-w-full items-center gap-2.5 overflow-hidden rounded-full border py-1.5 pr-3.5 pl-2 text-[12.5px] shadow-card backdrop-blur',
              mode === 'reading' && 'agent-sheen border-gold/30 bg-bg/80 text-ink-2',
              mode === 'done' && 'border-ok/30 bg-bg/80 text-ink-2',
              mode === 'error' && 'border-bad/30 bg-bg/80 text-ink-2',
            )}
          >
            <span className={cn('grid size-5 shrink-0 place-items-center rounded-full', mode === 'reading' && 'bg-gold-soft text-gold', mode === 'done' && 'bg-ok-soft text-ok', mode === 'error' && 'bg-bad-soft text-bad')}>
              {mode === 'reading' ? <FileText className="size-3 animate-pulse" /> : mode === 'done' ? <Check className="size-3" strokeWidth={3} /> : <RefreshCw className="size-3" />}
            </span>
            {mode === 'reading' && invite && (
              <>
                <span className="truncate font-medium text-ink">{invite}</span>
                <span className="shrink-0 text-faint tabular-nums">{elapsed}s</span>
              </>
            )}
            {mode === 'reading' && !invite && (
              <>
                <span className="font-medium text-ink">Hermes is reading your resume</span>
                <AnimatePresence mode="wait" initial={false}>
                  <motion.span key={line} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.25 }} className="truncate text-muted">
                    {line}…
                  </motion.span>
                </AnimatePresence>
                <span className="shrink-0 text-faint tabular-nums">{elapsed}s</span>
              </>
            )}
            {mode === 'done' && (
              <span>
                <span className="font-medium text-ink">Done reading your resume.</span> <span className="text-muted">{run?.detail ? `Found ${run.detail}; ` : ''}you'll check it in step {sectionOf('you') + 1}.</span>
              </span>
            )}
            {mode === 'error' && (
              <>
                <span className="font-medium text-ink">Hermes couldn't read your resume.</span>
                <button type="button" onClick={onRetry} className="shrink-0 font-medium text-bad underline-offset-2 hover:underline">
                  Try again
                </button>
              </>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ---------------- the flow ----------------

export function Onboarding() {
  const profile = useApp(s => s.profile);
  const saved = useApp(s => s.settings?.onboarding?.step) as Screen | undefined;
  const [screen, setScreen] = React.useState<Screen>(() => (saved && SCREENS.some(s => s.id === saved) ? saved : profile ? 'story' : 'welcome'));
  const root = React.useRef<HTMLDivElement>(null);
  const scroller = React.useRef<HTMLElement>(null);
  const [footer, setFooter] = React.useState<HTMLDivElement | null>(null);
  const reading = useResumeReading();

  const go = (next: Screen) => {
    setScreen(next);
    saveProgress({ step: next });
    // The right column scrolls on its own on wide screens; on phones the whole page does.
    scroller.current?.scrollTo({ top: 0 });
    root.current?.parentElement?.scrollTo({ top: 0 });
  };
  const index = SCREENS.findIndex(s => s.id === screen);
  const nav: Nav = {
    kicker: kickerFor(screen),
    next: () => go(SCREENS[Math.min(SCREENS.length - 1, index + 1)].id),
    back: () => go(SCREENS[Math.max(0, index - 1)].id),
    go,
  };
  const current = sectionOf(screen);

  return (
    <div ref={root} className="grid min-h-full lg:h-full lg:grid-cols-[minmax(340px,0.8fr)_1.2fr] lg:overflow-hidden">
      <aside className="relative flex flex-col justify-between overflow-hidden bg-[#121116] p-10 text-[#f2f1f6] max-lg:hidden">
        <div className="pointer-events-none absolute -top-40 -right-40 size-[520px] rounded-full opacity-25 blur-3xl" style={{ background: 'radial-gradient(circle, #e7b04c 0%, transparent 65%)' }} />
        <div className="relative flex items-center gap-2.5">
          <div className="grid size-9 place-items-center rounded-xl bg-white/10">
            <Logo className="size-7" animated />
          </div>
          <span className="font-display text-[20px]">Talaria</span>
        </div>
        <div className="relative">
          <h1 className="font-display text-[40px] leading-[1.02] tracking-[-0.02em]">
            Your job hunt,
            <br />
            <em className="text-[#e7b04c]">with wings.</em>
          </h1>
          <p className="mt-5 max-w-sm text-[15px] leading-relaxed text-white/60">The better Talaria knows you, the better the jobs it finds and the more each application sounds like you.</p>
        </div>
        <ol className="relative space-y-3">
          {SECTIONS.map((s, i) => {
            const done = i < current;
            const first = SCREENS.find(x => x.section === i)!.id;
            return (
              <li key={s}>
                <button
                  type="button"
                  disabled={!done}
                  onClick={() => go(first)}
                  className={cn('flex items-center gap-3 text-left text-[14px] transition-colors', i === current ? 'text-white' : done ? 'text-white/55 hover:text-white/80' : 'text-white/30')}
                >
                  <span className={cn('grid size-6 shrink-0 place-items-center rounded-full text-[11.5px] font-semibold', done ? 'bg-[#e7b04c] text-[#121116]' : i === current ? 'bg-white text-[#121116]' : 'border border-white/20')}>
                    {done ? <Check className="size-3.5" strokeWidth={3} /> : i + 1}
                  </span>
                  <span>
                    {s}
                    {i === 2 && reading.state === 'reading' && <span className="block text-[11.5px] text-[#e7b04c]">Reading in the background…</span>}
                    {i === 2 && reading.state === 'error' && <span className="block text-[11.5px] text-[#f08a7e]">Couldn't read it. Try again</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </aside>

      <main ref={scroller} className="flex min-h-full flex-col px-6 lg:overflow-y-auto lg:[scrollbar-gutter:stable]">
        <div className="mx-auto flex w-full max-w-[620px] flex-1 flex-col pt-12">
          {screen !== 'resume' && screen !== 'you' && <ReadingBanner reading={reading} onRetry={() => go('resume')} invite={screen === 'story' ? 'While Hermes reads your resume, tell us your story.' : undefined} />}
          <FooterSlot.Provider value={footer}>
            <AnimatePresence mode="wait">
              <motion.div key={screen} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}>
                {screen === 'welcome' && <WelcomeStep kicker={nav.kicker} next={nav.next} />}
                {screen === 'connect' && <ConnectStep kicker={nav.kicker} next={nav.next} back={nav.back} />}
                {screen === 'resume' && <ResumeStep {...nav} />}
                {screen === 'story' && <StoryStep {...nav} />}
                {screen === 'roles' && <RolesStep {...nav} />}
                {screen === 'where' && <WhereStep {...nav} />}
                {screen === 'matters' && <MattersStep {...nav} />}
                {screen === 'you' && <ProfileCheckStep {...nav} />}
                {screen === 'sources' && <SourcesStep {...nav} />}
                {screen === 'launch' && <LaunchStep {...nav} />}
              </motion.div>
            </AnimatePresence>
          </FooterSlot.Provider>
          {/* Each step's Back / Continue land here, outside the page animation, so they stay exactly where they are. */}
          <div ref={setFooter} className="sticky bottom-0 z-10 mt-auto bg-gradient-to-t from-bg from-70% to-transparent pt-10 pb-8" />
        </div>
      </main>
    </div>
  );
}


// ---------------- 3. Resume ----------------

function ResumeStep({ kicker, next, back }: Nav) {
  const resumeName = useApp(s => s.settings?.onboarding?.resumeName || s.profile?.resumeFileName);
  const reading = useResumeReading();
  const [replacing, setReplacing] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const [paste, setPaste] = React.useState(false);
  const [text, setText] = React.useState('');
  const [drag, setDrag] = React.useState(false);
  const input = React.useRef<HTMLInputElement>(null);
  const elapsed = useElapsed(reading.run?.startedAt, reading.state === 'reading');

  const [error, setError] = React.useState('');
  const send = async (body: FormData | { text: string }, name: string) => {
    setSending(true);
    setError('');
    try {
      await api.post('/api/resume?background=1', body, { quiet: true });
      await saveProgress({ resumeName: name });
      setReplacing(false);
      next();
    } catch (err: any) {
      // Stay here, with the reason in view, so they can try another file.
      setError(err?.message || 'Something went wrong.');
    } finally {
      setSending(false);
    }
  };
  const onFile = (f?: File | null) => {
    if (!f) return;
    const fd = new FormData();
    fd.append('file', f);
    send(fd, f.name);
  };

  if (reading.state !== 'idle' && !replacing) {
    return (
      <div>
        <StepHeader kicker={kicker} title="Your resume">
          Hermes builds your profile from it and never invents experience you don't have.
        </StepHeader>
        <div className={cn('rounded-2xl border p-5', reading.state === 'error' ? 'border-bad/30 bg-bad-soft/40' : 'border-line bg-card shadow-card')}>
          <div className="flex items-center gap-4">
            <div className="grid size-12 shrink-0 place-items-center rounded-xl bg-gold-soft text-gold">
              <FileText className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold text-ink">{resumeName || 'Your resume'}</div>
              <div className="text-[13px] text-muted">
                {reading.state === 'reading' && <>Hermes is reading it in the background · {elapsed}s. You can carry on.</>}
                {reading.state === 'done' && <>Read{reading.run?.detail ? `: ${reading.run.detail}` : ''}. You'll check what Hermes found in step {sectionOf('you') + 1}.</>}
                {reading.state === 'error' && <span className="text-bad">Hermes couldn't read it: {reading.run?.error?.split('\n')[0] || 'something went wrong'}</span>}
              </div>
            </div>
            {reading.state === 'reading' && <Loader2 className="size-4 animate-spin text-gold" />}
          </div>
        </div>
        <StepFooter back={back}>
          <Button variant="ghost" icon={reading.state === 'error' ? <RefreshCw className="size-4" /> : <UploadCloud className="size-4" />} onClick={() => setReplacing(true)}>
            {reading.state === 'error' ? 'Try again' : 'Use a different resume'}
          </Button>
          <NextButton onClick={next}>Continue</NextButton>
        </StepFooter>
      </div>
    );
  }

  return (
    <div>
      <StepHeader kicker={kicker} title="Show Hermes who you are.">
        Your resume is the source of truth. Hermes reads it in the background while you answer the next questions, and never invents experience you don't have. Upload your LaTeX source and every tailored resume keeps your exact template.
      </StepHeader>

      {!paste ? (
        <button
          type="button"
          disabled={sending}
          onClick={() => input.current?.click()}
          onDragOver={e => (e.preventDefault(), setDrag(true))}
          onDragLeave={() => setDrag(false)}
          onDrop={e => {
            e.preventDefault();
            setDrag(false);
            onFile(e.dataTransfer.files?.[0]);
          }}
          className={cn('group flex w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-14 text-center transition-all', drag ? 'scale-[1.01] border-accent bg-accent-soft' : 'border-line bg-card hover:border-ink/25')}
        >
          <div className={cn('grid size-14 place-items-center rounded-2xl transition-colors', drag ? 'bg-accent text-white' : 'bg-ink text-bg group-hover:scale-105')}>
            {sending ? <Loader2 className="size-6 animate-spin" /> : <UploadCloud className="size-6" />}
          </div>
          <div className="mt-4 text-[16px] font-semibold text-ink">{sending ? 'Opening your resume…' : 'Drop your resume here'}</div>
          <div className="mt-1 text-[13.5px] text-muted">or click to browse · LaTeX (.tex / Overleaf .zip), PDF, DOCX or TXT</div>
          <input ref={input} type="file" accept=".pdf,.docx,.txt,.md,.tex,.zip" className="hidden" onChange={e => onFile(e.target.files?.[0])} />
        </button>
      ) : (
        <Textarea value={text} onChange={e => setText(e.target.value)} autoFocus placeholder="Paste the full text of your resume…" className="min-h-[260px] bg-card text-[13px]" />
      )}
      {error && <p className="mt-3 rounded-lg bg-bad-soft px-3 py-2 text-[12.5px] leading-relaxed text-bad">{error}</p>}
      <p className="mt-3 text-[12.5px] text-faint">Your resume stays on this computer; only its text goes to your AI provider, through Hermes.</p>

      <StepFooter back={replacing ? () => setReplacing(false) : back} backLabel={replacing ? 'Keep the current one' : 'Back'}>
        <Button variant="ghost" onClick={() => setPaste(p => !p)}>
          {paste ? 'Upload a file instead' : 'Paste text instead'}
        </Button>
        {paste && (
          <Button variant="primary" size="lg" loading={sending} disabled={text.trim().length < 80} onClick={() => send({ text }, 'Pasted resume')}>
            Read my resume
          </Button>
        )}
      </StepFooter>
    </div>
  );
}

// ---------------- 4. Story ----------------

const STORY_QUESTIONS = [
  { id: 'why', q: 'Why do you do this kind of work?', hint: 'What pulled you in? A moment, a person or a project that shaped you.', placeholder: 'e.g. I started by fixing the family computer, then built a website for my school club…' },
  { id: 'proud', q: 'What are you proudest of?', hint: "Something you made or did, at work or not, and why it mattered to you.", placeholder: 'e.g. Leading the redesign of our checkout, which halved support tickets…' },
  { id: 'next', q: 'What do you want next, and why now?', hint: 'The problems, team or kind of company you want to be part of.', placeholder: "e.g. A small team where I can own a product end to end, because…" },
  { id: 'life', q: 'Who are you outside work?', hint: 'What you make or do for fun, what you care about, products you love using.', placeholder: 'e.g. I bake sourdough, run on weekends and keep a sketchbook of app ideas…' },
];

const composeStory = (answers: Record<string, string> = {}) =>
  STORY_QUESTIONS.map(q => answers[q.id]?.trim())
    .filter(Boolean)
    .join('\n\n');

function StoryStep({ kicker, next, back }: Nav) {
  const stored = useApp(s => s.settings?.onboarding?.story);
  const hasProfile = useApp(s => Boolean(s.profile));
  const [answers, setAnswers] = React.useState<Record<string, string>>(stored || {});
  const filled = STORY_QUESTIONS.filter(q => answers[q.id]?.trim()).length;

  const save = async (then: () => void) => {
    await saveProgress({ story: answers });
    const story = composeStory(answers);
    if (hasProfile && story) await api.put('/api/profile', { story }, { quiet: true }).catch(() => {});
    then();
  };

  return (
    <div>
      <StepHeader kicker={kicker} title="Tell us your story.">
        Your resume says what you did. This is who you are, and your cover letters are written from it. Answer like you'd talk to a friend; a few honest sentences beat a polished paragraph. Skip anything you like.
      </StepHeader>

      <div className="space-y-5">
        {STORY_QUESTIONS.map(q => (
          <Field key={q.id} label={q.q} hint={q.hint}>
            <Textarea value={answers[q.id] || ''} onChange={e => setAnswers(a => ({ ...a, [q.id]: e.target.value }))} rows={3} placeholder={q.placeholder} className="bg-card" />
          </Field>
        ))}
      </div>

      <StepFooter back={() => save(back)}>
        <SkipLink onClick={() => save(next)} />
        <NextButton disabled={filled < STORY_QUESTIONS.length} title={filled < STORY_QUESTIONS.length ? `${filled} of ${STORY_QUESTIONS.length} answered` : undefined} onClick={() => save(next)}>
          Next
        </NextButton>
      </StepFooter>
    </div>
  );
}

// ---------------- 5. What you're after ----------------

const SENIORITY: { value: Seniority; label: string }[] = [
  { value: 'intern', label: 'Internship' },
  { value: 'entry', label: 'Entry / new grad' },
  { value: 'mid', label: 'Mid-level' },
  { value: 'senior', label: 'Senior' },
  { value: 'lead', label: 'Lead / staff' },
];

type PrefsProps = { prefs: Preferences; onChange: (p: Partial<Preferences>) => void };

function RolesFields({ prefs, onChange }: PrefsProps) {
  return (
    <>
      <Field label="Roles you're targeting" hint="Hermes suggests these from your resume. Edit freely; press Enter to add.">
        <ChipInput value={prefs.roles} onChange={roles => onChange({ roles })} placeholder="e.g. Frontend Engineer" suggestions={['Software Engineer', 'Frontend Engineer', 'Backend Engineer', 'Full Stack Engineer', 'Data Analyst', 'ML Engineer'].filter(s => !prefs.roles.length || prefs.roles.length < 6)} />
      </Field>
      <Field label="Seniority" group>
        <div className="flex flex-wrap gap-1.5">
          {SENIORITY.map(s => {
            const on = prefs.seniority.includes(s.value);
            return (
              <button
                key={s.value}
                type="button"
                onClick={() => onChange({ seniority: on ? prefs.seniority.filter(x => x !== s.value) : [...prefs.seniority, s.value] })}
                className={cn('h-8 rounded-lg border px-3 text-[13px] font-medium transition-colors', on ? 'border-ink bg-ink text-bg' : 'border-line bg-card text-ink-2 hover:border-ink/30')}
              >
                {s.label}
              </button>
            );
          })}
        </div>
      </Field>
    </>
  );
}

function WhereFields({ prefs, onChange }: PrefsProps) {
  return (
    <>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Locations" hint="Cities or countries. Remote roles are always considered.">
          <ChipInput value={prefs.locations} onChange={locations => onChange({ locations })} placeholder="e.g. Berlin, Germany" />
        </Field>
        <Field label="Work mode" group>
          <Segmented<RemotePreference>
            value={prefs.remote}
            onChange={remote => onChange({ remote })}
            size="sm"
            options={[
              { value: 'any', label: 'Any' },
              { value: 'remote_or_hybrid', label: 'Remote/hybrid' },
              { value: 'remote_only', label: 'Remote' },
              { value: 'onsite', label: 'On-site' },
            ]}
          />
        </Field>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Need visa sponsorship?" group>
          <Segmented
            value={prefs.needsSponsorship == null ? 'skip' : prefs.needsSponsorship ? 'yes' : 'no'}
            onChange={v => onChange({ needsSponsorship: v === 'skip' ? null : v === 'yes' })}
            size="sm"
            options={[
              { value: 'no', label: 'No' },
              { value: 'yes', label: 'Yes' },
              { value: 'skip', label: 'Depends' },
            ]}
          />
        </Field>
        <Field label="Minimum salary (optional)">
          <div className="flex gap-2">
            <Input type="number" min={0} value={prefs.minSalary ?? ''} onChange={e => onChange({ minSalary: e.target.value ? Number(e.target.value) : null })} placeholder="e.g. 60000" />
            <select value={prefs.currency || 'USD'} onChange={e => onChange({ currency: e.target.value })} className="h-9 rounded-lg border border-line bg-card px-2 text-[13px] text-ink outline-none">
              {['USD', 'INR', 'EUR', 'GBP', 'SEK', 'CAD', 'AUD', 'SGD'].map(c => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
        </Field>
      </div>
    </>
  );
}

function TopicsFields({ prefs, onChange }: PrefsProps) {
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <Field label="Topics you'd love" hint="Boosts matching roles.">
        <ChipInput value={prefs.includeKeywords} onChange={includeKeywords => onChange({ includeKeywords })} placeholder="e.g. fintech, React" />
      </Field>
      <Field label="Deal-breakers" hint="Jobs mentioning these are skipped.">
        <ChipInput value={prefs.excludeKeywords} onChange={excludeKeywords => onChange({ excludeKeywords })} placeholder="e.g. crypto, unpaid" />
      </Field>
    </div>
  );
}

/** All job preferences on one page, for the Profile screen. */
export function PreferencesForm(props: PrefsProps) {
  return (
    <div className="space-y-5">
      <RolesFields {...props} />
      <WhereFields {...props} />
      <TopicsFields {...props} />
    </div>
  );
}

/** One screen's share of your preferences. Suggestions Hermes finds meanwhile fill anything you haven't touched. */
function usePrefsDraft(keys: (keyof Preferences)[]) {
  const stored = useApp(s => s.preferences)!;
  const [draft, setDraft] = React.useState(stored);
  const touched = React.useRef(new Set<keyof Preferences>());

  React.useEffect(() => {
    setDraft(d => {
      const n = { ...d } as Record<keyof Preferences, unknown>;
      for (const k of keys) if (!touched.current.has(k)) n[k] = stored[k];
      return n as unknown as Preferences;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stored]);

  const change = (p: Partial<Preferences>) => {
    for (const k of Object.keys(p)) touched.current.add(k as keyof Preferences);
    setDraft(d => ({ ...d, ...p }));
  };

  const [saving, setSaving] = React.useState(false);
  const save = async (then: () => void) => {
    setSaving(true);
    try {
      await api.put('/api/preferences', Object.fromEntries(keys.map(k => [k, draft[k]])));
      // Empty lists stay open to Hermes's suggestions; anything you've set is yours.
      const mine = keys.filter(k => !(Array.isArray(draft[k]) && !(draft[k] as unknown[]).length));
      const before = useApp.getState().settings?.onboarding?.confirmedPrefs || [];
      await saveProgress({ confirmedPrefs: [...new Set([...before, ...mine])] });
      then();
    } finally {
      setSaving(false);
    }
  };
  return { draft, change, save, saving };
}

function StillReadingNote() {
  const { state } = useResumeReading();
  if (state !== 'reading') return null;
  return (
    <p className="mb-6 flex items-center gap-2 rounded-xl bg-gold-soft/40 px-3.5 py-2.5 text-[12.5px] text-ink-2">
      <Sparkles className="size-3.5 shrink-0 text-gold" /> Hermes is still reading your resume. Its suggestions will appear here in anything you haven't filled in yet.
    </p>
  );
}

function RolesStep({ kicker, next, back }: Nav) {
  const name = useApp(s => s.profile?.name?.split(' ')[0]);
  const { draft, change, save, saving } = usePrefsDraft(['roles', 'seniority']);
  return (
    <div>
      <StepHeader kicker={kicker} title={name ? `What are you looking for, ${name}?` : 'What are you looking for?'}>
        The job titles you want, and the level you're aiming for. Pick more than one if you're open to it.
      </StepHeader>
      <StillReadingNote />
      <div className="space-y-5">
        <RolesFields prefs={draft} onChange={change} />
      </div>
      <StepFooter back={back}>
        {!draft.roles.length && <span className="text-[12.5px] text-faint">Add at least one role</span>}
        <NextButton loading={saving} disabled={!draft.roles.length || !draft.seniority.length} onClick={() => save(next)} />
      </StepFooter>
    </div>
  );
}

function WhereStep({ kicker, next, back }: Nav) {
  const { draft, change, save, saving } = usePrefsDraft(['locations', 'remote', 'needsSponsorship', 'minSalary', 'currency']);
  return (
    <div>
      <StepHeader kicker={kicker} title="Where, and how, do you want to work?">
        Where you can work, whether you want remote or an office, and what it needs to pay. Your visa answer is only ever used as you give it here.
      </StepHeader>
      <StillReadingNote />
      <div className="space-y-5">
        <WhereFields prefs={draft} onChange={change} />
      </div>
      <StepFooter back={back}>
        <NextButton loading={saving} onClick={() => save(next)} />
      </StepFooter>
    </div>
  );
}

function MattersStep({ kicker, next, back }: Nav) {
  const { draft, change, save, saving } = usePrefsDraft(['includeKeywords', 'excludeKeywords', 'excludeCompanies']);
  return (
    <div>
      <StepHeader kicker={kicker} title="What matters to you?">
        Topics that get you excited move matching jobs up. Deal-breakers and companies you'd rather avoid are skipped entirely.
      </StepHeader>
      <StillReadingNote />
      <div className="space-y-5">
        <TopicsFields prefs={draft} onChange={change} />
        <Field label="Companies to skip" hint="Your current employer, places you've already ruled out.">
          <ChipInput value={draft.excludeCompanies} onChange={excludeCompanies => change({ excludeCompanies })} placeholder="e.g. current employer" />
        </Field>
      </div>
      <StepFooter back={back}>
        <NextButton loading={saving} onClick={() => save(next)} />
      </StepFooter>
    </div>
  );
}

// ---------------- 6. Is this you? ----------------

function ProfileCheckStep({ kicker, next, back, go }: Nav) {
  const stored = useApp(s => s.profile);
  const answers = useApp(s => s.settings?.onboarding?.story);
  const reading = useResumeReading();
  const elapsed = useElapsed(reading.run?.startedAt, reading.state === 'reading');
  const [p, setP] = React.useState<Profile | null>(stored);
  const [saving, setSaving] = React.useState(false);
  // Take a freshly read resume (e.g. you replaced it) as the starting point.
  React.useEffect(() => {
    if (stored) setP(stored);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stored?.updatedAt]);
  const up = (patch: Partial<Profile>) => setP(x => (x ? { ...x, ...patch } : x));

  const save = async () => {
    if (!p) return;
    setSaving(true);
    try {
      const story = composeStory(answers);
      await api.put('/api/profile', { name: p.name, headline: p.headline, email: p.email, phone: p.phone, location: p.location, summary: p.summary, skills: p.skills, ...(story ? { story } : {}) });
      next();
    } finally {
      setSaving(false);
    }
  };

  if (!p || reading.state === 'reading') {
    const failed = reading.state === 'error';
    return (
      <div>
        <StepHeader kicker={kicker} title={failed ? "Hermes couldn't read your resume." : 'Hermes is almost done reading.'}>
          {failed ? reading.run?.error?.split('\n')[0] || 'Something went wrong.' : "Once it's done you'll check what it found here. This usually takes under a minute."}
        </StepHeader>
        {!failed && (
          <div className="agent-sheen overflow-hidden rounded-2xl border border-gold/20 bg-gold-soft/40 p-6">
            <div className="flex items-center justify-between text-[13px] text-muted">
              <span className="inline-flex items-center gap-2">
                <Loader2 className="size-4 animate-spin text-gold" /> Reading your resume
              </span>
              <span className="tabular-nums text-faint">{elapsed}s</span>
            </div>
            <div className="mt-5 space-y-2.5">
              {[92, 78, 85, 60].map((w, i) => (
                <div key={i} className="skeleton h-3" style={{ width: `${w}%`, animationDelay: `${i * 0.15}s` }} />
              ))}
            </div>
          </div>
        )}
        <StepFooter back={back}>
          {failed && (
            <Button variant="primary" size="lg" icon={<RefreshCw className="size-4" />} onClick={() => go('resume')}>
              Try again
            </Button>
          )}
        </StepFooter>
      </div>
    );
  }

  return (
    <div>
      <StepHeader kicker={kicker} title={`Is this you${p.name ? `, ${p.name.split(' ')[0]}` : ''}?`}>
        Here's what Hermes took from your resume. Fix anything it got wrong; every application is built from this.
      </StepHeader>

      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name">
            <Input value={p.name} onChange={e => up({ name: e.target.value })} />
          </Field>
          <Field label="Based in">
            <Input value={p.location} onChange={e => up({ location: e.target.value })} placeholder="e.g. Berlin, Germany" />
          </Field>
          <Field label="Email">
            <Input type="email" value={p.email} onChange={e => up({ email: e.target.value })} />
          </Field>
          <Field label="Phone">
            <Input value={p.phone} onChange={e => up({ phone: e.target.value })} />
          </Field>
        </div>
        <Field label="Headline" hint="One line that sums you up.">
          <Input value={p.headline} onChange={e => up({ headline: e.target.value })} />
        </Field>
        <Field label="Summary">
          <Textarea value={p.summary} onChange={e => up({ summary: e.target.value })} rows={4} className="bg-card" />
        </Field>
        <Field label={`Skills (${p.skills.length})`} hint="Most important first. Remove anything you wouldn't want to be asked about.">
          <ChipInput value={p.skills} onChange={skills => up({ skills })} placeholder="Add a skill" />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Summary title="Experience" empty="No roles found" items={p.experience.map(e => ({ main: e.title, sub: [e.company, [e.start, e.end].filter(Boolean).join(' – ')].filter(Boolean).join(' · ') }))} />
          <Summary title="Education" empty="No education found" items={p.education.map(e => ({ main: [e.degree, e.field].filter(Boolean).join(', ') || e.school, sub: [e.school, e.end].filter(Boolean).join(' · ') }))} />
        </div>
        <p className="text-[12.5px] text-faint">You can fine-tune every bullet point later on the Profile page.</p>
      </div>

      <StepFooter back={back}>
        <NextButton loading={saving} disabled={!p.name.trim()} onClick={save}>
          Looks right
        </NextButton>
      </StepFooter>
    </div>
  );
}

function Summary({ title, items, empty }: { title: string; items: { main: string; sub: string }[]; empty: string }) {
  return (
    <div className="rounded-2xl bg-card p-4 shadow-card">
      <div className="mb-2 text-[12px] font-semibold tracking-[0.08em] text-faint uppercase">{title}</div>
      {items.length ? (
        <ul className="space-y-2">
          {items.map((it, i) => (
            <li key={i}>
              <div className="text-[13.5px] font-medium text-ink">{it.main}</div>
              <div className="text-[12px] text-muted">{it.sub}</div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="text-[13px] text-muted">{empty}</div>
      )}
    </div>
  );
}

// ---------------- 7. Where to look ----------------

function SourcesStep({ kicker, next, back }: Nav) {
  const stored = useApp(s => s.preferences)!;
  const [prefs, setPrefs] = React.useState(stored);
  const [saving, setSaving] = React.useState(false);
  const save = async () => {
    setSaving(true);
    try {
      await api.put('/api/preferences', { sources: prefs.sources, targetCompanies: prefs.targetCompanies });
      next();
    } finally {
      setSaving(false);
    }
  };
  return (
    <div>
      <StepHeader kicker={kicker} title="Where should Hermes look?">
        Pick the job boards to search. Then add your own sources: any company you'd love to work for, by name or by the link to its careers page. Talaria works out where it posts and watches it for you.
      </StepHeader>
      <SourcesEditor prefs={prefs} onChange={p => setPrefs(x => ({ ...x, ...p, sources: { ...x.sources, ...(p.sources || {}) } }))} />
      <StepFooter back={back}>
        <NextButton loading={saving} onClick={save} />
      </StepFooter>
    </div>
  );
}

// ---------------- 8. Review & start ----------------

const REMOTE_LABEL: Record<RemotePreference, string> = { any: 'Any work mode', remote_or_hybrid: 'Remote or hybrid', remote_only: 'Remote only', onsite: 'On-site' };

function LaunchStep({ kicker, back, go }: Nav) {
  const profile = useApp(s => s.profile);
  const prefs = useApp(s => s.preferences)!;
  const settings = useApp(s => s.settings)!;
  const story = settings.onboarding?.story || {};
  const [autopilot, setAutopilot] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const boards = BOARDS.filter(b => prefs.sources[b.id]).length;
  const answered = STORY_QUESTIONS.filter(q => story[q.id]?.trim()).length;

  const start = async () => {
    setBusy(true);
    try {
      await api.put('/api/settings', { onboarded: true, toured: false, autopilot: { ...settings.autopilot, enabled: autopilot }, onboarding: { ...settings.onboarding, step: 'done' } });
      navigate({ view: 'board' }, true);
      await api.post('/api/scout');
    } catch {
      setBusy(false);
    }
  };

  const rows: { label: string; value: string; edit: Screen }[] = [
    { label: 'You', value: profile ? [profile.name, profile.headline].filter(Boolean).join(' · ') : 'Hermes is still reading your resume', edit: 'you' },
    { label: 'Your story', value: answered ? `${answered} of ${STORY_QUESTIONS.length} questions answered` : 'Not written yet (Hermes will ask when it writes a cover letter)', edit: 'story' },
    { label: 'Roles', value: `${prefs.roles.join(', ') || 'None yet'} · ${prefs.seniority.map(s => SENIORITY.find(x => x.value === s)?.label).join(', ')}`, edit: 'roles' },
    { label: 'Where', value: [prefs.locations.join(', ') || 'Anywhere', REMOTE_LABEL[prefs.remote], prefs.needsSponsorship ? 'needs sponsorship' : null].filter(Boolean).join(' · '), edit: 'where' },
    { label: 'What matters', value: `${prefs.includeKeywords.length} topics you'd love · ${prefs.excludeKeywords.length + prefs.excludeCompanies.length} things to skip`, edit: 'matters' },
    { label: 'Sources', value: `${boards} job board${boards === 1 ? '' : 's'} · ${prefs.targetCompanies.length} compan${prefs.targetCompanies.length === 1 ? 'y' : 'ies'} watched`, edit: 'sources' },
  ];

  return (
    <div>
      <StepHeader kicker={kicker} title="Here's what Hermes knows about you.">
        Check it over, then start the hunt. You can change any of this later on the Profile page.
      </StepHeader>

      <div className="divide-y divide-line-2 rounded-2xl bg-card shadow-card">
        {rows.map(r => (
          <div key={r.label} className="flex items-start gap-4 px-5 py-3.5">
            <div className="w-28 shrink-0 text-[12.5px] font-semibold text-faint">{r.label}</div>
            <div className="min-w-0 flex-1 text-[13.5px] text-ink">{r.value}</div>
            <button type="button" onClick={() => go(r.edit)} className="inline-flex shrink-0 items-center gap-1 text-[12.5px] text-muted hover:text-ink">
              <Pencil className="size-3" /> Edit
            </button>
          </div>
        ))}
      </div>

      <div className="mt-6 flex items-center justify-between gap-4 rounded-2xl bg-card p-4 shadow-card">
        <div>
          <div className="text-[14px] font-semibold text-ink">Autopilot</div>
          <div className="text-[12.5px] text-muted">Search for new matches every {settings.autopilot.scoutEveryHours} hours while Talaria is running, and pre-analyze the promising ones. It never applies for you.</div>
        </div>
        <Switch checked={autopilot} onChange={setAutopilot} label="Autopilot" />
      </div>

      <StepFooter back={back}>
        {!profile && <span className="text-[12.5px] text-faint">Waiting for Hermes to finish your resume</span>}
        <Button variant="primary" size="lg" loading={busy} disabled={!profile || !prefs.roles.length} icon={<Sparkles className="size-4 text-gold" />} onClick={start}>
          Start the hunt
        </Button>
      </StepFooter>
    </div>
  );
}
