import fs from 'node:fs';
import path from 'node:path';
import { onCapture } from '../shared/trace.ts';

export const CAPTURE_ENV = 'SNOWMOBILE_REPLAY_CAPTURE';
export const CAPTURE_LIMIT = 300;

export function enableCapture(dir: string | undefined = process.env[CAPTURE_ENV]): void {
  if (!dir) return;
  fs.mkdirSync(dir, { recursive: true });
  const counts = new Map<string, number>();
  onCapture((name, args) => {
    const n = counts.get(name) ?? 0;
    if (n >= CAPTURE_LIMIT) return;
    counts.set(name, n + 1);
    fs.appendFileSync(path.join(dir, `${name}.jsonl`), `${JSON.stringify(args)}\n`);
  });
}
