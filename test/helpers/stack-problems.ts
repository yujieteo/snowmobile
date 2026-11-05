import assert from 'node:assert';
import { practicalProblems as assess, ideaProblems } from '../../src/stack.ts';
import type { Layer } from '../../src/data.ts';
import fixture from '../fixtures/stack-problems.json' with { type: 'json' };
import { at } from './stack-util.ts';

// A seed paradigm of the tests has no summary, and a changed paradigm can have any layer name.
export interface Seed { id: number; layer: string; name: string; url: string }
export const practicalProblems = (ps: readonly Seed[]): ReturnType<typeof assess> =>
  assess(ps.map((p) => ({ summary: '', ...p, layer: p.layer as Layer })));
type Result = ReturnType<typeof assess>;

interface Spec {
  why: string; seeds: string[]; links: unknown[]; without: string[] | 'empty'; unassessed: boolean;
  urlAt?: [number, string][]; urlAll?: string; urlEach?: string[]; reasons?: [number, string][];
}
const seedTable: Record<string, Seed> = fixture.seeds;

function seedOf(name: string): Seed {
  const seed = seedTable[name];
  if (!seed) {throw new Error(`no seed ${name}`);}
  return seed;
}

function specs(): Spec[] {
  const raw: unknown = fixture.cases;
  return raw as Spec[];
}

function checkUrls(spec: Spec, result: Result): void {
  for (const [i, url] of spec.urlAt ?? []) {assert.strictEqual(at(result.links, i).source.url, url);}
  if (spec.urlAll !== undefined) {assert.ok(result.links.every((l) => l.source.url === spec.urlAll));}
  if (spec.urlEach) {assert.deepStrictEqual(result.links.map((l) => l.source.url), spec.urlEach);}
}

function checkSpec(spec: Spec): void {
  const result = practicalProblems(spec.seeds.map(seedOf));
  assert.deepStrictEqual(result.links.map((l) => [l.paradigm_id, l.problem_id, l.effect]), spec.links);
  const expected = spec.without === 'empty' ? practicalProblems([]).coverage.withoutReduction : spec.without;
  assert.deepStrictEqual(result.coverage.withoutReduction, expected);
  if (spec.unassessed) {assert.strictEqual(result.coverage.unassessedParadigms, 0);}
  checkUrls(spec, result);
  for (const [i, pattern] of spec.reasons ?? []) {assert.match(at(result.links, i).reason, new RegExp(pattern));}
}

// Reason: a changed user paradigm must not retain a seed assessment for debt or reliability.
function checkMutations(): void {
  const emptyProblemCount = practicalProblems([]).items.length;
  for (const name of fixture.mutate) {
    const original = seedOf(name);
    const changes = [{ name: 'User definition' }, { layer: original.layer === 'hardware' ? 'software' : 'hardware' },
      { url: 'https://example.com/user' }];
    for (const change of changes) {
      const result = practicalProblems([{ ...original, ...change }]);
      assert.strictEqual(result.links.length, 0);
      assert.strictEqual(result.coverage.withoutReduction.length, emptyProblemCount);
      assert.strictEqual(result.coverage.unassessedParadigms, 1);
    }
  }
}

export function checkDocumentedSeeds(): void {
  for (const spec of specs()) {checkSpec(spec);}
  checkMutations();
}

function coverageService(): Result {
  const service = practicalProblems([seedOf('microservices')]);
  assert.deepStrictEqual(service.links.map((l) => [l.problem_id, l.effect]), [
    ['technical-debt', 'reduces'], ['unreliable-tools', 'reduces'], ['deployment-complexity', 'worsens'],
  ]);
  assert.deepStrictEqual(service.coverage.withoutReduction, ['build-complexity', 'deployment-complexity']);
  assert.match(at(service.links, 0).reason, /suitable service boundaries.*does not address all technical debt/);
  assert.match(at(service.links, 1).reason, /requires fault controls.*does not prove whole-system reliability/);
  return service;
}

function coveragePackages(): void {
  const nix = seedOf('nix');
  const both = practicalProblems([seedOf('microservices'), nix]);
  assert.deepStrictEqual(both.coverage.withoutReduction, []);
  assert.strictEqual(both.coverage.unassessedParadigms, 0);
  // Reason: atomic package updates must not imply correct application behavior or permanent rollback access.
  const packages = practicalProblems([nix]);
  assert.deepStrictEqual(packages.coverage.withoutReduction, ['technical-debt']);
  const reliability = packages.links.filter((l) => l.problem_id === 'unreliable-tools');
  assert.strictEqual(reliability.length, 1);
  const link = at(reliability, 0);
  assert.strictEqual(link.effect, 'reduces');
  assert.strictEqual(link.paradigm_id, nix.id);
  assert.strictEqual(link.source.url, 'https://nix.dev/manual/nix/2.35/introduction.html#atomic-upgrades-and-rollbacks');
  assert.match(link.reason, /partial package updates.*requires retained versions.*does not prove application correctness or whole-system reliability/);
}

function coverageChanged(service: Result): void {
  const microservices = seedOf('microservices');
  const nix = seedOf('nix');
  for (const change of [{ name: 'My paradigm' }, { layer: 'os' }, { url: 'https://example.com/my-definition' }]) {
    const changed = practicalProblems([microservices, { ...nix, ...change }]);
    assert.deepStrictEqual(changed.links, service.links);
    assert.strictEqual(changed.coverage.unassessedParadigms, 1);
    assert.deepStrictEqual(changed.coverage.withoutReduction, service.coverage.withoutReduction);
    assert.strictEqual(practicalProblems([{ ...microservices, ...change }]).links.length, 0);
  }
}

// Reason: a stale link can assign a source assessment to a different user paradigm.
export function checkCoverage(): void {
  const empty = practicalProblems([]);
  assert.strictEqual(empty.links.length, 0);
  assert.strictEqual(empty.coverage.withoutReduction.length, empty.items.length);
  const service = coverageService();
  coveragePackages();
  coverageChanged(service);
}

// Reason: invalid IDs and duplicate IDs must not inflate idea coverage or priority.
export function checkIdeaPriority(): void {
  for (const ids of [null, undefined, 'technical-debt', [], ['unknown']]) {
    assert.deepStrictEqual(ideaProblems(ids), { problem_ids: [], practical_problems: [], problem_priority: 0 });
  }
  const result = ideaProblems(['unreliable-tools', 'technical-debt', 'technical-debt', 'unknown']);
  assert.deepStrictEqual(result.problem_ids, ['technical-debt', 'unreliable-tools']);
  assert.strictEqual(result.problem_priority, 62.4);
}
