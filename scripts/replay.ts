// Process replay (guardrails Step 11). Local only.
//   bun scripts/replay.ts [--base <rev>]  (the default base is the merge base with main)
//   [--inputs <dir>] [--accept]
// 1. Run the tests with capture on: each traced transform writes its inputs to <dir>/<name>.jsonl.
// 2. Run each input on the base commit (legacy adapter) and on this branch.
// 3. Any output difference fails, unless --accept says that you read each difference by hand on this run.
// The first 20% of the inputs run first. A difference there stops the run.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { registry } from '../shared/trace.ts';
import { CAPTURE_ENV } from '../src/capture.ts';
import { legacySource, LEGACY_NAMES } from './legacy.ts';
import { compare, type Diff } from './compare.ts';
import '../src/stack.ts';
import '../src/prompts.ts';
import '../src/brief.ts';
import '../src/recombine.ts';
import '../src/grilltree.ts';
import '../src/machine.ts';
import '../shared/markdown.ts';

const root = path.join(import.meta.dirname, '..');
const arg = (name: string): string | undefined => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };

function main(): number {
  const base = arg('--base') ?? spawnSync('git', ['-C', root, 'merge-base', 'HEAD', 'main'], { encoding: 'utf8' }).stdout.trim() ?? 'HEAD';
  const accept = process.argv.includes('--accept');
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'snowmobile-replay-'));
  let inputs = arg('--inputs');
  if (!inputs) {
    inputs = path.join(work, 'inputs');
    const run = spawnSync('bun', ['test', '--preload', './test/capture.ts'], { cwd: root, env: { ...process.env, [CAPTURE_ENV]: inputs }, encoding: 'utf8' });
    if (!fs.existsSync(inputs)) { console.error(run.stdout + run.stderr); console.error('The capture run wrote no inputs.'); return 2; }
    if (run.status !== 0) console.error('A test failed during the capture. The replay goes on.');
  }
  const baseDir = path.join(work, 'base');
  fs.mkdirSync(baseDir, { recursive: true });
  const tar = spawnSync('sh', ['-c', `git -C '${root}' archive '${base}' snowmobile.js page.html data | tar -x -C '${baseDir}'`], { encoding: 'utf8' });
  if (tar.status !== 0) { console.error(`The base ${base} has no snowmobile.js. ${tar.stderr}`); return 2; }
  const baseSource = fs.readFileSync(path.join(baseDir, 'snowmobile.js'), 'utf8');
  const html = fs.readFileSync(path.join(baseDir, 'page.html'), 'utf8');
  fs.writeFileSync(path.join(baseDir, 'legacy.cjs'), legacySource(baseSource));
  const legacy = createRequire(path.join(baseDir, 'x.cjs'))('./legacy.cjs') as Record<string, (...a: unknown[]) => unknown>;
  const page = legacyPage(html);
  const old = (name: string): ((args: unknown[]) => unknown) | undefined => {
    const n = LEGACY_NAMES[name];
    if (name === 'page.esc') return (a) => page.esc(a[0]);
    if (name === 'page.md') return (a) => page.md(a[0] as string);
    const f = n && legacy[n];
    return f ? (a) => f(...a) : undefined;
  };

  const diffs: Diff[] = [];
  let total = 0, skipped = 0;
  const names = fs.existsSync(inputs) ? fs.readdirSync(inputs).filter((f) => f.endsWith('.jsonl')).map((f) => f.slice(0, -6)).sort() : [];
  const jobs = names.flatMap((name) => fs.readFileSync(path.join(inputs as string, `${name}.jsonl`), 'utf8').split('\n').filter(Boolean)
    .map((line, i) => ({ name, i, args: JSON.parse(line) as unknown[] })));
  const early = Math.ceil(jobs.length * 0.2);
  for (const [k, job] of jobs.entries()) {
    const was = old(job.name), now = registry.get(job.name);
    if (!now) { diffs.push({ name: job.name, i: job.i, args: job.args, base: 'no function', branch: 'not registered' }); continue; }
    if (!was) { skipped++; continue; }
    total++;
    const d = compare(job.name, job.i, job.args, was, now);
    if (d) diffs.push(d);
    if (k + 1 === early && diffs.length) { console.error(`Early stop: a difference in the first 20% of the inputs (${early} of ${jobs.length}).`); break; }
  }
  console.log(`replay: base ${base}, ${total} inputs of ${names.length} transforms, ${skipped} without a base function, ${diffs.length} differences`);
  for (const d of diffs.slice(0, 10)) console.log(`DIFF ${d.name}#${d.i}\n  args:   ${JSON.stringify(d.args).slice(0, 300)}\n  base:   ${d.base.slice(0, 300)}\n  branch: ${d.branch.slice(0, 300)}`);
  if (!diffs.length) return 0;
  if (accept) { console.log('--accept: the differences are accepted by hand for this run only.'); return 0; }
  console.log('Read each difference. Run again with --accept only if each one is intended.');
  return 1;
}

function legacyPage(html: string): { esc: (s: unknown) => string; md: (s: string) => string } {
  const esc = /const esc = [^\n]*;\n/.exec(html)?.[0];
  const md = /function md\(s\) \{[^]*?\n\}\n/.exec(html)?.[0];
  if (!esc || !md) throw new Error('The base page has no esc or md.');
  return new Function(`${esc}${md}return { esc, md };`)() as { esc: (s: unknown) => string; md: (s: string) => string };
}

process.exit(main());
