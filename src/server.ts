import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { next, RefusedTransition } from '../shared/fsm.ts';
import { huntMachine, grillMachine, type GrillState } from '../shared/flow.ts';
import { openDb, token, get, run, all, type ComponentRow, type GrillRow, type HuntRow, type IdeaRow, type ParadigmRow } from './db.ts';
import type { Cfg } from './cfg.ts';
import { findSmAxi } from './machine.ts';
import { BURIED, LEFT_OUT, advance, ideaOf, kill, treeOf, undoRound, moveIdea } from './grill.ts';
import { askPoint, plantStack, runCreate, runHunt, startStackJob, type StackStep } from './jobs.ts';
import { grillView, huntView, search, stackView } from './views.ts';
import { frontierKey, settledOf } from './grilltree.ts';
import type { Answer, Tree } from './types.ts';
import { clientBundle } from './bundle.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const STATIC: Record<string, [file: string, type: string]> = {
  '/app.css': ['app.css', 'text/css; charset=utf-8'],
  '/fonts/inter.woff2': ['fonts/inter.woff2', 'font/woff2'],
  '/fonts/ibm-plex-mono.woff2': ['fonts/ibm-plex-mono.woff2', 'font/woff2'],
};

function send(res: http.ServerResponse, code: number, body: unknown, type = 'application/json', cache = 'no-store'): void {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': cache });
  res.end(type === 'application/json' ? JSON.stringify(body) : (body as string | Buffer));
}

type Body = Record<string, unknown>;

function readBody(req: http.IncomingMessage): Promise<Body> {
  return new Promise((resolve, reject) => {
    let b = '';
    req.on('data', (d: Buffer) => { b += d; if (b.length > 1e6) req.destroy(); });
    req.on('end', () => {
      try {
        const parsed: unknown = b ? JSON.parse(b) : {};
        resolve(parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Body : {});
      } catch (e) { reject(e); }
    });
  });
}

export function grillStateOf(cfg: Cfg, smId: number, grill: GrillRow): GrillState {
  if (grill.status === 'done') return 'done';
  if (grill.status === 'killed') return 'killed';
  const tree = JSON.parse(grill.tree) as Tree;
  if (tree.decisions.some((d) => !d.answer)) return 'asking';
  return cfg.grillErrors.has(smId) ? 'failed' : 'thinking';
}

function handler(cfg: Cfg): (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void> {
  const { db } = cfg;
  const page = fs.readFileSync(path.join(ROOT, 'page.html'), 'utf8');
  const param = (s: string | undefined): number => Number(s);
  return async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const p = url.pathname;
    if (req.method === 'GET' && p === '/client.js') {
      return send(res, 200, await clientBundle(ROOT), 'text/javascript; charset=utf-8');
    }
    const asset = req.method === 'GET' ? STATIC[p] : undefined;
    if (asset) return send(res, 200, fs.readFileSync(path.join(ROOT, asset[0])), asset[1], p.endsWith('.woff2') ? 'public, max-age=86400' : 'no-cache');
    const t = Buffer.from(String(url.searchParams.get('token') || req.headers['x-token'] || ''));
    const want = Buffer.from(cfg.token);
    if (t.length !== want.length || !crypto.timingSafeEqual(t, want)) {
      return send(res, 403, 'Open the URL that snowmobile printed at start, with its token.\n', 'text/plain');
    }
    const m = (re: RegExp): RegExpMatchArray | null => p.match(re);
    let r: RegExpMatchArray | null;
    try {
      if (req.method === 'GET' && p === '/') {
        return send(res, 200, page, 'text/html; charset=utf-8');
      }
      if (req.method === 'POST' && p === '/api/hunts') {
        const { seed, stack } = await readBody(req);
        if (Array.isArray(stack)) {
          const ps = stack.map((id) => get<ParadigmRow>(db, `SELECT * FROM paradigms WHERE id = ?`, Number(id)));
          const found = ps.filter((x): x is ParadigmRow => x !== undefined);
          if (found.length !== ps.length) return send(res, 400, { error: 'no such paradigm' });
          if (new Set(found.map((x) => x.layer)).size !== found.length) return send(res, 400, { error: 'pick one paradigm per layer' });
          const text = [String(seed || '').trim(), found.map((x) => x.name).join(' + ')].filter(Boolean).join(' · ');
          if (!text) return send(res, 400, { error: 'seed is empty: write a pain or pick a stack' });
          const id = run(db, `INSERT INTO hunts (seed, status, stack) VALUES (?, ?, ?)`, text,
            next(huntMachine, 'seeded', 'seed_stack'), JSON.stringify(found.map((x) => x.id))).id;
          plantStack(db, id, found.map((x) => x.id));
          void runCreate(cfg, id);
          return send(res, 200, { id });
        }
        if (!seed || !String(seed).trim()) return send(res, 400, { error: 'seed is empty' });
        const id = run(db, `INSERT INTO hunts (seed, status) VALUES (?, ?)`, String(seed).trim(), next(huntMachine, 'seeded', 'seed')).id;
        void runHunt(cfg, id);
        return send(res, 200, { id });
      }
      if (req.method === 'GET' && p === '/api/stack') {
        const pick = (url.searchParams.get('pick') || '').split(',').filter(Boolean).map(Number);
        return send(res, 200, stackView(cfg, pick));
      }
      if (req.method === 'POST' && (r = m(/^\/api\/stack\/(axes|hunting)$/))) {
        if (!startStackJob(cfg, r[1] as StackStep)) return send(res, 409, { error: 'a step already runs' });
        return send(res, 200, {});
      }
      if (req.method === 'POST' && p === '/api/stack/point') {
        const { x, y } = await readBody(req);
        if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return send(res, 400, { error: 'x and y are numbers' });
        return send(res, 200, await askPoint(cfg, x, y));
      }
      if (req.method === 'POST' && (r = m(/^\/api\/axes\/(\d+)$/))) {
        const { name, low, high } = await readBody(req);
        if (!name || !String(name).trim()) return send(res, 400, { error: 'name is empty' });
        const ok = run(db, `UPDATE axes SET name = ?, low = ?, high = ? WHERE id = ?`,
          String(name).trim(), String(low || ''), String(high || ''), param(r[1])).changes;
        return ok ? send(res, 200, {}) : send(res, 404, { error: 'no such axis' });
      }
      if (req.method === 'POST' && p === '/api/scores') {
        const { paradigm_id, axis_id, score, reason } = await readBody(req);
        if (typeof score !== 'number' || !Number.isInteger(score) || score < 0 || score > 10) return send(res, 400, { error: 'score is an integer from 0 to 10' });
        if (typeof paradigm_id !== 'number' || typeof axis_id !== 'number'
          || !get(db, `SELECT 1 FROM paradigms WHERE id = ?`, paradigm_id) || !get(db, `SELECT 1 FROM axes WHERE id = ?`, axis_id)) {
          return send(res, 404, { error: 'no such paradigm or axis' });
        }
        run(db, `INSERT INTO scores (paradigm_id, axis_id, score, reason) VALUES (?, ?, ?, ?)
          ON CONFLICT (paradigm_id, axis_id) DO UPDATE SET score = excluded.score, reason = excluded.reason`,
        paradigm_id, axis_id, score, String(reason || 'set by the owner'));
        return send(res, 200, {});
      }
      if (req.method === 'POST' && (r = m(/^\/api\/components\/(\d+)$/))) {
        const { out, reason } = await readBody(req);
        const ok = run(db, `UPDATE components SET bad_reason = ? WHERE id = ?`,
          out ? (reason ? String(reason) : LEFT_OUT) : null, param(r[1])).changes;
        return ok ? send(res, 200, {}) : send(res, 404, { error: 'no such part' });
      }
      if (req.method === 'POST' && (r = m(/^\/api\/snowmobiles\/(\d+)$/))) {
        const { status, proof_note } = await readBody(req);
        const sm = ideaOf(db, param(r[1]));
        if (!sm) return send(res, 404, { error: 'no such idea' });
        const from = ({ graveyard: 'survivor', survivor: 'graveyard' } as Record<string, string>)[String(status)];
        if (!from || sm.status !== from) return send(res, 409, { error: `only a ${from || 'survivor'} can become ${status}` });
        const note = proof_note !== undefined ? proof_note === null ? null : String(proof_note)
          : status === 'graveyard' ? BURIED + (sm.proof_note || '') : String(sm.proof_note || '').replace(BURIED, '');
        moveIdea(db, sm.id, status === 'graveyard' ? 'bury' : 'restore');
        run(db, `UPDATE snowmobiles SET proof_note = ? WHERE id = ?`, note, sm.id);
        return send(res, 200, {});
      }
      if (req.method === 'GET' && (r = m(/^\/api\/hunts\/(\d+)$/))) {
        const v = huntView(db, param(r[1]));
        return v ? send(res, 200, v) : send(res, 404, { error: 'no such hunt' });
      }
      if (req.method === 'POST' && (r = m(/^\/api\/hunts\/(\d+)\/(hunt|create)$/))) {
        const id = param(r[1]);
        const hunt = get<HuntRow>(db, `SELECT * FROM hunts WHERE id = ?`, id);
        if (!hunt) return send(res, 404, { error: 'no such hunt' });
        const hunting = r[2] === 'hunt';
        const to = next(huntMachine, hunt.status, hunting ? 'hunt' : 'create');
        if (to === hunt.status) return send(res, 409, { error: 'a step already runs' });
        run(db, `UPDATE hunts SET status = ?, error = NULL WHERE id = ?`, to, id);
        void (hunting ? runHunt : runCreate)(cfg, id);
        return send(res, 200, { id });
      }
      if (req.method === 'GET' && (r = m(/^\/api\/grills\/(\d+)$/))) {
        const smId = param(r[1]);
        if (!ideaOf(db, smId)) return send(res, 404, { error: 'no such snowmobile' });
        if (!get(db, `SELECT 1 FROM grills WHERE snowmobile_id = ?`, smId)) {
          run(db, `INSERT INTO grills (snowmobile_id, tree, status) VALUES (?, ?, 'open')`, smId, JSON.stringify({ round: 0, decisions: [] }));
        }
        const grill = get<GrillRow>(db, `SELECT * FROM grills WHERE snowmobile_id = ?`, smId) as GrillRow;
        const tree = JSON.parse(grill.tree) as Tree;
        if (grill.status === 'open' && tree.decisions.every((d) => d.answer)
          && !cfg.frontiers.has(frontierKey(smId, settledOf(tree))) && !cfg.grillErrors.has(smId)) void advance(cfg, smId);
        return send(res, 200, grillView(cfg, smId));
      }
      if (req.method === 'POST' && (r = m(/^\/api\/grills\/(\d+)\/undo$/))) {
        const smId = param(r[1]);
        if (!get(db, `SELECT 1 FROM grills WHERE snowmobile_id = ?`, smId)) return send(res, 404, { error: 'no such grill' });
        if (!undoRound(cfg, smId)) return send(res, 409, { error: 'no round to undo' });
        return send(res, 200, grillView(cfg, smId));
      }
      if (req.method === 'POST' && (r = m(/^\/api\/grills\/(\d+)\/(answer|retry)$/))) {
        const smId = param(r[1]);
        const grill = get<GrillRow>(db, `SELECT * FROM grills WHERE snowmobile_id = ?`, smId);
        if (!grill || grill.status !== 'open') return send(res, 409, { error: 'this grill is not open' });
        const tree = JSON.parse(grill.tree) as Tree;
        const sm = ideaOf(db, smId) as IdeaRow;
        if (sm.status !== 'survivor') return send(res, 409, { error: 'this idea is not a survivor' });
        const event = r[2] === 'answer' ? 'answer' : 'retry';
        next(grillMachine, grillStateOf(cfg, smId, grill), event);
        if (event === 'answer') {
          const { answers } = await readBody(req);
          const given = (answers && typeof answers === 'object' ? answers : {}) as Record<string, Partial<Answer> | undefined>;
          const open = tree.decisions.filter((d) => !d.answer);
          for (const d of open) {
            const a = given[d.id];
            if (!a || typeof a.choice !== 'number' || !Number.isInteger(a.choice) || a.choice < -1 || a.choice >= d.options.length) {
              return send(res, 400, { error: `no answer for ${d.id}` });
            }
            d.answer = { choice: a.choice, note: String(a.note || '').trim().slice(0, 2000) };
          }
          const killer = open.find((d) => d.answer && d.answer.choice >= 0 && d.options[d.answer.choice]?.kills_component_id);
          const opt = killer?.answer ? killer.options[killer.answer.choice] : undefined;
          if (killer && opt) {
            kill(cfg, sm, opt.kills_component_id, `${killer.question} ${opt.label}: ${opt.why}`, tree);
            return send(res, 200, grillView(cfg, smId));
          }
          run(db, `UPDATE grills SET tree = ?, updated_at = CURRENT_TIMESTAMP WHERE snowmobile_id = ?`, JSON.stringify(tree), smId);
        }
        void advance(cfg, smId);
        return send(res, 200, grillView(cfg, smId));
      }
      if (req.method === 'GET' && p === '/api/search') {
        return send(res, 200, search(db, url.searchParams.get('q') || ''));
      }
      return send(res, 404, { error: 'not found' });
    } catch (e) {
      if (e instanceof RefusedTransition) return send(res, 409, { error: e.message });
      return send(res, 500, { error: (e as Error).message });
    }
  };
}

export interface StartOptions { home?: string; port?: number; claude?: string; grillModel?: string; smAxi?: string | null }

export function start({ home = path.join(os.homedir(), '.snowmobile'), port = 4747, claude = 'claude',
  grillModel = 'sonnet', smAxi }: StartOptions = {}): Promise<{ server: http.Server; cfg: Cfg; port: number }> {
  const db = openDb(path.join(home, 'snowmobile.db'));
  const cfg: Cfg = { db, home, claude, grillModel, smAxi: findSmAxi(smAxi), token: token(db), frontiers: new Map(), grillErrors: new Map(),
    stackJob: null };
  const server = http.createServer((req, res) => { void handler(cfg)(req, res); });
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => resolve({ server, cfg, port: (server.address() as { port: number }).port }));
  });
}

export { all, treeOf, type ComponentRow };
