// Auto-apply: opens the company's application form in Talaria's browser window, fills every
// field from your approved application, uploads your tailored resume/cover letter, answers the
// questions and submits. Only runs for applications you approved. If it meets a CAPTCHA or a
// required question it can't answer, it stops with the window open so you can finish.

import fs from 'node:fs';
import path from 'node:path';
import type { Page } from 'playwright';
import type { Job } from '../../shared/types.ts';
import { DATA_DIR } from '../lib/paths.ts';
import { newPage } from '../lib/browser.ts';
import { askJson, finishRun, startRun, type RunHandle } from '../lib/hermes.ts';
import { toast } from '../lib/events.ts';
import { getJob, getPreferences, getProfile, listAnswers, now, updateJob } from '../lib/store.ts';
import { compileLatex } from '../lib/latex.ts';
import { coverLetterPdf, resumePdf } from '../lib/resumePdf.tsx';
import { addChat, markApplied } from './pipeline.ts';

export type Ats = 'greenhouse' | 'lever' | 'ashby';

/** Which supported ATS form a job applies through, and the form's URL. */
export function applyTarget(job: Job): { ats: Ats; url: string } | null {
  const candidates = [job.applyUrl, job.url].filter(Boolean) as string[];
  for (const raw of candidates) {
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      continue;
    }
    const parts = u.pathname.split('/').filter(Boolean);
    if (/greenhouse\.io$/.test(u.hostname) && parts[1] === 'jobs' && parts[2]) return { ats: 'greenhouse', url: `https://job-boards.greenhouse.io/${parts[0]}/jobs/${parts[2]}` };
    if (u.hostname === 'jobs.lever.co' && parts.length >= 2) return { ats: 'lever', url: `https://jobs.lever.co/${parts[0]}/${parts[1]}/apply` };
    if (u.hostname === 'jobs.ashbyhq.com' && parts.length >= 2) return { ats: 'ashby', url: `https://jobs.ashbyhq.com/${parts[0]}/${parts[1]}/application` };
  }
  // Greenhouse jobs found through the API carry "slug:id" even when the public URL is the company site.
  if (job.source === 'greenhouse' && job.sourceId.includes(':')) {
    const [slug, id] = job.sourceId.split(':');
    return { ats: 'greenhouse', url: `https://job-boards.greenhouse.io/${slug}/jobs/${id}` };
  }
  return null;
}

// ---------------- reading the form ----------------

export interface FormField {
  id: string;
  kind: 'text' | 'email' | 'tel' | 'url' | 'number' | 'textarea' | 'select' | 'combobox' | 'radio' | 'checkbox' | 'file' | 'date';
  label: string;
  name: string;
  required: boolean;
  options: string[];
  multiple?: boolean;
}

/** Tags every fillable control with data-talaria="fN" and describes it. Runs inside the page. */
export async function readForm(page: Page): Promise<FormField[]> {
  return page.evaluate(() => {
    const clean = (s: string | null | undefined) => (s || '').replace(/\s+/g, ' ').replace(/\*/g, '').trim();
    const visible = (el: Element) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      const st = getComputedStyle(el as HTMLElement);
      return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
    };
    const container = (el: Element) => el.closest('fieldset, .field, .application-question, .application-field, [class*="_fieldEntry"], [class*="field-wrapper"], [class*="question"], .form-group, li') || el.parentElement;
    const labelOf = (el: HTMLElement): string => {
      if (el.id) {
        const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (l) return clean((l as HTMLElement).innerText);
      }
      const by = el.getAttribute('aria-labelledby');
      if (by) {
        const t = by.split(/\s+/).map(i => document.getElementById(i)?.innerText || '').join(' ');
        if (clean(t)) return clean(t);
      }
      const aria = el.getAttribute('aria-label');
      if (aria) return clean(aria);
      const wrap = el.closest('label');
      if (wrap && clean(wrap.innerText)) return clean(wrap.innerText);
      const box = container(el);
      const l = box?.querySelector('legend, label, .application-label, [class*="label"], [class*="Label"]') as HTMLElement | null;
      if (l && clean(l.innerText)) return clean(l.innerText);
      return clean(el.getAttribute('placeholder') || el.getAttribute('name') || '');
    };
    // The question's own text: walk up until a block has text that isn't just the option labels.
    const blockText = (el: HTMLElement, optionTexts: string[] = []): string => {
      let a: HTMLElement | null = el.parentElement;
      for (let i = 0; i < 6 && a; i++, a = a.parentElement) {
        // Read a copy without the controls themselves, so option lists don't leak into the label.
        const copy = a.cloneNode(true) as HTMLElement;
        copy.querySelectorAll('select, option, input, textarea, ul, [role="listbox"], button').forEach(n => n.remove());
        let t = clean(copy.textContent);
        for (const o of optionTexts) if (o) t = t.split(o).join(' ');
        t = clean(t);
        if (t.length > 2) return t.slice(0, 220);
      }
      return '';
    };
    const isOptionish = (s: string) => /^(yes|no|true|false)$/i.test(s) || s.length < 2;
    const requiredOf = (el: HTMLElement) => {
      if ((el as HTMLInputElement).required || el.getAttribute('aria-required') === 'true') return true;
      const box = container(el);
      return Boolean(box && /\*|required/i.test((box.querySelector('label, legend, [class*="label"]') as HTMLElement | null)?.innerText || ''));
    };

    const fields: any[] = [];
    let n = 0;
    const seenGroups = new Set<string>();
    const controls = document.querySelectorAll<HTMLElement>('input, textarea, select');
    for (const el of controls) {
      const input = el as HTMLInputElement;
      const type = (input.type || el.tagName).toLowerCase();
      if (['hidden', 'submit', 'button', 'reset', 'image', 'search'].includes(type)) continue;
      if (type !== 'file' && !visible(el) && !(type === 'radio' || type === 'checkbox')) continue;
      if (el.closest('[aria-hidden="true"]') && type !== 'file') continue;

      if (type === 'radio' || type === 'checkbox') {
        const group = input.name || el.id;
        const siblings = input.name ? [...document.querySelectorAll<HTMLInputElement>(`input[type="${type}"][name="${CSS.escape(input.name)}"]`)] : [input];
        if (type === 'radio' || siblings.length > 1) {
          if (seenGroups.has(group)) continue;
          seenGroups.add(group);
          const id = `f${n++}`;
          siblings.forEach((s, i) => s.setAttribute('data-talaria', `${id}.${i}`));
          const optLabel = (s: HTMLInputElement) => (s.id && clean((document.querySelector(`label[for="${CSS.escape(s.id)}"]`) as HTMLElement | null)?.innerText)) || clean(s.closest('label')?.innerText) || s.value;
          const opts = siblings.map(optLabel);
          const fs = el.closest('fieldset');
          const q = el.closest('.application-question, [data-field-path]') as HTMLElement | null;
          const label =
            clean((fs?.querySelector('legend') as HTMLElement | null)?.innerText) ||
            clean((q?.querySelector('.application-label, label:not(:has(input))') as HTMLElement | null)?.innerText) ||
            blockText(el.closest('ul, [role="radiogroup"], [role="group"]') as HTMLElement || el, opts);
          fields.push({ id, kind: type, label, name: input.name, required: requiredOf(el), options: opts, multiple: type === 'checkbox' });
          continue;
        }
        const id = `f${n++}`;
        el.setAttribute('data-talaria', id);
        fields.push({ id, kind: 'checkbox', label: labelOf(el), name: input.name, required: requiredOf(el), options: [] });
        continue;
      }

      const id = `f${n++}`;
      el.setAttribute('data-talaria', id);
      if (type === 'file') {
        // Upload widgets are usually labelled "Attach"/"Upload"; the field's real name sits above.
        let label = labelOf(el);
        if (!label || /^(attach|upload|browse|choose file|drop)/i.test(label)) {
          let box: HTMLElement | null = el.parentElement;
          for (let i = 0; i < 5 && box; i++, box = box.parentElement) {
            const t = clean(box.innerText).split(/attach|upload|dropbox|browse/i)[0];
            if (t.length > 2) {
              label = t.slice(0, 60);
              break;
            }
          }
        }
        fields.push({ id, kind: 'file', label, name: input.name || el.id, required: requiredOf(el), options: [] });
        continue;
      }
      let kind = el.tagName === 'TEXTAREA' ? 'textarea' : el.tagName === 'SELECT' ? 'select' : type;
      if (el.getAttribute('role') === 'combobox' || el.getAttribute('aria-autocomplete') === 'list') kind = 'combobox';
      if (!['text', 'email', 'tel', 'url', 'number', 'textarea', 'select', 'combobox', 'file', 'date'].includes(kind)) kind = 'text';
      const options = el.tagName === 'SELECT' ? [...(el as HTMLSelectElement).options].map(o => clean(o.textContent)).filter(o => o && !/^select|^choose|^--/i.test(o)) : [];
      let label = labelOf(el);
      // Unhelpful labels (an input name like "cards[…][field0]", a placeholder, "Yes", or a select whose
      // "label" is really its option list) → use the question block's text with the options removed.
      const optionSoup = options.length > 2 && options.slice(0, 3).every(o => label.includes(o));
      if (!label || optionSoup || /[\[\]]/.test(label) || label === (input.name || '') || /^(type (your|here)|select\.*|choose)/i.test(label) || isOptionish(label)) {
        label = blockText(el, options) || label;
      }
      label = label.replace(/^(select|choose)\.*\s*/i, '').slice(0, 200);
      fields.push({ id, kind, label, name: input.name || el.id, required: requiredOf(el), options });
    }
    return fields;
  });
}

// ---------------- deciding what goes in each field ----------------

const lc = (s: string) => s.toLowerCase();

function standardValue(f: FormField, ctx: { first: string; last: string; full: string; email: string; phone: string; location: string; linkedin?: string; github?: string; portfolio?: string; company?: string; title?: string }): string | undefined {
  // Only free-text inputs: a dropdown whose options mention "LinkedIn" is a "how did you hear" question.
  if (!['text', 'email', 'tel', 'url', 'textarea'].includes(f.kind)) return undefined;
  const l = lc(`${f.label} ${f.name}`);
  if (/first.?name|given.?name|fname/.test(l)) return ctx.first;
  if (/last.?name|family.?name|surname|lname/.test(l)) return ctx.last;
  if (/preferred.?name/.test(l)) return ctx.first;
  if (/^(full )?name\b|\bfull.?name|your name|^name$/.test(lc(f.label)) || f.name === 'name') return ctx.full;
  if (f.kind === 'email' || /e-?mail/.test(l)) return ctx.email;
  if (f.kind === 'tel' || /phone|mobile/.test(l)) return ctx.phone;
  if (/linkedin/.test(l)) return ctx.linkedin;
  if (/github/.test(l)) return ctx.github;
  if (/portfolio|personal (web)?site|website|other website/.test(l)) return ctx.portfolio;
  if (/current (company|employer)|^org$|organi[sz]ation/.test(l)) return ctx.company;
  if (/current (title|role|position)/.test(l)) return ctx.title;
  if (/^(location|city|current location|where are you (based|located))/.test(lc(f.label))) return ctx.location;
  return undefined;
}

const FILL_PROMPT = (o: { fields: string; facts: string; job: string; coverLetter: string }) => `You are filling in a job application form for ONE candidate. Decide the value for each field below.

JOB: ${o.job}

WHAT WE KNOW ABOUT THE CANDIDATE (true facts — use only these)
${o.facts}

COVER LETTER (for any "cover letter"/"why us" free-text field, adapt from this)
${o.coverLetter.slice(0, 2500)}

FIELDS (id · kind · label · options)
${o.fields}

Return ONLY JSON: {"values": {"<id>": <value>}, "missing": [{"id": "<id>", "question": "<what to ask the candidate>"}]}
Rules:
- select/radio/combobox: the value must be EXACTLY one of the listed options. A combobox with no options listed is a type-to-search box: give the plain value to type (e.g. a country or city name). Checkbox group: an array of options.
- Single checkbox: if it's a yes/no question, answer "Yes" or "No"; if it's a consent/acknowledgement/terms box, answer true.
- Demographic / EEO / diversity questions (gender, age, race, ethnicity, nationality/culture, veteran, disability, health, neurodiversity, sexual orientation, caregiving): choose the "decline / prefer not to say / don't wish to answer / does not apply" option if there is one. If there isn't, leave the field out entirely — NEVER guess personal characteristics, even optional ones.
- Never invent facts. If a REQUIRED field needs information that isn't in the facts, leave it out of "values" and add it to "missing" with a short question. Optional fields you can't answer: leave out.
- Free-text answers: specific, first person, 40–120 words, no em dashes. Answer OPTIONAL free-text questions too (motivation, "why us", favourite project, anything else to share) whenever the facts or cover letter support it — they strengthen the application.
- Work authorization, visa / sponsorship, relocation, notice period, salary: answer ONLY if the facts state it. Otherwise put the field in "missing" even if it's optional.
- Skip file fields.`;

function facts(job: Job): string {
  const p = getProfile()!;
  const prefs = getPreferences();
  const lines = [
    `Name: ${p.name}; email ${p.email}; phone ${p.phone}; based in ${p.location}`,
    `Headline: ${p.headline}`,
    `Links: ${p.links.map(l => `${l.label} ${l.url}`).join(', ')}`,
    `Most recent role: ${p.experience[0] ? `${p.experience[0].title} at ${p.experience[0].company} (${p.experience[0].start} – ${p.experience[0].end})` : 'n/a'}`,
    `Years of experience: ${p.yearsExperience ?? 'n/a'}`,
    `Education: ${p.education.map(e => `${e.degree} ${e.field || ''}, ${e.school} (${e.end || ''})`).join('; ')}`,
    `Skills: ${p.skills.slice(0, 30).join(', ')}`,
    prefs.needsSponsorship != null ? `Needs visa sponsorship: ${prefs.needsSponsorship ? 'yes' : 'no'}` : '',
    prefs.minSalary ? `Salary expectation: ${prefs.minSalary} ${prefs.currency}` : '',
    `Open to relocation within Europe: ${/relocat/i.test(p.resumeText) ? 'yes' : 'unknown'}`,
    'Heard about the role via: LinkedIn / job board search',
  ];
  for (const q of job.questions.filter(q => q.answer)) lines.push(`Q: ${q.question} A: ${q.answer}`);
  for (const a of listAnswers().slice(0, 40)) lines.push(`Q: ${a.question} A: ${a.answer}`);
  for (const a of job.packet?.answers || []) lines.push(`Q: ${a.question} A: ${a.answer}`);
  return lines.filter(Boolean).join('\n');
}

// ---------------- filling ----------------

function best(options: string[], want: string): string | undefined {
  const w = lc(want).trim();
  return options.find(o => lc(o) === w) || options.find(o => lc(o).startsWith(w)) || options.find(o => lc(o).includes(w)) || options.find(o => w.includes(lc(o)));
}

export async function fillField(page: Page, f: FormField, value: unknown): Promise<boolean> {
  const sel = `[data-talaria="${f.id}"]`;
  try {
    switch (f.kind) {
      case 'file':
        await page.setInputFiles(sel, String(value));
        return true;
      case 'select': {
        const opt = best(f.options, String(value));
        if (!opt) return false;
        await page.selectOption(sel, { label: opt });
        return true;
      }
      case 'combobox': {
        const el = page.locator(sel);
        await el.click();
        await el.fill(String(value));
        await page.waitForTimeout(600);
        const option = page.getByRole('option', { name: new RegExp(String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }).first();
        if (await option.count()) await option.click();
        else await el.press('Enter');
        return true;
      }
      case 'radio':
      case 'checkbox': {
        if (!f.options.length) {
          const yes = value === true || /^(yes|true|i agree|agree)$/i.test(String(value));
          // Ashby-style yes/no: real Yes/No buttons sitting over a hidden checkbox.
          const box = page.locator(sel).locator('xpath=ancestor::*[.//button[normalize-space()="Yes"] and .//button[normalize-space()="No"]][1]');
          if (await box.count()) {
            await box.locator(`button:text-is("${yes ? 'Yes' : 'No'}")`).first().click();
            return true;
          }
          if (yes) await page.locator(sel).check({ force: true });
          return true;
        }
        const wants = Array.isArray(value) ? value.map(String) : [String(value)];
        let any = false;
        for (const w of wants) {
          const opt = best(f.options, w);
          if (!opt) continue;
          await page.locator(`[data-talaria="${f.id}.${f.options.indexOf(opt)}"]`).check({ force: true });
          any = true;
        }
        return any;
      }
      default: {
        const el = page.locator(sel);
        // Location fields often autocomplete and only keep a value picked from the suggestions —
        // and only search on real keystrokes.
        if (/location|city|where/i.test(f.label)) {
          await el.fill('');
          await el.pressSequentially(String(value).split(',')[0], { delay: 70 });
          await page.waitForTimeout(1500);
          const suggestion = page.locator('[role="option"]:visible, .dropdown-results .dropdown-location:visible, .pac-item:visible').first();
          if (await suggestion.count()) await suggestion.click().catch(() => {});
          else await el.fill(String(value));
          return true;
        }
        await el.fill(String(value));
        return true;
      }
    }
  } catch {
    return false;
  }
}

async function writeFiles(job: Job): Promise<{ resume: string; cover?: string }> {
  const dir = path.join(DATA_DIR, 'applications', job.id);
  fs.mkdirSync(dir, { recursive: true });
  const p = job.packet!;
  const safe = (s: string) => s.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '');
  const name = safe(p.resume.name || 'Resume');
  let resumeBuf: Buffer | undefined;
  if (p.latex) {
    const c = await compileLatex(p.latex);
    if (c.ok) resumeBuf = c.pdf;
  }
  if (!resumeBuf) resumeBuf = await resumePdf(p.resume);
  const resume = path.join(dir, `${name}_Resume.pdf`);
  fs.writeFileSync(resume, resumeBuf);
  let cover: string | undefined;
  if (p.coverLetter?.trim()) {
    cover = path.join(dir, `${name}_Cover_Letter.pdf`);
    fs.writeFileSync(cover, await coverLetterPdf(p.resume, p.coverLetter, job.company));
  }
  return { resume, cover };
}

/** Comboboxes (searchable dropdowns) only reveal options when opened; peek at short lists. */
export async function readComboOptions(page: Page, fields: FormField[]) {
  for (const f of fields.filter(x => x.kind === 'combobox').slice(0, 30)) {
    try {
      const el = page.locator(`[data-talaria="${f.id}"]`);
      await el.click({ timeout: 3000 });
      await page.waitForTimeout(350);
      const opts = (await page.getByRole('option').allInnerTexts()).map(o => o.replace(/\s+/g, ' ').trim()).filter(Boolean);
      // Long lists (countries, cities) are searched by typing instead.
      f.options = opts.length <= 40 ? opts : [];
      await page.keyboard.press('Escape');
      await page.waitForTimeout(150);
    } catch {}
  }
}

export async function openForm(page: Page, ats: Ats, url: string) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(2500);
  const title = await page.title().catch(() => '');
  const body = (await page.locator('body').innerText().catch(() => '')).slice(0, 2000);
  if (/404|not found/i.test(title) || /no longer (accepting|available|open)|couldn.t find anything here|job not found|job (posting )?(has )?(been )?closed|position has been filled/i.test(body)) {
    throw new Error('This posting has closed — the company is no longer accepting applications.');
  }
  // Greenhouse and Ashby show the description first; jump to the form.
  const applyBtn = page.locator('button:has-text("Apply"), a:has-text("Apply for this job"), a:has-text("Apply")').first();
  if (ats !== 'lever' && (await page.locator('input[type="file"]').count()) === 0 && (await applyBtn.count())) {
    await applyBtn.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(2000);
  }
  await page.waitForSelector('input[type="file"], input[type="email"], input[name*="email" i]', { timeout: 20000 });
}

const AUTH = /authori[sz]ed to work|right to work|work permit|eligib\w* to work|legally (able|allowed|authori[sz]ed)|sponsor|visa/i;

/** Whether you've ever told Talaria your work-authorization and sponsorship situation. */
function knownLegalFacts() {
  const answers = listAnswers();
  return {
    authorization: answers.some(a => /authori[sz]|right to work|work permit|eligib|legally/i.test(a.question)),
    sponsorship: getPreferences().needsSponsorship != null || answers.some(a => /sponsor|visa/i.test(a.question)),
  };
}

const DEMOGRAPHIC =/gender|sex\b|age\b|how old|race|ethnic|nationality|culture|veteran|disabilit|health condition|neurodiver|sexual|lgbt|pronoun|caregiv|under-?represented|religio/i;
const DECLINE = /decline|prefer not|don.?t (wish|want)|not (wish|want) to|rather not|not apply|n\/a|does not apply|no answer/i;

/** Which tagged fields are still empty after filling (searchable dropdowns are trusted). */
async function emptyFields(page: Page, fields: FormField[]): Promise<Set<string>> {
  const ids = await page.evaluate((list: { id: string; kind: string; options: number }[]) => {
    const out: string[] = [];
    for (const f of list) {
      if (f.kind === 'combobox') continue;
      if ((f.kind === 'radio' || f.kind === 'checkbox') && f.options > 0) {
        const any = [...document.querySelectorAll<HTMLInputElement>(`[data-talaria^="${f.id}."]`)].some(i => i.checked);
        if (!any) out.push(f.id);
        continue;
      }
      const el = document.querySelector<HTMLInputElement>(`[data-talaria="${f.id}"]`);
      if (!el) continue;
      if (f.kind === 'checkbox') {
        // Yes/No button widgets keep their hidden checkbox unchecked for "No" — don't flag those.
        const hasButtons = el.closest('div')?.parentElement?.querySelector('button');
        if (!el.checked && !hasButtons) out.push(f.id);
      } else if (f.kind === 'file') {
        if (!el.files || el.files.length === 0) out.push(f.id);
      } else if (!String(el.value || '').trim()) out.push(f.id);
    }
    return out;
  }, fields.map(f => ({ id: f.id, kind: f.kind, options: f.options.length })));
  return new Set(ids);
}

const CAPTCHA ='iframe[src*="hcaptcha"], iframe[src*="recaptcha"], iframe[title*="challenge" i], .h-captcha, .g-recaptcha';
const SUCCESS = /thank you for applying|thanks for applying|application (has been )?(submitted|received)|we('ve| have) received your application|successfully submitted/i;

export interface ApplyResult {
  status: 'submitted' | 'needs_you' | 'dry_run' | 'failed';
  filled: number;
  total: number;
  missing: { label: string; question: string }[];
  report?: { label: string; kind: string; required: boolean; value?: string; ok: boolean }[];
  message: string;
  screenshot?: string;
}

/**
 * Fill (and unless dryRun, submit) the application for an approved job.
 * dryRun fills everything but never clicks submit — used for testing on real forms.
 */
export async function autoApply(jobId: string, opts: { dryRun?: boolean; handle?: RunHandle } = {}): Promise<ApplyResult> {
  const job = getJob(jobId);
  if (!job?.packet) throw new Error('Prepare and approve this application first.');
  if (!opts.dryRun && !job.packet.approvedAt) throw new Error('Approve the application before Talaria submits it.');
  const target = applyTarget(job);
  if (!target) throw new Error("Talaria can only auto-apply on Greenhouse, Lever and Ashby forms. Use the Apply kit for this one.");
  const profile = getProfile()!;
  const h = opts.handle || startRun('submit', `${opts.dryRun ? 'Test-filling' : 'Applying to'} ${job.title} @ ${job.company}`, jobId);
  const step = (s: string) => {
    h.log(s);
    if (!opts.dryRun) updateJob(jobId, j => (j.work.submit = { state: 'running', step: s, at: now() }));
  };

  const page = await newPage();
  try {
    step('Preparing your documents');
    const files = await writeFiles(job);
    step('Opening the application form');
    await openForm(page, target.ats, target.url);
    await page.bringToFront().catch(() => {});

    const fields = await readForm(page);
    await readComboOptions(page, fields);
    step(`Filling ${fields.length} fields`);
    const [first, ...rest] = profile.name.split(/\s+/);
    const link = (re: RegExp) => profile.links.find(l => re.test(l.label) || re.test(l.url))?.url;
    const ctx = {
      first,
      last: rest.join(' '),
      full: profile.name,
      email: profile.email,
      phone: profile.phone,
      location: profile.location,
      linkedin: link(/linkedin\.com/i),
      github: profile.links.find(l => /(^|\/\/)(www\.)?github\.com\//i.test(l.url))?.url, // a profile, not a github.io project site
      portfolio: profile.links.find(l => /portfolio/i.test(l.label))?.url || profile.links.find(l => !/linkedin|github/i.test(l.url))?.url,
      company: profile.experience[0]?.company,
      title: profile.experience[0]?.title,
    };

    const values: Record<string, unknown> = {};
    const rest2: FormField[] = [];
    for (const f of fields) {
      if (f.kind === 'file') {
        const l = lc(`${f.label} ${f.name}`);
        // "Autofill from resume" boxes would overwrite what we fill; skip them.
        if (/autofill|auto-fill|parse|import/.test(l) || (!f.label && fields.some(x => x.kind === 'file' && /resume|cv/i.test(x.label)))) continue;
        if (/cover/.test(l)) {
          if (files.cover) values[f.id] = files.cover;
        } else if (/resume|cv|attach/.test(l) || !Object.values(values).includes(files.resume)) values[f.id] = files.resume;
        continue;
      }
      const v = standardValue(f, ctx);
      if (v) values[f.id] = v;
      else rest2.push(f);
    }

    let missing: { label: string; question: string }[] = [];
    if (rest2.length) {
      step(`Hermes is answering ${rest2.length} form question${rest2.length === 1 ? '' : 's'}`);
      const ans = await askJson<any>({
        prompt: FILL_PROMPT({
          fields: rest2
            .map(f => {
              // Huge lists (universities, countries) would swamp the prompt: show a sample; the answer is fuzzy-matched against the full list.
              const opts = !f.options.length ? '' : f.options.length > 60 ? ` · ${f.options.length} options, e.g. ${f.options.slice(0, 25).join(' | ')} … (give the exact name you want; it will be matched)` : ` · options: ${f.options.join(' | ')}`;
              return `${f.id} · ${f.kind}${f.required ? ' · REQUIRED' : ''} · ${f.label}${opts}`;
            })
            .join('\n'),
          facts: facts(job),
          job: `${job.title} at ${job.company}`,
          coverLetter: job.packet.coverLetter,
        }),
        handle: h,
        priority: 1,
        timeoutSec: 240,
      });
      Object.assign(values, ans?.values || {});
      // Only REQUIRED fields can block an application.
      missing = (Array.isArray(ans?.missing) ? ans.missing : [])
        .map((m: any) => ({ f: rest2.find(f => f.id === m?.id), question: String(m?.question || '') }))
        .filter((m: { f?: FormField; question: string }) => m.question && m.f && (m.f.required || AUTH.test(m.f.label)))
        .map((m: { f?: FormField; question: string }) => ({ label: m.f!.label, question: m.question }));
    }

    // Legal questions (work authorization, sponsorship) are never guessed: unless you've told
    // Talaria the answer, they become questions for you — required or not.
    const known = knownLegalFacts();
    for (const f of fields) {
      if (!AUTH.test(f.label)) continue;
      const isSponsor = /sponsor|visa/i.test(f.label);
      if ((isSponsor && known.sponsorship) || (!isSponsor && known.authorization)) continue;
      delete values[f.id];
      if (!missing.some(m => m.label === f.label)) missing.push({ label: f.label, question: f.label });
    }

    // Never guess personal characteristics: a demographic answer must be a "decline" option.
    for (const f of fields) {
      if (!DEMOGRAPHIC.test(f.label) || values[f.id] == null) continue;
      const v = Array.isArray(values[f.id]) ? (values[f.id] as unknown[]).join(' ') : String(values[f.id]);
      if (!DECLINE.test(v)) delete values[f.id];
    }

    let filled = 0;
    const report: NonNullable<ApplyResult['report']> = [];
    for (const f of fields) {
      const v = values[f.id];
      if (v == null || v === '') {
        report.push({ label: f.label, kind: f.kind, required: f.required, ok: false });
        continue;
      }
      const ok = await fillField(page, f, v);
      if (ok) filled++;
      report.push({ label: f.label, kind: f.kind, required: f.required, value: f.kind === 'file' ? path.basename(String(v)) : String(Array.isArray(v) ? v.join(', ') : v).slice(0, 80), ok });
      await page.waitForTimeout(120);
    }
    // Read every field back: anything required that's still empty blocks submission.
    const empty = await emptyFields(page, fields);
    const unansweredRequired = fields.filter(f => f.required && (empty.has(f.id) || values[f.id] == null || values[f.id] === ''));
    for (const f of unansweredRequired) if (!missing.some(m => m.label === f.label)) missing.push({ label: f.label, question: f.label });
    filled = fields.filter(f => !empty.has(f.id) && values[f.id] != null && values[f.id] !== '').length;
    h.log(`Filled ${filled} of ${fields.length} fields${missing.length ? ` · ${missing.length} need you` : ''}`);

    const shotDir = path.join(DATA_DIR, 'applications', jobId);
    const screenshot = path.join(shotDir, opts.dryRun ? 'test-fill.png' : 'before-submit.png');
    await page.screenshot({ path: screenshot, fullPage: true }).catch(() => {});

    if (opts.dryRun) {
      finishRun(h, true, `Test fill: ${filled}/${fields.length} fields`);
      return { status: 'dry_run', filled, total: fields.length, missing, message: 'Filled without submitting', screenshot, report };
    }

    if (missing.length) {
      // Hand the gaps back as questions; the window stays open with everything else filled.
      updateJob(
        jobId,
        j => {
          const ids: string[] = [];
          for (const m of missing) {
            const existing = j.questions.find(q => q.question === m.question);
            if (existing) {
              if (!existing.answer) ids.push(existing.id);
              continue;
            }
            const id = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
            j.questions.push({ id, question: m.question, why: `The application form asks: “${m.label}”`, kind: 'text', required: true, stage: 'form', reusable: true });
            ids.push(id);
          }
          j.chat = [
            ...(j.chat || []),
            {
              id: `${Date.now()}c`,
              at: now(),
              from: 'hermes',
              kind: 'questions',
              text: `I filled in everything I could on the ${j.company} form, but it asks ${missing.length} thing${missing.length > 1 ? 's' : ''} I don't know. Answer below, then finalize again. The form stays filled in the Talaria window.`,
              questionIds: ids,
            },
          ];
          j.packet!.approvedAt = undefined;
          j.work.submit = { state: 'error', error: `The form needs ${missing.length} more answer${missing.length > 1 ? 's' : ''}`, at: now() };
        },
        { at: now(), text: `Auto-apply paused: the form asks ${missing.length} thing${missing.length > 1 ? 's' : ''} Hermes doesn't know`, kind: 'agent' },
      );
      finishRun(h, false, undefined, 'Needs your answers');
      return { status: 'needs_you', filled, total: fields.length, missing, message: 'Answer the new questions, then approve again', screenshot };
    }

    step('Submitting');
    const submit = page.locator('button[type="submit"], input[type="submit"], button:has-text("Submit application"), button:has-text("Submit Application"), button:has-text("Submit")').last();
    await submit.click({ timeout: 10000 });

    // Wait for confirmation, or for you to solve a CAPTCHA (up to 10 minutes).
    const deadline = Date.now() + 10 * 60_000;
    let announcedCaptcha = false;
    while (Date.now() < deadline) {
      await page.waitForTimeout(2000);
      const body = await page.locator('body').innerText().catch(() => '');
      if (SUCCESS.test(body) || /confirmation|thank/i.test(page.url())) {
        const done = path.join(shotDir, 'confirmation.png');
        await page.screenshot({ path: done, fullPage: true }).catch(() => {});
        updateJob(jobId, j => (j.work.submit = { state: 'done', at: now() }));
        markApplied(jobId, 'auto');
        addChat(jobId, { from: 'hermes', kind: 'status', text: `Submitted your application to ${job.company}. A screenshot of the confirmation is saved with the application.` });
        finishRun(h, true, 'Submitted');
        toast('success', `Applied to ${job.company} 🎉`);
        setTimeout(() => page.close().catch(() => {}), 4000);
        return { status: 'submitted', filled, total: fields.length, missing: [], message: 'Submitted', screenshot: done };
      }
      if (!announcedCaptcha && (await page.locator(CAPTCHA).first().isVisible().catch(() => false))) {
        announcedCaptcha = true;
        step('Waiting for you to solve a CAPTCHA in the Talaria browser window');
        toast('info', `${job.company}: solve the CAPTCHA in the Talaria browser window to finish applying`);
      }
      const errors = await page.locator('[class*="error" i]:visible, [aria-invalid="true"]').count().catch(() => 0);
      if (errors && !announcedCaptcha && Date.now() > deadline - 9.5 * 60_000) {
        updateJob(jobId, j => (j.work.submit = { state: 'error', error: 'The form showed errors — check the Talaria browser window', at: now() }));
        finishRun(h, false, undefined, 'Form showed validation errors');
        return { status: 'needs_you', filled, total: fields.length, missing: [], message: 'The form reported errors; finish it in the browser window', screenshot };
      }
    }
    updateJob(jobId, j => (j.work.submit = { state: 'error', error: "Couldn't confirm the submission — check the browser window", at: now() }));
    finishRun(h, false, undefined, 'No confirmation seen');
    return { status: 'failed', filled, total: fields.length, missing: [], message: "Couldn't confirm the submission", screenshot };
  } catch (err: any) {
    const msg = err?.message?.split('\n')[0] || String(err);
    if (!opts.dryRun) updateJob(jobId, j => (j.work.submit = { state: 'error', error: msg, at: now() }));
    finishRun(h, false, undefined, msg);
    if (opts.dryRun) await page.close().catch(() => {});
    throw err;
  }
}
