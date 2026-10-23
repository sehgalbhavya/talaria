import * as React from 'react';
import { Activity, Archive, BarChart3, KanbanSquare, Moon, Search, Settings2, Sun, UserRound } from 'lucide-react';
import { motion } from 'motion/react';
import { useApp } from '@/lib/store';
import { navigate, type View } from '@/lib/router';
import { cn } from '@/lib/utils';
import { Kbd, Tooltip } from './ui';
import { StatusDot, Wordmark } from './brand';
import { setThemePref, useTheme } from '@/lib/theme';
import { openPalette } from './CommandPalette';

const NAV: { view: View; label: string; icon: React.ElementType }[] = [
  { view: 'board', label: 'Board', icon: KanbanSquare },
  { view: 'summary', label: 'Applications', icon: BarChart3 },
  { view: 'archive', label: 'Archive', icon: Archive },
  { view: 'profile', label: 'Profile & prefs', icon: UserRound },
  { view: 'activity', label: 'Agent activity', icon: Activity },
  { view: 'settings', label: 'Settings', icon: Settings2 },
];

export function Sidebar({ view }: { view: View }) {
  const needs = useApp(s => Object.values(s.jobs).filter(j => j.status === 'needs_input').length);
  const running = useApp(s => s.runs.filter(r => r.status === 'running' || r.status === 'queued').length);
  const hermes = useApp(s => s.hermes);
  const settings = useApp(s => s.settings);
  const profile = useApp(s => s.profile);
  const theme = useTheme();
  const checking = !hermes.ok && (!hermes.checkedAt || Boolean(hermes.checking));
  const pausedAt = hermes.rateLimitedUntil && Date.parse(hermes.rateLimitedUntil) > Date.now() ? new Date(hermes.rateLimitedUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;

  const nextScout = React.useMemo(() => {
    const ap = settings?.autopilot;
    if (!ap?.enabled) return null;
    const last = ap.lastScoutAt ? Date.parse(ap.lastScoutAt) : 0;
    const due = last + ap.scoutEveryHours * 3600_000 - Date.now();
    if (due <= 0) return 'soon';
    const h = Math.floor(due / 3600_000);
    return h >= 1 ? `in ${h}h` : `in ${Math.max(1, Math.round(due / 60_000))}m`;
  }, [settings]);

  return (
    <aside className="flex w-[232px] shrink-0 flex-col border-r border-line bg-panel px-3 pt-4 pb-3 max-md:hidden">
      <div className="px-2 pb-5">
        <Wordmark />
      </div>

      <button
        onClick={openPalette}
        className="mb-4 flex h-9 items-center gap-2 rounded-lg border border-line bg-card px-2.5 text-[13px] text-faint shadow-[0_1px_1px_rgb(0_0_0/0.02)] transition-colors hover:text-muted"
      >
        <Search className="size-4 shrink-0" />
        <span className="flex-1 truncate text-left">Search…</span>
        <span className="flex shrink-0 gap-0.5">
          <Kbd>Ctrl</Kbd>
          <Kbd>K</Kbd>
        </span>
      </button>

      <nav className="flex flex-col gap-0.5">
        {NAV.map(item => {
          const active = view === item.view;
          const Icon = item.icon;
          return (
            <button
              key={item.view}
              onClick={() => navigate({ view: item.view })}
              className={cn('relative flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] font-medium transition-colors', active ? 'text-ink' : 'text-muted hover:bg-ink/[0.04] hover:text-ink-2')}
            >
              {active && <motion.span layoutId="nav-active" className="absolute inset-0 rounded-lg bg-card shadow-card" transition={{ type: 'spring', bounce: 0.15, duration: 0.4 }} />}
              <Icon className="relative size-[17px]" strokeWidth={active ? 2.1 : 1.8} />
              <span className="relative flex-1 text-left">{item.label}</span>
              {item.view === 'board' && needs > 0 && <span className="relative grid h-5 min-w-5 place-items-center rounded-full bg-warn px-1.5 text-[11px] font-semibold text-white">{needs}</span>}
              {item.view === 'activity' && running > 0 && (
                <span className="relative flex items-center gap-1 text-[11px] font-medium text-gold">
                  <StatusDot color="var(--gold)" pulse />
                  {running}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="mt-auto flex flex-col gap-2">
        <button onClick={() => navigate({ view: 'settings' })} className="rounded-xl border border-line bg-card p-3 text-left shadow-[0_1px_1px_rgb(0_0_0/0.02)] transition-colors hover:border-ink/15">
          <div className="flex items-center gap-2">
            <StatusDot color={pausedAt ? 'var(--warn)' : hermes.ok ? 'var(--ok)' : checking ? 'var(--gold)' : hermes.installed ? 'var(--warn)' : 'var(--bad)'} pulse={running > 0 || checking} />
            <span className="text-[12.5px] font-semibold text-ink">Hermes {pausedAt ? 'paused' : hermes.ok ? 'connected' : checking ? 'connecting…' : hermes.installed ? 'needs attention' : 'not found'}</span>
          </div>
          <div className="mt-1 truncate pl-4 text-[11.5px] text-muted">
            {pausedAt ? `Copilot rate limit · resumes ${pausedAt}` : hermes.ok ? `${hermes.provider === 'copilot' ? 'GitHub Copilot' : hermes.provider} · ${hermes.model}` : checking ? 'Saying hello' : hermes.message}
          </div>
          <div className="mt-2 flex items-center gap-1.5 border-t border-line-2 pt-2 pl-4 text-[11.5px] text-muted">
            <span className={cn('size-1.5 rounded-full', settings?.autopilot.enabled ? 'bg-accent' : 'bg-faint')} />
            {settings?.autopilot.enabled ? `Autopilot on · next search ${nextScout}` : 'Autopilot off'}
          </div>
        </button>

        <div className="flex items-center justify-between px-1.5 pt-1">
          <button onClick={() => navigate({ view: 'profile' })} className="flex min-w-0 items-center gap-2 rounded-lg py-1 pr-2 text-left">
            <div className="grid size-7 shrink-0 place-items-center rounded-full bg-accent-soft text-[12px] font-semibold text-accent">{(profile?.name || '?').slice(0, 1).toUpperCase()}</div>
            <div className="min-w-0">
              <div className="truncate text-[12.5px] font-medium text-ink">{profile?.name || 'You'}</div>
              <div className="truncate text-[11px] text-muted">{profile?.headline || 'Set up your profile'}</div>
            </div>
          </button>
          <Tooltip content={theme === 'dark' ? 'Light mode' : 'Dark mode'}>
            <button onClick={() => setThemePref(theme === 'dark' ? 'light' : 'dark')} className="rounded-lg p-1.5 text-muted transition-colors hover:bg-ink/5 hover:text-ink" aria-label="Toggle theme">
              {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </button>
          </Tooltip>
        </div>
      </div>
    </aside>
  );
}
