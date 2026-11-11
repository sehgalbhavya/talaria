import * as React from 'react';
import { Bot, Check, Loader, MessageSquareText, Mic, Monitor, Moon, RefreshCw, Square, Sun, TriangleAlert } from 'lucide-react';
import type { Settings } from '@shared/types';
import { api } from '@/lib/api';
import { useApp } from '@/lib/store';
import { cn, timeAgo } from '@/lib/utils';
import { Badge, Button, Card, CopyButton, Field, Input, SectionTitle, Segmented, Switch } from '@/components/ui';
import { StatusDot } from '@/components/brand';
import { BoardTour } from '@/components/BoardTour';
import { PageSectionBlock, RailCard, SectionPage, StatusLine, useSectionJump } from '@/components/SectionPage';
import { navigate } from '@/lib/router';
import { getThemePref, setThemePref, type ThemePref } from '@/lib/theme';
import { toast } from 'sonner';
import { WavRecorder } from '@/lib/recorder';
import { AIConnect, MODEL_HINT } from '@/components/AIConnect';
import { AI_PROVIDERS, aiProviderLabel } from '@shared/aiProviders';
import { aiName } from '@/lib/ai';

const SECTIONS = [
  { id: 'general', label: 'General' },
  { id: 'ai', label: 'AI model' },
  { id: 'automation', label: 'Automation' },
  { id: 'connections', label: 'Connections' },
  { id: 'data', label: 'Data and privacy' },
];

/** How Talaria and its AI run. Everything here saves the moment you change it. */
export function SettingsView() {
  const settings = useApp(s => s.settings)!;
  const ai = useApp(s => s.ai);
  const [models, setModels] = React.useState<Record<string, string[]>>({});
  const [checking, setChecking] = React.useState(false);
  const [theme, setTheme] = React.useState<ThemePref>(getThemePref());
  const [tour, setTour] = React.useState(false);

  const reloadModels = React.useCallback(() => {
    api.get<Record<string, string[]>>('/api/ai/models', { quiet: true }).then(setModels).catch(() => {});
  }, []);
  React.useEffect(reloadModels, [reloadModels]);

  const save = async (patch: Partial<Settings>, msg = 'Saved') => {
    await api.put('/api/settings', patch);
    toast.success(msg);
  };
  const [trying, setTrying] = React.useState<string | null>(null);
  // Never switch models blind: a provider without credentials would break every agent task.
  const tryAndSave = async (provider: string, model: string, field: 'model' | 'tailorModel' = 'model') => {
    if (!model) return save({ ai: { ...h, tailorModel: undefined } });
    setTrying(`${model}`);
    try {
      const r = await api.post<{ ok: boolean; message?: string; latencyMs?: number }>('/api/ai/try', { provider, model });
      if (!r.ok) {
        toast.error(`${model} didn't work: ${r.message}`, { duration: 9000 });
        return;
      }
      // A writing model from another provider wouldn't work after a provider switch, so it's dropped.
      const keepTailor = provider === h.provider || (h.tailorModel && (models[provider] || []).includes(h.tailorModel));
      await save(
        field === 'model' ? { ai: { ...h, provider, model, tailorModel: keepTailor ? h.tailorModel : undefined } } : { ai: { ...h, tailorModel: model } },
        `Switched to ${model}. It answered in ${((r.latencyMs || 0) / 1000).toFixed(1)}s`,
      );
    } finally {
      setTrying(null);
    }
  };
  const h = settings.ai;
  const ap = settings.autopilot;
  const providerModels = models[h.provider] || [];
  const mcpUrl = `${location.protocol}//127.0.0.1:5178/mcp`;

  const check = async () => {
    setChecking(true);
    try {
      await api.post('/api/ai/check');
    } finally {
      setChecking(false);
    }
  };

  return (
    <>
      <BoardTour force={tour} onClose={() => setTour(false)} />
      <SectionPage title="Settings" subtitle="How Talaria and its AI run. Changes here save as soon as you make them." sections={SECTIONS} rail={<StatusRail />}>
        <PageSectionBlock id="general" title="General">
          <Card className="divide-y divide-line-2">
            <Row title="Appearance">
              <Segmented
                size="sm"
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
            </Row>
            <Row title="Replay the welcome tour" desc="A quick walk through the board, in case you want a reminder of how it works.">
              <Button variant="outline" onClick={() => setTour(true)}>
                Show the tour
              </Button>
            </Row>
          </Card>
        </PageSectionBlock>

        <PageSectionBlock id="ai" title="AI model" desc="The AI account and model Talaria uses for every task, and what it's allowed to do.">
          <Card className="overflow-hidden">
            <div className="flex items-center gap-4 border-b border-line-2 p-5">
              <div className={cn('grid size-11 place-items-center ', ai.ok ? 'bg-ok-soft text-ok' : 'bg-warn-soft text-warn')}>{ai.ok ? <Bot className="size-5" /> : <TriangleAlert className="size-5" />}</div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[14.5px] font-semibold text-ink">
                  <StatusDot color={ai.ok ? 'var(--ok)' : 'var(--warn)'} />
                  {ai.ok ? `Connected to ${aiProviderLabel(h.provider)}` : 'Not answering'}
                </div>
                <div className="mt-0.5 truncate text-[12.5px] text-muted">
                  {ai.ok ? `${h.model} · last check ${timeAgo(ai.checkedAt)}${ai.latencyMs ? ` · round trip ${(ai.latencyMs / 1000).toFixed(1)}s` : ''}` : ai.message}
                </div>
              </div>
              <Button variant="secondary" loading={checking} icon={<RefreshCw className="size-4" />} onClick={check}>
                Test
              </Button>
            </div>
            <div className="border-b border-line-2 p-5">
              <AIConnect compact onConnected={reloadModels} />
            </div>
            <div className="grid gap-5 p-5 sm:grid-cols-2">
              <Field
                label={
                  <span className="flex items-center gap-1.5">
                    Model {trying && <Loader className="size-3 animate-spin text-gold" />}
                  </span>
                }
                hint={trying ? `Testing ${trying}…` : MODEL_HINT[h.provider]}
              >
                <ModelSelect value={h.model} options={providerModels} disabled={Boolean(trying)} onChange={model => tryAndSave(h.provider, model)} />
              </Field>
              <Field label="Writing model (optional)" hint="A stronger model just for resumes & cover letters. Leave blank to use the main model.">
                <ModelSelect value={h.tailorModel || ''} options={['', ...providerModels]} disabled={Boolean(trying)} onChange={m => tryAndSave(h.provider, m, 'tailorModel')} />
              </Field>
              <Field label="Parallel tasks" hint="How many AI tasks may run at once.">
                <Segmented size="sm" value={String(h.concurrency)} onChange={v => save({ ai: { ...h, concurrency: Number(v) } })} options={['1', '2', '3', '4'].map(v => ({ value: v, label: v }))} />
              </Field>
            </div>
            <div className="flex items-center justify-between gap-4 border-t border-line-2 px-5 py-4">
              <div>
                <div className="text-[13.5px] font-medium text-ink">Search the web</div>
                <div className="text-[12.5px] leading-relaxed text-muted">
                  {AI_PROVIDERS.find(p => p.id === h.provider)?.webSearch === 'native' ? `Uses ${aiProviderLabel(h.provider)}'s own web search. ` : 'Uses free web search (DuckDuckGo) and reads pages from this computer. '}
                  Needed for the web search source and PhD search in{' '}
                  <button onClick={() => navigate({ view: 'search', section: 'where' })} className="text-accent hover:underline">
                    Job search
                  </button>
                  . Slower, but finds roles beyond the job boards.
                </div>
              </div>
              <Switch checked={h.webSearch} onChange={webSearch => save({ ai: { ...h, webSearch } }, webSearch ? `${aiName()} can search the web` : `${aiName()} won't search the web`)} label="Search the web" />
            </div>
          </Card>
        </PageSectionBlock>

        <PageSectionBlock id="automation" title="Automation" desc={`How much ${aiName()} does on its own, from least to most hands-off. Nothing is ever submitted unless you turn on the last one.`}>
          <Card className="divide-y divide-line-2">
            <Row step={1} title="Search automatically" desc={`Scouts for new jobs every ${ap.scoutEveryHours} hours while Talaria is running.${ap.lastScoutAt ? ` Last search ${timeAgo(ap.lastScoutAt, false)}.` : ''}`}>
              <div className="flex items-center gap-3">
                <Segmented size="sm" value={String(ap.scoutEveryHours)} onChange={v => save({ autopilot: { ...ap, scoutEveryHours: Number(v) } })} options={['6', '12', '24', '48'].map(v => ({ value: v, label: `${v}h` }))} />
                <Switch checked={ap.enabled} onChange={enabled => save({ autopilot: { ...ap, enabled } }, enabled ? 'Autopilot on' : 'Autopilot off')} label="Search automatically" />
              </div>
            </Row>
            <Row step={2} title="Pre-analyze promising jobs" desc={`${aiName()} writes the full fit analysis for new jobs that score at least this high, so it's ready when you open them.`}>
              <Segmented size="sm" value={String(ap.autoAnalyzeAbove)} onChange={v => save({ autopilot: { ...ap, autoAnalyzeAbove: Number(v) } })} options={['60', '70', '80', '101'].map(v => ({ value: v, label: v === '101' ? 'Off' : `${v}+` }))} />
            </Row>
            <Row
              step={3}
              title="Ask me before drafting"
              desc={`When you hand a job to ${aiName()}, it first asks you a few questions (why this company, what to lead with, details your resume doesn't show) and drafts from your answers. Turn off to have ${aiName()} draft straight away.`}
            >
              <Switch
                checked={settings.apply?.interviewFirst !== false}
                onChange={interviewFirst => save({ apply: { ...settings.apply, interviewFirst } }, interviewFirst ? `${aiName()} will ask before drafting` : `${aiName()} will draft straight away`)}
                label="Ask me first"
              />
            </Row>
            <Row step={4} title="Auto-prepare top matches" desc={`${aiName()} drafts full applications for the very best matches on its own. They still wait in “Needs you”.`}>
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
            <Row
              step={5}
              title="Submit applications for me"
              desc="After you approve an application, Talaria opens the company's form (Greenhouse, Lever or Ashby) in its own browser window, fills every field, uploads your tailored resume and cover letter, and submits. It stops and asks you if the form needs something it doesn't know, or if a CAPTCHA appears. Other job sites use the Apply kit."
            >
              <Switch checked={settings.apply?.autoSubmit ?? false} onChange={autoSubmit => save({ apply: { ...settings.apply, autoSubmit } }, autoSubmit ? 'Talaria will submit approved applications' : 'Approved applications open the Apply kit instead')} label="Submit for me" />
            </Row>
          </Card>
        </PageSectionBlock>

        <PageSectionBlock id="connections" title="Connections" desc="Accounts and keys. What they're used for is chosen where it's used.">
          <div className="space-y-4">
            <LinkedInSection />
            <GmailSection />
            <VoiceSection />
            <Card className="p-5">
              <div className="flex items-start gap-3">
                <div className="grid size-9 shrink-0 place-items-center bg-accent-soft text-accent">
                  <MessageSquareText className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-semibold text-ink">Talk to your board from an AI app</div>
                  <p className="mt-1 text-[13px] leading-relaxed text-muted">Talaria is also an MCP server. Add it to an AI app that supports MCP (Claude Code, Codex, Cursor and others), then ask things like “what needs my input?”, “find me new jobs”, or “summarize what I applied to this week”.</p>
                  <div className="mt-3 flex items-center gap-2 bg-[#121116] px-3.5 py-2.5 font-mono text-[12.5px] text-[#e9e7f2]">
                    <span className="text-[#e7b04c]">MCP URL</span>
                    <span className="min-w-0 flex-1 truncate">{mcpUrl}</span>
                    <CopyButton text={mcpUrl} className="border-white/15 text-[#e9e7f2] hover:bg-white/10" />
                  </div>
                  <p className="mt-2 text-[12px] text-faint">For example: claude mcp add --transport http talaria {mcpUrl}. Talaria must be running for the app to reach it.</p>
                </div>
              </div>
            </Card>
          </div>
        </PageSectionBlock>

        <PageSectionBlock id="data" title="Data and privacy">
          <div className="space-y-3">
            <Card>
              <Row title="Where your data lives" desc="Everything is stored locally in the data/ folder next to the app. Nothing leaves your computer except prompts sent to your AI provider, web searches, and recordings sent to Google if you use voice typing.">
                <span />
              </Row>
            </Card>
            <Card className="ring-1 ring-bad/20">
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
          </div>
        </PageSectionBlock>
      </SectionPage>
    </>
  );
}

/** What's on, what's broken and when things last ran, each linking to where you fix it. */
function StatusRail() {
  const ai = useApp(s => s.ai);
  const settings = useApp(s => s.settings);
  const jump = useSectionJump();
  if (!settings) return null;
  const ap = settings.autopilot;
  const g = settings.gmail;
  const paused = ai.rateLimitedUntil && Date.parse(ai.rateLimitedUntil) > Date.now();
  const next = (() => {
    if (!ap.enabled) return null;
    const due = (ap.lastScoutAt ? Date.parse(ap.lastScoutAt) : 0) + ap.scoutEveryHours * 3600_000 - Date.now();
    if (due <= 0) return 'soon';
    const hrs = Math.floor(due / 3600_000);
    return hrs >= 1 ? `in ${hrs}h` : `in ${Math.max(1, Math.round(due / 60_000))}m`;
  })();
  return (
    <RailCard title="Status">
      <StatusLine
        tone={paused ? 'warn' : ai.ok ? 'ok' : 'bad'}
        title={paused ? 'AI paused' : ai.ok ? 'AI connected' : 'AI not answering'}
        detail={paused ? `Rate limit · resumes ${new Date(ai.rateLimitedUntil!).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ai.ok ? `${aiProviderLabel(ai.provider)} · ${ai.model}` : ai.message}
        onClick={() => jump('ai')}
      />
      <StatusLine tone={settings.ai.webSearch ? 'ok' : 'off'} title={settings.ai.webSearch ? 'Web search on' : 'Web search off'} onClick={() => jump('ai')} />
      <StatusLine tone={ap.enabled ? 'ok' : 'off'} title={ap.enabled ? 'Autopilot on' : 'Autopilot off'} detail={ap.enabled ? `Next search ${next}` : 'Searches only when you ask'} onClick={() => jump('automation')} />
      <StatusLine tone={settings.linkedin.connected ? 'ok' : 'off'} title={settings.linkedin.connected ? 'LinkedIn connected' : 'LinkedIn not connected'} onClick={() => jump('connections')} />
      <StatusLine
        tone={!g?.connected ? 'off' : g.error ? 'warn' : 'ok'}
        title={g?.connected ? 'Gmail connected' : 'Gmail not connected'}
        detail={g?.connected ? (g.error ? `Last check failed` : g.lastCheckAt ? `Checked ${timeAgo(g.lastCheckAt, false)}` : undefined) : undefined}
        onClick={() => jump('connections')}
      />
      <StatusLine tone={settings.voice?.connected ? 'ok' : 'off'} title={settings.voice?.connected ? 'Voice typing set up' : 'Voice typing not set up'} onClick={() => jump('connections')} />
    </RailCard>
  );
}

export function LinkedInSection() {
  const li = useApp(s => s.settings?.linkedin);
  const enabled = useApp(s => Boolean(s.preferences?.sources.linkedin));
  const [connecting, setConnecting] = React.useState(false);
  React.useEffect(() => {
    if (li?.connected) setConnecting(false);
  }, [li?.connected]);

  const connect = async () => {
    setConnecting(true);
    try {
      await api.post('/api/linkedin/connect');
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
          title={enabled ? 'Searched for jobs' : 'Not searched for jobs'}
          desc="Whether Talaria searches LinkedIn for jobs is part of your job search."
        >
          <Button variant="ghost" onClick={() => navigate({ view: 'search', section: 'where' })}>
            Job search sources
          </Button>
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
            <Row title={`Connected · ${voice.model}`} desc={`Try it below with real answers full of your names (companies, projects, tools…). Once you're happy with the accuracy, the mic goes on ${aiName()}'s questions and the chat.`}>
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
                    'relative grid size-14 shrink-0 place-items-center transition-colors disabled:opacity-60',
                    state === 'recording' ? 'bg-bad text-white' : 'bg-ink text-bg hover:bg-ink/85',
                  )}
                >
                  {state === 'recording' && <span className="absolute inset-0 bg-bad/40" style={{ transform: `scale(${1 + level * 0.6})`, transition: 'transform 80ms' }} />}
                  {state === 'transcribing' ? <Loader className="relative size-5 animate-spin" /> : state === 'recording' ? <Square className="relative size-5 fill-current" /> : <Mic className="relative size-6" />}
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
                <div key={trials.length - i} className="bg-panel p-4">
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
                      <span key={w} className="bg-ink/[0.05] px-2 py-0.5 text-[11.5px] text-muted dark:bg-white/[0.06]">
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

export function GmailSection() {
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
            <Row title="Check automatically" desc={`Every 30 minutes while Talaria is running. Only emails about companies you applied to are read, and only those are sent to ${aiName()} to understand.`}>
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

function Row({ title, desc, children, step }: { title: string; desc?: string; children: React.ReactNode; step?: number }) {
  return (
    <div className="flex items-center justify-between gap-6 px-5 py-4">
      <div className="flex min-w-0 flex-1 gap-3">
        {step != null && <span className="mt-px grid size-5 shrink-0 place-items-center border border-line text-[10.5px] font-semibold text-muted tabular-nums">{step}</span>}
        <div className="min-w-0">
          <div className="text-[13.5px] font-medium text-ink">{title}</div>
          {desc && <div className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{desc}</div>}
        </div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
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
      className="h-9 w-full border border-line bg-card px-2.5 text-[13.5px] text-ink outline-none focus:border-accent/60 disabled:opacity-60"
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
