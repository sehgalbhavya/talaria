import * as React from 'react';
import { Command } from 'cmdk';
import * as RDialog from '@radix-ui/react-dialog';
import { Activity, BarChart3, KanbanSquare, Moon, Plus, Search, Settings2, Sparkles, UserRound } from 'lucide-react';
import { startScout, useApp } from '@/lib/store';
import { navigate, openJob } from '@/lib/router';
import { fitScore, STATUS_META } from '@/lib/utils';
import { CompanyLogo } from './brand';
import { setThemePref, useTheme } from '@/lib/theme';

let setOpenGlobal: ((v: boolean) => void) | null = null;
export const openPalette = () => setOpenGlobal?.(true);

export function CommandPalette() {
  const [open, setOpen] = React.useState(false);
  const jobs = useApp(s => s.jobs);
  const theme = useTheme();
  setOpenGlobal = setOpen;

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(o => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const run = (fn: () => void) => {
    setOpen(false);
    setTimeout(fn, 10);
  };

  const list = Object.values(jobs).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const item = 'flex h-10 cursor-default items-center gap-3 rounded-lg px-3 text-[13.5px] text-ink-2 data-[selected=true]:bg-ink/[0.05] data-[selected=true]:text-ink dark:data-[selected=true]:bg-white/[0.07]';

  return (
    <RDialog.Root open={open} onOpenChange={setOpen}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-50 bg-[#0b0b10]/30 backdrop-blur-[2px]" />
        <RDialog.Content aria-describedby={undefined} className="fixed top-[14vh] left-1/2 z-50 w-[min(620px,calc(100vw-24px))] -translate-x-1/2 overflow-hidden rounded-2xl bg-raised shadow-pop outline-none">
          <RDialog.Title className="sr-only">Command palette</RDialog.Title>
          <Command loop>
            <div className="flex items-center gap-3 border-b border-line px-4">
              <Search className="size-4 text-faint" />
              <Command.Input autoFocus placeholder="Search jobs, companies or actions…" className="h-13 flex-1 bg-transparent py-4 text-[15px] text-ink outline-none placeholder:text-faint" />
            </div>
            <Command.List className="max-h-[52vh] overflow-y-auto p-2">
              <Command.Empty className="px-3 py-8 text-center text-[13px] text-muted">Nothing found.</Command.Empty>
              <Command.Group heading="Actions" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-faint [&_[cmdk-group-heading]]:uppercase">
                <Command.Item className={item} onSelect={() => run(() => (navigate({ view: 'board' }), startScout()))}>
                  <Sparkles className="size-4 text-gold" /> Find new jobs now
                </Command.Item>
                <Command.Item className={item} onSelect={() => run(() => (navigate({ view: 'board' }), setTimeout(() => window.dispatchEvent(new Event('talaria:add-job')), 50)))}>
                  <Plus className="size-4 text-muted" /> Add a job from a link
                </Command.Item>
                <Command.Item className={item} onSelect={() => run(() => navigate({ view: 'board' }))}>
                  <KanbanSquare className="size-4 text-muted" /> Go to board
                </Command.Item>
                <Command.Item className={item} onSelect={() => run(() => navigate({ view: 'summary' }))}>
                  <BarChart3 className="size-4 text-muted" /> Applications summary
                </Command.Item>
                <Command.Item className={item} onSelect={() => run(() => navigate({ view: 'profile' }))}>
                  <UserRound className="size-4 text-muted" /> Profile & preferences
                </Command.Item>
                <Command.Item className={item} onSelect={() => run(() => navigate({ view: 'activity' }))}>
                  <Activity className="size-4 text-muted" /> Agent activity
                </Command.Item>
                <Command.Item className={item} onSelect={() => run(() => navigate({ view: 'settings' }))}>
                  <Settings2 className="size-4 text-muted" /> Settings
                </Command.Item>
                <Command.Item className={item} onSelect={() => run(() => setThemePref(theme === 'dark' ? 'light' : 'dark'))}>
                  <Moon className="size-4 text-muted" /> Toggle dark mode
                </Command.Item>
              </Command.Group>
              {list.length > 0 && (
                <Command.Group heading="Jobs" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-faint [&_[cmdk-group-heading]]:uppercase">
                  {list.slice(0, 200).map(j => (
                    <Command.Item key={j.id} value={`${j.title} ${j.company} ${j.id}`} className={item + ' h-12'} onSelect={() => run(() => openJob(j.id))}>
                      <CompanyLogo company={j.company} logo={j.companyLogo} domain={j.companyDomain} size={26} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium text-ink">{j.title}</div>
                        <div className="truncate text-[12px] text-muted">{j.company}</div>
                      </div>
                      <span className="flex items-center gap-1.5 text-[11.5px] text-muted">
                        <span className="size-1.5 rounded-full" style={{ background: STATUS_META[j.status].color }} />
                        {STATUS_META[j.status].label}
                      </span>
                      {fitScore(j) != null && <span className="w-7 text-right text-[12px] font-semibold text-ink-2 tabular-nums">{fitScore(j)}</span>}
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
            </Command.List>
          </Command>
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}
