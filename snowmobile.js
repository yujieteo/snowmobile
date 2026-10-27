#!/usr/bin/env node
// snowmobile: hunt real software for parts, recombine them, then grill the result as a tree.
// One local process: an HTTP server on 127.0.0.1, one SQLite file, and the `claude` CLI.

const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

// ---------- database ----------

function openDb(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS hunts (
      id INTEGER PRIMARY KEY, seed TEXT NOT NULL, status TEXT NOT NULL, error TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS sources (
      id INTEGER PRIMARY KEY, hunt_id INTEGER NOT NULL, name TEXT, kind TEXT, url TEXT, summary TEXT);
    CREATE TABLE IF NOT EXISTS components (
      id INTEGER PRIMARY KEY, source_id INTEGER NOT NULL, name TEXT, mechanism TEXT, url TEXT,
      bad_reason TEXT);
    CREATE TABLE IF NOT EXISTS snowmobiles (
      id INTEGER PRIMARY KEY, hunt_id INTEGER NOT NULL, name TEXT, pitch TEXT, component_ids TEXT,
      status TEXT NOT NULL, proof_url TEXT, proof_note TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS grills (
      id INTEGER PRIMARY KEY, snowmobile_id INTEGER NOT NULL UNIQUE, tree TEXT NOT NULL,
      status TEXT NOT NULL, brief TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
  `);
  // A run that stopped mid-job leaves a status that no job will finish.
  db.prepare(`UPDATE hunts SET status = 'failed', error = 'snowmobile stopped during this step'
    WHERE status IN ('hunting', 'creating')`).run();
  return db;
}

function token(db) {
  const row = db.prepare(`SELECT value FROM meta WHERE key = 'token'`).get();
  if (row) return row.value;
  const t = crypto.randomBytes(16).toString('hex');
  db.prepare(`INSERT INTO meta (key, value) VALUES ('token', ?)`).run(t);
  return t;
}

// ---------- LLM ----------

// Runs `claude -p` with structured output. The prompt goes on stdin, so no text is read as an option.
function ask(cfg, prompt, schema, { web = false, model } = {}) {
  const tools = web ? 'WebSearch,WebFetch' : '';
  const args = ['-p', '--output-format', 'json', '--json-schema', JSON.stringify(schema),
    '--setting-sources', '', '--strict-mcp-config', '--no-session-persistence',
    '--tools', tools, '--allowedTools', tools];
  if (model) args.push('--model', model);
  return new Promise((resolve, reject) => {
    const child = spawn(cfg.claude, args, { cwd: cfg.home, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => child.kill(), 15 * 60 * 1000);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => { clearTimeout(timer); reject(new Error(`cannot run ${cfg.claude}: ${e.message}`)); });
    child.on('close', (code) => {
      clearTimeout(timer);
      let res;
      try { res = JSON.parse(out); } catch { return reject(new Error(`claude exited ${code}: ${(err || out).slice(0, 400)}`)); }
      if (res.is_error || !res.structured_output) return reject(new Error(`claude: ${String(res.result || res.subtype).slice(0, 400)}`));
      resolve(res.structured_output);
    });
    child.stdin.end(prompt);
  });
}

const BOYD = `A Boydian snowmobile (John Boyd, "Destruction and Creation") is a new whole built from parts taken out of unrelated wholes: skis, an outboard motor, tank treads and bicycle handlebars make a snowmobile.`;

const str = { type: 'string' };
const int = { type: 'integer' };

const HUNT_SCHEMA = {
  type: 'object', required: ['sources'],
  properties: { sources: { type: 'array', items: {
    type: 'object', required: ['name', 'kind', 'url', 'summary', 'components'],
    properties: { name: str, kind: { enum: ['tool', 'paradigm'] }, url: str, summary: str,
      components: { type: 'array', items: { type: 'object', required: ['name', 'mechanism', 'url'],
        properties: { name: str, mechanism: str, url: str } } } } } } },
};

function huntPrompt(seed, bad) {
  return `${BOYD}

You hunt for parts. Seed (a pain, a domain, a tool or a paradigm): ${JSON.stringify(seed)}

Use web search and fetch to find 6 real, existing software tools or programming paradigms: 2 close to the seed and 4 from distant domains that could carry a useful part for it.
Break each one into its 3 to 5 principal components. A component is a mechanism that makes the whole work ("content-addressed objects named by their hash"), never a quality ("fast", "scalable") or a feature list.
Each source and each component has a URL that you found and that shows it: docs, source code, a paper or a talk. Do not invent tools or URLs.
${bad.length ? `These components killed earlier ideas. Do not use them again:\n${bad.map((c) => `- ${c.name}: ${c.bad_reason}`).join('\n')}\n` : ''}Keep each summary and each mechanism to one sentence.`;
}

const CREATE_SCHEMA = {
  type: 'object', required: ['candidates'],
  properties: { candidates: { type: 'array', items: {
    type: 'object', required: ['name', 'pitch', 'component_ids', 'exists', 'proof_url', 'proof_note'],
    properties: { name: str, pitch: str, component_ids: { type: 'array', items: int },
      exists: { type: 'boolean' }, proof_url: str, proof_note: str } } } },
};

function createPrompt(seed, comps) {
  return `${BOYD}

Seed: ${JSON.stringify(seed)}
Parts (id, source, component, mechanism):
${comps.map((c) => `${c.id} | ${c.source} | ${c.name} | ${c.mechanism}`).join('\n')}

Combine parts from at least 2 different sources, the more distant the better, into 5 candidate snowmobiles: new software tools or techniques for the seed.
Each pitch is one concrete sentence: what a developer does with it and what the combination gives that no single source gives.
Then search the web for prior art for each candidate. If a product, project or paper already does the same thing with the same core mechanism, set exists to true, proof_url to it and proof_note to one sentence. Otherwise set exists to false, proof_url to "" and proof_note to the closest thing you found and the difference.
Be strict and honest: a surviving candidate that already exists wastes the owner's time.`;
}

const GRILL_SCHEMA = {
  type: 'object', required: ['verdict', 'decisions', 'brief', 'killed_component_id', 'reason'],
  properties: {
    verdict: { enum: ['open', 'done', 'killed'] },
    decisions: { type: 'array', items: {
      type: 'object', required: ['id', 'question', 'depends_on', 'options', 'recommended'],
      properties: { id: str, question: str, depends_on: { type: 'array', items: str },
        recommended: int,
        options: { type: 'array', items: { type: 'object', required: ['label', 'why', 'kills_component_id'],
          properties: { label: str, why: str, kills_component_id: int } } } } } },
    brief: str, killed_component_id: int, reason: str,
  },
};

function grillPrompt(sm, comps, decisions) {
  const settled = decisions.map((d) => {
    const a = d.answer;
    const choice = a.choice >= 0 ? d.options[a.choice].label : '(no option)';
    return `- ${d.id}: ${d.question}\n  answer: ${choice}${a.note ? `\n  note from the owner: ${a.note}` : ''}`;
  }).join('\n');
  return `You run Matt Pocock's "grill me" on a plan: walk the design tree, one round at a time, until no decision is open.

Plan: ${sm.name}. ${sm.pitch}
Parts (id | component | mechanism):
${comps.map((c) => `${c.id} | ${c.name} | ${c.mechanism}`).join('\n')}

Settled decisions:
${settled || '(none yet)'}

Return the next round: every open decision whose prerequisites are all settled, not only one. At most 6. Ask only decisions that change what gets built.
For each decision: a new short id (lowercase-with-dashes, not used above), the question, depends_on (ids of the settled decisions it builds on), 2 to 4 options with a short label and a one-sentence why, and the index of the option you recommend.
For an option that makes the whole plan pointless because one part fails, set kills_component_id to that part's id. Otherwise set it to 0. Never recommend such an option.
If a settled answer or note already makes the plan pointless, set verdict "killed", decisions [], killed_component_id to the part to blame and reason to one sentence.
If no decision is open, set verdict "done", decisions [] and brief to a build brief in Markdown: what to build, the settled decisions, the first three steps and the main risk.
Otherwise set verdict "open". Set unused fields to "" or 0. Aim for done in 3 to 5 rounds.`;
}

// ---------- jobs ----------

function partsOf(db, ids) {
  if (!ids.length) return [];
  return db.prepare(`SELECT c.*, s.name AS source FROM components c JOIN sources s ON s.id = c.source_id
    WHERE c.id IN (${ids.map(() => '?').join(',')})`).all(...ids);
}

async function runHunt(cfg, huntId) {
  const { db } = cfg;
  const hunt = db.prepare(`SELECT * FROM hunts WHERE id = ?`).get(huntId);
  try {
    const bad = db.prepare(`SELECT name, bad_reason FROM components WHERE bad_reason IS NOT NULL`).all();
    const out = await ask(cfg, huntPrompt(hunt.seed, bad), HUNT_SCHEMA, { web: true });
    const addSource = db.prepare(`INSERT INTO sources (hunt_id, name, kind, url, summary) VALUES (?, ?, ?, ?, ?)`);
    const addComp = db.prepare(`INSERT INTO components (source_id, name, mechanism, url) VALUES (?, ?, ?, ?)`);
    for (const s of out.sources) {
      const sid = addSource.run(huntId, s.name, s.kind, s.url, s.summary).lastInsertRowid;
      for (const c of s.components) addComp.run(sid, c.name, c.mechanism, c.url);
    }
    db.prepare(`UPDATE hunts SET status = 'hunted', error = NULL WHERE id = ?`).run(huntId);
  } catch (e) {
    db.prepare(`UPDATE hunts SET status = 'failed', error = ? WHERE id = ?`).run(e.message, huntId);
  }
}

async function runCreate(cfg, huntId) {
  const { db } = cfg;
  const hunt = db.prepare(`SELECT * FROM hunts WHERE id = ?`).get(huntId);
  try {
    const comps = db.prepare(`SELECT c.*, s.name AS source FROM components c JOIN sources s ON s.id = c.source_id
      WHERE s.hunt_id = ? AND c.bad_reason IS NULL`).all(huntId);
    const out = await ask(cfg, createPrompt(hunt.seed, comps), CREATE_SCHEMA, { web: true });
    const known = new Set(comps.map((c) => c.id));
    const add = db.prepare(`INSERT INTO snowmobiles (hunt_id, name, pitch, component_ids, status, proof_url, proof_note)
      VALUES (?, ?, ?, ?, ?, ?, ?)`);
    for (const c of out.candidates) {
      const ids = c.component_ids.filter((i) => known.has(i));
      add.run(huntId, c.name, c.pitch, JSON.stringify(ids), c.exists ? 'graveyard' : 'survivor', c.proof_url, c.proof_note);
    }
    db.prepare(`UPDATE hunts SET status = 'created', error = NULL WHERE id = ?`).run(huntId);
  } catch (e) {
    db.prepare(`UPDATE hunts SET status = 'failed', error = ? WHERE id = ?`).run(e.message, huntId);
  }
}

// The frontier for a set of settled answers. Calls are cached by that set, so the round that
// follows the recommended answers is computed while the owner still reads the current one.

function frontierKey(smId, settled) {
  return `${smId}:${JSON.stringify(settled.map((d) => [d.id, d.answer]))}`;
}

function frontier(cfg, sm, settled) {
  const { frontiers } = cfg;
  const key = frontierKey(sm.id, settled);
  if (!frontiers.has(key)) {
    const comps = partsOf(cfg.db, JSON.parse(sm.component_ids));
    const p = ask(cfg, grillPrompt(sm, comps, settled), GRILL_SCHEMA, { model: cfg.grillModel });
    p.catch(() => frontiers.delete(key));
    frontiers.set(key, p);
  }
  return frontiers.get(key);
}

function settledOf(tree) {
  return tree.decisions.filter((d) => d.answer);
}

// Asks for the round after the current tree, writes it into the tree, then speculates on the next.
async function advance(cfg, smId) {
  const { db, grillErrors } = cfg;
  const sm = db.prepare(`SELECT * FROM snowmobiles WHERE id = ?`).get(smId);
  const grill = db.prepare(`SELECT * FROM grills WHERE snowmobile_id = ?`).get(smId);
  const tree = JSON.parse(grill.tree);
  const settled = settledOf(tree);
  grillErrors.delete(smId);
  let out;
  try { out = await frontier(cfg, sm, settled); } catch (e) { grillErrors.set(smId, e.message); return; }
  // The owner may have answered differently while this call ran.
  const now = JSON.parse(db.prepare(`SELECT tree FROM grills WHERE snowmobile_id = ?`).get(smId).tree);
  if (frontierKey(smId, settledOf(now)) !== frontierKey(smId, settled) || now.decisions.some((d) => !d.answer)) return;
  if (out.verdict === 'killed') return kill(cfg, sm, out.killed_component_id, out.reason, now);
  if (out.verdict === 'done' || !out.decisions.length) {
    now.round += 1;
    db.prepare(`UPDATE grills SET tree = ?, status = 'done', brief = ?, updated_at = CURRENT_TIMESTAMP WHERE snowmobile_id = ?`)
      .run(JSON.stringify(now), out.brief, smId);
    db.prepare(`UPDATE snowmobiles SET status = 'grilled' WHERE id = ?`).run(smId);
    return;
  }
  now.round += 1;
  const used = new Set(now.decisions.map((d) => d.id));
  const parts = JSON.parse(sm.component_ids);
  for (const d of out.decisions) {
    for (const o of d.options) if (!parts.includes(o.kills_component_id)) o.kills_component_id = 0;
    let id = d.id;
    while (used.has(id)) id += '-';
    used.add(id);
    const rec = d.options[d.recommended] && !d.options[d.recommended].kills_component_id ? d.recommended
      : Math.max(0, d.options.findIndex((o) => !o.kills_component_id));
    now.decisions.push({ ...d, id, recommended: rec, round: now.round, answer: null });
  }
  db.prepare(`UPDATE grills SET tree = ?, updated_at = CURRENT_TIMESTAMP WHERE snowmobile_id = ?`).run(JSON.stringify(now), smId);
  // Speculate: the next round after the recommended answers.
  const guess = now.decisions.map((d) => (d.answer ? d : { ...d, answer: { choice: d.recommended, note: '' } }));
  frontier(cfg, sm, guess).catch(() => {});
}

function kill(cfg, sm, componentId, reason, tree) {
  const { db } = cfg;
  if (!JSON.parse(sm.component_ids).includes(componentId)) componentId = 0;
  if (componentId) db.prepare(`UPDATE components SET bad_reason = ? WHERE id = ?`).run(`${sm.name}: ${reason}`, componentId);
  db.prepare(`UPDATE snowmobiles SET status = 'killed', proof_note = ? WHERE id = ?`).run(reason, sm.id);
  tree.killed = { component_id: componentId, reason };
  db.prepare(`UPDATE grills SET tree = ?, status = 'killed', updated_at = CURRENT_TIMESTAMP WHERE snowmobile_id = ?`)
    .run(JSON.stringify(tree), sm.id);
}

// ---------- HTTP ----------

function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let b = '';
    req.on('data', (d) => { b += d; if (b.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { reject(e); } });
  });
}

function huntView(db, id) {
  const hunt = db.prepare(`SELECT * FROM hunts WHERE id = ?`).get(id);
  if (!hunt) return null;
  const sources = db.prepare(`SELECT * FROM sources WHERE hunt_id = ?`).all(id);
  for (const s of sources) s.components = db.prepare(`SELECT * FROM components WHERE source_id = ?`).all(s.id);
  const snowmobiles = db.prepare(`SELECT * FROM snowmobiles WHERE hunt_id = ? ORDER BY id`).all(id)
    .map((s) => ({ ...s, component_ids: JSON.parse(s.component_ids) }));
  return { hunt, sources, snowmobiles };
}

function grillView(cfg, smId) {
  const { db, grillErrors } = cfg;
  const sm = db.prepare(`SELECT * FROM snowmobiles WHERE id = ?`).get(smId);
  if (!sm) return null;
  const grill = db.prepare(`SELECT * FROM grills WHERE snowmobile_id = ?`).get(smId);
  const tree = JSON.parse(grill.tree);
  const pending = grill.status === 'open' && !tree.decisions.some((d) => !d.answer);
  return { snowmobile: { ...sm, component_ids: JSON.parse(sm.component_ids) },
    components: partsOf(db, JSON.parse(sm.component_ids)), tree, status: grill.status, brief: grill.brief,
    pending: pending && !grillErrors.has(smId), error: grillErrors.get(smId) || null };
}

function search(db, q) {
  const like = `%${q}%`;
  return {
    hunts: db.prepare(`SELECT * FROM hunts WHERE seed LIKE ? ORDER BY id DESC LIMIT 100`).all(like),
    snowmobiles: db.prepare(`SELECT s.*, h.seed FROM snowmobiles s JOIN hunts h ON h.id = s.hunt_id
      LEFT JOIN grills g ON g.snowmobile_id = s.id
      WHERE s.name LIKE ? OR s.pitch LIKE ? OR s.proof_note LIKE ? OR g.brief LIKE ? OR g.tree LIKE ?
      ORDER BY s.id DESC LIMIT 200`).all(like, like, like, like, like),
    components: db.prepare(`SELECT c.*, s.name AS source, s.hunt_id FROM components c JOIN sources s ON s.id = c.source_id
      WHERE c.name LIKE ? OR c.mechanism LIKE ? OR s.name LIKE ? ORDER BY c.id DESC LIMIT 200`).all(like, like, like),
  };
}

function handler(cfg) {
  const { db } = cfg;
  const page = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  return async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const t = Buffer.from(String(url.searchParams.get('token') || req.headers['x-token'] || ''));
    const want = Buffer.from(cfg.token);
    if (t.length !== want.length || !crypto.timingSafeEqual(t, want)) {
      return send(res, 403, 'Open the URL that snowmobile printed at start, with its token.\n', 'text/plain');
    }
    const p = url.pathname;
    const m = (re) => p.match(re);
    let r;
    try {
      if (req.method === 'GET' && p === '/') {
        return send(res, 200, page, 'text/html; charset=utf-8');
      }
      if (req.method === 'POST' && p === '/api/hunts') {
        const { seed } = await readBody(req);
        if (!seed || !String(seed).trim()) return send(res, 400, { error: 'seed is empty' });
        const id = db.prepare(`INSERT INTO hunts (seed, status) VALUES (?, 'hunting')`).run(String(seed).trim()).lastInsertRowid;
        runHunt(cfg, id);
        return send(res, 200, { id });
      }
      if (req.method === 'GET' && (r = m(/^\/api\/hunts\/(\d+)$/))) {
        const v = huntView(db, Number(r[1]));
        return v ? send(res, 200, v) : send(res, 404, { error: 'no such hunt' });
      }
      if (req.method === 'POST' && (r = m(/^\/api\/hunts\/(\d+)\/(hunt|create)$/))) {
        const id = Number(r[1]);
        const hunt = db.prepare(`SELECT * FROM hunts WHERE id = ?`).get(id);
        if (!hunt) return send(res, 404, { error: 'no such hunt' });
        if (hunt.status === 'hunting' || hunt.status === 'creating') return send(res, 409, { error: 'a step already runs' });
        const hunting = r[2] === 'hunt';
        db.prepare(`UPDATE hunts SET status = ?, error = NULL WHERE id = ?`).run(hunting ? 'hunting' : 'creating', id);
        (hunting ? runHunt : runCreate)(cfg, id);
        return send(res, 200, { id });
      }
      if (req.method === 'GET' && (r = m(/^\/api\/grills\/(\d+)$/))) {
        const smId = Number(r[1]);
        if (!db.prepare(`SELECT 1 FROM snowmobiles WHERE id = ?`).get(smId)) return send(res, 404, { error: 'no such snowmobile' });
        if (!db.prepare(`SELECT 1 FROM grills WHERE snowmobile_id = ?`).get(smId)) {
          db.prepare(`INSERT INTO grills (snowmobile_id, tree, status) VALUES (?, ?, 'open')`)
            .run(smId, JSON.stringify({ round: 0, decisions: [] }));
        }
        // A grill that waits for a round that no call computes (a new grill, or a restart mid-call).
        const grill = db.prepare(`SELECT * FROM grills WHERE snowmobile_id = ?`).get(smId);
        const tree = JSON.parse(grill.tree);
        if (grill.status === 'open' && tree.decisions.every((d) => d.answer)
          && !cfg.frontiers.has(frontierKey(smId, settledOf(tree))) && !cfg.grillErrors.has(smId)) advance(cfg, smId);
        return send(res, 200, grillView(cfg, smId));
      }
      if (req.method === 'POST' && (r = m(/^\/api\/grills\/(\d+)\/(answer|retry)$/))) {
        const smId = Number(r[1]);
        const grill = db.prepare(`SELECT * FROM grills WHERE snowmobile_id = ?`).get(smId);
        if (!grill || grill.status !== 'open') return send(res, 409, { error: 'this grill is not open' });
        const tree = JSON.parse(grill.tree);
        if (r[2] === 'answer') {
          const { answers } = await readBody(req);
          const open = tree.decisions.filter((d) => !d.answer);
          for (const d of open) {
            const a = answers && answers[d.id];
            if (!a || !Number.isInteger(a.choice) || a.choice < -1 || a.choice >= d.options.length) {
              return send(res, 400, { error: `no answer for ${d.id}` });
            }
            d.answer = { choice: a.choice, note: String(a.note || '').trim().slice(0, 2000) };
          }
          const killer = open.find((d) => d.answer.choice >= 0 && d.options[d.answer.choice].kills_component_id);
          if (killer) {
            const sm = db.prepare(`SELECT * FROM snowmobiles WHERE id = ?`).get(smId);
            const opt = killer.options[killer.answer.choice];
            kill(cfg, sm, opt.kills_component_id, `${killer.question} ${opt.label}: ${opt.why}`, tree);
            return send(res, 200, grillView(cfg, smId));
          }
          db.prepare(`UPDATE grills SET tree = ?, updated_at = CURRENT_TIMESTAMP WHERE snowmobile_id = ?`).run(JSON.stringify(tree), smId);
        }
        advance(cfg, smId);
        return send(res, 200, grillView(cfg, smId));
      }
      if (req.method === 'GET' && p === '/api/search') {
        return send(res, 200, search(db, url.searchParams.get('q') || ''));
      }
      return send(res, 404, { error: 'not found' });
    } catch (e) {
      return send(res, 500, { error: e.message });
    }
  };
}

function start({ home = path.join(os.homedir(), '.snowmobile'), port = 4747, claude = 'claude',
  grillModel = 'sonnet' } = {}) {
  const db = openDb(path.join(home, 'snowmobile.db'));
  const cfg = { db, home, claude, grillModel, token: token(db), frontiers: new Map(), grillErrors: new Map() };
  const server = http.createServer(handler(cfg));
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    // Only this machine. The phone reaches it through an SSH local port forward.
    server.listen(port, '127.0.0.1', () => resolve({ server, cfg, port: server.address().port }));
  });
}

if (require.main === module) {
  const env = process.env;
  start({ home: env.SNOWMOBILE_HOME || undefined, port: env.PORT ? Number(env.PORT) : undefined,
    claude: env.SNOWMOBILE_CLAUDE || undefined }).then(({ cfg, port }) => {
    console.log(`snowmobile: http://127.0.0.1:${port}/?token=${cfg.token}`);
    console.log(`database:   ${path.join(cfg.home, 'snowmobile.db')}`);
    console.log(`phone:      ssh -L ${port}:127.0.0.1:${port} <this-machine>, then open the same URL`);
  }, (e) => { console.error(`snowmobile: ${e.message}`); process.exit(1); });
}

module.exports = { start };
