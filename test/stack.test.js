const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { start, eigen, pca, gaps } = require('../snowmobile.js');

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
  // Remove the last seed of each layer to represent the previous seed list.
  const absent = before.filter((p) => !before.some((q) => q.layer === p.layer && q.id > p.id));
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
  const n = s.paradigms.length;

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
  assert.strictEqual(pt.answer.name, 'Gap OS');

  // One paradigm per layer is a stack, and the gaps show on each axis.
  const pick = Object.keys(s.layers).map((l) => s.paradigms.find((p) => p.layer === l).id);
  s = (await call(`/api/stack?pick=${pick.join(',')}`)).body;
  assert.strictEqual(s.gaps.length, 4);
  assert.ok(s.gaps.every((g) => g.mismatch === g.gap >= s.mismatch));
  assert.strictEqual((await call('/api/hunts', { stack: [pick[0], s.paradigms.filter((p) => p.layer === 'language')[1].id] })).status, 400);
  assert.strictEqual((await call('/api/hunts', { stack: [] })).status, 400);

  const { id } = (await call('/api/hunts', { seed: 'lost photos', stack: pick })).body;
  const h = await until(`/api/hunts/${id}`, (b) => b.hunt.status === 'created');
  assert.deepStrictEqual(h.sources.map((x) => x.kind), Object.keys(s.layers));
  assert.deepStrictEqual(h.snowmobiles.map((x) => x.status), ['survivor', 'survivor', 'graveyard', 'graveyard', 'graveyard']);
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
