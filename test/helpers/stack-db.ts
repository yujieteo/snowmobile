import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { TestContext } from 'node:test';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { start } from '../../src/server.ts';
import type { Cfg } from '../../src/cfg.ts';
import repoScores from '../../data/repo-scores.json' with { type: 'json' };
import { at, defined } from './stack-util.ts';

type Row = Record<string, unknown>;
interface ParadigmRow { id: number; layer: string; name: string; summary: string; url: string }
interface App { server: Awaited<ReturnType<typeof start>>['server']; cfg: Cfg; port: number }

function oneRow(db: DatabaseSync, sql: string, ...params: SQLInputValue[]): Row {
  const row: unknown = db.prepare(sql).get(...params);
  return row as Row;
}
function manyRows(db: DatabaseSync, sql: string, ...params: SQLInputValue[]): Row[] {
  const rows: unknown = db.prepare(sql).all(...params);
  return rows as Row[];
}
function paradigmRows(db: DatabaseSync, sql: string, ...params: SQLInputValue[]): ParadigmRow[] {
  const rows: unknown = db.prepare(sql).all(...params);
  return rows as ParadigmRow[];
}
function countOf(db: DatabaseSync, sql: string): number {
  const n = oneRow(db, sql)['n'];
  assert.strictEqual(typeof n, 'number');
  return n as number;
}
function closeApp(app: App): Promise<void> {
  return new Promise((resolve) => {
    app.server.close(() => { resolve(); });
  });
}
const temporaryHome = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'snowmobile-'));

function createOldDatabase(home: string): void {
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
}

export async function checkOldDatabase(): Promise<void> {
  const home = temporaryHome();
  createOldDatabase(home);
  const { server, cfg } = await start({ home, port: 0, claude: 'false' });
  assert.strictEqual(cfg.token, 'old-token');
  assert.strictEqual(oneRow(cfg.db, `SELECT seed FROM hunts`)['seed'], 'old seed');
  const sm = oneRow(cfg.db, `SELECT * FROM snowmobiles`);
  assert.strictEqual(sm['name'], 'Old idea');
  assert.strictEqual(sm['problem_ids'], null);
  assert.ok('mismatch' in sm && 'problem' in sm && 'gain' in sm);
  const layers = manyRows(cfg.db, `SELECT layer, COUNT(*) AS n FROM paradigms GROUP BY layer ORDER BY layer`);
  assert.deepStrictEqual(layers.map((l) => l['layer']), ['hardware', 'language', 'os', 'software']);
  server.close();
  // A second start adds nothing twice.
  const again = await start({ home, port: 0, claude: 'false' });
  const total = layers.reduce((s, l) => s + Number(l['n']), 0);
  assert.strictEqual(countOf(again.cfg.db, `SELECT COUNT(*) AS n FROM paradigms`), total);
  again.server.close();
}

function checkSeedProfiles(before: ParadigmRow[]): void {
  const names = ['Hardware generators', 'Actor model', 'Functional package management', 'Data structure server', 'Single-level store', 'Conflict-free replicated data types'];
  for (const profile of repoScores.paradigms.filter((p) => names.includes(p.name))) {
    const seeds = before.filter((p) => p.name === profile.name);
    assert.strictEqual(seeds.length, 1);
    const seed = at(seeds, 0);
    assert.strictEqual(seed.layer, profile.layer);
    assert.strictEqual(seed.summary, profile.definition);
    assert.ok(profile.sources.includes(seed.url));
  }
}

// Remove two seeds per layer to represent the previous seed list, and add user data.
function editSeeds(db: DatabaseSync, before: ParadigmRow[]): ParadigmRow[] {
  const absent = [...new Set(before.map((p) => p.layer))]
    .flatMap((layer) => before.filter((p) => p.layer === layer).slice(-2));
  const edited = at(before, 1);
  for (const p of absent) {db.prepare(`DELETE FROM paradigms WHERE id = ?`).run(p.id);}
  db.prepare(`UPDATE paradigms SET name = ?, summary = ?, url = ? WHERE id = ?`)
    .run(edited.name.toUpperCase(), 'My definition.', 'https://example.com/my-source', edited.id);
  db.prepare(`INSERT INTO axes (name, low, high) VALUES ('My axis', 'low', 'high')`).run();
  db.prepare(`INSERT INTO scores VALUES (?, 1, 7, 'My score.')`).run(edited.id);
  return absent;
}

interface Kept { absent: ParadigmRow[]; kept: ParadigmRow[]; axes: Row[]; scores: Row[]; token: string; total: number }

function checkRestart(current: DatabaseSync, expected: Kept): void {
  assert.strictEqual(countOf(current, `SELECT COUNT(*) AS n FROM paradigms`), expected.total);
  const restored = expected.absent.map((p) => {
    const row = paradigmRows(current, `SELECT * FROM paradigms WHERE name = ?`, p.name)[0];
    assert.deepStrictEqual([row?.layer, row?.summary, row?.url], [p.layer, p.summary, p.url]);
    return defined(row).id;
  });
  assert.deepStrictEqual(paradigmRows(current, `SELECT * FROM paradigms ORDER BY id`).filter((p) => !restored.includes(p.id)), expected.kept);
  assert.deepStrictEqual(manyRows(current, `SELECT * FROM axes`), expected.axes);
  assert.deepStrictEqual(manyRows(current, `SELECT * FROM scores`), expected.scores);
}

async function restartTwice(home: string, expected: Kept, holder: { app: App | null }): Promise<void> {
  for (let pass = 0; pass < 2; pass++) {
    const app = await start({ home, port: 0, claude: 'false' });
    holder.app = app;
    checkRestart(app.cfg.db, expected);
    assert.strictEqual(app.cfg.token, expected.token);
    await closeApp(app);
    app.cfg.db.close();
    holder.app = null;
  }
}

export async function checkSeedUpdate(t: TestContext): Promise<void> {
  const home = temporaryHome();
  const holder: { app: App | null } = { app: null };
  t.after(async () => {
    if (holder.app) {
      await closeApp(holder.app);
      holder.app.cfg.db.close();
    }
    fs.rmSync(home, { recursive: true, force: true });
  });
  const first = await start({ home, port: 0, claude: 'false' });
  holder.app = first;
  const db = first.cfg.db;
  const before = paradigmRows(db, `SELECT * FROM paradigms ORDER BY id`);
  checkSeedProfiles(before);
  const absent = editSeeds(db, before);
  const kept: Kept = { absent, kept: paradigmRows(db, `SELECT * FROM paradigms ORDER BY id`),
    axes: manyRows(db, `SELECT * FROM axes`), scores: manyRows(db, `SELECT * FROM scores`),
    token: first.cfg.token, total: before.length };
  await closeApp(first);
  db.close();
  holder.app = null;
  await restartTwice(home, kept, holder);
}
