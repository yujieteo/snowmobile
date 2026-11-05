import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { assert } from '../shared/assert.ts';
import { next, RefusedTransition } from '../shared/fsm.ts';
import { huntMachine, grillMachine, type GrillState } from '../shared/flow.ts';
import { openDb, token, get, run, all, type ComponentRow, type GrillRow, type HuntRow, type IdeaRow, type ParadigmRow } from './db.ts';
import type { Cfg } from './cfg.ts';
import { findSmAxi } from './machine.ts';
import { BURIED, LEFT_OUT, advance, ideaOf, kill, treeOf, undoRound, moveIdea } from './grill.ts';
import { askPoint, plantStack, runCreate, runHunt, startStackJob, type StackStep } from './jobs.ts';
import { grillView, huntView, search, stackView } from './views.ts';
import { frontierKey, settledOf } from './grilltree.ts';
import type { Answer, Decision, Tree } from './types.ts';
import { clientBundle } from './bundle.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const STATIC: Record<string, [file: string, type: string]> = {
  '/app.css': ['app.css', 'text/css; charset=utf-8'],
  '/fonts/inter.woff2': ['fonts/inter.woff2', 'font/woff2'],
  '/fonts/ibm-plex-mono.woff2': ['fonts/ibm-plex-mono.woff2', 'font/woff2'],
};

function send(res: http.ServerResponse, code: number, body: unknown, type = 'application/json', cache = 'no-store'): void {
  assert(code >= 100 && code < 600, 'an HTTP status code');
  assert(type.length > 0, 'a content type is given');
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': cache });
  res.end(type === 'application/json' ? JSON.stringify(body) : (body as string | Buffer));
}

type Body = Record<string, unknown>;

function readBody(req: http.IncomingMessage): Promise<Body> {
  assert(req.method !== undefined, 'a request has a method');
  return new Promise((resolve, reject) => {
    assert(typeof resolve === 'function' && typeof reject === 'function', 'a promise has callbacks');
    assert(req.readable, 'the request body can be read');
    let b = '';
    req.on('data', (d: Buffer) => {
      assert(d.length >= 0, 'a chunk has a length');
      assert(b.length <= 2e6, 'the body stays near its limit');
      b += d.toString(); if (b.length > 1e6) {req.destroy();}
    });
    req.on('end', () => {
      assert(b.length <= 2e6, 'the body stays near its limit');
      assert(!req.readable, 'the body was read to its end');
      try {
        const parsed: unknown = b ? JSON.parse(b) : {};
        resolve(parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Body : {});
      } catch (e) { reject(e instanceof Error ? e : new Error(String(e))); }
    });
  });
}

// Decisions that the owner has not answered yet.
function unanswered(tree: Tree): Decision[] {
  assert(Number.isInteger(tree.decisions.length), 'a tree has a list of decisions');
  const open: Decision[] = [];
  for (const d of tree.decisions) {
    if (!d.answer) { open.push(d); }
  }
  assert(open.length <= tree.decisions.length, 'open decisions are a subset');
  return open;
}

export function grillStateOf(cfg: Cfg, smId: number, grill: GrillRow): GrillState {
  assert(Number.isInteger(smId), 'the idea id is an integer');
  assert(grill.tree.length > 0, 'a grill has a tree');
  if (grill.status === 'done') {return 'done';}
  if (grill.status === 'killed') {return 'killed';}
  const tree = JSON.parse(grill.tree) as Tree;
  if (unanswered(tree).length > 0) {return 'asking';}
  return cfg.grillErrors.has(smId) ? 'failed' : 'thinking';
}

interface Ctx {
  cfg: Cfg;
  page: string;
  req: http.IncomingMessage;
  res: http.ServerResponse;
  url: URL;
  m: RegExpMatchArray;
}

interface Route { method: 'GET' | 'POST'; re: RegExp; run: (c: Ctx) => void | Promise<void> }

// The first capture group of the matched route, as the number the database uses.
function idParam(c: Ctx): number {
  assert(c.m.length > 1, 'the route has a capture group');
  const id = Number(c.m[1]);
  assert(Number.isInteger(id), 'the id in the path is an integer');
  return id;
}

// What String(v || fallback) gives for a value read from a request body.
function bodyText(v: unknown, fallback = ''): string {
  assert(fallback.length >= 0, 'the fallback has a length');
  assert(typeof fallback === 'string', 'the fallback is a string');
  return v ? (v as { toString(): string }).toString() : fallback;
}

function reply(c: Ctx, code: number, body: unknown): void {
  assert(code >= 200 && code < 600, 'an HTTP status code');
  assert(!c.res.writableEnded, 'one response per request');
  send(c.res, code, body);
}

function serveHome(c: Ctx): void {
  assert(c.page.length > 0, 'the page is loaded');
  assert(c.url.pathname === '/', 'home is served at the root');
  send(c.res, 200, c.page, 'text/html; charset=utf-8');
}

function namesOf(rows: readonly ParadigmRow[]): string[] {
  assert(Number.isInteger(rows.length), 'a stack is a list of paradigms');
  const names: string[] = [];
  for (const r of rows) { names.push(r.name); }
  assert(names.length === rows.length, 'one name per paradigm');
  return names;
}

function idsOf(rows: readonly ParadigmRow[]): number[] {
  assert(Number.isInteger(rows.length), 'a stack is a list of paradigms');
  const ids: number[] = [];
  for (const r of rows) { ids.push(r.id); }
  assert(ids.length === rows.length, 'one id per paradigm');
  return ids;
}

// The paradigms of a posted stack, or null after a 400 reply when one is missing or two share a layer.
function findParadigms(c: Ctx, stack: readonly unknown[]): ParadigmRow[] | null {
  assert(c.cfg.db.isOpen, 'the database is open');
  assert(Number.isInteger(stack.length), 'the stack is a list');
  const found: ParadigmRow[] = [];
  const layers = new Set<string>();
  for (const id of stack) {
    const row = get<ParadigmRow>(c.cfg.db, `SELECT * FROM paradigms WHERE id = ?`, Number(id));
    if (!row) { reply(c, 400, { error: 'no such paradigm' }); return null; }
    found.push(row);
    layers.add(row.layer);
  }
  if (layers.size !== found.length) { reply(c, 400, { error: 'pick one paradigm per layer' }); return null; }
  return found;
}

// A hunt that starts from a stack of paradigms: one per layer, created at once.
function stackHunt(c: Ctx, seed: unknown, stack: unknown[]): void {
  assert(c.req.method === 'POST', 'hunts are created by POST');
  const { cfg } = c;
  assert(stack.length >= 0, 'the stack is a list');
  const found = findParadigms(c, stack);
  if (!found) { return; }
  const text = [bodyText(seed).trim(), namesOf(found).join(' + ')].filter(Boolean).join(' · ');
  if (!text) { reply(c, 400, { error: 'seed is empty: write a pain or pick a stack' }); return; }
  const id = run(cfg.db, `INSERT INTO hunts (seed, status, stack) VALUES (?, ?, ?)`, text,
    next(huntMachine, 'seeded', 'seed_stack'), JSON.stringify(idsOf(found))).id;
  plantStack(cfg.db, id, idsOf(found));
  void runCreate(cfg, id);
  reply(c, 200, { id });
}

async function postHunts(c: Ctx): Promise<void> {
  assert(c.req.method === 'POST', 'hunts are created by POST');
  const { seed, stack } = await readBody(c.req);
  if (Array.isArray(stack)) { stackHunt(c, seed, stack as unknown[]); return; }
  if (!seed || !bodyText(seed).trim()) { reply(c, 400, { error: 'seed is empty' }); return; }
  const id = run(c.cfg.db, `INSERT INTO hunts (seed, status) VALUES (?, ?)`, bodyText(seed).trim(), next(huntMachine, 'seeded', 'seed')).id;
  assert(Number.isInteger(id), 'a new hunt has an integer id');
  void runHunt(c.cfg, id);
  reply(c, 200, { id });
}

function getStack(c: Ctx): void {
  assert(c.req.method === 'GET', 'the stack is read by GET');
  const pick = bodyText(c.url.searchParams.get('pick')).split(',').filter(Boolean).map(Number);
  assert(Number.isInteger(pick.length), 'pick is a list');
  reply(c, 200, stackView(c.cfg, pick));
}

function postStackJob(c: Ctx): void {
  assert(c.req.method === 'POST', 'stack steps are started by POST');
  assert(c.m.length > 1, 'the route names a step');
  if (!startStackJob(c.cfg, c.m[1] as StackStep)) { reply(c, 409, { error: 'a step already runs' }); return; }
  reply(c, 200, {});
}

async function postPoint(c: Ctx): Promise<void> {
  assert(c.cfg.db.isOpen, 'the database is open');
  assert(c.req.method === 'POST', 'points are asked by POST');
  const { x, y } = await readBody(c.req);
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) {
    reply(c, 400, { error: 'x and y are numbers' });
    return;
  }
  reply(c, 200, await askPoint(c.cfg, x, y));
}

async function postAxis(c: Ctx): Promise<void> {
  assert(c.req.method === 'POST', 'axes are changed by POST');
  assert(c.cfg.db.isOpen, 'the database is open');
  const id = idParam(c);
  const { name, low, high } = await readBody(c.req);
  if (!name || !bodyText(name).trim()) { reply(c, 400, { error: 'name is empty' }); return; }
  const ok = run(c.cfg.db, `UPDATE axes SET name = ?, low = ?, high = ? WHERE id = ?`,
    bodyText(name).trim(), bodyText(low), bodyText(high), id).changes;
  if (ok) { reply(c, 200, {}); } else { reply(c, 404, { error: 'no such axis' }); }
}

async function postScore(c: Ctx): Promise<void> {
  assert(c.req.method === 'POST', 'scores are set by POST');
  const { db } = c.cfg;
  assert(c.url.pathname === '/api/scores', 'scores are set at their own path');
  const { paradigm_id, axis_id, score, reason } = await readBody(c.req);
  if (typeof score !== 'number' || !Number.isInteger(score) || score < 0 || score > 10) {
    reply(c, 400, { error: 'score is an integer from 0 to 10' });
    return;
  }
  if (typeof paradigm_id !== 'number' || typeof axis_id !== 'number'
    || !get(db, `SELECT 1 FROM paradigms WHERE id = ?`, paradigm_id) || !get(db, `SELECT 1 FROM axes WHERE id = ?`, axis_id)) {
    reply(c, 404, { error: 'no such paradigm or axis' });
    return;
  }
  run(db, `INSERT INTO scores (paradigm_id, axis_id, score, reason) VALUES (?, ?, ?, ?)
    ON CONFLICT (paradigm_id, axis_id) DO UPDATE SET score = excluded.score, reason = excluded.reason`,
  paradigm_id, axis_id, score, bodyText(reason, 'set by the owner'));
  reply(c, 200, {});
}

async function postComponent(c: Ctx): Promise<void> {
  assert(c.cfg.db.isOpen, 'the database is open');
  const id = idParam(c);
  const { out, reason } = await readBody(c.req);
  const ok = run(c.cfg.db, `UPDATE components SET bad_reason = ? WHERE id = ?`,
    out ? (reason ? bodyText(reason) : LEFT_OUT) : null, id).changes;
  assert(ok === 0 || ok === 1, 'one part changes at most');
  if (ok) { reply(c, 200, {}); } else { reply(c, 404, { error: 'no such part' }); }
}

// The note of an idea that moves between survivors and the graveyard.
function movedNote(sm: IdeaRow, status: unknown, proofNote: unknown): string | null {
  assert(typeof sm.id === 'number', 'the idea has an id');
  assert(status === 'graveyard' || status === 'survivor', 'the new status is known');
  if (proofNote !== undefined) { return proofNote === null ? null : bodyText(proofNote); }
  return status === 'graveyard' ? BURIED + (sm.proof_note ?? '') : (sm.proof_note ?? '').replace(BURIED, '');
}

async function postSnowmobile(c: Ctx): Promise<void> {
  assert(c.req.method === 'POST', 'ideas are changed by POST');
  assert(c.cfg.db.isOpen, 'the database is open');
  const { db } = c.cfg;
  const { status, proof_note } = await readBody(c.req);
  const sm = ideaOf(db, idParam(c));
  if (!sm) { reply(c, 404, { error: 'no such idea' }); return; }
  const from = ({ graveyard: 'survivor', survivor: 'graveyard' } as Record<string, string>)[String(status)];
  if (!from || sm.status !== from) { reply(c, 409, { error: `only a ${bodyText(from, 'survivor')} can become ${String(status)}` }); return; }
  const note = movedNote(sm, status, proof_note);
  moveIdea(db, sm.id, status === 'graveyard' ? 'bury' : 'restore');
  run(db, `UPDATE snowmobiles SET proof_note = ? WHERE id = ?`, note, sm.id);
  reply(c, 200, {});
}

function getHunt(c: Ctx): void {
  assert(Number.isInteger(c.m.length), 'the route matched');
  const v = huntView(c.cfg.db, idParam(c));
  assert(c.req.method === 'GET', 'hunts are read by GET');
  if (v) { reply(c, 200, v); } else { reply(c, 404, { error: 'no such hunt' }); }
}

function postHuntStep(c: Ctx): void {
  assert(c.req.method === 'POST', 'hunt steps are started by POST');
  const { cfg } = c;
  const id = idParam(c);
  const hunt = get<HuntRow>(cfg.db, `SELECT * FROM hunts WHERE id = ?`, id);
  if (!hunt) { reply(c, 404, { error: 'no such hunt' }); return; }
  const hunting = c.m[2] === 'hunt';
  assert(hunting || c.m[2] === 'create', 'the step is hunt or create');
  const to = next(huntMachine, hunt.status, hunting ? 'hunt' : 'create');
  if (to === hunt.status) { reply(c, 409, { error: 'a step already runs' }); return; }
  run(cfg.db, `UPDATE hunts SET status = ?, error = NULL WHERE id = ?`, to, id);
  void (hunting ? runHunt : runCreate)(cfg, id);
  reply(c, 200, { id });
}

function getGrill(c: Ctx): void {
  const { cfg } = c;
  const { db } = cfg;
  const smId = idParam(c);
  if (!ideaOf(db, smId)) { reply(c, 404, { error: 'no such snowmobile' }); return; }
  if (!get(db, `SELECT 1 FROM grills WHERE snowmobile_id = ?`, smId)) {
    run(db, `INSERT INTO grills (snowmobile_id, tree, status) VALUES (?, ?, 'open')`, smId, JSON.stringify({ round: 0, decisions: [] }));
  }
  const grill = get<GrillRow>(db, `SELECT * FROM grills WHERE snowmobile_id = ?`, smId);
  assert(grill !== undefined, 'the grill was just created');
  assert(grill.snowmobile_id === smId, 'the grill belongs to the idea');
  const tree = JSON.parse(grill.tree) as Tree;
  if (grill.status === 'open' && unanswered(tree).length === 0
    && !cfg.frontiers.has(frontierKey(smId, settledOf(tree))) && !cfg.grillErrors.has(smId)) { void advance(cfg, smId); }
  reply(c, 200, grillView(cfg, smId));
}

function postUndo(c: Ctx): void {
  assert(c.req.method === 'POST', 'undo is POST');
  const smId = idParam(c);
  assert(c.url.pathname.endsWith('/undo'), 'undo has its own path');
  if (!get(c.cfg.db, `SELECT 1 FROM grills WHERE snowmobile_id = ?`, smId)) { reply(c, 404, { error: 'no such grill' }); return; }
  if (!undoRound(c.cfg, smId)) { reply(c, 409, { error: 'no round to undo' }); return; }
  reply(c, 200, grillView(c.cfg, smId));
}

// The first answered decision whose chosen option kills a part.
function firstKiller(open: readonly Decision[]): Decision | undefined {
  assert(Number.isInteger(open.length), 'open decisions are a list');
  for (const d of open) {
    if (d.answer && d.answer.choice >= 0 && d.options[d.answer.choice]?.kills_component_id) { return d; }
  }
  assert(open.length >= 0, 'no killer among the open decisions');
  return undefined;
}

// Settles the open decisions from the posted answers. True when the response is already sent.
async function applyAnswers(c: Ctx, sm: IdeaRow, tree: Tree): Promise<boolean> {
  assert(Number.isInteger(sm.id), 'the idea has an integer id');
  assert(Number.isInteger(tree.decisions.length), 'a tree has decisions');
  const { answers } = await readBody(c.req);
  const given = (answers && typeof answers === 'object' ? answers : {}) as Record<string, Partial<Answer> | undefined>;
  const open = unanswered(tree);
  for (const d of open) {
    const a = given[d.id];
    if (!a || typeof a.choice !== 'number' || !Number.isInteger(a.choice) || a.choice < -1 || a.choice >= d.options.length) {
      reply(c, 400, { error: `no answer for ${d.id}` });
      return true;
    }
    d.answer = { choice: a.choice, note: bodyText(a.note).trim().slice(0, 2000) };
  }
  const killer = firstKiller(open);
  const opt = killer?.answer ? killer.options[killer.answer.choice] : undefined;
  if (killer && opt) {
    kill(c.cfg, sm, opt.kills_component_id, `${killer.question} ${opt.label}: ${opt.why}`, tree);
    reply(c, 200, grillView(c.cfg, sm.id));
    return true;
  }
  run(c.cfg.db, `UPDATE grills SET tree = ?, updated_at = CURRENT_TIMESTAMP WHERE snowmobile_id = ?`, JSON.stringify(tree), sm.id);
  return false;
}

async function postAnswer(c: Ctx): Promise<void> {
  assert(c.m[2] === 'answer' || c.m[2] === 'retry', 'the action is answer or retry');
  const { cfg } = c;
  const smId = idParam(c);
  const grill = get<GrillRow>(cfg.db, `SELECT * FROM grills WHERE snowmobile_id = ?`, smId);
  if (grill?.status !== 'open') { reply(c, 409, { error: 'this grill is not open' }); return; }
  const tree = JSON.parse(grill.tree) as Tree;
  const sm = ideaOf(cfg.db, smId);
  assert(sm !== undefined, 'a grill belongs to an idea');
  if (sm.status !== 'survivor') { reply(c, 409, { error: 'this idea is not a survivor' }); return; }
  const event = c.m[2] === 'answer' ? 'answer' : 'retry';
  next(grillMachine, grillStateOf(cfg, smId, grill), event);
  if (event === 'answer' && await applyAnswers(c, sm, tree)) { return; }
  void advance(cfg, smId);
  reply(c, 200, grillView(cfg, smId));
}

function getSearch(c: Ctx): void {
  assert(c.url.pathname === '/api/search', 'search has its own path');
  assert(c.req.method === 'GET', 'search is read by GET');
  reply(c, 200, search(c.cfg.db, bodyText(c.url.searchParams.get('q'))));
}

// Order matters: the first route whose method and path match answers the request.
function buildRoutes(): readonly Route[] {
  const routes: readonly Route[] = [
    { method: 'GET', re: /^\/$/, run: serveHome },
    { method: 'POST', re: /^\/api\/hunts$/, run: postHunts },
    { method: 'GET', re: /^\/api\/stack$/, run: getStack },
    { method: 'POST', re: /^\/api\/stack\/(axes|hunting)$/, run: postStackJob },
    { method: 'POST', re: /^\/api\/stack\/point$/, run: postPoint },
    { method: 'POST', re: /^\/api\/axes\/(\d+)$/, run: postAxis },
    { method: 'POST', re: /^\/api\/scores$/, run: postScore },
    { method: 'POST', re: /^\/api\/components\/(\d+)$/, run: postComponent },
    { method: 'POST', re: /^\/api\/snowmobiles\/(\d+)$/, run: postSnowmobile },
    { method: 'GET', re: /^\/api\/hunts\/(\d+)$/, run: getHunt },
    { method: 'POST', re: /^\/api\/hunts\/(\d+)\/(hunt|create)$/, run: postHuntStep },
    { method: 'GET', re: /^\/api\/grills\/(\d+)$/, run: getGrill },
    { method: 'POST', re: /^\/api\/grills\/(\d+)\/undo$/, run: postUndo },
    { method: 'POST', re: /^\/api\/grills\/(\d+)\/(answer|retry)$/, run: postAnswer },
    { method: 'GET', re: /^\/api\/search$/, run: getSearch },
  ];
  assert(routes.length > 0, 'there are routes');
  for (const r of routes) { assert(r.re.source.startsWith('^'), 'every route is anchored'); }
  return routes;
}

const ROUTES = buildRoutes();

// The client bundle and the static files need no token. True when one was served.
async function serveOpen(req: http.IncomingMessage, res: http.ServerResponse, p: string): Promise<boolean> {
  assert(p.startsWith('/'), 'a path starts with a slash');
  assert(typeof req.method === 'string', 'a request has a method');
  if (req.method === 'GET' && p === '/client.js') {
    send(res, 200, await clientBundle(ROOT), 'text/javascript; charset=utf-8');
    return true;
  }
  const asset = req.method === 'GET' ? STATIC[p] : undefined;
  if (!asset) { return false; }
  send(res, 200, fs.readFileSync(path.join(ROOT, asset[0])), asset[1], p.endsWith('.woff2') ? 'public, max-age=86400' : 'no-cache');
  return true;
}

function hasToken(cfg: Cfg, req: http.IncomingMessage, url: URL): boolean {
  assert(url.pathname.startsWith('/'), 'a URL path starts with a slash');
  assert(cfg.token.length > 0, 'the server has a token');
  const t = Buffer.from(bodyText(url.searchParams.get('token'), bodyText(req.headers['x-token'])));
  const want = Buffer.from(cfg.token);
  return t.length === want.length && crypto.timingSafeEqual(t, want);
}

async function route(cfg: Cfg, page: string, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  assert(typeof page === 'string', 'the page is text');
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  assert(url.pathname.startsWith('/'), 'a URL path starts with a slash');
  if (await serveOpen(req, res, url.pathname)) { return; }
  if (!hasToken(cfg, req, url)) {
    send(res, 403, 'Open the URL that snowmobile printed at start, with its token.\n', 'text/plain');
    return;
  }
  for (const r of ROUTES) {
    const m = r.method === req.method ? url.pathname.match(r.re) : null;
    if (m) {
      await r.run({ cfg, page, req, res, url, m });
      return;
    }
  }
  send(res, 404, { error: 'not found' });
}

function handler(cfg: Cfg): (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void> {
  const page = fs.readFileSync(path.join(ROOT, 'page.html'), 'utf8');
  assert(page.length > 0, 'page.html is not empty');
  return async (req, res) => {
    assert(typeof req.method === 'string', 'a request has a method');
    assert(!res.writableEnded, 'the response is still open');
    try {
      await route(cfg, page, req, res);
    } catch (e) {
      if (e instanceof RefusedTransition) { send(res, 409, { error: e.message }); return; }
      send(res, 500, { error: (e as Error).message });
    }
  };
}

export interface StartOptions { home?: string; port?: number; claude?: string; grillModel?: string; smAxi?: string | null }

export function start({ home = path.join(os.homedir(), '.snowmobile'), port = 4747, claude = 'claude',
  grillModel = 'sonnet', smAxi }: StartOptions = {}): Promise<{ server: http.Server; cfg: Cfg; port: number }> {
  assert(Number.isInteger(port) && port >= 0 && port < 65536, 'port is a TCP port');
  assert(home.length > 0, 'home is a path');
  const db = openDb(path.join(home, 'snowmobile.db'));
  const cfg: Cfg = { db, home, claude, grillModel, smAxi: findSmAxi(smAxi), token: token(db), frontiers: new Map(), grillErrors: new Map(),
    stackJob: null };
  const handle = handler(cfg);
  const server = http.createServer((req, res) => {
    assert(req.url !== undefined, 'a server request has a URL');
    assert(!res.writableEnded, 'the response is still open');
    void handle(req, res);
  });
  return new Promise((resolve, reject) => {
    assert(!server.listening, 'the server is not yet listening');
    assert(typeof reject === 'function', 'a promise has callbacks');
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => {
      assert(server.listening, 'the server is listening');
      assert(typeof server.address() === 'object', 'a TCP server has an address');
      resolve({ server, cfg, port: (server.address() as { port: number }).port });
    });
  });
}

export { all, treeOf, type ComponentRow };
