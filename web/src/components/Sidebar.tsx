import * as React from 'react';
import { aiProviderLabel } from '@shared/aiProviders';
import { Activity, Archive, BarChart3, KanbanSquare, Moon, ScanSearch, Search, SlidersHorizontal, Sun } from 'lucide-react';
import { openActivity } from '@/views/Activity';
import { motion } from 'motion/react';
import { useApp } from '@/lib/store';
import { navigate, type View } from '@/lib/router';
import { cn } from '@/lib/utils';
import { Kbd, Tooltip } from './ui';
import { StatusDot, Wordmark } from './brand';
import { setThemePref, useTheme } from '@/lib/theme';
import { openPalette } from './CommandPalette';
import { profileScore } from '@/lib/profileStrength';
import { aiName } from '@/lib/ai';

type NavItem = { view: View; label: string; icon: React.ElementType };

const NAV: NavItem[] = [
  { view: 'board', label: 'Board', icon: KanbanSquare },
  { view: 'summary', label: 'Applications', icon: BarChart3 },
  { view: 'archive', label: 'Archive', icon: Archive },
  { view: 'search', label: 'Job search', icon: ScanSearch },
  { view: 'settings', label: 'Settings', icon: SlidersHorizontal },
];

export function Sidebar({ view }: { view: View }) {
  const needs = useApp(s => Object.values(s.jobs).filter(j => j.status === 'needs_input').length);
  const running = useApp(s => s.runs.filter(r => r.status === 'running' || r.status === 'queued').length);
  const ai = useApp(s => s.ai);
  const settings = useApp(s => s.settings);
  const profile = useApp(s => s.profile);
  const prefs = useApp(s => s.preferences);
  const score = profile ? profileScore(profile, prefs) : 0;
  const theme = useTheme();
  const checking = !ai.ok && (!ai.checkedAt || Boolean(ai.checking));
  const pausedAt = ai.rateLimitedUntil && Date.parse(ai.rateLimitedUntil) > Date.now() ? new Date(ai.rateLimitedUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;

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
        className="mb-4 flex h-9 items-center gap-2 border border-line bg-card px-2.5 text-[13px] text-faint shadow-[0_1px_1px_rgb(0_0_0/0.02)] transition-colors hover:text-muted"
      >
        <Search className="size-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-left">Search…</span>
        <span className="flex shrink-0 gap-0.5">
          <Kbd>Ctrl</Kbd>
          <Kbd>K</Kbd>
        </span>
      </button>

      <nav className="flex flex-col gap-0.5">
        {NAV.map(item => {
          const Icon = item.icon;
          const active = view === item.view;
          return (
            <button
              key={item.view}
              onClick={() => navigate({ view: item.view })}
              className={cn('relative flex h-9 items-center gap-2.5 px-2.5 text-[13.5px] font-medium transition-colors', active ? 'text-ink' : 'text-muted hover:bg-ink/[0.04] hover:text-ink-2')}
            >
              {active && <motion.span layoutId="nav-active" className="absolute inset-0 bg-card shadow-card" transition={{ type: 'spring', bounce: 0.15, duration: 0.4 }} />}
              <Icon className="relative size-[17px]" strokeWidth={active ? 2.1 : 1.8} />
              <span className="relative flex-1 text-left">{item.label}</span>
              {item.view === 'board' && needs > 0 && <span className="relative grid h-5 min-w-5 place-items-center bg-warn px-1.5 text-[11px] font-semibold text-white">{needs}</span>}
            </button>
          );
        })}
      </nav>

      <div className="mt-auto flex flex-col gap-2">
        {/* The AI at a glance. The card opens what it's doing; the cog opens how it's set up. */}
        <div className="relative">
          <button
            onClick={openActivity}
            title="Open agent activity"
            className="w-full border border-line bg-card p-3 pr-9 text-left shadow-[0_1px_1px_rgb(0_0_0/0.02)] transition-colors hover:border-ink/15"
          >
            <div className="flex items-center gap-2">
              <StatusDot color={pausedAt ? 'var(--warn)' : ai.ok ? 'var(--ok)' : checking ? 'var(--gold)' : 'var(--bad)'} pulse={running > 0 || checking} />
              <span className="text-[12.5px] font-semibold text-ink">
                AI {pausedAt ? 'paused' : ai.ok ? (running > 0 ? 'working' : 'connected') : checking ? 'connecting…' : 'needs attention'}
              </span>
            </div>
            <div className={cn('mt-1 flex items-center gap-1.5 pl-4 text-[11.5px]', running > 0 && !pausedAt ? 'font-medium text-gold' : 'text-muted')}>
              <span className="min-w-0 flex-1 truncate">
                {pausedAt
                  ? `${aiProviderLabel(ai.provider)} rate limit · resumes ${pausedAt}`
                  : running > 0
                    ? `${running} task${running === 1 ? '' : 's'} running`
                    : ai.ok
                      ? `${aiProviderLabel(ai.provider)} · ${ai.model}`
                      : checking
                        ? 'Saying hello'
                        : ai.message}
              </span>
              <Activity className="size-3 shrink-0 opacity-70" />
            </div>
            <div className="mt-2 flex items-center gap-1.5 border-t border-line-2 pt-2 pl-4 text-[11.5px] text-muted">
              <span className={cn('size-1.5 ', settings?.autopilot.enabled ? 'bg-accent' : 'bg-faint')} />
              {settings?.autopilot.enabled ? `Autopilot on · next search ${nextScout}` : 'Autopilot off'}
            </div>
          </button>
          <Tooltip content="AI settings">
            <button
              onClick={() => navigate({ view: 'settings', section: 'ai' })}
              aria-label="AI settings"
              className="absolute top-2 right-2 p-1 text-faint transition-colors hover:bg-ink/[0.06] hover:text-ink"
            >
              <SlidersHorizontal className="size-3.5" />
            </button>
          </Tooltip>
        </div>

        <div className="flex items-center justify-between px-1.5 pt-1">
          <button
            onClick={() => navigate({ view: 'profile' })}
            aria-current={view === 'profile' ? 'page' : undefined}
            className={cn('-ml-1.5 flex min-w-0 items-center gap-2 py-1 pr-2 pl-1.5 text-left transition-colors', view === 'profile' ? 'bg-card shadow-card' : 'hover:bg-ink/[0.04]')}
          >
            <div className="grid size-7 shrink-0 place-items-center bg-accent-soft text-[12px] font-semibold text-accent">{(profile?.name || '?').slice(0, 1).toUpperCase()}</div>
            <div className="min-w-0">
              <div className="truncate text-[12.5px] font-medium text-ink">{profile?.name || 'You'}</div>
              <div className="truncate text-[11px] text-muted">{score < 100 ? `Profile · ${score}% complete` : profile?.headline || 'View profile'}</div>
            </div>
          </button>
          <Tooltip content={theme === 'dark' ? 'Light mode' : 'Dark mode'}>
            <button onClick={() => setThemePref(theme === 'dark' ? 'light' : 'dark')} className="p-1.5 text-muted transition-colors hover:bg-ink/5 hover:text-ink" aria-label="Toggle theme">
              {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </button>
          </Tooltip>
        </div>
      </div>
    </aside>
  );
}
