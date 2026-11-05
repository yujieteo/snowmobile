import { assert } from '../shared/assert.ts';
import { traced } from '../shared/trace.ts';
import type { Answer, Decision, GrillOut, RoundDecision, SettledDecision, Tree } from './types.ts';

function isSettled(d: Decision): d is SettledDecision {
  assert(d.id.length > 0, 'a decision has an id');
  assert(d.round >= 0, 'a decision has a round');
  return d.answer !== null;
}

export function settledOf(tree: Tree): SettledDecision[] {
  assert(tree.round >= 0, 'a tree has a round');
  assert(Number.isInteger(tree.decisions.length), 'a tree lists its decisions');
  const settled = tree.decisions.filter(isSettled);
  assert(settled.length <= tree.decisions.length, 'settled decisions are a subset');
  return settled;
}

function frontierKeyImpl(smId: number, settled: readonly { id: string; answer: Answer | null }[]): string {
  assert(Number.isInteger(smId), 'an idea id is an integer');
  assert(Number.isInteger(settled.length), 'the settled decisions are a list');
  assert(Number.isFinite(smId), 'an idea id is finite');
  return `${String(smId)}:${JSON.stringify(settled.map((d) => [d.id, d.answer]))}`;
}

export const frontierKey = traced('tree.frontierKey', frontierKeyImpl);

export function finished(o: Pick<GrillOut, 'verdict' | 'decisions'>): boolean {
  assert(['open', 'done', 'killed'].includes(o.verdict), 'the verdict is one of three');
  assert(Number.isInteger(o.decisions.length), 'decisions are a list');
  assert(typeof o.verdict === 'string', 'the verdict is text');
  return o.verdict === 'done' || o.decisions.length === 0;
}

function keepOptions(d: RoundDecision, parts: readonly number[]): Decision['options'] {
  assert(Number.isInteger(parts.length), 'the parts are a list');
  assert(d.options.length >= 0, 'a decision has options');
  const kept = d.options.map((o) => (parts.includes(o.kills_component_id) ? o : { ...o, kills_component_id: 0 }));
  assert(kept.length === d.options.length, 'every option is kept');
  assert(kept.length >= 0, 'options are counted');
  return kept;
}

function uniqueId(id: string, used: Set<string>): string {
  assert(id.length > 0, 'a decision has an id');
  assert(used instanceof Set, 'the used ids are a set');
  let unique = id;
  while (used.has(unique)) {
    unique += '-';
  }
  used.add(unique);
  assert(unique.startsWith(id), 'a unique id extends the id');
  assert(used.has(unique), 'the unique id is used');
  return unique;
}

function recommendedOf(d: RoundDecision, options: Decision['options']): number {
  assert(options.length === d.options.length, 'the options keep their count');
  assert(Number.isInteger(d.recommended), 'the recommended option is an index');
  const pick = options[d.recommended];
  if (pick && !pick.kills_component_id) {
    return d.recommended;
  }
  const first = Math.max(0, options.findIndex((o) => !o.kills_component_id));
  assert(first >= 0 && first <= options.length, 'the first free option is an index');
  assert(options.length >= 0, 'options are counted');
  assert(first < Math.max(1, options.length), 'the first free option is within the options');
  assert(Number.isInteger(first), 'the first free option is an integer');
  return first;
}

function appendRoundImpl(tree: Tree, out: readonly RoundDecision[], parts: readonly number[]): Tree {
  assert(tree.round >= 0, 'a tree has a round');
  assert(Number.isInteger(out.length), 'the new decisions are a list');
  const round = tree.round + 1;
  const used = new Set(tree.decisions.map((d) => d.id));
  const decisions: Decision[] = [...tree.decisions];
  for (const d of out) {
    const options = keepOptions(d, parts);
    const id = uniqueId(d.id, used);
    const recommended = recommendedOf(d, options);
    decisions.push({ ...d, options, id, recommended, round, answer: null });
  }
  assert(decisions.length === tree.decisions.length + out.length, 'every new decision is added');
  assert(round === tree.round + 1, 'the round moves on by one');
  assert(decisions.length >= 0, 'decisions are counted');
  assert(used.size >= 0, 'used ids are counted');
  assert(decisions.length >= tree.decisions.length, 'old decisions are kept');
  assert(decisions.length >= out.length, 'the new decisions are among the decisions');
  return { ...tree, round, decisions };
}

export const appendRound = traced('tree.appendRound', appendRoundImpl);

function guessAnswersImpl(decisions: readonly Decision[]): SettledDecision[] {
  assert(Number.isInteger(decisions.length), 'decisions are a list');
  assert(decisions.length < 10 ** 6, 'decisions are bounded');
  const guessed = decisions.map((d) => (d.answer ? d as SettledDecision : { ...d, answer: { choice: d.recommended, note: '' } }));
  assert(guessed.length === decisions.length, 'every decision gets an answer');
  assert(guessed.length >= 0, 'answers are counted');
  return guessed;
}

export const guessAnswers = guessAnswersImpl;
