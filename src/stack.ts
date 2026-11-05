import { MISMATCH, PRACTICAL_PROBLEMS, PROBLEM_LINKS, START, type Layer, type ParadigmSeed, type ProblemId, type ProblemItem, type ProblemLink } from './data.ts';
import { assert } from '../shared/assert.ts';
import { traced } from '../shared/trace.ts';

export interface Paradigm { id: number; layer: Layer; name: string; summary: string; url: string }
export interface Axis { id: number; name: string; low: string; high: string }
export interface Score { paradigm_id: number; axis_id: number; score: number; reason: string }
export type ScoreTable = Record<number, Record<number, Score>>;

export interface LinkedProblem extends ProblemLink { paradigm_id: number }
export interface Coverage { withoutReduction: ProblemId[]; unassessedParadigms: number; limit: string }

const COVERAGE_LIMIT = 'Links are source-based assessments of specific mechanisms, not measured effects on survey shares. No link means no assessment, not no benefit.';

function seedOf(link: ProblemLink): ParadigmSeed | undefined {
  assert(link.layer in START, 'a link names a known layer');
  assert(link.paradigm.length > 0, 'a link names a paradigm');
  for (const seed of START[link.layer]) {
    if (seed[0] === link.paradigm) {
      return seed;
    }
  }
  return undefined;
}

function linksOf(paradigms: readonly Paradigm[]): LinkedProblem[] {
  assert(Number.isInteger(paradigms.length), 'paradigms come as a list');
  assert(PROBLEM_LINKS.length > 0, 'the stack has sourced problem links');
  const links: LinkedProblem[] = [];
  for (const link of PROBLEM_LINKS) {
    const seed = seedOf(link);
    if (!seed) {continue;}
    for (const p of paradigms) {
      if (p.layer === link.layer && p.name === seed[0] && p.url === seed[2]) {links.push({ ...link, paradigm_id: p.id });}
    }
  }
  assert(links.length <= PROBLEM_LINKS.length * paradigms.length, 'a link joins a paradigm at most once');
  assert(links.every((l) => Number.isInteger(l.paradigm_id)), 'a linked paradigm has an id');
  return links;
}

function reduces(links: readonly LinkedProblem[], id: ProblemId): boolean {
  assert(id.length > 0, 'a problem has an id');
  assert(Number.isInteger(links.length), 'links come as a list');
  for (const l of links) {
    if (l.problem_id === id && l.effect === 'reduces') {
      return true;
    }
  }
  assert(links.length >= 0, 'links count');
  return false;
}

function practicalProblemsImpl(paradigms: readonly Paradigm[]) {
  assert(Number.isInteger(paradigms.length), 'paradigms come as a list');
  assert(PRACTICAL_PROBLEMS.items.length > 0, 'the survey names practical problems');
  const links = linksOf(paradigms);
  const withoutReduction: ProblemId[] = [];
  for (const p of PRACTICAL_PROBLEMS.items) {
    if (!reduces(links, p.id)) {
      withoutReduction.push(p.id);
    }
  }
  const linked = new Set<number>();
  for (const l of links) {
    linked.add(l.paradigm_id);
  }
  const coverage: Coverage = { withoutReduction, unassessedParadigms: paradigms.length - linked.size, limit: COVERAGE_LIMIT };
  assert(coverage.unassessedParadigms >= 0, 'linked paradigms are a subset of the paradigms');
  assert(coverage.withoutReduction.length <= PRACTICAL_PROBLEMS.items.length, 'a problem is listed once');
  assert(links.length >= linked.size, 'a paradigm has at least one link when it is linked');
  return { ...PRACTICAL_PROBLEMS, links, coverage };
}

function ideaProblemsImpl(ids: unknown) {
  assert(PRACTICAL_PROBLEMS.items.length > 0, 'the survey names practical problems');
  assert(Number.isInteger(PRACTICAL_PROBLEMS.items.length), 'the survey items are a list');
  const problems: ProblemItem[] = [];
  const problemIds: ProblemId[] = [];
  let priority = 0;
  for (const p of PRACTICAL_PROBLEMS.items) {
    if (Array.isArray(ids) && ids.includes(p.id)) {
      problems.push(p);
      problemIds.push(p.id);
      priority = Math.max(priority, p.percent);
    }
  }
  assert(problems.length <= PRACTICAL_PROBLEMS.items.length, 'a problem is named once');
  assert(priority >= 0, 'a priority is a share');
  assert(problemIds.length === problems.length, 'one id for each problem');
  return { problem_ids: problemIds, practical_problems: problems, problem_priority: priority };
}

export interface Eigen { value: number; vector: number[] }

type Grid = number[][];

function at(g: Grid, r: number, c: number): number {
  assert(Number.isInteger(r) && r >= 0, 'a row is a non-negative integer');
  assert(Number.isInteger(c) && c >= 0, 'a column is a non-negative integer');
  const value = g[r]?.[c] ?? 0;
  assert(typeof value === 'number', 'a cell is a number');
  return value;
}

function put(g: Grid, r: number, c: number, x: number): void {
  assert(Number.isInteger(r) && r >= 0, 'a row is a non-negative integer');
  assert(Number.isInteger(c) && c >= 0, 'a column is a non-negative integer');
  const row = g[r];
  if (row) {row[c] = x;}
  assert(typeof x === 'number', 'a cell is a number');
  assert(g.length > r || row === undefined, 'a written row exists');
}

function offDiagonal(a: Grid, n: number): number {
  assert(a.length === n, 'the matrix is n rows');
  assert(n >= 0, 'n is a size');
  let off = 0;
  for (let p = 0; p < n; p++) {for (let q = p + 1; q < n; q++) {off += at(a, p, q) ** 2;}}
  assert(off >= 0 || Number.isNaN(off), 'squares sum to a non-negative number');
  return off;
}

function rotateColumns(g: Grid, n: number, p: number, q: number, cs: readonly [number, number]): void {
  assert(p < q && q < n, 'a rotation turns two different columns');
  assert(Number.isFinite(cs[0]) && Number.isFinite(cs[1]), 'a rotation has finite sine and cosine');
  const [c, s] = cs;
  for (let k = 0; k < n; k++) {
    const kp = at(g, k, p), kq = at(g, k, q);
    put(g, k, p, c * kp - s * kq); put(g, k, q, s * kp + c * kq);
  }
  assert(g.length >= n, 'the matrix keeps its rows');
  assert(Number.isInteger(q), 'a column is an integer');
}

function rotateRows(g: Grid, n: number, p: number, q: number, cs: readonly [number, number]): void {
  assert(p < q && q < n, 'a rotation turns two different rows');
  assert(Number.isFinite(cs[0]) && Number.isFinite(cs[1]), 'a rotation has finite sine and cosine');
  const [c, s] = cs;
  for (let k = 0; k < n; k++) {
    const pk = at(g, p, k), qk = at(g, q, k);
    put(g, p, k, c * pk - s * qk); put(g, q, k, s * pk + c * qk);
  }
  assert(g.length >= n, 'the matrix keeps its rows');
  assert(Number.isInteger(q), 'a row is an integer');
}

function jacobiSweep(a: Grid, v: Grid, n: number): void {
  assert(a.length === n && v.length === n, 'both matrices are n rows');
  assert(n >= 0, 'n is a size');
  for (let p = 0; p < n; p++) {for (let q = p + 1; q < n; q++) {
    if (Math.abs(at(a, p, q)) < 1e-300) {continue;}
    const theta = (at(a, q, q) - at(a, p, p)) / (2 * at(a, p, q));
    const t = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
    const c = 1 / Math.sqrt(t * t + 1);
    const cs: readonly [number, number] = [c, t * c];
    rotateColumns(a, n, p, q, cs);
    rotateRows(a, n, p, q, cs);
    rotateColumns(v, n, p, q, cs);
  }}
  assert(a.length === n, 'the sweep keeps the matrix size');
  assert(v.length === n, 'the sweep keeps the vector size');
}

function pairOf(a: Grid, v: Grid, i: number): Eigen {
  assert(i >= 0 && i < a.length, 'the pair is a column of the matrix');
  assert(v.length === a.length, 'the vectors have the matrix size');
  const vec: number[] = [];
  let big = 0;
  for (const r of v) {
    const x = r[i] ?? 0;
    vec.push(x);
    if (Math.abs(x) > Math.abs(big)) {
      big = x;
    }
  }
  if (big < 0) {
    for (let k = 0; k < vec.length; k++) {
      vec[k] = -(vec[k] ?? 0);
    }
  }
  assert(vec.length === a.length, 'the vector has one entry for each row');
  assert(!Number.isNaN(big) || vec.some(Number.isNaN), 'a NaN pivot comes from a NaN entry');
  return { value: at(a, i, i), vector: vec };
}

const MAX_SWEEPS = 100;

function byValueDescending(x: Eigen, y: Eigen): number {
  assert(Number.isFinite(x.value) || Number.isNaN(x.value), 'an eigenvalue is a number');
  assert(Number.isFinite(y.value) || Number.isNaN(y.value), 'an eigenvalue is a number');
  const diff = y.value - x.value;
  assert(typeof diff === 'number', 'a difference is a number');
  return diff;
}

function eigenImpl(m: readonly (readonly number[])[]): Eigen[] {
  const n = m.length;
  assert(Number.isInteger(m.length), 'the matrix is a list of rows');
  const a: Grid = [];
  const v: Grid = [];
  for (let i = 0; i < n; i++) {
    const row = m[i] ?? [];
    assert(row.length === n, 'the matrix is square');
    a.push([...row]);
    const unit: number[] = [];
    for (let j = 0; j < n; j++) {
      unit.push(i === j ? 1 : 0);
    }
    v.push(unit);
  }
  for (let sweep = 0; sweep < MAX_SWEEPS; sweep++) {
    if (offDiagonal(a, n) < 1e-20) {break;}
    jacobiSweep(a, v, n);
  }
  const pairs: Eigen[] = [];
  for (let i = 0; i < n; i++) {
    pairs.push(pairOf(a, v, i));
  }
  pairs.sort(byValueDescending);
  assert(pairs.length === n, 'one eigenpair for each row');
  assert(v.length === n && a.length === n, 'the work matrices keep their size');
  assert(Number.isInteger(MAX_SWEEPS), 'the sweeps are capped');
  return pairs;
}

export interface Pca { mean: number[]; components: number[][]; explained: number[]; points: number[][] }

function cellOf(r: readonly number[], j: number): number {
  assert(Number.isInteger(j) && j >= 0, 'a column is a non-negative integer');
  assert(Number.isInteger(r.length), 'a row is a list');
  const cell = r[j] ?? 0;
  assert(typeof cell === 'number', 'a cell is a number');
  return cell;
}

function covarianceOf(x: readonly (readonly number[])[], size: number): number[][] {
  const n = x.length;
  assert(n > 1, 'a covariance needs two rows');
  assert(size > 0, 'a covariance needs a column');
  const cov: number[][] = [];
  for (let i = 0; i < size; i++) {
    const line: number[] = [];
    for (let j = 0; j < size; j++) {line.push(x.reduce((s, r) => s + cellOf(r, i) * cellOf(r, j), 0) / (n - 1));}
    cov.push(line);
  }
  assert(cov.length === size, 'one covariance row for each column');
  assert(x.length === n, 'the rows are kept');
  return cov;
}

function pcaImpl(rows: readonly (readonly number[])[]): Pca | null {
  const n = rows.length;
  const first = rows[0];
  const d = first?.length ?? 0;
  assert(Number.isInteger(rows.length), 'the points come as a list');
  assert(n >= 0 && d >= 0, 'sizes are not negative');
  if (!first || n < 3 || d < 2) {return null;}
  const mean = first.map((_, j) => rows.reduce((s, r) => s + cellOf(r, j), 0) / n);
  const x = rows.map((r) => r.map((v, j) => v - (mean[j] ?? 0)));
  const eig = eigenImpl(covarianceOf(x, mean.length));
  const sum = eig.reduce((s, e) => s + Math.max(0, e.value), 0);
  const total = sum === 0 || Number.isNaN(sum) ? 1 : sum;
  const pcs = eig.slice(0, 2);
  assert(pcs.length === 2, 'two components come out of two or more columns');
  assert(total > 0, 'the variance total divides');
  assert(mean.length === d, 'one mean for each column');
  assert(x.length === n, 'one centred row for each point');
  return { mean, components: pcs.map((e) => e.vector), explained: pcs.map((e) => Math.max(0, e.value) / total),
    points: x.map((r) => pcs.map((e) => r.reduce((s, v, j) => s + v * (e.vector[j] ?? 0), 0))) };
}

export interface Gap { axis_id: number; name: string; gap: number; mismatch: boolean }

function gapOf(a: Axis, scores: ScoreTable, ids: readonly number[]): Gap {
  assert(Number.isInteger(a.id), 'an axis has an integer id');
  assert(Number.isInteger(ids.length), 'ids come as a list');
  const vals = ids.map((id) => scores[id]?.[a.id]?.score).filter((v): v is number => v !== undefined);
  const gap = vals.length > 1 ? Math.max(...vals) - Math.min(...vals) : 0;
  assert(gap >= 0 || Number.isNaN(gap), 'a gap is not negative');
  assert(vals.length <= ids.length, 'a score comes from an id');
  return { axis_id: a.id, name: a.name, gap, mismatch: gap >= MISMATCH };
}

function gapsImpl(axes: readonly Axis[], scores: ScoreTable, ids: readonly number[]): Gap[] {
  assert(Number.isInteger(axes.length), 'axes come as a list');
  assert(Number.isInteger(ids.length), 'ids come as a list');
  const out = axes.map((a) => gapOf(a, scores, ids));
  assert(out.length === axes.length, 'one gap for each axis');
  return out;
}

export const practicalProblems = traced('stack.practicalProblems', practicalProblemsImpl);
export const ideaProblems = traced('stack.ideaProblems', ideaProblemsImpl);
export const eigen = traced('stack.eigen', eigenImpl);
export const pca = traced('stack.pca', pcaImpl);
export const gaps = traced('stack.gaps', gapsImpl);
