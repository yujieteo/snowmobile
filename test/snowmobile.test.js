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
  return { server, call, until };
}

test('a request without the token gets 403', async () => {
  const { server, call } = await lab();
  assert.strictEqual((await call('/api/search', null, 'wrong-token-wrong-token-wrong-tok')).status, 403);
  assert.strictEqual((await call('/api/search', null, '')).status, 403);
  server.close();
});

test('hunt, create, grill to a build brief, and kill', async () => {
  const { server, call, until } = await lab();
  const { id } = (await call('/api/hunts', { seed: 'flaky tests' })).body;
  let h = await until(`/api/hunts/${id}`, (b) => b.hunt.status === 'hunted');
  assert.strictEqual(h.sources.length, 2);
  await call(`/api/hunts/${id}/create`, {});
  h = await until(`/api/hunts/${id}`, (b) => b.hunt.status === 'created');
  assert.deepStrictEqual(h.snowmobiles.map((s) => s.status), ['survivor', 'survivor', 'graveyard']);
  const [good, weak] = h.snowmobiles;

  let g = await until(`/api/grills/${good.id}`, (b) => !b.pending);
  const open = g.tree.decisions.filter((d) => !d.answer);
  assert.strictEqual(open.length, 2);
  assert.strictEqual((await call(`/api/grills/${good.id}/answer`, { answers: { scope: { choice: 0 } } })).status, 400);
  await call(`/api/grills/${good.id}/answer`, { answers: { scope: { choice: 0 }, lang: { choice: -1, note: 'Zig' } } });
  g = await until(`/api/grills/${good.id}`, (b) => b.status === 'done');
  assert.match(g.brief, /Build/);

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
