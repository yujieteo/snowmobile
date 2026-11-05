import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { at, byName, corpusBeforeAutomerge, corpusBeforeGforth, corpusBeforeKubo, data, def, exhaustiveOptimum, gapFor, loadCorpus,
  parseInput, parseOutput, profile, readSeedSource, selectRepos } from './helpers/select-repos-util.ts';

function check01(): void {
  const corpus = loadCorpus();
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
}

function check02(): void {
  const corpus = loadCorpus();
  const selected = selectRepos(corpus, 3);
  assert.ok(selected.map);
  assert.deepEqual(new Set(corpus.paradigms.map((record) => record.layer)),
    new Set(['language', 'hardware', 'os', 'software']));
  for (const paradigm of corpus.paradigms) {assert.ok(paradigm.definition.trim());}
  assert.equal(selected.map.points.length, corpus.repos.length + corpus.paradigms.length);
  assert.ok(selected.map.points.flat().every(Number.isFinite));
  assert.ok(selected.map.explained.every((share) => share > 0 && share <= 1));
  assert.deepEqual(selected.map.records.filter(({ kind }) => kind === 'paradigm').map(({ record }) => record),
    corpus.paradigms);
  const reposOnly: Record<string, unknown> = { ...corpus };
  delete reposOnly['paradigms'];
  delete reposOnly['coverageBaseline'];
  assert.deepEqual(selected.repos, selectRepos(reposOnly, 3).repos);
}

function check03(): void {
  const before = selectRepos({ ...data, repos: data.repos.slice(0, 3) }, 3);
  const after = selectRepos(data, 3);
  assert.equal(before.minimumDistance, 1);
  assert.equal(after.minimumDistance, 10);
  assert.deepEqual(after.repos, [data.repos[2], data.repos[3], data.repos[0]]);
  assert.equal(selectRepos(data, 2).minimumDistance, Math.sqrt(200));
  assert.deepEqual(selectRepos(data, 4).repos.at(-1), data.repos[1]);
  assert.deepEqual(at(data.repos, 0).scores, [0, 0]);
}

function check04(): void {
  const corpus = loadCorpus();
  const optimum = (count: number): number => exhaustiveOptimum(corpus.repos, count);
  // These are the measured results from the former farthest-pair start.
  const former = [Math.sqrt(249), Math.sqrt(177), Math.sqrt(160)];
  for (let count = 2; count <= corpus.repos.length; count++) {
    const result = selectRepos(corpus, count);
    assert.ok(Math.abs(result.minimumDistance - optimum(count)) < 1e-9);
    assert.equal(new Set(result.repos).size, count);
    if (count >= 3 && count <= 5) {assert.ok(result.minimumDistance > at(former, count - 3));}
  }
}

function check05(): void {
  const same = { ...data, repos: ['a', 'b', 'c'].map((name) => profile(name, [5, 5])) };
  assert.deepEqual(selectRepos(same, 3).repos, same.repos);
  assert.equal(selectRepos(same, 3).minimumDistance, 0);
}

function check06(): void {
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
  const near = (a: number, b: number) => { assert.ok(Math.abs(a - b) < 1e-9, `${String(a)} differs from ${String(b)}`); };
  assert.deepEqual(map.mean, [5, 1]);
  near(at(map.explained, 0), 25 / 26);
  near(at(map.explained, 1), 1 / 26);
  assert.deepEqual(map.components, [[1, 0], [0, 1]]);
  assert.deepEqual(map.points, [[-5, -1], [-5, 1], [5, -1], [5, 1]]);
  assert.deepEqual(map.records, [
    ...input.repos.map((record) => ({ kind: 'repo', record })),
    { kind: 'paradigm', record: input.paradigms[0] },
  ]);
  const separation = (a: number[], b: number[]) => Math.hypot(...a.map((value, i) => value - at(b, i)));
  for (let i = 0; i < map.records.length; i++) {
    for (let j = i + 1; j < map.records.length; j++) {
      near(separation(at(map.points, i), at(map.points, j)),
        separation(def(at(map.records, i).record).scores.map(Number), def(at(map.records, j).record).scores.map(Number)));
    }
  }
  assert.deepEqual(selectRepos(input, 3).map, map);
  assert.deepEqual(result.repos, selectRepos({ axes: input.axes, repos: input.repos }, 2).repos);
  assert.deepEqual(input, original);
}

function check07(): void {
  const paradigm = { name: 'Synthetic paradigm', layer: 'software', scores: [0, 0] };
  for (const paradigms of [[], {}, [null], [{ ...paradigm, name: ' ' }], [{ ...paradigm, layer: 'unknown' }],
    [paradigm, { ...paradigm, name: ' SYNTHETIC PARADIGM ' }],
    ...[[0], [0, 11], [NaN, 0], [null, 0], ['2', 0]].map((scores) => [{ ...paradigm, scores }])]) {
    assert.throws(() => selectRepos({ ...data, paradigms }, 2), /paradigm|score/);
  }
  assert.equal('map' in selectRepos(data, 2), false);
  assert.equal('gaps' in selectRepos(data, 2), false);
}

function check08(): void {
  // Synthetic profiles describe geometry only, not real projects or paradigms.
  const input = {
    axes: ['x', 'y'],
    repos: [[0, 0], [0, 10], [10, 0], [10, 10]].map((scores, i) => profile(`corner-${String(i)}`, scores)),
    paradigms: [{ name: 'Centre', layer: 'software', scores: [5, 5] }],
  };
  const before = selectRepos(input, 2).map;
  assert.deepEqual(before.coverage.bounds, { min: [-5, -5], max: [5, 5] });
  assert.deepEqual(before.coverage.center, [-5, -5]);
  assert.equal(before.coverage.radius, Math.sqrt(50));
  assert.equal(before.coverage.gridSteps, 40);
  assert.equal(before.coverage.errorBound, Math.hypot(0.25, 0.25) / 2);
  const after = selectRepos({ ...input, paradigms: [...input.paradigms,
    ...input.repos.map((repo, i) => ({ name: `Corner ${String(i)}`, layer: 'software', scores: repo.scores })),
  ] }, 2).map;
  assert.deepEqual(after.components, before.components);
  assert.deepEqual(after.mean, before.mean);
  assert.deepEqual(after.coverage.bounds, before.coverage.bounds);
  assert.equal(after.coverage.radius, 5);
  assert.ok(after.coverage.radius < before.coverage.radius);
  assert.deepEqual(selectRepos(input, 4).map.coverage, before.coverage);
}

function check09(): void {
  for (const scores of [[5, 5], [10, 5]]) {
    const input = { axes: ['x', 'y'], repos: [profile('a', [5, 5]), profile('b', scores)],
      paradigms: [{ name: 'Centre', layer: 'software', scores: [5, 5] }] };
    const coverage = selectRepos(input, 2).map.coverage;
    const exact = at(scores, 0) - 5;
    assert.equal(coverage.radius, exact);
    assert.ok(Number.isFinite(coverage.errorBound));
    assert.ok(coverage.errorBound >= 0);
  }
}

function check10(): void {
  const input = {
    axes: ['x', 'y'],
    repos: [[0, 0], [0, 10], [10, 0], [10, 10]].map((scores, i) => profile(`corner-${String(i)}`, scores)),
    paradigms: [[3, 4], [0, 0], [0, 10], [10, 0], [10, 10]].map((scores, i) =>
      ({ name: `Point ${String(i)}`, layer: 'software', scores })),
    coverageBaseline: [' POINT 0 '],
  };
  const original = structuredClone(input);
  const { map } = selectRepos(input, 2);
  const { baseline, ...coverage } = map.coverage;
  const withoutBaseline: Record<string, unknown> = { ...input };
  delete withoutBaseline['coverageBaseline'];
  assert.deepEqual(coverage, selectRepos(withoutBaseline, 2).map.coverage);
  const point = at(map.points, input.repos.length);
  const { min, max } = map.coverage.bounds;
  const corners = [at(min, 0), at(max, 0)].flatMap((x) => [at(min, 1), at(max, 1)].map((y) => [x, y]));
  const exact = Math.max(...corners.map((corner) => Math.hypot(...corner.map((v, i) => v - at(point, i)))));
  assert.ok(Math.abs(baseline.radius - exact) < 1e-9);
  assert.deepEqual(baseline.names, ['Point 0']);
  assert.ok(baseline.radius > coverage.radius);
  assert.deepEqual(selectRepos(input, 4).map, map);
  assert.notDeepEqual(selectRepos({ ...withoutBaseline, paradigms: [input.paradigms[0]] }, 2).map.mean, map.mean);
  assert.deepEqual(input, original);
  const all = selectRepos({ ...input, coverageBaseline: input.paradigms.map((p) => p.name) }, 2).map.coverage;
  assert.equal(all.baseline.radius, all.radius);
  assert.deepEqual(all.baseline.center, all.center);
}

function check11(): void {
  assert.throws(() => selectRepos({ ...data, coverageBaseline: ['Absent'] }, 2), /paradigm/);
  const input = { ...data, paradigms: [{ name: 'Centre', layer: 'software', scores: [5, 5] }] };
  for (const coverageBaseline of [[], null, {}, ['Absent'], [null], ['Centre', ' CENTRE ']]) {
    assert.throws(() => selectRepos({ ...input, coverageBaseline }, 2), /baseline/);
  }
}

function check12(): void {
  const input = { axes: ['x', 'y'], repos: [profile('a', [0, 0]), profile('b', [10, 0])],
    paradigms: [0, 3.1, 10].map((x, i) => ({ name: `Point ${String(i)}`, layer: 'software', scores: [x, 0] })) };
  const { radius, errorBound } = selectRepos(input, 2).map.coverage;
  const exact = (10 - 3.1) / 2;
  assert.ok(radius < exact);
  assert.ok(exact <= radius + errorBound);
  assert.ok(Math.abs(radius - 3.4) < 1e-9);
  assert.ok(Math.abs(errorBound - 0.125) < 1e-9);
}

function check13(): void {
  const corpus = corpusBeforeAutomerge();
  const result = selectRepos(corpus, corpus.repos.length);
  assert.deepEqual(result.gaps, []);
  const { center, radius, errorBound } = result.map.coverage;
  const nearest = Math.min(...result.map.points.slice(corpus.repos.length)
    .map((point) => Math.hypot(...point.map((value, axis) => value - at(center, axis)))));
  assert.ok(Math.abs(nearest - radius) < 1e-9);
  assert.ok(radius > 7);
  assert.ok(errorBound < 0.33);
}

function check14(): void {
  const corpus = loadCorpus();
  const { map } = selectRepos(corpus, corpus.repos.length);
  const { baseline, radius, errorBound } = map.coverage;
  assert.deepEqual(baseline.names, corpus.coverageBaseline);
  // The lower bound before exceeds the upper bound after.
  assert.ok(baseline.radius > radius + errorBound);
}

function check15(): void {
  // Synthetic corners share map coordinates but differ on the third axis.
  const corners = [[0, 0], [0, 10], [10, 0], [10, 10]];
  const input = {
    axes: ['x', 'y', 'z'],
    repos: corners.map((point, i) => profile(`corner-${String(i)}`, [...point, 4])),
    paradigms: corners.map((point, i) =>
      ({ name: `Corner ${String(i)}`, layer: 'hardware', scores: [...point, 6] })),
  };
  const result = selectRepos(input, 4);
  assert.deepEqual(result.map.components, [[1, 0, 0], [0, 1, 0]]);
  assert.equal(result.gaps.length, 4);
  assert.deepEqual(new Set(result.gaps.map((gap) => gap.repo)), new Set(result.repos));
  for (const gap of result.gaps) {
    assert.equal(gap.nearestOnMap.distance, 0);
    assert.equal(gap.nearestOnAxes.distance, 2);
  }
}

function check16(): void {
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
    name: `Synthetic ${String(i)}`, layer: 'software', scores: repo.scores,
  })) };
  assert.deepEqual(selectRepos(covered, 2).gaps, []);
  assert.deepEqual(input, original);
}

function check17(): void {
  const current = corpusBeforeAutomerge();
  // Exclude the later profile to retain the original discovery measurement.
  const corpus = { ...current,
    paradigms: current.paradigms.filter((p) => p.name !== 'Concatenative programming') };
  const before = selectRepos(corpusBeforeGforth(), 7);
  const after = selectRepos(corpus, 7);
  assert.equal(before.minimumDistance, 9);
  assert.ok(Math.abs(after.minimumDistance - Math.sqrt(104)) < 1e-9);
  assert.ok(after.minimumDistance > before.minimumDistance);
  const region = gapFor(after.gaps, 'Gforth');
  assert.ok(region);
  assert.equal(region.repo.layer, 'language');
  assert.ok(Math.abs(region.nearestOnAxes.distance - Math.sqrt(104)) < 1e-9);
  assert.ok(region.nearestOnMap.distance > 0);
  assert.equal(region.nearestOnAxes.paradigm.name, 'Capability-based OS');
  assert.ok(region.repo.reasons.every((reason) => region.repo.sources.includes(reason.source)));
  assert.equal(after.map.records.filter(({ kind }) => kind === 'repo').length,
    before.map.records.filter(({ kind }) => kind === 'repo').length + 1);
}

function check18(): void {
  const corpus = corpusBeforeAutomerge();
  const candidate = byName(corpus.paradigms, 'Concatenative programming');
  assert.ok(candidate);
  const before = selectRepos({ ...corpus,
    paradigms: corpus.paradigms.filter((p) => p !== candidate) }, corpus.repos.length);
  const region = gapFor(before.gaps, 'Gforth');
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
}

function check19(): void {
  const corpus = corpusBeforeGforth();
  // Omit the actor profile to retain a real uncovered region for this distance check.
  const result = selectRepos({ ...corpus,
    paradigms: corpus.paradigms.filter((p) => p.name !== 'Actor model') }, 3);
  assert.ok(result.gaps.length > 0);
  assert.ok(result.gaps.every((gap) => !['SQLite', 'Rocket Chip'].includes(gap.repo.name)));
  for (const gap of result.gaps) {
    assert.ok(result.repos.includes(gap.repo));
    assert.ok(gap.repo.sources.length);
    const checks: ['nearestOnMap' | 'nearestOnAxes', number[]][] = [['nearestOnMap', gap.point], ['nearestOnAxes', gap.repo.scores]];
    for (const [key, point] of checks) {
      const vectors = key === 'nearestOnMap'
        ? result.map.points.slice(corpus.repos.length)
        : result.map.records.filter(({ kind }) => kind === 'paradigm').map(({ record }) => record.scores);
      const distances = vectors.map((vector) => Math.hypot(...vector.map((value, i) => value - at(point, i))));
      assert.ok(Math.abs(gap[key].distance - Math.min(...distances)) < 1e-9);
      const paradigms = result.map.records.filter(({ kind }) => kind === 'paradigm').map(({ record }) => record);
      assert.deepEqual(gap[key].paradigm, paradigms[distances.indexOf(Math.min(...distances))]);
    }
  }
}

function check20(): void {
  const corpus = corpusBeforeGforth();
  const actor = byName(corpus.paradigms, 'Actor model');
  assert.ok(actor);
  const before = selectRepos({ ...corpus,
    paradigms: corpus.paradigms.filter((p) => p !== actor) }, 3);
  const region = gapFor(before.gaps, 'Erlang/OTP');
  assert.ok(region);
  assert.ok(region.nearestOnAxes.distance > 0);
  assert.ok(actor.suggestedBy.includes(region.repo.url));
  assert.deepEqual(actor.scores, region.repo.scores);
  const after = selectRepos(corpus, 3);
  assert.equal(before.gaps.length, after.gaps.length + 1);
  assert.ok(after.gaps.every((gap) => gap.repo.name !== 'Erlang/OTP'));
  assert.deepEqual(after.repos, before.repos);
}

function check21(): void {
  const corpus = corpusBeforeGforth();
  const candidate = byName(corpus.paradigms, 'Hardware generators');
  assert.ok(candidate);
  const before = selectRepos({ ...corpus,
    paradigms: corpus.paradigms.filter((p) => p !== candidate) }, corpus.repos.length);
  const region = gapFor(before.gaps, 'Rocket Chip');
  assert.ok(region);
  assert.ok(region.nearestOnAxes.distance > 6);
  assert.ok(candidate.suggestedBy.includes(region.repo.url));
  assert.deepEqual(candidate.scores, region.repo.scores);
  const after = selectRepos(corpus, corpus.repos.length);
  assert.ok(after.gaps.every((gap) => gap.repo.name !== 'Rocket Chip'));
  assert.deepEqual(after.repos, before.repos);
}

function check22(): void {
  const corpus = corpusBeforeGforth();
  const candidate = byName(corpus.paradigms, 'Functional package management');
  assert.ok(candidate);
  const before = selectRepos({ ...corpus,
    paradigms: corpus.paradigms.filter((p) => p !== candidate) }, corpus.repos.length);
  const region = gapFor(before.gaps, 'Nix');
  assert.ok(region);
  assert.ok(region.nearestOnAxes.distance > 11);
  assert.ok(candidate.suggestedBy.includes(region.repo.url));
  assert.deepEqual(candidate.scores, region.repo.scores);
  const after = selectRepos(corpus, corpus.repos.length);
  assert.equal(before.gaps.length, after.gaps.length + 1);
  assert.ok(after.gaps.every((gap) => gap.repo.name !== 'Nix'));
  assert.deepEqual(after.repos, before.repos);
}

function check23(): void {
  const corpus = corpusBeforeGforth();
  const repo = byName(corpus.repos, 'Unikraft');
  const paradigm = byName(corpus.paradigms, 'Unikernel');
  // Restore the two uncertain midpoint scores from the earlier README-only profile.
  const earlier = structuredClone(corpus);
  const oldRepo = byName(earlier.repos, 'Unikraft');
  oldRepo.scores.splice(2, 1, 5);
  oldRepo.scores.splice(6, 1, 5);
  const before = selectRepos(earlier, earlier.repos.length);
  const region = gapFor(before.gaps, 'Unikraft');
  assert.ok(region);
  assert.ok(Math.abs(region.nearestOnAxes.distance - Math.sqrt(50)) < 1e-9);
  assert.equal(repo.scope, paradigm.scope);
  assert.deepEqual(repo.scores, paradigm.scores);
  assert.equal(at(repo.scores, 2), 0);
  assert.equal(at(repo.scores, 6), 0);
  for (const axis of [2, 6]) {
    assert.ok(paradigm.sources.includes(at(repo.reasons, axis).source));
    assert.doesNotMatch(at(repo.reasons, axis).reason, /uncertain/);
  }
  const after = selectRepos(corpus, corpus.repos.length);
  assert.equal(before.gaps.length, after.gaps.length + 1);
  assert.deepEqual(after.gaps.map((gap) => gap.repo.name),
    before.gaps.filter((gap) => gap.repo.name !== 'Unikraft').map((gap) => gap.repo.name));
  assert.deepEqual(new Set(after.repos.map((record) => record.url)),
    new Set(before.repos.map((record) => record.url)));
}

function check24(): void {
  const corpus = corpusBeforeGforth();
  const candidate = byName(corpus.paradigms, 'Data structure server');
  assert.ok(candidate);
  const before = selectRepos({ ...corpus,
    paradigms: corpus.paradigms.filter((p) => p !== candidate) }, corpus.repos.length);
  const region = gapFor(before.gaps, 'Redis');
  assert.ok(region);
  assert.equal(region.nearestOnAxes.distance, 9);
  assert.ok(candidate.suggestedBy.includes(region.repo.url));
  assert.deepEqual(candidate.scores, region.repo.scores);
  const after = selectRepos(corpus, corpus.repos.length);
  assert.equal(before.gaps.length, after.gaps.length + 1);
  assert.ok(after.gaps.every((gap) => gap.repo.name !== 'Redis'));
  assert.deepEqual(after.repos, before.repos);
}

function check25(): void {
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
  const region = gapFor(after.gaps, 'seL4');
  assert.ok(region);
  assert.ok(Math.abs(region.nearestOnAxes.distance - Math.sqrt(76)) < 1e-9);
  assert.ok(region.nearestOnMap.distance > 6);
  assert.ok(at(region.repo.reasons, 5).reason.includes('uncertain'));
}

function check26(): void {
  const corpus = corpusBeforeGforth();
  const candidate = byName(corpus.paradigms, 'Capability-based OS');
  assert.ok(candidate);
  const before = selectRepos({ ...corpus,
    paradigms: corpus.paradigms.filter((p) => p !== candidate) }, 4);
  const region = gapFor(before.gaps, 'seL4');
  assert.ok(region);
  assert.ok(Math.abs(region.nearestOnAxes.distance - Math.sqrt(76)) < 1e-9);
  assert.ok(candidate.suggestedBy.includes(region.repo.url));
  assert.equal(candidate.scope, region.repo.scope);
  assert.deepEqual(candidate.scores, region.repo.scores);
  assert.ok(at(candidate.reasons, 5).reason.includes('uncertain'));
  const after = selectRepos(corpus, 4);
  assert.equal(before.gaps.length, after.gaps.length + 1);
  assert.deepEqual(after.gaps, []);
  assert.ok(selectRepos(corpus, corpus.repos.length).gaps.every((gap) => gap.repo.name !== 'seL4'));
  assert.deepEqual(after.repos, before.repos);
  assert.equal(after.minimumDistance, before.minimumDistance);
}

function check27(): void {
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
  const region = gapFor(after.gaps, 'GHCi');
  assert.ok(region);
  assert.equal(region.repo.layer, 'language');
  assert.ok(Math.abs(region.nearestOnAxes.distance - Math.sqrt(143)) < 1e-9);
  assert.ok(region.nearestOnMap.distance > 0);
  assert.equal(region.nearestOnAxes.paradigm.name, 'Embedded database');
  assert.equal(corpus.repos.filter((repo) => repo.layer === 'language').length,
    baseline.repos.filter((repo) => repo.layer === 'language').length + 1);
}

function check28(): void {
  const corpus = corpusBeforeGforth();
  const candidate = byName(corpus.paradigms, 'Functional programming');
  assert.ok(candidate);
  const before = selectRepos({ ...corpus,
    paradigms: corpus.paradigms.filter((p) => p !== candidate) }, corpus.repos.length);
  const region = gapFor(before.gaps, 'GHCi');
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
}

function check29(): void {
  for (const scores of [[0], [0, 11], [NaN, 0], [null, 0], ['2', 0]]) {
    assert.throws(() => selectRepos({ ...data, repos: [profile('a', scores), data.repos[1]] }, 2), /score/);
  }
  for (const url of [at(data.repos, 0).url, 'https://github.com/TEST/A.git']) {
    assert.throws(() => selectRepos({ ...data, repos: [data.repos[0], { ...data.repos[1], url }] }, 2), /once/);
  }
  assert.throws(() => selectRepos({ ...data, axes: ['state', 'state'] }, 2), /distinct/);
  assert.throws(() => selectRepos(data, 5), /count/);
  assert.throws(() => selectRepos(data, 2.5), /count/);
  assert.throws(() => selectRepos({ ...data, repos: [profile('a/tree/main', [0, 0]), data.repos[1]] }, 2), /URL/);
}

function check30(): void {
  const result = spawnSync(process.execPath, ['scripts/select-repos.ts'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Use: bun/);
  assert.equal(result.stdout, '');
}

function check31(t: TestContext): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snowmobile-subset-'));
  t.after(() => { fs.rmSync(dir, { recursive: true, force: true }); });
  const file = path.join(dir, 'scores.json');
  const input = JSON.stringify({ ...data,
    paradigms: [{ name: 'Synthetic paradigm', layer: 'hardware', scores: [2, 3] }],
    coverageBaseline: ['Synthetic paradigm'],
    repos: data.repos.map((repo) => ({
    ...repo, reasons: ['Synthetic state score.', 'Synthetic parallelism score.'],
    sources: ['Synthetic fixture.'],
  })) });
  fs.writeFileSync(file, input);
  const result = spawnSync(process.execPath, ['scripts/select-repos.ts', file, '3'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const output = parseOutput(result.stdout);
  assert.equal(output.minimumDistance, 10);
  assert.deepEqual(output.repos[0], parseInput(input).repos[2]);
  assert.equal(output.map.points.length, data.repos.length + 1);
  assert.deepEqual(output.map.records.at(-1), { kind: 'paradigm', record: parseInput(input).paradigms[0] });
  assert.equal(output.map.coverage.baseline.radius, output.map.coverage.radius);
  assert.equal(fs.readFileSync(file, 'utf8'), input);
}

function check32(): void {
  const corpus = corpusBeforeAutomerge();
  const store = byName(corpus.paradigms, 'Single-level store');
  assert.equal(store.layer, 'os');
  const previous = corpus.paradigms.filter((p) => p !== store);
  const nearest = Math.min(...previous.map((p) =>
    Math.hypot(...p.scores.map((score, axis) => score - at(store.scores, axis)))));
  assert.equal(nearest, 10);
  assert.ok(at(store.scores, 7) > Math.max(...previous.filter((p) => p.layer === 'os').map((p) => at(p.scores, 7))));
  assert.match(at(store.reasons, 5).reason, /uncertain evidence/);
  // Compare only reference sets within one map, rectangle, and grid.
  const { map } = selectRepos({ ...corpus, coverageBaseline: previous.map((p) => p.name) }, corpus.repos.length);
  assert.equal(map.coverage.baseline.radius, map.coverage.radius);
}

function check33(): void {
  const current = corpusBeforeKubo();
  const corpus = { ...current, paradigms: current.paradigms.filter((p) => p.name !== 'Conflict-free replicated data types') };
  const baseline = corpusBeforeAutomerge();
  const cases: [number, number, number][] = [[2, 465, 488], [4, 214, 221], [8, 81, 100]];
  for (const [count, beforeSquared, afterSquared] of cases) {
    const before = selectRepos(baseline, count);
    const after = selectRepos(corpus, count);
    assert.ok(Math.abs(before.minimumDistance - Math.sqrt(beforeSquared)) < 1e-9);
    assert.ok(Math.abs(after.minimumDistance - Math.sqrt(afterSquared)) < 1e-9);
    assert.ok(after.minimumDistance > before.minimumDistance);
  }
  const result = selectRepos(corpus, 4);
  const region = gapFor(result.gaps, 'Automerge');
  assert.ok(region);
  assert.equal(region.nearestOnAxes.paradigm.name, 'Actor model');
  assert.ok(Math.abs(region.nearestOnAxes.distance - Math.sqrt(23)) < 1e-9);
  assert.ok(region.nearestOnMap.distance > 0);
  assert.equal(region.repo.layer, 'software');
  assert.ok(region.repo.reasons.every(({ source }) => region.repo.sources.includes(source)));
  assert.ok(selectRepos(corpus, corpus.repos.length).gaps.some((gap) => gap.repo === region.repo));
}

function check34(): void {
  const corpus = corpusBeforeKubo();
  const candidate = byName(corpus.paradigms, 'Conflict-free replicated data types');
  assert.ok(candidate);
  const previous = corpus.paradigms.filter((p) => p !== candidate);
  const before = selectRepos({ ...corpus, paradigms: previous }, corpus.repos.length);
  const region = gapFor(before.gaps, 'Automerge');
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
}

function check35(): void {
  const current = corpusBeforeKubo();
  // Preserve the corpus for this historical measurement.
  const corpus = { ...current, paradigms: current.paradigms.filter((p) => p.name !== 'Domain-specific accelerator') };
  const candidate = byName(corpus.paradigms, 'Reconfigurable logic (FPGA)');
  const previous = corpus.paradigms.filter((p) => p !== candidate);
  const hardware = previous.filter((p) => p.layer === 'hardware');
  assert.equal(candidate.layer, 'hardware');
  assert.ok(at(candidate.scores, 3) > Math.max(...hardware.map((p) => at(p.scores, 3))));
  const nearest = Math.min(...previous.map((p) =>
    Math.hypot(...p.scores.map((value, axis) => value - at(candidate.scores, axis)))));
  assert.ok(Math.abs(nearest - Math.sqrt(69)) < 1e-9);
  assert.match(at(candidate.reasons, 6).reason, /uncertain evidence/);
  const source = readSeedSource();
  assert.equal(source.split("['Reconfigurable logic (FPGA)',").length - 1, 1);
  const { map, gaps } = selectRepos({ ...corpus,
    coverageBaseline: previous.map((p) => p.name) }, corpus.repos.length);
  assert.deepEqual(gaps, []);
  assert.equal(map.coverage.radius, map.coverage.baseline.radius);
}

function check36(): void {
  const current = corpusBeforeKubo();
  // Preserve the corpus for this historical measurement.
  const corpus = { ...current, paradigms: current.paradigms.filter((p) => p.name !== 'Distributed OS') };
  const candidate = byName(corpus.paradigms, 'Cluster (warehouse-scale computer)');
  const previous = corpus.paradigms.filter((p) => p !== candidate);
  assert.equal(candidate.layer, 'hardware');
  assert.ok(at(candidate.scores, 2) > Math.max(...previous.filter((p) => p.layer === 'hardware').map((p) => at(p.scores, 2))));
  const nearest = Math.min(...previous.map((p) =>
    Math.hypot(...p.scores.map((value, axis) => value - at(candidate.scores, axis)))));
  assert.ok(Math.abs(nearest - Math.sqrt(86)) < 1e-9);
  const source = readSeedSource();
  assert.equal(source.split("['Cluster (warehouse-scale computer)',").length - 1, 1);
  const before = selectRepos({ ...corpus, paradigms: previous }, corpus.repos.length);
  const after = selectRepos(corpus, corpus.repos.length);
  assert.deepEqual(after.repos, before.repos);
  assert.equal(after.minimumDistance, before.minimumDistance);
  assert.deepEqual(after.gaps, []);
  const { map } = selectRepos({ ...corpus,
    coverageBaseline: previous.map((p) => p.name) }, corpus.repos.length);
  assert.equal(map.coverage.radius, map.coverage.baseline.radius);
}

function check37(): void {
  const current = corpusBeforeKubo();
  // Preserve the corpus for this historical measurement.
  const corpus = { ...current, paradigms: current.paradigms.filter((p) => p.name !== 'Distributed OS') };
  const candidate = byName(corpus.paradigms, 'Multikernel');
  const previous = corpus.paradigms.filter((p) => p !== candidate);
  assert.equal(candidate.layer, 'os');
  assert.ok(at(candidate.scores, 2) > Math.max(...previous.filter((p) => p.layer === 'os').map((p) => at(p.scores, 2))));
  // Replicas can change state, and separate cores do not supply separate failure units.
  assert.equal(at(candidate.scores, 1), 0);
  assert.ok(at(candidate.scores, 6) < 5);
  assert.match(at(candidate.reasons, 6).reason, /one failure unit/);
  const nearest = Math.min(...previous.map((p) =>
    Math.hypot(...p.scores.map((value, axis) => value - at(candidate.scores, axis)))));
  assert.ok(Math.abs(nearest - Math.sqrt(87)) < 1e-9);
  const source = readSeedSource();
  assert.equal(source.split("['Multikernel',").length - 1, 1);
  const before = selectRepos({ ...corpus, paradigms: previous }, corpus.repos.length);
  const after = selectRepos(corpus, corpus.repos.length);
  assert.deepEqual(after.repos, before.repos);
  assert.equal(after.minimumDistance, before.minimumDistance);
  assert.deepEqual(after.gaps, []);
  const { map } = selectRepos({ ...corpus,
    coverageBaseline: previous.map((p) => p.name) }, corpus.repos.length);
  assert.equal(map.coverage.radius, map.coverage.baseline.radius);
}

function check38(): void {
  const corpus = corpusBeforeKubo();
  const candidate = byName(corpus.paradigms, 'Hardware root of trust');
  const previous = corpus.paradigms.filter((p) => p !== candidate);
  assert.equal(candidate.layer, 'hardware');
  const nearest = Math.min(...previous.map((p) =>
    Math.hypot(...p.scores.map((value, axis) => value - at(candidate.scores, axis)))));
  assert.ok(Math.abs(nearest - Math.sqrt(68)) < 1e-9);
  // Access control alone does not establish separate failure boundaries.
  assert.match(at(candidate.reasons, 6).reason, /uncertain evidence/);
  const source = readSeedSource();
  assert.equal(source.split("['Hardware root of trust',").length - 1, 1);
  const before = selectRepos({ ...corpus, paradigms: previous }, corpus.repos.length);
  const after = selectRepos(corpus, corpus.repos.length);
  assert.deepEqual(after.repos, before.repos);
  assert.equal(after.minimumDistance, before.minimumDistance);
  assert.deepEqual(after.gaps, []);
  const { map } = selectRepos({ ...corpus,
    coverageBaseline: previous.map((p) => p.name) }, corpus.repos.length);
  assert.equal(map.coverage.radius, map.coverage.baseline.radius);
}

function check39(): void {
  const current = corpusBeforeKubo();
  // Preserve the corpus for this historical measurement.
  const corpus = { ...current, paradigms: current.paradigms.filter((p) => !['Distributed OS', 'Constraint programming'].includes(p.name)) };
  const candidate = byName(corpus.paradigms, 'Microservices');
  const previous = corpus.paradigms.filter((p) => p !== candidate);
  assert.equal(candidate.layer, 'software');
  assert.equal(at(candidate.scores, 1), 0);
  assert.match(at(candidate.reasons, 5).reason, /uncertain evidence/);
  const nearest = Math.min(...previous.map((p) =>
    Math.hypot(...p.scores.map((value, axis) => value - at(candidate.scores, axis)))));
  assert.ok(Math.abs(nearest - Math.sqrt(29)) < 1e-9);
  const source = readSeedSource();
  assert.equal(source.split("['Microservices',").length - 1, 1);
  const before = selectRepos({ ...corpus, paradigms: previous }, corpus.repos.length);
  const after = selectRepos(corpus, corpus.repos.length);
  assert.deepEqual(after.repos, before.repos);
  assert.equal(after.minimumDistance, before.minimumDistance);
  assert.deepEqual(after.gaps, []);
  const { map } = selectRepos({ ...corpus,
    coverageBaseline: previous.map((p) => p.name) }, corpus.repos.length);
  assert.equal(map.coverage.radius, map.coverage.baseline.radius);
}

function check40(): void {
  const corpus = corpusBeforeKubo();
  const candidate = byName(corpus.paradigms, 'Logic programming');
  const previous = corpus.paradigms.filter((p) => p !== candidate);
  assert.equal(candidate.layer, 'language');
  const functional = byName(previous, 'Functional programming');
  assert.ok(at(candidate.scores, 1) < at(functional.scores, 1));
  assert.match(at(candidate.reasons, 1).reason, /changes survive backtracking/);
  assert.equal(at(candidate.scores, 7), 0);
  assert.match(candidate.scope, /disk persistence libraries lie outside/);
  assert.match(at(candidate.reasons, 6).reason, /do not supply independent failure boundaries/);
  const nearest = Math.min(...previous.map((p) =>
    Math.hypot(...p.scores.map((value, axis) => value - at(candidate.scores, axis)))));
  assert.ok(Math.abs(nearest - Math.sqrt(38)) < 1e-9);
  const source = readSeedSource();
  assert.equal(source.split("['Logic programming',").length - 1, 1);
  const { map, gaps } = selectRepos({ ...corpus,
    coverageBaseline: previous.map((p) => p.name) }, corpus.repos.length);
  assert.deepEqual(gaps, []);
  assert.equal(map.coverage.radius, map.coverage.baseline.radius);
}

function check41(): void {
  const corpus = corpusBeforeKubo();
  const candidate = byName(corpus.paradigms, 'Distributed OS');
  const previous = corpus.paradigms.filter((p) => p !== candidate);
  assert.equal(candidate.layer, 'os');
  assert.match(candidate.scope, /private per-process namespaces/);
  assert.match(at(candidate.reasons, 1).reason, /change active files/);
  assert.ok(at(candidate.scores, 1) < 5);
  assert.equal(at(candidate.scores, 2), 10);
  assert.equal(at(candidate.scores, 7), 10);
  assert.match(at(candidate.reasons, 5).reason, /uncertain evidence/);
  assert.match(at(candidate.reasons, 6).reason, /uncertain evidence/);
  const nearest = Math.min(...previous.map((p) =>
    Math.hypot(...p.scores.map((value, axis) => value - at(candidate.scores, axis)))));
  assert.ok(Math.abs(nearest - Math.sqrt(18)) < 1e-9);
  const source = readSeedSource();
  assert.equal(source.split("['Distributed OS',").length - 1, 1);
  assert.ok(source.includes(`['Distributed OS', '${candidate.definition}', '${at(candidate.sources, 0)}']`));
  const { map, gaps } = selectRepos({ ...corpus,
    coverageBaseline: previous.map((p) => p.name) }, corpus.repos.length);
  assert.deepEqual(gaps, []);
  assert.equal(map.coverage.radius, map.coverage.baseline.radius);
}

function check42(): void {
  const corpus = corpusBeforeKubo();
  const candidate = byName(corpus.paradigms, 'Event sourcing');
  assert.ok(candidate);
  assert.equal(candidate.layer, 'software');
  assert.match(candidate.scope, /mutable projections/);
  assert.equal(at(candidate.scores, 2), 0);
  assert.match(at(candidate.reasons, 5).reason, /uncertain evidence/);
  const previous = corpus.paradigms.filter((p) => p !== candidate);
  const nearest = Math.min(...previous.map((p) =>
    Math.hypot(...p.scores.map((value, axis) => value - at(candidate.scores, axis)))));
  assert.equal(nearest, 11);
  const source = readSeedSource();
  assert.equal(source.split("['Event sourcing',").length - 1, 1);
  assert.ok(source.includes(`['Event sourcing', '${candidate.definition}', '${at(candidate.sources, 0)}']`));
  const { map, gaps } = selectRepos({ ...corpus,
    coverageBaseline: previous.map((p) => p.name) }, corpus.repos.length);
  assert.deepEqual(gaps, []);
  assert.ok(map.coverage.radius <= map.coverage.baseline.radius);
}

function check43(): void {
  const corpus = corpusBeforeKubo();
  const candidate = byName(corpus.paradigms, 'Constraint programming');
  assert.ok(candidate);
  assert.equal(candidate.layer, 'language');
  assert.match(candidate.scope, /not mutable solver internals/);
  assert.ok(at(candidate.scores, 1) > 5);
  assert.match(at(candidate.reasons, 1).reason, /Solver search state lies outside/);
  assert.ok(at(candidate.scores, 3) < 5);
  assert.ok(at(candidate.scores, 5) > 5);
  assert.match(at(candidate.reasons, 6).reason, /uncertain evidence/);
  const previous = corpus.paradigms.filter((p) => p !== candidate);
  const nearest = Math.min(...previous.map((p) =>
    Math.hypot(...p.scores.map((value, axis) => value - at(candidate.scores, axis)))));
  assert.ok(Math.abs(nearest - Math.sqrt(118)) < 1e-9);
  const source = readSeedSource();
  assert.equal(source.split("['Constraint programming',").length - 1, 1);
  assert.ok(source.includes(`['Constraint programming', '${candidate.definition}', '${at(candidate.sources, 0)}']`));
  const { map, gaps } = selectRepos({ ...corpus,
    coverageBaseline: previous.map((p) => p.name) }, corpus.repos.length);
  assert.deepEqual(gaps, []);
  assert.ok(map.coverage.radius <= map.coverage.baseline.radius);
}

function check44(): void {
  const corpus = corpusBeforeKubo();
  const candidate = byName(corpus.paradigms, 'Separation kernel');
  assert.ok(candidate);
  assert.equal(candidate.layer, 'os');
  const capability = byName(corpus.paradigms, 'Capability-based OS');
  assert.ok(at(candidate.scores, 3) < at(capability.scores, 3));
  assert.ok(at(candidate.scores, 5) > at(capability.scores, 5));
  assert.equal(at(candidate.scores, 1), 0);
  assert.match(at(candidate.reasons, 1).reason, /do not make channel data immutable/);
  assert.match(candidate.scope, /Dynamic Tau0.*lie outside/);
  assert.match(at(candidate.reasons, 6).reason, /share the kernel and physical machine/);
  assert.equal(at(candidate.scores, 7), 0);
  const previous = corpus.paradigms.filter((p) => p !== candidate);
  const nearest = Math.min(...previous.map((p) =>
    Math.hypot(...p.scores.map((value, axis) => value - at(candidate.scores, axis)))));
  assert.ok(Math.abs(nearest - Math.sqrt(23)) < 1e-9);
  const source = readSeedSource();
  assert.equal(source.split("['Separation kernel',").length - 1, 1);
  assert.ok(source.includes(`['Separation kernel', '${candidate.definition}', '${at(candidate.sources, 0)}']`));
  const { map, gaps } = selectRepos({ ...corpus,
    coverageBaseline: previous.map((p) => p.name) }, corpus.repos.length);
  assert.deepEqual(gaps, []);
  assert.ok(map.coverage.radius <= map.coverage.baseline.radius);
}

function check45(): void {
  const corpus = corpusBeforeKubo();
  const candidate = byName(corpus.paradigms, 'Domain-specific accelerator');
  assert.ok(candidate);
  assert.equal(candidate.layer, 'hardware');
  assert.match(candidate.scope, /first-generation TPU ASIC/);
  assert.ok(at(candidate.scores, 3) > 5);
  assert.ok(at(candidate.scores, 5) > 5);
  assert.match(at(candidate.reasons, 1).reason, /overwrite accumulators/);
  assert.match(at(candidate.reasons, 3).reason, /fixed instruction set/);
  assert.match(at(candidate.reasons, 5).reason, /same circuit serves multiple model types/);
  assert.match(at(candidate.reasons, 6).reason, /uncertain evidence/);
  assert.equal(at(candidate.scores, 7), 0);
  const previous = corpus.paradigms.filter((p) => p !== candidate);
  const nearest = Math.min(...previous.map((p) =>
    Math.hypot(...p.scores.map((value, axis) => value - at(candidate.scores, axis)))));
  assert.ok(Math.abs(nearest - Math.sqrt(27)) < 1e-9);
  const source = readSeedSource();
  assert.equal(source.split("['Domain-specific accelerator',").length - 1, 1);
  assert.ok(source.includes(`['Domain-specific accelerator', '${candidate.definition}', '${at(candidate.sources, 0)}']`));
  const { map, gaps } = selectRepos({ ...corpus,
    coverageBaseline: previous.map((p) => p.name) }, corpus.repos.length);
  assert.deepEqual(gaps, []);
  assert.equal(map.coverage.radius, map.coverage.baseline.radius);
}

function check46(): void {
  const current = loadCorpus();
  const corpus = { ...current, paradigms: current.paradigms.filter((p) => !['Peer-to-peer', 'Vector processor', 'Exokernel'].includes(p.name)) };
  const before = selectRepos(corpusBeforeKubo(), 7);
  const after = selectRepos(corpus, 7);
  assert.ok(Math.abs(before.minimumDistance - Math.sqrt(104)) < 1e-9);
  assert.ok(Math.abs(after.minimumDistance - Math.sqrt(111)) < 1e-9);
  assert.ok(after.minimumDistance > before.minimumDistance);
  const region = gapFor(after.gaps, 'Kubo');
  assert.ok(region);
  assert.equal(region.nearestOnAxes.paradigm.name, 'Conflict-free replicated data types');
  assert.ok(Math.abs(region.nearestOnAxes.distance - Math.sqrt(27)) < 1e-9);
  assert.equal(at(region.repo.scores, 1), 10);
  assert.match(region.repo.scope, /Mutable names, MFS, and daemon metadata lie outside/);
  assert.match(at(region.repo.reasons, 7).reason, /do not automatically guarantee permanent retention/);
  assert.equal(region.repo.reasons.length, corpus.axes.length);
  assert.ok(region.repo.reasons.every(({ source }) => region.repo.sources.includes(source)));
  assert.ok(after.map.records.some(({ kind, record }) => kind === 'repo' && (record as unknown) === region.repo));
}

function check47(): void {
  const corpus = loadCorpus();
  const candidate = byName(corpus.paradigms, 'Peer-to-peer');
  assert.ok(candidate);
  assert.equal(candidate.layer, 'software');
  assert.match(candidate.scope, /not all peer-to-peer systems/);
  const previous = corpus.paradigms.filter((p) => p !== candidate);
  const before = selectRepos({ ...corpus, paradigms: previous }, corpus.repos.length);
  const region = gapFor(before.gaps, 'Kubo');
  assert.ok(region);
  assert.ok(Math.abs(region.nearestOnAxes.distance - Math.sqrt(27)) < 1e-9);
  assert.ok(candidate.suggestedBy.includes(region.repo.url));
  assert.deepEqual(candidate.scores, region.repo.scores);
  assert.match(at(candidate.reasons, 7).reason, /do not automatically guarantee permanent retention/);
  const after = selectRepos(corpus, corpus.repos.length);
  assert.equal(before.gaps.length, 1);
  assert.deepEqual(after.gaps, []);
  assert.deepEqual(selectRepos(corpus, 7).gaps, []);
  assert.deepEqual(after.repos, before.repos);
  assert.equal(after.minimumDistance, before.minimumDistance);
  const source = readSeedSource();
  assert.equal(source.split("['Peer-to-peer',").length - 1, 1);
  assert.ok(source.includes(`['Peer-to-peer', '${candidate.definition}', '${at(candidate.sources, 0)}']`));
  const { map } = selectRepos({ ...corpus,
    coverageBaseline: previous.map((p) => p.name) }, corpus.repos.length);
  assert.ok(map.coverage.radius <= map.coverage.baseline.radius);
}

function check48(): void {
  const corpus = loadCorpus();
  const candidate = byName(corpus.paradigms, 'Vector processor');
  assert.ok(candidate);
  assert.equal(candidate.layer, 'hardware');
  assert.ok(at(candidate.scores, 3) > at(candidate.scores, 5));
  assert.equal(at(candidate.scores, 1), 0);
  assert.equal(at(candidate.scores, 2), 0);
  assert.equal(at(candidate.scores, 7), 0);
  assert.match(at(candidate.reasons, 6).reason, /uncertain evidence/);
  const previous = corpus.paradigms.filter((p) => p !== candidate);
  const nearest = Math.min(...previous.map((p) =>
    Math.hypot(...p.scores.map((value, axis) => value - at(candidate.scores, axis)))));
  assert.ok(Math.abs(nearest - Math.sqrt(26)) < 1e-9);
  const source = readSeedSource();
  assert.equal(source.split("['Vector processor',").length - 1, 1);
  assert.ok(source.includes(`['Vector processor', '${candidate.definition}', '${at(candidate.sources, 0)}']`));
  const { map, gaps } = selectRepos({ ...corpus,
    coverageBaseline: previous.map((p) => p.name) }, corpus.repos.length);
  assert.deepEqual(gaps, []);
  assert.equal(map.coverage.radius, map.coverage.baseline.radius);
}

function check49(): void {
  const corpus = loadCorpus();
  const candidate = byName(corpus.paradigms, 'Exokernel');
  assert.ok(candidate);
  assert.equal(candidate.layer, 'os');
  assert.match(candidate.scope, /1995 prototype.*not later XOK/);
  assert.equal(at(candidate.scores, 1), 0);
  assert.match(at(candidate.reasons, 3).reason, /packet filters.*runtime/);
  assert.match(at(candidate.reasons, 5).reason, /link time/);
  assert.match(at(candidate.reasons, 6).reason, /library fault.*share the kernel/);
  assert.ok(at(candidate.scores, 7) > 0);
  assert.match(at(candidate.reasons, 7).reason, /NFS.*native file system was incomplete/);
  const previous = corpus.paradigms.filter((p) => p !== candidate);
  const nearest = Math.min(...previous.map((p) =>
    Math.hypot(...p.scores.map((value, axis) => value - at(candidate.scores, axis)))));
  assert.ok(Math.abs(nearest - Math.sqrt(21)) < 1e-9);
  const source = readSeedSource();
  assert.equal(source.split("['Exokernel',").length - 1, 1);
  assert.ok(source.includes(`['Exokernel', '${candidate.definition}', '${at(candidate.sources, 0)}']`));
  const { map, gaps } = selectRepos({ ...corpus,
    coverageBaseline: previous.map((p) => p.name) }, corpus.repos.length);
  assert.deepEqual(gaps, []);
  assert.equal(map.coverage.radius, map.coverage.baseline.radius);
}
function register1(): void {
  void test('the real corpus has complete source evidence and yields a more distant subset', check01);
  void test('the real corpus maps source-backed paradigms from all Stack layers with repositories', check02);
  void test('max-min selection increases minimum distance from 1 to 10 on a known geometry', check03);
  void test('each initial pair improves real subsets to the exhaustive optimum for this corpus', check04);
  void test('ties follow input order and identical profiles remain distinct repositories', check05);
  void test('joint PCA uses one frame for all records and preserves axis distances in two dimensions', check06);
  void test('joint PCA rejects incomplete, duplicate and invalid paradigm profiles', check07);
  void test('map coverage bounds the largest empty circle on a known square', check08);
  void test('map coverage remains finite on coincident and collinear profiles', check09);
  void test('coverage compares a baseline within the full PCA frame and rectangle', check10);
  void test('coverage baselines reject absent, empty, duplicate and unknown profiles', check11);
  void test('the error bound includes an empty-circle centre between grid nodes', check12);
  void test('the prior map has empty space despite zero repository search regions', check13);
  void test('the real baseline measures a coverage gain within one map', check14);
  void test('gap regions retain axis separation that the first two components omit', check15);
  void test('gap regions use selected repositories and exact nearest distances in each space', check16);
  void test('Gforth improves seven-repository separation and retains a source-backed search region', check17);
}

function register2(): void {
  void test('the existing concatenative seed profile removes the duplicate Gforth search candidate', check18);
  void test('real gap regions exclude an exact profile match and retain source evidence', check19);
  void test('the existing actor seed profile removes the duplicate Erlang search candidate', check20);
  void test('the verified hardware generator profile closes the Rocket Chip search region', check21);
  void test('functional package management covers the Nix region in the full repository pool', check22);
  void test('consistent Unikraft evidence removes a false region from the full repository pool', check23);
  void test('the data structure server profile covers the Redis region without a duplicate seed', check24);
  void test('seL4 increases four-repository separation and exposes an OS search region', check25);
  void test('the existing capability OS profile removes the duplicate seL4 search candidate', check26);
  void test('GHCi increases six-repository separation and exposes a language search region', check27);
  void test('the existing functional seed profile removes the duplicate GHCi search candidate', check28);
  void test('invalid scores and duplicate repositories cannot distort the distance', check29);
  void test('the command reports input errors with a nonzero exit status', check30);
  void test('the command preserves source evidence and leaves its input file intact', check31);
  void test('the single-level store profile adds a distinct durable OS example', check32);
  void test('Automerge improves repository separation and exposes a replicated data region', check33);
  void test('the verified CRDT profile covers the Automerge region without a duplicate seed', check34);
}

function register3(): void {
  void test('the FPGA profile adds hardware flexibility without a duplicate seed', check35);
  void test('the cluster profile adds a distributed hardware example without a duplicate seed', check36);
  void test('the multikernel profile adds a distributed OS example without false isolation', check37);
  void test('the hardware root of trust profile adds a distinct durable device example', check38);
  void test('the microservices profile separates mutable services from immutable replicas', check39);
  void test('the logic profile distinguishes mutable clauses from immutable functional values', check40);
  void test('the distributed OS profile preserves private namespaces and mutable active files', check41);
  void test('the event log profile preserves history without an assumed distributed deployment', check42);
  void test('the constraint profile separates fixed model values from mutable solver state', check43);
  void test('the separation kernel profile distinguishes fixed resources from immutable channel data', check44);
  void test('the accelerator profile distinguishes fixed silicon from fixed runtime work', check45);
  void test('Kubo increases seven-repository separation and exposes an immutable content region', check46);
  void test('the existing peer-to-peer seed covers Kubo without a duplicate paradigm', check47);
  void test('the vector profile covers runtime vector control without a task-specific circuit', check48);
  void test('the exokernel profile separates library policy from kernel resource protection', check49);
}

register1();
register2();
register3();
