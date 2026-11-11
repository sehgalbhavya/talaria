import * as React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { BookmarkCheck, Check, ChevronDown, FileText, Loader, Plus, RefreshCw, Sparkles, Trash2, UploadCloud, X } from 'lucide-react';
import type { AnswerBankItem, ExperienceItem, Preferences, Profile } from '@shared/types';
import { api } from '@/lib/api';
import { useApp } from '@/lib/store';
import { cn, timeAgo } from '@/lib/utils';
import { profileChecks, profileScore } from '@/lib/profileStrength';
import { Badge, Button, Card, ChipInput, Dialog, Field, Input, Segmented, SuggestInput, Textarea } from '@/components/ui';
import { placeOptions } from '@/lib/suggest';
import { composeStory, STORY_QUESTIONS } from '@shared/story';
import { PageSectionBlock, RailCard, SaveBar, SectionPage, useSectionJump } from '@/components/SectionPage';
import { toast } from 'sonner';
import { aiName } from '@/lib/ai';

const SECTIONS = [
  { id: 'resume', label: 'Resume' },
  { id: 'story', label: 'Your story' },
  { id: 'basics', label: 'Basics' },
  { id: 'experience', label: 'Experience' },
  { id: 'projects', label: 'Projects' },
  { id: 'education', label: 'Education' },
  { id: 'skills', label: 'Skills' },
  { id: 'answers', label: 'Application answers' },
];

/** Who you are: what the AI writes your resume, letters and form answers from. */
export function ProfileView() {
  const stored = useApp(s => s.profile)!;
  const prefs = useApp(s => s.preferences);
  const [p, setP] = React.useState<Profile>(stored);
  const [saving, setSaving] = React.useState(false);
  const [showText, setShowText] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => setP(stored), [stored]);
  const dirty = JSON.stringify(p) !== JSON.stringify(stored);
  const up = (patch: Partial<Profile>) => setP(x => ({ ...x, ...patch }));

  const save = async () => {
    setSaving(true);
    try {
      // Your story has its own save, and the AI may be weaving it right now: leave it out of this one.
      const { story: _story, storyAnswers: _answers, storyWovenAt: _woven, ...rest } = p;
      await api.put('/api/profile', rest);
      toast.success('Profile saved');
    } finally {
      setSaving(false);
    }
  };

  const replace = async (f?: File | null) => {
    if (!f) return;
    if (!confirm(`Replace your resume? ${aiName()} will rebuild your profile from the new file (your preferences stay).`)) return;
    const fd = new FormData();
    fd.append('file', f);
    setUploading(true);
    try {
      await api.post('/api/resume', fd);
      toast.success('Resume updated — profile rebuilt');
    } finally {
      setUploading(false);
    }
  };

  return (
    <SectionPage
      title="Profile"
      subtitle={`Who you are. ${aiName()} writes your resume, cover letters and form answers from this.`}
      sections={SECTIONS}
      rail={<StrengthRail p={p} prefs={prefs} onShowText={() => setShowText(true)} />}
    >
      <PageSectionBlock id="resume" title="Resume">
        <Card className="flex flex-wrap items-center gap-4 p-4">
          <div className="grid size-11 place-items-center bg-accent-soft text-accent">{uploading ? <Loader className="size-5 animate-spin" /> : <FileText className="size-5" />}</div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 truncate text-[14px] font-semibold text-ink">
              {uploading ? `${aiName()} is reading your new resume…` : stored.resumeFileName || 'Pasted resume'}
              {stored.latexSource && !uploading && <Badge tone="accent">LaTeX template</Badge>}
            </div>
            <div className="text-[12.5px] text-muted">
              {stored.latexSource ? 'Every tailored resume is rendered in your own template. ' : ''}Profile last updated {timeAgo(stored.updatedAt, false)}
            </div>
          </div>
          <div className="flex flex-wrap gap-1">
            {stored.latexSource && (
              <Button
                variant="ghost"
                size="sm"
                onClick={async () => {
                  const id = toast.loading('Compiling your template with pdfLaTeX…');
                  try {
                    const r = await api.post<{ ok: boolean; pages?: number; error?: string }>('/api/latex/test');
                    if (r.ok) toast.success(`Compiles fine — ${r.pages} page${r.pages === 1 ? '' : 's'}`, { id });
                    else toast.error(`Doesn't compile: ${r.error?.split('\n')[0] || 'pdflatex not installed'}`, { id });
                  } catch {
                    toast.dismiss(id);
                  }
                }}
              >
                Test compile
              </Button>
            )}
            <Button variant="secondary" size="sm" icon={<UploadCloud className="size-3.5" />} onClick={() => fileRef.current?.click()} disabled={uploading}>
              Replace resume
            </Button>
          </div>
          <input ref={fileRef} type="file" accept=".pdf,.docx,.txt,.md,.tex,.zip" className="hidden" onChange={e => replace(e.target.files?.[0])} />
        </Card>
      </PageSectionBlock>

      <PageSectionBlock id="story" title="Your story">
        <StorySection />
      </PageSectionBlock>

      <PageSectionBlock id="basics" title="Basics">
        <Card className="space-y-4 p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name">
              <Input value={p.name} onChange={e => up({ name: e.target.value })} />
            </Field>
            <Field label="Headline">
              <Input value={p.headline} onChange={e => up({ headline: e.target.value })} />
            </Field>
            <Field label="Email">
              <Input type="email" value={p.email} onChange={e => up({ email: e.target.value })} />
            </Field>
            <Field label="Phone">
              <Input value={p.phone} onChange={e => up({ phone: e.target.value })} />
            </Field>
            <Field label="Location">
              <SuggestInput value={p.location} onChange={location => up({ location })} search={placeOptions} placeholder="Start typing a city or country" />
            </Field>
            <Field label="Years of professional experience">
              <Input type="number" min={0} value={p.yearsExperience ?? ''} onChange={e => up({ yearsExperience: e.target.value === '' ? undefined : Number(e.target.value) })} />
            </Field>
          </div>
          <Field label="Summary">
            <Textarea value={p.summary} onChange={e => up({ summary: e.target.value })} />
          </Field>
          <Field label="Links">
            <div className="space-y-2">
              {p.links.map((l, i) => (
                <div key={i} className="flex gap-2">
                  <Input className="w-36" value={l.label} onChange={e => up({ links: p.links.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} placeholder="Label" />
                  <Input value={l.url} onChange={e => up({ links: p.links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)) })} placeholder="https://" />
                  <Button variant="ghost" size="md" aria-label="Remove link" onClick={() => up({ links: p.links.filter((_, j) => j !== i) })}>
                    <X className="size-4" />
                  </Button>
                </div>
              ))}
              <Button variant="ghost" size="sm" icon={<Plus className="size-3.5" />} onClick={() => up({ links: [...p.links, { label: '', url: '' }] })}>
                Add link
              </Button>
            </div>
          </Field>
        </Card>
      </PageSectionBlock>

      <PageSectionBlock
        id="experience"
        title="Experience"
        action={
          <Button variant="ghost" size="xs" icon={<Plus className="size-3" />} onClick={() => up({ experience: [{ company: '', title: '', start: '', end: '', bullets: [] }, ...p.experience] })}>
            Add role
          </Button>
        }
      >
        <div className="space-y-2.5">
          {p.experience.map((e, i) => (
            <EntryEditor
              key={i}
              title={e.title || 'New role'}
              subtitle={[e.company, [e.start, e.end].filter(Boolean).join(' – ')].filter(Boolean).join(' · ')}
              onRemove={() => up({ experience: p.experience.filter((_, j) => j !== i) })}
            >
              <ExperienceFields value={e} onChange={v => up({ experience: p.experience.map((x, j) => (j === i ? v : x)) })} />
            </EntryEditor>
          ))}
        </div>
      </PageSectionBlock>

      <PageSectionBlock
        id="projects"
        title="Projects"
        action={
          <Button variant="ghost" size="xs" icon={<Plus className="size-3" />} onClick={() => up({ projects: [{ name: '', bullets: [], tech: [] }, ...p.projects] })}>
            Add project
          </Button>
        }
      >
        <div className="space-y-2.5">
          {p.projects.map((pr, i) => (
            <EntryEditor key={i} title={pr.name || 'New project'} subtitle={pr.tech?.join(', ')} onRemove={() => up({ projects: p.projects.filter((_, j) => j !== i) })}>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Name">
                  <Input value={pr.name} onChange={e => up({ projects: p.projects.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
                </Field>
                <Field label="Link">
                  <Input value={pr.link || ''} onChange={e => up({ projects: p.projects.map((x, j) => (j === i ? { ...x, link: e.target.value } : x)) })} />
                </Field>
              </div>
              <Field label="Tech" className="mt-3">
                <ChipInput value={pr.tech || []} onChange={tech => up({ projects: p.projects.map((x, j) => (j === i ? { ...x, tech } : x)) })} />
              </Field>
              <BulletsField value={pr.bullets} onChange={bullets => up({ projects: p.projects.map((x, j) => (j === i ? { ...x, bullets } : x)) })} />
            </EntryEditor>
          ))}
        </div>
      </PageSectionBlock>

      <PageSectionBlock
        id="education"
        title="Education"
        action={
          <Button variant="ghost" size="xs" icon={<Plus className="size-3" />} onClick={() => up({ education: [...p.education, { school: '', degree: '', field: '' }] })}>
            Add
          </Button>
        }
      >
        <div className="space-y-2.5">
          {p.education.map((ed, i) => (
            <EntryEditor key={i} title={ed.school || 'New entry'} subtitle={[ed.degree, ed.field].filter(Boolean).join(', ')} onRemove={() => up({ education: p.education.filter((_, j) => j !== i) })}>
              <div className="grid gap-3 sm:grid-cols-2">
                {(['school', 'degree', 'field', 'start', 'end', 'details'] as const).map(k => (
                  <Field key={k} label={k[0].toUpperCase() + k.slice(1)}>
                    <Input value={ed[k] || ''} onChange={e => up({ education: p.education.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)) })} />
                  </Field>
                ))}
              </div>
            </EntryEditor>
          ))}
        </div>
      </PageSectionBlock>

      <PageSectionBlock id="skills" title="Skills" desc="Order matters: put your strongest first.">
        <Card className="p-5">
          <ChipInput value={p.skills} onChange={skills => up({ skills })} placeholder="Add a skill" />
        </Card>
      </PageSectionBlock>

      <PageSectionBlock id="answers" title="Application answers" desc={`What ${aiName()} types into application forms for you. These save as you go, separately from the Save button.`}>
        <ApplicationAnswers prefs={prefs} />
      </PageSectionBlock>

      <SaveBar dirty={dirty} saving={saving} onSave={save} onReset={() => setP(stored)} />
      <Dialog open={showText} onOpenChange={setShowText} title="Extracted resume text" description={`This is exactly what ${aiName()} reads.`} className="max-w-2xl">
        <pre className="mt-4 max-h-[60vh] overflow-auto bg-panel p-4 font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-ink-2">{stored.resumeText}</pre>
      </Dialog>
    </SectionPage>
  );
}

// ---------------- live panel ----------------

/** How complete your profile is, as a checklist that jumps to whatever needs work. Follows your unsaved edits. */
// ---------------- your story ----------------

/**
 * The answers your story starts from: the saved ones, else your onboarding answers, else an older
 * free-text story kept whole under "Anything else" so nothing is lost.
 */
function startingAnswers(profile: Profile, onboarding?: Record<string, string>): { answers: Record<string, string>; carriedOver: boolean } {
  if (profile.storyAnswers) return { answers: profile.storyAnswers, carriedOver: false };
  const story = profile.story?.trim() || '';
  if (onboarding && Object.values(onboarding).some(a => a?.trim()) && (!story || composeStory(onboarding) === story)) return { answers: onboarding, carriedOver: false };
  return { answers: story ? { more: story } : {}, carriedOver: Boolean(story) };
}

const clean = (a: Record<string, string>) => JSON.stringify(Object.fromEntries(STORY_QUESTIONS.map(q => [q.id, (a[q.id] || '').trim()]).filter(([, v]) => v)));

/** Your story as questions you answer; the AI weaves the answers into the story your cover letters use. */
function StorySection() {
  const profile = useApp(s => s.profile)!;
  const onboarding = useApp(s => s.settings?.onboarding?.story);
  const runs = useApp(s => s.runs);
  const lastRun = runs.filter(r => r.kind === 'story').sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  const weaving = lastRun?.status === 'queued' || lastRun?.status === 'running';
  const start = React.useMemo(() => startingAnswers(profile, onboarding), [profile.storyAnswers]); // eslint-disable-line react-hooks/exhaustive-deps
  const [answers, setAnswers] = React.useState(start.answers);
  const [saving, setSaving] = React.useState(false);
  const [sorting, setSorting] = React.useState<'idle' | 'sorting' | 'failed'>('idle');
  const touched = React.useRef(false);
  const dirty = clean(answers) !== clean(profile.storyAnswers ?? {});
  // Saved answers coming back from the server replace the form only while you haven't typed in it.
  React.useEffect(() => {
    if (!touched.current) setAnswers(start.answers);
  }, [start]);
  const type = (id: string, text: string) => {
    touched.current = true;
    setAnswers(a => ({ ...a, [id]: text }));
  };

  // A story written before the questions existed: the AI sorts your own sentences into them, once.
  const asked = React.useRef(false);
  React.useEffect(() => {
    if (!start.carriedOver || profile.storyAnswers || asked.current) return;
    asked.current = true;
    setSorting('sorting');
    api
      .post('/api/profile/story/sort', {}, { quiet: true })
      .then(() => setSorting('idle'))
      .catch(() => setSorting('failed'));
  }, [start.carriedOver, profile.storyAnswers]);
  const sortedFromStory = Boolean(profile.storyAnswers && !profile.storyWovenAt && profile.story && composeStory(profile.storyAnswers) !== profile.story.trim());

  const save = async (again = false) => {
    setSaving(true);
    try {
      await api.post('/api/profile/story', { answers, again });
      toast.success(again ? `${aiName()} is weaving your story again` : `Saved. ${aiName()} is weaving your answers into your story.`);
    } finally {
      setSaving(false);
    }
  };

  const words = (profile.story || '').trim().split(/\s+/).filter(Boolean).length;
  const failed = !weaving && lastRun?.status === 'error' && !profile.storyWovenAt;
  return (
    <>
      <Card className="space-y-5 p-5">
        <p className="text-[12.5px] leading-relaxed text-muted">
          Your resume says what you did; this is who you are. Answer in your own words, like you'd talk to a friend. {aiName()} weaves your answers into your story, and your cover letters are written from it.
          It never adds anything you didn't say, so the more real detail you give, the more personal every letter gets.
        </p>
        {sorting === 'sorting' && !touched.current && (
          <p className="flex items-center gap-2 bg-gold-soft/40 px-3 py-2 text-[12px] leading-relaxed text-ink-2">
            <Loader className="size-3.5 shrink-0 animate-spin text-gold" /> {aiName()} is sorting your earlier story into these questions, using your own sentences…
          </p>
        )}
        {sorting === 'failed' && !profile.storyAnswers && (
          <p className="bg-gold-soft/40 px-3 py-2 text-[12px] leading-relaxed text-ink-2">
            {aiName()} couldn't sort your earlier story right now, so all of it is under <strong className="font-semibold">Anything else</strong> and nothing is lost. Move parts of it into the questions if you like, then save.
          </p>
        )}
        {sortedFromStory && !touched.current && (
          <p className="bg-gold-soft/40 px-3 py-2 text-[12px] leading-relaxed text-ink-2">
            {aiName()} sorted your earlier story into these questions, using your own sentences. Anything that didn't fit a question is under <strong className="font-semibold">Anything else</strong>. Check them, then save to weave your story.
          </p>
        )}
        {STORY_QUESTIONS.map(q => (
          <Field
            key={q.id}
            label={
              <span className="flex items-center gap-1.5">
                {q.q} {q.optional && <span className="text-[11px] font-normal text-faint">optional</span>}
              </span>
            }
            hint={q.hint}
          >
            <Textarea value={answers[q.id] || ''} disabled={sorting === 'sorting'} onChange={e => type(q.id, e.target.value)} rows={q.id === 'more' ? 4 : 3} placeholder={q.placeholder} />
          </Field>
        ))}
        <div className="flex items-center justify-between gap-3">
          <span className="text-[11.5px] text-faint">Kept when you replace your resume.</span>
          <Button
            variant="primary"
            loading={saving}
            // Sorted but not woven yet counts as something to save.
            disabled={sorting === 'sorting' || !(dirty || (!profile.storyWovenAt && Object.values(answers).some(a => a?.trim())))}
            icon={<Sparkles className="size-3.5 text-gold" />}
            onClick={() => save(!dirty)}
          >
            Save and weave my story
          </Button>
        </div>
      </Card>

      <Card className="mt-3 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[13.5px] font-semibold text-ink">Your story, as your cover letters see it</div>
            <div className="mt-0.5 text-[12px] text-muted">
              {weaving
                ? `${aiName()} is weaving your answers…`
                : profile.storyWovenAt
                  ? `Woven by ${aiName()} ${timeAgo(profile.storyWovenAt, false)} · ${words} words`
                  : profile.story
                    ? 'Not woven yet: this is your story as you wrote it.'
                    : 'Answer the questions above and save to see it here.'}
            </div>
          </div>
          <Button variant="ghost" size="sm" disabled={weaving || saving || dirty || !profile.story} title={dirty ? 'Save your changes first' : undefined} icon={weaving ? <Loader className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />} onClick={() => save(true)}>
            Weave again
          </Button>
        </div>
        {failed && <p className="mt-3 bg-bad-soft px-3 py-2 text-[12px] text-bad">{aiName()} couldn't weave it ({lastRun.error?.split('\n')[0]}). Until it can, cover letters use your answers as written.</p>}
        {profile.story && <p className={cn('mt-4 text-[13.5px] leading-relaxed whitespace-pre-wrap text-ink-2', weaving && 'opacity-50')}>{profile.story}</p>}
      </Card>
    </>
  );
}

function StrengthRail({ p, prefs, onShowText }: { p: Profile; prefs: Preferences | null | undefined; onShowText: () => void }) {
  const jump = useSectionJump();
  const checks = profileChecks(p, prefs ?? null);
  const score = profileScore(p, prefs ?? null);
  const todo = checks.filter(c => !c.ok);
  const done = checks.filter(c => c.ok);
  return (
    <>
      <RailCard title="Profile strength">
        <div className="flex items-baseline justify-between">
          <span className="font-display text-[30px] leading-none text-ink">{score}%</span>
          <span className="text-[12px] text-muted">{todo.length ? `${todo.length} thing${todo.length === 1 ? '' : 's'} to improve` : 'All set'}</span>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden bg-ink/[0.07]">
          <div className={cn('h-full transition-all', score >= 80 ? 'bg-ok' : score >= 50 ? 'bg-gold' : 'bg-warn')} style={{ width: `${score}%` }} />
        </div>
        <div className="mt-3 space-y-0.5">
          {todo.map(c => (
            <button key={c.id} onClick={() => jump(c.section)} className="-mx-2 flex w-[calc(100%+16px)] items-start gap-2.5 px-2 py-1.5 text-left text-[12.5px] leading-snug text-ink-2 transition-colors hover:bg-ink/[0.04]">
              <span className="mt-[5px] size-2 shrink-0 bg-warn" />
              {c.text}
            </button>
          ))}
          {done.map(c => (
            <div key={c.id} className="flex items-start gap-2.5 py-1 text-[12.5px] leading-snug text-muted">
              <Check className="mt-0.5 size-3 shrink-0 text-ok" strokeWidth={3} />
              {c.text}
            </div>
          ))}
        </div>
      </RailCard>
      <RailCard title={`What ${aiName()} reads`}>
        <p className="text-[12.5px] leading-relaxed text-muted">The text pulled from your resume, exactly as {aiName()} sees it.</p>
        <Button className="mt-3" variant="secondary" size="sm" onClick={onShowText}>
          View extracted text
        </Button>
      </RailCard>
    </>
  );
}

// ---------------- application answers ----------------

/**
 * The questions almost every form asks, kept as answers in the answer bank. The categories copy how
 * the server files answers (CATEGORIES in server/agents/pipeline.ts), so an answer here is the one the AI reuses.
 */
const CATEGORIES: [string, RegExp][] = [
  ['sponsorship', /sponsor/i],
  ['authorization', /authori[sz]|right to work|work permit|eligib\w* to work|legally/i],
  ['salary', /salary|compensation|pay expectation|\bctc\b|expected pay/i],
  ['start', /notice period|start date|available to start|earliest|join(ing)? date/i],
  ['relocate', /relocat/i],
  ['onsite', /on-?site|in[- ]office|commute|hybrid/i],
];
/** A question's category is the first one it matches, exactly as the server decides. */
const category = (q: string) => CATEGORIES.find(([, re]) => re.test(q))?.[0];

const COMMON: { cat: string; question: string; label: string; placeholder: string }[] = [
  { cat: 'start', question: 'What is your notice period?', label: 'Notice period', placeholder: 'e.g. 1 month, or available right away' },
  { cat: 'salary', question: 'What are your salary expectations?', label: 'Expected salary', placeholder: 'e.g. 45,000 SEK a month' },
  { cat: 'authorization', question: 'Are you authorized to work in the country of this job?', label: 'Right to work', placeholder: 'e.g. Yes, EU citizen' },
  { cat: 'relocate', question: 'Are you willing to relocate?', label: 'Willing to relocate', placeholder: 'e.g. Yes, anywhere in Europe' },
];

const newAnswerId = () => `ans_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function ApplicationAnswers({ prefs }: { prefs: Preferences | null | undefined }) {
  const answers = useApp(s => s.answers);
  const save = (next: AnswerBankItem[]) => api.put('/api/answers', next);
  const pinned = COMMON.map(c => ({ ...c, item: answers.find(a => category(a.question) === c.cat) }));
  const pinnedIds = new Set(pinned.map(x => x.item?.id).filter(Boolean));
  const rest = answers.filter(a => !pinnedIds.has(a.id));

  const setPinned = (c: (typeof pinned)[number], value: string) => {
    const answer = value.trim();
    if (answer === (c.item?.answer || '')) return;
    if (c.item) save(answer ? answers.map(a => (a.id === c.item!.id ? { ...a, answer, updatedAt: new Date().toISOString() } : a)) : answers.filter(a => a.id !== c.item!.id));
    else if (answer) save([{ id: newAnswerId(), question: c.question, answer, updatedAt: new Date().toISOString(), uses: 0 }, ...answers]);
    toast.success(`${c.label} saved`);
  };

  const sponsorship = prefs?.needsSponsorship === undefined ? 'unset' : prefs.needsSponsorship === null ? 'skip' : prefs.needsSponsorship ? 'yes' : 'no';

  return (
    <div className="space-y-5">
      <Card className="divide-y divide-line-2">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
          <div>
            <div className="text-[13.5px] font-medium text-ink">Do you need visa sponsorship?</div>
            <div className="text-[12px] text-muted">{aiName()} also uses this to flag jobs that can't sponsor.</div>
          </div>
          <Segmented
            size="sm"
            value={sponsorship}
            onChange={v => api.put('/api/preferences', { needsSponsorship: v === 'skip' ? null : v === 'yes' }).then(() => toast.success('Saved'))}
            options={[
              { value: 'no', label: 'No' },
              { value: 'yes', label: 'Yes' },
              { value: 'skip', label: 'Depends' },
            ]}
          />
        </div>
        {pinned.map(c => (
          <div key={c.label} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
            <div className="text-[13.5px] font-medium text-ink">{c.label}</div>
            <Input
              key={c.item?.updatedAt || 'new'}
              className="w-full sm:w-[300px]"
              defaultValue={c.item?.answer || ''}
              placeholder={c.placeholder}
              onBlur={e => setPinned(c, e.target.value)}
              onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
          </div>
        ))}
      </Card>
      <div>
        <div className="mb-2 text-[12px] font-semibold tracking-[0.06em] text-muted uppercase">Remembered from your applications</div>
        <AnswerBank answers={rest} all={answers} />
      </div>
    </div>
  );
}

// ---------------- entry editors ----------------

function EntryEditor({ title, subtitle, children, onRemove }: { title: string; subtitle?: string; children: React.ReactNode; onRemove: () => void }) {
  const [open, setOpen] = React.useState(false);
  return (
    <Card className="overflow-hidden">
      <button onClick={() => setOpen(o => !o)} className="flex w-full items-center gap-3 px-4 py-3 text-left">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-semibold text-ink">{title}</div>
          {subtitle && <div className="truncate text-[12.5px] text-muted">{subtitle}</div>}
        </div>
        <ChevronDown className={cn('size-4 text-faint transition-transform', open && 'rotate-180')} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
            <div className="border-t border-line-2 p-4">
              {children}
              <div className="mt-4 flex justify-end">
                <Button variant="ghost" size="xs" className="text-bad hover:bg-bad-soft hover:text-bad" icon={<Trash2 className="size-3" />} onClick={onRemove}>
                  Remove
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}

function ExperienceFields({ value: e, onChange }: { value: ExperienceItem; onChange: (v: ExperienceItem) => void }) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Title">
          <Input value={e.title} onChange={x => onChange({ ...e, title: x.target.value })} />
        </Field>
        <Field label="Company">
          <Input value={e.company} onChange={x => onChange({ ...e, company: x.target.value })} />
        </Field>
        <Field label="Start">
          <Input value={e.start || ''} onChange={x => onChange({ ...e, start: x.target.value })} placeholder="Jun 2024" />
        </Field>
        <Field label="End">
          <Input value={e.end || ''} onChange={x => onChange({ ...e, end: x.target.value })} placeholder="Present" />
        </Field>
      </div>
      <BulletsField value={e.bullets} onChange={bullets => onChange({ ...e, bullets })} />
    </>
  );
}

function BulletsField({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [text, setText] = React.useState(value.join('\n'));
  React.useEffect(() => setText(value.join('\n')), [value.join('\n')]);
  return (
    <Field label="Bullet points" hint="One per line." className="mt-3">
      <Textarea
        value={text}
        onChange={e => setText(e.target.value)}
        onBlur={() =>
          onChange(
            text
              .split('\n')
              .map(s => s.replace(/^[•\-*]\s*/, '').trim())
              .filter(Boolean),
          )
        }
        className="min-h-[110px] text-[13px]"
      />
    </Field>
  );
}

// ---------------- remembered answers ----------------

/** Answers the AI saved while preparing applications. `answers` is what to list; edits apply to the whole bank (`all`). */
function AnswerBank({ answers, all }: { answers: AnswerBankItem[]; all: AnswerBankItem[] }) {
  const [editing, setEditing] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState('');
  const save = (next: AnswerBankItem[]) => api.put('/api/answers', next);

  if (!answers.length)
    return (
      <div className="flex items-start gap-3 border border-dashed border-line p-4 text-[12.5px] leading-relaxed text-muted">
        <BookmarkCheck className="mt-0.5 size-4 shrink-0 text-faint" />
        When {aiName()} asks you something else while preparing an application, your answer is saved here and reused, so you never get asked twice.
      </div>
    );

  return (
    <div className="space-y-2.5">
      {answers.map(a => (
        <Card key={a.id} className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="text-[13.5px] font-semibold text-ink">{a.question}</div>
            <div className="flex shrink-0 items-center gap-1">
              <Badge>used {a.uses}×</Badge>
              <button aria-label="Delete answer" onClick={() => save(all.filter(x => x.id !== a.id))} className="p-1 text-faint hover:bg-bad-soft hover:text-bad">
                <Trash2 className="size-3.5" />
              </button>
            </div>
          </div>
          {editing === a.id ? (
            <div className="mt-2 flex gap-2">
              <Input autoFocus value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => e.key === 'Enter' && (save(all.map(x => (x.id === a.id ? { ...x, answer: draft, updatedAt: new Date().toISOString() } : x))), setEditing(null))} />
              <Button
                variant="primary"
                icon={<Check className="size-4" />}
                onClick={() => {
                  save(all.map(x => (x.id === a.id ? { ...x, answer: draft, updatedAt: new Date().toISOString() } : x)));
                  setEditing(null);
                }}
              >
                Save
              </Button>
            </div>
          ) : (
            <button onClick={() => (setEditing(a.id), setDraft(a.answer))} className="mt-1 w-full text-left text-[13.5px] text-ink-2 hover:text-ink">
              {a.answer}
              <span className="ml-2 text-[11.5px] text-faint">· edited {timeAgo(a.updatedAt)}</span>
            </button>
          )}
        </Card>
      ))}
    </div>
  );
}
