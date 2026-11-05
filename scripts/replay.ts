// Process replay (guardrails Step 11). Local only.
//   bun scripts/replay.ts [--base <rev>]  (the default base is the merge base with main)
//   [--inputs <dir>] [--accept]
// 1. Run the tests with capture on: each traced transform writes its inputs to <dir>/<name>.jsonl.
// 2. Run each input on the base commit and on this branch. A TypeScript base runs the registry of its own tree (scripts/transforms.ts).
//    A JavaScript base (snowmobile.js) runs through the legacy adapter.
// 3. Any output difference fails, unless --accept says that you read each difference by hand on this run.
// The first 20% of the inputs run first. A difference there stops the run.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { registry } from './transforms.ts';
import type { Replayable } from '../shared/trace.ts';
import { CAPTURE_ENV } from '../src/capture.ts';
import { legacySource, LEGACY_NAMES } from './legacy.ts';
import { compare, type Diff } from './compare.ts';

const root = path.join(import.meta.dirname, '..');
const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(name);
  return i < 0 ? undefined : process.argv[i + 1];
};
const EARLY_SHARE = 0.2;
const SHOWN_DIFFS = 10;
const CLIP = 300;

type Finder = (name: string) => Replayable | undefined;

function legacyPage(baseDir: string, html: string): { esc: (s: unknown) => string; md: (s: string) => string } {
  const esc = /const esc = [^\n]*;\n/.exec(html)?.[0];
  const md = /function md\(s\) \{[^]*?\n\}\n/.exec(html)?.[0];
  if (!esc || !md) {
    throw new Error('The base page has no esc or md.');
  }
  // The page functions load as a module file, the way legacy.cjs does.
  const file = path.join(baseDir, 'legacy-page.cjs');
  fs.writeFileSync(file, `${esc}${md}module.exports = { esc, md };\n`);
  return createRequire(file)('./legacy-page.cjs') as { esc: (s: unknown) => string; md: (s: string) => string };
}

function legacyBase(baseDir: string): Finder {
  const baseSource = fs.readFileSync(path.join(baseDir, 'snowmobile.js'), 'utf8');
  const html = fs.readFileSync(path.join(baseDir, 'page.html'), 'utf8');
  fs.writeFileSync(path.join(baseDir, 'legacy.cjs'), legacySource(baseSource));
  const legacy = createRequire(path.join(baseDir, 'x.cjs'))('./legacy.cjs') as Record<string, (...a: unknown[]) => unknown>;
  const page = legacyPage(baseDir, html);
  return (name) => {
    if (name === 'page.esc') {
      return (a) => page.esc(a[0]);
    }
    if (name === 'page.md') {
      return (a) => page.md(a[0] as string);
    }
    const n = LEGACY_NAMES[name];
    const f = n && legacy[n];
    return f ? (a) => f(...a) : undefined;
  };
}

// Runs the tests with capture on and returns the folder of inputs, or null when nothing was written.
function captureInputs(work: string): string | null {
  const inputs = path.join(work, 'inputs');
  const result = spawnSync('bun', ['test', '--preload', './test/capture.ts'], { cwd: root, env: { ...process.env, [CAPTURE_ENV]: inputs }, encoding: 'utf8' });
  if (!fs.existsSync(inputs)) {
    console.error(result.stdout + result.stderr);
    console.error('The capture run wrote no inputs.');
    return null;
  }
  if (result.status !== 0) {
    console.error('A test failed during the capture. The replay goes on.');
  }
  return inputs;
}

function unpackBase(work: string, base: string): string | null {
  const baseDir = path.join(work, 'base');
  fs.mkdirSync(baseDir, { recursive: true });
  const tar = spawnSync('sh', ['-c', `git -C '${root}' archive '${base}' | tar -x -C '${baseDir}'`], { encoding: 'utf8' });
  if (tar.status !== 0) {
    console.error(`git archive of the base ${base} failed. ${tar.stderr}`);
    return null;
  }
  return baseDir;
}

async function finderFor(baseDir: string, base: string): Promise<Finder | null> {
  if (fs.existsSync(path.join(baseDir, 'shared', 'trace.ts'))) {
    const file = path.join(baseDir, 'scripts', 'transforms.ts');
    const baseRegistry = (await import(pathToFileURL(file).href) as { registry: Map<string, Replayable> }).registry;
    return (name) => baseRegistry.get(name);
  }
  if (fs.existsSync(path.join(baseDir, 'snowmobile.js'))) {
    return legacyBase(baseDir);
  }
  console.error(`The base ${base} has no shared/trace.ts and no snowmobile.js.`);
  return null;
}

interface Job { name: string; i: number; args: unknown[] }

function readJobs(inputs: string): { jobs: Job[]; names: string[] } {
  const names = fs.existsSync(inputs) ? fs.readdirSync(inputs).filter((f) => f.endsWith('.jsonl')).map((f) => f.slice(0, -6)).sort() : [];
  const jobs = names.flatMap((name) => fs.readFileSync(path.join(inputs, `${name}.jsonl`), 'utf8').split('\n').filter(Boolean)
    .map((line, i) => ({ name, i, args: JSON.parse(line) as unknown[] })));
  return { jobs, names };
}

// The first 20% of the inputs run first. A difference there stops the run.
function compareAll(jobs: readonly Job[], was: Finder): { diffs: Diff[]; total: number; skipped: number } {
  const diffs: Diff[] = [];
  let total = 0, skipped = 0;
  const early = Math.ceil(jobs.length * EARLY_SHARE);
  for (const [k, job] of jobs.entries()) {
    const before = was(job.name), now = registry.get(job.name);
    if (!now) {
      diffs.push({ name: job.name, i: job.i, args: job.args, base: 'no function', branch: 'not registered' });
    } else if (!before) {
      skipped++;
    } else {
      total++;
      const d = compare(job.name, job.i, job.args, before, now);
      if (d) {
        diffs.push(d);
      }
    }
    if (k + 1 === early && diffs.length) {
      console.error(`Early stop: a difference in the first 20% of the inputs (${String(early)} of ${String(jobs.length)}).`);
      break;
    }
  }
  return { diffs, total, skipped };
}

function printDiffs(diffs: readonly Diff[]): void {
  for (const d of diffs.slice(0, SHOWN_DIFFS)) {
    console.log(`DIFF ${d.name}#${String(d.i)}\n  args:   ${JSON.stringify(d.args).slice(0, CLIP)}\n  base:   ${d.base.slice(0, CLIP)}\n  branch: ${d.branch.slice(0, CLIP)}`);
  }
}

async function run(work: string): Promise<number> {
  const mergeBase = spawnSync('git', ['-C', root, 'merge-base', 'HEAD', 'main'], { encoding: 'utf8' }).stdout.trim();
  const base = arg('--base') ?? (mergeBase === '' ? 'HEAD' : mergeBase);
  const accept = process.argv.includes('--accept');
  const inputs = arg('--inputs') ?? captureInputs(work);
  if (inputs === null) {
    return 2;
  }
  const baseDir = unpackBase(work, base);
  const was = baseDir === null ? null : await finderFor(baseDir, base);
  if (was === null) {
    return 2;
  }
  const { jobs, names } = readJobs(inputs);
  const { diffs, total, skipped } = compareAll(jobs, was);
  console.log(`replay: base ${base}, ${String(total)} inputs of ${String(names.length)} transforms, ${String(skipped)} without a base function, ${String(diffs.length)} differences`);
  printDiffs(diffs);
  if (diffs.length === 0) {
    return 0;
  }
  if (accept) {
    console.log('--accept: the differences are accepted by hand for this run only.');
    return 0;
  }
  console.log('Read each difference. Run again with --accept only if each one is intended.');
  return 1;
}

async function main(): Promise<number> {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'snowmobile-replay-'));
  try {
    return await run(work);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

process.exit(await main());
