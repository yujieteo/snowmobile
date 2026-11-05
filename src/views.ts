import { assert } from '../shared/assert.ts';
import { LAYERS, MISMATCH, PRACTICAL_PROBLEMS, type ProblemId } from './data.ts';
import type { Cfg } from './cfg.ts';
import { all, get, type Db, type GrillRow, type IdeaRow } from './db.ts';
import { partsOf } from './grill.ts';
import { gaps, ideaProblems, pca, practicalProblems, type Axis, type Paradigm, type Score, type ScoreTable } from './stack.ts';
import type { HuntRow, ComponentRow, SourceRow } from './db.ts';
import type { Tree } from './types.ts';

function scoreTableOf(db: Db): ScoreTable {
  assert(db.isOpen, 'the database is open');
  assert(typeof LAYERS === 'object', 'the layers are known');
  const scores: ScoreTable = {};
  for (const s of all<Score>(db, `SELECT * FROM scores`)) {
    scores[s.paradigm_id] ??= {};
    const row = scores[s.paradigm_id];
    if (row) {
      row[s.axis_id] = s;
    }
  }
  assert(typeof scores === 'object', 'the table is an object');
  assert(Object.keys(scores).length >= 0, 'the table counts its rows');
  return scores;
}

export function stackData(db: Db) {
  assert(db.isOpen, 'the database is open');
  assert(Number.isInteger(MISMATCH), 'a mismatch threshold is set');
  const axes = all<Axis>(db, `SELECT * FROM axes ORDER BY id`);
  const paradigms = all<Paradigm>(db, `SELECT * FROM paradigms ORDER BY layer, id`);
  const scores = scoreTableOf(db);
  assert(paradigms.length >= 0, 'paradigms are counted');
  assert(Object.keys(scores).length >= 0, 'score rows are counted');
  const full = paradigms.filter((p) => axes.length && axes.every((a) => scores[p.id]?.[a.id]));
  const map = pca(full.map((p) => axes.map((a) => scores[p.id]?.[a.id]?.score ?? 0)));
  assert(full.length <= paradigms.length, 'scored paradigms are a subset');
  assert(axes.length >= 0, 'axes are counted');
  assert(map === null || map.points.length === full.length, 'the map has a point for each scored paradigm');
  return { axes, paradigms, scores, practicalProblems: practicalProblems(paradigms),
    map: map && { ...map, ids: full.map((p) => p.id) } };
}

export function stackView(cfg: Cfg, pick: readonly number[]) {
  assert(Number.isInteger(pick.length), 'the pick is a list');
  assert(cfg.db.isOpen, 'the database is open');
  const data = stackData(cfg.db);
  assert(data.paradigms.length >= 0, 'paradigms are counted');
  assert(cfg.stackJob === null || cfg.stackJob.step.length > 0, 'a stack job names its step');
  const ids = pick.filter((id) => data.paradigms.some((p) => p.id === id));
  assert(ids.length <= pick.length, 'picked ids are a subset of the pick');
  assert(ids.length >= 0, 'picked ids are counted');
  return { ...data, layers: LAYERS, mismatch: MISMATCH, job: cfg.stackJob,
    selectedProblemCoverage: ids.length ? practicalProblems(data.paradigms.filter((p) => ids.includes(p.id))).coverage : null,
    gaps: ids.length > 1 ? gaps(data.axes, data.scores, ids) : [] };
}

function sourcesOf(db: Db, huntId: number): (SourceRow & { components: ComponentRow[] })[] {
  assert(db.isOpen, 'the database is open');
  assert(Number.isInteger(huntId), 'a hunt id is an integer');
  const sources = all<SourceRow>(db, `SELECT * FROM sources WHERE hunt_id = ?`, huntId);
  assert(sources.length >= 0, 'sources are counted');
  assert(sources.every((s) => s.hunt_id === huntId), 'sources belong to the hunt');
  return sources
    .map((s) => ({ ...s, components: all<ComponentRow>(db, `SELECT * FROM components WHERE source_id = ?`, s.id) }));
}

function problemCoverageOf(snowmobiles: readonly { problem_ids: readonly ProblemId[] }[]) {
  assert(Number.isInteger(snowmobiles.length), 'the ideas are a list');
  assert(PRACTICAL_PROBLEMS.items.length > 0, 'the survey names practical problems');
  const assessed = snowmobiles.filter((s) => s.problem_ids.length).length;
  assert(assessed <= snowmobiles.length, 'assessed ideas are a subset');
  assert(assessed >= 0, 'assessed ideas are counted');
  assert(PRACTICAL_PROBLEMS.source.respondents > 0, 'the survey has respondents');
  return {
    total: snowmobiles.length, named: assessed, share: snowmobiles.length ? assessed / snowmobiles.length : null,
    source: PRACTICAL_PROBLEMS.source,
    limit: 'Counts include all candidates, also the graveyard. Links are model claims, not proof of a reduction.',
  };
}

export function huntView(db: Db, id: number) {
  assert(db.isOpen, 'the database is open');
  assert(Number.isInteger(id), 'a hunt id is an integer');
  const hunt = get<HuntRow>(db, `SELECT * FROM hunts WHERE id = ?`, id);
  if (!hunt) {
    return null;
  }
  const sources = sourcesOf(db, id);
  const snowmobiles = all<IdeaRow>(db, `SELECT * FROM snowmobiles WHERE hunt_id = ? ORDER BY id`, id)
    .map((s) => ({ ...s, component_ids: JSON.parse(s.component_ids) as number[], ...ideaProblems(JSON.parse(s.problem_ids ?? 'null')) }));
  if (hunt.stack) {
    snowmobiles.sort((a, b) => b.problem_priority - a.problem_priority);
  }
  assert(hunt.id === id, 'the hunt is the one asked for');
  assert(snowmobiles.length >= 0, 'ideas are counted');
  assert(sources.length >= 0, 'sources are counted');
  return { hunt, sources, snowmobiles, problemCoverage: hunt.stack ? problemCoverageOf(snowmobiles) : null };
}

export function grillView(cfg: Cfg, smId: number) {
  assert(Number.isInteger(smId), 'an idea id is an integer');
  assert(cfg.db.isOpen, 'the database is open');
  const { db, grillErrors } = cfg;
  const sm = get<IdeaRow>(db, `SELECT * FROM snowmobiles WHERE id = ?`, smId);
  assert(grillErrors.size >= 0, 'grill errors are counted');
  if (!sm) {
    return null;
  }
  const grill = get<GrillRow>(db, `SELECT * FROM grills WHERE snowmobile_id = ?`, smId);
  if (!grill) {
    return null;
  }
  const tree = JSON.parse(grill.tree) as Tree;
  const pending = grill.status === 'open' && !tree.decisions.some((d) => !d.answer);
  const ids = JSON.parse(sm.component_ids) as number[];
  assert(grill.snowmobile_id === smId, 'the grill belongs to the idea');
  assert(ids.length >= 0, 'part ids are counted');
  assert(tree.round >= 0, 'a tree has a round');
  const errorText = grillErrors.get(smId);
  return { snowmobile: { ...sm, component_ids: ids }, components: partsOf(db, ids), tree, status: grill.status, brief: grill.brief,
    pending: pending && !grillErrors.has(smId), error: errorText === undefined || errorText === '' ? null : errorText };
}

export function search(db: Db, q: string) {
  assert(db.isOpen, 'the database is open');
  assert(typeof q === 'string', 'the search text is text');
  const like = `%${q}%`;
  assert(like.length >= 2, 'the pattern has its percent signs');
  assert(like.startsWith('%') && like.endsWith('%'), 'the pattern wraps the text');
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
