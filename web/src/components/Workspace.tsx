// The collaborative workspace: the job on the left, a conversation with Hermes in the middle and
// the live resume and cover letter on the right. Opens for jobs Hermes is working on or waiting on you.
import * as React from 'react';
import * as RDialog from '@radix-ui/react-dialog';
import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, ArrowUp, Check, ChevronDown, Clock, Download, ExternalLink, FileText, History, Info, Lightbulb, MapPin, PanelLeftClose, PanelLeftOpen, PartyPopper, Pencil, RefreshCw, Send, Sparkles, Wand2, X } from 'lucide-react';
import type { AgentQuestion, ChatMessage, Job } from '@shared/types';
import { jobTrack } from '@shared/track';
import { isStaleDraft } from '@shared/resume';
import { jobActions, useApp } from '@/lib/store';
import { closeJob, navigate } from '@/lib/router';
import { awaitingInterview, canAutoApply, cn, fitScore, fmtDate, isWorking, pendingQuestions, timeAgo, workingStep } from '@/lib/utils';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { Badge, Button, CopyButton, IconButton, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Segmented, Tooltip, inputCls } from './ui';
import { CompanyLogo, Logo, ScoreRing } from './brand';
import { PostingPanel } from './drawer/PostingPanel';
import { FitPanel } from './drawer/FitPanel';
import { CoverLetter, FormAnswers, missingToTry, QuestionField } from './drawer/ApplicationPanel';
import { ApplyKit } from './drawer/ApplyKit';
import { useElapsed } from './drawer/hooks';

type Pane = 'posting' | 'chat' | 'docs';

export function Workspace({ job, open }: { job: Job; open: boolean }) {
  const [pane, setPane] = React.useState<Pane>('chat');
  const [showPosting, setShowPosting] = React.useState(() => window.innerWidth >= 1440);
  const [kitOpen, setKitOpen] = React.useState(false);
  const score = fitScore(job);

  // Same cue as the drawer: opening a job gets Hermes's take on it.
  React.useEffect(() => {
    if (!job.analysis && !job.work.analyze) jobActions.analyze(job.id).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.id]);

  return (
    <RDialog.Root open={open} onOpenChange={v => !v && closeJob()}>
      <AnimatePresence>
        {open && (
          <RDialog.Portal forceMount>
            <RDialog.Overlay asChild>
              <motion.div className="fixed inset-0 z-40 bg-[#0b0b10]/30 dark:bg-black/55" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} />
            </RDialog.Overlay>
            <RDialog.Content asChild aria-describedby={undefined} onOpenAutoFocus={e => e.preventDefault()}>
              <motion.div
                className="fixed inset-2 z-40 flex flex-col overflow-hidden rounded-2xl bg-bg shadow-pop outline-none"
                initial={{ y: 14, opacity: 0, scale: 0.995 }}
                animate={{ y: 0, opacity: 1, scale: 1 }}
                exit={{ y: 10, opacity: 0 }}
                transition={{ type: 'spring', bounce: 0.08, duration: 0.42 }}
              >
                <RDialog.Title className="sr-only">
                  Workspace: {job.title} at {job.company}
                </RDialog.Title>

                {/* Header */}
                <div className="flex items-center gap-3 border-b border-line bg-panel px-4 py-2.5">
                  <CompanyLogo company={job.company} logo={job.companyLogo} domain={job.companyDomain} size={34} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-[12px] text-muted">
                      <span className="truncate font-semibold text-ink-2">{job.company}</span>
                      <span className="text-faint">·</span>
                      <MapPin className="size-3 shrink-0 text-faint" />
                      <span className="truncate">{job.location}</span>
                    </div>
                    <div className="truncate font-display text-[17px] leading-tight text-ink">{job.title}</div>
                  </div>
                  <Segmented
                    className="lg:hidden"
                    size="sm"
                    value={pane}
                    onChange={setPane}
                    options={[
                      { value: 'posting', label: 'Job' },
                      { value: 'chat', label: 'Chat' },
                      { value: 'docs', label: 'Resume' },
                    ]}
                  />
                  <Tooltip content={showPosting ? 'Hide the job posting' : 'Show the job posting side by side'}>
                    <button
                      onClick={() => setShowPosting(v => !v)}
                      className={cn('hidden h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-medium transition-colors lg:inline-flex', showPosting ? 'bg-ink/[0.06] text-ink dark:bg-white/[0.08]' : 'text-muted hover:bg-ink/[0.05] hover:text-ink')}
                    >
                      {showPosting ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}
                      Posting
                    </button>
                  </Tooltip>
                  <Tooltip content="Fit score from Hermes">
                    <div className="hidden sm:block">
                      <ScoreRing score={score} size={34} stroke={3} />
                    </div>
                  </Tooltip>
                  <Button size="sm" variant="ghost" className="max-sm:hidden" onClick={() => navigate({ tab: 'fit' })}>
                    Details
                  </Button>
                  {(job.applyUrl || job.url) && (
                    <IconButton label="Open original posting" onClick={() => window.open(job.applyUrl || job.url, '_blank', 'noopener')}>
                      <ExternalLink className="size-4" />
                    </IconButton>
                  )}
                  <div className="mx-0.5 h-5 w-px bg-line" />
                  <IconButton label="Close (Esc)" onClick={closeJob}>
                    <X className="size-4" />
                  </IconButton>
                </div>

                {/* Panes */}
                <div className="flex min-h-0 flex-1">
                  <aside className={cn('min-h-0 flex-col border-line max-lg:w-full lg:flex lg:w-[min(27%,420px)] lg:shrink-0 lg:border-r', pane === 'posting' ? 'flex' : 'max-lg:hidden', !showPosting && 'lg:hidden')}>
                    <JobPane job={job} />
                  </aside>
                  <section className={cn('min-h-0 flex-col border-line max-lg:w-full lg:flex lg:w-[min(31%,470px)] lg:min-w-[340px] lg:shrink-0 lg:border-r', pane === 'chat' ? 'flex' : 'max-lg:hidden')}>
                    <ChatPane job={job} />
                  </section>
                  <section className={cn('min-h-0 min-w-0 flex-1 flex-col lg:flex', pane === 'docs' ? 'flex' : 'max-lg:hidden')}>
                    <DocsPane job={job} />
                  </section>
                </div>

                <Footer job={job} openKit={() => setKitOpen(true)} />
              </motion.div>
            </RDialog.Content>
          </RDialog.Portal>
        )}
      </AnimatePresence>
      <ApplyKit job={job} open={kitOpen} onOpenChange={setKitOpen} />
    </RDialog.Root>
  );
}

// ---------------- left: the job ----------------

function JobPane({ job }: { job: Job }) {
  const [tab, setTab] = React.useState<'posting' | 'fit'>('posting');
  return (
    <>
      <div className="flex items-center justify-between gap-2 border-b border-line-2 px-4 py-2.5">
        <Segmented
          size="sm"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'posting', label: 'Job posting' },
            { value: 'fit', label: 'Fit & odds' },
          ]}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{tab === 'posting' ? <PostingPanel job={job} /> : <FitPanel job={job} />}</div>
    </>
  );
}

// ---------------- middle: the conversation ----------------

/** Older jobs have no chat yet: show their draft and open questions as if Hermes had said so. */
function displayMessages(job: Job): ChatMessage[] {
  const out: ChatMessage[] = [...(job.chat || [])];
  if (!out.length && job.packet)
    out.push({ id: 'v-draft', at: job.packet.generatedAt, from: 'hermes', kind: 'draft', text: "Here's your tailored resume and cover letter. Tell me anything you'd like changed.", changes: job.packet.changes });
  const referenced = new Set(out.flatMap(m => m.questionIds || []));
  const loose = job.questions.filter(q => !referenced.has(q.id));
  if (loose.length) out.push({ id: 'v-questions', at: job.updatedAt, from: 'hermes', kind: 'questions', text: 'Questions I have for you:', questionIds: loose.map(q => q.id) });
  return out;
}

function ChatPane({ job }: { job: Job }) {
  const messages = displayMessages(job);
  const working = isWorking(job);
  const scroller = React.useRef<HTMLDivElement>(null);
  const last = messages[messages.length - 1]?.id;

  React.useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [last, working]);

  return (
    <>
      <div className="flex items-center gap-2.5 border-b border-line-2 px-4 py-3">
        <HermesAvatar />
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-semibold text-ink">Hermes</div>
          <div className="truncate text-[11.5px] text-muted">{working ? `${workingStep(job) || 'Working'}…` : 'Asks before it decides. Every answer shapes the draft.'}</div>
        </div>
      </div>
      <div ref={scroller} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-5">
        {!messages.length && !working && (
          <div className="mx-auto max-w-sm pt-10 text-center">
            <div className="mx-auto mb-3 grid size-11 place-items-center rounded-xl bg-[#17161c] shadow-card">
              <Logo className="size-7" />
            </div>
            <div className="font-display text-[17px] text-ink">Work on this application with Hermes</div>
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted">Hermes asks you a few questions first, then drafts your resume and cover letter here. Ask for any change in plain words.</p>
            <Button className="mt-4" variant="primary" icon={<Sparkles className="size-4 text-gold" />} onClick={() => jobActions.prepare(job.id)}>
              Start
            </Button>
          </div>
        )}
        {messages.map(m => (
          <Message key={m.id} m={m} job={job} />
        ))}
        {working && <Thinking job={job} />}
      </div>
      <Composer job={job} />
    </>
  );
}

function HermesAvatar({ small }: { small?: boolean }) {
  return (
    <span className={cn('grid shrink-0 place-items-center rounded-lg bg-[#17161c] shadow-card dark:ring-1 dark:ring-white/10', small ? 'size-7' : 'size-8')}>
      <Logo className={small ? 'size-[18px]' : 'size-5'} />
    </span>
  );
}

function Message({ m, job }: { m: ChatMessage; job: Job }) {
  if (m.from === 'you') {
    return (
      <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex justify-end pl-10">
        <div className="rounded-2xl rounded-br-md bg-ink px-3.5 py-2.5 text-[13.5px] leading-relaxed whitespace-pre-wrap text-bg">{m.text}</div>
      </motion.div>
    );
  }
  if (m.kind === 'status') {
    return (
      <div className="flex justify-center">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-ok-soft px-3 py-1 text-[12px] font-medium text-ok">
          <Check className="size-3.5" />
          {m.text}
        </span>
      </div>
    );
  }
  const questions = (m.questionIds || []).map(id => job.questions.find(q => q.id === id)).filter(Boolean) as AgentQuestion[];
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex gap-2.5 pr-4">
      <HermesAvatar small />
      <div className="min-w-0 flex-1 space-y-2.5">
        <div className={cn('rounded-2xl rounded-tl-md px-3.5 py-2.5 text-[13.5px] leading-relaxed whitespace-pre-wrap', m.kind === 'error' ? 'bg-bad-soft/70 text-bad' : 'bg-card text-ink shadow-card')}>
          {m.kind === 'error' && <AlertTriangle className="mr-1.5 mb-0.5 inline size-3.5" />}
          {m.text}
          {m.changes && m.changes.length > 0 && <Changes changes={m.changes} />}
        </div>
        {m.snippet && (
          <div className="rounded-2xl border border-line bg-card p-3.5 shadow-card">
            <p className="text-[13.5px] leading-relaxed whitespace-pre-wrap text-ink">{m.snippet}</p>
            <div className="mt-2.5 flex items-center justify-between border-t border-line-2 pt-2 text-[11.5px] text-faint">
              <span className="tabular-nums">
                {m.snippet.length} characters · {m.snippet.trim().split(/\s+/).length} words
              </span>
              <CopyButton text={m.snippet} />
            </div>
          </div>
        )}
        {questions.length > 0 && <QuestionsBlock job={job} questions={questions} interview={m.kind === 'interview'} />}
        <div className="pl-1 text-[10.5px] text-faint">{timeAgo(m.at)}</div>
      </div>
    </motion.div>
  );
}

function Changes({ changes }: { changes: { what: string; why: string }[] }) {
  const [all, setAll] = React.useState(false);
  const shown = all ? changes : changes.slice(0, 3);
  return (
    <div className="mt-2.5 space-y-2 border-t border-line-2 pt-2.5">
      {shown.map((c, i) => (
        <div key={i} className="flex gap-2">
          <Lightbulb className="mt-0.5 size-3.5 shrink-0 text-gold" />
          <div className="text-[12.5px] leading-snug">
            <span className="font-medium text-ink">{c.what}</span>
            {c.why && <span className="text-muted"> {c.why}</span>}
          </div>
        </div>
      ))}
      {changes.length > 3 && (
        <button onClick={() => setAll(v => !v)} className="inline-flex items-center gap-1 text-[12px] font-medium text-accent hover:underline">
          {all ? 'Show less' : `${changes.length - 3} more change${changes.length - 3 > 1 ? 's' : ''}`}
          <ChevronDown className={cn('size-3 transition-transform', all && 'rotate-180')} />
        </button>
      )}
    </div>
  );
}

function QuestionsBlock({ job, questions, interview }: { job: Job; questions: AgentQuestion[]; interview: boolean }) {
  const settled = questions.every(q => q.answer?.trim() || q.skipped);
  const [editing, setEditing] = React.useState(!settled);
  const [answers, setAnswers] = React.useState<Record<string, string>>(() => Object.fromEntries(questions.map(q => [q.id, q.answer ?? ''])));
  const [remember, setRemember] = React.useState<Record<string, boolean>>(() => Object.fromEntries(questions.map(q => [q.id, q.reusable ?? true])));
  const [busy, setBusy] = React.useState(false);
  const waiting = interview && awaitingInterview(job);
  const filled = questions.filter(q => answers[q.id]?.trim()).length;
  const missingRequired = questions.filter(q => q.required && !answers[q.id]?.trim()).length;

  React.useEffect(() => {
    if (!settled) setEditing(true);
  }, [settled]);

  const send = async (skipRest: boolean) => {
    setBusy(true);
    try {
      await jobActions.answer(
        job.id,
        questions.map(q => ({ id: q.id, answer: answers[q.id] ?? '', remember: remember[q.id], skip: skipRest && !q.required })),
        true,
      );
      setEditing(false);
    } finally {
      setBusy(false);
    }
  };

  if (!editing) {
    return (
      <div className="overflow-hidden rounded-2xl border border-line-2 bg-panel">
        {questions.map(q => (
          <div key={q.id} className="border-b border-line-2 px-3.5 py-2.5 last:border-0">
            <div className="text-[12px] text-muted">{q.question}</div>
            <div className={cn('mt-0.5 text-[13px]', q.answer ? 'text-ink' : 'text-faint italic')}>{q.answer || (q.skipped ? 'Left to Hermes' : 'Not answered')}</div>
          </div>
        ))}
        <button onClick={() => setEditing(true)} className="flex w-full items-center justify-center gap-1.5 bg-card py-2 text-[12px] font-medium text-muted transition-colors hover:text-ink">
          <Pencil className="size-3" /> Change answers
        </button>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-warn/25 bg-card shadow-card">
      <div className="divide-y divide-line-2 [&>div]:px-4 [&>div]:py-3.5">
        {questions.map(q => (
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
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line-2 bg-panel px-4 py-3">
        <span className="mr-auto text-[12px] text-muted">
          {missingRequired ? `${missingRequired} required` : waiting ? (filled < questions.length ? 'Unanswered ones are left to Hermes' : 'All answered') : `${filled}/${questions.length} answered`}
        </span>
        <div className="flex flex-wrap justify-end gap-1.5">
          {settled && (
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          )}
          {waiting && filled === 0 && (
            <Button size="sm" variant="ghost" loading={busy} onClick={() => send(true)}>
              Skip, use your judgment
            </Button>
          )}
          <Button size="sm" variant="primary" loading={busy} disabled={filled === 0 || missingRequired > 0} icon={waiting ? <Sparkles className="size-3.5 text-gold" /> : <Send className="size-3.5" />} onClick={() => send(true)}>
            {waiting ? 'Draft with these answers' : 'Send answers'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Thinking({ job }: { job: Job }) {
  const step = workingStep(job) || 'Working';
  const since = [job.work.chat, job.work.tailor, job.work.submit, job.work.analyze].find(t => t && (t.state === 'running' || t.state === 'queued'))?.at;
  const elapsed = useElapsed(since, true);
  const pausedUntil = useApp(s => s.hermes.rateLimitedUntil);
  const paused = pausedUntil && Date.parse(pausedUntil) > Date.now() ? new Date(pausedUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex gap-2.5">
      <HermesAvatar small />
      <div className="agent-sheen inline-flex items-center gap-2.5 rounded-2xl rounded-tl-md border border-gold/15 bg-gold-soft/60 px-3.5 py-2.5 text-[13px] font-medium text-gold">
        {paused ? (
          <>
            <Clock className="size-3.5" /> Paused by Copilot's rate limit, resumes {paused}
          </>
        ) : (
          <>
            <span className="flex gap-1">
              {[0, 1, 2].map(i => (
                <motion.span key={i} className="size-1.5 rounded-full bg-gold" animate={{ opacity: [0.25, 1, 0.25] }} transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.18 }} />
              ))}
            </span>
            {step}…
            {elapsed > 3 && <span className="font-normal text-gold/70 tabular-nums">{elapsed}s</span>}
          </>
        )}
      </div>
    </motion.div>
  );
}

function Composer({ job }: { job: Job }) {
  const [text, setText] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const ref = React.useRef<HTMLTextAreaElement>(null);
  const chatting = job.work.chat?.state === 'running' || job.work.chat?.state === 'queued';
  const interview = awaitingInterview(job);
  const missing = missingToTry(job.packet?.keywordCoverage);

  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Grow with what you type. (An empty box stays one line: Chrome counts the placeholder in scrollHeight.)
    el.style.height = 'auto';
    if (text) el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [text]);

  const send = async (msg: string) => {
    if (!msg.trim() || chatting) return;
    setSending(true);
    try {
      await jobActions.chat(job.id, msg.trim());
      setText('');
    } finally {
      setSending(false);
    }
  };

  const chips: { label: string; run: () => void }[] = interview
    ? [{ label: 'Just draft it, use your judgment', run: () => jobActions.draftNow(job.id) }]
    : job.packet
      ? [
          ...(missing ? [{ label: `Work in ${missing} missing keyword${missing > 1 ? 's' : ''}`, run: () => api.post(`/api/jobs/${job.id}/weave-keywords`) }] : []),
          { label: 'Make the summary punchier', run: () => send('Make the summary punchier and more specific to this role.') },
          { label: 'Lead with my most relevant work', run: () => send('Reorder so my most relevant experience for this role comes first.') },
          { label: 'Warmer cover letter', run: () => send('Make the cover letter warmer and more personal.') },
          { label: "What's my weakest point here?", run: () => send("What's the weakest part of my application for this role?") },
        ]
      : [];

  return (
    <div className="border-t border-line-2 bg-panel px-3 pt-2.5 pb-3">
      {chips.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {chips.map(c => (
            <button
              key={c.label}
              disabled={chatting}
              onClick={c.run}
              className="h-7 shrink-0 rounded-full border border-line bg-card px-3 text-[12px] text-muted transition-colors hover:border-ink/20 hover:text-ink disabled:opacity-50"
            >
              {c.label}
            </button>
          ))}
        </div>
      )}
      <form
        onSubmit={e => {
          e.preventDefault();
          send(text);
        }}
        className={cn(inputCls, 'flex h-auto items-end gap-2 py-1.5 pr-1.5 pl-3 focus-within:ring-2 focus-within:ring-accent/25')}
      >
        <textarea
          ref={ref}
          rows={1}
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send(text);
            }
          }}
          placeholder={interview ? 'Answer above, or tell Hermes anything about this role…' : job.packet ? 'Ask for a change, or ask Hermes anything…' : 'Tell Hermes anything about this application…'}
          className="min-h-[34px] flex-1 resize-none bg-transparent py-1.5 text-[13.5px] leading-relaxed text-ink outline-none placeholder:text-faint"
        />
        <button
          type="submit"
          aria-label="Send"
          disabled={!text.trim() || chatting || sending}
          className="grid size-8 shrink-0 place-items-center rounded-lg bg-ink text-bg transition-opacity disabled:opacity-30"
        >
          <ArrowUp className="size-4" />
        </button>
      </form>
    </div>
  );
}

// ---------------- right: the documents ----------------

type Doc = 'resume' | 'letter' | 'original' | 'answers';

function DocsPane({ job }: { job: Job }) {
  const [doc, setDoc] = React.useState<Doc>('resume');
  const p = job.packet;
  const tailoring = job.work.tailor?.state === 'running' || job.work.tailor?.state === 'queued';
  const cov = p?.keywordCoverage;
  const history = job.packetHistory || [];
  const profile = useApp(s => s.profile);
  const stale = job.status === 'needs_input' && !tailoring && isStaleDraft(job, profile);

  // Whatever Hermes just changed comes into view, with a brief highlight. The resume PDF only
  // reloads when the resume itself changed, not for a cover-letter edit.
  const resumeVersion = React.useMemo(() => (p ? hash(`${p.latex || ''}${JSON.stringify(p.resume)}`) : ''), [p?.latex, p?.resume]);
  const [flash, setFlash] = React.useState(false);
  const seen = React.useRef({ resume: resumeVersion, letter: p?.coverLetter });
  React.useEffect(() => {
    const prev = seen.current;
    seen.current = { resume: resumeVersion, letter: p?.coverLetter };
    let changed: Doc | null = null;
    if (resumeVersion && resumeVersion !== prev.resume) changed = 'resume';
    else if (p?.coverLetter && prev.letter && p.coverLetter !== prev.letter && !tailoring) changed = 'letter';
    if (!changed) return;
    setDoc(changed);
    setFlash(true);
    const t = setTimeout(() => setFlash(false), 2600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeVersion, p?.coverLetter]);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line-2 px-4 py-2.5">
        <Segmented
          size="sm"
          value={doc}
          onChange={setDoc}
          options={[
            { value: 'resume', label: 'Tailored' },
            { value: 'letter', label: jobTrack(job) === 'phd' ? 'Motivation letter' : 'Cover letter' },
            { value: 'original', label: 'Original' },
            { value: 'answers', label: 'Answers' },
          ]}
        />
        <div className="flex items-center gap-1.5">
          <AnimatePresence>
            {flash && (
              <motion.span initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
                <Badge tone="ok">
                  <Sparkles className="size-3" /> Updated
                </Badge>
              </motion.span>
            )}
          </AnimatePresence>
          {p && (doc === 'resume' || doc === 'letter') && <RewriteButton job={job} part={doc === 'resume' ? 'resume' : 'cover'} busy={tailoring} />}
          {cov && cov.after > 0 && (
            <Tooltip content={cov.missing.length ? `Missing: ${cov.missing.filter(k => !cov.unfit?.includes(k)).join(', ') || 'none you can honestly add'}${cov.unfit?.length ? `. Left out (not your experience): ${cov.unfit.join(', ')}` : ''}` : 'Every keyword from the posting is in your resume'}>
              <span className="inline-flex h-7 items-center gap-1 rounded-md bg-ink/[0.04] px-2 text-[12px] text-muted tabular-nums dark:bg-white/[0.06]">
                ATS <span className="font-semibold text-ok">{cov.after}%</span>
              </span>
            </Tooltip>
          )}
          {history.length > 0 && (
            <Menu>
              <MenuTrigger asChild>
                <button className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12px] font-medium text-muted transition-colors hover:bg-ink/[0.05] hover:text-ink">
                  <History className="size-3.5" /> Versions
                </button>
              </MenuTrigger>
              <MenuContent>
                <div className="max-w-72 px-2.5 py-1.5 text-[11.5px] text-faint">Now: {p?.note || 'Current draft'}</div>
                <MenuSeparator />
                {history.map((v, i) => (
                  <MenuItem key={i} icon={<History />} disabled={tailoring} onSelect={() => jobActions.restore(job.id, i).then(() => toast.success('Restored that version'))}>
                    <span className="block max-w-64 truncate">{v.note}</span>
                    <span className="text-[11px] text-faint">{timeAgo(v.at)} · restore</span>
                  </MenuItem>
                ))}
              </MenuContent>
            </Menu>
          )}
          {p && (doc === 'resume' || doc === 'letter') && (
            <Tooltip content="Download PDF">
              <IconButton label="Download PDF" size="sm" onClick={() => (location.href = `/api/jobs/${job.id}/${doc === 'resume' ? 'resume' : 'cover-letter'}.pdf?download=1`)}>
                <Download className="size-4" />
              </IconButton>
            </Tooltip>
          )}
        </div>
      </div>

      {stale && (
        <div className="flex items-center gap-2 border-b border-gold/20 bg-gold-soft/70 px-4 py-2 text-[12.5px] text-ink-2">
          <Info className="size-3.5 shrink-0 text-gold" />
          <span className="min-w-0 flex-1 truncate">This draft was tailored from your previous resume.</span>
          <button
            className="shrink-0 font-medium text-ink hover:underline"
            onClick={() => api.post('/api/jobs/refresh-stale', { ids: [job.id] }).then(() => toast('Rewriting this draft with your new resume'))}
          >
            Refresh with new resume
          </button>
        </div>
      )}

      <div className="relative min-h-0 flex-1 overflow-y-auto bg-[#e9e7e1] p-4 dark:bg-[#0a0a0c]">
        {doc === 'resume' &&
          (p ? (
            <>
              {p.latexError && (
                <div className="mb-3 rounded-xl bg-info-soft px-4 py-2.5 text-[12.5px] text-info">Hermes's wording wouldn't compile in your LaTeX template, so this is your original text in it. Ask Hermes to try again.</div>
              )}
              <PdfFrame src={`/api/jobs/${job.id}/resume.pdf?v=${resumeVersion}`} title="Tailored resume" dim={tailoring} />
            </>
          ) : (
            <PdfFrame src="/api/profile/resume.pdf" title="Your resume" dim />
          ))}
        {doc === 'letter' && (p ? <div className="mx-auto max-w-[760px]">{p.coverLetter ? <CoverLetter job={job} /> : <Placeholder text="Hermes is writing the cover letter." />}</div> : <Placeholder text="The cover letter is written with your first draft, for every job, whether or not the form asks for one." />)}
        {doc === 'original' && <PdfFrame src="/api/profile/resume.pdf" title="Your resume" />}
        {doc === 'answers' && <div className="mx-auto max-w-[760px]">{p ? <FormAnswers job={job} /> : <Placeholder text="Hermes drafts answers to the usual form questions with your first draft." />}</div>}

        <AnimatePresence>{(doc === 'resume' || doc === 'letter') && (tailoring || (!p && !awaitingInterview(job) && isWorking(job))) && <BuildingOverlay job={job} />}</AnimatePresence>
        {doc === 'resume' && !p && awaitingInterview(job) && (
          <div className="pointer-events-none absolute inset-x-0 top-10 flex justify-center px-6">
            <div className="pointer-events-auto max-w-sm rounded-2xl bg-card/95 p-5 text-center shadow-pop backdrop-blur">
              <Info className="mx-auto size-5 text-accent" />
              <div className="mt-2 text-[14px] font-semibold text-ink">This is your resume as it is today</div>
              <p className="mt-1 text-[12.5px] leading-relaxed text-muted">Answer Hermes's questions in the chat and the tailored version is built from them, right here.</p>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

/** Rewrite one document from scratch, leaving the other as it is. The old one stays under Versions. */
function RewriteButton({ job, part, busy }: { job: Job; part: 'resume' | 'cover'; busy: boolean }) {
  const [sending, setSending] = React.useState(false);
  const label = part === 'resume' ? 'Rewrite resume' : 'Rewrite letter';
  return (
    <Tooltip content={part === 'resume' ? 'Hermes tailors your resume again from scratch for this job. The cover letter stays as it is.' : 'Hermes writes a new cover letter from scratch. The resume stays as it is.'}>
      <button
        disabled={busy || sending}
        onClick={async () => {
          setSending(true);
          try {
            await api.post(`/api/jobs/${job.id}/rewrite`, { part });
            toast(part === 'resume' ? 'Hermes is rewriting your resume' : 'Hermes is writing a new cover letter', { icon: <Sparkles className="size-4 text-gold" /> });
          } finally {
            setSending(false);
          }
        }}
        className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12px] font-medium text-muted transition-colors hover:bg-ink/[0.05] hover:text-ink disabled:opacity-50 dark:hover:bg-white/[0.06]"
      >
        <RefreshCw className={cn('size-3.5', (busy || sending) && 'animate-spin')} />
        {label}
      </button>
    </Tooltip>
  );
}

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function PdfFrame({ src, title, dim }: { src: string; title: string; dim?: boolean }) {
  return (
    <iframe
      key={src}
      title={title}
      src={`${src}${src.includes('#') ? '' : '#'}toolbar=0&navpanes=0&view=FitH`}
      className={cn('mx-auto block h-full min-h-[600px] w-full max-w-[900px] rounded-[4px] bg-white shadow-[0_2px_10px_rgb(0_0_0/0.10)] transition-[filter,opacity] duration-500', dim && 'opacity-60 blur-[1.5px]')}
    />
  );
}

function Placeholder({ text }: { text: string }) {
  return (
    <div className="mx-auto mt-10 max-w-sm rounded-2xl bg-card p-6 text-center shadow-card">
      <FileText className="mx-auto size-5 text-faint" />
      <p className="mt-2 text-[13px] leading-relaxed text-muted">{text}</p>
    </div>
  );
}

/** The server's step names, folded into three stages you can follow. */
function buildStage(step: string) {
  if (/analy[sz]ing fit|reading|ask you/i.test(step) && !/checking/i.test(step)) return 0;
  if (/latex/i.test(step)) return 2;
  return 1;
}

function BuildingOverlay({ job }: { job: Job }) {
  const step = workingStep(job) || 'Working';
  const hasLatex = useApp(s => Boolean(s.profile?.latexSource));
  const steps = ['Reading the posting and your answers', /cover letter$/i.test(step) && job.packet ? 'Rewriting your cover letter' : /resume from scratch|ATS keywords/i.test(step) ? 'Rewriting your resume' : 'Rewriting your resume and cover letter', ...(hasLatex ? ['Typesetting it in your LaTeX template'] : [])];
  const idx = Math.min(buildStage(step), steps.length - 1);
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="pointer-events-none absolute inset-x-0 top-10 flex justify-center px-6">
      <div className="w-full max-w-sm overflow-hidden rounded-2xl bg-card/95 shadow-pop backdrop-blur">
        <div className="agent-sheen flex items-center gap-3 border-b border-gold/15 bg-gold-soft/50 px-4 py-3">
          <Sparkles className="size-4 animate-pulse-soft text-gold" />
          <span className="text-[13px] font-semibold text-ink">{job.packet ? 'Hermes is revising' : 'Hermes is building your application'}</span>
        </div>
        <ol className="space-y-0.5 p-3">
          {steps.map((s, i) => {
            const done = i < idx;
            const current = i === idx;
            return (
              <li key={s} className={cn('flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-[12.5px]', current && 'bg-gold-soft/40')}>
                <span className={cn('grid size-5 place-items-center rounded-full border', done ? 'border-ok bg-ok text-white' : current ? 'border-gold text-gold' : 'border-line text-faint')}>
                  {done ? <Check className="size-3" strokeWidth={3} /> : current ? <span className="size-1.5 animate-pulse rounded-full bg-gold" /> : <span className="text-[10px]">{i + 1}</span>}
                </span>
                <span className={cn(done ? 'text-muted' : current ? 'font-medium text-ink' : 'text-faint')}>{s}</span>
              </li>
            );
          })}
        </ol>
      </div>
    </motion.div>
  );
}

// ---------------- bottom: finalize ----------------

function Footer({ job, openKit }: { job: Job; openKit: () => void }) {
  const autoSubmit = useApp(s => s.settings?.apply?.autoSubmit ?? false);
  const auto = autoSubmit && canAutoApply(job);
  const pending = pendingQuestions(job);
  const working = isWorking(job);
  const submit = job.work.submit;
  const submitting = submit?.state === 'running' || submit?.state === 'queued';
  const interview = awaitingInterview(job);
  const [busy, setBusy] = React.useState(false);
  const applied = job.status === 'applied' || job.status === 'interviewing' || job.status === 'offer';

  const finalize = async () => {
    setBusy(true);
    try {
      const r = await jobActions.finalize(job.id);
      if (r.mode === 'kit') {
        if (r.error) toast.error(r.error);
        openKit();
      } else toast(`Opening ${job.company}'s form in the Talaria window`, { icon: <Send className="size-4" /> });
    } finally {
      setBusy(false);
    }
  };

  let left: React.ReactNode;
  if (applied)
    left = (
      <span className="inline-flex items-center gap-2 text-[13px] font-medium text-ok">
        <PartyPopper className="size-4" /> Applied {fmtDate(job.appliedAt)}
        {job.appliedVia === 'auto' ? ', submitted by Talaria' : ''}
      </span>
    );
  else if (submitting) left = <span className="text-[13px] text-muted">{submit?.step || 'Applying'}… Watch it in the Talaria browser window.</span>;
  else if (interview)
    left = (
      <span className="text-[13px] text-muted">
        Hermes has {pending} question{pending === 1 ? '' : 's'} before drafting.{' '}
        <button className="font-medium text-accent hover:underline" onClick={() => jobActions.draftNow(job.id)}>
          Draft without answering
        </button>
      </span>
    );
  else if (working) left = <span className="text-[13px] text-muted">{workingStep(job)}… You can close this; Hermes keeps going.</span>;
  else if (submit?.state === 'error') left = <span className="text-[13px] font-medium text-bad">{submit.error}</span>;
  else if (pending > 0) left = <span className="text-[13px] font-medium text-warn">Answer {pending} question{pending > 1 ? 's' : ''} in the chat before finalizing.</span>;
  else if (job.packet)
    left = <span className="text-[13px] text-muted">{auto ? `Finalizing submits it to ${job.company} for you, in the Talaria window.` : 'Finalizing opens the Apply kit: your PDFs, the link and copy-ready answers.'}</span>;
  else left = <span className="text-[13px] text-muted">Nothing is sent until you finalize.</span>;

  return (
    <div className="flex items-center justify-between gap-3 border-t border-line bg-panel px-5 py-3">
      <div className="min-w-0 truncate">{left}</div>
      <div className="flex shrink-0 items-center gap-2">
        {applied ? (
          <Button variant="secondary" onClick={closeJob}>
            Close
          </Button>
        ) : (
          <>
            {job.packet && submit?.state === 'error' && (
              <Button variant="ghost" onClick={() => jobActions.applied(job.id, 'manual')}>
                Already submitted it
              </Button>
            )}
            {job.packet && (
              <Button variant="ghost" onClick={openKit} icon={<FileText className="size-4" />} className="max-sm:hidden">
                Apply kit
              </Button>
            )}
            <Button variant="primary" size="lg" loading={busy || submitting} disabled={!job.packet || pending > 0 || working} icon={auto ? <Send className="size-4" /> : <Wand2 className="size-4 text-gold" />} onClick={finalize}>
              {submit?.state === 'error' ? 'Try again' : auto ? 'Finalize & submit' : 'Finalize & apply'}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
