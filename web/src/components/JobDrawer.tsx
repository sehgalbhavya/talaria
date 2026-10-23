import * as React from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { motion } from 'motion/react';
import { Archive, ArrowRight, Check, ExternalLink, Link2, Mail, MapPin, MessagesSquare, MoreHorizontal, RefreshCw, RotateCcw, Send, Sparkles, Star, Trash2, X, XCircle } from 'lucide-react';
import type { Job, JobStatus } from '@shared/types';
import { jobActions, moveJob, useApp } from '@/lib/store';
import { closeJob, navigate } from '@/lib/router';
import { canAutoApply, cn, copyText, fitScore, fmtDate, isWorking, pendingQuestions, SOURCE_LABEL, STATUS_META, timeAgo } from '@/lib/utils';
import { Badge, Button, IconButton, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Sheet, Tooltip } from './ui';
import { CompanyLogo, ScoreRing } from './brand';
import { FitPanel } from './drawer/FitPanel';
import { ApplicationPanel } from './drawer/ApplicationPanel';
import { PostingPanel } from './drawer/PostingPanel';
import { TimelinePanel } from './drawer/TimelinePanel';
import { ApplyKit } from './drawer/ApplyKit';
import { remoteLabel } from './JobCard';
import { Workspace } from './Workspace';
import { toast } from 'sonner';

type Tab = 'fit' | 'application' | 'posting' | 'timeline';

function defaultTab(j: Job): Tab {
  if (j.status === 'discovered') return 'fit';
  if (j.status === 'preparing' || j.status === 'needs_input') return 'application';
  return j.packet ? 'application' : 'fit';
}

export function JobDrawer({ jobId, tab }: { jobId: string | null; tab: string | null }) {
  const job = useApp(s => (jobId ? s.jobs[jobId] : undefined));
  const loaded = useApp(s => s.loaded);
  const lastJob = React.useRef<Job | undefined>(undefined);
  if (job) lastJob.current = job;
  const open = Boolean(jobId && job);

  React.useEffect(() => {
    if (jobId && loaded && !job) closeJob();
  }, [jobId, job, loaded]);

  const shown = job || lastJob.current;

  // Jobs Hermes is working on, or waiting on you for, open in the workspace. The choice is made
  // when the job opens, so a submission landing mid-view doesn't swap the screen under you.
  const mode = React.useRef<{ key: string; workspace: boolean } | null>(null);
  const key = `${jobId}|${tab}`;
  if (shown && jobId && mode.current?.key !== key) mode.current = { key, workspace: wantsWorkspace(shown, tab) };
  const workspace = Boolean(mode.current?.workspace);

  return (
    <>
      <Sheet open={open && !workspace} onOpenChange={v => !v && closeJob()} label={shown ? `${shown.title} at ${shown.company}` : 'Job'}>
        {shown && !workspace && <DrawerBody key={shown.id} job={shown} tab={(tab as Tab) || null} />}
      </Sheet>
      {shown && <Workspace key={shown.id} job={shown} open={open && workspace} />}
    </>
  );
}

function wantsWorkspace(j: Job, tab: string | null) {
  if (tab === 'workspace') return true;
  if (tab) return false;
  return j.status === 'preparing' || j.status === 'needs_input';
}

function DrawerBody({ job, tab: tabParam }: { job: Job; tab: Tab | null }) {
  const [tab, setTab] = React.useState<Tab>(tabParam || defaultTab(job));
  const [kitOpen, setKitOpen] = React.useState(false);
  const pending = pendingQuestions(job);
  const working = isWorking(job);
  const score = fitScore(job);

  React.useEffect(() => {
    if (tabParam) setTab(tabParam);
  }, [tabParam]);

  // Opening a job is the cue to get Hermes's take on it.
  React.useEffect(() => {
    if (!job.analysis && !job.work.analyze && job.status !== 'archived') jobActions.analyze(job.id).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.id]);

  // Jump to the application tab when a draft lands while the panel is open.
  const hadPacket = React.useRef(Boolean(job.packet));
  React.useEffect(() => {
    if (job.packet && !hadPacket.current) setTab('application');
    hadPacket.current = Boolean(job.packet);
  }, [job.packet]);

  const remote = remoteLabel(job);

  return (
    <>
      <div className="flex items-center justify-between gap-2 border-b border-line bg-panel px-4 py-2.5">
        <StatusMenu job={job} />
        <div className="flex items-center gap-0.5">
          {(job.packet || job.interview || job.status === 'preparing' || job.status === 'needs_input') && (
            <Button size="sm" variant="secondary" className="mr-1" icon={<MessagesSquare className="size-3.5" />} onClick={() => navigate({ tab: 'workspace' })}>
              Workspace
            </Button>
          )}
          <IconButton label={job.starred ? 'Unstar' : 'Star'} onClick={() => jobActions.patch(job.id, { starred: !job.starred })}>
            <Star className={cn('size-4', job.starred && 'fill-gold text-gold')} />
          </IconButton>
          {(job.applyUrl || job.url) && (
            <IconButton label="Open original posting" onClick={() => window.open(job.applyUrl || job.url, '_blank', 'noopener')}>
              <ExternalLink className="size-4" />
            </IconButton>
          )}
          <Menu>
            <MenuTrigger asChild>
              <button aria-label="More actions" className="inline-flex size-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-ink/[0.06] hover:text-ink">
                <MoreHorizontal className="size-4" />
              </button>
            </MenuTrigger>
            <MenuContent>
              <MenuItem icon={<RefreshCw />} onSelect={() => (jobActions.analyze(job.id, true), setTab('fit'))} disabled={working}>
                Re-run fit analysis
              </MenuItem>
              {job.packet && (
                <MenuItem icon={<Sparkles />} onSelect={() => (jobActions.prepare(job.id), setTab('application'))} disabled={working}>
                  Regenerate application
                </MenuItem>
              )}
              <MenuItem
                icon={<Link2 />}
                onSelect={async () => {
                  if (await copyText(job.applyUrl || job.url)) toast.success('Link copied');
                }}
              >
                Copy posting link
              </MenuItem>
              <MenuSeparator />
              {job.status !== 'archived' ? (
                <MenuItem icon={<Archive />} onSelect={() => (jobActions.archive(job.id), closeJob())}>
                  Archive
                </MenuItem>
              ) : (
                <MenuItem icon={<RotateCcw />} onSelect={() => moveJob(job.id, job.archivedFrom && job.archivedFrom !== 'preparing' ? job.archivedFrom : 'discovered')}>
                  Restore to board
                </MenuItem>
              )}
              <MenuItem
                icon={<Trash2 />}
                danger
                onSelect={() => {
                  if (confirm(`Delete “${job.title}” at ${job.company} permanently? It won't be suggested again.`)) {
                    jobActions.remove(job.id);
                    closeJob();
                  }
                }}
              >
                Delete permanently
              </MenuItem>
            </MenuContent>
          </Menu>
          <div className="mx-1 h-5 w-px bg-line" />
          <IconButton label="Close (Esc)" onClick={closeJob}>
            <X className="size-4" />
          </IconButton>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <header className="px-7 pt-6 pb-5">
          <div className="flex items-start gap-4">
            <CompanyLogo company={job.company} logo={job.companyLogo} domain={job.companyDomain} size={52} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted">
                <span className="font-semibold text-ink-2">{job.company}</span>
                <span className="text-faint">·</span>
                <span className="inline-flex items-center gap-1">
                  <MapPin className="size-3.5 text-faint" />
                  {job.location}
                </span>
              </div>
              <h2 className="mt-1 font-display text-[24px] leading-[1.08] tracking-[-0.015em] text-ink">{job.title}</h2>
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                {remote && <Badge tone="accent">{remote}</Badge>}
                {job.salary && <Badge tone="ok">{job.salary}</Badge>}
                {job.employmentType && <Badge>{job.employmentType}</Badge>}
                {job.seniority && <Badge>{job.seniority}</Badge>}
                <Badge className="bg-transparent px-0 text-faint dark:bg-transparent">
                  via {SOURCE_LABEL[job.source]}
                  {job.postedAt ? ` · posted ${timeAgo(job.postedAt, false)}` : ''}
                </Badge>
              </div>
            </div>
            <Tooltip content={score == null ? 'Hermes is scoring this job' : 'Fit score from Hermes'}>
              <div className="flex flex-col items-center gap-1">
                <ScoreRing score={score} size={58} stroke={4.5} />
                <span className="text-[10.5px] font-semibold tracking-wider text-faint uppercase">Fit</span>
              </div>
            </Tooltip>
          </div>
          <Pipeline job={job} />
          {job.mail && job.mail.length > 0 && <Replies job={job} />}
        </header>

        <Tabs.Root value={tab} onValueChange={v => setTab(v as Tab)}>
          <Tabs.List className="sticky top-0 z-10 flex gap-1 border-b border-line bg-bg/90 px-6 backdrop-blur">
            {(
              [
                ['fit', 'Fit & odds'],
                ['application', 'Application'],
                ['posting', 'Job posting'],
                ['timeline', 'Notes & history'],
              ] as [Tab, string][]
            ).map(([v, label]) => (
              <Tabs.Trigger key={v} value={v} className="relative flex h-11 items-center gap-1.5 px-2.5 text-[13px] font-medium text-muted transition-colors outline-none hover:text-ink data-[state=active]:text-ink">
                {label}
                {v === 'application' && pending > 0 && <span className="grid h-[18px] min-w-[18px] place-items-center rounded-full bg-warn px-1 text-[10.5px] font-bold text-white">{pending}</span>}
                {v === 'application' && job.work.tailor?.state === 'running' && <Sparkles className="size-3.5 animate-pulse-soft text-gold" />}
                {v === 'fit' && job.work.analyze?.state === 'running' && <Sparkles className="size-3.5 animate-pulse-soft text-gold" />}
                {tab === v && <motion.span layoutId="drawer-tab" className="absolute right-1.5 -bottom-px left-1.5 h-[2px] rounded-full bg-ink" transition={{ type: 'spring', bounce: 0.15, duration: 0.35 }} />}
              </Tabs.Trigger>
            ))}
          </Tabs.List>
          <div className="px-7 py-6">
            <Tabs.Content value="fit" className="outline-none">
              <FitPanel job={job} />
            </Tabs.Content>
            <Tabs.Content value="application" className="outline-none">
              <ApplicationPanel job={job} />
            </Tabs.Content>
            <Tabs.Content value="posting" className="outline-none">
              <PostingPanel job={job} />
            </Tabs.Content>
            <Tabs.Content value="timeline" className="outline-none">
              <TimelinePanel job={job} />
            </Tabs.Content>
          </div>
        </Tabs.Root>
      </div>

      <Footer job={job} onApply={() => setKitOpen(true)} goApplication={() => setTab('application')} />
      <ApplyKit job={job} open={kitOpen} onOpenChange={setKitOpen} />
    </>
  );
}

const PIPE: JobStatus[] = ['discovered', 'preparing', 'needs_input', 'applied', 'interviewing', 'offer'];

function Pipeline({ job }: { job: Job }) {
  const idx = PIPE.indexOf(job.status);
  if (job.status === 'archived') {
    return (
      <div className="mt-5 flex items-center gap-2 rounded-xl bg-ink/[0.04] px-3 py-2.5 text-[12.5px] text-muted dark:bg-white/[0.05]">
        <Archive className="size-4" />
        {job.archivedReason === 'rejected' ? 'Closed — not selected this time.' : job.archivedReason === 'withdrawn' ? 'You withdrew this application.' : 'Archived.'}
        <button onClick={() => moveJob(job.id, job.archivedFrom && job.archivedFrom !== 'preparing' ? job.archivedFrom : 'discovered')} className="ml-auto font-medium text-ink-2 hover:text-ink">
          Restore
        </button>
      </div>
    );
  }
  return (
    <div className="mt-5 flex items-center gap-1">
      {PIPE.map((s, i) => {
        const meta = STATUS_META[s];
        const done = i < idx;
        const current = i === idx;
        return (
          <React.Fragment key={s}>
            <div className={cn('flex min-w-0 items-center gap-1.5 text-[11.5px] font-medium', current ? 'text-ink' : done ? 'text-muted' : 'text-faint')}>
              <span className={cn('grid size-4 shrink-0 place-items-center rounded-full', current ? 'ring-[3px]' : '')} style={{ background: done || current ? meta.color : 'var(--line)', ['--tw-ring-color' as any]: `color-mix(in oklab, ${meta.color} 25%, transparent)` }}>
                {done && <Check className="size-2.5 text-white" strokeWidth={3.5} />}
              </span>
              <span className="truncate max-lg:hidden">{s === 'preparing' ? 'Hermes' : meta.label}</span>
            </div>
            {i < PIPE.length - 1 && <div className={cn('h-px min-w-3 flex-1', i < idx ? 'bg-ink/25' : 'bg-line')} />}
          </React.Fragment>
        );
      })}
    </div>
  );
}

const REPLY_LABEL: Record<string, string> = { rejection: 'Rejection', interview: 'Interview invite', next_step: 'Next step', offer: 'Offer', received: 'Received', other: 'Email' };

/** Replies to this application that Talaria found in your Gmail. */
function Replies({ job }: { job: Job }) {
  const mail = [...(job.mail || [])].reverse().slice(0, 4);
  return (
    <div className="mt-4 overflow-hidden rounded-xl border border-line-2">
      <div className="flex items-center gap-1.5 border-b border-line-2 bg-panel px-3 py-2 text-[11.5px] font-semibold tracking-[0.06em] text-muted uppercase">
        <Mail className="size-3.5" /> From your inbox
      </div>
      {mail.map(m => (
        <div key={m.id} className="flex gap-3 border-b border-line-2 px-3 py-2.5 last:border-0">
          <Badge tone={m.kind === 'rejection' ? 'bad' : m.kind === 'interview' || m.kind === 'offer' || m.kind === 'next_step' ? 'ok' : 'neutral'} className="mt-0.5 shrink-0">
            {REPLY_LABEL[m.kind]}
          </Badge>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] text-ink">{m.summary}</div>
            <div className="mt-0.5 truncate text-[11.5px] text-faint">
              {fmtDate(m.at)} · {m.subject}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function StatusMenu({ job }: { job: Job }) {
  const meta = STATUS_META[job.status];
  const targets: { s: JobStatus; label: string }[] = [
    { s: 'discovered', label: 'Discovered' },
    { s: 'applied', label: 'Applied' },
    { s: 'interviewing', label: 'Interviewing' },
    { s: 'offer', label: 'Offer' },
  ];
  return (
    <Menu>
      <MenuTrigger asChild>
        <button className="flex h-8 items-center gap-2 rounded-lg px-2.5 text-[12.5px] font-semibold text-ink-2 transition-colors hover:bg-ink/[0.05]">
          <span className="size-2 rounded-full" style={{ background: meta.color }} />
          {meta.label}
          {job.status === 'archived' && job.archivedReason ? <span className="font-normal text-muted">· {job.archivedReason}</span> : null}
        </button>
      </MenuTrigger>
      <MenuContent align="start">
        {targets
          .filter(t => t.s !== job.status)
          .map(t => (
            <MenuItem key={t.s} icon={<span className="block size-2 rounded-full" style={{ background: STATUS_META[t.s].color }} />} onSelect={() => moveJob(job.id, t.s)}>
              Move to {t.label}
            </MenuItem>
          ))}
        <MenuSeparator />
        <MenuItem icon={<XCircle />} onSelect={() => jobActions.archive(job.id, 'rejected')}>
          Not selected (rejected)
        </MenuItem>
        <MenuItem icon={<Archive />} onSelect={() => jobActions.archive(job.id, job.appliedAt ? 'withdrawn' : 'dismissed')}>
          {job.appliedAt ? 'Withdraw' : 'Dismiss'}
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

function Footer({ job, onApply, goApplication }: { job: Job; onApply: () => void; goApplication: () => void }) {
  const pending = pendingQuestions(job);
  const tailoring = job.work.tailor?.state === 'running' || job.work.tailor?.state === 'queued';
  const submitting = job.work.submit?.state === "running" || job.work.submit?.state === "queued";
  const autoSubmit = useApp(s => s.settings?.apply?.autoSubmit ?? false);
  const auto = autoSubmit && canAutoApply(job);
  let left: React.ReactNode = null;
  let right: React.ReactNode = null;

  switch (job.status) {
    case 'discovered':
      left = (
        <Button variant="ghost" icon={<X className="size-4" />} onClick={() => (jobActions.archive(job.id), closeJob())}>
          Not for me
        </Button>
      );
      right = (
        <Button variant="primary" size="lg" icon={<Sparkles className="size-4 text-gold" />} loading={tailoring} onClick={() => (jobActions.prepare(job.id), navigate({ tab: 'workspace' }))}>
          Prepare application
        </Button>
      );
      break;
    case 'preparing':
    case 'needs_input':
      left = (
        <span className="text-[13px] text-muted">
          {submitting
            ? `${job.work.submit?.step || 'Applying'}… watch it in the Talaria browser window.`
            : tailoring
              ? 'Hermes is working on the draft.'
              : pending > 0
                ? `Hermes has ${pending} question${pending > 1 ? 's' : ''} for you.`
                : job.packet
                  ? auto
                    ? 'Review it with Hermes, then finalize and Talaria submits it.'
                    : 'Review it with Hermes, then finalize to get the Apply kit.'
                  : 'Hermes is getting started.'}
        </span>
      );
      right = (
        <Button variant="primary" size="lg" icon={<MessagesSquare className="size-4" />} onClick={() => navigate({ tab: 'workspace' })}>
          Open workspace
        </Button>
      );
      break;
    case 'applied':
      left = (
        <Button variant="ghost" icon={<XCircle className="size-4" />} onClick={() => jobActions.archive(job.id, 'rejected')}>
          Got rejected
        </Button>
      );
      right = (
        <Button variant="primary" size="lg" onClick={() => moveJob(job.id, 'interviewing')} icon={<ArrowRight className="size-4" />}>
          They want to interview
        </Button>
      );
      break;
    case 'interviewing':
      left = (
        <Button variant="ghost" icon={<XCircle className="size-4" />} onClick={() => jobActions.archive(job.id, 'rejected')}>
          Didn't move forward
        </Button>
      );
      right = (
        <Button variant="primary" size="lg" onClick={() => moveJob(job.id, 'offer')} icon={<Sparkles className="size-4 text-gold" />}>
          Got an offer
        </Button>
      );
      break;
    case 'offer':
      left = <span className="font-display text-[15px] text-ink">Congratulations. 🎉</span>;
      right = (
        <Button variant="secondary" onClick={() => navigate({ view: 'summary' })}>
          See your journey
        </Button>
      );
      break;
    case 'archived':
      right = (
        <Button variant="secondary" icon={<RotateCcw className="size-4" />} onClick={() => moveJob(job.id, job.archivedFrom && job.archivedFrom !== 'preparing' ? job.archivedFrom : 'discovered')}>
          Restore
        </Button>
      );
      break;
  }

  return (
    <div className="flex items-center justify-between gap-3 border-t border-line bg-panel px-6 py-3.5">
      <div className="min-w-0">{left}</div>
      <div className="flex shrink-0 items-center gap-2">{right}</div>
    </div>
  );
}
