import fs from 'node:fs';
import path from 'node:path';
import { START } from '../../src/data.ts';
import { selectRepos as selectRaw } from '../../scripts/select-repos.ts';
import type { CoverageMap, Gap, SelectInput, Selection } from '../../scripts/select-repos.ts';

export interface Evidence { reason: string; source: string }
export interface CorpusRepo {
  name: string; url: string; revision: string; layer: string; scope: string;
  sources: string[]; scores: number[]; reasons: Evidence[];
}
export interface CorpusParadigm {
  name: string; layer: string; definition: string; scope: string;
  sources: string[]; scores: number[]; reasons: Evidence[]; suggestedBy: string[];
}
export interface Corpus {
  axes: string[]; axisDefinitions: { zero: string; ten: string }[]; coverageBaseline: string[];
  repos: CorpusRepo[]; paradigms: CorpusParadigm[];
}
interface Nearest { paradigm: CorpusParadigm; distance: number }
export interface FullGap extends Omit<Gap, 'repo' | 'nearestOnMap' | 'nearestOnAxes'> {
  repo: CorpusRepo; nearestOnMap: Nearest; nearestOnAxes: Nearest;
}
type FullMap = Omit<CoverageMap, 'coverage'> & { coverage: Required<CoverageMap['coverage']> };
export type Full = Omit<Selection, 'repos' | 'map' | 'gaps'> & { repos: CorpusRepo[]; map: FullMap; gaps: FullGap[] };

// The places where parsed JSON takes the type that the tests expect of it.
export function parseOutput(text: string): CommandOutput {
  return JSON.parse(text) as CommandOutput;
}

export function parseInput(text: string): CommandInput {
  return JSON.parse(text) as CommandInput;
}

// Replace the non-null assertion: a missing value fails the test with a message.
export function def<T>(value: T | null | undefined): T {
  if (value === undefined || value === null) {throw new Error('expected a value');}
  return value;
}

export function at<T>(items: readonly T[], index: number): T {
  return def(items[index]);
}

export function byName<T extends { name: string }>(items: readonly T[], name: string): T {
  return def(items.find((item) => item.name === name));
}

export function gapFor(gaps: readonly FullGap[], name: string): FullGap {
  return def(gaps.find((gap) => gap.repo.name === name));
}

export function loadCorpus(): Corpus {
  return JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '../../data/repo-scores.json'), 'utf8')) as Corpus;
}

// The start list as one seed per line, ['name', 'summary', 'url'], so that a test can count and match single seeds.
export function readSeedSource(): string {
  return Object.values(START).flat().map(([name, summary, url]) => `['${name}', '${summary}', '${url}'],`).join('\n');
}

// The tests pass invalid inputs on purpose, and read map and gaps only where the input has paradigms.
export function selectRepos(input: object, count: number): Full {
  return selectRaw(input as SelectInput, count) as unknown as Full;
}

// These score profiles are synthetic. They make no claims about these projects.
export function profile(name: string, scores: unknown[]): { url: string; scores: unknown[] } {
  return { url: `https://github.com/test/${name}`, scores };
}

export const data = {
  axes: ['state', 'parallelism'],
  repos: [profile('a', [0, 0]), profile('b', [1, 0]), profile('c', [10, 0]), profile('d', [0, 10])],
};

// Keep prior discovery checks on the repository pool that supplied their measurements.
export function corpusBeforeKubo(): Corpus {
  const corpus = loadCorpus();
  return { ...corpus, repos: corpus.repos.filter((repo) => repo.name !== 'Kubo'),
    paradigms: corpus.paradigms.filter((p) => !['Peer-to-peer', 'Vector processor', 'Exokernel'].includes(p.name)) };
}

const AUTOMERGE_PARADIGMS = ['Conflict-free replicated data types', 'Reconfigurable logic (FPGA)',
  'Cluster (warehouse-scale computer)', 'Multikernel', 'Hardware root of trust', 'Microservices',
  'Logic programming', 'Distributed OS', 'Event sourcing', 'Constraint programming', 'Separation kernel',
  'Domain-specific accelerator'];

export function corpusBeforeAutomerge(): Corpus {
  const corpus = corpusBeforeKubo();
  return { ...corpus, repos: corpus.repos.filter((repo) => repo.name !== 'Automerge'),
    paradigms: corpus.paradigms.filter((p) => !AUTOMERGE_PARADIGMS.includes(p.name)) };
}

export function corpusBeforeGforth(): Corpus {
  const corpus = corpusBeforeAutomerge();
  return { ...corpus, repos: corpus.repos.filter((repo) => repo.name !== 'Gforth'),
    paradigms: corpus.paradigms.filter((p) => !['Concatenative programming', 'Single-level store'].includes(p.name)) };
}

export interface CommandInput { repos: unknown[]; paradigms: unknown[] }
export interface CommandOutput {
  minimumDistance: number; repos: unknown[];
  map: { points: unknown[]; records: unknown[]; coverage: { baseline: { radius: number }; radius: number } };
}

function separation(subset: readonly CorpusRepo[]): number {
  let best = Infinity;
  for (let i = 0; i < subset.length; i++) {
    for (let j = i + 1; j < subset.length; j++) {
      const a = at(subset, i);
      const b = at(subset, j);
      best = Math.min(best, Math.hypot(...a.scores.map((value, axis) => value - at(b.scores, axis))));
    }
  }
  return best;
}

const MAX_COMBINATIONS = 10_000_000;

// The best minimum separation over every subset of the given size, found by walking the
// combinations in lexicographic order with one fixed-size array of indexes (no recursion).
export function exhaustiveOptimum(repos: readonly CorpusRepo[], count: number): number {
  const index = Array.from({ length: count }, (_, i) => i);
  let best = -Infinity;
  for (let step = 0; step < MAX_COMBINATIONS; step++) {
    best = Math.max(best, separation(index.map((i) => at(repos, i))));
    let pos = count - 1;
    while (pos >= 0 && at(index, pos) === repos.length - count + pos) {pos--;}
    if (pos < 0) {break;}
    index[pos] = at(index, pos) + 1;
    for (let k = pos + 1; k < count; k++) {index[k] = at(index, k - 1) + 1;}
  }
  return best;
}
