import fs from 'node:fs';
import path from 'node:path';
import { assert } from '../shared/assert.ts';
import { next, allows } from '../shared/fsm.ts';
import { ideaMachine, type IdeaEvent } from '../shared/flow.ts';
import type { Cfg } from './cfg.ts';
import { get, run, all, type ComponentRow, type GrillRow, type IdeaRow, type PartRow } from './db.ts';
import { ask } from './ask.ts';
import { GRILL_SCHEMA, MACHINE_SCHEMA, grillPrompt, machineFilePrompt } from './prompts.ts';
import { runCheck } from './machine.ts';
import { renderBrief } from './brief.ts';
import { appendRound, finished, frontierKey, guessAnswers, settledOf } from './grilltree.ts';
import type { GrillOut, MachineResult, SettledDecision, Tree } from './types.ts';

export const LEFT_OUT = 'left out by you';
export const BURIED = 'Buried by you. ';

export function partsOf(db: Cfg['db'], ids: readonly number[]): PartRow[] {
  assert(db.isOpen, 'the database is open');
  assert(ids.length < 1000, 'a part list is short');
  if (ids.length === 0) {
    return [];
  }
  return all<PartRow>(db, `SELECT c.*, s.name AS source FROM components c JOIN sources s ON s.id = c.source_id
    WHERE c.id IN (${ids.map(() => '?').join(',')})`, ...ids);
}

export function ideaOf(db: Cfg['db'], id: number): IdeaRow | undefined {
  assert(db.isOpen, 'the database is open');
  assert(Number.isInteger(id), 'an idea id is an integer');
  return get<IdeaRow>(db, `SELECT * FROM snowmobiles WHERE id = ?`, id);
}

export function treeOf(db: Cfg['db'], smId: number): Tree {
  assert(db.isOpen, 'the database is open');
  assert(Number.isInteger(smId), 'an idea id is an integer');
  const row = get<GrillRow>(db, `SELECT * FROM grills WHERE snowmobile_id = ?`, smId);
  if (!row) {
    throw new Error('no such grill');
  }
  return JSON.parse(row.tree) as Tree;
}

export function moveIdea(db: Cfg['db'], id: number, event: IdeaEvent): void {
  assert(db.isOpen, 'the database is open');
  assert(Number.isInteger(id), 'an idea id is an integer');
  const sm = ideaOf(db, id);
  if (!sm) {
    throw new Error('no such idea');
  }
  run(db, `UPDATE snowmobiles SET status = ? WHERE id = ?`, next(ideaMachine, sm.status, event), id);
}

export function standingKill(db: Cfg['db'], componentId: number, mark: string): Tree['killed'] | undefined {
  assert(db.isOpen, 'the database is open');
  assert(mark.length > 0, 'a mark is not empty');
  const g = get<{ tree: string }>(db, `SELECT g.tree FROM grills g JOIN snowmobiles s ON s.id = g.snowmobile_id
    WHERE g.status = 'killed' AND json_extract(g.tree, '$.killed.component_id') = ?
    AND s.name || ': ' || json_extract(g.tree, '$.killed.reason') = ?`, componentId, mark);
  return g ? (JSON.parse(g.tree) as Tree).killed : undefined;
}

// What a component carried before this kill: the kills under it, and the reason it was already bad.
function carriedBy(db: Cfg['db'], componentId: number): { under: string[]; badReason: string | null } {
  assert(db.isOpen, 'the database is open');
  assert(componentId > 0, 'a component is named');
  const now = get<ComponentRow>(db, `SELECT bad_reason FROM components WHERE id = ?`, componentId)?.bad_reason ?? null;
  const below = now ? standingKill(db, componentId, now) : undefined;
  if (below && now) {
    return { under: [...((below.under as string[] | undefined) ?? []), now], badReason: below.bad_reason };
  }
  assert(now === null || now.length > 0, 'a bad reason is named or absent');
  assert(componentId > 0, 'a component is named');
  return { under: [], badReason: now };
}

export function kill(cfg: Cfg, sm: IdeaRow, componentIdIn: number, reason: string, tree: Tree): void {
  assert(cfg.db.isOpen, 'the database is open');
  assert(Number.isInteger(componentIdIn), 'a component id is an integer');
  const { db } = cfg;
  const live = ideaOf(db, sm.id);
  if (!live || !allows(ideaMachine, live.status, 'kill')) {
    return;
  }
  let componentId = componentIdIn;
  if (!(JSON.parse(sm.component_ids) as number[]).includes(componentId)) {
    componentId = 0;
  }
  let carried: { under: string[]; badReason: string | null } = { under: [], badReason: null };
  if (componentId) {
    carried = carriedBy(db, componentId);
    run(db, `UPDATE components SET bad_reason = ? WHERE id = ?`, `${sm.name}: ${reason}`, componentId);
  }
  run(db, `UPDATE snowmobiles SET status = ?, proof_note = ? WHERE id = ?`, next(ideaMachine, live.status, 'kill'), reason, sm.id);
  tree.killed = { component_id: componentId, reason, note: sm.proof_note, bad_reason: carried.badReason, under: carried.under };
  run(db, `UPDATE grills SET tree = ?, status = 'killed', updated_at = CURRENT_TIMESTAMP WHERE snowmobile_id = ?`, JSON.stringify(tree), sm.id);
}

// Gives the component back the reason it had before this idea killed it, and returns the idea's earlier note.
function releaseKill(db: Cfg['db'], sm: IdeaRow, killed: NonNullable<Tree['killed']>): string | null {
  assert(db.isOpen, 'the database is open');
  assert(sm.name.length >= 0, 'an idea has a name');
  const { component_id: cid, reason } = killed;
  if (cid && get<ComponentRow>(db, `SELECT bad_reason FROM components WHERE id = ?`, cid)?.bad_reason === `${sm.name}: ${reason}`) {
    const back = ((killed.under as string[] | undefined) ?? []).findLast((m) => standingKill(db, cid, m));
    const kept = killed.bad_reason === LEFT_OUT ? LEFT_OUT : null;
    run(db, `UPDATE components SET bad_reason = ? WHERE id = ?`, back !== undefined && back !== '' ? back : kept, cid);
  }
  assert(reason.length >= 0, 'a kill has a reason text');
  assert(Number.isInteger(cid), 'a kill names a component or none');
  return killed.note ?? sm.proof_note;
}

export function undoRound(cfg: Cfg, smId: number): boolean {
  assert(cfg.db.isOpen, 'the database is open');
  assert(Number.isInteger(smId), 'an idea id is an integer');
  const { db } = cfg;
  const sm = ideaOf(db, smId);
  if (!sm) {
    return false;
  }
  const tree = treeOf(db, smId);
  assert(tree.round >= 0, 'a tree has a round');
  assert(sm.id === smId, 'the idea is the one asked for');
  const last = Math.max(0, ...settledOf(tree).map((d) => d.round));
  if (!last) {
    return false;
  }
  tree.decisions = tree.decisions.filter((d) => d.round <= last);
  for (const d of tree.decisions) {
    if (d.round === last) {
      d.answer = null;
    }
  }
  tree.round = last;
  if (tree.machine && last <= (tree.machine.round ?? 0)) {
    delete tree.machine;
  }
  let note = sm.proof_note;
  if (tree.killed) {
    note = releaseKill(db, sm, tree.killed);
    delete tree.killed;
  }
  if (sm.status === 'killed' || sm.status === 'grilled') {
    run(db, `UPDATE snowmobiles SET status = ?, proof_note = ? WHERE id = ?`, next(ideaMachine, sm.status, 'undo'), note, smId);
  }
  run(db, `UPDATE grills SET tree = ?, status = 'open', brief = NULL, updated_at = CURRENT_TIMESTAMP WHERE snowmobile_id = ?`, JSON.stringify(tree), smId);
  cfg.grillErrors.delete(smId);
  assert(!cfg.grillErrors.has(smId), 'the error is cleared');
  assert(tree.round === last, 'the tree is back at the last round');
  return true;
}

async function buildMachine(cfg: Cfg, smAxi: string, sm: IdeaRow, settled: SettledDecision[], round: number): Promise<MachineResult> {
  assert(smAxi.length > 0, 'the state machine program is named');
  assert(Number.isInteger(round), 'a round is an integer');
  const formatFile = path.join(path.dirname(smAxi), '..', 'references', 'format.md');
  if (!fs.existsSync(formatFile)) {
    return { skipped: 'the skill has no references/format.md' };
  }
  const comps = partsOf(cfg.db, JSON.parse(sm.component_ids) as number[]);
  const { file } = await ask<{ file: string }>(cfg, machineFilePrompt(sm, comps, settled, fs.readFileSync(formatFile, 'utf8')), MACHINE_SCHEMA, { model: cfg.grillModel });
  try {
    return { file, findings: runCheck(smAxi, file), round };
  } catch (e) {
    return { skipped: (e as Error).message };
  }
}

export function frontier(cfg: Cfg, sm: IdeaRow, settled: SettledDecision[], machine: MachineResult | undefined): Promise<GrillOut> {
  assert(Number.isInteger(sm.id), 'an idea id is an integer');
  assert(Number.isInteger(settled.length), 'settled decisions are a list');
  const { frontiers } = cfg;
  const key = frontierKey(sm.id, settled) + (machine?.findings ? `:m${String(machine.findings.length)}` : '');
  let p = frontiers.get(key);
  if (!p) {
    const comps = partsOf(cfg.db, JSON.parse(sm.component_ids) as number[]);
    const made = ask<GrillOut>(cfg, grillPrompt(sm, comps, settled, machine), GRILL_SCHEMA, { model: cfg.grillModel });
    made.catch(() => frontiers.delete(key));
    frontiers.set(key, made);
    p = made;
  }
  assert(p instanceof Promise, 'the frontier is a promise');
  assert(frontiers.get(key) === p, 'the frontier is kept under its key');
  return p;
}

// A guess that fails is dropped on purpose: it only warms the next round, and the real ask will report its own error.
function dropGuess(e: unknown): void {
  assert(e !== undefined, 'a failed guess carries a reason');
  assert(typeof e === 'object' || typeof e === 'string', 'a failed guess carries an error or a message');
}

type Stage = { out: GrillOut; now: Tree } | null;

// Asks for the next step; null means the tree changed meanwhile or the ask failed, and the caller stops.
async function nextStep(cfg: Cfg, sm: IdeaRow, settled: SettledDecision[], machine: MachineResult | undefined, check: (t: Tree) => boolean): Promise<Stage> {
  assert(Number.isInteger(sm.id), 'an idea id is an integer');
  assert(Number.isInteger(settled.length), 'settled decisions are a list');
  let out: GrillOut;
  try {
    out = await frontier(cfg, sm, settled, machine);
  } catch (e) {
    cfg.grillErrors.set(sm.id, (e as Error).message);
    return null;
  }
  const now = treeOf(cfg.db, sm.id);
  assert(now.round >= 0, 'a tree has a round');
  assert(out.verdict.length > 0, 'a verdict is given');
  return check(now) ? null : { out, now };
}

async function finishWithMachine(cfg: Cfg, smAxi: string, sm: IdeaRow, settled: SettledDecision[], stage: NonNullable<Stage>,
  stale: (t: Tree) => boolean): Promise<Stage> {
  assert(smAxi.length > 0, 'the state machine program is named');
  assert(Number.isInteger(settled.length), 'settled decisions are a list');
  let machine: MachineResult;
  try {
    machine = await buildMachine(cfg, smAxi, sm, settled, stage.now.round);
  } catch (e) {
    cfg.grillErrors.set(sm.id, (e as Error).message);
    return null;
  }
  const now = treeOf(cfg.db, sm.id);
  if (stale(now)) {
    return null;
  }
  assert(machine.round === undefined || machine.round >= 0, 'a machine round is not negative');
  assert(now.round >= 0, 'a tree has a round');
  now.machine = machine;
  run(cfg.db, `UPDATE grills SET tree = ? WHERE snowmobile_id = ?`, JSON.stringify(now), sm.id);
  if (!machine.findings?.length) {
    return { out: stage.out, now };
  }
  return nextStep(cfg, sm, settled, machine, stale);
}

function conclude(cfg: Cfg, sm: IdeaRow, out: GrillOut, now: Tree): void {
  assert(Number.isInteger(sm.id), 'an idea id is an integer');
  assert(['open', 'done', 'killed'].includes(out.verdict), 'the verdict is one of three');
  const { db } = cfg;
  assert(now.round >= 0, 'a tree has a round');
  assert(db.isOpen, 'the database is open');
  const live = ideaOf(db, sm.id);
  const event: IdeaEvent | null = out.verdict === 'killed' ? 'kill' : finished(out) ? 'finish' : null;
  if (event && (!live || !allows(ideaMachine, live.status, event))) {
    return;
  }
  if (out.verdict === 'killed') {
    kill(cfg, sm, out.killed_component_id, out.reason, now);
    return;
  }
  if (finished(out)) {
    now.round += 1;
    run(db, `UPDATE grills SET tree = ?, status = 'done', brief = ?, updated_at = CURRENT_TIMESTAMP WHERE snowmobile_id = ?`,
      JSON.stringify(now), renderBrief(sm, out.brief, now.machine), sm.id);
    moveIdea(db, sm.id, 'finish');
    return;
  }
  const grown = appendRound(now, out.decisions, JSON.parse(sm.component_ids) as number[]);
  run(db, `UPDATE grills SET tree = ?, updated_at = CURRENT_TIMESTAMP WHERE snowmobile_id = ?`, JSON.stringify(grown), sm.id);
  frontier(cfg, sm, guessAnswers(grown.decisions), grown.machine).catch(dropGuess);
}

export async function advance(cfg: Cfg, smId: number): Promise<void> {
  assert(cfg.db.isOpen, 'the database is open');
  assert(Number.isInteger(smId), 'an idea id is an integer');
  const { db, grillErrors } = cfg;
  const sm = ideaOf(db, smId);
  if (!sm) {
    return;
  }
  const tree = treeOf(db, smId);
  const settled = settledOf(tree);
  grillErrors.delete(smId);
  const stale = (t: Tree): boolean => frontierKey(smId, settledOf(t)) !== frontierKey(smId, settled) || t.decisions.some((d) => !d.answer);
  let stage = await nextStep(cfg, sm, settled, tree.machine, stale);
  if (!stage) {
    return;
  }
  if (stage.out.verdict !== 'killed' && finished(stage.out) && cfg.smAxi && !stage.now.machine) {
    stage = await finishWithMachine(cfg, cfg.smAxi, sm, settled, stage, stale);
    if (!stage) {
      return;
    }
  }
  conclude(cfg, sm, stage.out, stage.now);
}
