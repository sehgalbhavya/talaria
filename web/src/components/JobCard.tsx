import * as React from 'react';
import { AlertTriangle, ArrowRight, Check, CircleHelp, Clock, Mail, MapPin, Pause, Play, Sparkles, Star, Unlink, X } from 'lucide-react';
import type { ArchiveReason, Job } from '@shared/types';
import { isStaleDraft, resumeHash } from '@shared/resume';
import { awaitingInterview, cn, fitScore, fmtDate, isWorking, pendingQuestions, SOURCE_LABEL, timeAgo, workingStep } from '@/lib/utils';
import { CompanyLogo, ScoreRing } from './brand';
import { jobActions, moveJob, useApp } from '@/lib/store';
import { Tooltip } from './ui';

export const ARCHIVE_REASON: Record<ArchiveReason, string> = {
  dismissed: 'Dismissed',
  rejected: 'Not selected',
  withdrawn: 'Withdrawn',
  expired: 'Posting closed',
  duplicate: 'Duplicate',
};

export function remoteLabel(j: Pick<Job, 'remote'>) {
  return j.remote === 'remote' ? 'Remote' : j.remote === 'hybrid' ? 'Hybrid' : j.remote === 'onsite' ? 'On-site' : null;
}

export function shortLocation(loc: string) {
  const parts = loc.split(/\s*[·|;]\s*/);
  const first = parts[0].length > 34 ? parts[0].slice(0, 32) + '…' : parts[0];
  return parts.length > 1 ? `${first} +${parts.length - 1}` : first;
}

export const JobCard = React.memo(function JobCard({ job, overlay, dragging }: { job: Job; overlay?: boolean; dragging?: boolean }) {
  const score = fitScore(job);
  const working = isWorking(job);
  const step = workingStep(job);
  const pending = pendingQuestions(job);
  const tailorErr = job.work.tailor?.state === 'error' ? job.work.tailor.error || 'Unknown error' : null;
  const remote = remoteLabel(job);
  const rejected = job.outcome?.kind === 'rejection' && job.status !== 'archived';
  const closed = job.liveCheck?.live === false && job.status !== 'archived';
  const profile = useApp(s => s.profile);
  const hash = React.useMemo(() => resumeHash(profile), [profile]);
  const stale = job.status === 'needs_input' && !working && isStaleDraft(job, profile, hash);

  return (
    <div
      className={cn(
        'group relative rounded-[14px] bg-card p-3.5 shadow-card transition-[box-shadow,transform,opacity] duration-200',
        !overlay && !dragging && 'hover:shadow-lift',
        overlay && 'rotate-[1.5deg] cursor-grabbing shadow-pop',
        dragging && 'opacity-35',
        job.status === 'needs_input' && pending > 0 && 'ring-1 ring-warn/35',
        (rejected || closed) && 'bg-bad-soft ring-1 ring-bad/35 dark:bg-bad-soft',
      )}
    >
      <div className="flex items-start gap-2.5">
        <CompanyLogo company={job.company} logo={job.companyLogo} domain={job.companyDomain} size={30} className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[12px] text-muted">
            <span className="truncate font-medium text-ink-2">{job.company}</span>
            {job.starred && <Star className="size-3 shrink-0 fill-gold text-gold" />}
          </div>
          <div className="mt-0.5 line-clamp-2 text-[14px] leading-[1.3] font-semibold tracking-[-0.005em] text-ink">{job.title}</div>
        </div>
        <ScoreRing score={score} size={34} stroke={3} className="-mt-0.5 -mr-0.5" />
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] text-muted">
        <span className="inline-flex min-w-0 items-center gap-1">
          <MapPin className="size-3 shrink-0 text-faint" />
          <span className="truncate">{shortLocation(job.location)}</span>
        </span>
        {remote && job.location.toLowerCase().indexOf(remote.toLowerCase()) === -1 && <span className="font-medium text-ink-2">{remote}</span>}
        {job.salary && <span className="font-medium text-ink-2 tabular-nums">{job.salary}</span>}
        {stale && <span title="Tailored from your previous resume" className="rounded-full bg-gold-soft px-1.5 py-px text-[11px] font-medium text-gold">Old resume</span>}
      </div>

      {job.status === 'discovered' && (job.analysis?.summary || job.quick?.reason) && !working && (
        <p className="mt-2 line-clamp-2 text-[12.5px] leading-snug text-muted">{job.quick?.reason || job.analysis?.summary}</p>
      )}

      <CardFooter job={job} working={working} step={step} pending={pending} tailorErr={tailorErr} />
    </div>
  );
});

function CardFooter({ job, working, step, pending, tailorErr }: { job: Job; working: boolean; step: string | null; pending: number; tailorErr: string | null }) {
  const pausedUntil = useApp(s => s.hermes.rateLimitedUntil);
  const pausedAt = pausedUntil && Date.parse(pausedUntil) > Date.now() ? new Date(pausedUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;
  if (working && step) {
    if (pausedAt)
      return (
        <div className="-mx-3.5 mt-3 -mb-3.5 flex items-center gap-2 rounded-b-[14px] border-t border-line bg-ink/[0.03] px-3.5 py-2 text-[12px] font-medium text-muted dark:bg-white/[0.04]">
          <Clock className="size-3.5" />
          <span className="flex-1 truncate">Paused by Copilot · resumes {pausedAt}</span>
          <PauseButton id={job.id} />
        </div>
      );
    return (
      <div className="agent-sheen -mx-3.5 mt-3 -mb-3.5 flex items-center gap-2 rounded-b-[14px] border-t border-gold/15 bg-gold-soft/60 px-3.5 py-2 text-[12px] font-medium text-gold">
        <Sparkles className="size-3.5 animate-pulse-soft" />
        <span className="flex-1 truncate">{step}…</span>
        <PauseButton id={job.id} />
      </div>
    );
  }
  if (job.liveCheck?.live === false && job.status !== 'archived') {
    return (
      <div className="-mx-3.5 mt-3 -mb-3.5 rounded-b-[14px] border-t border-bad/20 bg-bad/10 px-3.5 py-2.5">
        <div className="flex items-center gap-1.5 text-[12px] font-semibold text-bad">
          <Unlink className="size-3.5" />
          <span className="flex-1">Posting closed</span>
          <button
            onPointerDown={e => e.stopPropagation()}
            onClick={e => {
              e.stopPropagation();
              jobActions.archive(job.id, 'expired');
            }}
            className="rounded-md px-1.5 py-0.5 font-medium hover:bg-bad/10"
          >
            Archive
          </button>
        </div>
        <p className="mt-1 line-clamp-2 text-[11.5px] leading-snug text-bad/85">
          {job.liveCheck.reason} · checked {timeAgo(job.liveCheck.at)}
        </p>
      </div>
    );
  }
  if (job.paused && job.status !== 'archived') {
    return (
      <div className="-mx-3.5 mt-3 -mb-3.5 flex items-center gap-2 rounded-b-[14px] border-t border-line bg-ink/[0.03] px-3.5 py-2 text-[12px] font-medium text-muted dark:bg-white/[0.04]">
        <Pause className="size-3.5" />
        <span className="flex-1 truncate">Paused{job.packet ? ' · draft kept' : ''}</span>
        <button
          onPointerDown={e => e.stopPropagation()}
          onClick={e => {
            e.stopPropagation();
            jobActions.resume(job.id);
          }}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-semibold text-ink-2 hover:bg-ink/5 hover:text-ink"
        >
          <Play className="size-3" /> Resume
        </button>
      </div>
    );
  }
  if (tailorErr && (job.status === 'preparing' || job.status === 'needs_input')) {
    return (
      <div className="-mx-3.5 mt-3 -mb-3.5 flex items-center gap-2 rounded-b-[14px] border-t border-bad/15 bg-bad-soft/60 px-3.5 py-2 text-[12px] font-medium text-bad">
        <AlertTriangle className="size-3.5" />
        <span className="flex-1 truncate">Hermes hit a snag</span>
        <button
          onPointerDown={e => e.stopPropagation()}
          onClick={e => {
            e.stopPropagation();
            jobActions.prepare(job.id);
          }}
          className="rounded-md px-1.5 py-0.5 underline-offset-2 hover:underline"
        >
          Retry
        </button>
      </div>
    );
  }
  if (job.status === 'needs_input') {
    if (pending > 0)
      return (
        <div className="-mx-3.5 mt-3 -mb-3.5 flex items-center gap-2 rounded-b-[14px] border-t border-warn/15 bg-warn-soft/70 px-3.5 py-2 text-[12px] font-semibold text-warn">
          <CircleHelp className="size-3.5" />
          <span className="flex-1">
            {pending} question{pending > 1 ? 's' : ''} {awaitingInterview(job) ? 'before drafting' : 'before submitting'}
          </span>
          <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
        </div>
      );
    const approved = Boolean(job.packet?.approvedAt);
    return (
      <div className={cn('-mx-3.5 mt-3 -mb-3.5 flex items-center gap-2 rounded-b-[14px] border-t px-3.5 py-2 text-[12px] font-semibold', approved ? 'border-ok/15 bg-ok-soft/70 text-ok' : 'border-accent/10 bg-accent-soft/70 text-accent')}>
        {approved ? <Check className="size-3.5" /> : <Sparkles className="size-3.5" />}
        <span className="flex-1">{approved ? 'Approved · ready to submit' : 'Draft ready for your review'}</span>
        <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
      </div>
    );
  }
  if ((job.status === 'applied' || job.status === 'interviewing' || job.status === 'offer') && job.outcome) {
    const o = job.outcome;
    const bad = o.kind === 'rejection';
    return (
      <div className={cn('-mx-3.5 mt-3 -mb-3.5 rounded-b-[14px] border-t px-3.5 py-2.5', bad ? 'border-bad/20 bg-bad/10' : 'border-ok/15 bg-ok-soft/70')}>
        <div className={cn('flex items-center gap-1.5 text-[12px] font-semibold', bad ? 'text-bad' : 'text-ok')}>
          {bad ? <X className="size-3.5" /> : <Mail className="size-3.5" />}
          <span className="flex-1">{bad ? "You've been rejected" : o.kind === 'offer' ? 'Offer by email' : o.kind === 'interview' ? 'Interview invitation' : 'Next step from them'}</span>
          <span className="font-normal opacity-70">{fmtDate(o.at)}</span>
        </div>
        <p className={cn('mt-1 line-clamp-2 text-[11.5px] leading-snug', bad ? 'text-bad/85' : 'text-ink-2')}>{o.summary}</p>
      </div>
    );
  }
  if (job.status === 'applied' || job.status === 'interviewing' || job.status === 'offer') {
    return (
      <div className="mt-3 flex items-center justify-between border-t border-line-2 pt-2.5 text-[11.5px] text-muted">
        <span>{job.status === 'applied' ? `Applied ${fmtDate(job.appliedAt)}` : `${job.status === 'offer' ? 'Offer' : 'Interviewing'} since ${fmtDate(job.statusChangedAt)}`}</span>
        <span>{timeAgo(job.status === 'applied' ? job.appliedAt : job.statusChangedAt)}</span>
      </div>
    );
  }
  if (job.status === 'discovered') {
    return (
      <div className="mt-3 flex h-6 items-center justify-between text-[11.5px] text-faint">
        <span className="truncate transition-opacity group-hover:opacity-0">
          {SOURCE_LABEL[job.source]}
          {job.postedAt ? ` · ${timeAgo(job.postedAt)}` : ''}
        </span>
        <div className="absolute right-3 bottom-3 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            onPointerDown={e => e.stopPropagation()}
            onClick={e => {
              e.stopPropagation();
              jobActions.archive(job.id);
            }}
            className="inline-flex h-6 items-center gap-1 rounded-md px-2 text-[11.5px] font-medium text-muted hover:bg-ink/5 hover:text-ink"
          >
            <X className="size-3" /> Dismiss
          </button>
          <button
            onPointerDown={e => e.stopPropagation()}
            onClick={e => {
              e.stopPropagation();
              jobActions.prepare(job.id);
            }}
            className="inline-flex h-6 items-center gap-1 rounded-md bg-ink px-2 text-[11.5px] font-semibold text-bg hover:bg-ink/85"
          >
            <Sparkles className="size-3 text-gold" /> Prepare
          </button>
        </div>
      </div>
    );
  }
  if (job.status === 'archived') {
    return (
      <div className="mt-3 border-t border-line-2 pt-2.5 text-[11.5px] text-muted">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate">
            {ARCHIVE_REASON[job.archivedReason || 'dismissed']} · {timeAgo(job.statusChangedAt)}
          </span>
          <button
            onPointerDown={e => e.stopPropagation()}
            onClick={e => {
              e.stopPropagation();
              moveJob(job.id, job.archivedFrom && job.archivedFrom !== 'preparing' ? job.archivedFrom : 'discovered');
            }}
            className="shrink-0 rounded-md px-1.5 py-0.5 font-medium text-ink-2 hover:bg-ink/5 hover:text-ink"
          >
            Restore
          </button>
        </div>
        {job.archivedReason === 'expired' && job.liveCheck?.reason && <p className="mt-1 line-clamp-2 leading-snug text-faint">{job.liveCheck.reason}</p>}
      </div>
    );
  }
  return null;
}

/** Shown on hover while Hermes works on the card: stops it until you resume. */
function PauseButton({ id }: { id: string }) {
  return (
    <Tooltip content="Pause Hermes on this job">
      <button
        aria-label="Pause"
        onPointerDown={e => e.stopPropagation()}
        onClick={e => {
          e.stopPropagation();
          jobActions.pause(id);
        }}
        className="-my-1 -mr-1.5 grid size-6 shrink-0 place-items-center rounded-md opacity-0 transition-opacity group-hover:opacity-100 hover:bg-ink/10 focus-visible:opacity-100"
      >
        <Pause className="size-3.5" />
      </button>
    </Tooltip>
  );
}
