import * as React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowUpRight, Check, Download, PartyPopper } from 'lucide-react';
import type { Job } from '@shared/types';
import { jobActions, useApp } from '@/lib/store';
import { cn } from '@/lib/utils';
import { Button, CopyButton, Dialog } from '../ui';

export function ApplyKit({ job, open, onOpenChange }: { job: Job; open: boolean; onOpenChange: (v: boolean) => void }) {
  const profile = useApp(s => s.profile);
  const [opened, setOpened] = React.useState(false);
  const [done, setDone] = React.useState(false);
  React.useEffect(() => {
    if (open) setDone(false);
  }, [open]);

  if (!job.packet) return null;
  const p = job.packet;
  const link = (re: RegExp) => profile?.links.find(l => re.test(l.label) || re.test(l.url))?.url;
  const fields: [string, string | undefined][] = [
    ['Full name', profile?.name],
    ['Email', profile?.email],
    ['Phone', profile?.phone],
    ['Location', profile?.location],
    ['LinkedIn', link(/linkedin/i)],
    ['GitHub', link(/github/i)],
    ['Portfolio', profile?.links.find(l => !/linkedin|github/i.test(l.url))?.url],
  ];
  const qa = [...job.questions.filter(q => q.answer).map(q => ({ question: q.question, answer: q.answer! })), ...p.answers];

  const submit = async () => {
    await jobActions.applied(job.id, 'assisted');
    setDone(true);
    setTimeout(() => onOpenChange(false), 1600);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} className="max-w-2xl" title={done ? undefined : `Apply to ${job.company}`} description={done ? undefined : 'Everything you need, in order. Hermes filled it all in — you just paste and press submit.'}>
      <AnimatePresence mode="wait">
        {done ? (
          <motion.div key="done" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center py-10 text-center">
            <motion.div initial={{ scale: 0, rotate: -20 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', bounce: 0.5 }} className="grid size-16 place-items-center rounded-2xl bg-ok text-white shadow-lift">
              <PartyPopper className="size-8" />
            </motion.div>
            <div className="mt-5 font-display text-[23px] text-ink">Application sent</div>
            <p className="mt-1 text-[13.5px] text-muted">
              {job.title} at {job.company} moved to Applied. Fingers crossed.
            </p>
          </motion.div>
        ) : (
          <motion.div key="kit" className="mt-6 space-y-6">
            <Step n={1} title="Grab your documents">
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" icon={<Download className="size-4" />} onClick={() => (location.href = `/api/jobs/${job.id}/resume.pdf?download=1`)}>
                  Tailored resume (PDF)
                </Button>
                <Button variant="secondary" icon={<Download className="size-4" />} onClick={() => (location.href = `/api/jobs/${job.id}/cover-letter.pdf?download=1`)}>
                  Cover letter (PDF)
                </Button>
                <CopyButton text={p.coverLetter} label="Copy cover letter text" size="md" />
              </div>
            </Step>

            <Step n={2} title="Open the application" done={opened}>
              <Button
                variant="primary"
                icon={<ArrowUpRight className="size-4" />}
                onClick={() => {
                  window.open(job.applyUrl || job.url, '_blank', 'noopener');
                  setOpened(true);
                }}
              >
                Open {job.company}'s application
              </Button>
            </Step>

            <Step n={3} title="Paste these in">
              <div className="overflow-hidden rounded-xl border border-line">
                {fields
                  .filter(([, v]) => v)
                  .map(([k, v]) => (
                    <div key={k} className="flex items-center gap-3 border-b border-line-2 px-3.5 py-2 last:border-0">
                      <span className="w-24 shrink-0 text-[12px] text-muted">{k}</span>
                      <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{v}</span>
                      <CopyButton text={v!} />
                    </div>
                  ))}
              </div>
              {qa.length > 0 && (
                <div className="mt-3 space-y-2">
                  {qa.map((x, i) => (
                    <div key={i} className="rounded-xl border border-line px-3.5 py-2.5">
                      <div className="flex items-start justify-between gap-3">
                        <span className="text-[12.5px] font-medium text-ink-2">{x.question}</span>
                        <CopyButton text={x.answer} />
                      </div>
                      <p className="mt-1 line-clamp-2 text-[12.5px] text-muted">{x.answer}</p>
                    </div>
                  ))}
                </div>
              )}
            </Step>

            <Step n={4} title="Submitted it?" last>
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="gold" size="lg" icon={<Check className="size-4" />} onClick={submit}>
                  Yes — mark as applied
                </Button>
                <span className="text-[12.5px] text-muted">It'll move to Applied and into your summary.</span>
              </div>
            </Step>
          </motion.div>
        )}
      </AnimatePresence>
    </Dialog>
  );
}

function Step({ n, title, children, done, last }: { n: number; title: string; children: React.ReactNode; done?: boolean; last?: boolean }) {
  return (
    <div className="relative flex gap-4">
      {!last && <div className="absolute top-8 bottom-[-20px] left-[13px] w-px bg-line" />}
      <span className={cn('relative grid size-7 shrink-0 place-items-center rounded-full text-[12.5px] font-semibold', done ? 'bg-ok text-white' : 'bg-ink text-bg')}>{done ? <Check className="size-3.5" strokeWidth={3} /> : n}</span>
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="mb-2.5 text-[14px] font-semibold text-ink">{title}</div>
        {children}
      </div>
    </div>
  );
}
