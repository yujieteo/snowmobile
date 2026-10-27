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

test('the real corpus has complete source evidence and yields a more distant subset', () => {
  const corpus = require('../data/repo-scores.json');
  assert.equal(corpus.axisDefinitions.length, corpus.axes.length);
  for (const definition of corpus.axisDefinitions) {
    assert.ok(definition.zero.trim());
    assert.ok(definition.ten.trim());
    assert.notEqual(definition.zero, definition.ten);
  }
  for (const repo of corpus.repos) {
    assert.match(repo.revision, /^[a-f0-9]{40}$/);
    assert.ok(repo.sources.includes(`${repo.url}/blob/${repo.revision}/README.md`));
  }
  for (const record of [...corpus.repos, ...corpus.paradigms]) {
    assert.ok(record.scope.trim());
    assert.equal(record.reasons.length, corpus.axes.length);
    for (const evidence of record.reasons) {
      assert.ok(evidence.reason.trim());
      assert.ok(record.sources.includes(evidence.source));
      assert.equal(new URL(evidence.source).protocol, 'https:');
    }
  }
  const baseline = selectRepos({ ...corpus, repos: corpus.repos.slice(0, 3) }, 3);
  const selected = selectRepos(corpus, 3);
  assert.ok(selected.minimumDistance > baseline.minimumDistance);
  assert.deepEqual(new Set(corpus.repos.map((repo) => repo.layer)),
    new Set(['language', 'hardware', 'os', 'software']));
});

test('the real corpus maps source-backed paradigms from all Stack layers with repositories', () => {
  const corpus = require('../data/repo-scores.json');
  const selected = selectRepos(corpus, 3);
  assert.ok(selected.map);
  assert.deepEqual(new Set(corpus.paradigms.map((record) => record.layer)),
    new Set(['language', 'hardware', 'os', 'software']));
  for (const paradigm of corpus.paradigms) assert.ok(paradigm.definition.trim());
  assert.equal(selected.map.points.length, corpus.repos.length + corpus.paradigms.length);
  assert.ok(selected.map.points.flat().every(Number.isFinite));
  assert.ok(selected.map.explained.every((share) => share > 0 && share <= 1));
  assert.deepEqual(selected.map.records.filter(({ kind }) => kind === 'paradigm').map(({ record }) => record),
    corpus.paradigms);
  const { paradigms, ...reposOnly } = corpus;
  assert.deepEqual(selected.repos, selectRepos(reposOnly, 3).repos);
});

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

test('joint PCA uses one frame for all records and preserves axis distances in two dimensions', () => {
  // A synthetic rectangle has variances in a 25:1 ratio and a known centre.
  const input = {
    axes: ['state', 'parallelism'],
    repos: [profile('a', [0, 0]), profile('b', [0, 2]), profile('c', [10, 0])],
    paradigms: [{ name: 'Synthetic paradigm', layer: 'software', scores: [10, 2],
      sources: ['Synthetic fixture.'], reasons: ['Synthetic state score.', 'Synthetic parallelism score.'] }],
  };
  const original = structuredClone(input);
  const result = selectRepos(input, 2);
  const { map } = result;
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} differs from ${b}`);
  assert.deepEqual(map.mean, [5, 1]);
  near(map.explained[0], 25 / 26);
  near(map.explained[1], 1 / 26);
  assert.deepEqual(map.components, [[1, 0], [0, 1]]);
  assert.deepEqual(map.points, [[-5, -1], [-5, 1], [5, -1], [5, 1]]);
  assert.deepEqual(map.records, [
    ...input.repos.map((record) => ({ kind: 'repo', record })),
    { kind: 'paradigm', record: input.paradigms[0] },
  ]);
  const separation = (a, b) => Math.hypot(...a.map((value, i) => value - b[i]));
  for (let i = 0; i < map.records.length; i++) for (let j = i + 1; j < map.records.length; j++) {
    near(separation(map.points[i], map.points[j]),
      separation(map.records[i].record.scores, map.records[j].record.scores));
  }
  assert.deepEqual(selectRepos(input, 3).map, map);
  assert.deepEqual(result.repos, selectRepos({ axes: input.axes, repos: input.repos }, 2).repos);
  assert.deepEqual(input, original);
});

test('joint PCA rejects incomplete, duplicate and invalid paradigm profiles', () => {
  const paradigm = { name: 'Synthetic paradigm', layer: 'software', scores: [0, 0] };
  for (const paradigms of [[], {}, [null], [{ ...paradigm, name: ' ' }], [{ ...paradigm, layer: 'unknown' }],
    [paradigm, { ...paradigm, name: ' SYNTHETIC PARADIGM ' }],
    ...[[0], [0, 11], [NaN, 0], [null, 0], ['2', 0]].map((scores) => [{ ...paradigm, scores }])]) {
    assert.throws(() => selectRepos({ ...data, paradigms }, 2), /paradigm|score/);
  }
  assert.equal('map' in selectRepos(data, 2), false);
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
  const input = JSON.stringify({ ...data,
    paradigms: [{ name: 'Synthetic paradigm', layer: 'hardware', scores: [2, 3] }],
    repos: data.repos.map((repo) => ({
    ...repo, reasons: ['Synthetic state score.', 'Synthetic parallelism score.'],
    sources: ['Synthetic fixture.'],
  })) });
  fs.writeFileSync(file, input);
  const result = spawnSync(process.execPath, ['scripts/select-repos.js', file, '3'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.minimumDistance, 10);
  assert.deepEqual(output.repos[0], JSON.parse(input).repos[2]);
  assert.equal(output.map.points.length, data.repos.length + 1);
  assert.deepEqual(output.map.records.at(-1), { kind: 'paradigm', record: JSON.parse(input).paradigms[0] });
  assert.equal(fs.readFileSync(file, 'utf8'), input);
});
