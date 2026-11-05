import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { checkFindings } from '../src/machine.ts';
import { answered, lab, route, openGrill, plant, sleep, type Lab } from './helpers/snow-api.ts';
import { ownerEdits, undoExact } from './helpers/snow-undo.ts';

const SKILL = path.join(import.meta.dirname, 'fake-skill', 'bin', 'sm-axi');

async function tokenGate(): Promise<void> {
  const { server, call } = await lab();
  assert.strictEqual((await call('/api/search', null, 'wrong-token-wrong-token-wrong-tok')).status, 403);
  assert.strictEqual((await call('/api/search', null, '')).status, 403);
  server.close();
}

async function multibyteToken(): Promise<void> {
  const { server, cfg, call, port } = await lab();
  const res = await fetch(`http://127.0.0.1:${String(port)}/?token=${encodeURIComponent('é'.repeat(cfg.token.length))}`);
  assert.strictEqual(res.status, 403);
  assert.strictEqual((await call('/api/search')).status, 200);
  server.close();
}

async function killWeak({ call, until }: Pick<Lab, 'call' | 'until'>, hunt: number, weak: number): Promise<void> {
  await until(route('grills', weak), (b) => !b.pending);
  const g = (await call(route('grills', weak, 'answer'), { answers: { scope: { choice: 1 }, lang: { choice: 0 } } })).body;
  assert.strictEqual(g.status, 'killed');
  const h = (await call(route('hunts', hunt))).body;
  assert.ok(h.sources[0].components[0].bad_reason);
  assert.strictEqual(h.snowmobiles[1].status, 'killed');
}

async function huntToBrief(): Promise<void> {
  const { server, call, until } = await lab();
  const { id } = (await call('/api/hunts', { seed: 'flaky tests' })).body;
  let h = await until(route('hunts', id), (b) => b.hunt.status === 'hunted');
  assert.strictEqual(h.sources.length, 2);
  await call(route('hunts', id, 'create'), {});
  h = await until(route('hunts', id), (b) => b.hunt.status === 'created');
  assert.deepStrictEqual(h.snowmobiles.map((s) => s.status), ['survivor', 'survivor', 'graveyard', 'graveyard', 'graveyard']);
  // A candidate without a real source for its problem, or without a clear gain, goes to the graveyard like prior art.
  assert.match(h.snowmobiles[3].proof_note, /^No clear problem: /);
  assert.match(h.snowmobiles[4].proof_note, /^No clear gain: /);
  assert.strictEqual(h.snowmobiles[4].proof_url, '');
  const good = h.snowmobiles[0];
  const weak = h.snowmobiles[1];

  let g = await until(route('grills', good.id), (b) => !b.pending);
  assert.strictEqual(g.tree.decisions.filter((d) => !d.answer).length, 2);
  assert.strictEqual((await call(route('grills', good.id, 'answer'), { answers: { scope: { choice: 0 } } })).status, 400);
  await call(route('grills', good.id, 'answer'), { answers: { scope: { choice: 0 }, lang: { choice: -1, note: 'Zig' } } });
  g = await until(route('grills', good.id), (b) => b.status === 'done');
  assert.match(g.brief ?? '', /^\*\*Problem:\*\* Testers lose a day[^]*\*\*Evidence:\*\* https:\/\/example.com\/thread\n\*\*Conventional solution:\*\* Retry plugins\n\*\*Why better \(effort\):\*\*[^]*Build/);
  assert.doesNotMatch(g.brief ?? '', /Layer mismatch/);
  await killWeak({ call, until }, id, weak.id);
  const found = (await call('/api/search?q=Zig')).body;
  assert.deepStrictEqual(found.snowmobiles.map((s) => s.name), ['Hashvisor']);
  server.close();
}

async function restartedGrill(): Promise<void> {
  const { server, cfg, until } = await lab();
  const sm = plant(cfg.db, ['Restarted']).ids[0];
  openGrill(cfg, sm, 'restart-q', 'Q?', 'Yes');
  const g = await until(route('grills', sm), (b) => b.status === 'done');
  assert.match(g.brief ?? '', /Build/);
  server.close();
}

async function blamedPart(): Promise<void> {
  const { server, cfg, call, until } = await lab();
  const { hunt, ids } = plant(cfg.db, ['Blameless', 'Blamer', 'Stranger']);
  for (const sm of [ids[0], ids[1]]) {
    const g = await until(route('grills', sm), (b) => b.status !== 'open');
    assert.strictEqual(g.status, 'killed');
    assert.strictEqual(g.tree.killed?.component_id, 0);
  }
  const stranger = ids[2];
  let g = await until(route('grills', stranger), (b) => !b.pending);
  assert.strictEqual(g.tree.decisions[0].options[1].kills_component_id, 0);
  await call(route('grills', stranger, 'answer'), { answers: { mode: { choice: 1 } } });
  g = await until(route('grills', stranger), (b) => b.status !== 'open');
  assert.strictEqual(g.status, 'done');
  const h = (await call(route('hunts', hunt))).body;
  assert.deepStrictEqual(h.sources[0].components.map((c) => c.bad_reason), [null, null]);
  assert.deepStrictEqual(h.snowmobiles.map((s) => s.status), ['killed', 'killed', 'grilled']);
  server.close();
}

async function failedGrill(): Promise<void> {
  const { server, cfg, call, until } = await lab();
  const sm = plant(cfg.db, ['Broken']).ids[0];
  const calls = (): number => fs.readFileSync(path.join(cfg.home, 'broken-calls'), 'utf8').length;
  let g = await until(route('grills', sm), (b) => b.error);
  for (let i = 0; i < 5; i++) {
    g = (await call(route('grills', sm))).body;
    await sleep(50);
  }
  assert.match(g.error ?? '', /Not logged in/);
  assert.strictEqual(g.pending, false);
  assert.strictEqual(calls(), 1);
  await call(route('grills', sm, 'retry'), {});
  await until(route('grills', sm), (b) => b.error);
  assert.strictEqual(calls(), 2);
  server.close();
}

async function cleanMachine(): Promise<void> {
  const { server, cfg, until } = await lab({ smAxi: SKILL });
  const g = await until(route('grills', answered(cfg, 'Clean')), (b) => b.status === 'done');
  assert.match(g.brief ?? '', /# Build[^]*## State machine\n\nThe check of the settled design found no fault\.[^]*## Machine job/);
  assert.strictEqual(g.tree.machine?.findings.length, 0);
  // The model got the format from the skill folder, not from a copy in snowmobile.
  assert.match(fs.readFileSync(path.join(cfg.home, 'machine-prompt'), 'utf8'), /FORMAT-MARK/);
  server.close();
}

async function machineFaults(): Promise<void> {
  const { server, cfg, call, until } = await lab({ smAxi: SKILL });
  const sm = answered(cfg, 'Hidden');
  let g = await until(route('grills', sm), (b) => !b.pending);
  assert.strictEqual(g.status, 'open');
  const d = g.tree.decisions.filter((x) => !x.answer)[0];
  assert.strictEqual(d?.id, 'closed-input');
  assert.strictEqual(d.round, 2);
  assert.deepStrictEqual(g.tree.machine?.findings.map((f) => f.kind), ['unhandled', 'row-no-req']);
  await call(route('grills', sm, 'answer'), { answers: { 'closed-input': { choice: 0 } } });
  g = await until(route('grills', sm), (b) => b.status === 'done');
  assert.match(g.brief ?? '', /found 2 faults[^]*- unhandled job closed_running: events: ask\n- row-no-req job idle\/ask/);
  // Only one machine file was written: the answers to the round do not start another.
  assert.strictEqual(fs.readFileSync(path.join(cfg.home, 'machine-prompt'), 'utf8').split('Write the state machine file').length, 2);
  server.close();
}

async function machineUndo(): Promise<void> {
  const { server, cfg, call, until } = await lab({ smAxi: SKILL });
  const sm = answered(cfg, 'Hidden');
  await until(route('grills', sm), (b) => !b.pending);
  await call(route('grills', sm, 'answer'), { answers: { 'closed-input': { choice: 0 } } });
  await until(route('grills', sm), (b) => b.status === 'done');
  let g = (await call(route('grills', sm, 'undo'), {})).body;
  assert.ok(g.tree.machine);
  assert.strictEqual(g.tree.decisions.filter((d) => !d.answer).length, 1);
  g = (await call(route('grills', sm, 'undo'), {})).body;
  assert.strictEqual(g.tree.machine, undefined);
  server.close();
}

async function withoutSkill(): Promise<void> {
  const none = await lab({ smAxi: path.join(os.tmpdir(), 'no-such-sm-axi') });
  assert.strictEqual(none.cfg.smAxi, null);
  const first = answered(none.cfg, 'Hidden');
  const a = await none.until(route('grills', first), (b) => b.status === 'done');
  assert.doesNotMatch(a.brief ?? '', /State machine/);
  assert.strictEqual(a.tree.machine, undefined);
  none.server.close();
  const { server, cfg, until } = await lab({ smAxi: SKILL });
  const g = await until(route('grills', answered(cfg, 'Garbled')), (b) => b.status === 'done');
  assert.match(g.tree.machine?.skipped ?? '', /^sm-axi: /);
  assert.doesNotMatch(g.brief ?? '', /State machine/);
  server.close();
}

function findingsParse(): void {
  // The lines are from the output of the real sm-axi check on the faults example of the skill.
  const toon = ['file: faults.sm.md', 'simplify[1]{kind,machine,at,line,detail}:', '  function,pipe,pipe,-,"no branch and no loop: is a plain function better?"',
    'checks[3]{kind,machine,at,line,detail}:', '  unhandled,bugs,c,-,"events: stop"', '  guard-gap,bugs,b/go,L20,"only \\"ok\\": add an else row"',
    '  req-no-row,-,R9,L9,no row cites it', 'proposals[0]{machine,rows,current_rows,status,reason}:'].join('\n');
  assert.deepStrictEqual(checkFindings(toon), [
    { kind: 'unhandled', machine: 'bugs', at: 'c', detail: 'events: stop' },
    { kind: 'guard-gap', machine: 'bugs', at: 'b/go', detail: 'only "ok": add an else row' },
    { kind: 'req-no-row', machine: '-', at: 'R9', detail: 'no row cites it' }]);
  assert.deepStrictEqual(checkFindings('checks[0]{kind,machine,at,line,detail}:\nproposals[0]{}:'), []);
  assert.throws(() => checkFindings('file: x'), /no checks section/);
}

function findReal(): string | null {
  const home = path.join(os.homedir(), '.claude', 'skills', 'state-machine', 'bin', 'sm-axi');
  return [process.env['SNOWMOBILE_SM_AXI'], home].find((f) => f && fs.existsSync(f)) ?? null;
}

async function realSmAxi(): Promise<void> {
  const real = findReal();
  assert.ok(real);
  const { server, cfg } = await lab({ smAxi: real });
  const file = path.join(real, '..', '..', 'test', 'faults.sm.md');
  const r = spawnSync(process.execPath, [real, 'check', file], { encoding: 'utf8' });
  assert.strictEqual(r.status, 1);
  assert.ok(checkFindings(r.stdout).some((f) => f.kind === 'row-no-req'));
  assert.ok(cfg.smAxi);
  server.close();
}

function registerApi(): void {
  void test('a request without the token gets 403', tokenGate);
  void test('a multibyte token with the same character count gets 403 and the server keeps running', multibyteToken);
  void test('hunt, create, grill to a build brief, and kill', huntToBrief);
  void test('a grill left without a running call after a restart continues on the next read', restartedGrill);
  void test('a kill blames only a part of the plan, and a killed verdict without a part is still a kill', blamedPart);
  void test('a failed grill call shows its error and calls claude again only on retry', failedGrill);
  void test('the owner leaves out a part, buries and restores an idea, and undoes a round, a kill and a brief', ownerEdits);
  void test('an undo puts back the exact earlier part mark, idea status and note', undoExact);
}

function registerMachine(): void {
  void test('a design with no fault gets its machine checked and the brief carries the machine', cleanMachine);
  void test('machine faults come back as one more round, and the brief names them', machineFaults);
  void test('an undo of the round that the machine stands on drops the machine, an undo of the fault round keeps it', machineUndo);
  void test('without the skill, or with a machine file that sm-axi cannot read, the grill goes on to the brief', withoutSkill);
  void test('the check findings come from the checks section of the sm-axi output, with quoted details', findingsParse);
  void test('the real sm-axi of the installed skill reads a machine file and finds a fault', { skip: !findReal() }, realSmAxi);
}

registerApi();
registerMachine();
