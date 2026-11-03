import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { traced } from '../shared/trace.ts';
import type { Finding } from './types.ts';

export function findSmAxi(given: string | null | undefined): string | null {
  const home = path.join(os.homedir(), '.claude', 'skills', 'state-machine', 'bin', 'sm-axi');
  const file = given === undefined ? process.env.SNOWMOBILE_SM_AXI || home : given;
  return file && fs.existsSync(file) ? file : null;
}

export const checkFindings = traced('machine.checkFindings', (toon: string): Finding[] => {
  const lines = toon.split('\n');
  const at = lines.findIndex((l) => /^checks\[\d+\]/.test(l));
  if (at < 0) throw new Error('sm-axi check printed no checks section');
  const out: Finding[] = [];
  for (const l of lines.slice(at + 1)) {
    if (!/^\s/.test(l)) break;
    const c: string[] = [];
    let cur = '', q = false;
    const t = l.trim();
    for (let i = 0; i < t.length; i++) {
      if (t[i] === '\\' && q) cur += t[++i];
      else if (t[i] === '"') q = !q;
      else if (t[i] === ',' && !q) { c.push(cur); cur = ''; } else cur += t[i];
    }
    c.push(cur);
    out.push({ kind: c[0] ?? '', machine: c[1] ?? '', at: c[2] ?? '', detail: c[4] ?? '' });
  }
  return out;
});

export function runCheck(smAxi: string, text: string): Finding[] {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snowmobile-sm-'));
  try {
    const file = path.join(dir, 'design.sm.md');
    fs.writeFileSync(file, text);
    const r = Bun.spawnSync([process.execPath, smAxi, 'check', file]);
    if (r.exitCode === 2 || r.exitCode === null) throw new Error(`sm-axi: ${(r.stderr.toString() || r.stdout.toString() || 'failed').trim().slice(0, 300)}`);
    return checkFindings(r.stdout.toString());
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
