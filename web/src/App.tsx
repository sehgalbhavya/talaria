import * as React from 'react';
import { Toaster } from 'sonner';
import { AnimatePresence, motion } from 'motion/react';
import { TooltipProvider } from '@/components/ui';
import { connectEvents, loadBootstrap, useApp } from '@/lib/store';
import { useRoute } from '@/lib/router';
import { Sidebar } from '@/components/Sidebar';
import { Board } from '@/views/Board';
import { SummaryView } from '@/views/Summary';
import { ArchiveView } from '@/views/Archive';
import { ProfileView } from '@/views/Profile';
import { ActivityView } from '@/views/Activity';
import { SettingsView } from '@/views/Settings';
import { JobDrawer } from '@/components/JobDrawer';
import { CommandPalette } from '@/components/CommandPalette';
import { Onboarding } from '@/views/Onboarding';
import { BoardTour } from '@/components/BoardTour';
import { Logo } from '@/components/brand';
import { useTheme } from '@/lib/theme';

export function App() {
  const loaded = useApp(s => s.loaded);
  const onboarded = useApp(s => Boolean(s.settings?.onboarded && s.profile));
  const [error, setError] = React.useState<string | null>(null);
  const route = useRoute();
  const theme = useTheme();

  React.useEffect(() => {
    loadBootstrap().catch(e => setError(e.message));
    connectEvents();
  }, []);

  return (
    <TooltipProvider>
      <Toaster
        position="bottom-right"
        theme={theme}
        toastOptions={{ className: '!rounded-xl !border-0 !shadow-pop !font-sans !text-[13px] !bg-raised !text-ink' }}
        offset={18}
      />
      {!loaded && <Splash error={error} />}
      <AnimatePresence initial={false}>
        {!loaded ? null : !onboarded ? (
          <motion.div key="onboarding" className="absolute inset-0 overflow-y-auto" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <Onboarding />
          </motion.div>
        ) : (
          <motion.div key="app" className="absolute inset-0 flex" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}>
            <Sidebar view={route.view} />
            <main className="relative flex min-w-0 flex-1 flex-col">
              {route.view === 'board' && <Board />}
              {route.view === 'summary' && <SummaryView />}
              {route.view === 'archive' && <ArchiveView />}
              {route.view === 'profile' && <ProfileView />}
              {route.view === 'activity' && <ActivityView />}
              {route.view === 'settings' && <SettingsView />}
            </main>
            <JobDrawer jobId={route.jobId} tab={route.tab} />
            <CommandPalette />
            <BoardTour />
          </motion.div>
        )}
      </AnimatePresence>
    </TooltipProvider>
  );
}

function Splash({ error }: { error: string | null }) {
  React.useEffect(() => {
    if (!error) return;
    const t = setInterval(() => loadBootstrap().catch(() => {}), 2500);
    return () => clearInterval(t);
  }, [error]);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-bg">
      <div className="flex flex-col items-center gap-4">
        <div className="grid size-14 animate-float place-items-center rounded-2xl bg-[#17161c] shadow-lift dark:ring-1 dark:ring-white/10">
          <Logo className="size-10" animated />
        </div>
        <p className="text-[13px] text-muted">{error ? 'Waiting for the Talaria server…' : 'Loading your board…'}</p>
      </div>
    </div>
  );
}
