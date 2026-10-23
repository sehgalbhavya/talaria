import * as React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertCircle, Check, ChevronRight, FileSearch, Globe, Loader2, Mail, MessagesSquare, PenLine, Radar, ScrollText, Sparkles, Stethoscope, UserRound } from 'lucide-react';
import type { AgentRun, RunKind } from '@shared/types';
import { useApp } from '@/lib/store';
import { openJob } from '@/lib/router';
import { cn, fmtDuration, timeAgo } from '@/lib/utils';
import { Card, EmptyState, Segmented } from '@/components/ui';

const KIND: Record<RunKind, { icon: React.ElementType; label: string }> = {
  profile: { icon: UserRound, label: 'Profile' },
  scout: { icon: Radar, label: 'Scout' },
  hermes_web: { icon: Globe, label: 'Web search' },
  score: { icon: Sparkles, label: 'Scoring' },
  analyze: { icon: FileSearch, label: 'Fit analysis' },
  tailor: { icon: PenLine, label: 'Application' },
  summary: { icon: ScrollText, label: 'Summary' },
  submit: { icon: Check, label: 'Submit' },
  test: { icon: Stethoscope, label: 'Health check' },
  chat: { icon: MessagesSquare, label: 'Chat' },
  mail: { icon: Mail, label: 'Gmail' },
};

export function ActivityView() {
  const runs = useApp(s => s.runs);
  const [filter, setFilter] = React.useState<'all' | 'running' | 'errors'>('all');
  const shown = runs.filter(r => (filter === 'running' ? r.status === 'running' || r.status === 'queued' : filter === 'errors' ? r.status === 'error' : true));

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todays = runs.filter(r => Date.parse(r.startedAt) >= +today);
  const tokens = todays.reduce((a, r) => a + (r.usage?.totalTokens || 0), 0);
  const done = runs.filter(r => r.durationMs && r.status === 'done');
  const avg = done.length ? done.reduce((a, r) => a + (r.durationMs || 0), 0) / done.length : 0;
  const active = runs.filter(r => r.status === 'running' || r.status === 'queued').length;

  const groups = React.useMemo(() => {
    const g: { label: string; runs: AgentRun[] }[] = [];
    for (const r of shown) {
      const d = new Date(r.startedAt);
      const label = +new Date(d).setHours(0, 0, 0, 0) === +today ? 'Today' : d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
      if (!g.length || g[g.length - 1].label !== label) g.push({ label, runs: [] });
      g[g.length - 1].runs.push(r);
    }
    return g;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="px-7 pt-6 pb-5">
        <h1 className="font-display text-[27px] leading-none tracking-[-0.015em] text-ink">Agent activity</h1>
        <p className="mt-2 text-[13.5px] text-muted">Every task Hermes has run for you — what it did, how long it took, and what it cost in tokens.</p>
        <div className="mt-5 grid max-w-[860px] grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ['Running now', active, active ? 'var(--gold)' : undefined],
            ['Tasks today', todays.length],
            ['Tokens today', tokens ? `${(tokens / 1000).toFixed(tokens > 10000 ? 0 : 1)}k` : '0'],
            ['Avg. task time', avg ? fmtDuration(avg) : '—'],
          ].map(([l, v, c]) => (
            <Card key={l as string} className="p-3.5">
              <div className="text-[11.5px] font-semibold tracking-[0.05em] text-muted uppercase">{l}</div>
              <div className="mt-1 font-display text-[23px] leading-none text-ink tabular-nums" style={c ? { color: c as string } : undefined}>
                {v}
              </div>
            </Card>
          ))}
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-7 pb-12">
        <div className="max-w-[860px]">
          <Segmented
            className="mb-5"
            size="sm"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: 'All' },
              { value: 'running', label: 'Running' },
              { value: 'errors', label: 'Errors' },
            ]}
          />
          {groups.length === 0 ? (
            <Card>
              <EmptyState icon={<Sparkles className="size-5" />} title="Quiet in here">
                {filter === 'all' ? 'When Hermes scouts, analyzes or writes, each task shows up here live.' : 'Nothing matches this filter.'}
              </EmptyState>
            </Card>
          ) : (
            groups.map(g => (
              <section key={g.label} className="mb-6">
                <div className="mb-2 text-[12px] font-semibold tracking-[0.06em] text-muted uppercase">{g.label}</div>
                <Card className="divide-y divide-line-2 overflow-hidden">
                  {g.runs.map(r => (
                    <RunRow key={r.id} run={r} />
                  ))}
                </Card>
              </section>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function RunRow({ run }: { run: AgentRun }) {
  const [open, setOpen] = React.useState(false);
  const k = KIND[run.kind] || KIND.test;
  const Icon = k.icon;
  const live = run.status === 'running' || run.status === 'queued';
  return (
    <div className={cn(live && 'agent-sheen')}>
      <button onClick={() => setOpen(o => !o)} className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-panel/70">
        <span className={cn('grid size-8 shrink-0 place-items-center rounded-lg', run.status === 'error' ? 'bg-bad-soft text-bad' : live ? 'bg-gold-soft text-gold' : 'bg-ink/[0.05] text-muted dark:bg-white/[0.06]')}>
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px] font-medium text-ink">{run.title}</div>
          <div className="truncate text-[12px] text-muted">{run.error ? <span className="text-bad">{run.error}</span> : run.detail || (live ? run.log[run.log.length - 1]?.text || (run.status === 'queued' ? 'Waiting for a free Hermes slot' : 'Working') : k.label)}</div>
        </div>
        <div className="flex shrink-0 items-center gap-3 text-[12px] text-faint tabular-nums">
          {run.usage?.totalTokens ? <span>{(run.usage.totalTokens / 1000).toFixed(1)}k tok</span> : null}
          <span className="w-14 text-right">{live ? <Loader2 className="ml-auto size-3.5 animate-spin text-gold" /> : fmtDuration(run.durationMs)}</span>
          <span className="w-16 text-right">{timeAgo(run.startedAt)}</span>
          {run.status === 'done' ? <Check className="size-3.5 text-ok" /> : run.status === 'error' ? <AlertCircle className="size-3.5 text-bad" /> : <span className="size-3.5" />}
          <ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
        </div>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
            <div className="space-y-1 border-t border-line-2 bg-panel/60 px-4 py-3 pl-[60px] font-mono text-[11.5px] leading-relaxed text-muted">
              {run.log.length === 0 && <div>No log lines.</div>}
              {run.log.map((l, i) => (
                <div key={i} className="flex gap-3">
                  <span className="shrink-0 text-faint">{new Date(l.at).toLocaleTimeString()}</span>
                  <span className="text-ink-2">{l.text}</span>
                </div>
              ))}
              <div className="flex flex-wrap gap-x-4 pt-1.5 text-faint">
                {run.model && <span>model: {run.model}</span>}
                {run.usage?.apiCalls ? <span>API calls: {run.usage.apiCalls}</span> : null}
                {run.usage?.inputTokens ? <span>in: {run.usage.inputTokens.toLocaleString()}</span> : null}
                {run.usage?.outputTokens ? <span>out: {run.usage.outputTokens.toLocaleString()}</span> : null}
                {run.jobId && (
                  <button className="font-sans font-medium text-accent hover:underline" onClick={() => openJob(run.jobId!)}>
                    Open job →
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
