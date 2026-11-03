// The compare step of the process replay, and the inputs of the page text transforms (the browser tests run them out of reach of the capture).
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { compare, show } from '../scripts/compare.ts';
import { esc, md } from '../shared/markdown.ts';

test('the replay finds no difference in equal outputs, and a difference in an unequal one', () => {
  const add = (a: unknown[]): unknown => (a[0] as number) + (a[1] as number);
  assert.strictEqual(compare('t', 0, [1, 2], add, add), null);
  const d = compare('t', 3, [1, 2], add, () => 4);
  assert.deepStrictEqual(d && { name: d.name, i: d.i, base: d.base, branch: d.branch }, { name: 't', i: 3, base: '3', branch: '4' });
});

test('the replay compares a thrown error, an undefined result and NaN as results', () => {
  assert.strictEqual(show(() => { throw new Error('x'); }), '__throws x');
  assert.strictEqual(show(() => undefined), '"__undefined"');
  assert.strictEqual(show(() => ({ a: NaN })), '{"a":"__NaN"}');
  assert.notStrictEqual(compare('t', 0, [], () => 1, () => { throw new Error('x'); }), null);
});

test('the replay does not let a function change its input', () => {
  const arg = [{ n: 1 }];
  compare('t', 0, arg, (a) => ((a[0] as { n: number }).n = 2), (a) => (a[0] as { n: number }).n);
  assert.deepStrictEqual(arg, [{ n: 1 }]);
});

test('esc and md turn markup into text, and md keeps bold, code and headings', () => {
  for (const s of ['<b>"x" & \'y\'</b>', null, undefined, 5, '']) esc(s);
  assert.strictEqual(esc('<a href="x">&</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
  assert.strictEqual(md('# Title\n**bold** and `code` <i>'), '<b style="font-size:18.5px">Title</b>\n<b>bold</b> and <code>code</code> &lt;i&gt;');
});

test('the replay runs against a TypeScript base, finds no difference in the same tree, and catches an injected change', () => {
  const root = path.join(import.meta.dirname, '..');
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'snowmobile-replay-test-'));
  for (const f of ['src', 'shared', 'scripts', 'package.json']) fs.cpSync(path.join(root, f), path.join(repo, f), { recursive: true });
  const git = (...a: string[]): void => {
    const r = spawnSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a], { encoding: 'utf8' });
    assert.strictEqual(r.status, 0, r.stderr);
  };
  git('init', '-q');
  git('add', '.');
  git('commit', '-q', '-m', 'base');
  const inputs = path.join(repo, 'inputs');
  fs.mkdirSync(inputs);
  fs.writeFileSync(path.join(inputs, 'page.esc.jsonl'), '["<a href=\\"x\\">&</a>"]\n["plain"]\n');
  fs.writeFileSync(path.join(inputs, 'page.md.jsonl'), '["# T\\n**b** `c`"]\n');
  const replay = (): { status: number | null; out: string } => {
    const r = spawnSync(process.execPath, [path.join(repo, 'scripts', 'replay.ts'), '--base', 'HEAD', '--inputs', inputs], { cwd: repo, encoding: 'utf8' });
    return { status: r.status, out: r.stdout + r.stderr };
  };
  const same = replay();
  assert.strictEqual(same.status, 0, same.out);
  assert.match(same.out, /3 inputs of 2 transforms, 0 without a base function, 0 differences/);
  const file = path.join(repo, 'shared', 'markdown.ts');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace("'&amp;'", "'&#38;'"));
  const changed = replay();
  assert.strictEqual(changed.status, 1, changed.out);
  assert.match(changed.out, /DIFF page\.esc#0/);
  fs.rmSync(repo, { recursive: true, force: true });
});
