import * as React from 'react';
import { Link2, Sparkles } from 'lucide-react';
import type { Job } from '@shared/types';
import { Button, Dialog, Field, Input, Segmented, Textarea } from './ui';
import { api } from '@/lib/api';
import { openJob } from '@/lib/router';
import { toast } from 'sonner';

export function AddJobDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [mode, setMode] = React.useState<'link' | 'paste'>('link');
  const [url, setUrl] = React.useState('');
  const [title, setTitle] = React.useState('');
  const [company, setCompany] = React.useState('');
  const [location, setLocation] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!open) {
      setUrl('');
      setTitle('');
      setCompany('');
      setLocation('');
      setDescription('');
      setBusy(false);
    }
  }, [open]);

  const isAts = /greenhouse\.io|jobs\.lever\.co|jobs\.ashbyhq\.com/.test(url);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const job = await api.post<Job>('/api/jobs', mode === 'link' ? { url: url.trim() } : { url: url.trim() || undefined, title, company, location, description });
      toast.success(`Added ${job.title} at ${job.company}`);
      onOpenChange(false);
      openJob(job.id);
    } catch {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Add a job" description="Found something yourself? Drop it on the board and Hermes will analyze your fit right away.">
      <form onSubmit={submit} className="mt-5 space-y-4">
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: 'link', label: 'From a link' },
            { value: 'paste', label: 'Paste details' },
          ]}
        />
        {mode === 'link' ? (
          <Field
            label="Job posting URL"
            hint={
              url && !isAts ? (
                <span className="inline-flex items-center gap-1.5">
                  <Sparkles className="size-3.5 text-gold" /> Hermes will open the page and read the posting — takes ~30 seconds.
                </span>
              ) : (
                'Greenhouse, Lever and Ashby links import instantly. Any other page is read by Hermes.'
              )
            }
          >
            <div className="relative">
              <Link2 className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
              <Input autoFocus required type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://jobs.lever.co/…" className="pl-9" />
            </div>
          </Field>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Job title">
                <Input autoFocus required value={title} onChange={e => setTitle(e.target.value)} placeholder="Frontend Engineer" />
              </Field>
              <Field label="Company">
                <Input required value={company} onChange={e => setCompany(e.target.value)} placeholder="Acme" />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Location">
                <Input value={location} onChange={e => setLocation(e.target.value)} placeholder="Remote · Bengaluru" />
              </Field>
              <Field label="Link (optional)">
                <Input type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://…" />
              </Field>
            </div>
            <Field label="Job description">
              <Textarea required value={description} onChange={e => setDescription(e.target.value)} placeholder="Paste the full posting — responsibilities, requirements, everything." className="min-h-[160px]" />
            </Field>
          </>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={busy}>
            {busy && mode === 'link' && !isAts ? 'Hermes is reading…' : 'Add to board'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
