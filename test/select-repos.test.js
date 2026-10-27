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
  const { paradigms, coverageBaseline, ...reposOnly } = corpus;
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

test('each initial pair improves real subsets to the exhaustive optimum for this corpus', () => {
  const corpus = require('../data/repo-scores.json');
  const separation = (subset) => Math.min(...subset.flatMap((repo, i) => subset.slice(i + 1)
    .map((other) => Math.hypot(...repo.scores.map((value, axis) => value - other.scores[axis])))));
  const optimum = (count, subset = [], start = 0) => {
    if (subset.length === count) return separation(subset);
    let best = -Infinity;
    for (let i = start; i <= corpus.repos.length - (count - subset.length); i++) {
      best = Math.max(best, optimum(count, [...subset, corpus.repos[i]], i + 1));
    }
    return best;
  };
  // These are the measured results from the former farthest-pair start.
  const former = [Math.sqrt(249), Math.sqrt(177), Math.sqrt(160)];
  for (let count = 2; count <= corpus.repos.length; count++) {
    const result = selectRepos(corpus, count);
    assert.ok(Math.abs(result.minimumDistance - optimum(count)) < 1e-9);
    assert.equal(new Set(result.repos).size, count);
    if (count >= 3 && count <= 5) assert.ok(result.minimumDistance > former[count - 3]);
  }
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
  assert.equal('gaps' in selectRepos(data, 2), false);
});

test('map coverage bounds the largest empty circle on a known square', () => {
  // Synthetic profiles describe geometry only, not real projects or paradigms.
  const input = {
    axes: ['x', 'y'],
    repos: [[0, 0], [0, 10], [10, 0], [10, 10]].map((scores, i) => profile(`corner-${i}`, scores)),
    paradigms: [{ name: 'Centre', layer: 'software', scores: [5, 5] }],
  };
  const before = selectRepos(input, 2).map;
  assert.deepEqual(before.coverage.bounds, { min: [-5, -5], max: [5, 5] });
  assert.deepEqual(before.coverage.center, [-5, -5]);
  assert.equal(before.coverage.radius, Math.sqrt(50));
  assert.equal(before.coverage.gridSteps, 40);
  assert.equal(before.coverage.errorBound, Math.hypot(0.25, 0.25) / 2);
  const after = selectRepos({ ...input, paradigms: [...input.paradigms,
    ...input.repos.map((repo, i) => ({ name: `Corner ${i}`, layer: 'software', scores: repo.scores })),
  ] }, 2).map;
  assert.deepEqual(after.components, before.components);
  assert.deepEqual(after.mean, before.mean);
  assert.deepEqual(after.coverage.bounds, before.coverage.bounds);
  assert.equal(after.coverage.radius, 5);
  assert.ok(after.coverage.radius < before.coverage.radius);
  assert.deepEqual(selectRepos(input, 4).map.coverage, before.coverage);
});

test('map coverage remains finite on coincident and collinear profiles', () => {
  for (const scores of [[5, 5], [10, 5]]) {
    const input = { axes: ['x', 'y'], repos: [profile('a', [5, 5]), profile('b', scores)],
      paradigms: [{ name: 'Centre', layer: 'software', scores: [5, 5] }] };
    const coverage = selectRepos(input, 2).map.coverage;
    const exact = scores[0] - 5;
    assert.equal(coverage.radius, exact);
    assert.ok(Number.isFinite(coverage.errorBound));
    assert.ok(coverage.errorBound >= 0);
  }
});

test('coverage compares a baseline within the full PCA frame and rectangle', () => {
  const input = {
    axes: ['x', 'y'],
    repos: [[0, 0], [0, 10], [10, 0], [10, 10]].map((scores, i) => profile(`corner-${i}`, scores)),
    paradigms: [[3, 4], [0, 0], [0, 10], [10, 0], [10, 10]].map((scores, i) =>
      ({ name: `Point ${i}`, layer: 'software', scores })),
    coverageBaseline: [' POINT 0 '],
  };
  const original = structuredClone(input);
  const { map } = selectRepos(input, 2);
  const { baseline, ...coverage } = map.coverage;
  const { coverageBaseline, ...withoutBaseline } = input;
  assert.deepEqual(coverage, selectRepos(withoutBaseline, 2).map.coverage);
  const point = map.points[input.repos.length];
  const { min, max } = map.coverage.bounds;
  const corners = [min[0], max[0]].flatMap((x) => [min[1], max[1]].map((y) => [x, y]));
  const exact = Math.max(...corners.map((corner) => Math.hypot(...corner.map((v, i) => v - point[i]))));
  assert.ok(Math.abs(baseline.radius - exact) < 1e-9);
  assert.deepEqual(baseline.names, ['Point 0']);
  assert.ok(baseline.radius > coverage.radius);
  assert.deepEqual(selectRepos(input, 4).map, map);
  assert.notDeepEqual(selectRepos({ ...withoutBaseline, paradigms: [input.paradigms[0]] }, 2).map.mean, map.mean);
  assert.deepEqual(input, original);
  const all = selectRepos({ ...input, coverageBaseline: input.paradigms.map((p) => p.name) }, 2).map.coverage;
  assert.equal(all.baseline.radius, all.radius);
  assert.deepEqual(all.baseline.center, all.center);
});

test('coverage baselines reject absent, empty, duplicate and unknown profiles', () => {
  assert.throws(() => selectRepos({ ...data, coverageBaseline: ['Absent'] }, 2), /paradigm/);
  const input = { ...data, paradigms: [{ name: 'Centre', layer: 'software', scores: [5, 5] }] };
  for (const coverageBaseline of [[], null, {}, ['Absent'], [null], ['Centre', ' CENTRE ']]) {
    assert.throws(() => selectRepos({ ...input, coverageBaseline }, 2), /baseline/);
  }
});

test('the error bound includes an empty-circle centre between grid nodes', () => {
  const input = { axes: ['x', 'y'], repos: [profile('a', [0, 0]), profile('b', [10, 0])],
    paradigms: [0, 3.1, 10].map((x, i) => ({ name: `Point ${i}`, layer: 'software', scores: [x, 0] })) };
  const { radius, errorBound } = selectRepos(input, 2).map.coverage;
  const exact = (10 - 3.1) / 2;
  assert.ok(radius < exact);
  assert.ok(exact <= radius + errorBound);
  assert.ok(Math.abs(radius - 3.4) < 1e-9);
  assert.ok(Math.abs(errorBound - 0.125) < 1e-9);
});

test('the prior map has empty space despite zero repository search regions', () => {
  const corpus = corpusBeforeAutomerge();
  const result = selectRepos(corpus, corpus.repos.length);
  assert.deepEqual(result.gaps, []);
  const { center, radius, errorBound } = result.map.coverage;
  const nearest = Math.min(...result.map.points.slice(corpus.repos.length)
    .map((point) => Math.hypot(...point.map((value, axis) => value - center[axis]))));
  assert.ok(Math.abs(nearest - radius) < 1e-9);
  assert.ok(radius > 7);
  assert.ok(errorBound < 0.33);
});

test('the real baseline measures a coverage gain within one map', () => {
  const corpus = require('../data/repo-scores.json');
  const { map } = selectRepos(corpus, corpus.repos.length);
  const { baseline, radius, errorBound } = map.coverage;
  assert.deepEqual(baseline.names, corpus.coverageBaseline);
  // The lower bound before exceeds the upper bound after.
  assert.ok(baseline.radius > radius + errorBound);
});

test('gap regions retain axis separation that the first two components omit', () => {
  // Synthetic corners share map coordinates but differ on the third axis.
  const corners = [[0, 0], [0, 10], [10, 0], [10, 10]];
  const input = {
    axes: ['x', 'y', 'z'],
    repos: corners.map((point, i) => profile(`corner-${i}`, [...point, 4])),
    paradigms: corners.map((point, i) =>
      ({ name: `Corner ${i}`, layer: 'hardware', scores: [...point, 6] })),
  };
  const result = selectRepos(input, 4);
  assert.deepEqual(result.map.components, [[1, 0, 0], [0, 1, 0]]);
  assert.equal(result.gaps.length, 4);
  assert.deepEqual(new Set(result.gaps.map((gap) => gap.repo)), new Set(result.repos));
  for (const gap of result.gaps) {
    assert.equal(gap.nearestOnMap.distance, 0);
    assert.equal(gap.nearestOnAxes.distance, 2);
  }
});

test('gap regions use selected repositories and exact nearest distances in each space', () => {
  const input = {
    axes: ['state', 'parallelism'],
    repos: [profile('a', [0, 0]), profile('b', [0, 2]), profile('c', [10, 0])],
    paradigms: [{ name: 'Synthetic paradigm', layer: 'software', scores: [10, 2] }],
  };
  const original = structuredClone(input);
  const result = selectRepos(input, 2);
  assert.deepEqual(result.gaps.map((gap) => gap.repo), [input.repos[1], input.repos[2]]);
  assert.deepEqual(result.gaps.map((gap) => gap.nearestOnMap.distance), [10, 2]);
  assert.deepEqual(result.gaps.map((gap) => gap.nearestOnAxes.distance), [10, 2]);
  for (const gap of result.gaps) {
    assert.deepEqual(gap.nearestOnMap.paradigm, input.paradigms[0]);
    assert.deepEqual(gap.nearestOnAxes.paradigm, input.paradigms[0]);
    assert.deepEqual(gap.point, result.map.points[input.repos.indexOf(gap.repo)]);
  }
  const covered = { ...input, paradigms: input.repos.map((repo, i) => ({
    name: `Synthetic ${i}`, layer: 'software', scores: repo.scores,
  })) };
  assert.deepEqual(selectRepos(covered, 2).gaps, []);
  assert.deepEqual(input, original);
});

// Keep prior discovery checks on the repository pool that supplied their measurements.
function corpusBeforeKubo() {
  const corpus = require('../data/repo-scores.json');
  return { ...corpus, repos: corpus.repos.filter((repo) => repo.name !== 'Kubo'),
    paradigms: corpus.paradigms.filter((p) => p.name !== 'Peer-to-peer') };
}

function corpusBeforeAutomerge() {
  const corpus = corpusBeforeKubo();
  return { ...corpus, repos: corpus.repos.filter((repo) => repo.name !== 'Automerge'),
    paradigms: corpus.paradigms.filter((p) =>
      !['Conflict-free replicated data types', 'Reconfigurable logic (FPGA)',
        'Cluster (warehouse-scale computer)', 'Multikernel', 'Hardware root of trust', 'Microservices',
        'Logic programming', 'Distributed OS', 'Event sourcing', 'Constraint programming', 'Separation kernel', 'Domain-specific accelerator'].includes(p.name)) };
}

function corpusBeforeGforth() {
  const corpus = corpusBeforeAutomerge();
  return { ...corpus, repos: corpus.repos.filter((repo) => repo.name !== 'Gforth'),
    paradigms: corpus.paradigms.filter((p) => !['Concatenative programming', 'Single-level store'].includes(p.name)) };
}

test('Gforth improves seven-repository separation and retains a source-backed search region', () => {
  const current = corpusBeforeAutomerge();
  // Exclude the later profile to retain the original discovery measurement.
  const corpus = { ...current,
    paradigms: current.paradigms.filter((p) => p.name !== 'Concatenative programming') };
  const before = selectRepos(corpusBeforeGforth(), 7);
  const after = selectRepos(corpus, 7);
  assert.equal(before.minimumDistance, 9);
  assert.ok(Math.abs(after.minimumDistance - Math.sqrt(104)) < 1e-9);
  assert.ok(after.minimumDistance > before.minimumDistance);
  const region = after.gaps.find((gap) => gap.repo.name === 'Gforth');
  assert.ok(region);
  assert.equal(region.repo.layer, 'language');
  assert.ok(Math.abs(region.nearestOnAxes.distance - Math.sqrt(104)) < 1e-9);
  assert.ok(region.nearestOnMap.distance > 0);
  assert.equal(region.nearestOnAxes.paradigm.name, 'Capability-based OS');
  assert.ok(region.repo.reasons.every((reason) => region.repo.sources.includes(reason.source)));
  assert.equal(after.map.records.filter(({ kind }) => kind === 'repo').length,
    before.map.records.filter(({ kind }) => kind === 'repo').length + 1);
});

test('the existing concatenative seed profile removes the duplicate Gforth search candidate', () => {
  const corpus = corpusBeforeAutomerge();
  const candidate = corpus.paradigms.find((p) => p.name === 'Concatenative programming');
  assert.ok(candidate);
  const before = selectRepos({ ...corpus,
    paradigms: corpus.paradigms.filter((p) => p !== candidate) }, corpus.repos.length);
  const region = before.gaps.find((gap) => gap.repo.name === 'Gforth');
  assert.ok(region);
  assert.ok(Math.abs(region.nearestOnAxes.distance - Math.sqrt(104)) < 1e-9);
  assert.ok(candidate.suggestedBy.includes(region.repo.url));
  assert.equal(candidate.scope, region.repo.scope);
  assert.deepEqual(candidate.scores, region.repo.scores);
  const after = selectRepos(corpus, corpus.repos.length);
  assert.equal(before.gaps.length, after.gaps.length + 1);
  assert.deepEqual(after.gaps, []);
  assert.deepEqual(selectRepos(corpus, 7).gaps, []);
  assert.deepEqual(after.repos, before.repos);
  assert.equal(after.minimumDistance, before.minimumDistance);
});

test('real gap regions exclude an exact profile match and retain source evidence', () => {
  const corpus = corpusBeforeGforth();
  // Omit the actor profile to retain a real uncovered region for this distance check.
  const result = selectRepos({ ...corpus,
    paradigms: corpus.paradigms.filter((p) => p.name !== 'Actor model') }, 3);
  assert.ok(result.gaps.length > 0);
  assert.ok(result.gaps.every((gap) => !['SQLite', 'Rocket Chip'].includes(gap.repo.name)));
  for (const gap of result.gaps) {
    assert.ok(result.repos.includes(gap.repo));
    assert.ok(gap.repo.sources.length);
    for (const [key, point] of [['nearestOnMap', gap.point], ['nearestOnAxes', gap.repo.scores]]) {
      const vectors = key === 'nearestOnMap'
        ? result.map.points.slice(corpus.repos.length)
        : result.map.records.filter(({ kind }) => kind === 'paradigm').map(({ record }) => record.scores);
      const distances = vectors.map((vector) => Math.hypot(...vector.map((value, i) => value - point[i])));
      assert.ok(Math.abs(gap[key].distance - Math.min(...distances)) < 1e-9);
      const paradigms = result.map.records.filter(({ kind }) => kind === 'paradigm').map(({ record }) => record);
      assert.deepEqual(gap[key].paradigm, paradigms[distances.indexOf(Math.min(...distances))]);
    }
  }
});

test('the existing actor seed profile removes the duplicate Erlang search candidate', () => {
  const corpus = corpusBeforeGforth();
  const actor = corpus.paradigms.find((p) => p.name === 'Actor model');
  assert.ok(actor);
  const before = selectRepos({ ...corpus,
    paradigms: corpus.paradigms.filter((p) => p !== actor) }, 3);
  const region = before.gaps.find((gap) => gap.repo.name === 'Erlang/OTP');
  assert.ok(region);
  assert.ok(region.nearestOnAxes.distance > 0);
  assert.ok(actor.suggestedBy.includes(region.repo.url));
  assert.deepEqual(actor.scores, region.repo.scores);
  const after = selectRepos(corpus, 3);
  assert.equal(before.gaps.length, after.gaps.length + 1);
  assert.ok(after.gaps.every((gap) => gap.repo.name !== 'Erlang/OTP'));
  assert.deepEqual(after.repos, before.repos);
});

test('the verified hardware generator profile closes the Rocket Chip search region', () => {
  const corpus = corpusBeforeGforth();
  const candidate = corpus.paradigms.find((p) => p.name === 'Hardware generators');
  assert.ok(candidate);
  const before = selectRepos({ ...corpus,
    paradigms: corpus.paradigms.filter((p) => p !== candidate) }, corpus.repos.length);
  const region = before.gaps.find((gap) => gap.repo.name === 'Rocket Chip');
  assert.ok(region);
  assert.ok(region.nearestOnAxes.distance > 6);
  assert.ok(candidate.suggestedBy.includes(region.repo.url));
  assert.deepEqual(candidate.scores, region.repo.scores);
  const after = selectRepos(corpus, corpus.repos.length);
  assert.ok(after.gaps.every((gap) => gap.repo.name !== 'Rocket Chip'));
  assert.deepEqual(after.repos, before.repos);
});

test('functional package management covers the Nix region in the full repository pool', () => {
  const corpus = corpusBeforeGforth();
  const candidate = corpus.paradigms.find((p) => p.name === 'Functional package management');
  assert.ok(candidate);
  const before = selectRepos({ ...corpus,
    paradigms: corpus.paradigms.filter((p) => p !== candidate) }, corpus.repos.length);
  const region = before.gaps.find((gap) => gap.repo.name === 'Nix');
  assert.ok(region);
  assert.ok(region.nearestOnAxes.distance > 11);
  assert.ok(candidate.suggestedBy.includes(region.repo.url));
  assert.deepEqual(candidate.scores, region.repo.scores);
  const after = selectRepos(corpus, corpus.repos.length);
  assert.equal(before.gaps.length, after.gaps.length + 1);
  assert.ok(after.gaps.every((gap) => gap.repo.name !== 'Nix'));
  assert.deepEqual(after.repos, before.repos);
});

test('consistent Unikraft evidence removes a false region from the full repository pool', () => {
  const corpus = corpusBeforeGforth();
  const repo = corpus.repos.find((record) => record.name === 'Unikraft');
  const paradigm = corpus.paradigms.find((record) => record.name === 'Unikernel');
  // Restore the two uncertain midpoint scores from the earlier README-only profile.
  const earlier = structuredClone(corpus);
  const oldRepo = earlier.repos.find((record) => record.name === 'Unikraft');
  oldRepo.scores[2] = 5;
  oldRepo.scores[6] = 5;
  const before = selectRepos(earlier, earlier.repos.length);
  const region = before.gaps.find((gap) => gap.repo.name === 'Unikraft');
  assert.ok(region);
  assert.ok(Math.abs(region.nearestOnAxes.distance - Math.sqrt(50)) < 1e-9);
  assert.equal(repo.scope, paradigm.scope);
  assert.deepEqual(repo.scores, paradigm.scores);
  assert.equal(repo.scores[2], 0);
  assert.equal(repo.scores[6], 0);
  for (const axis of [2, 6]) {
    assert.ok(paradigm.sources.includes(repo.reasons[axis].source));
    assert.doesNotMatch(repo.reasons[axis].reason, /uncertain/);
  }
  const after = selectRepos(corpus, corpus.repos.length);
  assert.equal(before.gaps.length, after.gaps.length + 1);
  assert.deepEqual(after.gaps.map((gap) => gap.repo.name),
    before.gaps.filter((gap) => gap.repo.name !== 'Unikraft').map((gap) => gap.repo.name));
  assert.deepEqual(new Set(after.repos.map((record) => record.url)),
    new Set(before.repos.map((record) => record.url)));
});

test('the data structure server profile covers the Redis region without a duplicate seed', () => {
  const corpus = corpusBeforeGforth();
  const candidate = corpus.paradigms.find((p) => p.name === 'Data structure server');
  assert.ok(candidate);
  const before = selectRepos({ ...corpus,
    paradigms: corpus.paradigms.filter((p) => p !== candidate) }, corpus.repos.length);
  const region = before.gaps.find((gap) => gap.repo.name === 'Redis');
  assert.ok(region);
  assert.equal(region.nearestOnAxes.distance, 9);
  assert.ok(candidate.suggestedBy.includes(region.repo.url));
  assert.deepEqual(candidate.scores, region.repo.scores);
  const after = selectRepos(corpus, corpus.repos.length);
  assert.equal(before.gaps.length, after.gaps.length + 1);
  assert.ok(after.gaps.every((gap) => gap.repo.name !== 'Redis'));
  assert.deepEqual(after.repos, before.repos);
});

test('seL4 increases four-repository separation and exposes an OS search region', () => {
  const current = corpusBeforeGforth();
  // Exclude the later profile to retain the original repository discovery check.
  const corpus = { ...current,
    paradigms: current.paradigms.filter((p) => p.name !== 'Capability-based OS') };
  const baseline = { ...corpus, repos: corpus.repos.filter((repo) => repo.name !== 'seL4') };
  const before = selectRepos(baseline, 4);
  const after = selectRepos(corpus, 4);
  assert.ok(after.minimumDistance > before.minimumDistance);
  assert.ok(Math.abs(after.minimumDistance - Math.sqrt(214)) < 1e-9);
  assert.equal(baseline.repos.filter((repo) => repo.layer === 'os').length, 1);
  assert.equal(corpus.repos.filter((repo) => repo.layer === 'os').length, 2);
  const region = after.gaps.find((gap) => gap.repo.name === 'seL4');
  assert.ok(region);
  assert.ok(Math.abs(region.nearestOnAxes.distance - Math.sqrt(76)) < 1e-9);
  assert.ok(region.nearestOnMap.distance > 6);
  assert.ok(region.repo.reasons[5].reason.includes('uncertain'));
});

test('the existing capability OS profile removes the duplicate seL4 search candidate', () => {
  const corpus = corpusBeforeGforth();
  const candidate = corpus.paradigms.find((p) => p.name === 'Capability-based OS');
  assert.ok(candidate);
  const before = selectRepos({ ...corpus,
    paradigms: corpus.paradigms.filter((p) => p !== candidate) }, 4);
  const region = before.gaps.find((gap) => gap.repo.name === 'seL4');
  assert.ok(region);
  assert.ok(Math.abs(region.nearestOnAxes.distance - Math.sqrt(76)) < 1e-9);
  assert.ok(candidate.suggestedBy.includes(region.repo.url));
  assert.equal(candidate.scope, region.repo.scope);
  assert.deepEqual(candidate.scores, region.repo.scores);
  assert.ok(candidate.reasons[5].reason.includes('uncertain'));
  const after = selectRepos(corpus, 4);
  assert.equal(before.gaps.length, after.gaps.length + 1);
  assert.deepEqual(after.gaps, []);
  assert.ok(selectRepos(corpus, corpus.repos.length).gaps.every((gap) => gap.repo.name !== 'seL4'));
  assert.deepEqual(after.repos, before.repos);
  assert.equal(after.minimumDistance, before.minimumDistance);
});

test('GHCi increases six-repository separation and exposes a language search region', () => {
  const current = corpusBeforeGforth();
  // Exclude the later profile to retain the original repository discovery check.
  const corpus = { ...current,
    paradigms: current.paradigms.filter((p) => p.name !== 'Functional programming') };
  const baseline = { ...corpus, repos: corpus.repos.filter((repo) => repo.name !== 'GHCi') };
  const before = selectRepos(baseline, 6);
  const after = selectRepos(corpus, 6);
  assert.equal(before.minimumDistance, 9);
  assert.ok(Math.abs(after.minimumDistance - Math.sqrt(143)) < 1e-9);
  assert.ok(after.minimumDistance > before.minimumDistance);
  const region = after.gaps.find((gap) => gap.repo.name === 'GHCi');
  assert.ok(region);
  assert.equal(region.repo.layer, 'language');
  assert.ok(Math.abs(region.nearestOnAxes.distance - Math.sqrt(143)) < 1e-9);
  assert.ok(region.nearestOnMap.distance > 0);
  assert.equal(region.nearestOnAxes.paradigm.name, 'Embedded database');
  assert.equal(corpus.repos.filter((repo) => repo.layer === 'language').length,
    baseline.repos.filter((repo) => repo.layer === 'language').length + 1);
});

test('the existing functional seed profile removes the duplicate GHCi search candidate', () => {
  const corpus = corpusBeforeGforth();
  const candidate = corpus.paradigms.find((p) => p.name === 'Functional programming');
  assert.ok(candidate);
  const before = selectRepos({ ...corpus,
    paradigms: corpus.paradigms.filter((p) => p !== candidate) }, corpus.repos.length);
  const region = before.gaps.find((gap) => gap.repo.name === 'GHCi');
  assert.ok(region);
  assert.ok(Math.abs(region.nearestOnAxes.distance - Math.sqrt(143)) < 1e-9);
  assert.ok(candidate.suggestedBy.includes(region.repo.url));
  assert.equal(candidate.scope, region.repo.scope);
  assert.deepEqual(candidate.scores, region.repo.scores);
  const after = selectRepos(corpus, corpus.repos.length);
  assert.equal(before.gaps.length, after.gaps.length + 1);
  assert.deepEqual(after.gaps, []);
  assert.deepEqual(selectRepos(corpus, 6).gaps, []);
  assert.deepEqual(after.repos, before.repos);
  assert.equal(after.minimumDistance, before.minimumDistance);
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
    coverageBaseline: ['Synthetic paradigm'],
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
  assert.equal(output.map.coverage.baseline.radius, output.map.coverage.radius);
  assert.equal(fs.readFileSync(file, 'utf8'), input);
});

test('the single-level store profile adds a distinct durable OS example', () => {
  const corpus = corpusBeforeAutomerge();
  const profile = corpus.paradigms.find((p) => p.name === 'Single-level store');
  assert.equal(profile.layer, 'os');
  const previous = corpus.paradigms.filter((p) => p !== profile);
  const nearest = Math.min(...previous.map((p) =>
    Math.hypot(...p.scores.map((score, axis) => score - profile.scores[axis]))));
  assert.equal(nearest, 10);
  assert.ok(profile.scores[7] > Math.max(...previous.filter((p) => p.layer === 'os').map((p) => p.scores[7])));
  assert.match(profile.reasons[5].reason, /uncertain evidence/);
  // Compare only reference sets within one map, rectangle, and grid.
  const { map } = selectRepos({ ...corpus, coverageBaseline: previous.map((p) => p.name) }, corpus.repos.length);
  assert.equal(map.coverage.baseline.radius, map.coverage.radius);
});

test('Automerge improves repository separation and exposes a replicated data region', () => {
  const current = corpusBeforeKubo();
  const corpus = { ...current, paradigms: current.paradigms.filter((p) => p.name !== 'Conflict-free replicated data types') };
  const baseline = corpusBeforeAutomerge();
  for (const [count, beforeSquared, afterSquared] of [[2, 465, 488], [4, 214, 221], [8, 81, 100]]) {
    const before = selectRepos(baseline, count);
    const after = selectRepos(corpus, count);
    assert.ok(Math.abs(before.minimumDistance - Math.sqrt(beforeSquared)) < 1e-9);
    assert.ok(Math.abs(after.minimumDistance - Math.sqrt(afterSquared)) < 1e-9);
    assert.ok(after.minimumDistance > before.minimumDistance);
  }
  const result = selectRepos(corpus, 4);
  const region = result.gaps.find((gap) => gap.repo.name === 'Automerge');
  assert.ok(region);
  assert.equal(region.nearestOnAxes.paradigm.name, 'Actor model');
  assert.ok(Math.abs(region.nearestOnAxes.distance - Math.sqrt(23)) < 1e-9);
  assert.ok(region.nearestOnMap.distance > 0);
  assert.equal(region.repo.layer, 'software');
  assert.ok(region.repo.reasons.every(({ source }) => region.repo.sources.includes(source)));
  assert.ok(selectRepos(corpus, corpus.repos.length).gaps.some((gap) => gap.repo === region.repo));
});

test('the verified CRDT profile covers the Automerge region without a duplicate seed', () => {
  const corpus = corpusBeforeKubo();
  const candidate = corpus.paradigms.find((p) => p.name === 'Conflict-free replicated data types');
  assert.ok(candidate);
  const previous = corpus.paradigms.filter((p) => p !== candidate);
  const before = selectRepos({ ...corpus, paradigms: previous }, corpus.repos.length);
  const region = before.gaps.find((gap) => gap.repo.name === 'Automerge');
  assert.ok(region);
  assert.ok(Math.abs(region.nearestOnAxes.distance - Math.sqrt(23)) < 1e-9);
  assert.equal(candidate.scope, region.repo.scope);
  assert.deepEqual(candidate.scores, region.repo.scores);
  assert.ok(candidate.suggestedBy.includes(region.repo.url));
  const after = selectRepos(corpus, corpus.repos.length);
  assert.equal(before.gaps.length, 1);
  assert.deepEqual(after.gaps, []);
  assert.deepEqual(selectRepos(corpus, 4).gaps, []);
  assert.deepEqual(after.repos, before.repos);
  assert.equal(after.minimumDistance, before.minimumDistance);
  const { map } = selectRepos({ ...corpus, coverageBaseline: previous.map((p) => p.name) }, corpus.repos.length);
  assert.ok(map.coverage.radius <= map.coverage.baseline.radius);
});

test('the FPGA profile adds hardware flexibility without a duplicate seed', () => {
  const current = corpusBeforeKubo();
  // Preserve the corpus for this historical measurement.
  const corpus = { ...current, paradigms: current.paradigms.filter((p) => p.name !== 'Domain-specific accelerator') };
  const candidate = corpus.paradigms.find((p) => p.name === 'Reconfigurable logic (FPGA)');
  const previous = corpus.paradigms.filter((p) => p !== candidate);
  const hardware = previous.filter((p) => p.layer === 'hardware');
  assert.equal(candidate.layer, 'hardware');
  assert.ok(candidate.scores[3] > Math.max(...hardware.map((p) => p.scores[3])));
  const nearest = Math.min(...previous.map((p) =>
    Math.hypot(...p.scores.map((value, axis) => value - candidate.scores[axis]))));
  assert.ok(Math.abs(nearest - Math.sqrt(69)) < 1e-9);
  assert.match(candidate.reasons[6].reason, /uncertain evidence/);
  const source = fs.readFileSync(path.join(__dirname, '../snowmobile.js'), 'utf8');
  assert.equal(source.split("['Reconfigurable logic (FPGA)',").length - 1, 1);
  const { map, gaps } = selectRepos({ ...corpus,
    coverageBaseline: previous.map((p) => p.name) }, corpus.repos.length);
  assert.deepEqual(gaps, []);
  assert.equal(map.coverage.radius, map.coverage.baseline.radius);
});

test('the cluster profile adds a distributed hardware example without a duplicate seed', () => {
  const current = corpusBeforeKubo();
  // Preserve the corpus for this historical measurement.
  const corpus = { ...current, paradigms: current.paradigms.filter((p) => p.name !== 'Distributed OS') };
  const candidate = corpus.paradigms.find((p) => p.name === 'Cluster (warehouse-scale computer)');
  const previous = corpus.paradigms.filter((p) => p !== candidate);
  assert.equal(candidate.layer, 'hardware');
  assert.ok(candidate.scores[2] > Math.max(...previous.filter((p) => p.layer === 'hardware').map((p) => p.scores[2])));
  const nearest = Math.min(...previous.map((p) =>
    Math.hypot(...p.scores.map((value, axis) => value - candidate.scores[axis]))));
  assert.ok(Math.abs(nearest - Math.sqrt(86)) < 1e-9);
  const source = fs.readFileSync(path.join(__dirname, '../snowmobile.js'), 'utf8');
  assert.equal(source.split("['Cluster (warehouse-scale computer)',").length - 1, 1);
  const before = selectRepos({ ...corpus, paradigms: previous }, corpus.repos.length);
  const after = selectRepos(corpus, corpus.repos.length);
  assert.deepEqual(after.repos, before.repos);
  assert.equal(after.minimumDistance, before.minimumDistance);
  assert.deepEqual(after.gaps, []);
  const { map } = selectRepos({ ...corpus,
    coverageBaseline: previous.map((p) => p.name) }, corpus.repos.length);
  assert.equal(map.coverage.radius, map.coverage.baseline.radius);
});

test('the multikernel profile adds a distributed OS example without false isolation', () => {
  const current = corpusBeforeKubo();
  // Preserve the corpus for this historical measurement.
  const corpus = { ...current, paradigms: current.paradigms.filter((p) => p.name !== 'Distributed OS') };
  const candidate = corpus.paradigms.find((p) => p.name === 'Multikernel');
  const previous = corpus.paradigms.filter((p) => p !== candidate);
  assert.equal(candidate.layer, 'os');
  assert.ok(candidate.scores[2] > Math.max(...previous.filter((p) => p.layer === 'os').map((p) => p.scores[2])));
  // Replicas can change state, and separate cores do not supply separate failure units.
  assert.equal(candidate.scores[1], 0);
  assert.ok(candidate.scores[6] < 5);
  assert.match(candidate.reasons[6].reason, /one failure unit/);
  const nearest = Math.min(...previous.map((p) =>
    Math.hypot(...p.scores.map((value, axis) => value - candidate.scores[axis]))));
  assert.ok(Math.abs(nearest - Math.sqrt(87)) < 1e-9);
  const source = fs.readFileSync(path.join(__dirname, '../snowmobile.js'), 'utf8');
  assert.equal(source.split("['Multikernel',").length - 1, 1);
  const before = selectRepos({ ...corpus, paradigms: previous }, corpus.repos.length);
  const after = selectRepos(corpus, corpus.repos.length);
  assert.deepEqual(after.repos, before.repos);
  assert.equal(after.minimumDistance, before.minimumDistance);
  assert.deepEqual(after.gaps, []);
  const { map } = selectRepos({ ...corpus,
    coverageBaseline: previous.map((p) => p.name) }, corpus.repos.length);
  assert.equal(map.coverage.radius, map.coverage.baseline.radius);
});

test('the hardware root of trust profile adds a distinct durable device example', () => {
  const corpus = corpusBeforeKubo();
  const candidate = corpus.paradigms.find((p) => p.name === 'Hardware root of trust');
  const previous = corpus.paradigms.filter((p) => p !== candidate);
  assert.equal(candidate.layer, 'hardware');
  const nearest = Math.min(...previous.map((p) =>
    Math.hypot(...p.scores.map((value, axis) => value - candidate.scores[axis]))));
  assert.ok(Math.abs(nearest - Math.sqrt(68)) < 1e-9);
  // Access control alone does not establish separate failure boundaries.
  assert.match(candidate.reasons[6].reason, /uncertain evidence/);
  const source = fs.readFileSync(path.join(__dirname, '../snowmobile.js'), 'utf8');
  assert.equal(source.split("['Hardware root of trust',").length - 1, 1);
  const before = selectRepos({ ...corpus, paradigms: previous }, corpus.repos.length);
  const after = selectRepos(corpus, corpus.repos.length);
  assert.deepEqual(after.repos, before.repos);
  assert.equal(after.minimumDistance, before.minimumDistance);
  assert.deepEqual(after.gaps, []);
  const { map } = selectRepos({ ...corpus,
    coverageBaseline: previous.map((p) => p.name) }, corpus.repos.length);
  assert.equal(map.coverage.radius, map.coverage.baseline.radius);
});


test('the microservices profile separates mutable services from immutable replicas', () => {
  const current = corpusBeforeKubo();
  // Preserve the corpus for this historical measurement.
  const corpus = { ...current, paradigms: current.paradigms.filter((p) => !['Distributed OS', 'Constraint programming'].includes(p.name)) };
  const candidate = corpus.paradigms.find((p) => p.name === 'Microservices');
  const previous = corpus.paradigms.filter((p) => p !== candidate);
  assert.equal(candidate.layer, 'software');
  assert.equal(candidate.scores[1], 0);
  assert.match(candidate.reasons[5].reason, /uncertain evidence/);
  const nearest = Math.min(...previous.map((p) =>
    Math.hypot(...p.scores.map((value, axis) => value - candidate.scores[axis]))));
  assert.ok(Math.abs(nearest - Math.sqrt(29)) < 1e-9);
  const source = fs.readFileSync(path.join(__dirname, '../snowmobile.js'), 'utf8');
  assert.equal(source.split("['Microservices',").length - 1, 1);
  const before = selectRepos({ ...corpus, paradigms: previous }, corpus.repos.length);
  const after = selectRepos(corpus, corpus.repos.length);
  assert.deepEqual(after.repos, before.repos);
  assert.equal(after.minimumDistance, before.minimumDistance);
  assert.deepEqual(after.gaps, []);
  const { map } = selectRepos({ ...corpus,
    coverageBaseline: previous.map((p) => p.name) }, corpus.repos.length);
  assert.equal(map.coverage.radius, map.coverage.baseline.radius);
});

test('the logic profile distinguishes mutable clauses from immutable functional values', () => {
  const corpus = corpusBeforeKubo();
  const candidate = corpus.paradigms.find((p) => p.name === 'Logic programming');
  const previous = corpus.paradigms.filter((p) => p !== candidate);
  assert.equal(candidate.layer, 'language');
  const functional = previous.find((p) => p.name === 'Functional programming');
  assert.ok(candidate.scores[1] < functional.scores[1]);
  assert.match(candidate.reasons[1].reason, /changes survive backtracking/);
  assert.equal(candidate.scores[7], 0);
  assert.match(candidate.scope, /disk persistence libraries lie outside/);
  assert.match(candidate.reasons[6].reason, /do not supply independent failure boundaries/);
  const nearest = Math.min(...previous.map((p) =>
    Math.hypot(...p.scores.map((value, axis) => value - candidate.scores[axis]))));
  assert.ok(Math.abs(nearest - Math.sqrt(38)) < 1e-9);
  const source = fs.readFileSync(path.join(__dirname, '../snowmobile.js'), 'utf8');
  assert.equal(source.split("['Logic programming',").length - 1, 1);
  const { map, gaps } = selectRepos({ ...corpus,
    coverageBaseline: previous.map((p) => p.name) }, corpus.repos.length);
  assert.deepEqual(gaps, []);
  assert.equal(map.coverage.radius, map.coverage.baseline.radius);
});


test('the distributed OS profile preserves private namespaces and mutable active files', () => {
  const corpus = corpusBeforeKubo();
  const candidate = corpus.paradigms.find((p) => p.name === 'Distributed OS');
  const previous = corpus.paradigms.filter((p) => p !== candidate);
  assert.equal(candidate.layer, 'os');
  assert.match(candidate.scope, /private per-process namespaces/);
  assert.match(candidate.reasons[1].reason, /change active files/);
  assert.ok(candidate.scores[1] < 5);
  assert.equal(candidate.scores[2], 10);
  assert.equal(candidate.scores[7], 10);
  assert.match(candidate.reasons[5].reason, /uncertain evidence/);
  assert.match(candidate.reasons[6].reason, /uncertain evidence/);
  const nearest = Math.min(...previous.map((p) =>
    Math.hypot(...p.scores.map((value, axis) => value - candidate.scores[axis]))));
  assert.ok(Math.abs(nearest - Math.sqrt(18)) < 1e-9);
  const source = fs.readFileSync(path.join(__dirname, '../snowmobile.js'), 'utf8');
  assert.equal(source.split("['Distributed OS',").length - 1, 1);
  assert.ok(source.includes(`['Distributed OS', '${candidate.definition}', '${candidate.sources[0]}']`));
  const { map, gaps } = selectRepos({ ...corpus,
    coverageBaseline: previous.map((p) => p.name) }, corpus.repos.length);
  assert.deepEqual(gaps, []);
  assert.equal(map.coverage.radius, map.coverage.baseline.radius);
});

test('the event log profile preserves history without an assumed distributed deployment', () => {
  const corpus = corpusBeforeKubo();
  const candidate = corpus.paradigms.find((p) => p.name === 'Event sourcing');
  assert.ok(candidate);
  assert.equal(candidate.layer, 'software');
  assert.match(candidate.scope, /mutable projections/);
  assert.equal(candidate.scores[2], 0);
  assert.match(candidate.reasons[5].reason, /uncertain evidence/);
  const previous = corpus.paradigms.filter((p) => p !== candidate);
  const nearest = Math.min(...previous.map((p) =>
    Math.hypot(...p.scores.map((value, axis) => value - candidate.scores[axis]))));
  assert.equal(nearest, 11);
  const source = fs.readFileSync(path.join(__dirname, '../snowmobile.js'), 'utf8');
  assert.equal(source.split("['Event sourcing',").length - 1, 1);
  assert.ok(source.includes(`['Event sourcing', '${candidate.definition}', '${candidate.sources[0]}']`));
  const { map, gaps } = selectRepos({ ...corpus,
    coverageBaseline: previous.map((p) => p.name) }, corpus.repos.length);
  assert.deepEqual(gaps, []);
  assert.ok(map.coverage.radius <= map.coverage.baseline.radius);
});


test('the constraint profile separates fixed model values from mutable solver state', () => {
  const corpus = corpusBeforeKubo();
  const candidate = corpus.paradigms.find((p) => p.name === 'Constraint programming');
  assert.ok(candidate);
  assert.equal(candidate.layer, 'language');
  assert.match(candidate.scope, /not mutable solver internals/);
  assert.ok(candidate.scores[1] > 5);
  assert.match(candidate.reasons[1].reason, /Solver search state lies outside/);
  assert.ok(candidate.scores[3] < 5);
  assert.ok(candidate.scores[5] > 5);
  assert.match(candidate.reasons[6].reason, /uncertain evidence/);
  const previous = corpus.paradigms.filter((p) => p !== candidate);
  const nearest = Math.min(...previous.map((p) =>
    Math.hypot(...p.scores.map((value, axis) => value - candidate.scores[axis]))));
  assert.ok(Math.abs(nearest - Math.sqrt(118)) < 1e-9);
  const source = fs.readFileSync(path.join(__dirname, '../snowmobile.js'), 'utf8');
  assert.equal(source.split("['Constraint programming',").length - 1, 1);
  assert.ok(source.includes(`['Constraint programming', '${candidate.definition}', '${candidate.sources[0]}']`));
  const { map, gaps } = selectRepos({ ...corpus,
    coverageBaseline: previous.map((p) => p.name) }, corpus.repos.length);
  assert.deepEqual(gaps, []);
  assert.ok(map.coverage.radius <= map.coverage.baseline.radius);
});

test('the separation kernel profile distinguishes fixed resources from immutable channel data', () => {
  const corpus = corpusBeforeKubo();
  const candidate = corpus.paradigms.find((p) => p.name === 'Separation kernel');
  assert.ok(candidate);
  assert.equal(candidate.layer, 'os');
  const capability = corpus.paradigms.find((p) => p.name === 'Capability-based OS');
  assert.ok(candidate.scores[3] < capability.scores[3]);
  assert.ok(candidate.scores[5] > capability.scores[5]);
  assert.equal(candidate.scores[1], 0);
  assert.match(candidate.reasons[1].reason, /do not make channel data immutable/);
  assert.match(candidate.scope, /Dynamic Tau0.*lie outside/);
  assert.match(candidate.reasons[6].reason, /share the kernel and physical machine/);
  assert.equal(candidate.scores[7], 0);
  const previous = corpus.paradigms.filter((p) => p !== candidate);
  const nearest = Math.min(...previous.map((p) =>
    Math.hypot(...p.scores.map((value, axis) => value - candidate.scores[axis]))));
  assert.ok(Math.abs(nearest - Math.sqrt(23)) < 1e-9);
  const source = fs.readFileSync(path.join(__dirname, '../snowmobile.js'), 'utf8');
  assert.equal(source.split("['Separation kernel',").length - 1, 1);
  assert.ok(source.includes(`['Separation kernel', '${candidate.definition}', '${candidate.sources[0]}']`));
  const { map, gaps } = selectRepos({ ...corpus,
    coverageBaseline: previous.map((p) => p.name) }, corpus.repos.length);
  assert.deepEqual(gaps, []);
  assert.ok(map.coverage.radius <= map.coverage.baseline.radius);
});


test('the accelerator profile distinguishes fixed silicon from fixed runtime work', () => {
  const corpus = corpusBeforeKubo();
  const candidate = corpus.paradigms.find((p) => p.name === 'Domain-specific accelerator');
  assert.ok(candidate);
  assert.equal(candidate.layer, 'hardware');
  assert.match(candidate.scope, /first-generation TPU ASIC/);
  assert.ok(candidate.scores[3] > 5);
  assert.ok(candidate.scores[5] > 5);
  assert.match(candidate.reasons[1].reason, /overwrite accumulators/);
  assert.match(candidate.reasons[3].reason, /fixed instruction set/);
  assert.match(candidate.reasons[5].reason, /same circuit serves multiple model types/);
  assert.match(candidate.reasons[6].reason, /uncertain evidence/);
  assert.equal(candidate.scores[7], 0);
  const previous = corpus.paradigms.filter((p) => p !== candidate);
  const nearest = Math.min(...previous.map((p) =>
    Math.hypot(...p.scores.map((value, axis) => value - candidate.scores[axis]))));
  assert.ok(Math.abs(nearest - Math.sqrt(27)) < 1e-9);
  const source = fs.readFileSync(path.join(__dirname, '../snowmobile.js'), 'utf8');
  assert.equal(source.split("['Domain-specific accelerator',").length - 1, 1);
  assert.ok(source.includes(`['Domain-specific accelerator', '${candidate.definition}', '${candidate.sources[0]}']`));
  const { map, gaps } = selectRepos({ ...corpus,
    coverageBaseline: previous.map((p) => p.name) }, corpus.repos.length);
  assert.deepEqual(gaps, []);
  assert.equal(map.coverage.radius, map.coverage.baseline.radius);
});


test('Kubo increases seven-repository separation and exposes an immutable content region', () => {
  const current = require('../data/repo-scores.json');
  const corpus = { ...current, paradigms: current.paradigms.filter((p) => p.name !== 'Peer-to-peer') };
  const before = selectRepos(corpusBeforeKubo(), 7);
  const after = selectRepos(corpus, 7);
  assert.ok(Math.abs(before.minimumDistance - Math.sqrt(104)) < 1e-9);
  assert.ok(Math.abs(after.minimumDistance - Math.sqrt(111)) < 1e-9);
  assert.ok(after.minimumDistance > before.minimumDistance);
  const region = after.gaps.find((gap) => gap.repo.name === 'Kubo');
  assert.ok(region);
  assert.equal(region.nearestOnAxes.paradigm.name, 'Conflict-free replicated data types');
  assert.ok(Math.abs(region.nearestOnAxes.distance - Math.sqrt(27)) < 1e-9);
  assert.equal(region.repo.scores[1], 10);
  assert.match(region.repo.scope, /Mutable names, MFS, and daemon metadata lie outside/);
  assert.match(region.repo.reasons[7].reason, /do not automatically guarantee permanent retention/);
  assert.equal(region.repo.reasons.length, corpus.axes.length);
  assert.ok(region.repo.reasons.every(({ source }) => region.repo.sources.includes(source)));
  assert.ok(after.map.records.some(({ kind, record }) => kind === 'repo' && record === region.repo));
});


test('the existing peer-to-peer seed covers Kubo without a duplicate paradigm', () => {
  const corpus = require('../data/repo-scores.json');
  const candidate = corpus.paradigms.find((p) => p.name === 'Peer-to-peer');
  assert.ok(candidate);
  assert.equal(candidate.layer, 'software');
  assert.match(candidate.scope, /not all peer-to-peer systems/);
  const previous = corpus.paradigms.filter((p) => p !== candidate);
  const before = selectRepos({ ...corpus, paradigms: previous }, corpus.repos.length);
  const region = before.gaps.find((gap) => gap.repo.name === 'Kubo');
  assert.ok(region);
  assert.ok(Math.abs(region.nearestOnAxes.distance - Math.sqrt(27)) < 1e-9);
  assert.ok(candidate.suggestedBy.includes(region.repo.url));
  assert.deepEqual(candidate.scores, region.repo.scores);
  assert.match(candidate.reasons[7].reason, /do not automatically guarantee permanent retention/);
  const after = selectRepos(corpus, corpus.repos.length);
  assert.equal(before.gaps.length, 1);
  assert.deepEqual(after.gaps, []);
  assert.deepEqual(selectRepos(corpus, 7).gaps, []);
  assert.deepEqual(after.repos, before.repos);
  assert.equal(after.minimumDistance, before.minimumDistance);
  const source = fs.readFileSync(path.join(__dirname, '../snowmobile.js'), 'utf8');
  assert.equal(source.split("['Peer-to-peer',").length - 1, 1);
  assert.ok(source.includes(`['Peer-to-peer', '${candidate.definition}', '${candidate.sources[0]}']`));
  const { map } = selectRepos({ ...corpus,
    coverageBaseline: previous.map((p) => p.name) }, corpus.repos.length);
  assert.ok(map.coverage.radius <= map.coverage.baseline.radius);
});
