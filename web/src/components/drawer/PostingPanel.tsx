import { ArrowUpRight, Briefcase, CalendarDays, Globe2, MapPin, Wallet } from 'lucide-react';
import type { Job } from '@shared/types';
import { fmtDate, SOURCE_LABEL } from '@/lib/utils';
import { remoteLabel } from '../JobCard';

export function PostingPanel({ job }: { job: Job }) {
  const facts = [
    { icon: MapPin, label: 'Location', value: job.location },
    { icon: Globe2, label: 'Work mode', value: remoteLabel(job) || 'Not stated' },
    { icon: Wallet, label: 'Salary', value: job.salary || 'Not listed' },
    { icon: Briefcase, label: 'Type', value: job.employmentType || 'Not stated' },
    { icon: CalendarDays, label: 'Posted', value: job.postedAt ? fmtDate(job.postedAt, true) : 'Unknown' },
  ];
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-line-2 shadow-card sm:grid-cols-3">
        {facts.map(f => (
          <div key={f.label} className="bg-card px-4 py-3">
            <div className="flex items-center gap-1.5 text-[11.5px] font-medium text-faint">
              <f.icon className="size-3.5" />
              {f.label}
            </div>
            <div className="mt-1 truncate text-[13.5px] font-medium text-ink" title={f.value}>
              {f.value}
            </div>
          </div>
        ))}
        <a href={job.applyUrl || job.url} target="_blank" rel="noopener noreferrer" className="group bg-card px-4 py-3 transition-colors hover:bg-panel">
          <div className="text-[11.5px] font-medium text-faint">Source</div>
          <div className="mt-1 flex items-center gap-1 text-[13.5px] font-medium text-accent">
            {SOURCE_LABEL[job.source]}
            <ArrowUpRight className="size-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </div>
        </a>
      </div>

      {job.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {job.tags.map(t => (
            <span key={t} className="rounded-md bg-ink/[0.05] px-2 py-0.5 text-[12px] text-muted dark:bg-white/[0.06]">
              {t}
            </span>
          ))}
        </div>
      )}

      {job.descriptionHtml ? (
        <article className="prose-job" dangerouslySetInnerHTML={{ __html: job.descriptionHtml }} />
      ) : (
        <p className="text-[13.5px] text-muted">No description came with this posting. Open the original for details.</p>
      )}
    </div>
  );
}
