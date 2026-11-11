import * as React from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ArrowRight, Check, ChevronDown, FileText, HardDrive, Loader, MessageSquare, RefreshCw, Search, Send, ShieldCheck, SquareDashed } from 'lucide-react';
import type { SetupStatus } from '@shared/types';
import { AIConnect } from '@/components/AIConnect';
import { api } from '@/lib/api';
import { useApp } from '@/lib/store';
import { cn } from '@/lib/utils';
import { Button, CopyButton, Field, Input } from '@/components/ui';

export function StepHeader({ kicker, title, children }: { kicker: string; title: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="mb-8">
      {/* On wide screens the sidebar already shows where you are. */}
      <div className="mb-2 text-[12px] font-semibold tracking-[0.1em] text-gold uppercase lg:hidden">{kicker}</div>
      <h2 className="font-display text-[32px] leading-[1.05] tracking-[-0.015em] text-ink">{title}</h2>
      {children && <p className="mt-3 text-[15px] leading-relaxed text-muted">{children}</p>}
    </div>
  );
}

/** Where each step's Back / Continue buttons go: one bar pinned to the bottom, so they never move. */
export const FooterSlot = React.createContext<HTMLElement | null>(null);

export function StepFooter({ back, backLabel = 'Back', children }: { back?: () => void; backLabel?: string; children: React.ReactNode }) {
  const slot = React.useContext(FooterSlot);
  const bar = (
    <div className="flex items-center justify-between gap-3">
      {back ? (
        <Button variant="ghost" icon={<ArrowLeft className="size-4" />} onClick={back}>
          {backLabel}
        </Button>
      ) : (
        <span />
      )}
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
  return slot ? createPortal(bar, slot) : bar;
}

export function NextButton({ children = 'Continue', ...rest }: React.ComponentProps<typeof Button>) {
  return (
    <Button variant="primary" size="lg" icon={<ArrowRight className="size-4" />} className="flex-row-reverse" {...rest}>
      {children}
    </Button>
  );
}

/** A quiet "skip" next to the main button: there if you need it, never competing with it. */
export function SkipLink({ onClick, title, children = 'Skip for now' }: { onClick: () => void; title?: string; children?: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} title={title} className="px-2 text-[13px] text-faint underline-offset-2 hover:text-muted hover:underline">
      {children}
    </button>
  );
}

/** A terminal command the person can copy with one click. */
function Cmd({ children }: { children: string }) {
  return (
    <div className="flex items-center gap-2 bg-[#17161c] py-1.5 pr-1.5 pl-3 font-mono text-[12.5px] text-[#e9e7f2]">
      <span className="min-w-0 flex-1 truncate select-all">{children}</span>
      <CopyButton text={children} className="border-white/15 text-[#e9e7f2] hover:bg-white/10" />
    </div>
  );
}

// ---------------- 0. Welcome ----------------

const WHAT_WE_ASK = [
  { icon: FileText, title: 'Your resume', body: 'Your AI reads it in the background while you carry on. You check what it found before anything else uses it.' },
  { icon: MessageSquare, title: 'Your story', body: 'A few questions, answered in your own words. Your cover letters are written from this, so they sound like you.' },
  { icon: Search, title: "What you're after", body: 'The roles and level you want, where and how you want to work, and your deal-breakers.' },
  { icon: Send, title: 'Where to look', body: 'Job boards, plus any companies or careers pages you want watched. Nothing is sent to an employer until you approve it.' },
];

export function WelcomeStep({ kicker, next }: { kicker: string; next: () => void }) {
  return (
    <div>
      <StepHeader kicker={kicker} title="First, let's get to know you.">
        Talaria finds jobs, tells you honestly where you stand and prepares each application. It can only do that as well as it knows you, so the next 10 minutes are about you. You can change any answer later.
      </StepHeader>

      <ul className="space-y-3">
        {WHAT_WE_ASK.map(({ icon: Icon, title, body }) => (
          <li key={title} className="flex gap-4 bg-card p-4 shadow-card">
            <div className="grid size-10 shrink-0 place-items-center bg-gold-soft text-gold">
              <Icon className="size-5" />
            </div>
            <div>
              <div className="text-[14.5px] font-semibold text-ink">{title}</div>
              <div className="mt-0.5 text-[13.5px] leading-relaxed text-muted">{body}</div>
            </div>
          </li>
        ))}
      </ul>

      <p className="mt-5 text-[13px] leading-relaxed text-muted">
        <strong className="font-semibold text-ink">Have ready:</strong> your resume (PDF, Word, text or LaTeX) and an AI account you already use: ChatGPT, GitHub Copilot, or an API key.
      </p>

      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[12.5px] text-muted">
        <span className="inline-flex items-center gap-1.5">
          <HardDrive className="size-3.5 text-faint" /> Everything you tell it stays on this computer
        </span>
        <span className="inline-flex items-center gap-1.5">
          <ShieldCheck className="size-3.5 text-faint" /> You approve everything
        </span>
      </div>

      <StepFooter>
        <NextButton onClick={next}>Let's start</NextButton>
      </StepFooter>
    </div>
  );
}

// ---------------- 1. Connect the AI ----------------

function Collapsible({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <div className="bg-card shadow-card">
      <button type="button" onClick={() => setOpen(o => !o)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-[13.5px] font-medium text-ink">
        {title}
        <ChevronDown className={cn('size-4 text-faint transition-transform', open && 'rotate-180')} />
      </button>
      {open && <div className="space-y-2 border-t border-line px-4 py-3 text-[13px] leading-relaxed text-muted">{children}</div>}
    </div>
  );
}

export function ConnectStep({ kicker, next, back }: { kicker: string; next: () => void; back: () => void }) {
  const ai = useApp(s => s.ai);
  const settings = useApp(s => s.settings)!;
  const [setup, setSetup] = React.useState<SetupStatus | null>(null);
  const [connected, setConnected] = React.useState(false);

  React.useEffect(() => {
    api.get<SetupStatus>('/api/setup/status', { quiet: true }).then(setSetup).catch(() => {});
  }, []);

  // Any working account is enough to move on.
  const ready = connected || (ai.ok && ai.provider === settings.ai.provider);

  return (
    <div>
      <StepHeader kicker={kicker} title="Connect the brain.">
        Talaria uses an AI account you already have to read your resume, score jobs and write your applications. Sign in once; Talaria never sees your password.
      </StepHeader>

      <AIConnect onConnected={() => setConnected(true)} />

      {/* 3. Optional extras */}
      <div className="mt-5 space-y-2">
        <div className="text-[12px] font-semibold tracking-[0.08em] text-faint uppercase">Optional extras (you can add these later)</div>
        <Collapsible title={`${setup?.pdflatex ? '✓' : '○'}  LaTeX, to keep your resume's exact design`}>
          <p>If your resume is a LaTeX file (from Overleaf, for example), Talaria can tailor it and keep your exact template. That needs a LaTeX program called MiKTeX. If your resume is a PDF or Word file, skip this.</p>
          {setup?.pdflatex ? <p className="font-medium text-ok">MiKTeX found.</p> : <p>Download it from miktex.org (Windows) or install TeX Live (Mac / Linux), then restart Talaria.</p>}
        </Collapsible>
        <Collapsible title={`${setup?.browser.ok ? '✓' : '○'}  Browser helper, for submitting applications for you`}>
          <p>To fill in and submit application forms, Talaria opens a window of your own browser (Chrome, Edge or Brave) with a separate profile. If you have none of those, it needs a one-time download of about 150 MB.</p>
          {setup?.browser.ok ? (
            <p className="font-medium text-ok">Ready: Talaria found a browser it can use.</p>
          ) : (
            <>
              <p>Run this in the Talaria folder, then restart Talaria:</p>
              <Cmd>npx playwright install chromium</Cmd>
            </>
          )}
        </Collapsible>
      </div>

      {!ready && <p className="mt-5 text-[12.5px] text-faint">Connect an AI account to continue. You can skip it for now, but nothing will work until it's connected.</p>}

      <StepFooter back={back}>
        {!ready && <SkipLink onClick={next} title="Nothing will work until the AI is connected" />}
        <NextButton onClick={next} disabled={!ready} />
      </StepFooter>
    </div>
  );
}
