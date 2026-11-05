import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assert } from '../shared/assert.ts';
import { traced } from '../shared/trace.ts';
import type { Finding } from './types.ts';

const DETAIL_LIMIT = 300;

export function findSmAxi(given: string | null | undefined): string | null {
  assert(given === undefined || given === null || typeof given === 'string', 'the given path is text or absent');
  assert(os.homedir().length > 0, 'the user has a home folder');
  const home = path.join(os.homedir(), '.claude', 'skills', 'state-machine', 'bin', 'sm-axi');
  const fromEnv = process.env['SNOWMOBILE_SM_AXI'];
  const file = given === undefined ? (fromEnv === undefined || fromEnv === '' ? home : fromEnv) : given;
  return file !== null && file !== '' && fs.existsSync(file) ? file : null;
}

// Splits one line of the report on commas that are not inside quotes. A backslash in quotes escapes the next character.
function splitColumns(line: string): string[] {
  assert(typeof line === 'string', 'a line is text');
  assert(line.length < 10 ** 6, 'a line is bounded');
  const columns: string[] = [];
  let cur = '', quoted = false;
  const t = line.trim();
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (ch === '\\' && quoted) {
      i += 1;
      cur += t[i] ?? '';
    } else if (ch === '"') {
      quoted = !quoted;
    } else if (ch === ',' && !quoted) {
      columns.push(cur);
      cur = '';
    } else {
      cur += ch ?? '';
    }
  }
  columns.push(cur);
  assert(columns.length >= 1, 'a line has at least one column');
  return columns;
}

function findingOf(line: string): Finding {
  const c = splitColumns(line);
  assert(c.length >= 1, 'a finding has columns');
  assert(line.trim().length >= 0, 'a finding line has text');
  return { kind: c[0] ?? '', machine: c[1] ?? '', at: c[2] ?? '', detail: c[4] ?? '' };
}

function checkFindingsImpl(toon: string): Finding[] {
  assert(typeof toon === 'string', 'the report is text');
  assert(toon.length < 10 ** 8, 'the report is bounded');
  const lines = toon.split('\n');
  const at = lines.findIndex((l) => /^checks\[\d+\]/.test(l));
  if (at < 0) {
    throw new Error('sm-axi check printed no checks section');
  }
  const out: Finding[] = [];
  for (const l of lines.slice(at + 1)) {
    if (!/^\s/.test(l)) {
      break;
    }
    out.push(findingOf(l));
  }
  assert(out.length <= lines.length, 'a finding comes from a line');
  return out;
}

export const checkFindings = traced('machine.checkFindings', checkFindingsImpl);

export function runCheck(smAxi: string, text: string): Finding[] {
  assert(smAxi.length > 0, 'the checker program is named');
  assert(text.length >= 0, 'the design text is text');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snowmobile-sm-'));
  try {
    const file = path.join(dir, 'design.sm.md');
    fs.writeFileSync(file, text);
    const r = Bun.spawnSync([process.execPath, smAxi, 'check', file]);
    if (r.exitCode === 2 || typeof r.exitCode !== 'number') {
      throw new Error(`sm-axi: ${(r.stderr.toString() || r.stdout.toString() || 'failed').trim().slice(0, DETAIL_LIMIT)}`);
    }
    return checkFindings(r.stdout.toString());
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
