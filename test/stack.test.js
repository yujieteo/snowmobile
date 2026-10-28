const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { start, eigen, pca, gaps, practicalProblems, ideaProblems } = require('../snowmobile.js');

// Reason: a stale link can assign a source assessment to a different user paradigm.
test('problem coverage excludes changed paradigms and preserves costs beside benefits', () => {
  const microservices = { id: 71, layer: 'software', name: 'Microservices', url: 'https://en.wikipedia.org/wiki/Microservices' };
  const nix = { id: 92, layer: 'software', name: 'Functional package management', url: 'https://nix.dev/manual/nix/2.35/introduction.html' };
  const empty = practicalProblems([]);
  assert.strictEqual(empty.links.length, 0);
  assert.strictEqual(empty.coverage.withoutReduction.length, empty.items.length);
  const service = practicalProblems([microservices]);
  assert.deepStrictEqual(service.links.map((l) => [l.problem_id, l.effect]), [
    ['technical-debt', 'reduces'], ['unreliable-tools', 'reduces'], ['deployment-complexity', 'worsens'],
  ]);
  assert.deepStrictEqual(service.coverage.withoutReduction, ['build-complexity', 'deployment-complexity']);
  assert.match(service.links[0].reason, /suitable service boundaries.*does not address all technical debt/);
  assert.match(service.links[1].reason, /requires fault controls.*does not prove whole-system reliability/);
  const both = practicalProblems([microservices, nix]);
  assert.deepStrictEqual(both.coverage.withoutReduction, []);
  assert.strictEqual(both.coverage.unassessedParadigms, 0);
  // Reason: atomic package updates must not imply correct application behavior or permanent rollback access.
  const packages = practicalProblems([nix]);
  assert.deepStrictEqual(packages.coverage.withoutReduction, ['technical-debt']);
  const reliability = packages.links.filter((l) => l.problem_id === 'unreliable-tools');
  assert.strictEqual(reliability.length, 1);
  assert.strictEqual(reliability[0].effect, 'reduces');
  assert.strictEqual(reliability[0].paradigm_id, nix.id);
  assert.strictEqual(reliability[0].source.url, 'https://nix.dev/manual/nix/2.35/introduction.html#atomic-upgrades-and-rollbacks');
  assert.match(reliability[0].reason, /partial package updates.*requires retained versions.*does not prove application correctness or whole-system reliability/);
  for (const change of [{ name: 'My paradigm' }, { layer: 'os' }, { url: 'https://example.com/my-definition' }]) {
    const changed = practicalProblems([microservices, { ...nix, ...change }]);
    assert.deepStrictEqual(changed.links, service.links);
    assert.strictEqual(changed.coverage.unassessedParadigms, 1);
    assert.deepStrictEqual(changed.coverage.withoutReduction, service.coverage.withoutReduction);
    assert.strictEqual(practicalProblems([{ ...microservices, ...change }]).links.length, 0);
  }
});

// Reason: invalid IDs and duplicate IDs must not inflate idea coverage or priority.
test('idea problem priority uses the greatest sourced share and ignores invalid IDs', () => {
  for (const ids of [null, undefined, 'technical-debt', [], ['unknown']]) {
    assert.deepStrictEqual(ideaProblems(ids), { problem_ids: [], practical_problems: [], problem_priority: 0 });
  }
  const result = ideaProblems(['unreliable-tools', 'technical-debt', 'technical-debt', 'unknown']);
  assert.deepStrictEqual(result.problem_ids, ['technical-debt', 'unreliable-tools']);
  assert.strictEqual(result.problem_priority, 62.4);
  assert.strictEqual(result.practical_problems.length, 2);
});

// Reason: a changed user paradigm must not retain a seed assessment for debt or reliability.
test('debt and reliability assessments follow only the documented seed definitions', () => {
  const ownership = { id: 95, layer: 'language', name: 'Ownership types', url: 'https://doc.rust-lang.org/book/ch04-01-what-is-ownership.html' };
  const injection = { id: 93, layer: 'software', name: 'Dependency injection', url: 'https://martinfowler.com/articles/injection.html' };
  const actor = { id: 94, layer: 'language', name: 'Actor model', url: 'https://en.wikipedia.org/wiki/Actor_model' };
  const cqrs = { id: 96, layer: 'software', name: 'CQRS', url: 'https://martinfowler.com/bliki/CQRS.html' };
  const embedded = { id: 97, layer: 'software', name: 'Embedded database', url: 'https://www.sqlite.org/serverless.html' };
  const microkernel = { id: 98, layer: 'os', name: 'Microkernel', url: 'https://en.wikipedia.org/wiki/Microkernel' };
  const events = { id: 99, layer: 'software', name: 'Event sourcing', url: 'https://martinfowler.com/eaaDev/EventSourcing.html' };
  const localFirst = { id: 100, layer: 'software', name: 'Local-first software', url: 'https://www.inkandswitch.com/local-first/' };
  const serverless = { id: 101, layer: 'software', name: 'Serverless', url: 'https://en.wikipedia.org/wiki/Serverless_computing' };
  const filters = { id: 102, layer: 'software', name: 'Pipes and filters', url: 'https://en.wikipedia.org/wiki/Pipeline_(software)' };
  const eventDriven = { id: 103, layer: 'software', name: 'Event-driven architecture', url: 'https://en.wikipedia.org/wiki/Event-driven_architecture' };
  const peers = { id: 104, layer: 'software', name: 'Peer-to-peer', url: 'https://docs.ipfs.tech/concepts/how-ipfs-works/' };
  const functional = { id: 106, layer: 'language', name: 'Functional programming', url: 'https://en.wikipedia.org/wiki/Functional_programming' };
  const structures = { id: 107, layer: 'software', name: 'Data structure server', url: 'https://redis.io/docs/latest/develop/data-types/' };
  const separation = { id: 108, layer: 'os', name: 'Separation kernel', url: 'https://muen.sk/' };
  const effects = { id: 109, layer: 'language', name: 'Algebraic effects', url: 'https://koka-lang.github.io/koka/doc/book.html' };
  const constraint = { id: 111, layer: 'language', name: 'Constraint programming', url: 'https://docs.minizinc.dev/en/stable/modelling.html' };
  const unikernel = { id: 112, layer: 'os', name: 'Unikernel', url: 'https://en.wikipedia.org/wiki/Unikernel' };
  const capabilities = { id: 113, layer: 'os', name: 'Capability-based OS', url: 'https://en.wikipedia.org/wiki/Capability-based_security' };
  const hypervisor = { id: 114, layer: 'os', name: 'Hypervisor', url: 'https://en.wikipedia.org/wiki/Hypervisor' };
  const generators = { id: 115, layer: 'hardware', name: 'Hardware generators', url: 'https://www2.eecs.berkeley.edu/Pubs/TechRpts/2016/EECS-2016-17.html' };
  const distributed = { id: 116, layer: 'os', name: 'Distributed OS', url: 'https://9p.io/sys/doc/9.html' };
  const dataflow = { id: 118, layer: 'language', name: 'Dataflow programming', url: 'https://en.wikipedia.org/wiki/Dataflow_programming' };
  const objects = { id: 119, layer: 'language', name: 'Object-oriented programming', url: 'https://en.wikipedia.org/wiki/Object-oriented_programming' };
  const logic = { id: 120, layer: 'language', name: 'Logic programming', url: 'https://en.wikipedia.org/wiki/Logic_programming' };
  const concatenative = { id: 122, layer: 'language', name: 'Concatenative programming', url: 'https://concatenative.org/wiki/view/Concatenative%20language' };
  const reactive = { id: 121, layer: 'language', name: 'Functional reactive programming', url: 'https://en.wikipedia.org/wiki/Functional_reactive_programming' };
  const clientServer = { id: 117, layer: 'software', name: 'Client-server', url: 'https://en.wikipedia.org/wiki/Client%E2%80%93server_model' };
  const store = { id: 110, layer: 'os', name: 'Single-level store', url: 'https://www.usenix.org/legacy/event/usenix02/shapiro.html' };
  const crdt = { id: 105, layer: 'software', name: 'Conflict-free replicated data types', url: 'https://crdt.tech/' };
  const assessed = practicalProblems([injection, actor]);
  assert.deepStrictEqual(assessed.coverage.withoutReduction, ['build-complexity', 'deployment-complexity']);
  assert.strictEqual(assessed.coverage.unassessedParadigms, 0);
  assert.deepStrictEqual(assessed.links.map((l) => [l.paradigm_id, l.problem_id, l.effect]),
    [[93, 'technical-debt', 'reduces'], [94, 'unreliable-tools', 'reduces']]);
  assert.match(assessed.links[0].reason, /Assessment:.*does not address all technical debt/);
  assert.match(assessed.links[1].reason, /In Erlang\/OTP.*Actors alone provide no supervisor/);
  const memory = practicalProblems([ownership]);
  assert.deepStrictEqual(memory.links.map((l) => [l.paradigm_id, l.problem_id, l.effect]),
    [[95, 'unreliable-tools', 'reduces']]);
  assert.deepStrictEqual(memory.coverage.withoutReduction, ['technical-debt', 'build-complexity', 'deployment-complexity']);
  assert.strictEqual(memory.coverage.unassessedParadigms, 0);
  assert.match(memory.links[0].reason, /In Rust.*double-free.*does not prove whole-system reliability/);
  // Reason: a documented cost must not count as a reduction in technical debt.
  const cost = practicalProblems([cqrs]);
  assert.deepStrictEqual(cost.links.map((l) => [l.paradigm_id, l.problem_id, l.effect]),
    [[96, 'technical-debt', 'worsens']]);
  assert.deepStrictEqual(cost.coverage.withoutReduction, practicalProblems([]).coverage.withoutReduction);
  assert.strictEqual(cost.coverage.unassessedParadigms, 0);
  assert.match(cost.links[0].reason, /when CQRS does not fit the domain.*Assessment:.*does not apply to every CQRS use/);
  // Reason: the deployment benefit must not hide the loss of a fault boundary.
  const local = practicalProblems([embedded]);
  assert.deepStrictEqual(local.links.map((l) => [l.paradigm_id, l.problem_id, l.effect]),
    [[97, 'deployment-complexity', 'reduces'], [97, 'unreliable-tools', 'worsens']]);
  assert.deepStrictEqual(local.coverage.withoutReduction, ['technical-debt', 'build-complexity', 'unreliable-tools']);
  assert.strictEqual(local.coverage.unassessedParadigms, 0);
  assert.match(local.links[0].reason, /no separate database server.*Other application deployment costs remain/);
  assert.match(local.links[1].reason, /stray pointers.*does not prove more faults in every application/);
  // Reason: driver isolation must reach coverage without a claim about every microkernel.
  const isolated = practicalProblems([microkernel]);
  assert.deepStrictEqual(isolated.links.map((l) => [l.paradigm_id, l.problem_id, l.effect]),
    [[98, 'unreliable-tools', 'reduces']]);
  assert.deepStrictEqual(isolated.coverage.withoutReduction, ['technical-debt', 'build-complexity', 'deployment-complexity']);
  assert.strictEqual(isolated.coverage.unassessedParadigms, 0);
  assert.match(isolated.links[0].reason, /MINIX 3.*contain driver memory faults.*does not prove whole-system reliability or apply to every microkernel/);
  // Reason: a recovery benefit must not hide faults from repeat external updates.
  const replay = practicalProblems([events]);
  assert.deepStrictEqual(replay.links.map((l) => [l.paradigm_id, l.problem_id, l.effect]),
    [[99, 'unreliable-tools', 'reduces'], [99, 'unreliable-tools', 'worsens']]);
  assert.deepStrictEqual(replay.coverage.withoutReduction, ['technical-debt', 'build-complexity', 'deployment-complexity']);
  assert.strictEqual(replay.coverage.unassessedParadigms, 0);
  assert.match(replay.links[0].reason, /retained event log.*does not prevent every fault/);
  assert.match(replay.links[1].reason, /unless gateways suppress repeat updates.*depends on external effects and replay controls/);
  // Reason: offline access must not hide resource costs from retained history.
  const offline = practicalProblems([localFirst]);
  assert.deepStrictEqual(offline.links.map((l) => [l.paradigm_id, l.problem_id, l.effect]),
    [[100, 'unreliable-tools', 'reduces'], [100, 'unreliable-tools', 'worsens']]);
  assert.deepStrictEqual(offline.coverage.withoutReduction, ['technical-debt', 'build-complexity', 'deployment-complexity']);
  assert.strictEqual(offline.coverage.unassessedParadigms, 0);
  assert.match(offline.links[0].reason, /network outage.*does not protect against device loss or local faults/);
  assert.match(offline.links[1].reason, /CRDT change history.*depends on the implementation and workload/);
  // Reason: server management removal must not hide request failures at concurrency limits.
  const managed = practicalProblems([serverless]);
  assert.deepStrictEqual(managed.links.map((l) => [l.paradigm_id, l.problem_id, l.effect]),
    [[101, 'deployment-complexity', 'reduces'], [101, 'unreliable-tools', 'worsens']]);
  assert.deepStrictEqual(managed.coverage.withoutReduction, ['technical-debt', 'build-complexity', 'unreliable-tools']);
  assert.strictEqual(managed.coverage.unassessedParadigms, 0);
  assert.match(managed.links[0].reason, /removes server setup.*configuration and service integration costs remain/);
  assert.match(managed.links[1].reason, /reject requests.*depends on demand, quotas and concurrency controls/);
  // Reason: filter reuse must not hide faults from repeat state updates.
  const pipeline = practicalProblems([filters]);
  assert.deepStrictEqual(pipeline.links.map((l) => [l.paradigm_id, l.problem_id, l.effect]),
    [[102, 'technical-debt', 'reduces'], [102, 'unreliable-tools', 'worsens']]);
  assert.deepStrictEqual(pipeline.coverage.withoutReduction, ['build-complexity', 'deployment-complexity', 'unreliable-tools']);
  assert.strictEqual(pipeline.coverage.unassessedParadigms, 0);
  assert.match(pipeline.links[0].reason, /duplicate pipeline logic.*compatible data schemas.*does not address all technical debt/);
  assert.match(pipeline.links[1].reason, /retries after filter faults.*depends on retry controls/);
  // Reason: fewer dependencies must not hide event loss after a component crash.
  const decoupled = practicalProblems([eventDriven]);
  assert.deepStrictEqual(decoupled.links.map((l) => [l.paradigm_id, l.problem_id, l.effect]),
    [[103, 'technical-debt', 'reduces'], [103, 'unreliable-tools', 'worsens']]);
  assert.deepStrictEqual(decoupled.coverage.withoutReduction, ['build-complexity', 'deployment-complexity', 'unreliable-tools']);
  assert.strictEqual(decoupled.coverage.unassessedParadigms, 0);
  assert.match(decoupled.links[0].reason, /without changes to producers.*Event contracts still need maintenance.*does not address all technical debt/);
  assert.match(decoupled.links[1].reason, /crash before event transfer.*depends on durable event storage and receipt controls/);
  // Reason: remote copies must not hide data loss from temporary peer caches.
  const replicated = practicalProblems([peers]);
  assert.deepStrictEqual(replicated.links.map((l) => [l.paradigm_id, l.problem_id, l.effect]),
    [[104, 'unreliable-tools', 'reduces'], [104, 'unreliable-tools', 'worsens']]);
  assert.deepStrictEqual(replicated.coverage.withoutReduction, ['technical-debt', 'build-complexity', 'deployment-complexity']);
  assert.strictEqual(replicated.coverage.unassessedParadigms, 0);
  assert.match(replicated.links[0].reason, /reachable peers.*requires explicit data retention.*does not prove whole-system reliability/);
  assert.match(replicated.links[1].reason, /temporary peer caches.*depends on retained copies/);
  // Reason: convergence must not imply complete application correctness or device-loss protection.
  const merged = practicalProblems([crdt]);
  assert.deepStrictEqual(merged.links.map((l) => [l.paradigm_id, l.problem_id, l.effect]),
    [[105, 'technical-debt', 'reduces'], [105, 'unreliable-tools', 'reduces']]);
  assert.deepStrictEqual(merged.coverage.withoutReduction, ['build-complexity', 'deployment-complexity']);
  assert.strictEqual(merged.coverage.unassessedParadigms, 0);
  assert.match(merged.links[0].reason, /application-specific merge code.*requires suitable data types.*does not address all technical debt/);
  assert.match(merged.links[1].reason, /network outages.*does not prove application correctness or protect against device loss/);
  // Reason: pure functions must not imply fault-free effects or complete debt removal.
  const pure = practicalProblems([functional]);
  assert.deepStrictEqual(pure.links.map((l) => [l.paradigm_id, l.problem_id, l.effect]),
    [[106, 'technical-debt', 'reduces'], [106, 'unreliable-tools', 'reduces']]);
  assert.deepStrictEqual(pure.coverage.withoutReduction, ['build-complexity', 'deployment-complexity']);
  assert.ok(pure.links.every((l) => l.source.url === 'https://clojure.org/about/state#_functional_programming'));
  assert.match(pure.links[0].reason, /local function behavior.*does not address all technical debt/);
  assert.match(pure.links[1].reason, /no mutable state.*Effects and shared state still need controls.*does not prove whole-system reliability/);
  // Reason: recovery evidence must not hide data loss between snapshots.
  const persisted = practicalProblems([structures]);
  assert.deepStrictEqual(persisted.links.map((l) => [l.paradigm_id, l.problem_id, l.effect]),
    [[107, 'unreliable-tools', 'reduces'], [107, 'unreliable-tools', 'worsens']]);
  assert.deepStrictEqual(persisted.coverage.withoutReduction, ['technical-debt', 'build-complexity', 'deployment-complexity']);
  assert.ok(persisted.links.every((l) => l.source.url === 'https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/'));
  assert.match(persisted.links[0].reason, /replay.*requires intact persistence files.*does not prove whole-system reliability/);
  assert.match(persisted.links[1].reason, /lose recent writes.*depends on the persistence policy/);
  // Reason: component isolation must not imply complete system reliability.
  const partitioned = practicalProblems([separation]);
  assert.deepStrictEqual(partitioned.links.map((l) => [l.paradigm_id, l.problem_id, l.effect]),
    [[108, 'unreliable-tools', 'reduces']]);
  assert.deepStrictEqual(partitioned.coverage.withoutReduction, ['technical-debt', 'build-complexity', 'deployment-complexity']);
  assert.match(partitioned.links[0].reason, /Muen.*correct isolation policy.*does not prove whole-system reliability or apply to every separation kernel/);
  // Reason: typed handlers must not imply correct handler behavior or complete debt removal.
  const handled = practicalProblems([effects]);
  assert.deepStrictEqual(handled.links.map((l) => [l.paradigm_id, l.problem_id, l.effect]),
    [[109, 'technical-debt', 'reduces'], [109, 'unreliable-tools', 'reduces']]);
  assert.deepStrictEqual(handled.coverage.withoutReduction, ['build-complexity', 'deployment-complexity']);
  assert.match(handled.links[0].reason, /suitable handler interfaces.*does not address all technical debt/);
  assert.match(handled.links[1].reason, /absent effect handlers before execution.*Correct handler behavior still needs checks.*does not prove whole-system reliability/);
  // Reason: consistent durable state must not imply correct application transactions or complete debt removal.
  const durable = practicalProblems([store]);
  assert.deepStrictEqual(durable.links.map((l) => [l.paradigm_id, l.problem_id, l.effect]),
    [[110, 'technical-debt', 'reduces'], [110, 'unreliable-tools', 'reduces']]);
  assert.deepStrictEqual(durable.coverage.withoutReduction, ['build-complexity', 'deployment-complexity']);
  assert.ok(durable.links.every((l) => l.source.url === store.url));
  assert.match(durable.links[0].reason, /custom code at the storage boundary.*does not address all technical debt/);
  assert.match(durable.links[1].reason, /inconsistent stored state after a crash.*Correct application transactions remain necessary.*does not prove whole-system reliability/);
  // Reason: model reuse must not imply correct constraints or complete debt removal.
  const reusable = practicalProblems([constraint]);
  assert.deepStrictEqual(reusable.links.map((l) => [l.paradigm_id, l.problem_id, l.effect]),
    [[111, 'technical-debt', 'reduces']]);
  assert.deepStrictEqual(reusable.coverage.withoutReduction, ['build-complexity', 'deployment-complexity', 'unreliable-tools']);
  assert.match(reusable.links[0].reason, /duplicate constraint code.*requires a reusable model.*does not address all technical debt or prove that the constraints match the real problem/);
  // Reason: less configuration work must not hide the cost of static configuration changes.
  const appliance = practicalProblems([unikernel]);
  assert.deepStrictEqual(appliance.links.map((l) => [l.paradigm_id, l.problem_id, l.effect]),
    [[112, 'deployment-complexity', 'reduces'], [112, 'deployment-complexity', 'worsens']]);
  assert.deepStrictEqual(appliance.coverage.withoutReduction, ['technical-debt', 'build-complexity', 'unreliable-tools']);
  assert.ok(appliance.links.every((l) => l.source.url === 'https://dave.recoil.org/papers/final/asplos2013.pdf'));
  assert.match(appliance.links[0].reason, /requires libraries that fit the application.*does not remove all deployment costs or apply to every unikernel/);
  assert.match(appliance.links[1].reason, /new compilation.*depends on which parameters are static/);
  // Reason: resource access controls must not imply correct authorized code or complete system reliability.
  const restricted = practicalProblems([capabilities]);
  assert.deepStrictEqual(restricted.links.map((l) => [l.paradigm_id, l.problem_id, l.effect]),
    [[113, 'unreliable-tools', 'reduces']]);
  assert.deepStrictEqual(restricted.coverage.withoutReduction, ['technical-debt', 'build-complexity', 'deployment-complexity']);
  assert.strictEqual(restricted.links[0].source.url, 'https://docs.sel4.systems/Tutorials/capabilities.html');
  assert.match(restricted.links[0].reason, /correct capability allocation.*Authorized code can still cause faults.*does not prove whole-system reliability or apply to every capability-based OS/);
  // Reason: driver isolation must not imply complete system reliability for every hypervisor.
  const virtual = practicalProblems([hypervisor]);
  assert.deepStrictEqual(virtual.links.map((l) => [l.paradigm_id, l.problem_id, l.effect]),
    [[114, 'unreliable-tools', 'reduces']]);
  assert.deepStrictEqual(virtual.coverage.withoutReduction, ['technical-debt', 'build-complexity', 'deployment-complexity']);
  assert.strictEqual(virtual.links[0].source.url, 'https://xenproject.org/projects/hypervisor/');
  assert.match(virtual.links[0].reason, /requires driver isolation.*does not prove whole-system reliability or apply to every hypervisor/);
  // Reason: circuit reuse must not imply complete debt removal or correct generated circuits.
  const generated = practicalProblems([generators]);
  assert.deepStrictEqual(generated.links.map((l) => [l.paradigm_id, l.problem_id, l.effect]),
    [[115, 'technical-debt', 'reduces']]);
  assert.deepStrictEqual(generated.coverage.withoutReduction, ['build-complexity', 'deployment-complexity', 'unreliable-tools']);
  assert.strictEqual(generated.coverage.unassessedParadigms, 0);
  assert.strictEqual(generated.links[0].source.url, generators.url);
  assert.match(generated.links[0].reason, /duplicate circuit description code.*requires compatible generator interfaces.*still need validation.*does not address all technical debt or apply to every hardware generator/);
  // Reason: uniform resource access must not imply complete debt removal for every distributed OS.
  const uniform = practicalProblems([distributed]);
  assert.deepStrictEqual(uniform.links.map((l) => [l.paradigm_id, l.problem_id, l.effect]),
    [[116, 'technical-debt', 'reduces']]);
  assert.deepStrictEqual(uniform.coverage.withoutReduction, ['build-complexity', 'deployment-complexity', 'unreliable-tools']);
  assert.strictEqual(uniform.coverage.unassessedParadigms, 0);
  assert.strictEqual(uniform.links[0].source.url, distributed.url);
  assert.match(uniform.links[0].reason, /custom resource access code.*requires services that expose compatible file interfaces.*does not address all technical debt or apply to every distributed OS/);
  // Reason: database isolation must not hide deployment costs or imply whole-system reliability.
  const databaseServer = practicalProblems([clientServer]);
  assert.deepStrictEqual(databaseServer.links.map((l) => [l.paradigm_id, l.problem_id, l.effect]),
    [[117, 'unreliable-tools', 'reduces'], [117, 'deployment-complexity', 'worsens']]);
  assert.deepStrictEqual(databaseServer.coverage.withoutReduction, ['technical-debt', 'build-complexity', 'deployment-complexity']);
  assert.strictEqual(databaseServer.coverage.unassessedParadigms, 0);
  assert.ok(databaseServer.links.every((l) => l.source.url === 'https://www.sqlite.org/serverless.html'));
  assert.match(databaseServer.links[0].reason, /requires a separate server process.*Authorized requests can still cause faults.*does not prove whole-system reliability or apply to every client-server system/);
  assert.match(databaseServer.links[1].reason, /self-managed database server.*managed service can transfer server administration.*does not apply to every client-server system/);
  // Reason: reusable transforms must not hide retry risks or imply complete debt removal.
  const graph = practicalProblems([dataflow]);
  assert.deepStrictEqual(graph.links.map((l) => [l.paradigm_id, l.problem_id, l.effect]),
    [[118, 'technical-debt', 'reduces'], [118, 'unreliable-tools', 'worsens']]);
  assert.deepStrictEqual(graph.coverage.withoutReduction, ['build-complexity', 'deployment-complexity', 'unreliable-tools']);
  assert.strictEqual(graph.coverage.unassessedParadigms, 0);
  assert.deepStrictEqual(graph.links.map((l) => l.source.url), [
    'https://beam.apache.org/documentation/programming-guide/#composite-transforms',
    'https://beam.apache.org/documentation/programming-guide/#idempotence']);
  assert.match(graph.links[0].reason, /duplicate pipeline code.*requires compatible transform interfaces.*does not address all technical debt or apply to every dataflow system/);
  assert.match(graph.links[1].reason, /repeat external updates.*without idempotent operations.*depends on the runner and external effect controls.*does not apply to every dataflow system/);
  // Reason: encapsulation must not imply complete debt removal for every object-oriented design.
  const encapsulated = practicalProblems([objects]);
  assert.deepStrictEqual(encapsulated.links.map((l) => [l.paradigm_id, l.problem_id, l.effect]),
    [[119, 'technical-debt', 'reduces']]);
  assert.deepStrictEqual(encapsulated.coverage.withoutReduction, ['build-complexity', 'deployment-complexity', 'unreliable-tools']);
  assert.strictEqual(encapsulated.links[0].source.url, 'https://docs.oracle.com/javase/tutorial/java/concepts/object.html');
  assert.match(encapsulated.links[0].reason, /dependencies on internal implementation details.*requires stable method contracts and encapsulated state.*does not address all technical debt or apply to every object-oriented design/);
  // Reason: query termination benefits must not hide stale answers or imply whole-system reliability.
  const queries = practicalProblems([logic]);
  assert.deepStrictEqual(queries.links.map((l) => [l.paradigm_id, l.problem_id, l.effect]),
    [[120, 'unreliable-tools', 'reduces'], [120, 'unreliable-tools', 'worsens']]);
  assert.deepStrictEqual(queries.coverage.withoutReduction, ['technical-debt', 'build-complexity', 'deployment-complexity']);
  assert.deepStrictEqual(queries.links.map((l) => l.source.url), [
    'https://www.swi-prolog.org/pldoc/man?section=tabling-non-termination',
    'https://www.swi-prolog.org/pldoc/man?section=tabling']);
  assert.match(queries.links[0].reason, /finite graph query.*requires suitable tabled predicates.*does not guarantee termination for every query or whole-system reliability/);
  assert.match(queries.links[1].reason, /stale answers.*after facts change.*explicit table invalidation or suitable incremental tables.*does not apply to every logic program/);
  // Reason: event combinators must not imply complete debt removal or safe external effects.
  const coordinated = practicalProblems([reactive]);
  assert.deepStrictEqual(coordinated.links.map((l) => [l.paradigm_id, l.problem_id, l.effect]),
    [[121, 'technical-debt', 'reduces']]);
  assert.deepStrictEqual(coordinated.coverage.withoutReduction, ['build-complexity', 'deployment-complexity', 'unreliable-tools']);
  assert.strictEqual(coordinated.links[0].source.url, 'https://hackage-content.haskell.org/package/reactive-banana-1.3.2.0/docs/Reactive-Banana-Combinators.html');
  assert.match(coordinated.links[0].reason, /custom event coordination code.*requires event and value models that fit the application.*External effects still need controls.*does not address all technical debt or apply to every functional reactive program/);
  // Reason: static stack checks must not imply safe dynamic code or whole-system reliability.
  const checkedStack = practicalProblems([concatenative]);
  assert.deepStrictEqual(checkedStack.links.map((l) => [l.paradigm_id, l.problem_id, l.effect]),
    [[122, 'unreliable-tools', 'reduces']]);
  assert.deepStrictEqual(checkedStack.coverage.withoutReduction, ['technical-debt', 'build-complexity', 'deployment-complexity']);
  assert.strictEqual(checkedStack.coverage.unassessedParadigms, 0);
  assert.strictEqual(checkedStack.links[0].source.url, 'https://docs.factorcode.org/content/article-inference.html');
  assert.match(checkedStack.links[0].reason, /Factor.*invalid stack effects.*requires code that passes the static stack checker.*Dynamic code still needs controls.*does not prove whole-system reliability or apply to every concatenative language/);
  const emptyProblemCount = practicalProblems([]).items.length;
  for (const original of [injection, actor, ownership, cqrs, embedded, microkernel, events, localFirst, serverless, filters, eventDriven, peers, crdt, functional, structures, separation, effects, store, constraint, unikernel, capabilities, hypervisor, generators, distributed, clientServer, dataflow, objects, logic, reactive, concatenative]) {
    for (const change of [{ name: 'User definition' }, { layer: original.layer === 'hardware' ? 'software' : 'hardware' }, { url: 'https://example.com/user' }]) {
      const result = practicalProblems([{ ...original, ...change }]);
      assert.strictEqual(result.links.length, 0);
      assert.strictEqual(result.coverage.withoutReduction.length, emptyProblemCount);
      assert.strictEqual(result.coverage.unassessedParadigms, 1);
    }
  }
});

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} is not ${b}`);

test('eigen finds the eigenpairs of a known symmetric matrix, largest first', () => {
  const [e1, e2] = eigen([[2, 1], [1, 2]]);
  near(e1.value, 3); near(e2.value, 1);
  near(e1.vector[0], Math.SQRT1_2); near(e1.vector[1], Math.SQRT1_2);
  near(Math.abs(e2.vector[0]), Math.SQRT1_2); near(e2.vector[0], -e2.vector[1]);
  const [d1, d2, d3] = eigen([[1, 0, 0], [0, 5, 0], [0, 0, 3]]);
  assert.deepStrictEqual([d1.value, d2.value, d3.value], [5, 3, 1]);
  assert.deepStrictEqual(d1.vector, [0, 1, 0]);
});

test('pca of points on a line puts all the variance on the first component', () => {
  const map = pca([[1, 2], [2, 4], [3, 6]]);
  assert.deepStrictEqual(map.mean, [2, 4]);
  near(map.components[0][0], 1 / Math.sqrt(5)); near(map.components[0][1], 2 / Math.sqrt(5));
  near(map.explained[0], 1); near(map.explained[1], 0);
  near(map.points[0][0], -Math.sqrt(5)); near(map.points[1][0], 0); near(map.points[2][0], Math.sqrt(5));
  for (const p of map.points) near(p[1], 0);
  assert.strictEqual(pca([[1, 2], [3, 4]]), null);
});

test('gaps are the spread of the chosen paradigms on each axis, and a large gap is a mismatch', () => {
  const axes = [{ id: 1, name: 'state' }, { id: 2, name: 'binding' }];
  const scores = { 10: { 1: { score: 0 }, 2: { score: 4 } }, 11: { 1: { score: 9 }, 2: { score: 6 } }, 12: { 1: { score: 5 }, 2: { score: 5 } } };
  assert.deepStrictEqual(gaps(axes, scores, [10, 11, 12]), [
    { axis_id: 1, name: 'state', gap: 9, mismatch: true },
    { axis_id: 2, name: 'binding', gap: 2, mismatch: false }]);
});

test('an old database keeps its data and gains the stack tables, columns and start list', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'snowmobile-'));
  const old = new DatabaseSync(path.join(home, 'snowmobile.db'));
  // The schema of the first release.
  old.exec(`CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE hunts (id INTEGER PRIMARY KEY, seed TEXT NOT NULL, status TEXT NOT NULL, error TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE sources (id INTEGER PRIMARY KEY, hunt_id INTEGER NOT NULL, name TEXT, kind TEXT, url TEXT, summary TEXT);
    CREATE TABLE components (id INTEGER PRIMARY KEY, source_id INTEGER NOT NULL, name TEXT, mechanism TEXT, url TEXT, bad_reason TEXT);
    CREATE TABLE snowmobiles (id INTEGER PRIMARY KEY, hunt_id INTEGER NOT NULL, name TEXT, pitch TEXT, component_ids TEXT,
      status TEXT NOT NULL, proof_url TEXT, proof_note TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    INSERT INTO meta VALUES ('token', 'old-token');
    INSERT INTO hunts (seed, status) VALUES ('old seed', 'created');
    INSERT INTO snowmobiles (hunt_id, name, pitch, component_ids, status) VALUES (1, 'Old idea', 'p', '[]', 'survivor');`);
  old.close();
  const { server, cfg } = await start({ home, port: 0, claude: 'false' });
  assert.strictEqual(cfg.token, 'old-token');
  assert.strictEqual(cfg.db.prepare(`SELECT seed FROM hunts`).get().seed, 'old seed');
  const sm = cfg.db.prepare(`SELECT * FROM snowmobiles`).get();
  assert.strictEqual(sm.name, 'Old idea');
  assert.strictEqual(sm.problem_ids, null);
  assert.ok('mismatch' in sm && 'problem' in sm && 'gain' in sm);
  const layers = cfg.db.prepare(`SELECT layer, COUNT(*) AS n FROM paradigms GROUP BY layer ORDER BY layer`).all();
  assert.deepStrictEqual(layers.map((l) => l.layer), ['hardware', 'language', 'os', 'software']);
  server.close();
  // A second start adds nothing twice.
  const again = await start({ home, port: 0, claude: 'false' });
  assert.strictEqual(again.cfg.db.prepare(`SELECT COUNT(*) AS n FROM paradigms`).get().n, layers.reduce((s, l) => s + l.n, 0));
  again.server.close();
});

test('a seed update adds absent seeds and preserves user data on each start', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'snowmobile-'));
  let app;
  t.after(async () => {
    if (app) {
      await new Promise((resolve) => app.server.close(resolve));
      app.cfg.db.close();
    }
    fs.rmSync(home, { recursive: true, force: true });
  });
  app = await start({ home, port: 0, claude: 'false' });
  const db = app.cfg.db;
  const before = db.prepare(`SELECT * FROM paradigms ORDER BY id`).all();
  for (const profile of require('../data/repo-scores.json').paradigms
    .filter((p) => ['Hardware generators', 'Actor model', 'Functional package management', 'Data structure server', 'Single-level store', 'Conflict-free replicated data types'].includes(p.name))) {
    const seeds = before.filter((p) => p.name === profile.name);
    assert.strictEqual(seeds.length, 1);
    assert.strictEqual(seeds[0].layer, profile.layer);
    assert.strictEqual(seeds[0].summary, profile.definition);
    assert.ok(profile.sources.includes(seeds[0].url));
  }
  // Remove two seeds per layer to represent the previous seed list.
  const absent = [...new Set(before.map((p) => p.layer))]
    .flatMap((layer) => before.filter((p) => p.layer === layer).slice(-2));
  const edited = before[1];
  for (const p of absent) db.prepare(`DELETE FROM paradigms WHERE id = ?`).run(p.id);
  db.prepare(`UPDATE paradigms SET name = ?, summary = ?, url = ? WHERE id = ?`)
    .run(edited.name.toUpperCase(), 'My definition.', 'https://example.com/my-source', edited.id);
  db.prepare(`INSERT INTO axes (name, low, high) VALUES ('My axis', 'low', 'high')`).run();
  db.prepare(`INSERT INTO scores VALUES (?, 1, 7, 'My score.')`).run(edited.id);
  const kept = db.prepare(`SELECT * FROM paradigms ORDER BY id`).all();
  const axes = db.prepare(`SELECT * FROM axes`).all();
  const scores = db.prepare(`SELECT * FROM scores`).all();
  const token = app.cfg.token;
  await new Promise((resolve) => app.server.close(resolve));
  db.close();
  app = null;

  for (let pass = 0; pass < 2; pass++) {
    app = await start({ home, port: 0, claude: 'false' });
    const current = app.cfg.db;
    assert.strictEqual(current.prepare(`SELECT COUNT(*) AS n FROM paradigms`).get().n, before.length);
    const restored = absent.map((p) => {
      const row = current.prepare(`SELECT * FROM paradigms WHERE name = ?`).get(p.name);
      assert.deepStrictEqual([row.layer, row.summary, row.url], [p.layer, p.summary, p.url]);
      return row.id;
    });
    assert.deepStrictEqual(current.prepare(`SELECT * FROM paradigms ORDER BY id`).all().filter((p) => !restored.includes(p.id)), kept);
    assert.deepStrictEqual(current.prepare(`SELECT * FROM axes`).all(), axes);
    assert.deepStrictEqual(current.prepare(`SELECT * FROM scores`).all(), scores);
    assert.strictEqual(app.cfg.token, token);
    await new Promise((resolve) => app.server.close(resolve));
    current.close();
    app = null;
  }
});

test('stack: axes, scores, map, point, owner edits, then a stack seed to a brief with the mismatch line', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'snowmobile-'));
  const { server, cfg, port } = await start({ home, port: 0, claude: path.join(__dirname, 'fake-claude.js') });
  t.after(() => server.close());
  const call = async (p, body) => {
    const res = await fetch(`http://127.0.0.1:${port}${p}`, { method: body ? 'POST' : 'GET',
      headers: { 'x-token': cfg.token }, body: body && JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  const until = async (p, ok) => {
    for (let i = 0; i < 100; i++) {
      const r = (await call(p)).body;
      if (ok(r)) return r;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`timeout on ${p}`);
  };
  let s = (await call('/api/stack')).body;
  assert.strictEqual(s.axes.length, 0);
  assert.strictEqual(s.map, null);
  // Reason: a problem share without its source or sample scope can imply a false priority.
  const problems = s.practicalProblems;
  assert.deepStrictEqual(problems.items.map((p) => [p.id, p.percent]), [
    ['technical-debt', 62.4], ['build-complexity', 32.9],
    ['deployment-complexity', 32.3], ['unreliable-tools', 31.5],
  ]);
  assert.strictEqual(problems.source.url,
    'https://survey.stackoverflow.co/2024/professional-developers/#2-most-common-frustrations');
  assert.strictEqual(problems.source.respondents, 28251);
  assert.match(problems.source.scope, /Professional Developer/);
  assert.match(problems.source.measure, /more than one/);
  assert.match(problems.source.limit, /do not measure severity/);
  assert.deepStrictEqual(problems.coverage.withoutReduction, []);
  assert.strictEqual(problems.coverage.unassessedParadigms, s.paradigms.length - new Set(problems.links.map((l) => l.paradigm_id)).size);
  for (const l of problems.links) {
    assert.ok(s.paradigms.some((p) => p.id === l.paradigm_id && p.name === l.paradigm));
    assert.ok(problems.items.some((p) => p.id === l.problem_id));
    assert.ok(l.reason && l.source.title && l.source.url.startsWith('https://'));
  }
  const n = s.paradigms.length;

  // Reason: database coverage hid problems that the selected stack had no assessment to reduce.
  assert.strictEqual(s.selectedProblemCoverage, null);
  const microservices = s.paradigms.find((p) => p.name === 'Microservices');
  const nix = s.paradigms.find((p) => p.name === 'Functional package management');
  const unassessed = s.paradigms.find((p) => p.name === 'Exokernel');
  const selectedServices = (await call(`/api/stack?pick=${microservices.id}`)).body;
  assert.deepStrictEqual(selectedServices.practicalProblems.coverage.withoutReduction, []);
  assert.deepStrictEqual(selectedServices.selectedProblemCoverage.withoutReduction, ['build-complexity', 'deployment-complexity']);
  assert.strictEqual(selectedServices.selectedProblemCoverage.unassessedParadigms, 0);
  const useful = (await call(`/api/stack?pick=${nix.id},${unassessed.id},${unassessed.id},999999`)).body;
  assert.deepStrictEqual(useful.selectedProblemCoverage.withoutReduction, ['technical-debt']);
  assert.strictEqual(useful.selectedProblemCoverage.unassessedParadigms, 1);
  assert.strictEqual((await call('/api/stack?pick=999999')).body.selectedProblemCoverage, null);
  assert.strictEqual((await call('/api/stack')).body.selectedProblemCoverage, null);

  await call('/api/stack/axes', {});
  s = await until('/api/stack', (b) => !b.job);
  assert.strictEqual(s.axes.length, 4);
  assert.strictEqual(s.map.ids.length, n);
  assert.strictEqual(s.map.points.length, n);
  for (const p of s.paradigms) for (const a of s.axes) {
    const score = s.scores[p.id][a.id];
    assert.ok(Number.isInteger(score.score) && score.score >= 0 && score.score <= 10);
    assert.ok(score.reason.trim());
  }

  // Hunt more: a paradigm that the map has already is left out, and the new one gets scores.
  await call('/api/stack/hunting', {});
  s = await until('/api/stack', (b) => !b.job);
  assert.strictEqual(s.paradigms.length, n + 1);
  assert.strictEqual(s.map.ids.length, n + 1);

  // Reason: the paradigm hunt had no practical problems or source assessments.
  const huntPrompt = fs.readFileSync(path.join(home, 'paradigm-prompt'), 'utf8');
  const huntProblems = JSON.parse(huntPrompt.split('Practical problems and source assessments (JSON):\n')[1].split('\n')[0]);
  assert.deepStrictEqual(huntProblems, problems);
  assert.match(huntPrompt, /Order candidates by the greatest respondent share of a problem they can reduce/);
  assert.match(huntPrompt, /Do not add shares or equate prevalence with severity/);
  assert.match(huntPrompt, /Prefer evidence of practical benefit over map distance/);
  assert.match(huntPrompt, /Use source links to explain each benefit, harm and limit in the summary/);

  // The owner edits an axis and a score; a later scoring run keeps the edit.
  const [a1] = s.axes;
  const first = s.paradigms.find((p) => p.layer === 'hardware');
  assert.strictEqual((await call(`/api/axes/${a1.id}`, { name: 'where state lives', low: 'device', high: 'cloud' })).status, 200);
  assert.strictEqual((await call('/api/scores', { paradigm_id: first.id, axis_id: a1.id, score: 11 })).status, 400);
  await call('/api/scores', { paradigm_id: first.id, axis_id: a1.id, score: 10, reason: 'mine' });
  await call('/api/stack/axes', {});
  s = await until('/api/stack', (b) => !b.job);
  assert.strictEqual(s.axes[0].name, 'where state lives');
  assert.deepStrictEqual(s.scores[first.id][a1.id], { paradigm_id: first.id, axis_id: a1.id, score: 10, reason: 'mine' });

  // A tap on an empty point asks which paradigm would live there.
  const pt = (await call('/api/stack/point', { x: 1, y: -1 })).body;
  assert.strictEqual(pt.profile.length, 4);
  assert.strictEqual(pt.answer.name, 'No verified match');
  assert.strictEqual(pt.answer.exists, false);
  assert.strictEqual(pt.answer.url, '');
  // Reason: the map-point trial supplied no practical problems and requested an invented paradigm.
  const pointPrompt = fs.readFileSync(path.join(home, 'point-prompt'), 'utf8');
  const pointProblems = JSON.parse(pointPrompt.split('Practical problems and source assessments (JSON):\n')[1].split('\n')[0]);
  assert.deepStrictEqual(pointProblems, s.practicalProblems);
  assert.match(pointPrompt, /prefer evidence of practical benefit over map distance/);
  assert.match(pointPrompt, /When evidence and benefit are comparable, use the greatest respondent share/);
  assert.match(pointPrompt, /Do not add shares or equate prevalence with severity/);
  assert.match(pointPrompt, /source links for the benefit, harm and limits/);
  assert.match(pointPrompt, /Each real paradigm needs a URL that you opened/);
  assert.match(pointPrompt, /Do not invent paradigms or URLs/);
  assert.match(pointPrompt, /If no real paradigm fits, set exists false, name "No verified match", and url ""/);

  // One paradigm per layer is a stack, and the gaps show on each axis.
  const pick = Object.keys(s.layers).map((l) => s.paradigms.find((p) => p.layer === l).id);
  s = (await call(`/api/stack?pick=${pick.join(',')}`)).body;
  assert.strictEqual(s.gaps.length, 4);
  assert.ok(s.gaps.every((g) => g.mismatch === g.gap >= s.mismatch));
  assert.strictEqual((await call('/api/hunts', { stack: [pick[0], s.paradigms.filter((p) => p.layer === 'language')[1].id] })).status, 400);
  assert.strictEqual((await call('/api/hunts', { stack: [] })).status, 400);

  // Reason: the brainstorm omitted all source assessments, which include a harmful effect.
  const broad = (await call('/api/hunts', { seed: 'reliable tools', stack: [] })).body;
  await until(`/api/hunts/${broad.id}`, (b) => b.hunt.status === 'created');
  const prompt = fs.readFileSync(path.join(home, 'stack-prompt'), 'utf8');
  const assessments = JSON.parse(prompt.split('Source assessments for available paradigms (JSON):\n')[1].split('\n')[0]);
  assert.deepStrictEqual(assessments, s.practicalProblems.links);
  assert.ok(assessments.some((l) => l.effect === 'worsens'));
  assert.match(prompt, /explain that cost in gain and compare it with the benefit/);
  assert.match(prompt, /No assessment means an unknown effect/);

  const { id } = (await call('/api/hunts', { seed: 'lost photos', stack: pick })).body;
  const h = await until(`/api/hunts/${id}`, (b) => b.hunt.status === 'created');
  // Reason: an unavailable paradigm must not supply a candidate with a claimed benefit.
  const fixedPrompt = fs.readFileSync(path.join(home, 'stack-prompt'), 'utf8');
  const fixedAssessments = JSON.parse(fixedPrompt.split('Source assessments for available paradigms (JSON):\n')[1].split('\n')[0]);
  assert.deepStrictEqual(fixedAssessments, s.practicalProblems.links.filter((l) => pick.includes(l.paradigm_id)));
  assert.deepStrictEqual(h.sources.map((x) => x.kind), Object.keys(s.layers));
  assert.deepStrictEqual(h.snowmobiles.map((x) => x.status), ['survivor', 'survivor', 'graveyard', 'graveyard', 'graveyard']);
  // Reason: model order must not outrank a sourced problem, and all candidates must count.
  assert.deepStrictEqual(h.snowmobiles.slice(0, 2).map((s) => s.name), ['Hashvisor', 'Killme']);
  assert.ok(h.snowmobiles[0].id > h.snowmobiles[1].id);
  assert.deepStrictEqual(h.snowmobiles[0].problem_ids, ['technical-debt']);
  assert.strictEqual(h.snowmobiles[0].problem_priority, 62.4);
  assert.deepStrictEqual(h.snowmobiles[2].problem_ids, []);
  assert.strictEqual(h.problemCoverage.named, 2);
  assert.strictEqual(h.problemCoverage.total, 5);
  assert.strictEqual(h.problemCoverage.share, 0.4);
  assert.strictEqual(h.problemCoverage.source.url, problems.source.url);
  assert.deepStrictEqual(JSON.parse(cfg.db.prepare('SELECT problem_ids FROM snowmobiles WHERE id = ?')
    .get(h.snowmobiles[0].id).problem_ids), ['technical-debt']);
  const app = h.snowmobiles[0];
  assert.strictEqual(app.component_ids.length, 4);
  assert.match(app.mismatch, /Hardware and software/);
  await until(`/api/grills/${app.id}`, (b) => !b.pending);
  await call(`/api/grills/${app.id}/answer`, { answers: { scope: { choice: 0 }, lang: { choice: 0 } } });
  const g = await until(`/api/grills/${app.id}`, (b) => b.status === 'done');
  assert.match(g.brief, /^\*\*Problem:\*\*[^]*\n\*\*Layer mismatch:\*\* Hardware and software disagree on where state lives\.\n\n# Build/);

  // A pain alone is a stack seed too: each layer offers all its paradigms.
  const pain = (await call('/api/hunts', { seed: 'lost photos', stack: [] })).body;
  const ph = await until(`/api/hunts/${pain.id}`, (b) => b.hunt.status === 'created');
  assert.strictEqual(ph.sources.length, s.paradigms.length);
});
