const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { selectRepos } = require('../scripts/select-repos.js');

// These score profiles are synthetic. They make no claims about these projects.
const profile = (name, scores) => ({ url: `https://github.com/test/${name}`, scores });
const data = {
  axes: ['state', 'parallelism'],
  repos: [profile('a', [0, 0]), profile('b', [1, 0]), profile('c', [10, 0]), profile('d', [0, 10])],
};

test('max-min selection increases minimum distance from 1 to 10 on a known geometry', () => {
  const before = selectRepos({ ...data, repos: data.repos.slice(0, 3) }, 3);
  const after = selectRepos(data, 3);
  assert.equal(before.minimumDistance, 1);
  assert.equal(after.minimumDistance, 10);
  assert.deepEqual(after.repos, [data.repos[2], data.repos[3], data.repos[0]]);
  assert.equal(selectRepos(data, 2).minimumDistance, Math.sqrt(200));
  assert.deepEqual(selectRepos(data, 4).repos.at(-1), data.repos[1]);
  assert.deepEqual(data.repos[0].scores, [0, 0]);
});

test('ties follow input order and identical profiles remain distinct repositories', () => {
  const same = { ...data, repos: ['a', 'b', 'c'].map((name) => profile(name, [5, 5])) };
  assert.deepEqual(selectRepos(same, 3).repos, same.repos);
  assert.equal(selectRepos(same, 3).minimumDistance, 0);
});

test('invalid scores and duplicate repositories cannot distort the distance', () => {
  for (const scores of [[0], [0, 11], [NaN, 0], [null, 0], ['2', 0]]) {
    assert.throws(() => selectRepos({ ...data, repos: [profile('a', scores), data.repos[1]] }, 2), /score/);
  }
  for (const url of [data.repos[0].url, 'https://github.com/TEST/A.git']) {
    assert.throws(() => selectRepos({ ...data, repos: [data.repos[0], { ...data.repos[1], url }] }, 2), /once/);
  }
  assert.throws(() => selectRepos({ ...data, axes: ['state', 'state'] }, 2), /distinct/);
  assert.throws(() => selectRepos(data, 5), /count/);
  assert.throws(() => selectRepos(data, 2.5), /count/);
  assert.throws(() => selectRepos({ ...data, repos: [profile('a/tree/main', [0, 0]), data.repos[1]] }, 2), /URL/);
});

test('the command reports input errors with a nonzero exit status', () => {
  const result = spawnSync(process.execPath, ['scripts/select-repos.js'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Use: node/);
  assert.equal(result.stdout, '');
});

test('the command preserves source evidence and leaves its input file intact', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snowmobile-subset-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'scores.json');
  const input = JSON.stringify({ ...data, repos: data.repos.map((repo) => ({
    ...repo, reasons: ['Synthetic state score.', 'Synthetic parallelism score.'],
    sources: ['Synthetic fixture.'],
  })) });
  fs.writeFileSync(file, input);
  const result = spawnSync(process.execPath, ['scripts/select-repos.js', file, '3'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.minimumDistance, 10);
  assert.deepEqual(output.repos[0], JSON.parse(input).repos[2]);
  assert.equal(fs.readFileSync(file, 'utf8'), input);
});
