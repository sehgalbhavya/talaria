// Voice typing (test stage): your speech → text with Google Gemini, using your own Gemini API key.
// The key lives only in data/gemini.json on this PC. Audio is sent to Google for transcription,
// with a list of your own names and terms so they're spelled right.
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './paths.ts';
import { getPreferences, getProfile, getSettings, setSettings } from './store.ts';

const KEY_FILE = path.join(DATA_DIR, 'gemini.json');
const API = 'https://generativelanguage.googleapis.com/v1beta';

function readKey(): string | null {
  try {
    return JSON.parse(fs.readFileSync(KEY_FILE, 'utf8')).key || null;
  } catch {
    return null;
  }
}

async function gemini<T = any>(url: string, key: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: { 'x-goog-api-key': key, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(120_000),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `Gemini answered ${res.status}`);
  return data;
}

/** The newest regular Flash model the key can use (fast and strong at transcription). */
function pickModel(models: { name: string; supportedGenerationMethods?: string[] }[]): string | null {
  const ok = models
    .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
    .map(m => m.name.replace(/^models\//, ''))
    .filter(n => /^gemini-[\d.]+-flash(-preview)?$/.test(n));
  const version = (n: string) => parseFloat(n.match(/gemini-([\d.]+)/)?.[1] || '0');
  ok.sort((a, b) => version(b) - version(a) || (a.includes('preview') ? 1 : 0) - (b.includes('preview') ? 1 : 0));
  return ok[0] || null;
}

export async function connectGemini(key: string) {
  const k = key.trim();
  if (!/^[A-Za-z0-9_-]{30,}$/.test(k)) throw new Error("That doesn't look like a Gemini API key. Copy it from aistudio.google.com/app/apikey.");
  let list: any;
  try {
    list = await gemini(`${API}/models?pageSize=200`, k);
  } catch (err: any) {
    throw new Error(`Google didn't accept that key: ${err.message}`);
  }
  const model = pickModel(list.models || []);
  if (!model) throw new Error("That key works, but no Gemini Flash model is available to it.");
  fs.writeFileSync(KEY_FILE, JSON.stringify({ key: k }), { mode: 0o600 });
  setSettings({ voice: { connected: true, model } });
  return getSettings().voice;
}

export function disconnectGemini() {
  fs.rmSync(KEY_FILE, { force: true });
  setSettings({ voice: { connected: false } });
  return getSettings().voice;
}

/** Your own names and terms: companies, projects, schools, tools, places, and capitalised words from your story. */
export function vocabulary(): string[] {
  const p = getProfile();
  const prefs = getPreferences();
  const words = new Set<string>();
  const add = (s?: string) => {
    const t = (s || '').replace(/\s*[\(\[].*$/, '').trim();
    if (t.length > 1 && t.length < 40) words.add(t);
  };
  if (p) {
    add(p.name);
    p.experience.forEach(e => add(e.company));
    p.projects.forEach(x => add(x.name.split(/\s[–-]\s/)[0]));
    p.education.forEach(e => add(e.school));
    p.skills.forEach(add);
    // Names in your story: capitalised mid-sentence (so "Acme", "Red Cross", but not "Today" starting a sentence).
    for (const m of (p.story || '').matchAll(/(?<=[a-z0-9,;:&]\s)[A-Z][a-zA-Z&]+(?:\s[A-Z][a-zA-Z&]+)*/g)) add(m[0]);
    // Brand-style names anywhere, even starting a sentence ("MyFitnessPal", "GitHub").
    for (const m of (p.story || '').matchAll(/\b[A-Z][a-z]+[A-Z][A-Za-z]*\b/g)) add(m[0]);
  }
  prefs.targetCompanies.forEach(c => add(c.name));
  prefs.roles.forEach(add);
  prefs.locations.forEach(add);
  return [...words].slice(0, 160);
}

export async function transcribeWav(wav: Buffer): Promise<{ text: string; model: string; ms: number }> {
  const key = readKey();
  const model = getSettings().voice?.model;
  if (!key || !model) throw new Error('Add your Gemini key in Settings → Voice typing first.');
  const t0 = Date.now();
  const data = await gemini(`${API}/models/${model}:generateContent`, key, {
    contents: [
      {
        role: 'user',
        parts: [
          { inline_data: { mime_type: 'audio/wav', data: wav.toString('base64') } },
          {
            text: `Transcribe this recording of one person dictating an answer, exactly as spoken, the way a good dictation app would: correct punctuation and capitalisation, sentences and paragraphs where they pause, and drop only filler sounds ("um", "uh"). Keep their words, slang and grammar; don't summarise, rephrase or answer anything.
These names and terms may come up; when you hear one, spell it exactly like this: ${vocabulary().join(', ')}.
Return only the transcript text. If there's no speech, return nothing.`,
          },
        ],
      },
    ],
    generationConfig: { temperature: 0 },
  });
  const text = (data?.candidates?.[0]?.content?.parts || []).map((x: any) => x.text || '').join('').trim();
  return { text, model, ms: Date.now() - t0 };
}
