import * as React from 'react';
import { motion } from 'motion/react';
import { ArrowDown, ArrowUp, Download, FileBarChart2, History, Sparkles } from 'lucide-react';
import type { Job, Report } from '@shared/types';
import { api } from '@/lib/api';
import { useApp } from '@/lib/store';
import { openJob } from '@/lib/router';
import { cn, fitScore, fmtDate, SOURCE_LABEL, STATUS_META, timeAgo } from '@/lib/utils';
import { Button, Card, EmptyState, Menu, MenuContent, MenuItem, MenuTrigger, SectionTitle, Segmented } from '@/components/ui';
import { CompanyLogo, ScoreRing } from '@/components/brand';
import { Markdown } from '@/components/Markdown';

const DAY = 86400000;

export function SummaryView() {
  const jobsMap = useApp(s => s.jobs);
  const jobs = React.useMemo(() => Object.values(jobsMap), [jobsMap]);
  const applied = React.useMemo(() => jobs.filter(j => j.appliedAt).sort((a, b) => Date.parse(b.appliedAt!) - Date.parse(a.appliedAt!)), [jobs]);

  const weekAgo = Date.now() - 7 * DAY;
  const thisWeek = applied.filter(j => Date.parse(j.appliedAt!) >= weekAgo).length;
  const responded = applied.filter(j => j.status === 'interviewing' || j.status === 'offer' || (j.status === 'archived' && j.archivedReason === 'rejected')).length;
  const interviews = applied.filter(j => j.status === 'interviewing' || j.status === 'offer').length;
  const offers = applied.filter(j => j.status === 'offer').length;
  const fits = applied.map(fitScore).filter((x): x is number => x != null);
  const avgFit = fits.length ? Math.round(fits.reduce((a, b) => a + b, 0) / fits.length) : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-end justify-between gap-4 px-7 pt-6 pb-5">
        <div>
          <h1 className="font-display text-[27px] leading-none tracking-[-0.015em] text-ink">Applications</h1>
          <p className="mt-2 text-[13.5px] text-muted">Everything you've sent, how it's going, and what Hermes thinks you should do next.</p>
        </div>
        <Button variant="secondary" icon={<Download className="size-4" />} onClick={() => (location.href = '/api/export.csv')} disabled={!applied.length}>
          Export CSV
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-7 pb-12">
        <div className="max-w-[1180px] space-y-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Kpi label="Applied" value={applied.length} sub={thisWeek ? `+${thisWeek} this week` : 'none this week'} accent />
            <Kpi label="Heard back" value={applied.length ? `${Math.round((100 * responded) / applied.length)}%` : '—'} sub={`${responded} of ${applied.length}`} />
            <Kpi label="Interviews" value={interviews} sub={applied.length ? `${Math.round((100 * interviews) / applied.length)}% of applications` : '—'} />
            <Kpi label="Offers" value={offers} sub={offers ? 'Congratulations' : 'Keep going'} />
            <Kpi label="Avg. fit when applying" value={avgFit ?? '—'} sub={avgFit == null ? '—' : avgFit >= 75 ? 'Aiming well' : avgFit >= 60 ? 'Some stretches' : 'Mostly long shots'} />
          </div>

          <div className="grid gap-3 lg:grid-cols-[1.5fr_1fr]">
            <Card className="p-5">
              <SectionTitle>Applications · last 30 days</SectionTitle>
              <DailyBars applied={applied} />
            </Card>
            <Card className="p-5">
              <SectionTitle>Funnel</SectionTitle>
              <Funnel jobs={jobs} />
            </Card>
          </div>

          <ReportCard hasApplied={applied.length > 0} />

          <section>
            <SectionTitle>All applications</SectionTitle>
            {applied.length ? (
              <ApplicationsTable rows={applied} />
            ) : (
              <Card>
                <EmptyState icon={<FileBarChart2 className="size-5" />} title="Nothing sent yet">
                  Once you submit an application from the board it shows up here, with its status, fit score and history.
                </EmptyState>
              </Card>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value, sub, accent }: { label: string; value: React.ReactNode; sub: string; accent?: boolean }) {
  return (
    <Card className={cn('p-4', accent && 'bg-[#17161c] text-white dark:bg-[#24232c] dark:ring-1 dark:ring-white/10')}>
      <div className={cn('text-[11.5px] font-semibold tracking-[0.06em] uppercase', accent ? 'text-white/55' : 'text-muted')}>{label}</div>
      <div className={cn('mt-2 font-display text-[30px] leading-none tabular-nums', accent ? 'text-white' : 'text-ink')}>{value}</div>
      <div className={cn('mt-1.5 text-[12px]', accent ? 'text-[#e7b04c]' : 'text-muted')}>{sub}</div>
    </Card>
  );
}

function DailyBars({ applied }: { applied: Job[] }) {
  const days = React.useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const out: { date: Date; count: number }[] = [];
    for (let i = 29; i >= 0; i--) out.push({ date: new Date(+start - i * DAY), count: 0 });
    for (const j of applied) {
      const d = new Date(j.appliedAt!);
      d.setHours(0, 0, 0, 0);
      const idx = out.findIndex(x => +x.date === +d);
      if (idx >= 0) out[idx].count++;
    }
    return out;
  }, [applied]);
  const max = Math.max(1, ...days.map(d => d.count));
  const total = days.reduce((a, b) => a + b.count, 0);
  const [hover, setHover] = React.useState<number | null>(null);
  const shown = hover != null ? days[hover] : null;
  return (
    <div>
      <div className="mb-3 flex items-baseline gap-2">
        <span className="font-display text-[23px] leading-none text-ink tabular-nums">{shown ? shown.count : total}</span>
        <span className="text-[12.5px] text-muted">{shown ? `on ${shown.date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}` : 'in the last 30 days'}</span>
      </div>
      <div className="flex h-[120px] items-end gap-[3px]" onMouseLeave={() => setHover(null)}>
        {days.map((d, i) => (
          <div key={i} className="group relative flex h-full flex-1 items-end" onMouseEnter={() => setHover(i)}>
            <motion.div
              className={cn('w-full rounded-[3px]', d.count ? (hover === i ? 'bg-accent' : 'bg-accent/75') : 'bg-line-2')}
              initial={{ height: 0 }}
              animate={{ height: d.count ? `${Math.max(8, (d.count / max) * 100)}%` : '3px' }}
              transition={{ delay: i * 0.012, type: 'spring', bounce: 0.2 }}
            />
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-[11px] text-faint">
        <span>{fmtDate(days[0].date.toISOString())}</span>
        <span>Today</span>
      </div>
    </div>
  );
}

function Funnel({ jobs }: { jobs: Job[] }) {
  const prepared = jobs.filter(j => j.packet).length;
  const applied = jobs.filter(j => j.appliedAt);
  const heard = applied.filter(j => j.status === 'interviewing' || j.status === 'offer' || (j.status === 'archived' && j.archivedReason === 'rejected')).length;
  const steps = [
    { label: 'Discovered', n: jobs.length, color: 'var(--st-discovered)' },
    { label: 'Prepared by Hermes', n: prepared, color: 'var(--st-preparing)' },
    { label: 'Applied', n: applied.length, color: 'var(--st-applied)' },
    { label: 'Heard back', n: heard, color: 'var(--info)' },
    { label: 'Interviews', n: applied.filter(j => j.status === 'interviewing' || j.status === 'offer').length, color: 'var(--st-interviewing)' },
    { label: 'Offers', n: applied.filter(j => j.status === 'offer').length, color: 'var(--st-offer)' },
  ];
  const max = Math.max(1, steps[0].n);
  return (
    <div className="space-y-2.5">
      {steps.map((s, i) => (
        <div key={s.label}>
          <div className="mb-1 flex justify-between text-[12.5px]">
            <span className="text-ink-2">{s.label}</span>
            <span className="font-semibold text-ink tabular-nums">{s.n}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-line-2">
            <motion.div className="h-full rounded-full" style={{ background: s.color }} initial={{ width: 0 }} animate={{ width: `${(s.n / max) * 100}%` }} transition={{ delay: 0.1 + i * 0.07, duration: 0.7, ease: [0.22, 1, 0.36, 1] }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function ReportCard({ hasApplied }: { hasApplied: boolean }) {
  const reports = useApp(s => s.reports);
  const running = useApp(s => s.runs.some(r => r.kind === 'summary' && (r.status === 'running' || r.status === 'queued')));
  const [days, setDays] = React.useState('7');
  const [selected, setSelected] = React.useState<string | null>(null);
  const report: Report | undefined = reports.find(r => r.id === selected) || reports[0];

  const generate = async () => {
    setSelected(null);
    await api.post('/api/reports', { days: Number(days) }).catch(() => {});
  };

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-2 px-5 py-4">
        <div className="flex items-center gap-2.5">
          <div className="grid size-8 place-items-center rounded-lg bg-gold-soft text-gold">
            <Sparkles className="size-4" />
          </div>
          <div>
            <div className="text-[14px] font-semibold text-ink">Hermes's summary</div>
            <div className="text-[12px] text-muted">{report ? `${fmtDate(report.from)} – ${fmtDate(report.to)} · written ${timeAgo(report.generatedAt)}` : 'A written recap of what you applied to and what to do next'}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {reports.length > 1 && (
            <Menu>
              <MenuTrigger asChild>
                <Button size="sm" variant="ghost" icon={<History className="size-3.5" />}>
                  History
                </Button>
              </MenuTrigger>
              <MenuContent>
                {reports.map(r => (
                  <MenuItem key={r.id} onSelect={() => setSelected(r.id)}>
                    {fmtDate(r.from)} – {fmtDate(r.to)} <span className="ml-auto pl-3 text-[11px] text-faint">{timeAgo(r.generatedAt)}</span>
                  </MenuItem>
                ))}
              </MenuContent>
            </Menu>
          )}
          <Segmented
            size="sm"
            value={days}
            onChange={setDays}
            options={[
              { value: '7', label: '7 days' },
              { value: '30', label: '30 days' },
              { value: '365', label: 'All' },
            ]}
          />
          <Button size="sm" variant="primary" loading={running} disabled={!hasApplied} icon={<Sparkles className="size-3.5 text-gold" />} onClick={generate}>
            {running ? 'Writing…' : report ? 'Write a new one' : 'Write my summary'}
          </Button>
        </div>
      </div>
      <div className="px-6 py-5">
        {running && !report ? (
          <div className="space-y-2.5">
            {[40, 95, 88, 70, 92, 60].map((w, i) => (
              <div key={i} className="skeleton h-3.5" style={{ width: `${w}%` }} />
            ))}
          </div>
        ) : report ? (
          <Markdown text={report.markdown} className={cn('prose-report max-w-[760px] text-[14px]', running && 'opacity-50')} />
        ) : (
          <p className="text-[13.5px] text-muted">{hasApplied ? 'Ask Hermes for a recap — it groups what you applied to, spots patterns in your gaps, and suggests your next moves.' : 'Apply to a few roles first, then Hermes can summarize your progress.'}</p>
        )}
      </div>
    </Card>
  );
}

type SortKey = 'date' | 'company' | 'fit' | 'status';

function ApplicationsTable({ rows }: { rows: Job[] }) {
  const [key, setKey] = React.useState<SortKey>('date');
  const [asc, setAsc] = React.useState(false);
  const sorted = React.useMemo(() => {
    const s = [...rows].sort((a, b) => {
      switch (key) {
        case 'company':
          return a.company.localeCompare(b.company);
        case 'fit':
          return (fitScore(a) ?? 0) - (fitScore(b) ?? 0);
        case 'status':
          return a.status.localeCompare(b.status);
        default:
          return Date.parse(a.appliedAt!) - Date.parse(b.appliedAt!);
      }
    });
    return asc ? s : s.reverse();
  }, [rows, key, asc]);

  const Th = ({ k, children, className }: { k: SortKey; children: React.ReactNode; className?: string }) => (
    <th className={cn('px-4 py-2.5 text-left text-[11.5px] font-semibold tracking-[0.05em] text-muted uppercase', className)}>
      <button onClick={() => (key === k ? setAsc(!asc) : (setKey(k), setAsc(k === 'company')))} className="inline-flex items-center gap-1 hover:text-ink">
        {children}
        {key === k && (asc ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
      </button>
    </th>
  );

  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse">
          <thead className="border-b border-line bg-panel">
            <tr>
              <Th k="company">Role</Th>
              <Th k="date">Applied</Th>
              <Th k="status">Status</Th>
              <Th k="fit" className="text-center">
                Fit
              </Th>
              <th className="px-4 py-2.5 text-left text-[11.5px] font-semibold tracking-[0.05em] text-muted uppercase">Source</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(j => {
              const meta = STATUS_META[j.status];
              return (
                <tr key={j.id} onClick={() => openJob(j.id)} className="cursor-pointer border-b border-line-2 transition-colors last:border-0 hover:bg-panel">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <CompanyLogo company={j.company} logo={j.companyLogo} domain={j.companyDomain} size={30} />
                      <div className="min-w-0">
                        <div className="truncate text-[13.5px] font-semibold text-ink">{j.title}</div>
                        <div className="truncate text-[12px] text-muted">
                          {j.company} · {j.location}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-[13px] whitespace-nowrap text-ink-2">
                    {fmtDate(j.appliedAt)}
                    <div className="text-[11.5px] text-faint">{timeAgo(j.appliedAt)}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[12px] font-medium" style={{ background: `color-mix(in oklab, ${meta.color} 13%, transparent)`, color: meta.color }}>
                      <span className="size-1.5 rounded-full" style={{ background: meta.color }} />
                      {j.status === 'archived' ? (j.archivedReason === 'rejected' ? 'Not selected' : j.archivedReason === 'withdrawn' ? 'Withdrawn' : 'Archived') : meta.label}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-center">
                      <ScoreRing score={fitScore(j)} size={30} stroke={2.5} />
                    </div>
                  </td>
                  <td className="px-4 py-3 text-[12.5px] text-muted">{SOURCE_LABEL[j.source]}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
