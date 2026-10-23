import * as React from 'react';
import { Bot, Flag, StickyNote, User } from 'lucide-react';
import type { Job } from '@shared/types';
import { jobActions } from '@/lib/store';
import { cn, timeAgo } from '@/lib/utils';
import { SectionTitle, Textarea } from '../ui';

export function TimelinePanel({ job }: { job: Job }) {
  const [notes, setNotes] = React.useState(job.notes);
  const [saved, setSaved] = React.useState(true);
  React.useEffect(() => {
    if (notes === job.notes) return;
    setSaved(false);
    const t = setTimeout(() => jobActions.patch(job.id, { notes }).then(() => setSaved(true)), 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes]);

  const events = [...job.timeline].reverse();
  const icon = (k?: string) => (k === 'agent' ? Bot : k === 'user' ? User : k === 'status' ? Flag : StickyNote);

  return (
    <div className="space-y-7">
      <section>
        <SectionTitle action={<span className="text-[11.5px] text-faint">{saved ? 'Saved' : 'Saving…'}</span>}>Your notes</SectionTitle>
        <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Recruiter name, referral, interview prep, salary talk…" className="min-h-[120px] bg-card" />
      </section>
      <section>
        <SectionTitle>History</SectionTitle>
        <ol className="relative space-y-0.5 before:absolute before:top-3 before:bottom-3 before:left-[13px] before:w-px before:bg-line">
          {events.map((e, i) => {
            const Icon = icon(e.kind);
            return (
              <li key={i} className="relative flex items-start gap-3 py-2">
                <span className={cn('relative grid size-[27px] shrink-0 place-items-center rounded-full border-[3px] border-bg', e.kind === 'agent' ? 'bg-gold-soft text-gold' : e.kind === 'user' ? 'bg-accent-soft text-accent' : 'bg-line-2 text-muted')}>
                  <Icon className="size-3" />
                </span>
                <div className="min-w-0 flex-1 pt-1">
                  <div className="text-[13px] text-ink-2">{e.text}</div>
                  <div className="text-[11.5px] text-faint" title={new Date(e.at).toLocaleString()}>
                    {timeAgo(e.at, false)}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}
