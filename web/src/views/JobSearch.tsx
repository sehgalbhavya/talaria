import * as React from 'react';
import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import { ArrowRight, Check, Globe, GraduationCap, List, Loader, Play, Plus, Rss, Search, Sparkles, X } from 'lucide-react';
import type { CustomBoard, Job, Preferences, SourceId, TargetCompany, WorkKind } from '@shared/types';
import { api } from '@/lib/api';
import { startScout, useApp } from '@/lib/store';
import { navigate } from '@/lib/router';
import { cn, timeAgo } from '@/lib/utils';
import { Button, Card, ChipInput, Field, Input, Segmented, Switch } from '@/components/ui';
import { PageSectionBlock, RailCard, SaveBar, SectionPage, StatusLine, useSectionJump } from '@/components/SectionPage';
import { RolesFields, SkipCompaniesField, WhereFields, WorkKindFields, withKinds } from './Onboarding';
import { toast } from 'sonner';
import { dismissLookup, lookUpCompany, receiveCompanies, useLookups, type Lookup } from '@/lib/companyLookups';
import { countryOptions } from '@/lib/suggest';
import { aiName } from '@/lib/ai';

type PrefsProps = { prefs: Preferences; onChange: (p: Partial<Preferences>) => void };

const SECTIONS = [
  { id: 'want', label: 'What you want' },
  { id: 'dealbreakers', label: 'Dealbreakers' },
  { id: 'where', label: 'Where to look' },
  { id: 'companies', label: 'Companies to watch' },
  { id: 'phd', label: 'PhD positions' },
];

const goSettings = (section: string) => navigate({ view: 'settings', section });

/** What you want and where the AI looks: one draft, one save bar, for the whole page. */
export function JobSearchView() {
  const stored = useApp(s => s.preferences)!;
  const [prefs, setPrefs] = React.useState(stored);
  const [saving, setSaving] = React.useState(false);
  React.useEffect(() => setPrefs(stored), [stored]);
  const dirty = JSON.stringify(prefs) !== JSON.stringify(stored);
  const change = (p: Partial<Preferences>) => setPrefs(x => ({ ...x, ...p, sources: { ...x.sources, ...(p.sources || {}) } }));

  const save = async () => {
    setSaving(true);
    try {
      await api.put('/api/preferences', prefs);
      toast.success('Saved. The next search uses it.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SectionPage title="Job search" subtitle={`What you want, and where ${aiName()} should look. Changes apply to the next search.`} sections={SECTIONS} rail={<SearchRail prefs={prefs} dirty={dirty} onSave={save} />}>
      <PageSectionBlock id="want" title="What you want">
        <Card className="space-y-5 p-5">
          <WorkKindFields prefs={prefs} onChange={change} />
          <RolesFields prefs={prefs} onChange={change} />
          <WhereFields prefs={prefs} onChange={change} hideSponsorship />
          <Field label="Topics you'd love" hint="Boosts matching roles.">
            <ChipInput value={prefs.includeKeywords} onChange={includeKeywords => change({ includeKeywords })} placeholder="e.g. fintech, React" />
          </Field>
        </Card>
      </PageSectionBlock>

      <PageSectionBlock id="dealbreakers" title="Dealbreakers" desc="Jobs that hit any of these never reach your board.">
        <Card className="space-y-5 p-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Keywords to avoid" hint="Jobs mentioning these are skipped.">
              <ChipInput value={prefs.excludeKeywords} onChange={excludeKeywords => change({ excludeKeywords })} placeholder="e.g. crypto, unpaid" />
            </Field>
            <SkipCompaniesField prefs={prefs} onChange={change} />
          </div>
          <Field label="Hide postings older than" hint="Stale postings are usually filled already.">
            <Segmented
              size="sm"
              value={String(prefs.maxAgeDays)}
              onChange={v => change({ maxAgeDays: Number(v) })}
              options={[
                { value: '7', label: '1 week' },
                { value: '14', label: '2 weeks' },
                { value: '30', label: '1 month' },
                { value: '60', label: '2 months' },
              ]}
            />
          </Field>
        </Card>
      </PageSectionBlock>

      <PageSectionBlock id="where" title="Where to look" desc="Choose what gets searched. Accounts like LinkedIn are connected in Settings.">
        <div className="space-y-4">
          <BuiltInBoards prefs={prefs} onChange={change} withLinkedIn />
          <CustomBoards prefs={prefs} onChange={change} />
        </div>
      </PageSectionBlock>

      <PageSectionBlock id="companies" title="Companies to watch">
        <CompaniesToWatch prefs={prefs} onChange={change} />
      </PageSectionBlock>

      <PageSectionBlock id="phd" title="PhD positions">
        <PhdSettings prefs={prefs} onChange={change} />
      </PageSectionBlock>

      <div className="flex flex-wrap items-center justify-between gap-3 border border-dashed border-line p-4">
        <div className="text-[12.5px] text-muted">Jobs you skipped or that scored low aren't shown again. Reset that list to give them another look on the next search.</div>
        <Button
          variant="ghost"
          size="sm"
          onClick={async () => {
            await api.post('/api/scout/reset-skipped');
            toast.success('Skipped jobs can show up again');
          }}
        >
          Show skipped jobs again
        </Button>
      </div>

      <SaveBar dirty={dirty} saving={saving} onSave={save} onReset={() => setPrefs(stored)} />
    </SectionPage>
  );
}

// ---------------- live panel ----------------

const SENIORITY_WORD: Record<string, string> = { intern: 'intern', entry: 'entry-level', mid: 'mid-level', senior: 'senior', lead: 'lead' };
const REMOTE_WORD: Record<string, string> = { any: '', remote_or_hybrid: ', remote or hybrid', remote_only: ', remote only', onsite: ', on-site' };

const list = (xs: string[], joiner = 'or') => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} ${joiner} ${xs[xs.length - 1]}`);

/** Your search in plain words, so you can see what an edit changes before you save it. */
function describe(p: Preferences) {
  const kinds = p.lookingFor?.length ? p.lookingFor : (['full_time'] as WorkKind[]);
  const parts: string[] = [];
  if (kinds.includes('full_time') || kinds.includes('internship')) {
    const levels = p.seniority.map(s => SENIORITY_WORD[s]).filter(Boolean);
    const roles = p.roles.length ? list(p.roles.slice(0, 3)) + (p.roles.length > 3 ? ` (+${p.roles.length - 3} more)` : '') : 'any role';
    const where = p.locations.length ? ` in ${list(p.locations.slice(0, 3))}` : ' anywhere';
    const pay = p.minSalary ? `, from ${p.minSalary.toLocaleString()} ${p.currency || ''}`.trimEnd() : '';
    parts.push(`${levels.length ? `${list(levels)} ` : ''}${roles}${where}${REMOTE_WORD[p.remote] || ''}${pay}.`.replace(/^./, c => c.toUpperCase()));
  }
  if (kinds.includes('phd')) parts.push(`PhD positions in ${p.phd?.fields.length ? list(p.phd.fields.slice(0, 3)) : 'your fields'}.`);
  const skip = p.excludeCompanies.length + p.excludeKeywords.length;
  if (skip) parts.push(`Skipping ${p.excludeCompanies.length ? `${p.excludeCompanies.length} compan${p.excludeCompanies.length === 1 ? 'y' : 'ies'}` : ''}${p.excludeCompanies.length && p.excludeKeywords.length ? ' and ' : ''}${p.excludeKeywords.length ? `${p.excludeKeywords.length} keyword${p.excludeKeywords.length === 1 ? '' : 's'}` : ''}.`);
  return parts.join(' ');
}

const BUCKET: Partial<Record<SourceId, string>> = {
  remotive: 'Job boards',
  remoteok: 'Job boards',
  himalayas: 'Job boards',
  jobicy: 'Job boards',
  arbeitnow: 'Job boards',
  themuse: 'Job boards',
  custom_board: 'Your boards',
  greenhouse: 'Companies you watch',
  lever: 'Companies you watch',
  ashby: 'Companies you watch',
  workday: 'Companies you watch',
  workable: 'Companies you watch',
  smartrecruiters: 'Companies you watch',
  recruitee: 'Companies you watch',
  company_site: 'Companies you watch',
  web_search: 'Web search',
  linkedin: 'LinkedIn',
  academic: 'PhD boards',
};

function SearchRail({ prefs, dirty, onSave }: { prefs: Preferences; dirty: boolean; onSave: () => Promise<void> }) {
  const jobs = useApp(s => s.jobs);
  const scout = useApp(s => s.scout);
  const settings = useApp(s => s.settings);
  const jump = useSectionJump();
  const webOn = Boolean(settings?.ai.webSearch);

  // Where this week's new jobs came from: a quick read on which sources are pulling their weight.
  const counts = React.useMemo(() => {
    const week = Date.now() - 7 * 86_400_000;
    const m = new Map<string, number>();
    for (const j of Object.values(jobs) as Job[]) {
      const b = BUCKET[j.source];
      if (b && Date.parse(j.createdAt) >= week) m.set(b, (m.get(b) || 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [jobs]);

  const issues: { text: string; fix: () => void; label: string }[] = [];
  if (prefs.sources.linkedin && !settings?.linkedin.connected) issues.push({ text: 'LinkedIn is on, but not connected', fix: () => goSettings('connections'), label: 'Connect' });
  if (prefs.sources.web_search && !webOn) issues.push({ text: "Web search is on as a source, but searching the web is turned off", fix: () => goSettings('ai'), label: 'Turn on' });
  if (prefs.phd?.enabled && !webOn) issues.push({ text: 'PhD search needs web search turned on', fix: () => goSettings('ai'), label: 'Turn on' });
  if (!prefs.roles.length && !(prefs.lookingFor || []).every(k => k === 'phd')) issues.push({ text: `No roles yet, so ${aiName()} has nothing to search for`, fix: () => jump('want'), label: 'Add roles' });
  const anySource = Object.values(prefs.sources).some(Boolean) || prefs.customBoards.some(b => b.enabled) || prefs.targetCompanies.length > 0;
  if (!anySource) issues.push({ text: 'Every source is off', fix: () => jump('where'), label: 'Pick some' });

  const last = settings?.autopilot.lastScoutAt;
  const search = async () => {
    if (dirty) await onSave();
    startScout();
  };

  return (
    <>
      <RailCard title="Your search">
        <p className="text-[13.5px] leading-relaxed text-ink">{describe(prefs) || 'Nothing set yet.'}</p>
        {dirty && <p className="mt-2 text-[12px] text-gold">Includes changes you haven't saved.</p>}
        <Button className="mt-4 w-full" variant="primary" loading={scout.running} icon={<Play className="size-3.5" />} onClick={search}>
          {scout.running ? scout.phase || 'Searching…' : dirty ? 'Save and search now' : 'Search now'}
        </Button>
        <p className="mt-2 text-center text-[11.5px] text-faint">
          {last ? `Last search ${timeAgo(last, false)}` : 'No search yet'}
          {settings?.autopilot.enabled ? ` · Autopilot every ${settings.autopilot.scoutEveryHours}h` : ' · Autopilot off'}
        </p>
      </RailCard>

      {issues.length > 0 && (
        <RailCard title="Needs a look">
          {issues.map(i => (
            <div key={i.text} className="flex items-start gap-2.5 py-1.5">
              <span className="mt-[5px] size-2 shrink-0 bg-warn" />
              <span className="min-w-0 flex-1 text-[12.5px] leading-snug text-ink-2">{i.text}</span>
              <button onClick={i.fix} className="shrink-0 text-[12px] font-medium text-accent hover:underline">
                {i.label}
              </button>
            </div>
          ))}
        </RailCard>
      )}

      <RailCard title="New this week, by source">
        {counts.length ? (
          counts.map(([name, n]) => <StatusLine key={name} tone="ok" title={<span className="flex justify-between gap-3"><span>{name}</span><span className="tabular-nums text-muted">{n}</span></span>} />)
        ) : (
          <p className="text-[12.5px] text-muted">No new jobs in the last 7 days.</p>
        )}
      </RailCard>
    </>
  );
}

// ---------------- sources ----------------

export const BOARDS: { id: SourceId; name: string; desc: string }[] = [
  {
    id: 'web_search',
    name: 'Web search',
    get desc() {
      return `${aiName()} searches the open web: companies' own career sites, Workday, Greenhouse, Lever and more.`;
    },
  },
  { id: 'remotive', name: 'Remotive', desc: 'Curated remote tech jobs.' },
  { id: 'remoteok', name: 'Remote OK', desc: 'Large feed of remote roles worldwide.' },
  { id: 'himalayas', name: 'Himalayas', desc: 'Remote jobs with salary data.' },
  { id: 'jobicy', name: 'Jobicy', desc: 'Remote roles across many fields.' },
  { id: 'themuse', name: 'The Muse', desc: 'Jobs filtered by your locations and level.' },
  { id: 'arbeitnow', name: 'Arbeitnow', desc: 'Germany & EU roles, many with visa sponsorship.' },
];

/** The boards Talaria knows how to read, plus LinkedIn when you've connected it. */
function BuiltInBoards({ prefs, onChange, withLinkedIn }: PrefsProps & { withLinkedIn?: boolean }) {
  const webOn = useApp(s => Boolean(s.settings?.ai.webSearch));
  const linkedIn = useApp(s => Boolean(s.settings?.linkedin.connected));
  const toggle = (id: SourceId, v: boolean) => onChange({ sources: { ...prefs.sources, [id]: v } });
  const card = (id: SourceId, name: React.ReactNode, desc: React.ReactNode, note?: React.ReactNode, disabled?: boolean) => (
    <label key={id} className={cn('flex cursor-pointer items-start gap-3 border p-3.5 transition-colors', prefs.sources[id] ? 'border-line bg-card shadow-card' : 'border-dashed border-line')}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-[13.5px] font-semibold text-ink">{name}</div>
        <div className="mt-0.5 text-[12px] leading-snug text-muted">{desc}</div>
        {note}
      </div>
      <Switch checked={Boolean(prefs.sources[id])} disabled={disabled} onChange={v => toggle(id, v)} label={typeof name === 'string' ? name : id} />
    </label>
  );
  const fixLink = (text: string, section: string) => (
    <button
      type="button"
      onClick={e => {
        e.preventDefault();
        goSettings(section);
      }}
      className="mt-1.5 inline-flex items-center gap-1 text-[11.5px] font-medium text-warn hover:underline"
    >
      {text} <ArrowRight className="size-3" />
    </button>
  );
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {BOARDS.map(b =>
        card(
          b.id,
          <>
            {b.id === 'web_search' && <Globe className="size-3.5 text-gold" />}
            {b.name}
          </>,
          b.desc,
          b.id === 'web_search' && !webOn ? fixLink("Web search is turned off. Turn it on in Settings", 'ai') : undefined,
        ),
      )}
      {withLinkedIn &&
        card(
          'linkedin',
          'LinkedIn',
          "Read-only and slow on purpose: up to 20 postings per search. Never uses Easy Apply. LinkedIn's terms prohibit automated access, so there's some risk to your account.",
          !linkedIn ? fixLink('Not connected. Connect in Settings', 'connections') : undefined,
          !linkedIn && !prefs.sources.linkedin,
        )}
    </div>
  );
}

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

const HOW: Record<CustomBoard['how'], { label: string; icon: React.ReactNode }> = {
  feed: { label: 'Read from its feed', icon: <Rss className="size-3.5" /> },
  page: { label: 'Read from its listings', icon: <List className="size-3.5" /> },
  search: { label: 'Searched on the web', icon: <Search className="size-3.5" /> },
};

/** Job boards you add yourself: any site that lists jobs, searched alongside the built-in ones. */
function CustomBoards({ prefs, onChange }: PrefsProps) {
  const boards = prefs.customBoards || [];
  const webSearch = useApp(s => s.settings?.ai.webSearch);
  const [input, setInput] = React.useState('');
  const [adding, setAdding] = React.useState(false);
  const set = (customBoards: CustomBoard[]) => onChange({ customBoards });

  // Talaria works out how to read the board and how many jobs it lists; you still press Save.
  const add = async () => {
    if (!input.trim()) return;
    setAdding(true);
    try {
      const { board: b, count } = await api.post<{ board: CustomBoard; count: number }>('/api/preferences/resolve-board', { input });
      set([...boards.filter(x => x.url !== b.url), b]);
      toast.success(
        b.how === 'feed'
          ? `${b.name}: Talaria reads its job feed (${count} jobs in it now)`
          : b.how === 'page'
            ? `${b.name}: ${count} job links on the page. Talaria reads the ones that match your roles.`
            : `${b.name}: its listings can't be read directly, so ${aiName()} searches the site for your roles${webSearch ? '' : ' (turn on “Search the web” in Settings)'}.`,
      );
      setInput('');
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="bg-card p-5 shadow-card">
      <div className="text-[14px] font-semibold text-ink">Your job boards</div>
      <div className="mt-0.5 max-w-xl text-[12.5px] leading-relaxed text-muted">
        Add any site where jobs in your field get posted: a niche board, a country's job site, a community's jobs page. Paste its link and Talaria works out how to read it: its job feed, its listings, or a web search within the site.
      </div>

      {boards.length > 0 ? (
        <div className="mt-4 divide-y divide-line-2 overflow-hidden border border-line">
          {boards.map(b => (
            <div key={b.id} className={cn('flex items-center gap-3 px-3.5 py-2.5', !b.enabled && 'opacity-60')}>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
                  <input
                    aria-label="Board name"
                    title="Rename"
                    value={b.name}
                    onChange={e => set(boards.map(x => (x.id === b.id ? { ...x, name: e.target.value } : x)))}
                    onBlur={() => !b.name.trim() && set(boards.map(x => (x.id === b.id ? { ...x, name: b.domain } : x)))}
                    size={Math.max(4, b.name.length)}
                    className="-mx-1 min-w-0 truncate bg-transparent px-1 outline-none hover:bg-ink/[0.05] focus:bg-ink/[0.05]"
                  />
                  <a href={b.url.replaceAll('{query}', encodeURIComponent(prefs.roles[0] || ''))} target="_blank" rel="noopener noreferrer" className="truncate text-[11.5px] font-normal text-accent hover:underline">
                    {b.domain}
                  </a>
                </div>
                <div className="mt-0.5 flex items-center gap-1 text-[11.5px] text-faint">
                  {HOW[b.how].icon}
                  {HOW[b.how].label}
                  {b.url.includes('{query}') && ' · once for each of your roles'}
                </div>
              </div>
              <Switch checked={b.enabled} onChange={enabled => set(boards.map(x => (x.id === b.id ? { ...x, enabled } : x)))} label={`Search ${b.name}`} />
              <button aria-label={`Remove ${b.name}`} onClick={() => set(boards.filter(x => x.id !== b.id))} className="p-1 text-faint hover:bg-ink/10 hover:text-ink">
                <X className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-4 border border-dashed border-line px-3.5 py-3 text-[12.5px] leading-relaxed text-muted">
          No boards of your own yet. Paste the link to one below, for example its page of jobs in your field.
        </p>
      )}

      <form
        onSubmit={e => {
          e.preventDefault();
          add();
        }}
        className="mt-4 flex gap-2"
      >
        <Input className="flex-1" value={input} onChange={e => setInput(e.target.value)} placeholder="Job board link, e.g. weworkremotely.com/categories/remote-design-jobs" />
        <Button type="submit" variant="secondary" loading={adding} disabled={!input.trim() || adding} icon={<Plus className="size-4" />}>
          Add
        </Button>
      </form>
      <p className="mt-2 text-[11.5px] leading-relaxed text-faint">
        Best is the board's page already filtered to your field or location. To search it for each of your roles, put <code className="bg-ink/[0.06] px-1 text-ink-2">{'{query}'}</code> where the search words go, e.g. <span className="text-ink-2">example.com/jobs?q={'{query}'}</span>.
      </p>
    </div>
  );
}

const PHD_FIELD_IDEAS = ['Haptics', 'XR / virtual and augmented reality', 'Automotive HMI', 'Generative UI', 'Human-computer interaction', 'Multisensory interaction', 'Human-AI interaction', 'Interaction design'];

/**
 * PhD positions: their own search, in your research fields, on the PhDs side of the board.
 * Its switch is the same thing as "PhD positions" under the kinds of work you want, so the two never disagree.
 */
function PhdSettings({ prefs, onChange }: PrefsProps) {
  const webOn = useApp(s => Boolean(s.settings?.ai.webSearch));
  const phd = prefs.phd || { enabled: false, fields: [], countries: [] };
  const kinds = prefs.lookingFor?.length ? prefs.lookingFor : (['full_time'] as WorkKind[]);
  const set = (patch: Partial<typeof phd>) => onChange({ phd: { ...phd, ...patch } });
  const toggle = (on: boolean) => {
    const next = withKinds(prefs, on ? [...kinds.filter(k => k !== 'phd'), 'phd'] : kinds.filter(k => k !== 'phd'));
    onChange({ ...next, phd: { ...next.phd!, fields: phd.fields.length ? phd.fields : PHD_FIELD_IDEAS.slice(0, 6) } });
  };
  return (
    <div className="bg-card p-5 shadow-card">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-1.5 text-[14px] font-semibold text-ink">
            <GraduationCap className="size-4 text-accent" /> Search for PhD positions
          </div>
          <div className="mt-0.5 max-w-xl text-[12.5px] leading-relaxed text-muted">
            {aiName()} searches academic job boards (EURAXESS, Academic Positions, jobs.ac.uk, FindAPhD, Varbi) and university and lab pages for open, funded PhDs in these fields, plus close ones your background fits. They appear on the PhDs side of the board, and their applications get an academic CV and a motivation letter.
          </div>
          {phd.enabled && !webOn && (
            <button type="button" onClick={() => goSettings('ai')} className="mt-1.5 inline-flex items-center gap-1 text-[11.5px] font-medium text-warn hover:underline">
              Needs web search. Turn it on in Settings <ArrowRight className="size-3" />
            </button>
          )}
        </div>
        <Switch checked={phd.enabled} onChange={toggle} label="Search for PhD positions" />
      </div>
      {phd.enabled && (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Research fields" hint={`What you'd want to research. ${aiName()} also looks at closely related topics.`}>
            <ChipInput value={phd.fields} onChange={fields => set({ fields })} placeholder="Add a field" suggestions={PHD_FIELD_IDEAS} />
          </Field>
          <Field label="Where" hint="Countries or cities. Leave empty for anywhere in Europe.">
            <ChipInput value={phd.countries} onChange={countries => set({ countries })} placeholder="Start typing a country or region" search={countryOptions} suggestions={['Sweden', 'Germany', 'Netherlands', 'Denmark', 'Finland', 'Switzerland', 'United Kingdom']} />
          </Field>
        </div>
      )}
    </div>
  );
}

/** Companies you'd love to work for, read straight from wherever they post their jobs. */
function CompaniesToWatch({ prefs, onChange }: PrefsProps) {
  const [input, setInput] = React.useState('');
  const [suggesting, setSuggesting] = React.useState(false);
  const [suggestions, setSuggestions] = React.useState<Suggestion[]>([]);
  const lookups = useLookups(s => s.items);

  // Several lookups can finish at once, before the new list comes back down: keep our own latest copy.
  const companies = React.useRef(prefs.targetCompanies);
  const seen = React.useRef(prefs.targetCompanies);
  if (seen.current !== prefs.targetCompanies) seen.current = companies.current = prefs.targetCompanies;
  const setCompanies = (next: TargetCompany[]) => {
    companies.current = next;
    onChange({ targetCompanies: next });
  };
  React.useEffect(() => receiveCompanies(c => setCompanies([...companies.current.filter(x => !(x.ats === c.ats && x.slug === c.slug)), c])));

  // Talaria looks the company up in the background (which platform, how many open jobs); you keep typing.
  const add = (text: string, name?: string) => {
    if (!text.trim()) return;
    lookUpCompany(text, name);
    if (name) setSuggestions(s => s.filter(x => x.name !== name));
  };

  const suggest = async () => {
    setSuggesting(true);
    try {
      const r = await api.post<{ companies: Suggestion[] }>('/api/preferences/suggest-companies');
      setSuggestions(r.companies);
      if (!r.companies.length) toast(`${aiName()} found no new companies this time`);
    } finally {
      setSuggesting(false);
    }
  };

  return (
    <div className="bg-card p-5 shadow-card">
      <div className="flex items-start justify-between gap-4">
        <div className="max-w-xl text-[12.5px] leading-relaxed text-muted">
          Add any company by name or by the link to its jobs page. Talaria finds where it posts: Greenhouse, Lever, Ashby, Workday, Workable, SmartRecruiters, Recruitee, or its own careers website, which {aiName()} searches for your roles.
        </div>
        <Button variant="secondary" size="sm" loading={suggesting} icon={<Sparkles className="size-3.5 text-gold" />} onClick={suggest}>
          {suggesting ? `${aiName()} is looking…` : 'Suggest companies'}
        </Button>
      </div>

      {suggestions.length > 0 && (
        <div className="mt-4 overflow-hidden border border-gold/20 bg-gold-soft/30">
          <div className="flex items-center justify-between border-b border-gold/15 px-3.5 py-2 text-[12px] font-semibold text-gold">
            {aiName()} suggests
            <span className="flex items-center gap-3">
              <button onClick={() => suggestions.forEach(sg => add(sg.url, sg.name))} className="font-semibold text-ink hover:underline">
                Add all
              </button>
              <button onClick={() => setSuggestions([])} className="font-medium text-muted hover:text-ink">
                Dismiss
              </button>
            </span>
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
              <Button size="sm" variant="secondary" icon={<Plus className="size-3.5" />} onClick={() => add(sg.url, sg.name)}>
                Add
              </Button>
            </div>
          ))}
        </div>
      )}

      {!prefs.targetCompanies.length && !suggestions.length && !lookups.length && (
        <p className="mt-4 border border-dashed border-line px-3.5 py-3 text-[12.5px] leading-relaxed text-muted">
          No companies yet. Add the ones you'd love to work for below, or press <strong className="font-semibold text-ink">Suggest companies</strong> and {aiName()} picks some that fit your profile.
        </p>
      )}
      {/* Every chip animates its position, so when one arrives or leaves the rest glide into place. */}
      <LayoutGroup>
        <div className="mt-4 flex flex-wrap gap-1.5 empty:hidden">
          <AnimatePresence initial={false}>
            {prefs.targetCompanies.map(c => (
              <motion.span
                key={`${c.ats}:${c.slug}`}
                layout
                layoutId={`company:${c.ats}:${c.slug}`}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={CHIP_MOTION}
                title={c.url || undefined}
                className="inline-flex h-7 items-center gap-1.5 bg-ink/[0.05] pr-1 pl-2.5 text-[12.5px] font-medium text-ink-2 dark:bg-white/[0.07]"
              >
                {c.ats === 'site' && <Globe className="size-3 text-faint" />}
                {c.name}
                <span className="text-[11px] font-normal text-faint">{PLATFORM[c.ats] || c.ats}</span>
                <button aria-label={`Remove ${c.name}`} onClick={() => setCompanies(companies.current.filter(x => x !== c))} className="p-0.5 text-faint hover:bg-ink/10 hover:text-ink">
                  <X className="size-3" />
                </button>
              </motion.span>
            ))}
            {lookups.map(l => (
              <LookupChip key={l.id} lookup={l} onRetry={() => (setInput(l.input), dismissLookup(l.id))} />
            ))}
          </AnimatePresence>
        </div>
      </LayoutGroup>
      {lookups.some(l => l.state === 'failed') && (
        <div className="mt-2 space-y-1">
          {lookups
            .filter(l => l.state === 'failed')
            .map(l => (
              <p key={l.id} className="text-[12px] leading-snug text-bad">
                <strong className="font-semibold">{l.label}:</strong> {l.note} Click it to edit it and try again.
              </p>
            ))}
        </div>
      )}
      <form
        onSubmit={e => {
          e.preventDefault();
          add(input);
          setInput('');
        }}
        className="mt-4 flex gap-2"
      >
        <Input className="flex-1" value={input} onChange={e => setInput(e.target.value)} placeholder="Company name or careers link, e.g. Volvo Cars or capgemini.com/se-en/careers" />
        <Button type="submit" variant="secondary" disabled={!input.trim()} icon={<Plus className="size-4" />}>
          Add
        </Button>
      </form>
      <p className="mt-2 text-[11.5px] text-faint">Add as many as you like; each is looked up in the background. A link is fastest. With just a name, Talaria checks the common hiring platforms, then asks {aiName()} to find their careers site (up to a minute).</p>
    </div>
  );
}

// Chips slide to their new spot on a soft spring instead of jumping there.
const CHIP_MOTION = { duration: 0.25, layout: { type: 'spring', stiffness: 260, damping: 30, mass: 0.9 } } as const;

/** A company being looked up: working, then a green pop when found, or a red shake when not. */
function LookupChip({ lookup: l, onRetry }: { lookup: Lookup; onRetry: () => void }) {
  return (
    <motion.span
      layout
      // Once found, it shares an id with the company chip it becomes, so it moves into its place in the list.
      layoutId={l.company ? `company:${l.company.ats}:${l.company.slug}` : undefined}
      initial={{ opacity: 0, scale: 0.85 }}
      animate={l.state === 'found' ? { opacity: 1, scale: [1, 1.12, 1] } : l.state === 'failed' ? { opacity: 1, scale: 1, x: [0, -5, 5, -4, 4, -2, 0] } : { opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ ...CHIP_MOTION, duration: l.state === 'working' ? 0.18 : 0.45 }}
      title={l.state === 'failed' ? `${l.note} Click to edit it and try again.` : undefined}
      onClick={l.state === 'failed' ? onRetry : undefined}
      className={cn(
        'inline-flex h-7 items-center gap-1.5 pr-1 pl-2.5 text-[12.5px] font-medium transition-colors duration-300',
        l.state === 'working' && 'bg-ink/[0.05] text-muted dark:bg-white/[0.07]',
        l.state === 'found' && 'bg-ok-soft pr-2.5 text-ok ring-1 ring-ok/30',
        l.state === 'failed' && 'cursor-pointer bg-bad-soft text-bad ring-1 ring-bad/30',
      )}
    >
      {l.state === 'working' && <Loader className="size-3 animate-spin" />}
      {l.state === 'found' && <Check className="size-3" strokeWidth={3} />}
      {l.label}
      <span className="text-[11px] font-normal opacity-75">{l.state === 'working' ? 'finding jobs page…' : l.state === 'found' ? l.note : "couldn't find it"}</span>
      {l.state !== 'found' && (
        <button aria-label={`Dismiss ${l.label}`} onClick={e => (e.stopPropagation(), dismissLookup(l.id))} className="p-0.5 opacity-70 hover:bg-ink/10 hover:opacity-100">
          <X className="size-3" />
        </button>
      )}
    </motion.span>
  );
}

/** Every source on one screen, for first-time setup. */
export function SourcesEditor({ prefs, onChange }: PrefsProps) {
  return (
    <div className="space-y-6">
      <BuiltInBoards prefs={prefs} onChange={onChange} />
      <CustomBoards prefs={prefs} onChange={onChange} />
      <PhdSettings prefs={prefs} onChange={onChange} />
      <div>
        <div className="mb-2 text-[14px] font-semibold text-ink">Companies to watch</div>
        <CompaniesToWatch prefs={prefs} onChange={onChange} />
      </div>
    </div>
  );
}
