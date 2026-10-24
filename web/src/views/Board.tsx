import * as React from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useDroppable,
  useSensor,
  useSensors,
  pointerWithin,
  rectIntersection,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowDownWideNarrow, Archive, Clock, GraduationCap, Mail, Plus, Radar, RefreshCw, Search, Sparkles, Star, Trash2, Wifi } from 'lucide-react';
import { BOARD_COLUMNS, type Job, type JobStatus } from '@shared/types';
import { jobTrack, type Track } from '@shared/track';
import { isStaleDraft, resumeHash } from '@shared/resume';
import { moveJob, startScout, useApp } from '@/lib/store';
import { navigate, openJob } from '@/lib/router';
import { cn, fitScore, greeting, isWorking, pendingQuestions, STATUS_META, timeAgo } from '@/lib/utils';
import { JobCard } from '@/components/JobCard';
import { Button, Menu, MenuContent, MenuItem, MenuTrigger, Segmented, Tooltip } from '@/components/ui';
import { Logo } from '@/components/brand';
import { AddJobDialog } from '@/components/AddJobDialog';
import { api } from '@/lib/api';
import { toast } from 'sonner';

type Sort = 'fit' | 'newest';

const collision: CollisionDetection = args => {
  const within = pointerWithin(args);
  if (within.length) {
    const archive = within.find(c => c.id === 'archive');
    if (archive) return [archive];
    const card = within.find(c => !String(c.id).startsWith('col:'));
    return card ? [card] : within;
  }
  return rectIntersection(args);
};

export function Board() {
  const jobsMap = useApp(s => s.jobs);
  const profile = useApp(s => s.profile);
  const scout = useApp(s => s.scout);
  const [query, setQuery] = React.useState('');
  const [remoteOnly, setRemoteOnly] = React.useState(false);
  const [starredOnly, setStarredOnly] = React.useState(false);
  // Full-time roles and PhD positions share the board; this switch shows one or both.
  const [track, setTrack] = React.useState<'all' | Track>(() => {
    try {
      return (localStorage.getItem('talaria-track') as 'all' | Track) || 'all';
    } catch {
      return 'all';
    }
  });
  const pickTrack = (t: 'all' | Track) => {
    setTrack(t);
    try {
      localStorage.setItem('talaria-track', t);
    } catch {}
  };
  const phdRunning = useApp(s => s.runs.some(r => r.title === 'PhD search' && (r.status === 'running' || r.status === 'queued')));
  const [sort, setSort] = React.useState<Sort>(() => (localStorage.getItem('talaria-sort') as Sort) || 'fit');
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [addOpen, setAddOpen] = React.useState(false);
  const searchRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input,textarea,[contenteditable=true]')) return;
      if (e.key === '/') {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === 'n' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setAddOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    const onAdd = () => setAddOpen(true);
    window.addEventListener('talaria:add-job', onAdd);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('talaria:add-job', onAdd);
    };
  }, []);

  const jobs = React.useMemo(() => Object.values(jobsMap), [jobsMap]);
  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return jobs.filter(j => {
      if (j.status === 'archived') return false;
      if (remoteOnly && j.remote !== 'remote') return false;
      if (starredOnly && !j.starred) return false;
      if (track !== 'all' && jobTrack(j) !== track) return false;
      if (q && !`${j.title} ${j.company} ${j.location} ${j.tags.join(' ')}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [jobs, query, remoteOnly, starredOnly, track]);
  const phdCount = React.useMemo(() => jobs.filter(j => j.status !== 'archived' && jobTrack(j) === 'phd').length, [jobs]);

  const columns = React.useMemo(() => {
    const by: Record<string, Job[]> = {};
    for (const s of BOARD_COLUMNS) by[s] = [];
    for (const j of filtered) by[j.status]?.push(j);
    for (const s of BOARD_COLUMNS) {
      by[s].sort((a, b) => {
        if (s === 'discovered') {
          if (sort === 'fit') return (fitScore(b) ?? -1) - (fitScore(a) ?? -1) || Date.parse(b.createdAt) - Date.parse(a.createdAt);
          return Date.parse(b.postedAt || b.createdAt) - Date.parse(a.postedAt || a.createdAt);
        }
        if (s === 'needs_input') {
          const pa = pendingQuestions(a) > 0 ? 0 : 1;
          const pb = pendingQuestions(b) > 0 ? 0 : 1;
          if (pa !== pb) return pa - pb;
        }
        return a.order - b.order || Date.parse(b.statusChangedAt) - Date.parse(a.statusChangedAt);
      });
    }
    return by;
  }, [filtered, sort]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const active = activeId ? jobsMap[activeId] : null;

  const onDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id));
  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    const id = String(e.active.id);
    const job = jobsMap[id];
    if (!job || !e.over) return;
    const overId = String(e.over.id);
    if (overId === 'archive') {
      moveJob(id, 'archived', { reason: job.status === 'applied' || job.status === 'interviewing' ? 'rejected' : 'dismissed' });
      toast(job.status === 'applied' || job.status === 'interviewing' ? `Closed ${job.company} as not selected` : `Dismissed ${job.title}`, {
        action: { label: 'Undo', onClick: () => moveJob(id, job.status) },
      });
      return;
    }
    const target: JobStatus = overId.startsWith('col:') ? (overId.slice(4) as JobStatus) : (jobsMap[overId]?.status ?? job.status);
    if (target === job.status) {
      if (target === 'discovered' || overId.startsWith('col:')) return;
      const ids = columns[target].map(j => j.id);
      const from = ids.indexOf(id);
      const to = ids.indexOf(overId);
      if (from < 0 || to < 0 || from === to) return;
      const next = arrayMove(ids, from, to);
      next.forEach((jid, i) => useApp.setState(s => ({ jobs: { ...s.jobs, [jid]: { ...s.jobs[jid], order: i } } })));
      api.post('/api/jobs/reorder', { status: target, ids: next }, { quiet: true });
      return;
    }
    if (target === 'preparing' && job.packet) toast(`Hermes is rewriting ${job.company} from scratch`, { description: 'The current draft stays under Versions.', icon: <Sparkles className="size-4 text-gold" /> });
    else if (target === 'preparing' || (target === 'needs_input' && !job.packet)) toast(`Hermes is preparing ${job.company}`, { icon: <Sparkles className="size-4 text-gold" /> });
    moveJob(id, target);
  };

  const all = jobs.filter(j => j.status !== 'archived');
  const needs = all.filter(j => j.status === 'needs_input' && pendingQuestions(j) > 0).length;
  const review = all.filter(j => j.status === 'needs_input' && pendingQuestions(j) === 0).length;
  const fresh = all.filter(j => j.status === 'discovered').length;
  const weekApplied = jobs.filter(j => j.appliedAt && Date.now() - Date.parse(j.appliedAt) < 7 * 86400000).length;

  const summaryBits = [
    needs ? `${needs} need${needs === 1 ? 's' : ''} your answers` : null,
    review ? `${review} ready for review` : null,
    `${fresh} fresh match${fresh === 1 ? '' : 'es'}`,
    `${weekApplied} applied this week`,
  ].filter(Boolean);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-end justify-between gap-4 px-7 pt-6 pb-4">
        <div className="min-w-0">
          <h1 className="font-display text-[27px] leading-none tracking-[-0.015em] text-ink">{greeting(profile?.name)}</h1>
          <p className="mt-2 text-[13.5px] text-muted">
            {summaryBits.map((b, i) => (
              <React.Fragment key={i}>
                {i > 0 && <span className="mx-1.5 text-faint">·</span>}
                <span className={cn(i === 0 && needs ? 'font-medium text-warn' : '')}>{b}</span>
              </React.Fragment>
            ))}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Segmented
            size="sm"
            value={track}
            onChange={pickTrack}
            options={[
              { value: 'all', label: 'All' },
              { value: 'job', label: 'Jobs' },
              { value: 'phd', label: `PhDs${phdCount ? ` · ${phdCount}` : ''}` },
            ]}
          />
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-faint" />
            <input
              ref={searchRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === 'Escape' && (setQuery(''), (e.target as HTMLInputElement).blur())}
              placeholder="Filter board"
              className="h-9 w-[200px] rounded-lg border border-line bg-card pr-8 pl-8 text-[13px] text-ink shadow-[0_1px_1px_rgb(0_0_0/0.02)] outline-none placeholder:text-faint focus:border-accent/50 focus:ring-[3px] focus:ring-accent/15"
            />
            <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-[11px] text-faint">/</span>
          </div>
          <Tooltip content="Remote only">
            <button onClick={() => setRemoteOnly(v => !v)} className={cn('grid size-9 place-items-center rounded-lg border transition-colors', remoteOnly ? 'border-accent/40 bg-accent-soft text-accent' : 'border-line bg-card text-muted hover:text-ink')}>
              <Wifi className="size-4" />
            </button>
          </Tooltip>
          <Tooltip content="Starred only">
            <button onClick={() => setStarredOnly(v => !v)} className={cn('grid size-9 place-items-center rounded-lg border transition-colors', starredOnly ? 'border-gold/40 bg-gold-soft text-gold' : 'border-line bg-card text-muted hover:text-ink')}>
              <Star className={cn('size-4', starredOnly && 'fill-gold')} />
            </button>
          </Tooltip>
          <CheckLiveButton />
          <Button variant="secondary" icon={<Plus className="size-4" />} onClick={() => setAddOpen(true)}>
            Add job
          </Button>
          {track === 'phd' ? (
            <Button
              variant="primary"
              icon={<GraduationCap className="size-4 text-gold" />}
              loading={phdRunning}
              onClick={() => api.post('/api/scout/phd').then(() => toast('Hermes is searching for PhD positions. This takes a few minutes.', { icon: <GraduationCap className="size-4 text-gold" /> }))}
            >
              {phdRunning ? 'Searching PhDs…' : 'Find PhDs'}
            </Button>
          ) : (
            <Button variant="primary" icon={<Sparkles className="size-4 text-gold" />} onClick={startScout} disabled={scout.running}>
              {scout.running ? 'Searching…' : 'Find jobs'}
            </Button>
          )}
        </div>
      </header>

      <AnimatePresence>{scout.running && <ScoutBanner />}</AnimatePresence>
      <RateLimitBanner />

      <DndContext sensors={sensors} collisionDetection={collision} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)}>
        <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto px-7 pb-5">
          {BOARD_COLUMNS.map(status => (
            <Column key={status} status={status} jobs={columns[status]} sort={sort} setSort={s => (setSort(s), localStorage.setItem('talaria-sort', s))} dragging={Boolean(activeId)} activeId={activeId} filtered={Boolean(query || remoteOnly || starredOnly)} />
          ))}
        </div>
        <ArchiveZone visible={Boolean(activeId)} />
        <DragOverlay dropAnimation={{ duration: 220, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1)' }}>{active ? <div className="w-[284px]"><JobCard job={active} overlay /></div> : null}</DragOverlay>
      </DndContext>

      <AddJobDialog open={addOpen} onOpenChange={setAddOpen} />
    </div>
  );
}

function RateLimitBanner() {
  const until = useApp(s => s.hermes.rateLimitedUntil);
  const queued = useApp(s => s.runs.filter(r => r.status === 'running' || r.status === 'queued').length);
  const [, tick] = React.useState(0);
  React.useEffect(() => {
    const t = setInterval(() => tick(x => x + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  if (!until || Date.parse(until) <= Date.now()) return null;
  const at = new Date(until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const mins = Math.max(1, Math.round((Date.parse(until) - Date.now()) / 60_000));
  return (
    <div className="px-7">
      <div className="mb-4 flex items-start gap-3 rounded-2xl border border-warn/25 bg-warn-soft/60 px-4 py-3">
        <Clock className="mt-0.5 size-4 shrink-0 text-warn" />
        <div className="text-[13px] leading-relaxed text-ink-2">
          <span className="font-semibold text-ink">GitHub Copilot is rate-limiting Hermes until {at}</span> (about {mins} min). {queued ? `${queued} queued task${queued === 1 ? '' : 's'} will` : 'Anything you start will'} continue automatically then. Nothing is lost.
          <span className="text-muted"> Greenhouse, Lever and Ashby links can still be added now.</span>
        </div>
      </div>
    </div>
  );
}

function ScoutBanner() {
  const scout = useApp(s => s.scout);
  const pct = Math.round((scout.progress ?? 0) * 100);
  return (
    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden px-7">
      <div className="mb-4 flex items-center gap-4 rounded-2xl bg-[#17161c] px-4 py-3 text-white shadow-lift dark:ring-1 dark:ring-white/10">
        <div className="grid size-9 shrink-0 animate-float place-items-center rounded-xl bg-white/10">
          <Logo className="size-6" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3 text-[13px]">
            <span className="truncate font-medium">{scout.phase || 'Searching'}…</span>
            <span className="shrink-0 text-[12px] text-white/55 tabular-nums">{scout.found ? `${scout.found} postings scanned · ` : ''}{pct}%</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
            <motion.div className="h-full rounded-full" style={{ background: 'linear-gradient(90deg, var(--gold), color-mix(in oklab, var(--gold) 50%, white))' }} animate={{ width: `${Math.max(4, pct)}%` }} transition={{ type: 'spring', bounce: 0, duration: 0.8 }} />
          </div>
        </div>
      </div>
    </motion.div>
  );
}

const SLIM: JobStatus[] = ['interviewing', 'offer'];

function Column({ status, jobs, sort, setSort, dragging, activeId, filtered }: { status: JobStatus; jobs: Job[]; sort: Sort; setSort: (s: Sort) => void; dragging: boolean; activeId: string | null; filtered: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${status}` });
  const meta = STATUS_META[status];
  const slim = SLIM.includes(status) && jobs.length === 0;
  const workingCount = jobs.filter(isWorking).length;
  const profile = useApp(s => s.profile);
  const stale = React.useMemo(() => {
    if (status !== 'needs_input') return [];
    const hash = resumeHash(profile);
    return jobs.filter(j => !isWorking(j) && !j.paused && isStaleDraft(j, profile, hash));
  }, [status, jobs, profile]);

  if (slim) {
    return (
      <div
        ref={setNodeRef}
        className={cn(
          'flex w-[52px] shrink-0 flex-col items-center rounded-2xl border border-dashed py-4 transition-colors',
          isOver ? 'border-transparent bg-accent-soft ring-2 ring-accent/40' : dragging ? 'border-line bg-panel' : 'border-line/80 bg-transparent',
        )}
      >
        <span className="size-2 rounded-full" style={{ background: meta.color }} />
        <span className="mt-3 text-[12.5px] font-semibold text-muted [writing-mode:vertical-rl]">{meta.label}</span>
      </div>
    );
  }

  return (
    <div className="flex w-[296px] shrink-0 flex-col">
      <div className="flex h-9 items-center gap-2 px-1.5">
        <span className="size-2 rounded-full" style={{ background: meta.color }} />
        <Tooltip content={meta.hint} side="bottom">
          <span className="text-[13px] font-semibold text-ink">{meta.label}</span>
        </Tooltip>
        <span className="text-[12.5px] text-faint tabular-nums">{jobs.length}</span>
        {workingCount > 0 && status !== 'preparing' && <Sparkles className="size-3.5 animate-pulse-soft text-gold" />}
        <div className="ml-auto">
          {status === 'discovered' && (
            <Menu>
              <MenuTrigger asChild>
                <button className="flex h-7 items-center gap-1 rounded-md px-1.5 text-[12px] text-muted hover:bg-ink/5 hover:text-ink">
                  <ArrowDownWideNarrow className="size-3.5" />
                  {sort === 'fit' ? 'Best fit' : 'Newest'}
                </button>
              </MenuTrigger>
              <MenuContent>
                <MenuItem onSelect={() => setSort('fit')}>Sort by best fit</MenuItem>
                <MenuItem onSelect={() => setSort('newest')}>Sort by newest</MenuItem>
              </MenuContent>
            </Menu>
          )}
          {stale.length > 0 && <RefreshStale jobs={stale} />}
          {status === 'applied' && <CheckReplies />}
        </div>
      </div>
      <div
        ref={setNodeRef}
        className={cn('relative flex min-h-0 flex-1 flex-col rounded-2xl p-1.5 transition-colors', isOver ? 'bg-accent-soft/60 ring-2 ring-accent/30' : dragging ? 'bg-ink/[0.025] dark:bg-white/[0.02]' : 'bg-transparent')}
      >
        <SortableContext items={jobs.map(j => j.id)} strategy={verticalListSortingStrategy}>
          <div className="-mx-1.5 flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-1.5 pt-0.5 pb-6">
            <AnimatePresence initial={false}>
              {jobs.map(job => (
                <SortableCard key={job.id} job={job} hidden={job.id === activeId} />
              ))}
            </AnimatePresence>
            {jobs.length === 0 && <ColumnEmpty status={status} filtered={filtered} />}
          </div>
        </SortableContext>
      </div>
    </div>
  );
}

function RefreshStale({ jobs }: { jobs: Job[] }) {
  const [busy, setBusy] = React.useState(false);
  const n = jobs.length;
  const refresh = async () => {
    setBusy(true);
    try {
      await api.post('/api/jobs/refresh-stale', { ids: jobs.map(j => j.id) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Tooltip content={`${n === 1 ? 'This draft was' : `These ${n} drafts were`} tailored from your old resume. Refresh to rewrite ${n === 1 ? 'it' : 'them'} from scratch with the new one. Your answers and notes carry over, and the old drafts stay under Versions.`} side="bottom">
      <button
        onClick={refresh}
        disabled={busy}
        aria-label={`Refresh ${n} with new resume`}
        className="grid size-7 place-items-center rounded-md text-gold transition-colors hover:bg-gold-soft disabled:opacity-60"
      >
        <RefreshCw className={cn('size-3.5', busy && 'animate-spin')} />
      </button>
    </Tooltip>
  );
}

/** Look in Gmail for replies to your applications now, instead of waiting for the 30-minute check. */
function CheckReplies() {
  const gmail = useApp(s => s.settings?.gmail);
  const running = useApp(s => s.runs.some(r => r.kind === 'mail' && (r.status === 'running' || r.status === 'queued')));
  const [busy, setBusy] = React.useState(false);
  const checking = busy || running;
  const tip = !gmail?.connected
    ? 'Connect Gmail in Settings so Talaria can read replies to your applications.'
    : gmail.error
      ? `Last check failed: ${gmail.error}`
      : gmail.lastCheckAt
        ? `Checked ${timeAgo(gmail.lastCheckAt, false)}: ${gmail.lastResult || 'no new replies'}.`
        : 'Look in your Gmail for replies to these applications.';
  const run = async () => {
    if (!gmail?.connected) return navigate({ view: 'settings' });
    setBusy(true);
    try {
      await api.post('/api/gmail/check');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Tooltip content={tip} side="bottom">
      <button
        onClick={run}
        disabled={checking}
        className="flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] font-medium text-muted transition-colors hover:bg-ink/5 hover:text-ink disabled:opacity-70 dark:hover:bg-white/[0.06]"
      >
        {checking ? <RefreshCw className="size-3.5 animate-spin" /> : <Mail className="size-3.5" />}
        {checking ? 'Checking…' : 'Check replies'}
      </button>
    </Tooltip>
  );
}

function SortableCard({ job, hidden }: { job: Job; hidden: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: job.id, data: { status: job.status } });
  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.15 } }}
      transition={{ type: 'spring', bounce: 0.15, duration: 0.45 }}
    >
      <div
        ref={setNodeRef}
        style={{ transform: CSS.Translate.toString(transform), transition }}
        {...attributes}
        {...listeners}
        onClick={() => openJob(job.id)}
        onKeyDown={e => {
          if (e.key === 'Enter') openJob(job.id);
          else listeners?.onKeyDown?.(e as any);
        }}
        className="cursor-pointer rounded-[14px] outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
      >
        <JobCard job={job} dragging={hidden} />
      </div>
    </motion.div>
  );
}

function ColumnEmpty({ status, filtered }: { status: JobStatus; filtered: boolean }) {
  const text: Partial<Record<JobStatus, string>> = {
    discovered: filtered ? 'Nothing matches your filters.' : 'Hit “Find jobs” and Hermes will scout the boards for roles that fit you.',
    preparing: 'Drag a job here — or press Prepare — and Hermes will tailor your resume and draft the application.',
    needs_input: 'Questions from Hermes and drafts awaiting your approval land here.',
    applied: 'Submitted applications collect here so you can track replies.',
  };
  return <div className="rounded-[14px] border border-dashed border-line px-4 py-6 text-center text-[12.5px] leading-relaxed text-faint">{text[status] || 'Drop a card here.'}</div>;
}

function ArchiveZone({ visible }: { visible: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'archive' });
  return (
    <AnimatePresence>
      {visible && (
        <motion.div initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 30, opacity: 0 }} className="pointer-events-none fixed bottom-6 left-1/2 z-30 -translate-x-1/2">
          <div
            ref={setNodeRef}
            className={cn(
              'pointer-events-auto flex h-12 items-center gap-2 rounded-full px-6 text-[13px] font-medium shadow-pop transition-all',
              isOver ? 'scale-105 bg-bad text-white' : 'bg-raised text-muted',
            )}
          >
            {isOver ? <Trash2 className="size-4" /> : <Archive className="size-4" />}
            {isOver ? 'Release to archive' : 'Drop here to archive'}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function CheckLiveButton() {
  const [busy, setBusy] = React.useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ checked: number; closed: number; unknown: number; details?: { id: string; company: string; title: string; live: boolean | null; reason: string }[] }>('/api/jobs/check-live');
      const list = (live: boolean | null) => (r.details || []).filter(d => d.live === live);
      const lines = (items: ReturnType<typeof list>) => (
        <ul className="mt-1 space-y-1">
          {items.slice(0, 5).map(d => (
            <li key={d.id}>
              <button className="text-left hover:underline" onClick={() => openJob(d.id)}>
                <span className="font-medium text-ink-2">{d.company}</span> · {d.title}
              </button>
              <div className="text-faint">{d.reason}</div>
            </li>
          ))}
          {items.length > 5 && <li className="text-faint">and {items.length - 5} more</li>}
        </ul>
      );
      toast(r.closed ? `${r.closed} posting${r.closed === 1 ? ' looks' : 's look'} closed` : 'No closed postings found', {
        duration: r.closed || r.unknown ? 15000 : 4000,
        description: (
          <div className="text-[12px]">
            Checked {r.checked} job{r.checked === 1 ? '' : 's'} you haven't applied to.
            {r.closed > 0 && (
              <>
                <div className="mt-2 font-medium">Closed:</div>
                {lines(list(false))}
              </>
            )}
            {r.unknown > 0 && (
              <>
                <div className="mt-2 font-medium">Couldn't check {r.unknown}:</div>
                {lines(list(null))}
              </>
            )}
          </div>
        ),
      });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Tooltip content={busy ? 'Checking postings…' : 'Check which postings are still open'}>
      <button onClick={run} disabled={busy} aria-label="Check which postings are still open" className="grid size-9 place-items-center rounded-lg border border-line bg-card text-muted transition-colors hover:text-ink disabled:opacity-70">
        <Radar className={cn('size-4', busy && 'animate-spin')} />
      </button>
    </Tooltip>
  );
}
