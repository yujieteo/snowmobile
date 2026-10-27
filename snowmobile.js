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
    CREATE TABLE IF NOT EXISTS paradigms (
      id INTEGER PRIMARY KEY, layer TEXT NOT NULL, name TEXT NOT NULL, summary TEXT, url TEXT);
    CREATE TABLE IF NOT EXISTS axes (id INTEGER PRIMARY KEY, name TEXT NOT NULL, low TEXT, high TEXT);
    CREATE TABLE IF NOT EXISTS scores (
      paradigm_id INTEGER NOT NULL, axis_id INTEGER NOT NULL, score INTEGER NOT NULL, reason TEXT,
      PRIMARY KEY (paradigm_id, axis_id));
  `);
  // Columns that came after the first release. Adding them keeps each existing row.
  for (const [table, column] of [['hunts', 'stack'], ['components', 'paradigm_id'], ['snowmobiles', 'mismatch'],
    ['snowmobiles', 'problem'], ['snowmobiles', 'evidence_url'], ['snowmobiles', 'conventional'],
    ['snowmobiles', 'gain_axis'], ['snowmobiles', 'gain']]) {
    if (!db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${column === 'paradigm_id' ? 'INTEGER' : 'TEXT'}`);
    }
  }
  if (!db.prepare(`SELECT 1 FROM paradigms LIMIT 1`).get()) {
    const add = db.prepare(`INSERT INTO paradigms (layer, name, summary, url) VALUES (?, ?, ?, ?)`);
    for (const [layer, list] of Object.entries(START)) for (const p of list) add.run(layer, ...p);
  }
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

// ---------- stack ----------

// The four layers of a stack, from the program down to the machine and back up to the product.
const LAYERS = { language: 'Programming language', hardware: 'Hardware', os: 'Operating system', software: 'Software' };

// The start list. Languages follow Van Roy's taxonomy, hardware follows Patterson and Hennessy,
// operating systems follow the kernel designs of an OS book, software follows the main architecture styles.
const W = 'https://en.wikipedia.org/wiki/';
const START = {
  language: [
    ['Imperative programming', 'A program is a sequence of commands that change named, mutable state.', `${W}Imperative_programming`],
    ['Functional programming', 'A program is the composition of pure functions over immutable values.', `${W}Functional_programming`],
    ['Object-oriented programming', 'Objects bundle state with the methods that change it and send messages to each other.', `${W}Object-oriented_programming`],
    ['Logic programming', 'A program is a set of facts and rules, and a search engine derives the answers.', `${W}Logic_programming`],
    ['Constraint programming', 'The programmer states relations between variables and a solver finds the values.', `${W}Constraint_programming`],
    ['Actor model', 'Independent actors own their state and talk only through asynchronous messages.', `${W}Actor_model`],
    ['Dataflow programming', 'Operations run when their inputs arrive, so the graph of data sets the order.', `${W}Dataflow_programming`],
    ['Functional reactive programming', 'Values that change over time are first-class and the runtime propagates each change.', `${W}Functional_reactive_programming`],
  ],
  hardware: [
    ['Pipelined RISC processor', 'Simple fixed-length instructions overlap in a five-stage pipeline.', `${W}Classic_RISC_pipeline`],
    ['Out-of-order superscalar', 'Hardware finds independent instructions at run time and issues several in each cycle.', `${W}Out-of-order_execution`],
    ['VLIW', 'The compiler packs independent operations into one long instruction at build time.', `${W}Very_long_instruction_word`],
    ['Vector processor', 'One instruction operates on a whole vector of data elements.', `${W}Vector_processor`],
    ['GPU (SIMT)', 'Thousands of threads run in lockstep groups and hide memory latency by switching groups.', `${W}Single_instruction,_multiple_threads`],
    ['Shared-memory multiprocessor', 'Several cores share one coherent address space through caches.', `${W}Symmetric_multiprocessing`],
    ['Cluster (warehouse-scale computer)', 'Many cheap servers connected by a network act as one computer.', `${W}Computer_cluster`],
    ['Domain-specific accelerator', 'Hardware built for one class of work, such as the systolic arrays of a TPU.', `${W}Tensor_Processing_Unit`],
  ],
  os: [
    ['Monolithic kernel', 'All operating system services run in one privileged address space.', `${W}Monolithic_kernel`],
    ['Microkernel', 'The kernel keeps only address spaces, threads and IPC; services run as user processes.', `${W}Microkernel`],
    ['Exokernel', 'The kernel only multiplexes hardware safely and libraries implement the abstractions.', `${W}Exokernel`],
    ['Unikernel', 'One application and the library OS that it needs compile into one single-address-space image.', `${W}Unikernel`],
    ['Hypervisor', 'A thin layer runs several complete operating systems on virtual hardware.', `${W}Hypervisor`],
    ['Capability-based OS', 'A process can use a resource only through an unforgeable capability that names it.', `${W}Capability-based_security`],
    ['Real-time OS', 'The scheduler guarantees that each task meets its deadline.', `${W}Real-time_operating_system`],
    ['Distributed OS', 'Many machines appear to the user as one system with one namespace.', `${W}Distributed_operating_system`],
  ],
  software: [
    ['Client-server', 'Clients send requests to a central server that owns the data.', `${W}Client%E2%80%93server_model`],
    ['Peer-to-peer', 'Equal peers share resources directly without a central server.', `${W}Peer-to-peer`],
    ['Event-driven architecture', 'Components publish events and other components react to them.', `${W}Event-driven_architecture`],
    ['Pipes and filters', 'Each filter transforms a stream and passes it to the next filter.', `${W}Pipeline_(software)`],
    ['Microservices', 'Small services that each own their data talk over the network.', `${W}Microservices`],
    ['Serverless', 'The platform runs a function for each request and bills only that run.', `${W}Serverless_computing`],
    ['Local-first software', 'The primary copy of the data lives on the device and syncs to others when it can.', 'https://www.inkandswitch.com/local-first/'],
    ['Event sourcing', 'The state is the result of replaying an append-only log of events.', 'https://martinfowler.com/eaaDev/EventSourcing.html'],
  ],
};

// A gap of this size or more (out of 10) on one axis is a mismatch between the layers of a stack.
const MISMATCH = 5;

// Eigenvalues and eigenvectors of a symmetric matrix by cyclic Jacobi rotations.
// Returns pairs sorted by eigenvalue, largest first; each vector has its largest entry positive.
function eigen(m) {
  const n = m.length;
  const a = m.map((r) => [...r]);
  const v = a.map((_, i) => a.map((_, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += a[p][q] ** 2;
    if (off < 1e-20) break;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
      if (Math.abs(a[p][q]) < 1e-300) continue;
      const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < n; k++) {
        const kp = a[k][p], kq = a[k][q];
        a[k][p] = c * kp - s * kq; a[k][q] = s * kp + c * kq;
      }
      for (let k = 0; k < n; k++) {
        const pk = a[p][k], qk = a[q][k];
        a[p][k] = c * pk - s * qk; a[q][k] = s * pk + c * qk;
      }
      for (let k = 0; k < n; k++) {
        const kp = v[k][p], kq = v[k][q];
        v[k][p] = c * kp - s * kq; v[k][q] = s * kp + c * kq;
      }
    }
  }
  return a.map((_, i) => {
    const vec = v.map((r) => r[i]);
    const big = vec.reduce((b, x) => (Math.abs(x) > Math.abs(b) ? x : b), 0);
    return { value: a[i][i], vector: big < 0 ? vec.map((x) => -x) : vec };
  }).sort((x, y) => y.value - x.value);
}

// Principal component analysis of the rows (paradigms) over the columns (axes): centre each column,
// take the eigenvectors of the covariance, and project each row on the first two.
function pca(rows) {
  const n = rows.length, d = rows[0]?.length || 0;
  if (n < 3 || d < 2) return null;
  const mean = rows[0].map((_, j) => rows.reduce((s, r) => s + r[j], 0) / n);
  const x = rows.map((r) => r.map((v, j) => v - mean[j]));
  const cov = mean.map((_, i) => mean.map((_, j) => x.reduce((s, r) => s + r[i] * r[j], 0) / (n - 1)));
  const eig = eigen(cov);
  const total = eig.reduce((s, e) => s + Math.max(0, e.value), 0) || 1;
  const pcs = eig.slice(0, 2);
  return { mean, components: pcs.map((e) => e.vector), explained: pcs.map((e) => Math.max(0, e.value) / total),
    points: x.map((r) => pcs.map((e) => r.reduce((s, v, j) => s + v * e.vector[j], 0))) };
}

// The spread of the chosen paradigms on each axis. A large spread is a mismatch, a chance for a new idea.
function gaps(axes, scores, ids) {
  return axes.map((a) => {
    const vals = ids.map((id) => scores[id]?.[a.id]?.score).filter((v) => v !== undefined);
    const gap = vals.length > 1 ? Math.max(...vals) - Math.min(...vals) : 0;
    return { axis_id: a.id, name: a.name, gap, mismatch: gap >= MISMATCH };
  });
}

function stackData(db) {
  const axes = db.prepare(`SELECT * FROM axes ORDER BY id`).all();
  const paradigms = db.prepare(`SELECT * FROM paradigms ORDER BY layer, id`).all();
  const scores = {};
  for (const s of db.prepare(`SELECT * FROM scores`).all()) (scores[s.paradigm_id] ||= {})[s.axis_id] = s;
  const full = paradigms.filter((p) => axes.length && axes.every((a) => scores[p.id]?.[a.id]));
  const map = pca(full.map((p) => axes.map((a) => scores[p.id][a.id].score)));
  return { axes, paradigms, scores, map: map && { ...map, ids: full.map((p) => p.id) } };
}

function stackView(cfg, pick) {
  const data = stackData(cfg.db);
  const ids = pick.filter((id) => data.paradigms.some((p) => p.id === id));
  return { ...data, layers: LAYERS, mismatch: MISMATCH, job: cfg.stackJob,
    gaps: ids.length > 1 ? gaps(data.axes, data.scores, ids) : [] };
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
    type: 'object', required: ['name', 'pitch', 'component_ids', 'problem', 'evidence_url', 'conventional',
      'gain_axis', 'gain', 'mismatch', 'verdict', 'proof_url', 'proof_note'],
    properties: { name: str, pitch: str, component_ids: { type: 'array', items: int },
      problem: str, evidence_url: str, conventional: str, gain_axis: str, gain: str, mismatch: str,
      verdict: { enum: ['survives', 'exists', 'no clear problem', 'no clear gain'] },
      proof_url: str, proof_note: str } } } },
};

// The case that each candidate must make before its creative description counts.
const PROBLEM = `For each candidate, also fill these 4 fields:
- problem: who has the problem, and what it is, in one sentence.
- evidence_url: a page that your web search found and that shows people have this problem: a forum thread, a review, an issue or an article. Never invent it.
- conventional: the solution that people use today, as a named product or method.
- gain_axis: the one axis on which this candidate does better (cost, speed, privacy, offline use, effort or similar), and gain: the mechanism by which it does better, with a claim that a test could prove false ("opens a 1 GB file in under 1 second on a 2020 phone, where X takes 30 seconds").
Then set verdict:
- "exists" if a product, project or paper already does the same thing with the same core mechanism: proof_url to it and proof_note to one sentence.
- "no clear problem" if you found no real source for the problem, and "no clear gain" if the candidate does not clearly beat the conventional solution on a named axis: proof_url "" and proof_note to one sentence why.
- "survives" otherwise: proof_url "" and proof_note to the closest thing you found and the difference.
Be strict and honest: a surviving candidate that already exists, or that solves no real problem better than today's solution, wastes the owner's time.`;

function createPrompt(seed, comps) {
  return `${BOYD}

Seed: ${JSON.stringify(seed)}
Parts (id, source, component, mechanism):
${comps.map((c) => `${c.id} | ${c.source} | ${c.name} | ${c.mechanism}`).join('\n')}

Combine parts from at least 2 different sources, the more distant the better, into 5 candidate snowmobiles: new software tools or techniques for the seed.
Each pitch is one concrete sentence: what a developer does with it and what the combination gives that no single source gives.
Search the web for the problem and for prior art for each candidate. Set mismatch to "".
${PROBLEM}`;
}

function stackCreatePrompt(seed, comps, data) {
  const { axes, scores } = data;
  const fixed = Object.keys(LAYERS).filter((l) => comps.filter((c) => c.source_kind === l).length === 1);
  const ids = comps.filter((c) => fixed.includes(c.source_kind)).map((c) => c.paradigm_id);
  const spread = ids.length > 1 ? gaps(axes, scores, ids) : [];
  return `A stack is one paradigm from each of 4 layers: ${Object.values(LAYERS).join(', ')}.
Where two layers of a stack disagree on a design axis, there is a mismatch: a chance for a product that no conventional stack makes possible, cheap or fast.

Seed (a consumer pain, a stack, or both): ${JSON.stringify(seed)}
Design axes (id | name | 0 means | 10 means):
${axes.map((a) => `${a.id} | ${a.name} | ${a.low} | ${a.high}`).join('\n') || '(none yet)'}
Paradigms (id | layer | paradigm | summary | scores as axis id=score):
${comps.map((c) => `${c.id} | ${c.source_kind} | ${c.name} | ${c.mechanism} | ${axes.map((a) => `${a.id}=${scores[c.paradigm_id]?.[a.id]?.score ?? '?'}`).join(' ')}`).join('\n')}
${spread.length ? `Gaps of the fixed layers on each axis (max - min): ${spread.map((g) => `${g.name} ${g.gap}`).join(', ')}\n` : ''}
Propose 5 candidate consumer apps: software that ordinary people use, not developer tools. Each candidate uses exactly one paradigm id from each layer as component_ids; a layer with only one paradigm above is fixed.
The stack is the unfair advantage: it makes the app possible, cheap or fast where a conventional stack cannot.
Each pitch is one concrete sentence: what a person does with the app and what the stack gives.
Set mismatch to one sentence that names the 2 layers, their paradigms and the axis on which they disagree, and how the app uses that mismatch.
Search the web for the problem and for prior art for each candidate.
${PROBLEM}`;
}

const AXES_SCHEMA = {
  type: 'object', required: ['axes'],
  properties: { axes: { type: 'array', items: { type: 'object', required: ['name', 'low', 'high'],
    properties: { name: str, low: str, high: str } } } },
};

function axesPrompt(paradigms) {
  return `You design the axes of a map of computing paradigms in 4 layers: ${Object.values(LAYERS).join(', ')}.
Paradigms (layer | name | summary):
${paradigms.map((p) => `${p.layer} | ${p.name} | ${p.summary}`).join('\n')}

Propose 8 to 12 design axes that run through all 4 layers, so that a paradigm of each layer has a position on each axis. Examples: where state lives, when binding happens, who schedules, how parallelism is shown.
For each axis: a short name, what a score of 0 means (low) and what a score of 10 means (high), each in a few words.
Prefer axes that separate the paradigms well and that are not the same axis twice.`;
}

const SCORE_SCHEMA = {
  type: 'object', required: ['scores'],
  properties: { scores: { type: 'array', items: { type: 'object', required: ['paradigm_id', 'axis_id', 'score', 'reason'],
    properties: { paradigm_id: int, axis_id: int, score: int, reason: str } } } },
};

function scorePrompt(axes, paradigms) {
  return `Score each paradigm on each design axis, from 0 to 10, with a one-line reason.
Axes (id | name | 0 means | 10 means):
${axes.map((a) => `${a.id} | ${a.name} | ${a.low} | ${a.high}`).join('\n')}
Paradigms (id | layer | name | summary):
${paradigms.map((p) => `${p.id} | ${p.layer} | ${p.name} | ${p.summary}`).join('\n')}

Return one score for each pair of paradigm and axis. Use the whole range, so that the paradigms spread out.`;
}

const PARADIGM_SCHEMA = {
  type: 'object', required: ['paradigms'],
  properties: { paradigms: { type: 'array', items: { type: 'object', required: ['layer', 'name', 'summary', 'url'],
    properties: { layer: { enum: Object.keys(LAYERS) }, name: str, summary: str, url: str } } } },
};

function paradigmPrompt(paradigms) {
  return `You hunt for paradigms in 4 layers of a computing stack: ${Object.entries(LAYERS).map(([k, v]) => `${k} (${v})`).join(', ')}.
The map has these already:
${paradigms.map((p) => `${p.layer} | ${p.name}`).join('\n')}

Use web search and fetch to find 8 more real paradigms, 2 in each layer, that are far from the ones above: from research, history or niche practice.
Each has a one-sentence summary of its mechanism and a URL that you found and that shows it: docs, a paper or a talk. Do not invent paradigms or URLs.`;
}

const POINT_SCHEMA = {
  type: 'object', required: ['layer', 'name', 'exists', 'url', 'why'],
  properties: { layer: { enum: Object.keys(LAYERS) }, name: str, exists: { type: 'boolean' }, url: str, why: str },
};

function pointPrompt(axes, profile, near) {
  return `A map of computing paradigms in 4 layers (${Object.values(LAYERS).join(', ')}) has an empty point with this profile (axis: score out of 10, where 0 and 10 mean):
${axes.map((a, i) => `${a.name}: ${profile[i]} (0 = ${a.low}, 10 = ${a.high})`).join('\n')}
The nearest paradigms on the map: ${near.map((p) => `${p.name} (${p.layer})`).join(', ')}.

Which paradigm would live at this point? Name a real one if one fits, with exists true and its URL; else name and describe the paradigm that is missing, with exists false and url "".
Set why to one or two sentences: how it fits the profile and how it differs from the nearest paradigms.`;
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
${sm.problem ? `Problem: ${sm.problem}\nConventional solution: ${sm.conventional}\nClaimed gain (${sm.gain_axis}): ${sm.gain}\n` : ''}Parts (id | component | mechanism):
${comps.map((c) => `${c.id} | ${c.name} | ${c.mechanism}`).join('\n')}

Settled decisions:
${settled || '(none yet)'}

Return the next round: every open decision whose prerequisites are all settled, not only one. At most 6. Ask only decisions that change what gets built.
${settled ? '' : 'This is the first round. It must include a decision that tests why the plan beats the conventional solution on its claimed gain: an option under which the gain fails makes the plan pointless.\n'}
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
    if (hunt.stack) throw new Error('a stack hunt takes its parts from the stack map');
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

// A candidate without a real problem or a clear gain goes to the graveyard, the same way as prior art.
function graveOf(c) {
  if (c.verdict === 'exists') return 'exists';
  const blank = (k) => !String(c[k] || '').trim();
  if (c.verdict === 'no clear problem' || blank('problem') || !/^https?:\/\//i.test(c.evidence_url || '')) return 'no clear problem';
  if (c.verdict === 'no clear gain' || blank('conventional') || blank('gain_axis') || blank('gain')) return 'no clear gain';
  return null;
}

async function runCreate(cfg, huntId) {
  const { db } = cfg;
  const hunt = db.prepare(`SELECT * FROM hunts WHERE id = ?`).get(huntId);
  try {
    const comps = db.prepare(`SELECT c.*, s.name AS source, s.kind AS source_kind FROM components c JOIN sources s ON s.id = c.source_id
      WHERE s.hunt_id = ? AND c.bad_reason IS NULL`).all(huntId);
    const prompt = hunt.stack ? stackCreatePrompt(hunt.seed, comps, stackData(db)) : createPrompt(hunt.seed, comps);
    const out = await ask(cfg, prompt, CREATE_SCHEMA, { web: true });
    const known = new Set(comps.map((c) => c.id));
    const add = db.prepare(`INSERT INTO snowmobiles (hunt_id, name, pitch, component_ids, status, proof_url, proof_note,
      problem, evidence_url, conventional, gain_axis, gain, mismatch) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const c of out.candidates) {
      const ids = c.component_ids.filter((i) => known.has(i));
      const grave = graveOf(c);
      const proofUrl = grave === 'exists' ? c.proof_url : '';
      const note = grave && grave !== 'exists' ? `${grave[0].toUpperCase()}${grave.slice(1)}: ${c.proof_note}` : c.proof_note;
      add.run(huntId, c.name, c.pitch, JSON.stringify(ids), grave ? 'graveyard' : 'survivor', proofUrl, note,
        c.problem, c.evidence_url, c.conventional, c.gain_axis, c.gain, hunt.stack ? c.mismatch : null);
    }
    db.prepare(`UPDATE hunts SET status = 'created', error = NULL WHERE id = ?`).run(huntId);
  } catch (e) {
    db.prepare(`UPDATE hunts SET status = 'failed', error = ? WHERE id = ?`).run(e.message, huntId);
  }
}

// A stack hunt takes its parts from the map: the chosen paradigm of each layer, or each paradigm
// of a layer with no choice. Each paradigm is a source with one component, so a kill marks it.
function plantStack(db, huntId, pick) {
  const chosen = db.prepare(`SELECT * FROM paradigms`).all();
  const addSource = db.prepare(`INSERT INTO sources (hunt_id, name, kind, url, summary) VALUES (?, ?, ?, ?, ?)`);
  const addComp = db.prepare(`INSERT INTO components (source_id, name, mechanism, url, paradigm_id) VALUES (?, ?, ?, ?, ?)`);
  for (const layer of Object.keys(LAYERS)) {
    const own = chosen.filter((p) => p.layer === layer);
    for (const p of own.some((q) => pick.includes(q.id)) ? own.filter((q) => pick.includes(q.id)) : own) {
      const sid = addSource.run(huntId, p.name, layer, p.url, p.summary).lastInsertRowid;
      addComp.run(sid, p.name, p.summary, p.url, p.id);
    }
  }
}

// The map jobs: propose the axes once, score each paradigm that misses a score, and hunt for more paradigms.
// One job at a time. A restart forgets a running job, and nothing waits for it.
async function scoreMissing(cfg) {
  const { db } = cfg;
  const axes = db.prepare(`SELECT * FROM axes ORDER BY id`).all();
  if (!axes.length) return;
  const missing = db.prepare(`SELECT * FROM paradigms p WHERE (SELECT COUNT(*) FROM scores s WHERE s.paradigm_id = p.id) < ?`)
    .all(axes.length);
  if (!missing.length) return;
  cfg.stackJob = { step: 'scoring' };
  const out = await ask(cfg, scorePrompt(axes, missing), SCORE_SCHEMA);
  const pids = new Set(missing.map((p) => p.id)), aids = new Set(axes.map((a) => a.id));
  // An owner's edit is never overwritten.
  const add = db.prepare(`INSERT OR IGNORE INTO scores (paradigm_id, axis_id, score, reason) VALUES (?, ?, ?, ?)`);
  for (const s of out.scores) {
    if (pids.has(s.paradigm_id) && aids.has(s.axis_id)) add.run(s.paradigm_id, s.axis_id, Math.min(10, Math.max(0, s.score)), s.reason);
  }
}

async function runStackJob(cfg, step) {
  const { db } = cfg;
  cfg.stackJob = { step };
  try {
    if (step === 'axes' && !db.prepare(`SELECT 1 FROM axes LIMIT 1`).get()) {
      const out = await ask(cfg, axesPrompt(db.prepare(`SELECT * FROM paradigms`).all()), AXES_SCHEMA);
      const add = db.prepare(`INSERT INTO axes (name, low, high) VALUES (?, ?, ?)`);
      for (const a of out.axes.slice(0, 12)) add.run(a.name, a.low, a.high);
    }
    if (step === 'hunting') {
      const have = db.prepare(`SELECT * FROM paradigms`).all();
      const out = await ask(cfg, paradigmPrompt(have), PARADIGM_SCHEMA, { web: true });
      const names = new Set(have.map((p) => p.name.toLowerCase()));
      const add = db.prepare(`INSERT INTO paradigms (layer, name, summary, url) VALUES (?, ?, ?, ?)`);
      for (const p of out.paradigms) {
        if (LAYERS[p.layer] && !names.has(p.name.toLowerCase())) { names.add(p.name.toLowerCase()); add.run(p.layer, p.name, p.summary, p.url); }
      }
    }
    await scoreMissing(cfg);
    cfg.stackJob = null;
  } catch (e) {
    cfg.stackJob = { step, error: e.message };
  }
}

// Asks which paradigm would live at an empty point of the map. The point maps back to a profile
// on the axes: the mean plus x times the first component plus y times the second.
async function askPoint(cfg, x, y) {
  const data = stackData(cfg.db);
  const { map, axes } = data;
  if (!map) throw new Error('the map needs axes and scores first');
  const profile = map.mean.map((m, j) => Math.round(10 * Math.min(10, Math.max(0, m + x * map.components[0][j] + y * map.components[1][j]))) / 10);
  const near = map.ids.map((id, i) => ({ id, d: Math.hypot(map.points[i][0] - x, map.points[i][1] - y) }))
    .sort((a, b) => a.d - b.d).slice(0, 3).map((n) => data.paradigms.find((p) => p.id === n.id));
  const answer = await ask(cfg, pointPrompt(axes, profile, near), POINT_SCHEMA);
  return { x, y, profile, answer };
}

// The lines that each build brief starts with: the case for the idea, and for a stack the mismatch that it uses.
function briefHead(sm) {
  if (!sm.problem) return '';
  return [`**Problem:** ${sm.problem}`, `**Evidence:** ${sm.evidence_url}`, `**Conventional solution:** ${sm.conventional}`,
    `**Why better (${sm.gain_axis}):** ${sm.gain}`, ...(sm.mismatch ? [`**Layer mismatch:** ${sm.mismatch}`] : [])].join('\n') + '\n\n';
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
      .run(JSON.stringify(now), briefHead(sm) + out.brief, smId);
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
  const badReason = componentId ? db.prepare(`SELECT bad_reason FROM components WHERE id = ?`).get(componentId).bad_reason : null;
  if (componentId) db.prepare(`UPDATE components SET bad_reason = ? WHERE id = ?`).run(`${sm.name}: ${reason}`, componentId);
  db.prepare(`UPDATE snowmobiles SET status = 'killed', proof_note = ? WHERE id = ?`).run(reason, sm.id);
  // The note and the part mark that the kill replaces, so that an undo can put them back.
  tree.killed = { component_id: componentId, reason, note: sm.proof_note, bad_reason: badReason };
  db.prepare(`UPDATE grills SET tree = ?, status = 'killed', updated_at = CURRENT_TIMESTAMP WHERE snowmobile_id = ?`)
    .run(JSON.stringify(tree), sm.id);
}

// Takes back the last answered round: its answers, the rounds after it, and a kill or a brief that it caused.
function undoRound(cfg, smId) {
  const { db } = cfg;
  const sm = db.prepare(`SELECT * FROM snowmobiles WHERE id = ?`).get(smId);
  const grill = db.prepare(`SELECT * FROM grills WHERE snowmobile_id = ?`).get(smId);
  const tree = JSON.parse(grill.tree);
  const last = Math.max(0, ...settledOf(tree).map((d) => d.round));
  if (!last) return false;
  tree.decisions = tree.decisions.filter((d) => d.round <= last);
  for (const d of tree.decisions) if (d.round === last) d.answer = null;
  tree.round = last;
  let note = sm.proof_note;
  if (tree.killed) {
    const { component_id: cid, reason } = tree.killed;
    // The part keeps the mark of the most recent kill that still stands on it.
    if (cid && db.prepare(`SELECT bad_reason FROM components WHERE id = ?`).get(cid).bad_reason === `${sm.name}: ${reason}`) {
      const other = db.prepare(`SELECT s.name, json_extract(g.tree, '$.killed.reason') AS reason FROM grills g
        JOIN snowmobiles s ON s.id = g.snowmobile_id WHERE g.status = 'killed' AND g.snowmobile_id != ?
        AND json_extract(g.tree, '$.killed.component_id') = ? ORDER BY g.updated_at DESC, g.id DESC`).get(smId, cid);
      db.prepare(`UPDATE components SET bad_reason = ? WHERE id = ?`)
        .run(other ? `${other.name}: ${other.reason}` : tree.killed.bad_reason === LEFT_OUT ? LEFT_OUT : null, cid);
    }
    note = tree.killed.note ?? note;
    delete tree.killed;
  }
  db.prepare(`UPDATE snowmobiles SET status = 'survivor', proof_note = ? WHERE id = ? AND status IN ('killed', 'grilled')`).run(note, smId);
  db.prepare(`UPDATE grills SET tree = ?, status = 'open', brief = NULL, updated_at = CURRENT_TIMESTAMP WHERE snowmobile_id = ?`)
    .run(JSON.stringify(tree), smId);
  cfg.grillErrors.delete(smId);
  return true;
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

// The marks that the owner's own actions leave on a part and on an idea.
const LEFT_OUT = 'left out by you';
const BURIED = 'Buried by you. ';

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
        const { seed, stack } = await readBody(req);
        if (Array.isArray(stack)) {
          // Stack mode: a consumer pain, a stack (at most one paradigm per layer), or both.
          const ps = stack.map((id) => db.prepare(`SELECT * FROM paradigms WHERE id = ?`).get(id));
          if (ps.some((x) => !x)) return send(res, 400, { error: 'no such paradigm' });
          if (new Set(ps.map((x) => x.layer)).size !== ps.length) return send(res, 400, { error: 'pick one paradigm per layer' });
          const text = [String(seed || '').trim(), ps.map((x) => x.name).join(' + ')].filter(Boolean).join(' · ');
          if (!text) return send(res, 400, { error: 'seed is empty: write a pain or pick a stack' });
          const id = db.prepare(`INSERT INTO hunts (seed, status, stack) VALUES (?, 'creating', ?)`)
            .run(text, JSON.stringify(ps.map((x) => x.id))).lastInsertRowid;
          plantStack(db, id, ps.map((x) => x.id));
          runCreate(cfg, id);
          return send(res, 200, { id });
        }
        if (!seed || !String(seed).trim()) return send(res, 400, { error: 'seed is empty' });
        const id = db.prepare(`INSERT INTO hunts (seed, status) VALUES (?, 'hunting')`).run(String(seed).trim()).lastInsertRowid;
        runHunt(cfg, id);
        return send(res, 200, { id });
      }
      if (req.method === 'GET' && p === '/api/stack') {
        const pick = (url.searchParams.get('pick') || '').split(',').filter(Boolean).map(Number);
        return send(res, 200, stackView(cfg, pick));
      }
      if (req.method === 'POST' && (r = m(/^\/api\/stack\/(axes|hunting)$/))) {
        if (cfg.stackJob && !cfg.stackJob.error) return send(res, 409, { error: 'a step already runs' });
        runStackJob(cfg, r[1]);
        return send(res, 200, {});
      }
      if (req.method === 'POST' && p === '/api/stack/point') {
        const { x, y } = await readBody(req);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return send(res, 400, { error: 'x and y are numbers' });
        return send(res, 200, await askPoint(cfg, x, y));
      }
      if (req.method === 'POST' && (r = m(/^\/api\/axes\/(\d+)$/))) {
        const { name, low, high } = await readBody(req);
        if (!name || !String(name).trim()) return send(res, 400, { error: 'name is empty' });
        const ok = db.prepare(`UPDATE axes SET name = ?, low = ?, high = ? WHERE id = ?`)
          .run(String(name).trim(), String(low || ''), String(high || ''), Number(r[1])).changes;
        return ok ? send(res, 200, {}) : send(res, 404, { error: 'no such axis' });
      }
      if (req.method === 'POST' && p === '/api/scores') {
        const { paradigm_id, axis_id, score, reason } = await readBody(req);
        if (!Number.isInteger(score) || score < 0 || score > 10) return send(res, 400, { error: 'score is an integer from 0 to 10' });
        if (!db.prepare(`SELECT 1 FROM paradigms WHERE id = ?`).get(paradigm_id) || !db.prepare(`SELECT 1 FROM axes WHERE id = ?`).get(axis_id)) {
          return send(res, 404, { error: 'no such paradigm or axis' });
        }
        db.prepare(`INSERT INTO scores (paradigm_id, axis_id, score, reason) VALUES (?, ?, ?, ?)
          ON CONFLICT (paradigm_id, axis_id) DO UPDATE SET score = excluded.score, reason = excluded.reason`)
          .run(paradigm_id, axis_id, score, String(reason || 'set by the owner'));
        return send(res, 200, {});
      }
      if (req.method === 'POST' && (r = m(/^\/api\/components\/(\d+)$/))) {
        // The owner leaves a part out of the next creation, or brings it back.
        const { out } = await readBody(req);
        const ok = db.prepare(`UPDATE components SET bad_reason = ? WHERE id = ?`).run(out ? LEFT_OUT : null, Number(r[1])).changes;
        return ok ? send(res, 200, {}) : send(res, 404, { error: 'no such part' });
      }
      if (req.method === 'POST' && (r = m(/^\/api\/snowmobiles\/(\d+)$/))) {
        // The owner buries a survivor, or restores an idea from the graveyard. An undo sends the earlier note.
        const { status, proof_note } = await readBody(req);
        const sm = db.prepare(`SELECT * FROM snowmobiles WHERE id = ?`).get(Number(r[1]));
        if (!sm) return send(res, 404, { error: 'no such idea' });
        const from = { graveyard: 'survivor', survivor: 'graveyard' }[status];
        if (!from || sm.status !== from) return send(res, 409, { error: `only a ${from || 'survivor'} can become ${status}` });
        const note = proof_note !== undefined ? proof_note === null ? null : String(proof_note) : status === 'graveyard' ? BURIED + (sm.proof_note || '') : String(sm.proof_note || '').replace(BURIED, '');
        db.prepare(`UPDATE snowmobiles SET status = ?, proof_note = ? WHERE id = ?`).run(status, note, sm.id);
        return send(res, 200, {});
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
      if (req.method === 'POST' && (r = m(/^\/api\/grills\/(\d+)\/undo$/))) {
        const smId = Number(r[1]);
        if (!db.prepare(`SELECT 1 FROM grills WHERE snowmobile_id = ?`).get(smId)) return send(res, 404, { error: 'no such grill' });
        if (!undoRound(cfg, smId)) return send(res, 409, { error: 'no round to undo' });
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
  const cfg = { db, home, claude, grillModel, token: token(db), frontiers: new Map(), grillErrors: new Map(),
    stackJob: null };
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

module.exports = { start, eigen, pca, gaps };
