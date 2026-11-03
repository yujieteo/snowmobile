import { MISMATCH, PRACTICAL_PROBLEMS, PROBLEM_LINKS, START, type Layer, type ProblemId, type ProblemItem, type ProblemLink } from './data.ts';
import { traced } from '../shared/trace.ts';

export interface Paradigm { id: number; layer: Layer; name: string; summary: string; url: string }
export interface Axis { id: number; name: string; low: string; high: string }
export interface Score { paradigm_id: number; axis_id: number; score: number; reason: string }
export type ScoreTable = Record<number, Record<number, Score>>;

export interface LinkedProblem extends ProblemLink { paradigm_id: number }
export interface Coverage { withoutReduction: ProblemId[]; unassessedParadigms: number; limit: string }

function practicalProblemsImpl(paradigms: readonly Paradigm[]) {
  const links: LinkedProblem[] = PROBLEM_LINKS.flatMap((link) => {
    const seed = START[link.layer].find((p) => p[0] === link.paradigm);
    if (!seed) return [];
    return paradigms.filter((p) => p.layer === link.layer && p.name === seed[0] && p.url === seed[2])
      .map((p) => ({ ...link, paradigm_id: p.id }));
  });
  const withoutReduction = PRACTICAL_PROBLEMS.items.filter((p) => !links.some((l) => l.problem_id === p.id && l.effect === 'reduces'));
  const coverage: Coverage = {
    withoutReduction: withoutReduction.map((p) => p.id),
    unassessedParadigms: paradigms.length - new Set(links.map((l) => l.paradigm_id)).size,
    limit: 'Links are source-based assessments of specific mechanisms, not measured effects on survey shares. No link means no assessment, not no benefit.',
  };
  return { ...PRACTICAL_PROBLEMS, links, coverage };
}

function ideaProblemsImpl(ids: unknown) {
  const problems: ProblemItem[] = PRACTICAL_PROBLEMS.items.filter((p) => Array.isArray(ids) && ids.includes(p.id));
  return { problem_ids: problems.map((p) => p.id), practical_problems: problems,
    problem_priority: Math.max(0, ...problems.map((p) => p.percent)) };
}

export interface Eigen { value: number; vector: number[] }

function eigenImpl(m: readonly (readonly number[])[]): Eigen[] {
  const n = m.length;
  const a = m.map((r) => [...r]);
  const v = a.map((_, i) => a.map((_, j) => (i === j ? 1 : 0)));
  const at = (g: number[][], r: number, c: number): number => g[r]?.[c] ?? 0;
  const put = (g: number[][], r: number, c: number, x: number): void => { const row = g[r]; if (row) row[c] = x; };
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += at(a, p, q) ** 2;
    if (off < 1e-20) break;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
      if (Math.abs(at(a, p, q)) < 1e-300) continue;
      const theta = (at(a, q, q) - at(a, p, p)) / (2 * at(a, p, q));
      const t = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < n; k++) {
        const kp = at(a, k, p), kq = at(a, k, q);
        put(a, k, p, c * kp - s * kq); put(a, k, q, s * kp + c * kq);
      }
      for (let k = 0; k < n; k++) {
        const pk = at(a, p, k), qk = at(a, q, k);
        put(a, p, k, c * pk - s * qk); put(a, q, k, s * pk + c * qk);
      }
      for (let k = 0; k < n; k++) {
        const kp = at(v, k, p), kq = at(v, k, q);
        put(v, k, p, c * kp - s * kq); put(v, k, q, s * kp + c * kq);
      }
    }
  }
  return a.map((_, i) => {
    const vec = v.map((r) => r[i] ?? 0);
    const big = vec.reduce((b, x) => (Math.abs(x) > Math.abs(b) ? x : b), 0);
    return { value: at(a, i, i), vector: big < 0 ? vec.map((x) => -x) : vec };
  }).sort((x, y) => y.value - x.value);
}

export interface Pca { mean: number[]; components: number[][]; explained: number[]; points: number[][] }

function pcaImpl(rows: readonly (readonly number[])[]): Pca | null {
  const n = rows.length;
  const first = rows[0];
  const d = first?.length || 0;
  if (!first || n < 3 || d < 2) return null;
  const cell = (r: readonly number[], j: number): number => r[j] ?? 0;
  const mean = first.map((_, j) => rows.reduce((s, r) => s + cell(r, j), 0) / n);
  const x = rows.map((r) => r.map((v, j) => v - (mean[j] ?? 0)));
  const cov = mean.map((_, i) => mean.map((_, j) => x.reduce((s, r) => s + cell(r, i) * cell(r, j), 0) / (n - 1)));
  const eig = eigenImpl(cov);
  const total = eig.reduce((s, e) => s + Math.max(0, e.value), 0) || 1;
  const pcs = eig.slice(0, 2);
  return { mean, components: pcs.map((e) => e.vector), explained: pcs.map((e) => Math.max(0, e.value) / total),
    points: x.map((r) => pcs.map((e) => r.reduce((s, v, j) => s + v * (e.vector[j] ?? 0), 0))) };
}

export interface Gap { axis_id: number; name: string; gap: number; mismatch: boolean }

function gapsImpl(axes: readonly Axis[], scores: ScoreTable, ids: readonly number[]): Gap[] {
  return axes.map((a) => {
    const vals = ids.map((id) => scores[id]?.[a.id]?.score).filter((v): v is number => v !== undefined);
    const gap = vals.length > 1 ? Math.max(...vals) - Math.min(...vals) : 0;
    return { axis_id: a.id, name: a.name, gap, mismatch: gap >= MISMATCH };
  });
}

export const practicalProblems = traced('stack.practicalProblems', practicalProblemsImpl);
export const ideaProblems = traced('stack.ideaProblems', ideaProblemsImpl);
export const eigen = traced('stack.eigen', eigenImpl);
export const pca = traced('stack.pca', pcaImpl);
export const gaps = traced('stack.gaps', gapsImpl);
