import sanitizeHtml from 'sanitize-html';
import { convert } from 'html-to-text';
import type { RemoteMode } from '../../shared/types.ts';

const ENTITY_MAP: Record<string, string> = { '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };

export function decodeEntities(s: string) {
  return s.replace(/&(lt|gt|amp|quot|#39|nbsp);/g, m => ENTITY_MAP[m] ?? m);
}

export function cleanHtml(html: string) {
  if (!html) return '';
  // Greenhouse double-encodes its HTML.
  const decoded = /&lt;\/?[a-z]/i.test(html) && !/<\/?[a-z]/i.test(html) ? decodeEntities(html) : html;
  return sanitizeHtml(decoded, {
    allowedTags: ['p', 'br', 'ul', 'ol', 'li', 'strong', 'b', 'em', 'i', 'h1', 'h2', 'h3', 'h4', 'h5', 'a', 'blockquote', 'code', 'pre', 'hr'],
    allowedAttributes: { a: ['href'] },
    transformTags: {
      h1: 'h3',
      h2: 'h3',
      a: sanitizeHtml.simpleTransform('a', { target: '_blank', rel: 'noopener noreferrer' }),
    },
    exclusiveFilter: frame => ['p', 'li', 'strong', 'b', 'h3', 'h4'].includes(frame.tag) && !frame.text.trim() && !frame.mediaChildren?.length,
  })
    .replace(/(<br\s*\/?>\s*){3,}/g, '<br><br>')
    .trim();
}

export function htmlToText(html: string) {
  if (!html) return '';
  return convert(html, {
    wordwrap: false,
    selectors: [
      { selector: 'a', options: { ignoreHref: true } },
      { selector: 'img', format: 'skip' },
      { selector: 'h1', options: { uppercase: false } },
      { selector: 'h2', options: { uppercase: false } },
      { selector: 'h3', options: { uppercase: false } },
    ],
  })
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function textToHtml(text: string) {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return text
    .split(/\n{2,}/)
    .map(block => {
      const lines = block.split('\n');
      if (lines.every(l => /^\s*([-*•]|\d+\.)\s+/.test(l))) {
        return `<ul>${lines.map(l => `<li>${esc(l.replace(/^\s*([-*•]|\d+\.)\s+/, ''))}</li>`).join('')}</ul>`;
      }
      return `<p>${lines.map(esc).join('<br>')}</p>`;
    })
    .join('');
}

export function guessRemote(...hints: (string | undefined | null)[]): RemoteMode {
  const s = hints.filter(Boolean).join(' ').toLowerCase();
  if (/hybrid/.test(s)) return 'hybrid';
  if (/remote|anywhere|work from home|wfh|distributed/.test(s)) return 'remote';
  if (/on-?site|in office|in-office/.test(s)) return 'onsite';
  return 'unknown';
}

export function guessSeniority(title: string): string | undefined {
  const t = title.toLowerCase();
  if (/\bintern(ship)?\b|\bco-?op\b|working student|werkstudent/.test(t)) return 'intern';
  if (/\b(principal|staff|distinguished|director|head of|vp|vice president|chief)\b/.test(t)) return 'lead';
  if (/\blead\b|\bmanager\b/.test(t)) return 'lead';
  if (/\bsenior\b|\bsr\.?\b|\biii\b|\biv\b/.test(t)) return 'senior';
  if (/\b(junior|jr\.?|entry|graduate|new grad|associate|trainee|apprentice)\b|\bi\b(?!i)/.test(t)) return 'entry';
  if (/\bii\b|\bmid\b/.test(t)) return 'mid';
  return undefined;
}

export function domainFromUrl(url?: string) {
  if (!url) return undefined;
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    const aggregators = ['remotive.com', 'remoteok.com', 'himalayas.app', 'jobicy.com', 'arbeitnow.com', 'themuse.com', 'greenhouse.io', 'lever.co', 'ashbyhq.com', 'indeed.com', 'linkedin.com', 'glassdoor.com', 'workable.com', 'myworkdayjobs.com', 'smartrecruiters.com'];
    if (aggregators.some(a => host === a || host.endsWith('.' + a))) return undefined;
    return host;
  } catch {
    return undefined;
  }
}

export function formatSalary(min?: number | null, max?: number | null, currency = 'USD', period?: string) {
  if (!min && !max) return undefined;
  const sym = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : currency === 'INR' ? '₹' : `${currency} `;
  const fmt = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));
  const range = min && max && min !== max ? `${sym}${fmt(min)}–${sym}${fmt(max)}` : `${sym}${fmt((min || max)!)}`;
  const per = period && !/annual|year/i.test(period) ? ` / ${period.replace(/ly$/, '')}` : '';
  return range + per;
}

export function truncate(s: string, n: number) {
  if (!s) return '';
  return s.length <= n ? s : s.slice(0, n).replace(/\s+\S*$/, '') + '…';
}

export function stripLines(s: string) {
  return s
    .split('\n')
    .map(l => l.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
}
