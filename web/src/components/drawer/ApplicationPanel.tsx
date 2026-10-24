import * as React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, ArrowRight, BookmarkCheck, Check, CircleHelp, Download, ExternalLink, FileCode2, FileText, Lightbulb, PenLine, RefreshCw, Send, Sparkles, Wand2 } from 'lucide-react';
import type { AgentQuestion, Job } from '@shared/types';
import { usableSuggestion } from '@shared/suggestion';
import { jobActions, patchJobLocal, useApp } from '@/lib/store';
import { cn, pendingQuestions, timeAgo } from '@/lib/utils';
import { Badge, Button, CopyButton, Input, SectionTitle, Segmented, Textarea, inputCls } from '../ui';
import { ResumePreview } from './ResumePreview';
import { useElapsed } from './hooks';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { navigate } from '@/lib/router';

type Sub = 'resume' | 'letter' | 'answers' | 'changes';

export function ApplicationPanel({ job }: { job: Job }) {
  const t = job.work.tailor;
  const running = t?.state === 'running' || t?.state === 'queued';
  const [sub, setSub] = React.useState<Sub>('resume');

  if (!job.packet) {
    if (running) return <PreparingState job={job} />;
    if (t?.state === 'error')
      return (
        <div className="rounded-2xl border border-bad/20 bg-bad-soft/50 p-5">
          <div className="flex items-center gap-2 font-semibold text-bad">
            <AlertTriangle className="size-4" /> Hermes couldn't finish this application
          </div>
          <p className="mt-1.5 text-[13px] text-ink-2">{t.error}</p>
          <Button className="mt-4" variant="secondary" icon={<RefreshCw className="size-4" />} onClick={() => jobActions.prepare(job.id)}>
            Try again
          </Button>
        </div>
      );
    return <PrepareCta job={job} />;
  }

  const p = job.packet;
  const cov = p.keywordCoverage;
  return (
    <div className="space-y-7">
      <AnimatePresence>
        {running && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="agent-sheen flex items-center gap-3 rounded-xl border border-gold/20 bg-gold-soft/60 px-4 py-3 text-[13px] font-medium text-gold">
              <Sparkles className="size-4 animate-pulse-soft" />
              {t?.step || 'Updating your application'}…
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {t?.state === 'error' && !running && (
        <div className="flex items-center gap-2 rounded-xl border border-bad/20 bg-bad-soft/50 px-4 py-3 text-[13px] text-bad">
          <AlertTriangle className="size-4 shrink-0" />
          <span className="flex-1">The last update failed: {t.error}</span>
          <button className="font-medium underline-offset-2 hover:underline" onClick={() => jobActions.prepare(job.id, { refine: true })}>
            Retry
          </button>
        </div>
      )}

      {job.questions.length > 0 && <QuestionsForm key={job.questions.map(q => q.id).join()} job={job} />}

      <div className="grid gap-3 sm:grid-cols-[1.4fr_1fr]">
        {cov && cov.after > 0 ? (
          <div className="rounded-2xl bg-card p-4 shadow-card">
            <div className="flex items-baseline justify-between">
              <span className="text-[12px] font-semibold tracking-[0.06em] text-muted uppercase">ATS keyword match</span>
              <span className="text-[13px] text-muted tabular-nums">
                {cov.before}% → <span className="font-semibold text-ok">{cov.after}%</span>
              </span>
            </div>
            <div className="relative mt-3 h-2 overflow-hidden rounded-full bg-line-2">
              <div className="absolute inset-y-0 left-0 rounded-full bg-ink/15" style={{ width: `${cov.before}%` }} />
              <motion.div className="absolute inset-y-0 left-0 rounded-full bg-ok" initial={{ width: `${cov.before}%` }} animate={{ width: `${cov.after}%` }} transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1], delay: 0.2 }} />
            </div>
            {cov.missing.length > 0 && (
              <>
                <div className="mt-3 flex flex-wrap gap-1">
                  {cov.missing.map(k => {
                    const unfit = cov.unfit?.includes(k);
                    return (
                      <span
                        key={k}
                        title={unfit ? "Tried: this doesn't match your experience" : undefined}
                        className={cn('inline-flex h-6 items-center rounded-md border border-dashed px-2 text-[11.5px]', unfit ? 'border-transparent text-faint line-through decoration-faint/60' : 'border-line text-muted')}
                      >
                        {k}
                      </span>
                    );
                  })}
                </div>
                <div className="mt-3 flex items-center justify-between gap-3">
                  <span className="text-[11.5px] leading-snug text-faint">
                    {missingToTry(cov)
                      ? 'Hermes adds the ones that are true for you, keeps the ones already in, and never lowers your score.'
                      : "The struck-through ones don't match your experience, so they're left out on purpose."}
                  </span>
                  {missingToTry(cov) > 0 && <Button
                    size="sm"
                    variant="secondary"
                    disabled={running}
                    icon={<Wand2 className="size-3.5 text-gold" />}
                    onClick={async () => {
                      const r = await api.post<{ keywords: string[] }>(`/api/jobs/${job.id}/weave-keywords`);
                      toast(`Hermes is working in ${r.keywords.length} keywords`, { icon: <Sparkles className="size-4 text-gold" /> });
                    }}
                  >
                    Work in {missingToTry(cov)} missing keyword{missingToTry(cov) === 1 ? '' : 's'}
                  </Button>}
                </div>
              </>
            )}
          </div>
        ) : (
          <div />
        )}
        <div className="flex flex-col justify-between rounded-2xl bg-card p-4 shadow-card">
          <span className="text-[12px] font-semibold tracking-[0.06em] text-muted uppercase">Status</span>
          <div className="mt-2 flex items-center gap-2 text-[13.5px] font-medium">
            {p.approvedAt ? (
              <>
                <Check className="size-4 text-ok" /> Approved {timeAgo(p.approvedAt)}
              </>
            ) : pendingQuestions(job) > 0 ? (
              <>
                <CircleHelp className="size-4 text-warn" /> Waiting on your answers
              </>
            ) : (
              <>
                <PenLine className="size-4 text-accent" /> Draft · ready for review
              </>
            )}
          </div>
          <div className="mt-1 text-[11.5px] text-faint">
            Drafted {timeAgo(p.generatedAt)} · {p.model}
          </div>
        </div>
      </div>

      <div>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <Segmented
            value={sub}
            onChange={setSub}
            options={[
              { value: 'resume', label: 'Tailored resume' },
              { value: 'letter', label: 'Cover letter' },
              { value: 'answers', label: `Form answers${p.answers.length ? ` · ${p.answers.length}` : ''}` },
              { value: 'changes', label: 'What changed' },
            ]}
          />
          {sub === 'resume' && (
            <div className="flex gap-1.5">
              {p.latex && (
                <>
                  <Button size="sm" variant="ghost" icon={<FileCode2 className="size-3.5" />} onClick={() => (location.href = `/api/jobs/${job.id}/resume.tex`)}>
                    .tex
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => openInOverleaf(p.latex!, `${job.company} resume`)}>
                    Overleaf
                  </Button>
                </>
              )}
              <Button size="sm" variant="outline" icon={<ExternalLink className="size-3.5" />} onClick={() => window.open(`/api/jobs/${job.id}/resume.pdf`, '_blank')}>
                Open PDF
              </Button>
              <Button size="sm" variant="secondary" icon={<Download className="size-3.5" />} onClick={() => (location.href = `/api/jobs/${job.id}/resume.pdf?download=1`)}>
                Download
              </Button>
            </div>
          )}
          {sub === 'letter' && (
            <div className="flex gap-1.5">
              <CopyButton text={p.coverLetter} size="sm" />
              <Button size="sm" variant="secondary" icon={<Download className="size-3.5" />} onClick={() => (location.href = `/api/jobs/${job.id}/cover-letter.pdf?download=1`)}>
                PDF
              </Button>
            </div>
          )}
        </div>

        <AnimatePresence mode="wait">
          <motion.div key={sub} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.16 }}>
            {sub === 'resume' && (p.latexStatus === 'compiled' ? <LatexPreview job={job} /> : (
              <>
                {p.latex && p.latexStatus === 'uncompiled' && <Notice>Your LaTeX resume was tailored, but no LaTeX compiler is installed — this preview uses Talaria's built-in layout. Download the .tex or open it in Overleaf for your own template.</Notice>}
                {p.latexStatus === 'error' && <Notice tone="bad">Hermes couldn't produce a version of your LaTeX template that compiles ({p.latexError?.split('\n')[0]}). Showing Talaria's built-in layout instead — try “Regenerate”.</Notice>}
                <ResumePreview resume={p.resume} />
              </>
            ))}
            {sub === 'letter' && <CoverLetter job={job} />}
            {sub === 'answers' && <FormAnswers job={job} />}
            {sub === 'changes' && (
              <div className="space-y-2.5">
                {p.changes.length === 0 && <p className="text-[13px] text-muted">No notes on changes for this draft.</p>}
                {p.changes.map((c, i) => (
                  <div key={i} className="flex gap-3 rounded-xl bg-card p-4 shadow-card">
                    <Lightbulb className="mt-0.5 size-4 shrink-0 text-gold" />
                    <div>
                      <div className="text-[13.5px] font-medium text-ink">{c.what}</div>
                      {c.why && <div className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{c.why}</div>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      <ReviseBox job={job} disabled={running} />
    </div>
  );
}

/** Missing keywords Hermes hasn't already tried and found untrue for you. */
export function missingToTry(cov?: { missing: string[]; unfit?: string[] }) {
  return cov ? cov.missing.filter(k => !cov.unfit?.includes(k)).length : 0;
}

// ---------------- states ----------------

function PrepareCta({ job }: { job: Job }) {
  const items = [
    ['Tailors your resume', 'Rewrites and reorders your real experience around what this role values — no invented facts.'],
    ['Writes the cover letter', 'Specific to the company and role, in a confident human voice.'],
    ['Drafts form answers', '“Why us?”, “Tell us about a project” — ready to paste.'],
    ['Asks before anything goes out', 'Sponsorship, salary, start date — Hermes checks with you and remembers your answers.'],
  ];
  return (
    <div className="overflow-hidden rounded-2xl bg-card shadow-card">
      <div className="border-b border-line-2 p-6">
        <div className="flex items-center gap-2 text-[12px] font-semibold tracking-[0.08em] text-gold uppercase">
          <Sparkles className="size-3.5" /> Hermes can take it from here
        </div>
        <div className="mt-2 font-display text-[21px] leading-tight text-ink">Prepare this application</div>
      </div>
      <div className="grid gap-x-6 gap-y-4 p-6 sm:grid-cols-2">
        {items.map(([t, d], i) => (
          <div key={i} className="flex gap-3">
            <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-lg bg-accent-soft text-[12px] font-semibold text-accent">{i + 1}</span>
            <div>
              <div className="text-[13.5px] font-semibold text-ink">{t}</div>
              <div className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{d}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between gap-4 bg-panel px-6 py-4">
        <span className="text-[12.5px] text-muted">Takes about a minute. You can keep browsing.</span>
        <Button variant="primary" icon={<Sparkles className="size-4 text-gold" />} onClick={() => (jobActions.prepare(job.id), navigate({ tab: 'workspace' }))}>
          Prepare application
        </Button>
      </div>
    </div>
  );
}

const BASE_STEPS = ['Analyzing fit', 'Tailoring resume & cover letter', 'Checking what to ask you'];

function PreparingState({ job }: { job: Job }) {
  const hasLatex = useApp(s => Boolean(s.profile?.latexSource));
  const STEPS = hasLatex ? [...BASE_STEPS, 'Writing your LaTeX resume'] : BASE_STEPS;
  const step = job.work.tailor?.step || STEPS[0];
  const idx = Math.max(0, STEPS.indexOf(step));
  const startedAt = job.timeline.slice().reverse().find(e => e.text.startsWith('Hermes started'))?.at;
  const elapsed = useElapsed(startedAt, true);
  return (
    <div className="overflow-hidden rounded-2xl bg-card shadow-card">
      <div className="agent-sheen flex items-center gap-4 border-b border-gold/15 bg-gold-soft/50 p-5">
        <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-card shadow-card">
          <Sparkles className="size-5 animate-pulse-soft text-gold" />
        </div>
        <div className="flex-1">
          <div className="font-semibold text-ink">Hermes is preparing your application</div>
          <div className="text-[13px] text-muted">Usually 30–90 seconds. Close this panel anytime — it keeps going.</div>
        </div>
        <span className="text-[12px] text-faint tabular-nums">{elapsed ? `${elapsed}s` : ''}</span>
      </div>
      <ol className="space-y-1 p-5">
        {STEPS.map((s, i) => {
          const done = i < idx;
          const current = i === idx;
          return (
            <li key={s} className={cn('flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13.5px]', current && 'bg-gold-soft/40')}>
              <span className={cn('grid size-6 place-items-center rounded-full border', done ? 'border-ok bg-ok text-white' : current ? 'border-gold text-gold' : 'border-line text-faint')}>
                {done ? <Check className="size-3.5" strokeWidth={3} /> : current ? <span className="size-2 animate-pulse rounded-full bg-gold" /> : <span className="text-[11px]">{i + 1}</span>}
              </span>
              <span className={cn(done ? 'text-muted line-through decoration-faint' : current ? 'font-medium text-ink' : 'text-faint')}>{s}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// ---------------- questions ----------------

function QuestionsForm({ job }: { job: Job }) {
  const initial = Object.fromEntries(job.questions.map(q => [q.id, q.answer ?? '']));
  const [answers, setAnswers] = React.useState<Record<string, string>>(initial);
  const [remember, setRemember] = React.useState<Record<string, boolean>>(Object.fromEntries(job.questions.map(q => [q.id, true])));
  const [busy, setBusy] = React.useState(false);
  const pending = pendingQuestions(job);
  const [open, setOpen] = React.useState(pending > 0);
  const missing = job.questions.filter(q => q.required && !answers[q.id]?.trim()).length;
  const dirty = job.questions.some(q => (answers[q.id] ?? '') !== (q.answer ?? ''));

  const submit = async () => {
    setBusy(true);
    try {
      await jobActions.answer(
        job.id,
        job.questions.filter(q => (answers[q.id] ?? '').trim()).map(q => ({ id: q.id, answer: answers[q.id], remember: remember[q.id] })),
        true,
      );
      toast.success('Thanks — Hermes is folding your answers into the application.');
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="flex w-full items-center gap-3 rounded-2xl bg-card px-4 py-3.5 text-left shadow-card transition-shadow hover:shadow-lift">
        <span className="grid size-8 place-items-center rounded-lg bg-ok-soft text-ok">
          <Check className="size-4" />
        </span>
        <div className="flex-1">
          <div className="text-[13.5px] font-semibold text-ink">Your answers ({job.questions.filter(q => q.answer).length}/{job.questions.length})</div>
          <div className="text-[12px] text-muted">Hermes used these in the application. Click to review or change.</div>
        </div>
        <ArrowRight className="size-4 text-faint" />
      </button>
    );
  }

  return (
    <motion.section initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="overflow-hidden rounded-2xl border border-warn/25 bg-card shadow-card">
      <div className="flex items-start gap-3 border-b border-warn/15 bg-warn-soft/60 px-5 py-4">
        <CircleHelp className="mt-0.5 size-5 shrink-0 text-warn" />
        <div>
          <div className="text-[15px] font-semibold text-ink">{pending > 0 ? `Hermes needs ${pending} answer${pending > 1 ? 's' : ''} before you submit` : 'Your answers'}</div>
          <div className="mt-0.5 text-[12.5px] text-muted">Answers are remembered, so you won't be asked the same thing twice.</div>
        </div>
      </div>
      <div className="divide-y divide-line-2">
        {job.questions.map(q => (
          <QuestionField
            key={q.id}
            q={q}
            value={answers[q.id] ?? ''}
            onChange={v => setAnswers(a => ({ ...a, [q.id]: v }))}
            remember={remember[q.id]}
            onRemember={v => setRemember(r => ({ ...r, [q.id]: v }))}
          />
        ))}
      </div>
      <div className="flex items-center justify-between gap-3 bg-panel px-5 py-3.5">
        <span className="text-[12.5px] text-muted">{missing ? `${missing} required answer${missing > 1 ? 's' : ''} left` : 'All set.'}</span>
        <div className="flex gap-2">
          {pending === 0 && (
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Close
            </Button>
          )}
          <Button variant={missing ? 'secondary' : 'primary'} size="md" loading={busy} disabled={missing > 0 || (!dirty && pending === 0)} icon={<Send className="size-4" />} onClick={submit}>
            Save & update application
          </Button>
        </div>
      </div>
    </motion.section>
  );
}

export function QuestionField({ q, value, onChange, remember, onRemember }: { q: AgentQuestion; value: string; onChange: (v: string) => void; remember: boolean; onRemember: (v: boolean) => void }) {
  const suggestion = usableSuggestion(q.suggested);
  return (
    <div className="px-5 py-4">
      <div className="flex items-start justify-between gap-3">
        <label className="text-[13.5px] leading-snug font-medium text-ink">
          {q.question}
          {q.required && <span className="ml-1 text-warn">*</span>}
        </label>
        {q.fromBank && (
          <Badge tone="ok" className="shrink-0">
            <BookmarkCheck className="size-3" /> Remembered
          </Badge>
        )}
      </div>
      {q.why && <p className="mt-1 text-[12.5px] leading-snug text-muted">{q.why}</p>}
      <div className="mt-2.5">
        {q.kind === 'yesno' ? (
          <div className="flex gap-2">
            {['Yes', 'No'].map(o => (
              <button key={o} type="button" onClick={() => onChange(o)} className={cn('h-9 rounded-lg border px-5 text-[13px] font-medium transition-colors', value === o ? 'border-ink bg-ink text-bg' : 'border-line bg-card text-ink-2 hover:border-ink/30')}>
                {o}
              </button>
            ))}
          </div>
        ) : q.kind === 'choice' && q.options?.length ? (
          <div className="flex flex-wrap gap-2">
            {q.options.map(o => (
              <button key={o} type="button" onClick={() => onChange(o)} className={cn('min-h-9 rounded-lg border px-3.5 py-1.5 text-left text-[13px] font-medium transition-colors', value === o ? 'border-ink bg-ink text-bg' : 'border-line bg-card text-ink-2 hover:border-ink/30')}>
                {o}
              </button>
            ))}
          </div>
        ) : q.kind === 'longtext' ? (
          <Textarea value={value} onChange={e => onChange(e.target.value)} placeholder="Type your answer…" />
        ) : (
          <Input type={q.kind === 'number' ? 'number' : 'text'} value={value} onChange={e => onChange(e.target.value)} placeholder="Type your answer…" />
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        {suggestion && value !== suggestion && (
          <div className="w-full">
            <p className="whitespace-pre-wrap rounded-lg bg-accent/5 px-3 py-2 text-[13px] leading-relaxed text-ink-2">{suggestion}</p>
            <button type="button" onClick={() => onChange(suggestion)} className="mt-1 inline-flex items-center gap-1 text-[12px] font-medium text-accent hover:underline">
              <Wand2 className="size-3" /> Use Hermes's suggestion
            </button>
          </div>
        )}
        <label className="ml-auto inline-flex cursor-pointer items-center gap-1.5 text-[12px] text-muted select-none">
          <input type="checkbox" checked={remember} onChange={e => onRemember(e.target.checked)} className="size-3.5 accent-[var(--accent)]" />
          Remember for future applications
        </label>
      </div>
    </div>
  );
}

// ---------------- editors ----------------

function AutoTextarea({ value, onChange, onBlur, className }: { value: string; onChange: (v: string) => void; onBlur?: () => void; className?: string }) {
  const ref = React.useRef<HTMLTextAreaElement>(null);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [value]);
  return <textarea ref={ref} value={value} onChange={e => onChange(e.target.value)} onBlur={onBlur} className={cn(inputCls, 'resize-none py-3 leading-relaxed', className)} />;
}

export function CoverLetter({ job }: { job: Job }) {
  const [text, setText] = React.useState(job.packet!.coverLetter);
  React.useEffect(() => setText(job.packet!.coverLetter), [job.packet!.coverLetter]);
  const save = () => {
    if (text !== job.packet!.coverLetter) {
      patchJobLocal(job.id, { packet: { ...job.packet!, coverLetter: text } });
      jobActions.patch(job.id, { packet: { coverLetter: text } }).then(() => toast.success('Cover letter saved'));
    }
  };
  return (
    <div className="rounded-2xl bg-white p-2 shadow-card dark:bg-card">
      <AutoTextarea value={text} onChange={setText} onBlur={save} className="border-transparent bg-transparent px-6 py-5 font-sans text-[14.5px] leading-[1.75] text-ink shadow-none focus:ring-0 dark:bg-transparent" />
      <div className="flex items-center justify-between px-6 pb-3 text-[11.5px] text-faint">
        <span>Click to edit · saves automatically</span>
        <span>{text.trim().split(/\s+/).length} words</span>
      </div>
    </div>
  );
}

export function FormAnswers({ job }: { job: Job }) {
  const p = job.packet!;
  const [items, setItems] = React.useState(p.answers);
  React.useEffect(() => setItems(p.answers), [p.answers]);
  const save = (next: typeof items) => {
    patchJobLocal(job.id, { packet: { ...p, answers: next } });
    jobActions.patch(job.id, { packet: { answers: next } });
  };
  if (!items.length) return <p className="text-[13px] text-muted">Hermes didn't draft any form answers for this one.</p>;
  return (
    <div className="space-y-3">
      {items.map((a, i) => (
        <div key={i} className="rounded-2xl bg-card p-4 shadow-card">
          <div className="mb-2 flex items-start justify-between gap-3">
            <div className="flex items-start gap-2 text-[13.5px] font-semibold text-ink">
              <FileText className="mt-0.5 size-4 shrink-0 text-faint" />
              {a.question}
            </div>
            <CopyButton text={a.answer} />
          </div>
          <AutoTextarea
            value={a.answer}
            onChange={v => setItems(items.map((x, j) => (j === i ? { ...x, answer: v } : x)))}
            onBlur={() => JSON.stringify(items) !== JSON.stringify(p.answers) && save(items)}
            className="border-transparent bg-panel text-[13.5px] text-ink-2 shadow-none"
          />
        </div>
      ))}
    </div>
  );
}

function ReviseBox({ job, disabled }: { job: Job; disabled: boolean }) {
  const [text, setText] = React.useState('');
  const ideas = ['Make the summary punchier', 'Emphasise my most relevant project', 'Keep it to one tight page', 'Warmer, less formal cover letter'];
  const go = (instructions: string) => {
    if (!instructions.trim()) return;
    jobActions.prepare(job.id, { refine: true, instructions });
    setText('');
    toast('Hermes is revising your application', { icon: <Sparkles className="size-4 text-gold" /> });
  };
  return (
    <section className="rounded-2xl border border-dashed border-line p-4">
      <SectionTitle className="mb-2.5">Ask Hermes to revise</SectionTitle>
      <form
        onSubmit={e => {
          e.preventDefault();
          go(text);
        }}
        className="flex gap-2"
      >
        <Input value={text} onChange={e => setText(e.target.value)} placeholder="e.g. lead with my internship, cut the coursework section" disabled={disabled} />
        <Button type="submit" variant="primary" disabled={disabled || !text.trim()} icon={<Wand2 className="size-4" />}>
          Revise
        </Button>
      </form>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {ideas.map(i => (
          <button key={i} disabled={disabled} onClick={() => go(i)} className="h-7 rounded-lg bg-ink/[0.04] px-2.5 text-[12px] text-muted transition-colors hover:bg-ink/[0.07] hover:text-ink disabled:opacity-50 dark:bg-white/[0.05]">
            {i}
          </button>
        ))}
      </div>
    </section>
  );
}

// ---------------- LaTeX ----------------

export function LatexPreview({ job }: { job: Job }) {
  const p = job.packet!;
  // Bust the browser cache whenever the draft changes.
  const src = `/api/jobs/${job.id}/resume.pdf?v=${encodeURIComponent(p.generatedAt)}#toolbar=0&navpanes=0&view=FitH`;
  return (
    <div className="overflow-hidden rounded-2xl bg-[#e9e7e1] p-3 dark:bg-[#0a0a0c]">
      {p.latexError && (
        <Notice>
          Hermes's tailored wording wouldn't compile, so this PDF is your original resume text in your own template. Hit “Regenerate” to try the tailoring again.
        </Notice>
      )}
      <div className="mb-2.5 flex items-center justify-between px-1 text-[12px] text-[#5a5a66] dark:text-faint">
        <span className="inline-flex items-center gap-1.5 font-medium">
          <FileCode2 className="size-3.5" /> Your LaTeX template, compiled with pdfLaTeX
        </span>
        <span>{p.latexPages === 1 ? 'Fits on one page' : `${p.latexPages} pages`}</span>
      </div>
      <iframe title="Tailored resume PDF" src={src} className="h-[880px] w-full rounded-[4px] bg-white shadow-[0_2px_8px_rgb(0_0_0/0.08)]" />
    </div>
  );
}

export function Notice({ children, tone = 'info' }: { children: React.ReactNode; tone?: 'info' | 'bad' }) {
  return <div className={cn('mb-3 rounded-xl px-4 py-3 text-[12.5px] leading-relaxed', tone === 'bad' ? 'bg-bad-soft/60 text-bad' : 'bg-info-soft text-info')}>{children}</div>;
}

export function openInOverleaf(tex: string, name: string) {
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = 'https://www.overleaf.com/docs';
  form.target = '_blank';
  const add = (k: string, v: string) => {
    const i = document.createElement('input');
    i.type = 'hidden';
    i.name = k;
    i.value = v;
    form.appendChild(i);
  };
  add('encoded_snip', encodeURIComponent(tex));
  add('snip_name', name);
  add('engine', 'pdflatex');
  document.body.appendChild(form);
  form.submit();
  form.remove();
}
