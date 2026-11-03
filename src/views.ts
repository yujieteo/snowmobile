import { LAYERS, MISMATCH, PRACTICAL_PROBLEMS } from './data.ts';
import type { Cfg } from './cfg.ts';
import { all, get, type Db, type GrillRow, type IdeaRow } from './db.ts';
import { partsOf } from './grill.ts';
import { gaps, ideaProblems, pca, practicalProblems, type Axis, type Paradigm, type Score, type ScoreTable } from './stack.ts';
import type { HuntRow, ComponentRow, SourceRow } from './db.ts';
import type { Tree } from './types.ts';

export function stackData(db: Db) {
  const axes = all<Axis>(db, `SELECT * FROM axes ORDER BY id`);
  const paradigms = all<Paradigm>(db, `SELECT * FROM paradigms ORDER BY layer, id`);
  const scores: ScoreTable = {};
  for (const s of all<Score>(db, `SELECT * FROM scores`)) (scores[s.paradigm_id] ||= {})[s.axis_id] = s;
  const full = paradigms.filter((p) => axes.length && axes.every((a) => scores[p.id]?.[a.id]));
  const map = pca(full.map((p) => axes.map((a) => scores[p.id]?.[a.id]?.score ?? 0)));
  return { axes, paradigms, scores, practicalProblems: practicalProblems(paradigms),
    map: map && { ...map, ids: full.map((p) => p.id) } };
}

export function stackView(cfg: Cfg, pick: readonly number[]) {
  const data = stackData(cfg.db);
  const ids = pick.filter((id) => data.paradigms.some((p) => p.id === id));
  return { ...data, layers: LAYERS, mismatch: MISMATCH, job: cfg.stackJob,
    selectedProblemCoverage: ids.length ? practicalProblems(data.paradigms.filter((p) => ids.includes(p.id))).coverage : null,
    gaps: ids.length > 1 ? gaps(data.axes, data.scores, ids) : [] };
}

export function huntView(db: Db, id: number) {
  const hunt = get<HuntRow>(db, `SELECT * FROM hunts WHERE id = ?`, id);
  if (!hunt) return null;
  const sources = all<SourceRow>(db, `SELECT * FROM sources WHERE hunt_id = ?`, id)
    .map((s) => ({ ...s, components: all<ComponentRow>(db, `SELECT * FROM components WHERE source_id = ?`, s.id) }));
  const snowmobiles = all<IdeaRow>(db, `SELECT * FROM snowmobiles WHERE hunt_id = ? ORDER BY id`, id)
    .map((s) => ({ ...s, component_ids: JSON.parse(s.component_ids) as number[], ...ideaProblems(JSON.parse(s.problem_ids || 'null')) }));
  if (hunt.stack) snowmobiles.sort((a, b) => b.problem_priority - a.problem_priority);
  const assessed = snowmobiles.filter((s) => s.problem_ids.length).length;
  return { hunt, sources, snowmobiles, problemCoverage: hunt.stack ? {
    total: snowmobiles.length, named: assessed, share: snowmobiles.length ? assessed / snowmobiles.length : null,
    source: PRACTICAL_PROBLEMS.source,
    limit: 'Counts include all candidates, also the graveyard. Links are model claims, not proof of a reduction.',
  } : null };
}

export function grillView(cfg: Cfg, smId: number) {
  const { db, grillErrors } = cfg;
  const sm = get<IdeaRow>(db, `SELECT * FROM snowmobiles WHERE id = ?`, smId);
  if (!sm) return null;
  const grill = get<GrillRow>(db, `SELECT * FROM grills WHERE snowmobile_id = ?`, smId);
  if (!grill) return null;
  const tree = JSON.parse(grill.tree) as Tree;
  const pending = grill.status === 'open' && !tree.decisions.some((d) => !d.answer);
  const ids = JSON.parse(sm.component_ids) as number[];
  return { snowmobile: { ...sm, component_ids: ids }, components: partsOf(db, ids), tree, status: grill.status, brief: grill.brief,
    pending: pending && !grillErrors.has(smId), error: grillErrors.get(smId) || null };
}

export function search(db: Db, q: string) {
  const like = `%${q}%`;
  return {
    hunts: all<HuntRow>(db, `SELECT * FROM hunts WHERE seed LIKE ? ORDER BY id DESC LIMIT 100`, like),
    snowmobiles: all<IdeaRow & { seed: string }>(db, `SELECT s.*, h.seed FROM snowmobiles s JOIN hunts h ON h.id = s.hunt_id
      LEFT JOIN grills g ON g.snowmobile_id = s.id
      WHERE s.name LIKE ? OR s.pitch LIKE ? OR s.proof_note LIKE ? OR g.brief LIKE ? OR g.tree LIKE ?
      ORDER BY s.id DESC LIMIT 200`, like, like, like, like, like),
    components: all<ComponentRow & { source: string; hunt_id: number }>(db, `SELECT c.*, s.name AS source, s.hunt_id FROM components c JOIN sources s ON s.id = c.source_id
      WHERE c.name LIKE ? OR c.mechanism LIKE ? OR s.name LIKE ? ORDER BY c.id DESC LIMIT 200`, like, like, like),
  };
}
