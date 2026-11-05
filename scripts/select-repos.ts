#!/usr/bin/env node
import fs from 'node:fs';
import { pca } from '../src/stack.ts';
import type { Pca } from '../src/stack.ts';

type Layer = 'language' | 'hardware' | 'os' | 'software';
type Point = number[];
interface Scored { scores: number[] }
export interface Repo extends Scored { url: string; [key: string]: unknown }
export interface ParadigmProfile extends Scored { name: string; layer: Layer; [key: string]: unknown }
export interface SelectInput {
  axes: string[];
  repos: Repo[];
  paradigms?: ParadigmProfile[];
  coverageBaseline?: string[];
  [key: string]: unknown;
}
type MapRecord = { kind: 'repo'; record: Repo } | { kind: 'paradigm'; record: ParadigmProfile };
interface Coverage {
  bounds: { min: number[]; max: number[] };
  gridSteps: number;
  center: Point;
  radius: number;
  errorBound: number;
  baseline?: { names: string[]; center: Point; radius: number };
}
export interface CoverageMap extends Pca { records: MapRecord[]; coverage: Coverage }
interface Nearest { paradigm: ParadigmProfile; distance: number }
export interface Gap { repo: Repo; point: Point; nearestOnMap: Nearest; nearestOnAxes: Nearest }
export interface Selection {
  axes: string[];
  repos: Repo[];
  minimumDistance: number;
  map?: CoverageMap;
  gaps?: Gap[];
}

function at<T>(items: readonly T[], i: number): T {
  const item = items[i];
  if (item === undefined) {
    throw new Error(`No item at index ${String(i)}.`);
  }
  return item;
}

function distance(a: readonly number[], b: readonly number[]): number {
  return a.reduce((sum, value, i) => sum + (value - at(b, i)) ** 2, 0);
}

function mapCoverage(
  map: Pca & { records: MapRecord[] },
  points: Point[] = map.points.slice(map.records.filter(({ kind }) => kind === 'repo').length),
): Omit<Coverage, 'baseline'> {
  const bounds = {
    min: [0, 1].map((axis) => Math.min(...map.points.map((point) => at(point, axis)))),
    max: [0, 1].map((axis) => Math.max(...map.points.map((point) => at(point, axis)))),
  };
  const gridSteps = 40;
  const step = bounds.min.map((value, axis) => (at(bounds.max, axis) - value) / gridSteps);
  let radiusSquared = -1, center: Point = [];
  for (let x = 0; x <= gridSteps; x++) {
    for (let y = 0; y <= gridSteps; y++) {
      const point = [at(bounds.min, 0) + x * at(step, 0), at(bounds.min, 1) + y * at(step, 1)];
      const nearest = Math.min(...points.map((paradigm) => distance(point, paradigm)));
      if (nearest > radiusSquared) {
        radiusSquared = nearest;
        center = point;
      }
    }
  }
  // Nearest-point distance changes by at most the distance to the nearest grid node.
  return { bounds, gridSteps, center, radius: Math.sqrt(radiusSquared), errorBound: Math.hypot(...step) / 2 };
}

function isValidScore(score: unknown): boolean {
  return typeof score === 'number' && Number.isFinite(score) && score >= 0 && score <= 10;
}

function checkScores(records: readonly Scored[], axes: readonly unknown[]): void {
  for (const record of records) {
    const scores: unknown = record.scores;
    if (!Array.isArray(scores) || record.scores.length !== axes.length || !(record.scores as unknown[]).every(isValidScore)) {
      throw new Error('Supply one score from 0 to 10 per axis for each record.');
    }
  }
}

function isAxisName(axis: unknown): boolean {
  return typeof axis === 'string' && axis.trim() !== '';
}

function checkAxes(axes: readonly unknown[]): void {
  const list: unknown = axes;
  if (!Array.isArray(list) || axes.length < 2 || new Set(axes).size !== axes.length || !axes.every(isAxisName)) {
    throw new Error('Use at least two distinct axis names.');
  }
}

function checkRepos(repos: readonly Repo[], count: number): void {
  const list: unknown = repos;
  if (!Array.isArray(list) || repos.length < 2 || !Number.isInteger(count) || count < 2 || count > repos.length) {
    throw new Error('Select two or more repositories, up to the input count.');
  }
  const urls = new Set<string>();
  for (const repo of repos) {
    if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(repo.url)) {
      throw new Error('Use a GitHub repository URL without a final slash.');
    }
    const key = repo.url.toLowerCase().replace(/\.git$/, '');
    if (urls.has(key)) {
      throw new Error('Use each repository once.');
    }
    urls.add(key);
  }
}

const LAYERS: readonly string[] = ['language', 'hardware', 'os', 'software'];

// Checks the paradigm profiles and returns their lower-case names.
function checkParadigms(paradigms: readonly ParadigmProfile[], axes: readonly unknown[]): Set<string> {
  const list: unknown = paradigms;
  if (!Array.isArray(list) || paradigms.length === 0) {
    throw new Error('Supply at least one paradigm for joint PCA.');
  }
  const names = new Set<string>();
  for (const paradigm of paradigms as (ParadigmProfile | undefined)[]) {
    if (!paradigm || typeof paradigm.name !== 'string' || !paradigm.name.trim() || !LAYERS.includes(paradigm.layer)) {
      throw new Error('Supply a name and a Stack layer for each paradigm.');
    }
    const key = paradigm.name.trim().toLowerCase();
    if (names.has(key)) {
      throw new Error('Use each paradigm once.');
    }
    names.add(key);
  }
  checkScores(paradigms, axes);
  return names;
}

function baselineKeys(baseline: unknown, names: ReadonlySet<string>): Set<string> {
  const list = baseline as unknown[];
  const keyOf = (name: unknown): string => (name as string).trim().toLowerCase();
  if (!Array.isArray(list) || list.length === 0 || list.some((name) => typeof name !== 'string' || !names.has(keyOf(name))) ||
      new Set(list.map(keyOf)).size !== list.length) {
    throw new Error('Use distinct existing paradigm names for the coverage baseline.');
  }
  return new Set(list.map(keyOf));
}

function addBaseline(map: CoverageMap, baseline: unknown, names: ReadonlySet<string>): void {
  const keys = baselineKeys(baseline, names);
  const { records } = map;
  const indices = records.flatMap(({ kind, record }, i) => (kind === 'paradigm' && keys.has(record.name.trim().toLowerCase()) ? [i] : []));
  // Reuse the full map and rectangle. Only the reference paradigm set changes.
  const { center, radius } = mapCoverage(map, indices.map((i) => at(map.points, i)));
  map.coverage.baseline = { names: indices.map((i) => String(at(records, i).record.name)), center, radius };
}

function buildMap(data: SelectInput, repos: readonly Repo[], axes: readonly unknown[]): CoverageMap | undefined {
  if (data.coverageBaseline !== undefined && data.paradigms === undefined) {
    throw new Error('Supply paradigm profiles for a coverage baseline.');
  }
  if (data.paradigms === undefined) {
    return undefined;
  }
  const names = checkParadigms(data.paradigms, axes);
  // Fit all candidates, so a subset count cannot change the comparison frame.
  const records: MapRecord[] = [
    ...repos.map((record): MapRecord => ({ kind: 'repo', record })),
    ...data.paradigms.map((record): MapRecord => ({ kind: 'paradigm', record })),
  ];
  const fit = pca(records.map(({ record }) => record.scores));
  if (!fit) {
    throw new Error('Supply at least one paradigm for joint PCA.');
  }
  const base = { ...fit, records };
  const map: CoverageMap = { ...base, coverage: mapCoverage(base) };
  if (data.coverageBaseline !== undefined) {
    addBaseline(map, data.coverageBaseline, names);
  }
  return map;
}

function farthestPair(repos: readonly Repo[]): [number, number] {
  let farthest = -1;
  const pair: [number, number] = [0, 1];
  for (let i = 0; i < repos.length; i++) {
    for (let j = i + 1; j < repos.length; j++) {
      const d = distance(at(repos, i).scores, at(repos, j).scores);
      if (d > farthest) {
        farthest = d;
        pair[0] = i;
        pair[1] = j;
      }
    }
  }
  return pair;
}

interface Subset { subset: number[]; minimum: number }

// Grows a pair by always adding the repository farthest from its nearest selected neighbour.
function extend(repos: readonly Repo[], pair: readonly number[], count: number): Subset {
  const subset = [...pair];
  while (subset.length < count) {
    let next = -1, best = -1;
    for (let i = 0; i < repos.length; i++) {
      if (subset.includes(i)) {
        continue;
      }
      const nearest = Math.min(...subset.map((j) => distance(at(repos, i).scores, at(repos, j).scores)));
      if (nearest > best) {
        best = nearest;
        next = i;
      }
    }
    subset.push(next);
  }
  let minimum = Infinity;
  for (let i = 0; i < subset.length; i++) {
    for (let j = i + 1; j < subset.length; j++) {
      minimum = Math.min(minimum, distance(at(repos, at(subset, i)).scores, at(repos, at(subset, j)).scores));
    }
  }
  return { subset, minimum };
}

// Retain the original result on ties, so the extra trials cannot reduce separation.
function bestSubset(repos: readonly Repo[], count: number): Subset {
  const first = farthestPair(repos);
  let best = extend(repos, first, count);
  if (count > 2 && count < repos.length) {
    for (let i = 0; i < repos.length; i++) {
      for (let j = i + 1; j < repos.length; j++) {
        if (i === first[0] && j === first[1]) {
          continue;
        }
        const trial = extend(repos, [i, j], count);
        if (trial.minimum > best.minimum) {
          best = trial;
        }
      }
    }
  }
  return best;
}

function nearestParadigm(paradigms: readonly ParadigmProfile[], space: (i: number) => number[], point: Point): Nearest {
  let best = 0, squared = Infinity;
  for (let i = 0; i < paradigms.length; i++) {
    const candidate = distance(point, space(i));
    if (candidate < squared) {
      best = i;
      squared = candidate;
    }
  }
  return { paradigm: at(paradigms, best), distance: Math.sqrt(squared) };
}

// A repository anchors a search region, not a verified new paradigm.
function gapsOf(map: CoverageMap, repos: readonly Repo[], paradigms: readonly ParadigmProfile[], selected: readonly number[]): Gap[] {
  return selected.map((index): Gap => ({
    repo: at(repos, index),
    point: at(map.points, index),
    nearestOnMap: nearestParadigm(paradigms, (i) => at(map.points, repos.length + i), at(map.points, index)),
    nearestOnAxes: nearestParadigm(paradigms, (i) => at(paradigms, i).scores, at(repos, index).scores),
  })).filter((gap) => gap.nearestOnAxes.distance > 1e-9)
    .sort((a, b) => b.nearestOnMap.distance - a.nearestOnMap.distance);
}

// Try each initial pair, then maximize distance to the nearest selected repository.
export function selectRepos(data: SelectInput, count: number): Selection {
  const { axes, repos } = data;
  checkAxes(axes);
  checkRepos(repos, count);
  checkScores(repos, axes);
  const map = buildMap(data, repos, axes);
  const best = bestSubset(repos, count);
  const result: Selection = { axes, repos: best.subset.map((i) => at(repos, i)), minimumDistance: Math.sqrt(best.minimum) };
  if (map) {
    result.map = map;
    result.gaps = gapsOf(map, repos, data.paradigms ?? [], best.subset);
  }
  return result;
}

function runMain(): void {
  try {
    const [, , file, count] = process.argv;
    if (!file || !count || process.argv.length !== 4) {
      throw new Error('Use: bun scripts/select-repos.ts <scores.json> <count>');
    }
    const input = JSON.parse(fs.readFileSync(file, 'utf8')) as SelectInput;
    console.log(JSON.stringify(selectRepos(input, Number(count)), null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (import.meta.main) {
  runMain();
}
