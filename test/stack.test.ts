import test from 'node:test';
import assert from 'node:assert';
import { eigen, pca, gaps, type Eigen, type Axis, type ScoreTable } from '../src/stack.ts';
import { checkCoverage, checkDocumentedSeeds, checkIdeaPriority } from './helpers/stack-problems.ts';
import { checkOldDatabase, checkSeedUpdate } from './helpers/stack-db.ts';
import { checkStackFlow } from './helpers/stack-e2e.ts';
import { at, defined, near } from './helpers/stack-util.ts';

function registerProblemTests(): void {
  void test('problem coverage excludes changed paradigms and preserves costs beside benefits', checkCoverage);
  void test('idea problem priority uses the greatest sourced share and ignores invalid IDs', checkIdeaPriority);
  void test('debt and reliability assessments follow only the documented seed definitions', checkDocumentedSeeds);
}

function checkEigen(): void {
  const [e1, e2] = eigen([[2, 1], [1, 2]]) as [Eigen, Eigen];
  near(e1.value, 3); near(e2.value, 1);
  near(at(e1.vector, 0), Math.SQRT1_2); near(at(e1.vector, 1), Math.SQRT1_2);
  near(Math.abs(at(e2.vector, 0)), Math.SQRT1_2); near(at(e2.vector, 0), -at(e2.vector, 1));
  const [d1, d2, d3] = eigen([[1, 0, 0], [0, 5, 0], [0, 0, 3]]) as [Eigen, Eigen, Eigen];
  assert.deepStrictEqual([d1.value, d2.value, d3.value], [5, 3, 1]);
  assert.deepStrictEqual(d1.vector, [0, 1, 0]);
}

function checkPca(): void {
  const map = defined(pca([[1, 2], [2, 4], [3, 6]]));
  assert.deepStrictEqual(map.mean, [2, 4]);
  const c = at(map.components, 0);
  near(at(c, 0), 1 / Math.sqrt(5)); near(at(c, 1), 2 / Math.sqrt(5));
  near(at(map.explained, 0), 1); near(at(map.explained, 1), 0);
  near(at(at(map.points, 0), 0), -Math.sqrt(5)); near(at(at(map.points, 1), 0), 0);
  near(at(at(map.points, 2), 0), Math.sqrt(5));
  for (const p of map.points) {near(at(p, 1), 0);}
  assert.strictEqual(pca([[1, 2], [3, 4]]), null);
}

function checkGaps(): void {
  const axes = [{ id: 1, name: 'state' }, { id: 2, name: 'binding' }] as Axis[];
  const scores = { 10: { 1: { score: 0 }, 2: { score: 4 } }, 11: { 1: { score: 9 }, 2: { score: 6 } }, 12: { 1: { score: 5 }, 2: { score: 5 } } } as unknown as ScoreTable;
  assert.deepStrictEqual(gaps(axes, scores, [10, 11, 12]), [
    { axis_id: 1, name: 'state', gap: 9, mismatch: true },
    { axis_id: 2, name: 'binding', gap: 2, mismatch: false }]);
}

function registerMathTests(): void {
  void test('eigen finds the eigenpairs of a known symmetric matrix, largest first', checkEigen);
  void test('pca of points on a line puts all the variance on the first component', checkPca);
  void test('gaps are the spread of the chosen paradigms on each axis, and a large gap is a mismatch', checkGaps);
}

function registerServerTests(): void {
  void test('an old database keeps its data and gains the stack tables, columns and start list', checkOldDatabase);
  void test('a seed update adds absent seeds and preserves user data on each start', checkSeedUpdate);
  void test('stack: axes, scores, map, point, owner edits, then a stack seed to a brief with the mismatch line', checkStackFlow);
}

registerProblemTests();
registerMathTests();
registerServerTests();
