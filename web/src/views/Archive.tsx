import * as React from 'react';
import { Archive, Search } from 'lucide-react';
import type { ArchiveReason } from '@shared/types';
import { useApp } from '@/lib/store';
import { openJob } from '@/lib/router';
import { ARCHIVE_REASON, JobCard } from '@/components/JobCard';
import { EmptyState, Segmented } from '@/components/ui';

type Filter = 'all' | ArchiveReason;

export function ArchiveView() {
  const jobsMap = useApp(s => s.jobs);
  const [filter, setFilter] = React.useState<Filter>('all');
  const [query, setQuery] = React.useState('');

  const archived = React.useMemo(
    () => Object.values(jobsMap).filter(j => j.status === 'archived').sort((a, b) => Date.parse(b.statusChangedAt) - Date.parse(a.statusChangedAt)),
    [jobsMap],
  );
  const counts = React.useMemo(() => {
    const c: Partial<Record<ArchiveReason, number>> = {};
    for (const j of archived) c[j.archivedReason || 'dismissed'] = (c[j.archivedReason || 'dismissed'] || 0) + 1;
    return c;
  }, [archived]);
  const q = query.trim().toLowerCase();
  const shown = archived.filter(j => (filter === 'all' || (j.archivedReason || 'dismissed') === filter) && (!q || `${j.title} ${j.company} ${j.location}`.toLowerCase().includes(q)));

  const options: { value: Filter; label: React.ReactNode }[] = [
    { value: 'all', label: <>All <span className="text-faint tabular-nums">{archived.length}</span></> },
    ...(Object.keys(ARCHIVE_REASON) as ArchiveReason[])
      .filter(r => counts[r])
      .map(r => ({ value: r, label: <>{ARCHIVE_REASON[r]} <span className="text-faint tabular-nums">{counts[r]}</span></> })),
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-end justify-between gap-4 px-7 pt-6 pb-5">
        <div>
          <h1 className="font-display text-[27px] leading-none tracking-[-0.015em] text-ink">Archive</h1>
          <p className="mt-2 text-[13.5px] text-muted">Jobs you dismissed, closed postings and finished applications. Restore any of them to the board.</p>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-faint" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Filter archive"
            className="h-9 w-[200px] rounded-lg border border-line bg-card pr-3 pl-8 text-[13px] text-ink outline-none placeholder:text-faint focus:border-accent/50 focus:ring-[3px] focus:ring-accent/15"
          />
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-7 pb-12">
        {archived.length === 0 ? (
          <EmptyState icon={<Archive className="size-5" />} title="Nothing archived yet">
            Drag a card onto the archive bar on the board, or dismiss a match, and it lands here.
          </EmptyState>
        ) : (
          <>
            {options.length > 2 && <Segmented size="sm" value={filter} onChange={setFilter} options={options} className="mb-4 flex-wrap" />}
            {shown.length === 0 ? (
              <p className="py-10 text-center text-[13px] text-faint">Nothing matches.</p>
            ) : (
              <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(270px,1fr))]">
                {shown.map(job => (
                  <div
                    key={job.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => openJob(job.id)}
                    onKeyDown={e => e.key === 'Enter' && openJob(job.id)}
                    className="cursor-pointer rounded-[14px] outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                  >
                    <JobCard job={job} />
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
