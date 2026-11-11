import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

export const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const DATA_DIR = process.env.TALARIA_DATA_DIR || path.join(ROOT, 'data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
export const WORK_DIR = path.join(DATA_DIR, 'ai-work');
export const DIST_DIR = path.join(ROOT, 'dist');

// Older versions called the work folder after Hermes Agent.
const OLD_WORK_DIR = path.join(DATA_DIR, 'hermes-work');
if (fs.existsSync(OLD_WORK_DIR) && !fs.existsSync(WORK_DIR)) {
  try {
    fs.renameSync(OLD_WORK_DIR, WORK_DIR);
  } catch {}
}

for (const dir of [DATA_DIR, UPLOAD_DIR, WORK_DIR]) fs.mkdirSync(dir, { recursive: true });
