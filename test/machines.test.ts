// The machines of the flow and of the page: allowed and refused events, and the match with docs/machines/*.sm.md.
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { allows, cell, next, rowsOf, RefusedTransition, type Machine } from '../shared/fsm.ts';
import { grillMachine, huntMachine, ideaMachine, stackJobMachine } from '../shared/flow.ts';
import { onceMachine, pointMachine, swipeMachine, toastMachine } from '../shared/ui.ts';
import { start } from '../src/server.ts';

type AnyMachine = Machine<string, string>;
const machines = [huntMachine, ideaMachine, grillMachine, stackJobMachine, swipeMachine, toastMachine, pointMachine, onceMachine] as unknown as AnyMachine[];

const events = (m: AnyMachine): string[] => [...new Set(rowsOf(m).map((r) => r[1]))];

test('each machine refuses each event that has no row, and moves on each event that has one', () => {
  for (const m of machines) {
    const listed = new Map(rowsOf(m).map(([s, e, to]) => [`${s}/${e}`, to]));
    for (const s of Object.keys(m.table)) {
      for (const e of events(m)) {
        const to = listed.get(`${s}/${e}`);
        if (to === undefined) {
          assert.throws(() => next(m, s, e), RefusedTransition, `${m.name}: ${s}/${e} must be refused`);
          assert.strictEqual(allows(m, s, e), false);
        } else assert.strictEqual(next(m, s, e), to === '-' ? s : to, `${m.name}: ${s}/${e}`);
      }
    }
  }
});

test('each state of each machine can be reached from the initial state', () => {
  for (const m of machines) {
    const seen = new Set([m.initial]);
    for (const todo = [m.initial]; todo.length;) {
      const s = todo.pop() as string;
      for (const [from, , to] of rowsOf(m)) if (from === s && to !== '-' && !seen.has(to)) { seen.add(to); todo.push(to); }
    }
    assert.deepStrictEqual([...seen].sort(), Object.keys(m.table).sort(), `${m.name}: unreachable state`);
  }
});

test('the idea machine: only an owner action or prior art buries, and a grill result moves only a survivor', () => {
  assert.strictEqual(next(ideaMachine, 'candidate', 'exile'), 'graveyard');
  assert.strictEqual(next(ideaMachine, 'survivor', 'bury'), 'graveyard');
  assert.strictEqual(next(ideaMachine, 'graveyard', 'restore'), 'survivor');
  for (const e of ['finish', 'kill'] as const) {
    assert.throws(() => next(ideaMachine, 'graveyard', e), RefusedTransition);
    assert.throws(() => next(ideaMachine, 'candidate', e), RefusedTransition);
  }
  assert.throws(() => next(ideaMachine, 'grilled', 'bury'), RefusedTransition);
});

test('the grill machine: one round at a time, and a failed grill can retry', () => {
  assert.strictEqual(next(grillMachine, 'fresh', 'open'), 'thinking');
  assert.strictEqual(next(grillMachine, 'thinking', 'answer'), 'thinking');
  assert.strictEqual(next(grillMachine, 'thinking', 'error'), 'failed');
  assert.strictEqual(next(grillMachine, 'failed', 'retry'), 'thinking');
  assert.strictEqual(next(grillMachine, 'asking', 'answer'), 'thinking');
  assert.throws(() => next(grillMachine, 'asking', 'round'), RefusedTransition);
  assert.throws(() => next(grillMachine, 'fresh', 'answer'), RefusedTransition);
  assert.throws(() => next(grillMachine, 'done', 'answer'), RefusedTransition);
});

test('the hunt machine: a second step while a step runs is ignored, not started', () => {
  assert.strictEqual(next(huntMachine, 'hunting', 'create'), 'hunting');
  assert.strictEqual(next(huntMachine, 'creating', 'hunt'), 'creating');
  assert.strictEqual(next(huntMachine, 'failed', 'create'), 'creating');
  assert.throws(() => next(huntMachine, 'seeded', 'create_done'), RefusedTransition);
});

test('a page cell refuses a bad event with false and keeps its state', () => {
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
});

// The .sm.md files must say what the code does.
function rowsOfFile(file: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  let name = '';
  for (const line of fs.readFileSync(path.join(import.meta.dirname, '..', 'docs', 'machines', file), 'utf8').split('\n')) {
    const h = /^## Machine (\S+)/.exec(line);
    if (h) { name = h[1] as string; out.set(name, []); continue; }
    const cols = line.split('|').map((c) => c.trim());
    if (name && cols.length > 6 && cols[1] && !/^(state|-+)$/.test(cols[1])) out.get(name)?.push(`${cols[1]}/${cols[2]}/${cols[4]}`);
  }
  return out;
}

test('docs/machines/*.sm.md list the same rows as the tables in the code', () => {
  const docs = new Map([...rowsOfFile('flow.sm.md'), ...rowsOfFile('ui.sm.md')]);
  assert.deepStrictEqual([...docs.keys()].sort(), machines.map((m) => m.name).sort());
  for (const m of machines) {
    const want = rowsOf(m).map(([s, e, to]) => `${s}/${e}/${to}`).sort();
    assert.deepStrictEqual((docs.get(m.name) ?? []).sort(), want, `${m.name}: the .sm.md differs from the table`);
  }
});

// B1: this test fails on fc12b04, where a late grill result moved a buried idea.
test('a late grill result does not revive a buried idea', async () => {
  process.env.FAKE_CLAUDE_DELAY_MS = '700';
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'snowmobile-'));
  const { server, cfg, port } = await start({ home, port: 0, claude: path.join(import.meta.dirname, 'fake-claude.ts'), smAxi: null });
  try {
    const hunt = cfg.db.prepare(`INSERT INTO hunts (seed, status) VALUES ('x', 'created')`).run().lastInsertRowid;
    const src = cfg.db.prepare(`INSERT INTO sources (hunt_id, name) VALUES (?, 'src')`).run(hunt).lastInsertRowid;
    const a = cfg.db.prepare(`INSERT INTO components (source_id, name) VALUES (?, 'A')`).run(src).lastInsertRowid;
    const id = Number(cfg.db.prepare(`INSERT INTO snowmobiles (hunt_id, name, pitch, component_ids, status)
      VALUES (?, 'Blameless', 'p', ?, 'survivor')`).run(hunt, JSON.stringify([a])).lastInsertRowid);
    const call = (p: string, body?: object) => fetch(`http://127.0.0.1:${port}${p}`, { method: body ? 'POST' : 'GET',
      headers: { 'x-token': cfg.token }, body: body && JSON.stringify(body) });
    await call(`/api/grills/${id}`);
    assert.strictEqual((await call(`/api/snowmobiles/${id}`, { status: 'graveyard' })).status, 200);
    await new Promise((r) => setTimeout(r, 2000));
    const row = cfg.db.prepare('SELECT status FROM snowmobiles WHERE id = ?').get(id) as { status: string };
    assert.strictEqual(row.status, 'graveyard');
  } finally { delete process.env.FAKE_CLAUDE_DELAY_MS; server.close(); }
});
