import * as React from 'react';
import { ArrowLeft, ArrowRight, Sparkles } from 'lucide-react';
import { api } from '@/lib/api';
import { useApp } from '@/lib/store';
import { cn } from '@/lib/utils';
import { Button, Dialog, Kbd } from '@/components/ui';

const SLIDES: { kicker: string; title: string; body: React.ReactNode }[] = [
  {
    kicker: 'Your board',
    title: 'Every job lives on a card.',
    body: (
      <>
        Cards move left to right as an application progresses: <strong>Discovered</strong>, <strong>Hermes is on it</strong>, <strong>Needs you</strong>, <strong>Applied</strong>, then <strong>Interviewing</strong> and <strong>Offer</strong>. You can also drag cards yourself.
      </>
    ),
  },
  {
    kicker: 'Discovered',
    title: 'Start by looking at your matches.',
    body: <>Hermes is searching right now, so the first jobs appear in a minute or two. Open a card to read the job and see how well you fit. If it isn't for you, dismiss it. If it is, hand it to Hermes.</>,
  },
  {
    kicker: 'Needs you',
    title: 'Hermes asks before it writes.',
    body: <>After you hand over a job, Hermes asks a few short questions: why this company, what to lead with, anything your resume doesn't show. Answer, and it drafts a tailored resume and cover letter. Then you refine them together in plain words.</>,
  },
  {
    kicker: 'Applied',
    title: 'You always press the button.',
    body: <>When you're happy, <strong>Finalize</strong> sends the application (on supported sites) or gives you a ready-to-use kit of PDFs and text to paste. Nothing is submitted without your approval.</>,
  },
  {
    kicker: 'Handy to know',
    title: 'Shortcuts, and where to change things.',
    body: (
      <ul className="space-y-1.5">
        <li>
          <Kbd>Ctrl</Kbd> <Kbd>K</Kbd> opens the command palette.
        </li>
        <li>
          <Kbd>n</Kbd> adds a job from a link you found yourself.
        </li>
        <li>
          <Kbd>/</Kbd> filters the board.
        </li>
        <li>Settings changes the AI, autopilot, and the Gmail and LinkedIn connections. You can replay this tour from there.</li>
      </ul>
    ),
  },
];

/** Shown once, right after setup, on top of the board. `force` opens it from Settings. */
export function BoardTour({ force, onClose }: { force?: boolean; onClose?: () => void }) {
  const settings = useApp(s => s.settings);
  const [i, setI] = React.useState(0);
  const [dismissed, setDismissed] = React.useState(false);
  const open = force !== undefined ? force : !dismissed && settings?.toured === false;

  const close = () => {
    setDismissed(true);
    setI(0);
    if (settings?.toured === false) api.put('/api/settings', { toured: true }, { quiet: true }).catch(() => {});
    onClose?.();
  };
  const slide = SLIDES[i];
  const last = i === SLIDES.length - 1;

  return (
    <Dialog open={open} onOpenChange={v => !v && close()} className="max-w-md">
      <div className="text-[12px] font-semibold tracking-[0.1em] text-gold uppercase">{slide.kicker}</div>
      <h2 className="mt-2 font-display text-[24px] leading-[1.1] text-ink">{slide.title}</h2>
      <div className="mt-3 min-h-[120px] text-[14px] leading-relaxed text-muted">{slide.body}</div>

      <div className="mt-6 flex items-center justify-between">
        <div className="flex gap-1.5">
          {SLIDES.map((_, n) => (
            <span key={n} className={cn('h-1.5 rounded-full transition-all', n === i ? 'w-5 bg-ink' : 'w-1.5 bg-ink/20')} />
          ))}
        </div>
        <div className="flex gap-2">
          {i > 0 ? (
            <Button variant="ghost" icon={<ArrowLeft className="size-4" />} onClick={() => setI(i - 1)}>
              Back
            </Button>
          ) : (
            <Button variant="ghost" onClick={close}>
              Skip
            </Button>
          )}
          {last ? (
            <Button variant="primary" icon={<Sparkles className="size-4 text-gold" />} onClick={close}>
              Got it
            </Button>
          ) : (
            <Button variant="primary" icon={<ArrowRight className="size-4" />} className="flex-row-reverse" onClick={() => setI(i + 1)}>
              Next
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  );
}
