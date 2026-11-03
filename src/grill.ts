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
import fs from 'node:fs';
import path from 'node:path';

export const LEFT_OUT = 'left out by you';
export const BURIED = 'Buried by you. ';

export function partsOf(db: Cfg['db'], ids: readonly number[]): PartRow[] {
  if (!ids.length) return [];
  return all<PartRow>(db, `SELECT c.*, s.name AS source FROM components c JOIN sources s ON s.id = c.source_id
    WHERE c.id IN (${ids.map(() => '?').join(',')})`, ...ids);
}

export function ideaOf(db: Cfg['db'], id: number): IdeaRow | undefined {
  return get<IdeaRow>(db, `SELECT * FROM snowmobiles WHERE id = ?`, id);
}

export function treeOf(db: Cfg['db'], smId: number): Tree {
  const row = get<GrillRow>(db, `SELECT * FROM grills WHERE snowmobile_id = ?`, smId);
  if (!row) throw new Error('no such grill');
  return JSON.parse(row.tree) as Tree;
}

export function moveIdea(db: Cfg['db'], id: number, event: IdeaEvent): void {
  const sm = ideaOf(db, id);
  if (!sm) throw new Error('no such idea');
  run(db, `UPDATE snowmobiles SET status = ? WHERE id = ?`, next(ideaMachine, sm.status, event), id);
}

export function standingKill(db: Cfg['db'], componentId: number, mark: string): Tree['killed'] | undefined {
  const g = get<{ tree: string }>(db, `SELECT g.tree FROM grills g JOIN snowmobiles s ON s.id = g.snowmobile_id
    WHERE g.status = 'killed' AND json_extract(g.tree, '$.killed.component_id') = ?
    AND s.name || ': ' || json_extract(g.tree, '$.killed.reason') = ?`, componentId, mark);
  return g ? (JSON.parse(g.tree) as Tree).killed : undefined;
}

export function kill(cfg: Cfg, sm: IdeaRow, componentIdIn: number, reason: string, tree: Tree): void {
  const { db } = cfg;
  const live = ideaOf(db, sm.id);
  if (!live || !allows(ideaMachine, live.status, 'kill')) return;
  let componentId = componentIdIn;
  if (!(JSON.parse(sm.component_ids) as number[]).includes(componentId)) componentId = 0;
  let under: string[] = [], badReason: string | null = null;
  if (componentId) {
    const now = get<ComponentRow>(db, `SELECT bad_reason FROM components WHERE id = ?`, componentId)?.bad_reason ?? null;
    const below = now ? standingKill(db, componentId, now) : undefined;
    if (below && now) [under, badReason] = [[...(below.under || []), now], below.bad_reason];
    else badReason = now;
    run(db, `UPDATE components SET bad_reason = ? WHERE id = ?`, `${sm.name}: ${reason}`, componentId);
  }
  run(db, `UPDATE snowmobiles SET status = ?, proof_note = ? WHERE id = ?`, next(ideaMachine, live.status, 'kill'), reason, sm.id);
  tree.killed = { component_id: componentId, reason, note: sm.proof_note, bad_reason: badReason, under };
  run(db, `UPDATE grills SET tree = ?, status = 'killed', updated_at = CURRENT_TIMESTAMP WHERE snowmobile_id = ?`, JSON.stringify(tree), sm.id);
}

export function undoRound(cfg: Cfg, smId: number): boolean {
  const { db } = cfg;
  const sm = ideaOf(db, smId);
  if (!sm) return false;
  const tree = treeOf(db, smId);
  const last = Math.max(0, ...settledOf(tree).map((d) => d.round));
  if (!last) return false;
  tree.decisions = tree.decisions.filter((d) => d.round <= last);
  for (const d of tree.decisions) if (d.round === last) d.answer = null;
  tree.round = last;
  if (tree.machine && last <= (tree.machine.round ?? 0)) delete tree.machine;
  let note = sm.proof_note;
  if (tree.killed) {
    const { component_id: cid, reason } = tree.killed;
    if (cid && get<ComponentRow>(db, `SELECT bad_reason FROM components WHERE id = ?`, cid)?.bad_reason === `${sm.name}: ${reason}`) {
      const back = (tree.killed.under || []).findLast((m) => standingKill(db, cid, m));
      run(db, `UPDATE components SET bad_reason = ? WHERE id = ?`, back || (tree.killed.bad_reason === LEFT_OUT ? LEFT_OUT : null), cid);
    }
    note = tree.killed.note ?? note;
    delete tree.killed;
  }
  if (sm.status === 'killed' || sm.status === 'grilled') {
    run(db, `UPDATE snowmobiles SET status = ?, proof_note = ? WHERE id = ?`, next(ideaMachine, sm.status, 'undo'), note, smId);
  }
  run(db, `UPDATE grills SET tree = ?, status = 'open', brief = NULL, updated_at = CURRENT_TIMESTAMP WHERE snowmobile_id = ?`, JSON.stringify(tree), smId);
  cfg.grillErrors.delete(smId);
  return true;
}

async function buildMachine(cfg: Cfg, smAxi: string, sm: IdeaRow, settled: SettledDecision[], round: number): Promise<MachineResult> {
  const formatFile = path.join(path.dirname(smAxi), '..', 'references', 'format.md');
  if (!fs.existsSync(formatFile)) return { skipped: 'the skill has no references/format.md' };
  const comps = partsOf(cfg.db, JSON.parse(sm.component_ids));
  const { file } = await ask<{ file: string }>(cfg, machineFilePrompt(sm, comps, settled, fs.readFileSync(formatFile, 'utf8')), MACHINE_SCHEMA, { model: cfg.grillModel });
  try { return { file, findings: runCheck(smAxi, file), round }; } catch (e) { return { skipped: (e as Error).message }; }
}

export function frontier(cfg: Cfg, sm: IdeaRow, settled: SettledDecision[], machine: MachineResult | undefined): Promise<GrillOut> {
  const { frontiers } = cfg;
  const key = frontierKey(sm.id, settled) + (machine && machine.findings ? `:m${machine.findings.length}` : '');
  let p = frontiers.get(key);
  if (!p) {
    const comps = partsOf(cfg.db, JSON.parse(sm.component_ids));
    const made = ask<GrillOut>(cfg, grillPrompt(sm, comps, settled, machine), GRILL_SCHEMA, { model: cfg.grillModel });
    made.catch(() => frontiers.delete(key));
    frontiers.set(key, made);
    p = made;
  }
  return p;
}

export async function advance(cfg: Cfg, smId: number): Promise<void> {
  const { db, grillErrors } = cfg;
  const sm = ideaOf(db, smId);
  if (!sm) return;
  const tree = treeOf(db, smId);
  const settled = settledOf(tree);
  grillErrors.delete(smId);
  const reread = (): Tree => treeOf(db, smId);
  const stale = (t: Tree): boolean => frontierKey(smId, settledOf(t)) !== frontierKey(smId, settled) || t.decisions.some((d) => !d.answer);
  let out: GrillOut;
  try { out = await frontier(cfg, sm, settled, tree.machine); } catch (e) { grillErrors.set(smId, (e as Error).message); return; }
  let now = reread();
  if (stale(now)) return;
  if (out.verdict !== 'killed' && finished(out) && cfg.smAxi && !now.machine) {
    let machine: MachineResult;
    try { machine = await buildMachine(cfg, cfg.smAxi, sm, settled, now.round); } catch (e) { grillErrors.set(smId, (e as Error).message); return; }
    now = reread();
    if (stale(now)) return;
    now.machine = machine;
    run(db, `UPDATE grills SET tree = ? WHERE snowmobile_id = ?`, JSON.stringify(now), smId);
    if (machine.findings && machine.findings.length) {
      try { out = await frontier(cfg, sm, settled, machine); } catch (e) { grillErrors.set(smId, (e as Error).message); return; }
      now = reread();
      if (stale(now)) return;
    }
  }
  const live = ideaOf(db, smId);
  const event: IdeaEvent | null = out.verdict === 'killed' ? 'kill' : finished(out) ? 'finish' : null;
  if (event && (!live || !allows(ideaMachine, live.status, event))) return;
  if (out.verdict === 'killed') return kill(cfg, sm, out.killed_component_id, out.reason, now);
  if (finished(out)) {
    now.round += 1;
    run(db, `UPDATE grills SET tree = ?, status = 'done', brief = ?, updated_at = CURRENT_TIMESTAMP WHERE snowmobile_id = ?`,
      JSON.stringify(now), renderBrief(sm, out.brief, now.machine), smId);
    moveIdea(db, smId, 'finish');
    return;
  }
  const grown = appendRound(now, out.decisions, JSON.parse(sm.component_ids));
  run(db, `UPDATE grills SET tree = ?, updated_at = CURRENT_TIMESTAMP WHERE snowmobile_id = ?`, JSON.stringify(grown), smId);
  frontier(cfg, sm, guessAnswers(grown.decisions), grown.machine).catch(() => {});
}
