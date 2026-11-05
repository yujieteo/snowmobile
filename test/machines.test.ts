// The machines of the flow and of the page: allowed and refused events, and the match with docs/machines/*.sm.md.
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { allows, cell, next, rowsOf, RefusedTransition, type Machine } from '../shared/fsm.ts';
import { grillMachine, huntMachine, ideaMachine, stackJobMachine } from '../shared/flow.ts';
import { onceMachine, pointMachine, swipeMachine, toastMachine } from '../shared/ui.ts';
import { lab, plant, route, sleep } from './helpers/snow-api.ts';

type AnyMachine = Machine<string, string>;
const machines = [huntMachine, ideaMachine, grillMachine, stackJobMachine, swipeMachine, toastMachine, pointMachine, onceMachine] as unknown as AnyMachine[];

const events = (m: AnyMachine): string[] => [...new Set(rowsOf(m).map((r) => r[1]))];

function refusesAndMoves(): void {
  for (const m of machines) {
    const listed = new Map(rowsOf(m).map(([s, e, to]) => [`${s}/${e}`, to]));
    for (const s of Object.keys(m.table)) {
      for (const e of events(m)) {
        const to = listed.get(`${s}/${e}`);
        if (to === undefined) {
          assert.throws(() => next(m, s, e), RefusedTransition, `${m.name}: ${s}/${e} must be refused`);
          assert.strictEqual(allows(m, s, e), false);
        } else {
          assert.strictEqual(next(m, s, e), to === '-' ? s : to, `${m.name}: ${s}/${e}`);
        }
      }
    }
  }
}

function reachable(): void {
  for (const m of machines) {
    const seen = new Set([m.initial]);
    for (const todo = [m.initial]; todo.length;) {
      const s = todo.pop();
      for (const [from, , to] of rowsOf(m)) {
        if (from === s && to !== '-' && !seen.has(to)) {
          seen.add(to);
          todo.push(to);
        }
      }
    }
    assert.deepStrictEqual([...seen].sort(), Object.keys(m.table).sort(), `${m.name}: unreachable state`);
  }
}

function ideaRules(): void {
  assert.strictEqual(next(ideaMachine, 'candidate', 'exile'), 'graveyard');
  assert.strictEqual(next(ideaMachine, 'survivor', 'bury'), 'graveyard');
  assert.strictEqual(next(ideaMachine, 'graveyard', 'restore'), 'survivor');
  for (const e of ['finish', 'kill'] as const) {
    assert.throws(() => next(ideaMachine, 'graveyard', e), RefusedTransition);
    assert.throws(() => next(ideaMachine, 'candidate', e), RefusedTransition);
  }
  assert.throws(() => next(ideaMachine, 'grilled', 'bury'), RefusedTransition);
}

function grillRules(): void {
  assert.strictEqual(next(grillMachine, 'fresh', 'open'), 'thinking');
  assert.strictEqual(next(grillMachine, 'thinking', 'answer'), 'thinking');
  assert.strictEqual(next(grillMachine, 'thinking', 'error'), 'failed');
  assert.strictEqual(next(grillMachine, 'failed', 'retry'), 'thinking');
  assert.strictEqual(next(grillMachine, 'asking', 'answer'), 'thinking');
  assert.throws(() => next(grillMachine, 'asking', 'round'), RefusedTransition);
  assert.throws(() => next(grillMachine, 'fresh', 'answer'), RefusedTransition);
  assert.throws(() => next(grillMachine, 'done', 'answer'), RefusedTransition);
}

function huntRules(): void {
  assert.strictEqual(next(huntMachine, 'hunting', 'create'), 'hunting');
  assert.strictEqual(next(huntMachine, 'creating', 'hunt'), 'creating');
  assert.strictEqual(next(huntMachine, 'failed', 'create'), 'creating');
  assert.throws(() => next(huntMachine, 'seeded', 'create_done'), RefusedTransition);
}

function pageCells(): void {
  const swipe = cell(swipeMachine);
  assert.strictEqual(swipe.send('release_far'), false);
  assert.strictEqual(swipe.state, 'idle');
  assert.strictEqual(swipe.send('down'), true);
  assert.strictEqual(swipe.send('move_y'), true);
  assert.strictEqual(swipe.send('move_x'), false);
  assert.strictEqual(swipe.state, 'scrolling');
  const once = cell(onceMachine);
  assert.strictEqual(once.send('run'), true);
  assert.strictEqual(once.send('run'), false);
  assert.strictEqual(once.send('settle'), true);
}

// The .sm.md files must say what the code does.
function rowsOfFile(file: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  let name = '';
  for (const line of fs.readFileSync(path.join(import.meta.dirname, '..', 'docs', 'machines', file), 'utf8').split('\n')) {
    const h = /^## Machine (\S+)/.exec(line);
    if (h) {
      name = h[1] ?? '';
      out.set(name, []);
      continue;
    }
    const cols = line.split('|').map((c) => c.trim());
    if (name && cols.length > 6 && cols[1] && !/^(state|-+)$/.test(cols[1])) {
      out.get(name)?.push([cols[1], cols[2], cols[4]].join('/'));
    }
  }
  return out;
}

function docsMatch(): void {
  const docs = new Map([...rowsOfFile('flow.sm.md'), ...rowsOfFile('ui.sm.md')]);
  assert.deepStrictEqual([...docs.keys()].sort(), machines.map((m) => m.name).sort());
  for (const m of machines) {
    const want = rowsOf(m).map(([s, e, to]) => `${s}/${e}/${to}`).sort();
    assert.deepStrictEqual((docs.get(m.name) ?? []).sort(), want, `${m.name}: the .sm.md differs from the table`);
  }
}

// B1: this test fails on fc12b04, where a late grill result moved a buried idea.
async function lateGrill(): Promise<void> {
  process.env['FAKE_CLAUDE_DELAY_MS'] = '700';
  try {
    const { server, cfg, call } = await lab();
    const id = plant(cfg.db, ['Blameless']).ids[0];
    await call(route('grills', id));
    assert.strictEqual((await call(route('snowmobiles', id), { status: 'graveyard' })).status, 200);
    await sleep(2000);
    const row = cfg.db.prepare('SELECT status FROM snowmobiles WHERE id = ?').get(id) as { status: string };
    assert.strictEqual(row.status, 'graveyard');
    server.close();
  } finally {
    delete process.env['FAKE_CLAUDE_DELAY_MS'];
  }
}

function registerMachines(): void {
  void test('each machine refuses each event that has no row, and moves on each event that has one', refusesAndMoves);
  void test('each state of each machine can be reached from the initial state', reachable);
  void test('the idea machine: only an owner action or prior art buries, and a grill result moves only a survivor', ideaRules);
  void test('the grill machine: one round at a time, and a failed grill can retry', grillRules);
  void test('the hunt machine: a second step while a step runs is ignored, not started', huntRules);
  void test('a page cell refuses a bad event with false and keeps its state', pageCells);
  void test('docs/machines/*.sm.md list the same rows as the tables in the code', docsMatch);
  void test('a late grill result does not revive a buried idea', lateGrill);
}

registerMachines();
