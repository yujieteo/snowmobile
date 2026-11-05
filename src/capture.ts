import fs from 'node:fs';
import path from 'node:path';
import { assert } from '../shared/assert.ts';
import { onCapture } from '../shared/trace.ts';

export const CAPTURE_ENV = 'SNOWMOBILE_REPLAY_CAPTURE';
export const CAPTURE_LIMIT = 300;

function capturer(dir: string): (name: string, args: unknown[]) => void {
  assert(dir.length > 0, 'a capture folder is named');
  assert(Number.isInteger(CAPTURE_LIMIT), 'the capture is bounded');
  assert(path.isAbsolute(dir) || dir.length > 0, 'the folder is a path');
  const counts = new Map<string, number>();
  return (name, args) => {
    assert(name.length > 0, 'a capture names the transform');
    assert(Array.isArray(args), 'a capture holds the arguments');
    const n = counts.get(name) ?? 0;
    if (n >= CAPTURE_LIMIT) {
      return;
    }
    counts.set(name, n + 1);
    fs.appendFileSync(path.join(dir, `${name}.jsonl`), `${JSON.stringify(args)}\n`);
  };
}

export function enableCapture(dir: string | undefined = process.env[CAPTURE_ENV]): void {
  assert(dir === undefined || typeof dir === 'string', 'the folder is text or absent');
  assert(CAPTURE_ENV.length > 0, 'the environment variable has a name');
  assert(CAPTURE_ENV === CAPTURE_ENV.toUpperCase(), 'the variable name is upper case');
  if (!dir) {
    return;
  }
  fs.mkdirSync(dir, { recursive: true });
  onCapture(capturer(dir));
}
