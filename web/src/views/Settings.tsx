import * as React from 'react';
import { Bot, Check, Loader2, MessageSquareText, Mic, Monitor, Moon, RefreshCw, Square, Sun, TriangleAlert } from 'lucide-react';
import type { Settings } from '@shared/types';
import { api } from '@/lib/api';
import { useApp } from '@/lib/store';
import { cn, timeAgo } from '@/lib/utils';
import { Badge, Button, Card, CopyButton, Field, Input, SectionTitle, Segmented, Switch } from '@/components/ui';
import { StatusDot } from '@/components/brand';
import { BoardTour } from '@/components/BoardTour';
import { getThemePref, setThemePref, type ThemePref } from '@/lib/theme';
import { toast } from 'sonner';
import { WavRecorder } from '@/lib/recorder';

export function SettingsView() {
  const settings = useApp(s => s.settings)!;
  const hermes = useApp(s => s.hermes);
  const [models, setModels] = React.useState<Record<string, string[]>>({});
  const [checking, setChecking] = React.useState(false);
  const [theme, setTheme] = React.useState<ThemePref>(getThemePref());
  const [tour, setTour] = React.useState(false);

  React.useEffect(() => {
    api.get<Record<string, string[]>>('/api/hermes/models', { quiet: true }).then(setModels).catch(() => {});
  }, []);

  const save = async (patch: Partial<Settings>, msg = 'Saved') => {
    await api.put('/api/settings', patch);
    toast.success(msg);
  };
  const [trying, setTrying] = React.useState<string | null>(null);
  // Never switch models blind: a provider without credentials would break every agent task.
  const tryAndSave = async (provider: string, model: string, field: 'model' | 'tailorModel' = 'model') => {
    if (!model) return save({ hermes: { ...h, tailorModel: undefined } });
    setTrying(`${model}`);
    try {
      const r = await api.post<{ ok: boolean; message?: string; latencyMs?: number }>('/api/hermes/try', { provider, model });
      if (!r.ok) {
        toast.error(`${model} didn't work through Hermes: ${r.message}`, { duration: 9000 });
        return;
      }
      // A writing model from another provider wouldn't work after a provider switch, so it's dropped.
      const keepTailor = provider === h.provider || (h.tailorModel && (models[provider] || []).includes(h.tailorModel));
      await save(
        field === 'model' ? { hermes: { ...h, provider, model, tailorModel: keepTailor ? h.tailorModel : undefined } } : { hermes: { ...h, tailorModel: model } },
        `Switched to ${model}. It answered in ${((r.latencyMs || 0) / 1000).toFixed(1)}s`,
      );
    } finally {
      setTrying(null);
    }
  };
  const h = settings.hermes;
  const ap = settings.autopilot;
  const providerModels = models[h.provider] || [];
  const mcpUrl = `${location.protocol}//127.0.0.1:5178/mcp`;

  const check = async () => {
    setChecking(true);
    try {
      await api.post('/api/hermes/check');
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <BoardTour force={tour} onClose={() => setTour(false)} />
      <header className="px-7 pt-6 pb-5">
        <h1 className="font-display text-[27px] leading-none tracking-[-0.015em] text-ink">Settings</h1>
        <p className="mt-2 text-[13.5px] text-muted">How Talaria talks to Hermes, how much it does on its own, and how it looks.</p>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-7 pb-16">
        <div className="max-w-[860px] space-y-8">
          <section>
            <SectionTitle>Hermes agent</SectionTitle>
            <Card className="overflow-hidden">
              <div className="flex items-center gap-4 border-b border-line-2 p-5">
                <div className={cn('grid size-11 place-items-center rounded-xl', hermes.ok ? 'bg-ok-soft text-ok' : 'bg-warn-soft text-warn')}>{hermes.ok ? <Bot className="size-5" /> : <TriangleAlert className="size-5" />}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-[14.5px] font-semibold text-ink">
                    <StatusDot color={hermes.ok ? 'var(--ok)' : 'var(--warn)'} />
                    {hermes.ok ? 'Connected' : hermes.installed ? 'Installed, but not answering' : 'Hermes not found'}
                    {hermes.version && <Badge>v{hermes.version}</Badge>}
                  </div>
                  <div className="mt-0.5 truncate text-[12.5px] text-muted">
                    {hermes.ok ? `Last check ${timeAgo(hermes.checkedAt)}${hermes.latencyMs ? ` · round trip ${(hermes.latencyMs / 1000).toFixed(1)}s` : ''}` : hermes.message}
                  </div>
                </div>
                <Button variant="secondary" loading={checking} icon={<RefreshCw className="size-4" />} onClick={check}>
                  Test
                </Button>
              </div>
              <div className="grid gap-5 p-5 sm:grid-cols-2">
                <Field label="Provider" hint="Any provider you've signed into with Hermes. Talaria tests it before switching.">
                  <ProviderSelect value={h.provider} options={Object.keys(models)} disabled={Boolean(trying)} onChange={provider => tryAndSave(provider, provider === 'copilot' ? 'gpt-4.1' : provider === 'openai-codex' ? 'gpt-5.6-terra' : (models[provider] || [])[0] || h.model)} />
                </Field>
                <Field
                  label={
                    <span className="flex items-center gap-1.5">
                      Model {trying && <Loader2 className="size-3 animate-spin text-gold" />}
                    </span>
                  }
                  hint={
                    trying
                      ? `Testing ${trying} through Hermes…`
                      : h.provider === 'copilot'
                        ? 'gpt-4.1 and gpt-4o are unlimited on Copilot. Premium models use your monthly quota and may need enabling at github.com/settings/copilot.'
                        : h.provider === 'openai-codex'
                          ? 'Your ChatGPT account only accepts the gpt-5.6 models (sol, terra and luna). Calls count against your ChatGPT usage limits.'
                          : undefined
                  }
                >
                  <ModelSelect value={h.model} options={providerModels} disabled={Boolean(trying)} onChange={model => tryAndSave(h.provider, model)} />
                </Field>
                <Field label="Writing model (optional)" hint="A stronger model just for resumes & cover letters. Leave blank to use the main model.">
                  <ModelSelect value={h.tailorModel || ''} options={['', ...providerModels]} disabled={Boolean(trying)} onChange={m => tryAndSave(h.provider, m, 'tailorModel')} />
                </Field>
                <Field label="Parallel tasks" hint="How many Hermes tasks may run at once.">
                  <Segmented size="sm" value={String(h.concurrency)} onChange={v => save({ hermes: { ...h, concurrency: Number(v) } })} options={['1', '2', '3', '4'].map(v => ({ value: v, label: v }))} />
                </Field>
              </div>
              <div className="flex items-center justify-between gap-4 border-t border-line-2 px-5 py-4">
                <div>
                  <div className="text-[13.5px] font-medium text-ink">Let Hermes search the web</div>
                  <div className="text-[12.5px] text-muted">Adds Hermes's own web search to each scout (slower, finds roles beyond the job boards).</div>
                </div>
                <Switch checked={h.webSearch} onChange={webSearch => save({ hermes: { ...h, webSearch } })} label="Web search" />
              </div>
            </Card>
          </section>

          <section>
            <SectionTitle>Applying</SectionTitle>
            <Card className="divide-y divide-line-2">
              <Row
                title="Ask me before drafting"
                desc="When you hand a job to Hermes, it first asks you a few questions (why this company, what to lead with, details your resume doesn't show) and drafts from your answers. Turn off to have Hermes draft straight away."
              >
                <Switch
                  checked={settings.apply?.interviewFirst !== false}
                  onChange={interviewFirst => save({ apply: { ...settings.apply, interviewFirst } }, interviewFirst ? 'Hermes will ask before drafting' : 'Hermes will draft straight away')}
                  label="Ask me first"
                />
              </Row>
              <Row
                title="Submit applications for me"
                desc="After you approve an application, Talaria opens the company's form (Greenhouse, Lever or Ashby) in its own browser window, fills every field, uploads your tailored resume and cover letter, and submits. It stops and asks you if the form needs something it doesn't know, or if a CAPTCHA appears. Other job sites use the Apply kit."
              >
                <Switch checked={settings.apply?.autoSubmit ?? false} onChange={autoSubmit => save({ apply: { ...settings.apply, autoSubmit } }, autoSubmit ? 'Talaria will submit approved applications' : 'Approved applications open the Apply kit instead')} label="Submit for me" />
              </Row>
            </Card>
          </section>

          <LinkedInSection />

          <GmailSection />

          <VoiceSection />

          <section>
            <SectionTitle>Autopilot</SectionTitle>
            <Card className="divide-y divide-line-2">
              <Row title="Search automatically" desc={`Scouts for new jobs every ${ap.scoutEveryHours} hours while Talaria is running.${ap.lastScoutAt ? ` Last search ${timeAgo(ap.lastScoutAt, false)}.` : ''}`}>
                <Switch checked={ap.enabled} onChange={enabled => save({ autopilot: { ...ap, enabled } }, enabled ? 'Autopilot on' : 'Autopilot off')} label="Autopilot" />
              </Row>
              <Row title="How often">
                <Segmented size="sm" value={String(ap.scoutEveryHours)} onChange={v => save({ autopilot: { ...ap, scoutEveryHours: Number(v) } })} options={['6', '12', '24', '48'].map(v => ({ value: v, label: `${v}h` }))} />
              </Row>
              <Row title="Pre-analyze promising jobs" desc="Hermes writes the full fit analysis for new jobs that score at least this high, so it's ready when you open them.">
                <Segmented size="sm" value={String(ap.autoAnalyzeAbove)} onChange={v => save({ autopilot: { ...ap, autoAnalyzeAbove: Number(v) } })} options={['60', '70', '80', '101'].map(v => ({ value: v, label: v === '101' ? 'Off' : `${v}+` }))} />
              </Row>
              <Row title="Auto-prepare top matches" desc="Hermes drafts full applications for the very best matches on its own. They still wait in “Needs you” — nothing is ever submitted without you.">
                <Segmented
                  size="sm"
                  value={ap.autoPrepareAbove == null ? 'off' : String(ap.autoPrepareAbove)}
                  onChange={v => save({ autopilot: { ...ap, autoPrepareAbove: v === 'off' ? null : Number(v) } })}
                  options={[
                    { value: 'off', label: 'Off' },
                    { value: '85', label: '85+' },
                    { value: '80', label: '80+' },
                    { value: '75', label: '75+' },
                  ]}
                />
              </Row>
            </Card>
          </section>

          <section>
            <SectionTitle>Talk to your board from Hermes</SectionTitle>
            <Card className="p-5">
              <div className="flex items-start gap-3">
                <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
                  <MessageSquareText className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-semibold text-ink">Connect Talaria to Hermes as an MCP server</div>
                  <p className="mt-1 text-[13px] leading-relaxed text-muted">Then chat with Hermes anywhere — the terminal, or Telegram/Discord if you set up its gateway — and ask things like “what needs my input?”, “find me new jobs”, or “summarize what I applied to this week”.</p>
                  <div className="mt-3 flex items-center gap-2 rounded-xl bg-[#121116] px-3.5 py-2.5 font-mono text-[12.5px] text-[#e9e7f2]">
                    <span className="text-[#e7b04c]">$</span>
                    <span className="flex-1 truncate">hermes mcp add talaria --url {mcpUrl}</span>
                    <CopyButton text={`hermes mcp add talaria --url ${mcpUrl}`} className="border-white/15 text-[#e9e7f2] hover:bg-white/10" />
                  </div>
                  <p className="mt-2 text-[12px] text-faint">Talaria must be running for Hermes to reach it.</p>
                </div>
              </div>
            </Card>
          </section>

          <section>
            <SectionTitle>Appearance</SectionTitle>
            <Card className="p-5">
              <Segmented
                value={theme}
                onChange={t => (setTheme(t), setThemePref(t))}
                options={[
                  {
                    value: 'light',
                    label: (
                      <span className="flex items-center gap-1.5">
                        <Sun className="size-3.5" /> Light
                      </span>
                    ),
                  },
                  {
                    value: 'dark',
                    label: (
                      <span className="flex items-center gap-1.5">
                        <Moon className="size-3.5" /> Dark
                      </span>
                    ),
                  },
                  {
                    value: 'system',
                    label: (
                      <span className="flex items-center gap-1.5">
                        <Monitor className="size-3.5" /> System
                      </span>
                    ),
                  },
                ]}
              />
            </Card>
          </section>

          <section>
            <SectionTitle>Data</SectionTitle>
            <Card className="divide-y divide-line-2">
              <Row title="Where your data lives" desc="Everything is stored locally in the data/ folder next to the app. Nothing leaves your computer except prompts Hermes sends to your model provider.">
                <span />
              </Row>
              <Row title="Replay the welcome tour" desc="A quick walk through the board, in case you want a reminder of how it works.">
                <Button variant="outline" onClick={() => setTour(true)}>
                  Show the tour
                </Button>
              </Row>
              <Row title="Start over" desc="Deletes your profile, every job and all history. Can't be undone.">
                <Button
                  variant="outline"
                  className="border-bad/30 text-bad hover:bg-bad-soft"
                  onClick={async () => {
                    const typed = prompt('Type RESET to delete everything and start over.');
                    if (typed === 'RESET') {
                      await api.post('/api/reset', { confirm: 'RESET' });
                      location.reload();
                    }
                  }}
                >
                  Reset everything
                </Button>
              </Row>
            </Card>
          </section>
        </div>
      </div>
    </div>
  );
}

function LinkedInSection() {
  const li = useApp(s => s.settings?.linkedin);
  const enabled = useApp(s => Boolean(s.preferences?.sources.linkedin));
  const sources = useApp(s => s.preferences?.sources);
  const [connecting, setConnecting] = React.useState(false);
  React.useEffect(() => {
    if (li?.connected) setConnecting(false);
  }, [li?.connected]);

  const connect = async () => {
    setConnecting(true);
    try {
      await api.post('/api/linkedin/connect');
      toast('Sign in to LinkedIn in the Talaria browser window that just opened', { duration: 8000 });
    } catch {
      setConnecting(false);
    }
    setTimeout(() => setConnecting(false), 5 * 60_000);
  };

  return (
    <section>
      <SectionTitle>LinkedIn</SectionTitle>
      <Card className="divide-y divide-line-2">
        <Row
          title={li?.connected ? 'Connected' : 'Not connected'}
          desc={
            li?.connected
              ? `Talaria's browser window is signed in to LinkedIn.${li.lastScoutAt ? ` Last searched ${timeAgo(li.lastScoutAt, false)}.` : ''}`
              : "Click Connect, then sign in to LinkedIn yourself in the window that opens. Talaria never sees your password; the sign-in stays saved in Talaria's own browser profile."
          }
        >
          {li?.connected ? (
            <Button variant="outline" onClick={() => api.post('/api/linkedin/disconnect').then(() => toast.success('Signed out of LinkedIn'))}>
              Disconnect
            </Button>
          ) : (
            <Button variant="primary" loading={connecting} onClick={connect}>
              {connecting ? 'Waiting for sign-in' : 'Connect LinkedIn'}
            </Button>
          )}
        </Row>
        <Row
          title="Search LinkedIn for jobs"
          desc="Read-only and slow on purpose: up to 20 postings per search, with human-like pauses. It never uses Easy Apply or touches your profile, messages or network. LinkedIn's terms prohibit automated access, so there's some risk of your account being restricted — keep it off if that worries you."
        >
          <Switch
            checked={enabled}
            disabled={!li?.connected}
            onChange={v => api.put('/api/preferences', { sources: { ...sources, linkedin: v } }).then(() => toast.success(v ? 'LinkedIn added to job searches' : 'LinkedIn removed from job searches'))}
            label="Search LinkedIn"
          />
        </Row>
      </Card>
    </section>
  );
}

type Trial = { text: string; ms: number; seconds: number };

/** Voice typing, test stage: connect a Gemini key and try dictating, before any mic goes into the app. */
function VoiceSection() {
  const voice = useApp(s => s.settings?.voice);
  const [key, setKey] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [state, setState] = React.useState<'idle' | 'recording' | 'transcribing'>('idle');
  const [level, setLevel] = React.useState(0);
  const [seconds, setSeconds] = React.useState(0);
  const [trials, setTrials] = React.useState<Trial[]>([]);
  const [words, setWords] = React.useState<string[] | null>(null);
  const rec = React.useRef<WavRecorder | null>(null);
  const started = React.useRef(0);

  React.useEffect(() => {
    if (state !== 'recording') return;
    const t = setInterval(() => setSeconds(Math.round((Date.now() - started.current) / 1000)), 250);
    return () => clearInterval(t);
  }, [state]);

  const connect = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api.post<{ model: string }>('/api/voice/connect', { key });
      setKey('');
      toast.success(`Gemini connected (${r.model}). Try dictating below.`);
    } finally {
      setBusy(false);
    }
  };

  const toggle = async () => {
    if (state === 'recording' && rec.current) {
      setState('transcribing');
      const secs = (Date.now() - started.current) / 1000;
      const blob = await rec.current.stop();
      rec.current = null;
      setLevel(0);
      try {
        const res = await fetch('/api/voice/transcribe', { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: blob });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Transcription failed');
        setTrials(t => [{ text: data.text || '(no speech heard)', ms: data.ms, seconds: Math.round(secs) }, ...t]);
      } catch (err: any) {
        toast.error(err.message);
      } finally {
        setState('idle');
      }
      return;
    }
    try {
      const r = new WavRecorder();
      await r.start(setLevel);
      rec.current = r;
      started.current = Date.now();
      setSeconds(0);
      setState('recording');
    } catch {
      toast.error('Talaria needs microphone access. Allow it in the address bar, then try again.');
    }
  };

  return (
    <section>
      <SectionTitle>
        Voice typing <Badge tone="gold">Testing</Badge>
      </SectionTitle>
      <Card className="divide-y divide-line-2">
        {!voice?.connected ? (
          <form onSubmit={connect} className="space-y-3 px-5 py-4">
            <div>
              <div className="text-[13.5px] font-medium text-ink">Speak your answers instead of typing</div>
              <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
                Uses Google Gemini to transcribe, with your own names and terms so they're spelled right. Get a free key at{' '}
                <a className="text-accent hover:underline" href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer">
                  aistudio.google.com/app/apikey
                </a>{' '}
                and paste it here. It's stored only on this PC. Your recordings go to Google for transcription.
              </p>
            </div>
            <div className="flex gap-2">
              <Input type="password" autoComplete="off" value={key} onChange={e => setKey(e.target.value)} placeholder="Gemini API key" className="flex-1" />
              <Button type="submit" variant="primary" loading={busy} disabled={key.trim().length < 30}>
                Connect
              </Button>
            </div>
          </form>
        ) : (
          <>
            <Row title={`Connected · ${voice.model}`} desc="Try it below with real answers full of your names (companies, projects, tools…). Once you're happy with the accuracy, the mic goes on Hermes's questions and the chat.">
              <Button variant="outline" onClick={() => api.post('/api/voice/disconnect').then(() => toast.success('Gemini key removed'))}>
                Disconnect
              </Button>
            </Row>
            <div className="space-y-4 px-5 py-5">
              <div className="flex items-center gap-4">
                <button
                  onClick={toggle}
                  disabled={state === 'transcribing'}
                  aria-label={state === 'recording' ? 'Stop recording' : 'Start recording'}
                  className={cn(
                    'relative grid size-14 shrink-0 place-items-center rounded-full transition-colors disabled:opacity-60',
                    state === 'recording' ? 'bg-bad text-white' : 'bg-ink text-bg hover:bg-ink/85',
                  )}
                >
                  {state === 'recording' && <span className="absolute inset-0 rounded-full bg-bad/40" style={{ transform: `scale(${1 + level * 0.6})`, transition: 'transform 80ms' }} />}
                  {state === 'transcribing' ? <Loader2 className="relative size-5 animate-spin" /> : state === 'recording' ? <Square className="relative size-5 fill-current" /> : <Mic className="relative size-6" />}
                </button>
                <div className="text-[13px] text-muted">
                  {state === 'recording' ? (
                    <span className="font-medium text-bad tabular-nums">
                      Recording… {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')} · click to stop
                    </span>
                  ) : state === 'transcribing' ? (
                    'Gemini is transcribing…'
                  ) : (
                    'Click and speak a real answer, then click again to stop.'
                  )}
                </div>
              </div>
              {trials.map((t, i) => (
                <div key={trials.length - i} className="rounded-xl bg-panel p-4">
                  <div className="mb-1.5 text-[11.5px] text-faint">
                    Try {trials.length - i} · {t.seconds}s of speech · transcribed in {(t.ms / 1000).toFixed(1)}s
                  </div>
                  <p className="text-[13.5px] leading-relaxed whitespace-pre-wrap text-ink">{t.text}</p>
                </div>
              ))}
              <div>
                <button className="text-[12px] font-medium text-accent hover:underline" onClick={() => (words ? setWords(null) : api.get<{ words: string[] }>('/api/voice/vocabulary').then(r => setWords(r.words)))}>
                  {words ? 'Hide' : 'Show'} the names it listens for
                </button>
                {words && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {words.map(w => (
                      <span key={w} className="rounded-md bg-ink/[0.05] px-2 py-0.5 text-[11.5px] text-muted dark:bg-white/[0.06]">
                        {w}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </Card>
    </section>
  );
}

function GmailSection() {
  const g = useApp(s => s.settings?.gmail);
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [busy, setBusy] = React.useState<'connect' | 'check' | null>(null);

  const connect = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy('connect');
    try {
      await api.post('/api/gmail/connect', { email, appPassword: password });
      setPassword('');
      toast.success('Gmail connected. Checking for replies now.');
      api.post('/api/gmail/check', {}, { quiet: true }).catch(() => {});
    } finally {
      setBusy(null);
    }
  };
  const check = async () => {
    setBusy('check');
    try {
      await api.post('/api/gmail/check');
    } finally {
      setBusy(null);
    }
  };

  return (
    <section>
      <SectionTitle>Gmail</SectionTitle>
      <Card className="divide-y divide-line-2">
        {g?.connected ? (
          <>
            <Row
              title={`Connected · ${g.email}`}
              desc={
                g.error
                  ? `Last check failed: ${g.error}`
                  : g.lastCheckAt
                    ? `Checked ${timeAgo(g.lastCheckAt, false)}: ${g.lastResult || 'no new replies'}.`
                    : 'Reads replies to the jobs you applied to. Rejections turn the card red; interview invitations move it to Interviewing.'
              }
            >
              <div className="flex gap-2">
                <Button variant="secondary" loading={busy === 'check'} icon={<RefreshCw className="size-3.5" />} onClick={check}>
                  Check now
                </Button>
                <Button variant="outline" onClick={() => api.post('/api/gmail/disconnect').then(() => toast.success('Gmail disconnected and the app password deleted'))}>
                  Disconnect
                </Button>
              </div>
            </Row>
            <Row title="Check automatically" desc="Every 30 minutes while Talaria is running. Only emails about companies you applied to are read, and only those are sent to Hermes to understand.">
              <Switch checked={g.autoCheck !== false} onChange={autoCheck => api.put('/api/settings', { gmail: { ...g, autoCheck } }).then(() => toast.success(autoCheck ? 'Gmail checked every 30 minutes' : 'Gmail checked only when you ask'))} label="Check automatically" />
            </Row>
          </>
        ) : (
          <form onSubmit={connect} className="space-y-4 px-5 py-4">
            <div>
              <div className="text-[13.5px] font-medium text-ink">Track replies from your inbox</div>
              <ol className="mt-1.5 list-decimal space-y-0.5 pl-4 text-[12.5px] leading-relaxed text-muted">
                <li>
                  Turn on{' '}
                  <a className="text-accent hover:underline" href="https://myaccount.google.com/signinoptions/twosv" target="_blank" rel="noopener noreferrer">
                    2-Step Verification
                  </a>{' '}
                  for your Google account, if it isn't already.
                </li>
                <li>
                  Create an{' '}
                  <a className="text-accent hover:underline" href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener noreferrer">
                    app password
                  </a>{' '}
                  named "Talaria" and copy the 16 letters Google shows you.
                </li>
                <li>Paste it below. It's stored only on this PC, and you can revoke it on that same Google page anytime.</li>
              </ol>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Gmail address">
                <Input type="email" autoComplete="off" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@gmail.com" />
              </Field>
              <Field label="App password">
                <Input type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} placeholder="xxxx xxxx xxxx xxxx" />
              </Field>
            </div>
            <div className="flex justify-end">
              <Button type="submit" variant="primary" loading={busy === 'connect'} disabled={!email.trim() || password.replace(/\s/g, '').length < 16}>
                Connect Gmail
              </Button>
            </div>
          </form>
        )}
      </Card>
    </section>
  );
}

function Row({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 px-5 py-4">
      <div className="min-w-0">
        <div className="text-[13.5px] font-medium text-ink">{title}</div>
        {desc && <div className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{desc}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

const PROVIDER_LABEL: Record<string, string> = { copilot: 'GitHub Copilot', anthropic: 'Anthropic', gemini: 'Google Gemini', openrouter: 'OpenRouter', openai: 'OpenAI', 'openai-codex': 'ChatGPT / Codex', nous: 'Nous Portal' };

function ProviderSelect({ value, options, onChange, disabled }: { value: string; options: string[]; onChange: (v: string) => void; disabled?: boolean }) {
  const all = Array.from(new Set([value, 'copilot', 'openai-codex', ...options]));
  return (
    <select disabled={disabled} value={value} onChange={e => onChange(e.target.value)} className="h-9 w-full rounded-lg border border-line bg-card px-2.5 text-[13.5px] text-ink outline-none focus:border-accent/60 disabled:opacity-60">
      {all.map(p => (
        <option key={p} value={p}>
          {PROVIDER_LABEL[p] || p}
        </option>
      ))}
    </select>
  );
}

export function ModelSelect({ value, options, onChange, disabled }: { value: string; options: string[]; onChange: (v: string) => void; disabled?: boolean }) {
  const [custom, setCustom] = React.useState(false);
  const all = Array.from(new Set([value, ...options]));
  if (custom || !options.length)
    return (
      <div className="flex gap-2">
        <Input disabled={disabled} defaultValue={value} placeholder="model id" onBlur={e => e.target.value !== value && onChange(e.target.value.trim())} onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
        {options.length > 0 && (
          <Button variant="ghost" onClick={() => setCustom(false)}>
            List
          </Button>
        )}
      </div>
    );
  return (
    <select
      disabled={disabled}
      value={value}
      onChange={e => (e.target.value === '__custom' ? setCustom(true) : onChange(e.target.value))}
      className="h-9 w-full rounded-lg border border-line bg-card px-2.5 text-[13.5px] text-ink outline-none focus:border-accent/60 disabled:opacity-60"
    >
      {all.map(m => (
        <option key={m} value={m}>
          {m || '— same as main model —'}
        </option>
      ))}
      <option value="__custom">Other…</option>
    </select>
  );
}
