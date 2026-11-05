// Shared by the API tests: a snowmobile server on a fake claude, typed API bodies, and the plans written straight into the database.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { start, type StartOptions } from '../../src/server.ts';
import type { Cfg } from '../../src/cfg.ts';

// An array that answers the first indexes with an element: the tests index into what the API sent.
export interface List<T> extends Array<T> { 0: T; 1: T; 2: T; 3: T; 4: T }

/** A path of the API from its parts: numbers are ids. */
export function route(...parts: (string | number)[]): string {
  return ['/api', ...parts].join('/');
}
export interface Comp { id: number; bad_reason: string | null }
export interface Source { components: List<Comp> }
export interface Sm { id: number; name: string; status: string; proof_note: string; proof_url: string }
export interface Option { kills_component_id: number }
export interface Decision { id: string; round: number; answer?: unknown; options: List<Option> }
export interface Finding { kind: string }
export interface Tree {
  decisions: List<Decision>;
  killed?: { component_id: number };
  machine?: { findings: List<Finding>; skipped: string };
}
// The union of every body that the API sends: a test reads only the fields of the route that it called.
export interface Body {
  id: number;
  hunt: { status: string };
  sources: List<Source>;
  snowmobiles: List<Sm>;
  hunts: List<unknown>;
  status: string;
  tree: Tree;
  brief: string | null;
  error: string | undefined;
  pending: boolean;
}
export interface Reply { status: number; body: Body }
export interface Lab {
  server: Awaited<ReturnType<typeof start>>['server'];
  cfg: Cfg;
  port: number;
  call: (p: string, body?: object | null, tok?: string) => Promise<Reply>;
  until: (p: string, ok: (b: Body) => unknown) => Promise<Body>;
}

/** The one place where a parsed JSON value is taken to be an API body. */
export function asBody(data: unknown): Body {
  return data as Body;
}

export const sleep = (ms: number): Promise<void> => new Promise<void>((resolve) => { setTimeout(resolve, ms); });

export async function lab(opts: StartOptions = {}): Promise<Lab> {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'snowmobile-'));
  const claude = path.join(import.meta.dirname, '..', 'fake-claude.ts');
  const { server, cfg, port } = await start({ home, port: 0, claude, smAxi: null, ...opts });
  const call = async (p: string, body?: object | null, tok: string = cfg.token): Promise<Reply> => {
    const res = await fetch(`http://127.0.0.1:${String(port)}${p}`, { method: body ? 'POST' : 'GET',
      headers: { 'x-token': tok }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data: unknown = await res.json().catch(() => null);
    return { status: res.status, body: asBody(data) };
  };
  const until = async (p: string, ok: (b: Body) => unknown): Promise<Body> => {
    for (let i = 0; i < 100; i++) {
      const r = await call(p);
      if (ok(r.body)) {
        return r.body;
      }
      await sleep(50);
    }
    throw new Error(`timeout on ${p}`);
  };
  return { server, cfg, port, call, until };
}

// One hunt with part A in each plan and part B outside every plan, written straight into the database.
export function plant(db: DatabaseSync, names: string[]): { hunt: number; ids: List<number> } {
  const hunt = db.prepare(`INSERT INTO hunts (seed, status) VALUES ('x', 'created')`).run().lastInsertRowid;
  const src = db.prepare(`INSERT INTO sources (hunt_id, name) VALUES (?, 'src')`).run(hunt).lastInsertRowid;
  const a = db.prepare(`INSERT INTO components (source_id, name) VALUES (?, 'A')`).run(src).lastInsertRowid;
  db.prepare(`INSERT INTO components (source_id, name) VALUES (?, 'B')`).run(src);
  const ids = names.map((n) => Number(db.prepare(`INSERT INTO snowmobiles (hunt_id, name, pitch, component_ids, status)
    VALUES (?, ?, 'p', ?, 'survivor')`).run(hunt, n, JSON.stringify([a])).lastInsertRowid));
  return { hunt: Number(hunt), ids: ids as List<number> };
}

/** An open grill whose single decision is answered, for the plan `sm`. */
export function openGrill(cfg: Cfg, sm: number, id: string, question: string, label: string): void {
  const tree = { round: 1, decisions: [{ id, question, depends_on: [], recommended: 0, round: 1,
    options: [{ label, why: 'w', kills_component_id: 0 }], answer: { choice: 0, note: '' } }] };
  cfg.db.prepare(`INSERT INTO grills (snowmobile_id, tree, status) VALUES (?, ?, 'open')`).run(sm, JSON.stringify(tree));
}

// A grill with one answered round, in a plan with this name.
export function answered(cfg: Cfg, name: string): number {
  const sm = plant(cfg.db, [name]).ids[0];
  openGrill(cfg, sm, 'scope', 'Scope?', 'Small');
  return sm;
}

/** Hunts for a seed and creates the plans; returns the hunt as the page sees it. */
export async function createdHunt({ call, until }: Pick<Lab, 'call' | 'until'>): Promise<{ id: number; h: Body }> {
  const { id } = (await call('/api/hunts', { seed: 'flaky tests' })).body;
  await until(route('hunts', id), (b) => b.hunt.status === 'hunted');
  await call(route('hunts', id, 'create'), {});
  return { id, h: await until(route('hunts', id), (b) => b.hunt.status === 'created') };
}
