import { next } from '../shared/fsm.ts';
import { huntMachine, stackJobMachine, type HuntEvent } from '../shared/flow.ts';
import { LAYERS, LAYER_KEYS, type Layer } from './data.ts';
import type { Cfg } from './cfg.ts';
import { all, get, run, type ComponentRow, type Db, type HuntRow, type ParadigmRow, type PartRow } from './db.ts';
import { ask } from './ask.ts';
import { AXES_SCHEMA, CREATE_SCHEMA, HUNT_SCHEMA, PARADIGM_SCHEMA, POINT_SCHEMA, SCORE_SCHEMA, STACK_CREATE_SCHEMA,
  axesPrompt, createPrompt, huntPrompt, paradigmPrompt, pointPrompt, scorePrompt, stackCreatePrompt } from './prompts.ts';
import { ideaRow } from './recombine.ts';
import { practicalProblems, type Axis, type Paradigm, type Score } from './stack.ts';
import { stackData } from './views.ts';
import type { Candidate } from './types.ts';

export function moveHunt(db: Db, id: number, event: HuntEvent, error: string | null = null): string {
  const hunt = get<HuntRow>(db, `SELECT * FROM hunts WHERE id = ?`, id);
  if (!hunt) throw new Error('no such hunt');
  const to = next(huntMachine, hunt.status, event);
  run(db, `UPDATE hunts SET status = ?, error = ? WHERE id = ?`, to, error, id);
  return to;
}

export async function runHunt(cfg: Cfg, huntId: number): Promise<void> {
  const { db } = cfg;
  const hunt = get<HuntRow>(db, `SELECT * FROM hunts WHERE id = ?`, huntId);
  if (!hunt) return;
  try {
    if (hunt.stack) throw new Error('a stack hunt takes its parts from the stack map');
    const bad = all<Pick<ComponentRow, 'name' | 'bad_reason'>>(db, `SELECT name, bad_reason FROM components WHERE bad_reason IS NOT NULL`);
    const out = await ask<{ sources: { name: string; kind: string; url: string; summary: string;
      components: { name: string; mechanism: string; url: string }[] }[] }>(cfg, huntPrompt(hunt.seed, bad), HUNT_SCHEMA, { web: true });
    for (const s of out.sources) {
      const sid = run(db, `INSERT INTO sources (hunt_id, name, kind, url, summary) VALUES (?, ?, ?, ?, ?)`, huntId, s.name, s.kind, s.url, s.summary).id;
      for (const c of s.components) run(db, `INSERT INTO components (source_id, name, mechanism, url) VALUES (?, ?, ?, ?)`, sid, c.name, c.mechanism, c.url);
    }
    moveHunt(db, huntId, 'hunt_done');
  } catch (e) {
    moveHunt(db, huntId, 'fail', (e as Error).message);
  }
}

export async function runCreate(cfg: Cfg, huntId: number): Promise<void> {
  const { db } = cfg;
  const hunt = get<HuntRow>(db, `SELECT * FROM hunts WHERE id = ?`, huntId);
  if (!hunt) return;
  try {
    const comps = all<PartRow>(db, `SELECT c.*, s.name AS source, s.kind AS source_kind FROM components c JOIN sources s ON s.id = c.source_id
      WHERE s.hunt_id = ? AND c.bad_reason IS NULL`, huntId);
    const prompt = hunt.stack ? stackCreatePrompt(hunt.seed, comps, stackData(db)) : createPrompt(hunt.seed, comps);
    const out = await ask<{ candidates: Candidate[] }>(cfg, prompt, hunt.stack ? STACK_CREATE_SCHEMA : CREATE_SCHEMA, { web: true });
    const known = comps.map((c) => c.id);
    for (const c of out.candidates) {
      const r = ideaRow(c, known, Boolean(hunt.stack));
      run(db, `INSERT INTO snowmobiles (hunt_id, name, pitch, component_ids, status, proof_url, proof_note,
        problem, evidence_url, conventional, gain_axis, gain, mismatch, problem_ids) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      huntId, r.name, r.pitch, r.component_ids, r.status, r.proof_url, r.proof_note, r.problem, r.evidence_url, r.conventional,
      r.gain_axis, r.gain, r.mismatch, r.problem_ids);
    }
    moveHunt(db, huntId, 'create_done');
  } catch (e) {
    moveHunt(db, huntId, 'fail', (e as Error).message);
  }
}

export function plantStack(db: Db, huntId: number, pick: readonly number[]): void {
  const chosen = all<ParadigmRow>(db, `SELECT * FROM paradigms`);
  for (const layer of LAYER_KEYS) {
    const own = chosen.filter((p) => p.layer === layer);
    for (const p of own.some((q) => pick.includes(q.id)) ? own.filter((q) => pick.includes(q.id)) : own) {
      const sid = run(db, `INSERT INTO sources (hunt_id, name, kind, url, summary) VALUES (?, ?, ?, ?, ?)`, huntId, p.name, layer, p.url, p.summary).id;
      run(db, `INSERT INTO components (source_id, name, mechanism, url, paradigm_id) VALUES (?, ?, ?, ?, ?)`, sid, p.name, p.summary, p.url, p.id);
    }
  }
}

async function scoreMissing(cfg: Cfg): Promise<void> {
  const { db } = cfg;
  const axes = all<Axis>(db, `SELECT * FROM axes ORDER BY id`);
  if (!axes.length) return;
  const missing = all<Paradigm>(db, `SELECT * FROM paradigms p WHERE (SELECT COUNT(*) FROM scores s WHERE s.paradigm_id = p.id) < ?`, axes.length);
  if (!missing.length) return;
  cfg.stackJob = { step: 'scoring' };
  const out = await ask<{ scores: Score[] }>(cfg, scorePrompt(axes, missing), SCORE_SCHEMA);
  const pids = new Set(missing.map((p) => p.id)), aids = new Set(axes.map((a) => a.id));
  for (const s of out.scores) {
    if (pids.has(s.paradigm_id) && aids.has(s.axis_id)) {
      run(db, `INSERT OR IGNORE INTO scores (paradigm_id, axis_id, score, reason) VALUES (?, ?, ?, ?)`,
        s.paradigm_id, s.axis_id, Math.min(10, Math.max(0, s.score)), s.reason);
    }
  }
}

export type StackStep = 'axes' | 'hunting';

export async function runStackJob(cfg: Cfg, step: StackStep): Promise<void> {
  const { db } = cfg;
  cfg.stackJob = { step };
  try {
    if (step === 'axes' && !get(db, `SELECT 1 FROM axes LIMIT 1`)) {
      const out = await ask<{ axes: { name: string; low: string; high: string }[] }>(cfg, axesPrompt(all<Paradigm>(db, `SELECT * FROM paradigms`)), AXES_SCHEMA);
      for (const a of out.axes.slice(0, 12)) run(db, `INSERT INTO axes (name, low, high) VALUES (?, ?, ?)`, a.name, a.low, a.high);
    }
    if (step === 'hunting') {
      const have = all<Paradigm>(db, `SELECT * FROM paradigms`);
      const out = await ask<{ paradigms: { layer: Layer; name: string; summary: string; url: string }[] }>(cfg, paradigmPrompt(have), PARADIGM_SCHEMA, { web: true });
      const names = new Set(have.map((p) => p.name.toLowerCase()));
      for (const p of out.paradigms) {
        if (LAYERS[p.layer] && !names.has(p.name.toLowerCase())) {
          names.add(p.name.toLowerCase());
          run(db, `INSERT INTO paradigms (layer, name, summary, url) VALUES (?, ?, ?, ?)`, p.layer, p.name, p.summary, p.url);
        }
      }
    }
    await scoreMissing(cfg);
    cfg.stackJob = null;
  } catch (e) {
    cfg.stackJob = { step, error: (e as Error).message };
  }
}

export function stackJobState(job: Cfg['stackJob']): 'idle' | 'running' | 'failed' {
  return !job ? 'idle' : job.error ? 'failed' : 'running';
}

export function startStackJob(cfg: Cfg, step: StackStep): boolean {
  const state = stackJobState(cfg.stackJob);
  if (next(stackJobMachine, state, 'start') === state) return false;
  void runStackJob(cfg, step);
  return true;
}

export interface PointAnswer { layer: Layer; name: string; exists: boolean; url: string; why: string }

export async function askPoint(cfg: Cfg, x: number, y: number): Promise<{ x: number; y: number; profile: number[]; answer: PointAnswer }> {
  const data = stackData(cfg.db);
  const { map, axes } = data;
  if (!map) throw new Error('the map needs axes and scores first');
  const c0 = map.components[0] ?? [], c1 = map.components[1] ?? [];
  const profile = map.mean.map((m, j) => Math.round(10 * Math.min(10, Math.max(0, m + x * (c0[j] ?? 0) + y * (c1[j] ?? 0)))) / 10);
  const near = map.ids.map((id, i) => ({ id, d: Math.hypot((map.points[i]?.[0] ?? 0) - x, (map.points[i]?.[1] ?? 0) - y) }))
    .sort((a, b) => a.d - b.d).slice(0, 3).flatMap((n) => data.paradigms.filter((p) => p.id === n.id).slice(0, 1));
  const answer = await ask<PointAnswer>(cfg, pointPrompt(axes, profile, near, data.practicalProblems), POINT_SCHEMA);
  return { x, y, profile, answer };
}

export { practicalProblems };
