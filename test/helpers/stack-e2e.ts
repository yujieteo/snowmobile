import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { TestContext } from 'node:test';
import { start } from '../../src/server.ts';
import { at, asJson, bodyOf, defined, promptJson, sleep } from './stack-util.ts';

interface Coverage { withoutReduction: string[]; unassessedParadigms: number }
interface Link { paradigm_id: number; paradigm: string; problem_id: string; reason: string; source: { title: string; url: string } }
interface Problems {
  items: { id: string; percent: number }[];
  source: { url: string; respondents: number; scope: string; measure: string; limit: string };
  coverage: Coverage; links: Link[];
}
interface Paradigm { id: number; name: string; layer: string }
interface Score { paradigm_id: number; axis_id: number; score: number; reason: string }
interface StackBody {
  axes: { id: number; name: string }[]; map: { ids: number[]; points: unknown[] } | null; job?: unknown;
  paradigms: Paradigm[]; practicalProblems: Problems; selectedProblemCoverage: Coverage | null;
  scores: Record<number, Record<number, Score>>; layers: Record<string, unknown>;
  gaps: { gap: number; mismatch: boolean }[]; mismatch: number;
}
interface Snowmobile {
  id: number; name: string; status: string; problem_ids: string[]; problem_priority: number;
  component_ids: unknown[]; mismatch: string;
}
interface HuntBody {
  hunt: { status: string }; sources: { kind: string }[]; snowmobiles: Snowmobile[];
  problemCoverage: { named: number; total: number; share: number; source: { url: string } };
}
interface GrillBody { pending?: unknown; status?: string; brief: string }
interface PointBody { profile: unknown[]; answer: { name: string; exists: boolean; url: string } }

export interface Ctx {
  home: string; db: Awaited<ReturnType<typeof start>>['cfg']['db'];
  send: (p: string, body?: object) => Promise<{ status: number; body: unknown }>;
  stack: (p: string) => Promise<StackBody>;
  hunt: (p: string) => Promise<HuntBody>;
  untilStack: () => Promise<StackBody>;
  untilHunt: (id: number) => Promise<HuntBody>;
  prompt: (name: string) => string;
}

async function poll<T>(fetch1: () => Promise<T>, ok: (b: T) => unknown, label: string): Promise<T> {
  for (let i = 0; i < 100; i++) {
    const r = await fetch1();
    if (ok(r)) {return r;}
    await sleep(50);
  }
  throw new Error(`timeout on ${label}`);
}

export async function makeCtx(t: TestContext): Promise<Ctx> {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'snowmobile-'));
  const { server, cfg, port } = await start({ home, port: 0, claude: path.join(import.meta.dirname, '../fake-claude.ts') });
  t.after(() => server.close());
  const send: Ctx['send'] = async (p, body) => {
    const init: RequestInit = { method: body ? 'POST' : 'GET', headers: { 'x-token': cfg.token } };
    if (body) {init.body = JSON.stringify(body);}
    const res = await fetch(`http://127.0.0.1:${String(port)}${p}`, init);
    return { status: res.status, body: await bodyOf(res) };
  };
  const stack = async (p: string): Promise<StackBody> => (await send(p)).body as StackBody;
  const hunt = async (p: string): Promise<HuntBody> => (await send(p)).body as HuntBody;
  return { home, db: cfg.db, send, stack, hunt,
    untilStack: () => poll(() => stack('/api/stack'), (b) => !b.job, '/api/stack'),
    untilHunt: (id) => poll(() => hunt(`/api/hunts/${String(id)}`), (b) => b.hunt.status === 'created', `/api/hunts/${String(id)}`),
    prompt: (name) => fs.readFileSync(path.join(home, name), 'utf8') };
}

// Reason: a problem share without its source or sample scope can imply a false priority.
function checkProblems(s: StackBody): Problems {
  const problems = s.practicalProblems;
  assert.deepStrictEqual(problems.items.map((p) => [p.id, p.percent]), [
    ['technical-debt', 62.4], ['build-complexity', 32.9],
    ['deployment-complexity', 32.3], ['unreliable-tools', 31.5],
  ]);
  assert.strictEqual(problems.source.url,
    'https://survey.stackoverflow.co/2024/professional-developers/#2-most-common-frustrations');
  assert.strictEqual(problems.source.respondents, 28251);
  assert.match(problems.source.scope, /Professional Developer/);
  assert.match(problems.source.measure, /more than one/);
  assert.match(problems.source.limit, /do not measure severity/);
  assert.deepStrictEqual(problems.coverage.withoutReduction, []);
  assert.strictEqual(problems.coverage.unassessedParadigms, s.paradigms.length - new Set(problems.links.map((l) => l.paradigm_id)).size);
  for (const l of problems.links) {
    assert.ok(s.paradigms.some((p) => p.id === l.paradigm_id && p.name === l.paradigm));
    assert.ok(problems.items.some((p) => p.id === l.problem_id));
    assert.ok(l.reason && l.source.title && l.source.url.startsWith('https://'));
  }
  return problems;
}

// Reason: database coverage hid problems that the selected stack had no assessment to reduce.
async function checkSelection(ctx: Ctx, s: StackBody, problems: Problems): Promise<void> {
  assert.strictEqual(s.selectedProblemCoverage, null);
  const named = (name: string): Paradigm => defined(s.paradigms.find((p) => p.name === name), name);
  const microservices = named('Microservices');
  const nix = named('Functional package management');
  const unassessed = defined(s.paradigms.find((p) => !problems.links.some((l) => l.paradigm_id === p.id)));
  const selectedServices = await ctx.stack(`/api/stack?pick=${String(microservices.id)}`);
  assert.deepStrictEqual(selectedServices.practicalProblems.coverage.withoutReduction, []);
  const services = defined(selectedServices.selectedProblemCoverage);
  assert.deepStrictEqual(services.withoutReduction, ['build-complexity', 'deployment-complexity']);
  assert.strictEqual(services.unassessedParadigms, 0);
  const useful = defined((await ctx.stack(`/api/stack?pick=${String(nix.id)},${String(unassessed.id)},${String(unassessed.id)},999999`)).selectedProblemCoverage);
  assert.deepStrictEqual(useful.withoutReduction, ['technical-debt']);
  assert.strictEqual(useful.unassessedParadigms, 1);
  assert.strictEqual((await ctx.stack('/api/stack?pick=999999')).selectedProblemCoverage, null);
  assert.strictEqual((await ctx.stack('/api/stack')).selectedProblemCoverage, null);
}

function checkScores(s: StackBody): void {
  for (const p of s.paradigms) {for (const a of s.axes) {
    const score = defined(defined(s.scores[p.id])[a.id]);
    assert.ok(Number.isInteger(score.score) && score.score >= 0 && score.score <= 10);
    assert.ok(score.reason.trim());
  }}
}

async function scoreAxes(ctx: Ctx, n: number): Promise<StackBody> {
  await ctx.send('/api/stack/axes', {});
  const s = await ctx.untilStack();
  assert.strictEqual(s.axes.length, 4);
  const map = defined(s.map);
  assert.strictEqual(map.ids.length, n);
  assert.strictEqual(map.points.length, n);
  checkScores(s);
  return s;
}

// Hunt more: a paradigm that the map has already is left out, and the new one gets scores.
async function huntMore(ctx: Ctx, n: number, problems: Problems): Promise<StackBody> {
  await ctx.send('/api/stack/hunting', {});
  const s = await ctx.untilStack();
  assert.strictEqual(s.paradigms.length, n + 1);
  assert.strictEqual(defined(s.map).ids.length, n + 1);
  // Reason: the paradigm hunt had no practical problems or source assessments.
  const huntPrompt = ctx.prompt('paradigm-prompt');
  assert.deepStrictEqual(promptJson(huntPrompt, 'Practical problems and source assessments (JSON):\n'), problems);
  assert.match(huntPrompt, /Order candidates by the greatest respondent share of a problem they can reduce/);
  assert.match(huntPrompt, /Do not add shares or equate prevalence with severity/);
  assert.match(huntPrompt, /Prefer evidence of practical benefit over map distance/);
  assert.match(huntPrompt, /Use source links to explain each benefit, harm and limit in the summary/);
  return s;
}

// The owner edits an axis and a score; a later scoring run keeps the edit.
async function ownerEdits(ctx: Ctx, s: StackBody): Promise<StackBody> {
  const a1 = at(s.axes, 0);
  const first = defined(s.paradigms.find((p) => p.layer === 'hardware'));
  assert.strictEqual((await ctx.send(`/api/axes/${String(a1.id)}`, { name: 'where state lives', low: 'device', high: 'cloud' })).status, 200);
  assert.strictEqual((await ctx.send('/api/scores', { paradigm_id: first.id, axis_id: a1.id, score: 11 })).status, 400);
  await ctx.send('/api/scores', { paradigm_id: first.id, axis_id: a1.id, score: 10, reason: 'mine' });
  await ctx.send('/api/stack/axes', {});
  const edited = await ctx.untilStack();
  assert.strictEqual(at(edited.axes, 0).name, 'where state lives');
  assert.deepStrictEqual(defined(defined(edited.scores[first.id])[a1.id]), { paradigm_id: first.id, axis_id: a1.id, score: 10, reason: 'mine' });
  return edited;
}

// A tap on an empty point asks which paradigm would live there.
async function tapPoint(ctx: Ctx, s: StackBody): Promise<void> {
  const pt = (await ctx.send('/api/stack/point', { x: 1, y: -1 })).body as PointBody;
  assert.strictEqual(pt.profile.length, 4);
  assert.strictEqual(pt.answer.name, 'No verified match');
  assert.strictEqual(pt.answer.exists, false);
  assert.strictEqual(pt.answer.url, '');
  // Reason: the map-point trial supplied no practical problems and requested an invented paradigm.
  const pointPrompt = ctx.prompt('point-prompt');
  assert.deepStrictEqual(promptJson(pointPrompt, 'Practical problems and source assessments (JSON):\n'), s.practicalProblems);
  assert.match(pointPrompt, /prefer evidence of practical benefit over map distance/);
  assert.match(pointPrompt, /When evidence and benefit are comparable, use the greatest respondent share/);
  assert.match(pointPrompt, /Do not add shares or equate prevalence with severity/);
  assert.match(pointPrompt, /source links for the benefit, harm and limits/);
  assert.match(pointPrompt, /Each real paradigm needs a URL that you opened/);
  assert.match(pointPrompt, /Do not invent paradigms or URLs/);
  assert.match(pointPrompt, /If no real paradigm fits, set exists false, name "No verified match", and url ""/);
}

// One paradigm per layer is a stack, and the gaps show on each axis.
async function pickStack(ctx: Ctx, s: StackBody): Promise<{ pick: number[]; stack: StackBody }> {
  const pick = Object.keys(s.layers).map((l) => defined(s.paradigms.find((p) => p.layer === l)).id);
  const stack = await ctx.stack(`/api/stack?pick=${pick.join(',')}`);
  assert.strictEqual(stack.gaps.length, 4);
  assert.ok(stack.gaps.every((g) => g.mismatch === g.gap >= stack.mismatch));
  const second = at(stack.paradigms.filter((p) => p.layer === 'language'), 1).id;
  assert.strictEqual((await ctx.send('/api/hunts', { stack: [at(pick, 0), second] })).status, 400);
  assert.strictEqual((await ctx.send('/api/hunts', { stack: [] })).status, 400);
  return { pick, stack };
}

// Reason: the brainstorm omitted all source assessments, which include a harmful effect.
async function checkBroadHunt(ctx: Ctx, stack: StackBody): Promise<void> {
  const broad = (await ctx.send('/api/hunts', { seed: 'reliable tools', stack: [] })).body as { id: number };
  await ctx.untilHunt(broad.id);
  const prompt = ctx.prompt('stack-prompt');
  assert.deepStrictEqual(promptJson(prompt, 'Source assessments for available paradigms (JSON):\n'), stack.practicalProblems.links);
  assert.match(prompt, /explain that cost in gain and compare it with the benefit/);
  assert.match(prompt, /No assessment means an unknown effect/);
}

function checkCandidates(ctx: Ctx, h: HuntBody, layers: string[], problems: Problems): void {
  assert.deepStrictEqual(h.sources.map((x) => x.kind), layers);
  assert.deepStrictEqual(h.snowmobiles.map((x) => x.status), ['survivor', 'survivor', 'graveyard', 'graveyard', 'graveyard']);
  // Reason: model order must not outrank a sourced problem, and all candidates must count.
  assert.deepStrictEqual(h.snowmobiles.slice(0, 2).map((s) => s.name), ['Hashvisor', 'Killme']);
  const top = at(h.snowmobiles, 0);
  assert.ok(top.id > at(h.snowmobiles, 1).id);
  assert.deepStrictEqual(top.problem_ids, ['technical-debt']);
  assert.strictEqual(top.problem_priority, 62.4);
  assert.deepStrictEqual(at(h.snowmobiles, 2).problem_ids, []);
  assert.strictEqual(h.problemCoverage.named, 2);
  assert.strictEqual(h.problemCoverage.total, 5);
  assert.strictEqual(h.problemCoverage.share, 0.4);
  assert.strictEqual(h.problemCoverage.source.url, problems.source.url);
  const stored = ctx.db.prepare('SELECT problem_ids FROM snowmobiles WHERE id = ?').get(top.id);
  assert.deepStrictEqual(asJson(String(defined(stored)['problem_ids'])), ['technical-debt']);
}

async function checkBrief(ctx: Ctx, top: Snowmobile): Promise<void> {
  assert.strictEqual(top.component_ids.length, 4);
  assert.match(top.mismatch, /Hardware and software/);
  const grill = async (): Promise<GrillBody> => (await ctx.send(`/api/grills/${String(top.id)}`)).body as GrillBody;
  await poll(grill, (b) => !b.pending, 'grill');
  await ctx.send(`/api/grills/${String(top.id)}/answer`, { answers: { scope: { choice: 0 }, lang: { choice: 0 } } });
  const g = await poll(grill, (b) => b.status === 'done', 'grill');
  assert.match(g.brief, /^\*\*Problem:\*\*[^]*\n\*\*Layer mismatch:\*\* Hardware and software disagree on where state lives\.\n\n# Build/);
}

async function checkStackHunt(ctx: Ctx, s: StackBody, stack: StackBody, pick: number[], problems: Problems): Promise<void> {
  const { id } = (await ctx.send('/api/hunts', { seed: 'lost photos', stack: pick })).body as { id: number };
  const h = await ctx.untilHunt(id);
  // Reason: an unavailable paradigm must not supply a candidate with a claimed benefit.
  const fixedPrompt = ctx.prompt('stack-prompt');
  assert.deepStrictEqual(promptJson(fixedPrompt, 'Source assessments for available paradigms (JSON):\n'),
    s.practicalProblems.links.filter((l) => pick.includes(l.paradigm_id)));
  checkCandidates(ctx, h, Object.keys(stack.layers), problems);
  await checkBrief(ctx, at(h.snowmobiles, 0));
}

export async function checkStackFlow(t: TestContext): Promise<void> {
  const ctx = await makeCtx(t);
  const first = await ctx.stack('/api/stack');
  assert.strictEqual(first.axes.length, 0);
  assert.strictEqual(first.map, null);
  const problems = checkProblems(first);
  const n = first.paradigms.length;
  await checkSelection(ctx, first, problems);
  await scoreAxes(ctx, n);
  const hunted = await huntMore(ctx, n, problems);
  const edited = await ownerEdits(ctx, hunted);
  await tapPoint(ctx, edited);
  const { pick, stack } = await pickStack(ctx, edited);
  await checkBroadHunt(ctx, stack);
  await checkStackHunt(ctx, edited, stack, pick, problems);
  // A pain alone is a stack seed too: each layer offers all its paradigms.
  const pain = (await ctx.send('/api/hunts', { seed: 'lost photos', stack: [] })).body as { id: number };
  const ph = await ctx.untilHunt(pain.id);
  assert.strictEqual(ph.sources.length, edited.paradigms.length);
}
