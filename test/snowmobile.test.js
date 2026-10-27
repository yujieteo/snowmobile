const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { start } = require('../snowmobile.js');

async function lab() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'snowmobile-'));
  const { server, cfg, port } = await start({ home, port: 0, claude: path.join(__dirname, 'fake-claude.js') });
  const call = async (p, body, tok = cfg.token) => {
    const res = await fetch(`http://127.0.0.1:${port}${p}`, { method: body ? 'POST' : 'GET',
      headers: { 'x-token': tok }, body: body && JSON.stringify(body) });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const until = async (p, ok) => {
    for (let i = 0; i < 100; i++) {
      const r = await call(p);
      if (ok(r.body)) return r.body;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`timeout on ${p}`);
  };
  return { server, cfg, call, until };
}

test('a request without the token gets 403', async () => {
  const { server, call } = await lab();
  assert.strictEqual((await call('/api/search', null, 'wrong-token-wrong-token-wrong-tok')).status, 403);
  assert.strictEqual((await call('/api/search', null, '')).status, 403);
  server.close();
});

test('a multibyte token with the same character count gets 403 and the server keeps running', async () => {
  const { server, cfg, call } = await lab();
  const res = await fetch(`http://127.0.0.1:${server.address().port}/?token=${encodeURIComponent('é'.repeat(cfg.token.length))}`);
  assert.strictEqual(res.status, 403);
  assert.strictEqual((await call('/api/search')).status, 200);
  server.close();
});

test('hunt, create, grill to a build brief, and kill', async () => {
  const { server, call, until } = await lab();
  const { id } = (await call('/api/hunts', { seed: 'flaky tests' })).body;
  let h = await until(`/api/hunts/${id}`, (b) => b.hunt.status === 'hunted');
  assert.strictEqual(h.sources.length, 2);
  await call(`/api/hunts/${id}/create`, {});
  h = await until(`/api/hunts/${id}`, (b) => b.hunt.status === 'created');
  assert.deepStrictEqual(h.snowmobiles.map((s) => s.status), ['survivor', 'survivor', 'graveyard', 'graveyard', 'graveyard']);
  // A candidate without a real source for its problem, or without a clear gain, goes to the graveyard like prior art.
  assert.match(h.snowmobiles[3].proof_note, /^No clear problem: /);
  assert.match(h.snowmobiles[4].proof_note, /^No clear gain: /);
  assert.strictEqual(h.snowmobiles[4].proof_url, '');
  const [good, weak] = h.snowmobiles;

  let g = await until(`/api/grills/${good.id}`, (b) => !b.pending);
  const open = g.tree.decisions.filter((d) => !d.answer);
  assert.strictEqual(open.length, 2);
  assert.strictEqual((await call(`/api/grills/${good.id}/answer`, { answers: { scope: { choice: 0 } } })).status, 400);
  await call(`/api/grills/${good.id}/answer`, { answers: { scope: { choice: 0 }, lang: { choice: -1, note: 'Zig' } } });
  g = await until(`/api/grills/${good.id}`, (b) => b.status === 'done');
  assert.match(g.brief, /^\*\*Problem:\*\* Testers lose a day[^]*\*\*Evidence:\*\* https:\/\/example.com\/thread\n\*\*Conventional solution:\*\* Retry plugins\n\*\*Why better \(effort\):\*\*[^]*Build/);
  assert.doesNotMatch(g.brief, /Layer mismatch/);

  await until(`/api/grills/${weak.id}`, (b) => !b.pending);
  g = (await call(`/api/grills/${weak.id}/answer`, { answers: { scope: { choice: 1 }, lang: { choice: 0 } } })).body;
  assert.strictEqual(g.status, 'killed');
  h = (await call(`/api/hunts/${id}`)).body;
  assert.ok(h.sources[0].components[0].bad_reason);
  assert.strictEqual(h.snowmobiles[1].status, 'killed');

  const found = (await call('/api/search?q=Zig')).body;
  assert.deepStrictEqual(found.snowmobiles.map((s) => s.name), ['Hashvisor']);
  server.close();
});

// One hunt with part A in each plan and part B outside every plan, written straight into the database.
function plant(db, names) {
  const hunt = db.prepare(`INSERT INTO hunts (seed, status) VALUES ('x', 'created')`).run().lastInsertRowid;
  const src = db.prepare(`INSERT INTO sources (hunt_id, name) VALUES (?, 'src')`).run(hunt).lastInsertRowid;
  const a = db.prepare(`INSERT INTO components (source_id, name) VALUES (?, 'A')`).run(src).lastInsertRowid;
  db.prepare(`INSERT INTO components (source_id, name) VALUES (?, 'B')`).run(src);
  const ids = names.map((n) => db.prepare(`INSERT INTO snowmobiles (hunt_id, name, pitch, component_ids, status)
    VALUES (?, ?, 'p', ?, 'survivor')`).run(hunt, n, JSON.stringify([a])).lastInsertRowid);
  return { hunt, ids };
}

test('a grill left without a running call after a restart continues on the next read', async () => {
  const { server, cfg, until } = await lab();
  const { ids: [sm] } = plant(cfg.db, ['Restarted']);
  const tree = { round: 1, decisions: [{ id: 'restart-q', question: 'Q?', depends_on: [], recommended: 0, round: 1,
    options: [{ label: 'Yes', why: 'w', kills_component_id: 0 }], answer: { choice: 0, note: '' } }] };
  cfg.db.prepare(`INSERT INTO grills (snowmobile_id, tree, status) VALUES (?, ?, 'open')`).run(sm, JSON.stringify(tree));
  const g = await until(`/api/grills/${sm}`, (b) => b.status === 'done');
  assert.match(g.brief, /Build/);
  server.close();
});

test('a kill blames only a part of the plan, and a killed verdict without a part is still a kill', async () => {
  const { server, cfg, call, until } = await lab();
  const { hunt, ids: [blameless, blamer, stranger] } = plant(cfg.db, ['Blameless', 'Blamer', 'Stranger']);
  for (const sm of [blameless, blamer]) {
    const g = await until(`/api/grills/${sm}`, (b) => b.status !== 'open');
    assert.strictEqual(g.status, 'killed');
    assert.strictEqual(g.tree.killed.component_id, 0);
  }
  let g = await until(`/api/grills/${stranger}`, (b) => !b.pending);
  assert.strictEqual(g.tree.decisions[0].options[1].kills_component_id, 0);
  await call(`/api/grills/${stranger}/answer`, { answers: { mode: { choice: 1 } } });
  g = await until(`/api/grills/${stranger}`, (b) => b.status !== 'open');
  assert.strictEqual(g.status, 'done');
  const h = (await call(`/api/hunts/${hunt}`)).body;
  assert.deepStrictEqual(h.sources[0].components.map((c) => c.bad_reason), [null, null]);
  assert.deepStrictEqual(h.snowmobiles.map((s) => s.status), ['killed', 'killed', 'grilled']);
  server.close();
});

test('a failed grill call shows its error and calls claude again only on retry', async () => {
  const { server, cfg, call, until } = await lab();
  const { ids: [sm] } = plant(cfg.db, ['Broken']);
  const calls = () => fs.readFileSync(path.join(cfg.home, 'broken-calls'), 'utf8').length;
  let g = await until(`/api/grills/${sm}`, (b) => b.error);
  for (let i = 0; i < 5; i++) {
    g = (await call(`/api/grills/${sm}`)).body;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.match(g.error, /Not logged in/);
  assert.strictEqual(g.pending, false);
  assert.strictEqual(calls(), 1);
  await call(`/api/grills/${sm}/retry`, {});
  await until(`/api/grills/${sm}`, (b) => b.error);
  assert.strictEqual(calls(), 2);
  server.close();
});

test('the owner leaves out a part, buries and restores an idea, and undoes a round, a kill and a brief', async () => {
  const { server, call, until } = await lab();
  const { id } = (await call('/api/hunts', { seed: 'flaky tests' })).body;
  await until(`/api/hunts/${id}`, (b) => b.hunt.status === 'hunted');
  await call(`/api/hunts/${id}/create`, {});
  let h = await until(`/api/hunts/${id}`, (b) => b.hunt.status === 'created');
  const part = h.sources[1].components[0];
  const [good, weak, old] = h.snowmobiles;

  await call(`/api/components/${part.id}`, { out: true });
  h = (await call(`/api/hunts/${id}`)).body;
  assert.strictEqual(h.sources[1].components[0].bad_reason, 'left out by you');
  await call(`/api/components/${part.id}`, { out: false });
  h = (await call(`/api/hunts/${id}`)).body;
  assert.strictEqual(h.sources[1].components[0].bad_reason, null);

  await call(`/api/snowmobiles/${good.id}`, { status: 'graveyard' });
  h = (await call(`/api/hunts/${id}`)).body;
  assert.strictEqual(h.snowmobiles[0].status, 'graveyard');
  assert.strictEqual(h.snowmobiles[0].proof_note, 'Buried by you. Nothing close.');
  assert.strictEqual((await call(`/api/snowmobiles/${good.id}`, { status: 'graveyard' })).status, 409);
  await call(`/api/snowmobiles/${good.id}`, { status: 'survivor' });
  await call(`/api/snowmobiles/${old.id}`, { status: 'survivor' });
  h = (await call(`/api/hunts/${id}`)).body;
  assert.deepStrictEqual(h.snowmobiles.slice(0, 3).map((s) => [s.status, s.proof_note]),
    [['survivor', 'Nothing close.'], ['survivor', ''], ['survivor', 'Same thing.']]);

  await until(`/api/grills/${weak.id}`, (b) => !b.pending);
  assert.strictEqual((await call(`/api/grills/${weak.id}/undo`, {})).status, 409);
  await call(`/api/grills/${weak.id}/answer`, { answers: { scope: { choice: 1 }, lang: { choice: 0 } } });
  let g = (await call(`/api/grills/${weak.id}/undo`, {})).body;
  assert.strictEqual(g.status, 'open');
  assert.ok(g.tree.decisions.every((d) => !d.answer) && !g.tree.killed);
  h = (await call(`/api/hunts/${id}`)).body;
  assert.strictEqual(h.sources[0].components[0].bad_reason, null);
  assert.deepStrictEqual([h.snowmobiles[1].status, h.snowmobiles[1].proof_note], ['survivor', '']);

  await until(`/api/grills/${good.id}`, (b) => !b.pending);
  await call(`/api/grills/${good.id}/answer`, { answers: { scope: { choice: 0 }, lang: { choice: 0 } } });
  await until(`/api/grills/${good.id}`, (b) => b.status === 'done');
  g = (await call(`/api/grills/${good.id}/undo`, {})).body;
  assert.deepStrictEqual([g.status, g.brief, g.tree.decisions.filter((d) => !d.answer).length], ['open', null, 2]);
  assert.strictEqual((await call(`/api/hunts/${id}`)).body.snowmobiles[0].status, 'survivor');
  server.close();
});

test('an undo puts back the exact earlier part mark, idea status and note', async () => {
  const { server, cfg, call, until } = await lab();
  const { id } = (await call('/api/hunts', { seed: 'flaky tests' })).body;
  await until(`/api/hunts/${id}`, (b) => b.hunt.status === 'hunted');
  await call(`/api/hunts/${id}/create`, {});
  let h = await until(`/api/hunts/${id}`, (b) => b.hunt.status === 'created');
  const part = h.sources[0].components[0];
  const [good, weak, old] = h.snowmobiles;
  const mark = async () => (await call(`/api/hunts/${id}`)).body.sources[0].components[0].bad_reason;

  const killBoth = async () => {
    for (const sm of [good, weak]) {
      await until(`/api/grills/${sm.id}`, (b) => !b.pending);
      await call(`/api/grills/${sm.id}/answer`, { answers: { scope: { choice: 1 }, lang: { choice: 0 } } });
    }
    assert.match(await mark(), /^Killme: /);
  };

  // An undo in the order of the kills: the part keeps the mark of the kill that still stands, then has no mark.
  await killBoth();
  await call(`/api/grills/${good.id}/undo`, {});
  assert.match(await mark(), /^Killme: /);
  await call(`/api/grills/${weak.id}/undo`, {});
  assert.strictEqual(await mark(), null);

  // An undo in the reverse order on a part that you left out: the part gets back the standing mark, then your mark.
  await call(`/api/components/${part.id}`, { out: true });
  await killBoth();
  await call(`/api/grills/${weak.id}/undo`, {});
  assert.match(await mark(), /^Hashvisor: /);
  await call(`/api/grills/${good.id}/undo`, {});
  assert.strictEqual(await mark(), 'left out by you');

  // An idea that you bury while its grill is open stays buried after an undo of the grill round.
  const { ids: [sm] } = plant(cfg.db, ['Buried']);
  const tree = { round: 1, decisions: [{ id: 'q', question: 'Q?', depends_on: [], recommended: 0, round: 1,
    options: [{ label: 'Yes', why: 'w', kills_component_id: 0 }], answer: { choice: 0, note: '' } }] };
  cfg.db.prepare(`INSERT INTO grills (snowmobile_id, tree, status) VALUES (?, ?, 'open')`).run(sm, JSON.stringify(tree));
  await call(`/api/snowmobiles/${sm}`, { status: 'graveyard' });
  assert.strictEqual((await call(`/api/grills/${sm}/undo`, {})).status, 200);
  const buried = cfg.db.prepare(`SELECT status, proof_note FROM snowmobiles WHERE id = ?`).get(sm);
  assert.deepStrictEqual({ ...buried }, { status: 'graveyard', proof_note: 'Buried by you. ' });

  // An undo of a restore sends the earlier note, so prior art does not become an idea that you buried.
  await call(`/api/snowmobiles/${old.id}`, { status: 'survivor' });
  await call(`/api/snowmobiles/${old.id}`, { status: 'graveyard', proof_note: old.proof_note });
  h = (await call(`/api/hunts/${id}`)).body;
  assert.deepStrictEqual([h.snowmobiles[2].status, h.snowmobiles[2].proof_note], ['graveyard', 'Same thing.']);
  server.close();
});
