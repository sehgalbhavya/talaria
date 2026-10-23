import * as React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { BookmarkCheck, Check, ChevronDown, FileText, Globe, Loader2, Plus, Save, Sparkles, Trash2, UploadCloud, X } from 'lucide-react';
import type { AnswerBankItem, ExperienceItem, Preferences, Profile, SourceId, TargetCompany } from '@shared/types';
import { api } from '@/lib/api';
import { useApp } from '@/lib/store';
import { cn, timeAgo } from '@/lib/utils';
import { Badge, Button, Card, ChipInput, Dialog, EmptyState, Field, Input, SectionTitle, Segmented, Switch, Textarea } from '@/components/ui';
import { PreferencesForm } from './Onboarding';
import { toast } from 'sonner';

type Tab = 'profile' | 'preferences' | 'sources' | 'answers';

export function ProfileView() {
  const [tab, setTab] = React.useState<Tab>('profile');
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="px-7 pt-6 pb-5">
        <h1 className="font-display text-[27px] leading-none tracking-[-0.015em] text-ink">Profile & preferences</h1>
        <p className="mt-2 text-[13.5px] text-muted">Everything Hermes knows about you. Better inputs, better matches.</p>
        <Segmented
          className="mt-5"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'profile', label: 'Profile' },
            { value: 'preferences', label: 'Job preferences' },
            { value: 'sources', label: 'Sources' },
            { value: 'answers', label: 'Remembered answers' },
          ]}
        />
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-7 pb-24">
        <div className="max-w-[860px]">
          {tab === 'profile' && <ProfileEditor />}
          {tab === 'preferences' && <PreferencesTab />}
          {tab === 'sources' && <SourcesTab />}
          {tab === 'answers' && <AnswerBank />}
        </div>
      </div>
    </div>
  );
}

// ---------------- save bar ----------------

function SaveBar({ dirty, saving, onSave, onReset }: { dirty: boolean; saving: boolean; onSave: () => void; onReset: () => void }) {
  return (
    <AnimatePresence>
      {dirty && (
        <motion.div initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }} className="fixed bottom-6 left-1/2 z-30 -translate-x-1/2">
          <div className="flex items-center gap-3 rounded-2xl bg-ink py-2 pr-2 pl-4 text-bg shadow-pop">
            <span className="text-[13px]">Unsaved changes</span>
            <Button size="sm" variant="ghost" className="text-bg/70 hover:bg-white/10 hover:text-bg" onClick={onReset}>
              Discard
            </Button>
            <Button size="sm" variant="gold" loading={saving} icon={<Save className="size-3.5" />} onClick={onSave}>
              Save
            </Button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ---------------- profile ----------------

function ProfileEditor() {
  const stored = useApp(s => s.profile)!;
  const [p, setP] = React.useState<Profile>(stored);
  const [saving, setSaving] = React.useState(false);
  const [showText, setShowText] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => setP(stored), [stored]);
  const dirty = JSON.stringify(p) !== JSON.stringify(stored);
  const up = (patch: Partial<Profile>) => setP(x => ({ ...x, ...patch }));

  const save = async () => {
    setSaving(true);
    try {
      await api.put('/api/profile', p);
      toast.success('Profile saved');
    } finally {
      setSaving(false);
    }
  };

  const replace = async (f?: File | null) => {
    if (!f) return;
    if (!confirm('Replace your resume? Hermes will rebuild your profile from the new file (your preferences stay).')) return;
    const fd = new FormData();
    fd.append('file', f);
    setUploading(true);
    try {
      await api.post('/api/resume', fd);
      toast.success('Resume updated — profile rebuilt');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-8">
      <Card className="flex items-center gap-4 p-4">
        <div className="grid size-11 place-items-center rounded-xl bg-accent-soft text-accent">{uploading ? <Loader2 className="size-5 animate-spin" /> : <FileText className="size-5" />}</div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 truncate text-[14px] font-semibold text-ink">
            {uploading ? 'Hermes is reading your new resume…' : stored.resumeFileName || 'Pasted resume'}
            {stored.latexSource && !uploading && <Badge tone="accent">LaTeX template</Badge>}
          </div>
          <div className="text-[12.5px] text-muted">
            {stored.latexSource ? 'Every tailored resume is rendered in your own template. ' : ''}Profile last updated {timeAgo(stored.updatedAt, false)}
          </div>
        </div>
        {stored.latexSource && (
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              const id = toast.loading('Compiling your template with pdfLaTeX…');
              try {
                const r = await api.post<{ ok: boolean; pages?: number; error?: string }>('/api/latex/test');
                if (r.ok) toast.success(`Compiles fine — ${r.pages} page${r.pages === 1 ? '' : 's'}`, { id });
                else toast.error(`Doesn't compile: ${r.error?.split('\n')[0] || 'pdflatex not installed'}`, { id });
              } catch {
                toast.dismiss(id);
              }
            }}
          >
            Test compile
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={() => setShowText(true)}>
          View text
        </Button>
        <Button variant="secondary" size="sm" icon={<UploadCloud className="size-3.5" />} onClick={() => fileRef.current?.click()} disabled={uploading}>
          Replace resume
        </Button>
        <input ref={fileRef} type="file" accept=".pdf,.docx,.txt,.md,.tex,.zip" className="hidden" onChange={e => replace(e.target.files?.[0])} />
      </Card>

      <section>
        <SectionTitle>Your story</SectionTitle>
        <Card className="space-y-3 p-5">
          <p className="text-[12.5px] leading-relaxed text-muted">
            Your cover letters are built from this, not from your resume. Write it like you'd talk: who you are outside work, what you make or do for fun, what you care about, why you
            do this work, moments that shaped you, products you love using. Hermes never invents anything here, so the more real detail you give, the more personal every letter gets.
          </p>
          <Textarea
            value={p.story || ''}
            onChange={e => up({ story: e.target.value })}
            rows={9}
            placeholder="e.g. I grew up taking apart radios with my dad, which is still how I learn things: by building them. On weekends I make small music toys in Unity and play board games with friends (that's where Deed & Dice came from)…"
          />
          <div className="flex justify-between text-[11.5px] text-faint">
            <span>Kept when you replace your resume. Saved with the Save button below.</span>
            <span>{(p.story || '').trim().split(/\s+/).filter(Boolean).length} words</span>
          </div>
        </Card>
      </section>

      <section>
        <SectionTitle>Basics</SectionTitle>
        <Card className="space-y-4 p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name">
              <Input value={p.name} onChange={e => up({ name: e.target.value })} />
            </Field>
            <Field label="Headline">
              <Input value={p.headline} onChange={e => up({ headline: e.target.value })} />
            </Field>
            <Field label="Email">
              <Input type="email" value={p.email} onChange={e => up({ email: e.target.value })} />
            </Field>
            <Field label="Phone">
              <Input value={p.phone} onChange={e => up({ phone: e.target.value })} />
            </Field>
            <Field label="Location">
              <Input value={p.location} onChange={e => up({ location: e.target.value })} />
            </Field>
            <Field label="Years of professional experience">
              <Input type="number" min={0} value={p.yearsExperience ?? ''} onChange={e => up({ yearsExperience: e.target.value === '' ? undefined : Number(e.target.value) })} />
            </Field>
          </div>
          <Field label="Summary">
            <Textarea value={p.summary} onChange={e => up({ summary: e.target.value })} />
          </Field>
          <Field label="Links">
            <div className="space-y-2">
              {p.links.map((l, i) => (
                <div key={i} className="flex gap-2">
                  <Input className="w-36" value={l.label} onChange={e => up({ links: p.links.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} placeholder="Label" />
                  <Input value={l.url} onChange={e => up({ links: p.links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)) })} placeholder="https://" />
                  <Button variant="ghost" size="md" aria-label="Remove link" onClick={() => up({ links: p.links.filter((_, j) => j !== i) })}>
                    <X className="size-4" />
                  </Button>
                </div>
              ))}
              <Button variant="ghost" size="sm" icon={<Plus className="size-3.5" />} onClick={() => up({ links: [...p.links, { label: '', url: '' }] })}>
                Add link
              </Button>
            </div>
          </Field>
          <Field label="Skills" hint="Order matters — put your strongest first.">
            <ChipInput value={p.skills} onChange={skills => up({ skills })} placeholder="Add a skill" />
          </Field>
        </Card>
      </section>

      <section>
        <SectionTitle
          action={
            <Button variant="ghost" size="xs" icon={<Plus className="size-3" />} onClick={() => up({ experience: [{ company: '', title: '', start: '', end: '', bullets: [] }, ...p.experience] })}>
              Add role
            </Button>
          }
        >
          Experience
        </SectionTitle>
        <div className="space-y-2.5">
          {p.experience.map((e, i) => (
            <EntryEditor
              key={i}
              title={e.title || 'New role'}
              subtitle={[e.company, [e.start, e.end].filter(Boolean).join(' – ')].filter(Boolean).join(' · ')}
              onRemove={() => up({ experience: p.experience.filter((_, j) => j !== i) })}
            >
              <ExperienceFields value={e} onChange={v => up({ experience: p.experience.map((x, j) => (j === i ? v : x)) })} />
            </EntryEditor>
          ))}
        </div>
      </section>

      <section>
        <SectionTitle
          action={
            <Button variant="ghost" size="xs" icon={<Plus className="size-3" />} onClick={() => up({ projects: [{ name: '', bullets: [], tech: [] }, ...p.projects] })}>
              Add project
            </Button>
          }
        >
          Projects
        </SectionTitle>
        <div className="space-y-2.5">
          {p.projects.map((pr, i) => (
            <EntryEditor key={i} title={pr.name || 'New project'} subtitle={pr.tech?.join(', ')} onRemove={() => up({ projects: p.projects.filter((_, j) => j !== i) })}>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Name">
                  <Input value={pr.name} onChange={e => up({ projects: p.projects.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
                </Field>
                <Field label="Link">
                  <Input value={pr.link || ''} onChange={e => up({ projects: p.projects.map((x, j) => (j === i ? { ...x, link: e.target.value } : x)) })} />
                </Field>
              </div>
              <Field label="Tech" className="mt-3">
                <ChipInput value={pr.tech || []} onChange={tech => up({ projects: p.projects.map((x, j) => (j === i ? { ...x, tech } : x)) })} />
              </Field>
              <BulletsField value={pr.bullets} onChange={bullets => up({ projects: p.projects.map((x, j) => (j === i ? { ...x, bullets } : x)) })} />
            </EntryEditor>
          ))}
        </div>
      </section>

      <section>
        <SectionTitle
          action={
            <Button variant="ghost" size="xs" icon={<Plus className="size-3" />} onClick={() => up({ education: [...p.education, { school: '', degree: '', field: '' }] })}>
              Add
            </Button>
          }
        >
          Education
        </SectionTitle>
        <div className="space-y-2.5">
          {p.education.map((ed, i) => (
            <EntryEditor key={i} title={ed.school || 'New entry'} subtitle={[ed.degree, ed.field].filter(Boolean).join(', ')} onRemove={() => up({ education: p.education.filter((_, j) => j !== i) })}>
              <div className="grid gap-3 sm:grid-cols-2">
                {(['school', 'degree', 'field', 'start', 'end', 'details'] as const).map(k => (
                  <Field key={k} label={k[0].toUpperCase() + k.slice(1)}>
                    <Input value={ed[k] || ''} onChange={e => up({ education: p.education.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)) })} />
                  </Field>
                ))}
              </div>
            </EntryEditor>
          ))}
        </div>
      </section>

      <SaveBar dirty={dirty} saving={saving} onSave={save} onReset={() => setP(stored)} />
      <Dialog open={showText} onOpenChange={setShowText} title="Extracted resume text" description="This is exactly what Hermes reads." className="max-w-2xl">
        <pre className="mt-4 max-h-[60vh] overflow-auto rounded-xl bg-panel p-4 font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-ink-2">{stored.resumeText}</pre>
      </Dialog>
    </div>
  );
}

function EntryEditor({ title, subtitle, children, onRemove }: { title: string; subtitle?: string; children: React.ReactNode; onRemove: () => void }) {
  const [open, setOpen] = React.useState(false);
  return (
    <Card className="overflow-hidden">
      <button onClick={() => setOpen(o => !o)} className="flex w-full items-center gap-3 px-4 py-3 text-left">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-semibold text-ink">{title}</div>
          {subtitle && <div className="truncate text-[12.5px] text-muted">{subtitle}</div>}
        </div>
        <ChevronDown className={cn('size-4 text-faint transition-transform', open && 'rotate-180')} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
            <div className="border-t border-line-2 p-4">
              {children}
              <div className="mt-4 flex justify-end">
                <Button variant="ghost" size="xs" className="text-bad hover:bg-bad-soft hover:text-bad" icon={<Trash2 className="size-3" />} onClick={onRemove}>
                  Remove
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}

function ExperienceFields({ value: e, onChange }: { value: ExperienceItem; onChange: (v: ExperienceItem) => void }) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Title">
          <Input value={e.title} onChange={x => onChange({ ...e, title: x.target.value })} />
        </Field>
        <Field label="Company">
          <Input value={e.company} onChange={x => onChange({ ...e, company: x.target.value })} />
        </Field>
        <Field label="Start">
          <Input value={e.start || ''} onChange={x => onChange({ ...e, start: x.target.value })} placeholder="Jun 2024" />
        </Field>
        <Field label="End">
          <Input value={e.end || ''} onChange={x => onChange({ ...e, end: x.target.value })} placeholder="Present" />
        </Field>
      </div>
      <BulletsField value={e.bullets} onChange={bullets => onChange({ ...e, bullets })} />
    </>
  );
}

function BulletsField({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [text, setText] = React.useState(value.join('\n'));
  React.useEffect(() => setText(value.join('\n')), [value.join('\n')]);
  return (
    <Field label="Bullet points" hint="One per line." className="mt-3">
      <Textarea
        value={text}
        onChange={e => setText(e.target.value)}
        onBlur={() =>
          onChange(
            text
              .split('\n')
              .map(s => s.replace(/^[•\-*]\s*/, '').trim())
              .filter(Boolean),
          )
        }
        className="min-h-[110px] text-[13px]"
      />
    </Field>
  );
}

// ---------------- preferences ----------------

function PreferencesTab() {
  const stored = useApp(s => s.preferences)!;
  const [prefs, setPrefs] = React.useState(stored);
  const [saving, setSaving] = React.useState(false);
  React.useEffect(() => setPrefs(stored), [stored]);
  const dirty = JSON.stringify(prefs) !== JSON.stringify(stored);
  const save = async () => {
    setSaving(true);
    try {
      await api.put('/api/preferences', prefs);
      toast.success('Preferences saved — they apply to the next search');
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="space-y-6">
      <Card className="p-6">
        <PreferencesForm prefs={prefs} onChange={p => setPrefs(x => ({ ...x, ...p }))} />
        <div className="mt-5 border-t border-line-2 pt-5">
          <Field label="Hide postings older than" hint="Stale postings are usually filled already.">
            <Segmented
              size="sm"
              value={String(prefs.maxAgeDays)}
              onChange={v => setPrefs(x => ({ ...x, maxAgeDays: Number(v) }))}
              options={[
                { value: '7', label: '1 week' },
                { value: '14', label: '2 weeks' },
                { value: '30', label: '1 month' },
                { value: '60', label: '2 months' },
              ]}
            />
          </Field>
          <Field label="Companies to skip" className="mt-5">
            <ChipInput value={prefs.excludeCompanies} onChange={excludeCompanies => setPrefs(x => ({ ...x, excludeCompanies }))} placeholder="e.g. current employer" />
          </Field>
        </div>
      </Card>
      <SaveBar dirty={dirty} saving={saving} onSave={save} onReset={() => setPrefs(stored)} />
    </div>
  );
}

// ---------------- sources ----------------

const BOARDS: { id: SourceId; name: string; desc: string }[] = [
  { id: 'hermes_web', name: 'Hermes web search', desc: "Hermes searches the open web: companies' own career sites, Workday, Greenhouse, Lever and more." },
  { id: 'remotive', name: 'Remotive', desc: 'Curated remote tech jobs.' },
  { id: 'remoteok', name: 'Remote OK', desc: 'Large feed of remote roles worldwide.' },
  { id: 'himalayas', name: 'Himalayas', desc: 'Remote jobs with salary data.' },
  { id: 'jobicy', name: 'Jobicy', desc: 'Remote roles across many fields.' },
  { id: 'themuse', name: 'The Muse', desc: 'Jobs filtered by your locations and level.' },
  { id: 'arbeitnow', name: 'Arbeitnow', desc: 'Germany & EU roles, many with visa sponsorship.' },
];

const PLATFORM: Record<TargetCompany['ats'], string> = {
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  ashby: 'Ashby',
  workday: 'Workday',
  workable: 'Workable',
  smartrecruiters: 'SmartRecruiters',
  recruitee: 'Recruitee',
  site: 'Own website',
};

type Suggestion = { name: string; url: string; why: string };

export function SourcesEditor({ prefs, onChange }: { prefs: Preferences; onChange: (p: Partial<Preferences>) => void }) {
  const [input, setInput] = React.useState('');
  const [adding, setAdding] = React.useState<string | null>(null);
  const [suggesting, setSuggesting] = React.useState(false);
  const [suggestions, setSuggestions] = React.useState<Suggestion[]>([]);
  const toggle = (id: SourceId, v: boolean) => onChange({ sources: { ...prefs.sources, [id]: v } });

  // Talaria looks the company up (which platform, how many open jobs); you still press Save.
  const add = async (text: string, name?: string) => {
    if (!text.trim()) return;
    setAdding(name || text);
    try {
      const r = await api.post<{ company: TargetCompany; count: number; platform: string }>('/api/preferences/resolve-company', { input: text, name });
      const c = r.company;
      onChange({ targetCompanies: [...prefs.targetCompanies.filter(x => !(x.ats === c.ats && x.slug === c.slug)), c] });
      setSuggestions(s => s.filter(x => x.name !== name));
      toast.success(
        c.ats === 'site'
          ? `${c.name}: their own careers site. ${r.count ? `${r.count} jobs listed on the page; ` : ''}Hermes also searches it for your roles.`
          : `${c.name}: ${r.platform}, ${r.count} open roles`,
      );
      setInput('');
    } finally {
      setAdding(null);
    }
  };

  const suggest = async () => {
    setSuggesting(true);
    try {
      const r = await api.post<{ companies: Suggestion[] }>('/api/preferences/suggest-companies');
      setSuggestions(r.companies);
      if (!r.companies.length) toast('Hermes found no new companies this time');
    } finally {
      setSuggesting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-2 sm:grid-cols-2">
        {BOARDS.map(b => (
          <label key={b.id} className={cn('flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition-colors', prefs.sources[b.id] ? 'border-line bg-card shadow-card' : 'border-dashed border-line')}>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-[13.5px] font-semibold text-ink">
                {b.id === 'hermes_web' && <Globe className="size-3.5 text-gold" />}
                {b.name}
              </div>
              <div className="mt-0.5 text-[12px] leading-snug text-muted">{b.desc}</div>
            </div>
            <Switch checked={Boolean(prefs.sources[b.id])} onChange={v => toggle(b.id, v)} label={b.name} />
          </label>
        ))}
      </div>

      <div className="rounded-2xl bg-card p-5 shadow-card">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[14px] font-semibold text-ink">Companies to watch</div>
            <div className="mt-0.5 max-w-xl text-[12.5px] leading-relaxed text-muted">
              Add any company by name or by the link to its jobs page. Talaria finds where it posts: Greenhouse, Lever, Ashby, Workday, Workable, SmartRecruiters, Recruitee, or its own careers website, which Hermes searches for your roles.
            </div>
          </div>
          <Button variant="secondary" size="sm" loading={suggesting} icon={<Sparkles className="size-3.5 text-gold" />} onClick={suggest}>
            Suggest companies
          </Button>
        </div>

        {suggestions.length > 0 && (
          <div className="mt-4 overflow-hidden rounded-xl border border-gold/20 bg-gold-soft/30">
            <div className="flex items-center justify-between border-b border-gold/15 px-3.5 py-2 text-[12px] font-semibold text-gold">
              Hermes suggests
              <button onClick={() => setSuggestions([])} className="font-medium text-muted hover:text-ink">
                Dismiss
              </button>
            </div>
            {suggestions.map(sg => (
              <div key={sg.name} className="flex items-center gap-3 border-b border-gold/10 px-3.5 py-2.5 last:border-0">
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold text-ink">
                    {sg.name}{' '}
                    <a href={sg.url} target="_blank" rel="noopener noreferrer" className="ml-1 text-[11.5px] font-normal text-accent hover:underline">
                      careers page
                    </a>
                  </div>
                  <div className="text-[12px] leading-snug text-muted">{sg.why}</div>
                </div>
                <Button size="sm" variant="secondary" loading={adding === sg.name} disabled={Boolean(adding)} icon={<Plus className="size-3.5" />} onClick={() => add(sg.url, sg.name)}>
                  Add
                </Button>
              </div>
            ))}
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-1.5">
          {prefs.targetCompanies.map(c => (
            <span key={`${c.ats}:${c.slug}`} title={c.url || undefined} className="inline-flex h-7 items-center gap-1.5 rounded-lg bg-ink/[0.05] pr-1 pl-2.5 text-[12.5px] font-medium text-ink-2 dark:bg-white/[0.07]">
              {c.ats === 'site' && <Globe className="size-3 text-faint" />}
              {c.name}
              <span className="text-[11px] font-normal text-faint">{PLATFORM[c.ats] || c.ats}</span>
              <button aria-label={`Remove ${c.name}`} onClick={() => onChange({ targetCompanies: prefs.targetCompanies.filter(x => x !== c) })} className="rounded p-0.5 text-faint hover:bg-ink/10 hover:text-ink">
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
        <form
          onSubmit={e => {
            e.preventDefault();
            add(input);
          }}
          className="mt-4 flex gap-2"
        >
          <Input className="flex-1" value={input} onChange={e => setInput(e.target.value)} placeholder="Company name or careers link, e.g. Volvo Cars or capgemini.com/se-en/careers" />
          <Button type="submit" variant="secondary" loading={Boolean(adding) && adding === input} disabled={!input.trim() || Boolean(adding)} icon={<Plus className="size-4" />}>
            Add
          </Button>
        </form>
        <p className="mt-2 text-[11.5px] text-faint">A link is fastest. With just a name, Talaria checks the common hiring platforms, then asks Hermes to find their careers site (up to a minute).</p>
      </div>
    </div>
  );
}

function SourcesTab() {
  const stored = useApp(s => s.preferences)!;
  const [prefs, setPrefs] = React.useState(stored);
  const [saving, setSaving] = React.useState(false);
  React.useEffect(() => setPrefs(stored), [stored]);
  const dirty = JSON.stringify(prefs) !== JSON.stringify(stored);
  return (
    <>
      <SourcesEditor prefs={prefs} onChange={p => setPrefs(x => ({ ...x, ...p, sources: { ...x.sources, ...(p.sources || {}) } }))} />
      <div className="mt-6 flex items-center justify-between rounded-2xl border border-dashed border-line p-4">
        <div className="text-[12.5px] text-muted">Jobs you skipped or that scored low aren't shown again. Reset that list to give them another look on the next search.</div>
        <Button
          variant="ghost"
          size="sm"
          onClick={async () => {
            await api.post('/api/scout/reset-skipped');
            toast.success('Skipped jobs can show up again');
          }}
        >
          Reset skipped
        </Button>
      </div>
      <SaveBar
        dirty={dirty}
        saving={saving}
        onReset={() => setPrefs(stored)}
        onSave={async () => {
          setSaving(true);
          try {
            await api.put('/api/preferences', prefs);
            toast.success('Sources saved');
          } finally {
            setSaving(false);
          }
        }}
      />
    </>
  );
}

// ---------------- answer bank ----------------

function AnswerBank() {
  const answers = useApp(s => s.answers);
  const [editing, setEditing] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState('');
  const save = (next: AnswerBankItem[]) => api.put('/api/answers', next);

  if (!answers.length)
    return (
      <EmptyState icon={<BookmarkCheck className="size-5" />} title="No remembered answers yet">
        When Hermes asks you something while preparing an application — sponsorship, notice period, salary — your answer is saved here and reused, so you never get asked twice.
      </EmptyState>
    );

  return (
    <div className="space-y-2.5">
      <p className="mb-4 text-[13px] text-muted">Hermes reuses these when filling in applications. Keep them current.</p>
      {answers.map(a => (
        <Card key={a.id} className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="text-[13.5px] font-semibold text-ink">{a.question}</div>
            <div className="flex shrink-0 items-center gap-1">
              <Badge>used {a.uses}×</Badge>
              <button aria-label="Delete answer" onClick={() => save(answers.filter(x => x.id !== a.id))} className="rounded-md p-1 text-faint hover:bg-bad-soft hover:text-bad">
                <Trash2 className="size-3.5" />
              </button>
            </div>
          </div>
          {editing === a.id ? (
            <div className="mt-2 flex gap-2">
              <Input autoFocus value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => e.key === 'Enter' && (save(answers.map(x => (x.id === a.id ? { ...x, answer: draft, updatedAt: new Date().toISOString() } : x))), setEditing(null))} />
              <Button
                variant="primary"
                icon={<Check className="size-4" />}
                onClick={() => {
                  save(answers.map(x => (x.id === a.id ? { ...x, answer: draft, updatedAt: new Date().toISOString() } : x)));
                  setEditing(null);
                }}
              >
                Save
              </Button>
            </div>
          ) : (
            <button onClick={() => (setEditing(a.id), setDraft(a.answer))} className="mt-1 w-full text-left text-[13.5px] text-ink-2 hover:text-ink">
              {a.answer}
              <span className="ml-2 text-[11.5px] text-faint">· edited {timeAgo(a.updatedAt)}</span>
            </button>
          )}
        </Card>
      ))}
    </div>
  );
}
