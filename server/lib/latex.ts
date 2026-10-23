// LaTeX resume support: the user's own template stays the source of truth. Hermes only rewrites
// the document body; the preamble (fonts, macros, layout) is kept byte-for-byte.

import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { WORK_DIR } from './paths.ts';

export function readLatexUpload(file: string, originalName: string): string {
  const buf = fs.readFileSync(file);
  if (/\.zip$/i.test(originalName)) {
    const files = unzipSync(new Uint8Array(buf));
    const texNames = Object.keys(files).filter(n => /\.tex$/i.test(n) && !n.startsWith('__MACOSX'));
    if (!texNames.length) throw new Error('No .tex file found in that zip.');
    // Prefer the file that actually contains \begin{document}, then main.tex.
    const pick =
      texNames.find(n => /\\begin\{document\}/.test(strFromU8(files[n]))) ||
      texNames.find(n => /(^|\/)main\.tex$/i.test(n)) ||
      texNames[0];
    return strFromU8(files[pick]);
  }
  return buf.toString('utf8');
}

export function isLatexName(name: string) {
  return /\.(tex|zip)$/i.test(name);
}

export function splitLatex(tex: string): { head: string; body: string; tail: string } | null {
  const begin = tex.indexOf('\\begin{document}');
  const end = tex.lastIndexOf('\\end{document}');
  if (begin < 0 || end < begin) return null;
  const bodyStart = begin + '\\begin{document}'.length;
  return { head: tex.slice(0, bodyStart), body: tex.slice(bodyStart, end), tail: tex.slice(end) };
}

/** Remove `\name` together with its [opt] and {balanced} arguments. */
function dropCommand(s: string, names: string[]): string {
  const re = new RegExp(`\\\\(?:${names.join('|')})\\*?`, 'g');
  let out = '';
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    out += s.slice(last, m.index);
    let i = m.index + m[0].length;
    for (;;) {
      while (s[i] === ' ') i++;
      if (s[i] === '[') {
        const close = s.indexOf(']', i);
        if (close < 0) break;
        i = close + 1;
      } else if (s[i] === '{') {
        let depth = 0;
        let j = i;
        for (; j < s.length; j++) {
          if (s[j] === '\\') {
            j++;
            continue;
          }
          if (s[j] === '{') depth++;
          else if (s[j] === '}' && --depth === 0) break;
        }
        i = j + 1;
      } else break;
    }
    out += ' ';
    last = i;
    re.lastIndex = i;
  }
  return out + s.slice(last);
}

/** Readable plain text from LaTeX, good enough for keyword matching and the profile builder. */
export function latexToText(tex: string): string {
  const parts = splitLatex(tex);
  let s = parts ? parts.body : tex;
  s = s
    .split('\n')
    .map(l => l.replace(/(^|[^\\])%.*$/, '$1'))
    .join('\n');
  s = dropCommand(s, ['begin', 'end', 'vspace', 'hspace', 'setlength', 'addtolength', 'titlerule', 'noindent', 'newpage', 'pagebreak']);
  s = s
    .replace(/\\[,;:! ]/g, ' ')
    .replace(/\}\s*\{/g, ' · ')
    .replace(/\\href\{[^}]*\}\{([^}]*)\}/g, '$1')
    .replace(/\\(?:resumeSubheading|resumeProjectHeading|resumeSubSubheading)/g, '\n')
    .replace(/\\(?:section|subsection)\*?\{([^}]*)\}/g, '\n\n$1\n')
    .replace(/\\resumeItem\{/g, '\n- {')
    .replace(/\\item\b/g, '\n- ')
    .replace(/\\\\(\[[^\]]*\])?/g, '\n')
    .replace(/\\(?:textbf|textit|emph|uline|underline|small|footnotesize|text|mbox|scshape|large|Large|Huge|huge)\b/g, '')
    .replace(/\\[a-zA-Z]+\*?(\[[^\]]*\])?/g, ' ')
    .replace(/\\([&%$#_{}])/g, '$1')
    .replace(/[{}]/g, '')
    .replace(/--/g, '–')
    .replace(/~/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .split('\n')
    .map(l => l.trim())
    .filter((l, i, arr) => l || arr[i - 1])
    .join('\n')
    .trim();
  return s;
}

/** Cheap structural checks so a broken body never replaces a working one. */
export function validateBody(body: string): string | null {
  let depth = 0;
  const noComments = body
    .split('\n')
    .map(l => l.replace(/(^|[^\\])%.*$/, '$1'))
    .join('\n');
  for (let i = 0; i < noComments.length; i++) {
    const c = noComments[i];
    if (c === '\\') {
      i++;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') depth--;
    if (depth < 0) return 'Unbalanced braces (a closing } without an opening {).';
  }
  if (depth !== 0) return `Unbalanced braces (${depth} unclosed).`;
  const begins = (noComments.match(/\\begin\{/g) || []).length;
  const ends = (noComments.match(/\\end\{/g) || []).length;
  if (begins !== ends) return `\\begin/\\end mismatch (${begins} vs ${ends}).`;
  if (/\\end\{document\}|\\documentclass/.test(noComments)) return 'Body must not contain \\documentclass or \\end{document}.';
  return null;
}

// ---------------- compiling ----------------

let compilerCache: string | null | undefined;

export function findPdflatex(): string | null {
  if (compilerCache !== undefined && compilerCache !== null) return compilerCache;
  const exe = process.platform === 'win32' ? 'pdflatex.exe' : 'pdflatex';
  const candidates = [
    ...(process.env.PATH || '').split(path.delimiter).map(d => path.join(d, exe)),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'MiKTeX', 'miktex', 'bin', 'x64', exe),
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'MiKTeX', 'miktex', 'bin', 'x64', exe),
    'C:\\texlive\\2025\\bin\\windows\\pdflatex.exe',
    'C:\\texlive\\2026\\bin\\windows\\pdflatex.exe',
    '/Library/TeX/texbin/pdflatex',
    '/usr/bin/pdflatex',
  ];
  compilerCache = candidates.find(c => c && fs.existsSync(c)) || null;
  return compilerCache;
}

export interface CompileResult {
  ok: boolean;
  pdf?: Buffer;
  pages?: number;
  error?: string;
}

function run(cmd: string, args: string[], cwd: string, timeoutMs: number): Promise<{ code: number; out: string }> {
  return new Promise(resolve => {
    execFile(cmd, args, { cwd, timeout: timeoutMs, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ code: err ? ((err as any).code ?? 1) : 0, out: `${stdout}\n${stderr}` });
    });
  });
}

const pageCount = (buf: Buffer) => (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;

/** The first real error from a pdfLaTeX log — in both "! Error" and "file:line: error" styles. */
function errorExcerpt(log: string, tex: string) {
  const lines = log.split(/\r?\n/);
  const i = lines.findIndex(l => /^!|^(?:\.\/)?[^\s:]+\.tex:\d+: /.test(l) && !/Fatal error occurred/.test(l));
  if (i < 0) return lines.filter(l => l.trim()).slice(-6).join('\n');
  const msg = lines.slice(i, i + 4).join('\n').trim();
  const lineNo = Number(lines[i].match(/\.tex:(\d+):/)?.[1] || lines.slice(i, i + 12).join('\n').match(/^l\.(\d+)/m)?.[1]);
  const src = lineNo ? tex.split('\n')[lineNo - 1]?.trim() : '';
  return src ? `${msg}\nOffending line ${lineNo}: ${src.slice(0, 300)}` : msg;
}

/** Compile a full .tex document. Results are cached by content hash. */
export async function compileLatex(tex: string): Promise<CompileResult> {
  const bin = findPdflatex();
  if (!bin) return { ok: false, error: 'pdflatex is not installed.' };
  const hash = crypto.createHash('sha1').update(tex).digest('hex').slice(0, 16);
  const dir = path.join(WORK_DIR, 'latex', hash);
  const pdfPath = path.join(dir, 'main.pdf');
  if (fs.existsSync(pdfPath)) {
    const pdf = fs.readFileSync(pdfPath);
    return { ok: true, pdf, pages: pageCount(pdf) };
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'main.tex'), tex);
  const args = ['-interaction=nonstopmode', '-halt-on-error', '-file-line-error', 'main.tex'];
  if (/miktex/i.test(bin)) args.unshift('--enable-installer');
  const r = await run(bin, args, dir, 240000);
  if (!fs.existsSync(pdfPath) || r.code !== 0) {
    let log = r.out;
    try {
      log = fs.readFileSync(path.join(dir, 'main.log'), 'utf8');
    } catch {}
    fs.rm(pdfPath, { force: true }, () => {});
    return { ok: false, error: errorExcerpt(log, tex) };
  }
  const pdf = fs.readFileSync(pdfPath);
  return { ok: true, pdf, pages: pageCount(pdf) };
}
