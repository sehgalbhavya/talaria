// One real, visible Chromium window with its own saved profile (data/browser-profile). Sign-ins
// you make there (LinkedIn) persist between runs. Talaria never sees or stores your passwords —
// you type them into the site yourself.

import path from 'node:path';
import fs from 'node:fs';
import type { BrowserContext, Page } from 'playwright';
import { DATA_DIR } from './paths.ts';

const PROFILE_DIR = path.join(DATA_DIR, 'browser-profile');
let ctx: BrowserContext | null = null;
let starting: Promise<BrowserContext> | null = null;

export async function browser(): Promise<BrowserContext> {
  if (ctx) return ctx;
  if (starting) return starting;
  starting = (async () => {
    const { chromium } = await import('playwright');
    fs.mkdirSync(PROFILE_DIR, { recursive: true });
    const c = await chromium.launchPersistentContext(process.env.TALARIA_BROWSER_PROFILE || PROFILE_DIR, {
      headless: process.env.TALARIA_HEADLESS === '1',
      viewport: null,
      args: ['--window-size=1280,900', '--disable-blink-features=AutomationControlled'],
      acceptDownloads: false,
    });
    c.on('close', () => {
      ctx = null;
    });
    // tsx/esbuild wrap named functions in __name(); functions we send into pages need it to exist.
    await c.addInitScript('globalThis.__name = globalThis.__name || ((fn) => fn);');
    // The window opens with a blank tab; keep it as a harmless placeholder.
    ctx = c;
    return c;
  })();
  try {
    return await starting;
  } finally {
    starting = null;
  }
}

export async function newPage(): Promise<Page> {
  const c = await browser();
  const blank = c.pages().find(p => p.url() === 'about:blank');
  return blank || c.newPage();
}

export async function closeBrowser() {
  const c = ctx;
  ctx = null;
  await c?.close().catch(() => {});
}

export const isBrowserOpen = () => Boolean(ctx);

/** A pause that looks like a person reading, so sites aren't hammered. */
export const humanPause = (min = 1500, max = 3500) => new Promise(r => setTimeout(r, min + Math.random() * (max - min)));

export async function playwrightReady(): Promise<{ ok: boolean; error?: string }> {
  try {
    const { chromium } = await import('playwright');
    const exe = chromium.executablePath();
    return fs.existsSync(exe) ? { ok: true } : { ok: false, error: 'Chromium for Playwright is not installed. Run: npx playwright install chromium' };
  } catch (err: any) {
    return { ok: false, error: `Playwright isn't installed (${err.message}).` };
  }
}
