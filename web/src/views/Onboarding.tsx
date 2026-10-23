import * as React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeft, Check, FileText, Sparkles, UploadCloud } from 'lucide-react';
import type { Preferences, Profile, RemotePreference, Seniority } from '@shared/types';
import { api } from '@/lib/api';
import { applyProfileResult, useApp } from '@/lib/store';
import { navigate } from '@/lib/router';
import { cn } from '@/lib/utils';
import { Button, ChipInput, Field, Input, Segmented, Switch, Textarea } from '@/components/ui';
import { Logo } from '@/components/brand';
import { useElapsed } from '@/components/drawer/hooks';
import { SourcesEditor } from '@/views/Profile';
import { ConnectStep, StepHeader, WelcomeStep } from '@/views/OnboardingSetup';

const STEPS = ['Welcome', 'Connect the AI', 'Your resume', 'What you want', 'Where to look'];

export function Onboarding() {
  const profile = useApp(s => s.profile);
  const [step, setStep] = React.useState(profile ? 3 : 0);

  return (
    <div className="grid min-h-full lg:grid-cols-[minmax(340px,0.8fr)_1.2fr]">
      <aside className="relative flex flex-col justify-between overflow-hidden bg-[#121116] p-10 text-[#f2f1f6] max-lg:hidden">
        <div className="pointer-events-none absolute -top-40 -right-40 size-[520px] rounded-full opacity-25 blur-3xl" style={{ background: 'radial-gradient(circle, #e7b04c 0%, transparent 65%)' }} />
        <div className="relative flex items-center gap-2.5">
          <div className="grid size-9 place-items-center rounded-xl bg-white/10">
            <Logo className="size-7" animated />
          </div>
          <span className="font-display text-[20px]">Talaria</span>
        </div>
        <div className="relative">
          <h1 className="font-display text-[40px] leading-[1.02] tracking-[-0.02em]">
            Your job hunt,
            <br />
            <em className="text-[#e7b04c]">with wings.</em>
          </h1>
          <p className="mt-5 max-w-sm text-[15px] leading-relaxed text-white/60">Hermes scouts the boards, tells you honestly where you stand, tailors every application — and always asks before anything goes out.</p>
        </div>
        <ol className="relative space-y-3">
          {STEPS.map((s, i) => (
            <li key={s} className={cn('flex items-center gap-3 text-[14px] transition-colors', i === step ? 'text-white' : i < step ? 'text-white/55' : 'text-white/30')}>
              <span className={cn('grid size-6 place-items-center rounded-full text-[11.5px] font-semibold', i < step ? 'bg-[#e7b04c] text-[#121116]' : i === step ? 'bg-white text-[#121116]' : 'border border-white/20')}>{i < step ? <Check className="size-3.5" strokeWidth={3} /> : i + 1}</span>
              {s}
            </li>
          ))}
        </ol>
      </aside>

      <main className="flex min-h-full items-center justify-center px-6 py-12">
        <div className="w-full max-w-[620px]">
          <AnimatePresence mode="wait">
            <motion.div key={step} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}>
              {step === 0 && <WelcomeStep next={() => setStep(1)} />}
              {step === 1 && <ConnectStep next={() => setStep(2)} back={() => setStep(0)} />}
              {step === 2 && <ResumeStep next={() => setStep(3)} back={() => setStep(1)} />}
              {step === 3 && <PrefsStep next={() => setStep(4)} back={() => setStep(2)} />}
              {step === 4 && <LaunchStep back={() => setStep(3)} />}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}

// ---------------- 1. Resume ----------------

function ResumeStep({ next, back }: { next: () => void; back: () => void }) {
  const [busy, setBusy] = React.useState<null | { name: string; at: string }>(null);
  const [paste, setPaste] = React.useState(false);
  const [text, setText] = React.useState('');
  const [drag, setDrag] = React.useState(false);
  const input = React.useRef<HTMLInputElement>(null);
  const elapsed = useElapsed(busy?.at, Boolean(busy));

  const send = async (body: FormData | { text: string }, name: string) => {
    setBusy({ name, at: new Date().toISOString() });
    try {
      applyProfileResult(await api.post<{ profile: Profile; preferences: Preferences }>('/api/resume', body));
      next();
    } catch {
      setBusy(null);
    }
  };
  const onFile = (f?: File | null) => {
    if (!f) return;
    const fd = new FormData();
    fd.append('file', f);
    send(fd, f.name);
  };

  const lines = ['Reading every line', 'Pulling out your experience', 'Cataloguing your skills', 'Working out which roles fit you best', 'Almost there'];

  if (busy) {
    return (
      <div>
        <StepHeader kicker="Step 2 · Your resume" title="Hermes is reading your resume." />
        <div className="agent-sheen overflow-hidden rounded-2xl border border-gold/20 bg-gold-soft/40 p-6">
          <div className="flex items-center gap-4">
            <div className="grid size-12 place-items-center rounded-xl bg-card shadow-card">
              <FileText className="size-5 text-gold" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold text-ink">{busy.name}</div>
              <motion.div key={Math.min(lines.length - 1, Math.floor(elapsed / 7))} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="text-[13px] text-muted">
                {lines[Math.min(lines.length - 1, Math.floor(elapsed / 7))]}…
              </motion.div>
            </div>
            <span className="text-[13px] text-faint tabular-nums">{elapsed}s</span>
          </div>
          <div className="mt-5 space-y-2.5">
            {[92, 78, 85, 60].map((w, i) => (
              <div key={i} className="skeleton h-3" style={{ width: `${w}%`, animationDelay: `${i * 0.15}s` }} />
            ))}
          </div>
        </div>
        <p className="mt-4 text-[12.5px] text-faint">Usually 20–40 seconds. Your resume stays on this computer; only the text goes to your model provider via Hermes.</p>
      </div>
    );
  }

  return (
    <div>
      <StepHeader kicker="Step 2 · Your resume" title="Show Hermes who you are.">
        Your resume is the source of truth. Hermes builds your profile from it and never invents experience you don't have. Upload your LaTeX source and every tailored resume keeps your exact template.
      </StepHeader>

      {!paste ? (
        <button
          type="button"
          onClick={() => input.current?.click()}
          onDragOver={e => (e.preventDefault(), setDrag(true))}
          onDragLeave={() => setDrag(false)}
          onDrop={e => {
            e.preventDefault();
            setDrag(false);
            onFile(e.dataTransfer.files?.[0]);
          }}
          className={cn('group flex w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-14 text-center transition-all', drag ? 'scale-[1.01] border-accent bg-accent-soft' : 'border-line bg-card hover:border-ink/25')}
        >
          <div className={cn('grid size-14 place-items-center rounded-2xl transition-colors', drag ? 'bg-accent text-white' : 'bg-ink text-bg group-hover:scale-105')}>
            <UploadCloud className="size-6" />
          </div>
          <div className="mt-4 text-[16px] font-semibold text-ink">Drop your resume here</div>
          <div className="mt-1 text-[13.5px] text-muted">or click to browse · LaTeX (.tex / Overleaf .zip), PDF, DOCX or TXT</div>
          <input ref={input} type="file" accept=".pdf,.docx,.txt,.md,.tex,.zip" className="hidden" onChange={e => onFile(e.target.files?.[0])} />
        </button>
      ) : (
        <Textarea value={text} onChange={e => setText(e.target.value)} autoFocus placeholder="Paste the full text of your resume…" className="min-h-[260px] bg-card text-[13px]" />
      )}

      <div className="mt-8 flex items-center justify-between">
        <Button variant="ghost" icon={<ArrowLeft className="size-4" />} onClick={back}>
          Back
        </Button>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => setPaste(p => !p)}>
            {paste ? 'Upload a file instead' : 'Paste text instead'}
          </Button>
          {paste && (
            <Button variant="primary" size="lg" disabled={text.trim().length < 80} onClick={() => send({ text }, 'Pasted resume')}>
              Read my resume
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------- 2. Preferences ----------------

const SENIORITY: { value: Seniority; label: string }[] = [
  { value: 'intern', label: 'Internship' },
  { value: 'entry', label: 'Entry / new grad' },
  { value: 'mid', label: 'Mid-level' },
  { value: 'senior', label: 'Senior' },
  { value: 'lead', label: 'Lead / staff' },
];

export function PreferencesForm({ prefs, onChange }: { prefs: Preferences; onChange: (p: Partial<Preferences>) => void }) {
  return (
    <div className="space-y-5">
      <Field label="Roles you're targeting" hint="Hermes suggested these from your resume — edit freely. Press Enter to add.">
        <ChipInput value={prefs.roles} onChange={roles => onChange({ roles })} placeholder="e.g. Frontend Engineer" suggestions={['Software Engineer', 'Frontend Engineer', 'Backend Engineer', 'Full Stack Engineer', 'Data Analyst', 'ML Engineer'].filter(s => !prefs.roles.length || prefs.roles.length < 6)} />
      </Field>
      <Field label="Seniority">
        <div className="flex flex-wrap gap-1.5">
          {SENIORITY.map(s => {
            const on = prefs.seniority.includes(s.value);
            return (
              <button
                key={s.value}
                type="button"
                onClick={() => onChange({ seniority: on ? prefs.seniority.filter(x => x !== s.value) : [...prefs.seniority, s.value] })}
                className={cn('h-8 rounded-lg border px-3 text-[13px] font-medium transition-colors', on ? 'border-ink bg-ink text-bg' : 'border-line bg-card text-ink-2 hover:border-ink/30')}
              >
                {s.label}
              </button>
            );
          })}
        </div>
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Locations" hint="Cities or countries. Remote roles are always considered.">
          <ChipInput value={prefs.locations} onChange={locations => onChange({ locations })} placeholder="e.g. Bengaluru, India" />
        </Field>
        <Field label="Work mode">
          <Segmented<RemotePreference>
            value={prefs.remote}
            onChange={remote => onChange({ remote })}
            size="sm"
            options={[
              { value: 'any', label: 'Any' },
              { value: 'remote_or_hybrid', label: 'Remote/hybrid' },
              { value: 'remote_only', label: 'Remote' },
              { value: 'onsite', label: 'On-site' },
            ]}
          />
        </Field>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Need visa sponsorship?">
          <Segmented
            value={prefs.needsSponsorship == null ? 'skip' : prefs.needsSponsorship ? 'yes' : 'no'}
            onChange={v => onChange({ needsSponsorship: v === 'skip' ? null : v === 'yes' })}
            size="sm"
            options={[
              { value: 'no', label: 'No' },
              { value: 'yes', label: 'Yes' },
              { value: 'skip', label: 'Depends' },
            ]}
          />
        </Field>
        <Field label="Minimum salary (optional)">
          <div className="flex gap-2">
            <Input type="number" min={0} value={prefs.minSalary ?? ''} onChange={e => onChange({ minSalary: e.target.value ? Number(e.target.value) : null })} placeholder="e.g. 1200000" />
            <select value={prefs.currency || 'USD'} onChange={e => onChange({ currency: e.target.value })} className="h-9 rounded-lg border border-line bg-card px-2 text-[13px] text-ink outline-none">
              {['USD', 'INR', 'EUR', 'GBP', 'CAD', 'AUD', 'SGD'].map(c => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
        </Field>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Topics you'd love" hint="Boosts matching roles.">
          <ChipInput value={prefs.includeKeywords} onChange={includeKeywords => onChange({ includeKeywords })} placeholder="e.g. fintech, React" />
        </Field>
        <Field label="Deal-breakers" hint="Jobs mentioning these are skipped.">
          <ChipInput value={prefs.excludeKeywords} onChange={excludeKeywords => onChange({ excludeKeywords })} placeholder="e.g. crypto, unpaid" />
        </Field>
      </div>
    </div>
  );
}

function PrefsStep({ next, back }: { next: () => void; back: () => void }) {
  const profile = useApp(s => s.profile) as Profile;
  const stored = useApp(s => s.preferences)!;
  const [prefs, setPrefs] = React.useState(stored);
  const [saving, setSaving] = React.useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await api.put('/api/preferences', prefs);
      next();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <StepHeader kicker="Step 3 · Preferences" title={<>Nice to meet you{profile?.name ? `, ${profile.name.split(' ')[0]}` : ''}.</>}>
        Here's what Hermes took from your resume. Tell it what you're after.
      </StepHeader>

      {profile && (
        <div className="mb-8 rounded-2xl bg-card p-5 shadow-card">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-[17px] font-semibold text-ink">{profile.name}</div>
              <div className="text-[13.5px] text-muted">{profile.headline}</div>
            </div>
            <div className="flex gap-4 text-center">
              {[
                [profile.experience.length, 'roles'],
                [profile.projects.length, 'projects'],
                [profile.skills.length, 'skills'],
              ].map(([n, l]) => (
                <div key={l as string}>
                  <div className="font-display text-[20px] leading-none text-ink">{n}</div>
                  <div className="mt-1 text-[11px] text-faint">{l}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-1.5">
            {profile.skills.slice(0, 16).map(s => (
              <span key={s} className="rounded-md bg-ink/[0.05] px-2 py-0.5 text-[12px] text-ink-2 dark:bg-white/[0.07]">
                {s}
              </span>
            ))}
            {profile.skills.length > 16 && <span className="px-1 py-0.5 text-[12px] text-faint">+{profile.skills.length - 16} more</span>}
          </div>
        </div>
      )}

      <PreferencesForm prefs={prefs} onChange={p => setPrefs(x => ({ ...x, ...p }))} />

      <div className="mt-8 flex items-center justify-between">
        <Button variant="ghost" icon={<ArrowLeft className="size-4" />} onClick={back}>
          Re-upload resume
        </Button>
        <Button variant="primary" size="lg" loading={saving} disabled={!prefs.roles.length} onClick={save}>
          Looks right
        </Button>
      </div>
    </div>
  );
}

// ---------------- 3. Launch ----------------

function LaunchStep({ back }: { back: () => void }) {
  const stored = useApp(s => s.preferences)!;
  const settings = useApp(s => s.settings)!;
  const [prefs, setPrefs] = React.useState(stored);
  const [autopilot, setAutopilot] = React.useState(true);
  const [busy, setBusy] = React.useState(false);

  const go = async () => {
    setBusy(true);
    try {
      await api.put('/api/preferences', prefs);
      await api.put('/api/settings', { onboarded: true, toured: false, autopilot: { ...settings.autopilot, enabled: autopilot } });
      navigate({ view: 'board' }, true);
      await api.post('/api/scout');
    } catch {
      setBusy(false);
    }
  };

  return (
    <div>
      <StepHeader kicker="Step 4 · Sources" title="Where should Hermes look?">
        Public job boards and company career pages — no logins, no scraping of sites that forbid it.
      </StepHeader>

      <SourcesEditor prefs={prefs} onChange={p => setPrefs(x => ({ ...x, ...p, sources: { ...x.sources, ...(p.sources || {}) } }))} />

      <div className="mt-6 flex items-center justify-between gap-4 rounded-2xl bg-card p-4 shadow-card">
        <div>
          <div className="text-[14px] font-semibold text-ink">Autopilot</div>
          <div className="text-[12.5px] text-muted">Search for new matches every {settings.autopilot.scoutEveryHours} hours while Talaria is running, and pre-analyze the promising ones.</div>
        </div>
        <Switch checked={autopilot} onChange={setAutopilot} label="Autopilot" />
      </div>

      <div className="mt-8 flex items-center justify-between">
        <Button variant="ghost" icon={<ArrowLeft className="size-4" />} onClick={back}>
          Back
        </Button>
        <Button variant="primary" size="lg" loading={busy} icon={<Sparkles className="size-4 text-gold" />} onClick={go}>
          Start the hunt
        </Button>
      </div>
    </div>
  );
}
