import * as React from 'react';
import { Archive, ArrowRight, CalendarCheck, Check, ExternalLink, FileText, Link2, MessagesSquare, PanelRight, Pause, Play, RefreshCw, Send, Sparkles, SquarePen, SquareX, Star, Trash2, Trophy, Undo2, Unlink } from 'lucide-react';
import { toast } from 'sonner';
import { BOARD_COLUMNS, type Job, type JobStatus } from '@shared/types';
import { isStaleDraft, resumeHash } from '@shared/resume';
import { jobActions, moveJob, useApp } from '@/lib/store';
import { openJob } from '@/lib/router';
import { api } from '@/lib/api';
import { copyText, isWorking, pendingQuestions, STATUS_META } from '@/lib/utils';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuLabel, ContextMenuSeparator, ContextMenuSub, ContextMenuTrigger } from './ui';
import { aiName } from '@/lib/ai';

const AFTER_APPLYING: JobStatus[] = ['applied', 'interviewing', 'offer'];

/** Right-click menu for a board card. Each column gets its own commands; the shared ones (open, star, link, move, close out) sit below. */
export function CardContextMenu({ job, children }: { job: Job; children: React.ReactElement }) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <CardMenuItems job={job} />
      </ContextMenuContent>
    </ContextMenu>
  );
}

function CardMenuItems({ job }: { job: Job }) {
  const profile = useApp(s => s.profile);
  const working = isWorking(job);
  const pending = pendingQuestions(job);
  const link = job.applyUrl || job.url;
  const afterApplying = AFTER_APPLYING.includes(job.status);
  const stale = job.status === 'needs_input' && !working && !job.paused && isStaleDraft(job, profile, resumeHash(profile));

  return (
    <>
      <ContextMenuLabel>
        {job.company} · {job.title}
      </ContextMenuLabel>

      <ColumnCommands job={job} working={working} pending={pending} stale={stale} />

      {working && (
        <ContextMenuItem icon={<Pause />} onSelect={() => jobActions.pause(job.id)}>
          Pause {aiName()}
        </ContextMenuItem>
      )}
      {job.paused && !working && (
        <ContextMenuItem icon={<Play />} onSelect={() => jobActions.resume(job.id)}>
          Resume {aiName()}
        </ContextMenuItem>
      )}

      <ContextMenuSeparator />
      <ContextMenuItem icon={<PanelRight />} hint="Enter" onSelect={() => openJob(job.id)}>
        Open details
      </ContextMenuItem>
      <ContextMenuItem icon={<Star className={job.starred ? 'fill-gold text-gold' : ''} />} onSelect={() => jobActions.patch(job.id, { starred: !job.starred })}>
        {job.starred ? 'Unstar' : 'Star'}
      </ContextMenuItem>
      {link && (
        <>
          <ContextMenuItem icon={<ExternalLink />} onSelect={() => window.open(link, '_blank', 'noopener')}>
            Open original posting
          </ContextMenuItem>
          <ContextMenuItem icon={<Link2 />} onSelect={async () => (await copyText(link)) && toast.success('Link copied')}>
            Copy posting link
          </ContextMenuItem>
        </>
      )}
      <ContextMenuSub label="Move to" icon={<ArrowRight />}>
        {BOARD_COLUMNS.filter(s => s !== job.status).map(s => (
          <ContextMenuItem key={s} icon={<span className="block size-2 " style={{ background: STATUS_META[s].color }} />} onSelect={() => moveTo(job, s)}>
            {STATUS_META[s].label}
          </ContextMenuItem>
        ))}
      </ContextMenuSub>

      <ContextMenuSeparator />
      {job.liveCheck?.live === false && (
        <ContextMenuItem icon={<Unlink />} onSelect={() => closeOut(job, 'expired')}>
          Archive as posting closed
        </ContextMenuItem>
      )}
      {afterApplying ? (
        <>
          <ContextMenuItem icon={<SquareX />} onSelect={() => closeOut(job, 'rejected')}>
            Not selected
          </ContextMenuItem>
          <ContextMenuItem icon={<Undo2 />} onSelect={() => closeOut(job, 'withdrawn')}>
            {job.status === 'offer' ? 'Decline offer' : 'Withdraw application'}
          </ContextMenuItem>
        </>
      ) : (
        <ContextMenuItem icon={<Archive />} onSelect={() => closeOut(job, 'dismissed')}>
          Dismiss
        </ContextMenuItem>
      )}
      <ContextMenuItem
        icon={<Trash2 />}
        danger
        onSelect={() => {
          if (confirm(`Delete “${job.title}” at ${job.company} permanently? It won't be suggested again.`)) jobActions.remove(job.id);
        }}
      >
        Delete permanently
      </ContextMenuItem>
    </>
  );
}

/** The commands that belong to the card's column: the next step you'd most likely take from there. */
function ColumnCommands({ job, working, pending, stale }: { job: Job; working: boolean; pending: number; stale: boolean }) {
  const tailorErr = job.work.tailor?.state === 'error';
  switch (job.status) {
    case 'discovered':
      return (
        <>
          <ContextMenuItem icon={<Sparkles className="text-gold" />} disabled={working} onSelect={() => prepare(job)}>
            Prepare application
          </ContextMenuItem>
          <ContextMenuItem icon={<RefreshCw />} disabled={working} onSelect={() => (jobActions.analyze(job.id, true), openJob(job.id, 'fit'))}>
            Re-run fit analysis
          </ContextMenuItem>
        </>
      );

    case 'preparing':
      return (
        <>
          <ContextMenuItem icon={<MessagesSquare />} onSelect={() => openJob(job.id, 'workspace')}>
            Open workspace
          </ContextMenuItem>
          {tailorErr && !working && (
            <ContextMenuItem icon={<RefreshCw />} onSelect={() => jobActions.prepare(job.id)}>
              Retry drafting
            </ContextMenuItem>
          )}
        </>
      );

    case 'needs_input': {
      const approved = Boolean(job.packet?.approvedAt);
      return (
        <>
          {pending > 0 ? (
            <ContextMenuItem icon={<SquarePen className="text-warn" />} onSelect={() => openJob(job.id, 'workspace')}>
              Answer {pending} question{pending === 1 ? '' : 's'}
            </ContextMenuItem>
          ) : (
            <ContextMenuItem icon={<FileText />} onSelect={() => openJob(job.id, 'application')}>
              Review draft
            </ContextMenuItem>
          )}
          {job.packet && !approved && pending === 0 && !working && (
            <ContextMenuItem icon={<Check className="text-ok" />} onSelect={() => jobActions.approve(job.id).then(() => toast.success(`Approved ${job.company}`))}>
              Approve draft
            </ContextMenuItem>
          )}
          <ContextMenuItem icon={<Send />} onSelect={() => markApplied(job)}>
            I applied myself
          </ContextMenuItem>
          {stale && (
            <ContextMenuItem icon={<RefreshCw className="text-gold" />} onSelect={() => api.post('/api/jobs/refresh-stale', { ids: [job.id] })}>
              Refresh with new resume
            </ContextMenuItem>
          )}
          {job.packet && (
            <ContextMenuItem icon={<Sparkles />} disabled={working} onSelect={() => prepare(job)}>
              Regenerate application
            </ContextMenuItem>
          )}
          {tailorErr && !working && (
            <ContextMenuItem icon={<RefreshCw />} onSelect={() => jobActions.prepare(job.id)}>
              Retry drafting
            </ContextMenuItem>
          )}
        </>
      );
    }

    case 'applied':
      return (
        <>
          <ContextMenuItem icon={<CalendarCheck />} onSelect={() => moveTo(job, 'interviewing')}>
            Got an interview
          </ContextMenuItem>
          <ContextMenuItem icon={<Trophy className="text-gold" />} onSelect={() => moveTo(job, 'offer')}>
            Got an offer
          </ContextMenuItem>
        </>
      );

    case 'interviewing':
      return (
        <ContextMenuItem icon={<Trophy className="text-gold" />} onSelect={() => moveTo(job, 'offer')}>
          Got an offer
        </ContextMenuItem>
      );

    case 'offer':
      return (
        <ContextMenuItem icon={<Undo2 />} onSelect={() => moveTo(job, 'interviewing')}>
          Back to interviewing
        </ContextMenuItem>
      );

    default:
      return null;
  }
}

function aiToast(job: Job) {
  toast(job.packet ? `${aiName()} is rewriting ${job.company} from scratch` : `${aiName()} is preparing ${job.company}`, {
    description: job.packet ? 'The current draft stays under Versions.' : undefined,
    icon: <Sparkles className="size-4 text-gold" />,
  });
}

function prepare(job: Job) {
  aiToast(job);
  jobActions.prepare(job.id);
}

function moveTo(job: Job, status: JobStatus) {
  // Moving into these columns starts the AI drafting, same as dragging there.
  if (status === 'preparing' || (status === 'needs_input' && !job.packet)) aiToast(job);
  moveJob(job.id, status);
}

function markApplied(job: Job) {
  jobActions.applied(job.id, 'manual').then(() => toast.success(`Marked ${job.company} as applied`));
}

function closeOut(job: Job, reason: 'dismissed' | 'rejected' | 'withdrawn' | 'expired') {
  const from = job.status;
  jobActions.archive(job.id, reason);
  const text = { dismissed: `Dismissed ${job.title}`, rejected: `Closed ${job.company} as not selected`, withdrawn: `Withdrew from ${job.company}`, expired: `Archived ${job.company} as closed` }[reason];
  toast(text, { action: { label: 'Undo', onClick: () => moveJob(job.id, from) } });
}
