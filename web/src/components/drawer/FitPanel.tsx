import * as React from 'react';
import { motion } from 'motion/react';
import { AlertTriangle, ArrowUpRight, Check, CircleDashed, MessageSquarePlus, Minus, RefreshCw, Sparkles, ThumbsDown, ThumbsUp, Wand2, X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import type { Job } from '@shared/types';
import { jobActions, useApp } from '@/lib/store';
import { cn, scoreTone, timeAgo } from '@/lib/utils';
import { Badge, Button, SectionTitle, Textarea, Tooltip } from '../ui';
import { ScoreRing } from '../brand';
import { useElapsed } from './hooks';

export function FitPanel({ job }: { job: Job }) {
  const a = job.analysis;
  const state = job.work.analyze?.state;
  const running = state === 'running' || state === 'queued';
  const resumeText = useApp(s => s.profile?.resumeText?.toLowerCase() || '');

  if (!a) {
    if (state === 'error')
      return (
        <div className="rounded-2xl border border-bad/20 bg-bad-soft/50 p-5">
          <div className="flex items-center gap-2 font-semibold text-bad">
            <AlertTriangle className="size-4" /> Hermes couldn't finish the analysis
          </div>
          <p className="mt-1.5 text-[13px] text-ink-2">{job.work.analyze?.error}</p>
          <Button className="mt-4" variant="secondary" icon={<RefreshCw className="size-4" />} onClick={() => jobActions.analyze(job.id, true)}>
            Try again
          </Button>
        </div>
      );
    return <AnalyzingState job={job} running={running} />;
  }

  const tone = scoreTone(a.score);
  const met = a.mustHaves.filter(m => m.met === 'yes').length;

  return (
    <div className="space-y-7">
      <section className="relative overflow-hidden rounded-2xl bg-card p-5 shadow-card">
        <div className="absolute inset-y-0 left-0 w-1" style={{ background: tone.fg }} />
        <div className="flex items-start gap-5">
          <ScoreRing score={a.score} size={76} stroke={6} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-3">
              <div className="font-display text-[21px] leading-tight text-ink">{a.verdict}</div>
              <Tooltip content="Re-run analysis">
                <button onClick={() => jobActions.analyze(job.id, true)} disabled={running} className="rounded-lg p-1.5 text-faint transition-colors hover:bg-ink/5 hover:text-ink disabled:opacity-40">
                  <RefreshCw className={cn('size-4', running && 'animate-spin')} />
                </button>
              </Tooltip>
            </div>
            <p className="mt-1.5 text-[14px] leading-relaxed text-ink-2">{a.summary}</p>
            <div className="mt-3 text-[11.5px] text-faint">
              Hermes · {a.model || 'model'} · {timeAgo(a.generatedAt)}
              {a.mustHaves.length > 0 && ` · meets ${met} of ${a.mustHaves.length} key requirements`}
            </div>
          </div>
        </div>
      </section>

      {a.mustHaves.length > 0 && (
        <section>
          <SectionTitle>Requirements check</SectionTitle>
          <div className="divide-y divide-line-2 overflow-hidden rounded-2xl bg-card shadow-card">
            {a.mustHaves.map((m, i) => (
              <motion.div key={i} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04 }} className="flex items-start gap-3 px-4 py-3">
                <span className={cn('mt-0.5 grid size-5 shrink-0 place-items-center rounded-full', m.met === 'yes' ? 'bg-ok-soft text-ok' : m.met === 'partial' ? 'bg-gold-soft text-gold' : 'bg-bad-soft text-bad')}>
                  {m.met === 'yes' ? <Check className="size-3" strokeWidth={3} /> : m.met === 'partial' ? <Minus className="size-3" strokeWidth={3} /> : <X className="size-3" strokeWidth={3} />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-medium text-ink">{m.requirement}</div>
                  {m.note && <div className="mt-0.5 text-[12.5px] leading-snug text-muted">{m.note}</div>}
                </div>
              </motion.div>
            ))}
          </div>
        </section>
      )}

      <div className="grid gap-5 md:grid-cols-2">
        <section>
          <SectionTitle>
            <span className="inline-flex items-center gap-1.5 text-ok">
              <ThumbsUp className="size-3.5" /> Why you'll get it
            </span>
          </SectionTitle>
          <div className="space-y-2.5">
            {a.whyYes.map((x, i) => (
              <div key={i} className="rounded-xl border border-ok/15 bg-ok-soft/40 p-3.5">
                <div className="text-[13.5px] leading-snug font-medium text-ink">{x.point}</div>
                {x.evidence && <div className="mt-1.5 text-[12.5px] leading-snug text-muted">↳ {x.evidence}</div>}
              </div>
            ))}
          </div>
        </section>
        <section>
          <SectionTitle>
            <span className="inline-flex items-center gap-1.5 text-bad">
              <ThumbsDown className="size-3.5" /> Why you might not
            </span>
          </SectionTitle>
          <div className="space-y-2.5">
            {a.whyNo.map((x, i) => (
              <GapCard key={i} job={job} point={x.point} severity={x.severity} detail={x.detail} />
            ))}
          </div>
        </section>
      </div>

      <GapNotesFooter job={job} points={a.whyNo.map(x => x.point)} />

      {a.improve.length > 0 && (
        <section>
          <SectionTitle>How to make your odds better</SectionTitle>
          <ol className="space-y-2.5">
            {a.improve.map((x, i) => (
              <li key={i} className="flex gap-3.5 rounded-xl bg-card p-4 shadow-card">
                <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-accent-soft font-display text-[14px] text-accent">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="text-[13.5px] leading-snug font-semibold text-ink">{x.action}</div>
                    <div className="flex shrink-0 gap-1">
                      <Badge tone={x.impact === 'high' ? 'ok' : x.impact === 'medium' ? 'accent' : 'neutral'}>{x.impact} impact</Badge>
                      {x.effort && <Badge>{x.effort === 'quick' ? 'quick win' : `${x.effort} effort`}</Badge>}
                    </div>
                  </div>
                  {x.detail && <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{x.detail}</p>}
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      {a.keywords.length > 0 && (
        <section>
          <SectionTitle>Keywords recruiters will scan for</SectionTitle>
          <div className="flex flex-wrap gap-1.5">
            {a.keywords.map(k => {
              const has = resumeText.includes(k.toLowerCase());
              return (
                <span
                  key={k}
                  className={cn('inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-medium', has ? 'bg-ok-soft text-ok' : 'border border-dashed border-line text-muted')}
                  title={has ? 'On your resume' : 'Not on your resume yet'}
                >
                  {has ? <Check className="size-3" strokeWidth={3} /> : <CircleDashed className="size-3" />}
                  {k}
                </span>
              );
            })}
          </div>
          <p className="mt-2.5 text-[12px] text-faint">Green = already on your resume. Dashed = missing — the tailored resume works in the ones you can honestly claim.</p>
        </section>
      )}

      {job.status === 'discovered' && (
        <section className="flex items-center justify-between gap-4 rounded-2xl bg-ink p-5 text-bg">
          <div>
            <div className="font-display text-[17px] leading-tight">Worth a shot?</div>
            <p className="mt-1 text-[13px] text-bg/65">Hermes will tailor your resume, write the cover letter and ask you anything it needs.</p>
          </div>
          <Button variant="gold" size="lg" icon={<Sparkles className="size-4" />} onClick={() => jobActions.prepare(job.id)}>
            Prepare it
          </Button>
        </section>
      )}

      {job.applyUrl && (
        <a href={job.applyUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-ink">
          Open the original posting <ArrowUpRight className="size-3.5" />
        </a>
      )}
    </div>
  );
}

function AnalyzingState({ job, running }: { job: Job; running: boolean }) {
  const elapsed = useElapsed(job.work.analyze?.at, running);
  const lines = ['Reading the posting', 'Matching requirements against your experience', 'Weighing what could hold you back', 'Working out how to raise your odds'];
  const idx = Math.min(lines.length - 1, Math.floor(elapsed / 6));
  return (
    <div className="space-y-5">
      <div className="agent-sheen flex items-center gap-4 rounded-2xl border border-gold/20 bg-gold-soft/50 p-5">
        <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-card shadow-card">
          <Sparkles className="size-5 animate-pulse-soft text-gold" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-ink">Hermes is sizing up your odds</div>
          <motion.div key={idx} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="text-[13px] text-muted">
            {running ? `${lines[idx]}…` : 'Queued — starting shortly…'}
          </motion.div>
        </div>
        <span className="text-[12px] text-faint tabular-nums">{running ? `${elapsed}s` : ''}</span>
      </div>
      <div className="space-y-3">
        <div className="skeleton h-24" />
        <div className="grid grid-cols-2 gap-3">
          <div className="skeleton h-40" />
          <div className="skeleton h-40" />
        </div>
        <div className="skeleton h-28" />
      </div>
    </div>
  );
}

// ---------------- replying to gaps ----------------

function GapCard({ job, point, severity, detail }: { job: Job; point: string; severity: 'high' | 'medium' | 'low'; detail?: string }) {
  const note = job.gapNotes?.find(n => n.point === point);
  const [editing, setEditing] = React.useState(false);
  const [text, setText] = React.useState(note?.response || '');
  const [remember, setRemember] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  React.useEffect(() => setText(note?.response || ''), [note?.response]);

  const save = async (value: string) => {
    setSaving(true);
    try {
      await api.put(`/api/jobs/${job.id}/gap-notes`, { point, response: value, remember });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={cn('rounded-xl border p-3.5 transition-colors', note ? 'border-accent/20 bg-card' : 'border-bad/15 bg-bad-soft/40')}>
      <div className="flex items-start justify-between gap-2">
        <div className={cn('text-[13.5px] leading-snug font-medium', note ? 'text-ink-2' : 'text-ink')}>{point}</div>
        {note ? (
          <Badge tone="accent" className="shrink-0">
            <Check className="size-3" /> Replied
          </Badge>
        ) : (
          <Badge tone={severity === 'high' ? 'bad' : severity === 'medium' ? 'warn' : 'neutral'} className="shrink-0 capitalize">
            {severity}
          </Badge>
        )}
      </div>
      {detail && <div className="mt-1.5 text-[12.5px] leading-snug text-muted">{detail}</div>}

      {editing ? (
        <div className="mt-3">
          <Textarea
            autoFocus
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="Where have you actually done this? e.g. “At my last job I built the prototypes in React and tested them with 12 users” — or how you'd show it (a project, a link)."
            className="min-h-[96px] bg-card text-[13px]"
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && text.trim()) save(text);
              if (e.key === 'Escape') setEditing(false);
            }}
          />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <label className="inline-flex cursor-pointer items-center gap-1.5 text-[12px] text-muted select-none">
              <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} className="size-3.5 accent-[var(--accent)]" />
              Use this for all future applications
            </label>
            <div className="flex gap-1.5">
              {note && (
                <Button size="xs" variant="ghost" className="text-bad hover:bg-bad-soft hover:text-bad" onClick={() => save('')} disabled={saving}>
                  Remove
                </Button>
              )}
              <Button size="xs" variant="ghost" onClick={() => (setEditing(false), setText(note?.response || ''))}>
                Cancel
              </Button>
              <Button size="xs" variant="primary" loading={saving} disabled={!text.trim()} onClick={() => save(text)}>
                Save note
              </Button>
            </div>
          </div>
        </div>
      ) : note ? (
        <button onClick={() => setEditing(true)} className="mt-3 block w-full rounded-lg border-l-2 border-accent bg-accent-soft/50 px-3 py-2 text-left transition-colors hover:bg-accent-soft">
          <div className="text-[11px] font-semibold tracking-wide text-accent uppercase">Your note</div>
          <div className="mt-0.5 text-[12.5px] leading-relaxed text-ink-2">{note.response}</div>
        </button>
      ) : (
        <button onClick={() => setEditing(true)} className="mt-2.5 inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 -ml-1.5 text-[12px] font-medium text-accent transition-colors hover:bg-accent-soft">
          <MessageSquarePlus className="size-3.5" /> I have done this — explain
        </button>
      )}
    </div>
  );
}

function GapNotesFooter({ job, points }: { job: Job; points: string[] }) {
  const notes = (job.gapNotes || []).filter(n => n.response.trim());
  const earlier = notes.filter(n => !points.includes(n.point));
  const busy = ['running', 'queued'].includes(job.work.tailor?.state || '') || ['running', 'queued'].includes(job.work.analyze?.state || '');
  if (!notes.length) return null;
  return (
    <section className="rounded-2xl border border-accent/20 bg-accent-soft/40 p-4">
      {earlier.length > 0 && (
        <div className="mb-3 space-y-1.5">
          <div className="text-[11px] font-semibold tracking-wide text-accent uppercase">Earlier notes (Hermes now treats these as covered)</div>
          {earlier.map(n => (
            <div key={n.point} className="text-[12.5px] text-ink-2">
              <span className="font-medium">{n.point}:</span> {n.response}
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13.5px] font-semibold text-ink">
            You've explained {notes.length} gap{notes.length === 1 ? '' : 's'}
          </div>
          <div className="text-[12.5px] text-muted">Hermes will re-score your fit and rewrite the resume, cover letter and answers around what you told it.</div>
        </div>
        <Button
          variant="gold"
          loading={busy}
          icon={<Wand2 className="size-4" />}
          onClick={async () => {
            await api.post(`/api/jobs/${job.id}/apply-gap-notes`);
            toast('Hermes is re-scoring and rewriting with your notes', { icon: <Sparkles className="size-4 text-gold" /> });
          }}
        >
          {busy ? 'Rewriting…' : job.packet ? 'Rewrite with my notes' : 'Re-score & prepare with my notes'}
        </Button>
      </div>
    </section>
  );
}
