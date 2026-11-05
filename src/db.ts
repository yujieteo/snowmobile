import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { assert } from '../shared/assert.ts';
import { START, type Layer } from './data.ts';
import type { HuntState, IdeaState } from '../shared/flow.ts';

export type Db = DatabaseSync;
export type Param = SQLInputValue;

export interface HuntRow { id: number; seed: string; status: HuntState; error: string | null; created_at: string; stack: string | null }
export interface SourceRow { id: number; hunt_id: number; name: string; kind: string; url: string; summary: string }
export interface ComponentRow { id: number; source_id: number; name: string; mechanism: string; url: string; bad_reason: string | null; paradigm_id: number | null }
export interface PartRow extends ComponentRow { source: string; source_kind: string }
export interface IdeaRow {
  id: number; hunt_id: number; name: string; pitch: string; component_ids: string; status: Exclude<IdeaState, 'candidate'>;
  proof_url: string | null; proof_note: string | null; created_at: string; mismatch: string | null; problem: string | null;
  evidence_url: string | null; conventional: string | null; gain_axis: string | null; gain: string | null; problem_ids: string | null;
}
export interface GrillRow { id: number; snowmobile_id: number; tree: string; status: 'open' | 'done' | 'killed'; brief: string | null; updated_at: string }
export interface ParadigmRow { id: number; layer: Layer; name: string; summary: string; url: string }

export function all<T>(db: Db, sql: string, ...params: Param[]): T[] {
  assert(db.isOpen, 'the database is open');
  assert(sql.length > 0, 'a query is not empty');
  assert(params.length < 1000, 'a query has few parameters');
  return db.prepare(sql).all(...params) as unknown as T[];
}

export function get<T>(db: Db, sql: string, ...params: Param[]): T | undefined {
  assert(db.isOpen, 'the database is open');
  assert(sql.length > 0, 'a query is not empty');
  assert(params.length < 1000, 'a query has few parameters');
  return db.prepare(sql).get(...params) as unknown as T | undefined;
}

export function run(db: Db, sql: string, ...params: Param[]): { changes: number; id: number } {
  assert(db.isOpen, 'the database is open');
  assert(sql.length > 0, 'a statement is not empty');
  assert(params.length < 1000, 'a statement has few parameters');
  const r = db.prepare(sql).run(...params);
  const result = { changes: Number(r.changes), id: Number(r.lastInsertRowid) };
  assert(result.changes >= 0, 'a statement changes no negative rows');
  return result;
}

const LATE_COLUMNS: readonly [string, string][] = [['hunts', 'stack'], ['components', 'paradigm_id'], ['snowmobiles', 'mismatch'],
  ['snowmobiles', 'problem'], ['snowmobiles', 'evidence_url'], ['snowmobiles', 'conventional'],
  ['snowmobiles', 'gain_axis'], ['snowmobiles', 'gain'], ['snowmobiles', 'problem_ids']];

const SCHEMA = `
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
  `;

function addLateColumns(db: Db): void {
  assert(LATE_COLUMNS.length > 0, 'the late columns are listed');
  assert(db.isOpen, 'the database is open');
  for (const [table, column] of LATE_COLUMNS) {
    const has = all<{ name: string }>(db, `PRAGMA table_info(${table})`).some((c) => c.name === column);
    if (!has) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${column === 'paradigm_id' ? 'INTEGER' : 'TEXT'}`);
    }
  }
}

function seedParadigms(db: Db): void {
  assert(db.isOpen, 'the database is open');
  assert(Object.keys(START).length > 0, 'the start list has layers');
  const names = new Set(all<{ name: string }>(db, `SELECT name FROM paradigms`).map((p) => p.name.toLowerCase()));
  const add = db.prepare(`INSERT INTO paradigms (layer, name, summary, url) VALUES (?, ?, ?, ?)`);
  for (const [layer, list] of Object.entries(START)) {
    for (const p of list) {
      const name = p[0].toLowerCase();
      if (!names.has(name)) {
        add.run(layer, ...p);
        names.add(name);
      }
    }
  }
}

export function openDb(file: string): Db {
  assert(file.length > 0, 'the database file is named');
  assert(SCHEMA.includes('PRAGMA journal_mode = WAL'), 'the schema turns on the write-ahead log');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  addLateColumns(db);
  seedParadigms(db);
  assert(db.isOpen, 'the database stays open');
  run(db, `UPDATE hunts SET status = 'failed', error = 'snowmobile stopped during this step'
    WHERE status IN ('hunting', 'creating')`);
  return db;
}

export function token(db: Db): string {
  assert(db.isOpen, 'the database is open');
  assert(crypto.randomBytes(1).length === 1, 'the system makes random bytes');
  const row = get<{ value: string }>(db, `SELECT value FROM meta WHERE key = 'token'`);
  if (row) {
    return row.value;
  }
  const t = crypto.randomBytes(16).toString('hex');
  assert(t.length === 32, 'a token is 32 hex digits');
  run(db, `INSERT INTO meta (key, value) VALUES ('token', ?)`, t);
  return t;
}
