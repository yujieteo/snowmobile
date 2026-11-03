import { traced } from '../shared/trace.ts';
import type { Answer, Decision, GrillOut, RoundDecision, SettledDecision, Tree } from './types.ts';

export function settledOf(tree: Tree): SettledDecision[] {
  return tree.decisions.filter((d): d is SettledDecision => d.answer !== null);
}

export const frontierKey = traced('tree.frontierKey', (smId: number, settled: readonly { id: string; answer: Answer | null }[]): string =>
  `${smId}:${JSON.stringify(settled.map((d) => [d.id, d.answer]))}`);

export const finished = (o: Pick<GrillOut, 'verdict' | 'decisions'>): boolean => o.verdict === 'done' || !o.decisions.length;

export const appendRound = traced('tree.appendRound', (tree: Tree, out: readonly RoundDecision[], parts: readonly number[]): Tree => {
  const round = tree.round + 1;
  const used = new Set(tree.decisions.map((d) => d.id));
  const decisions: Decision[] = [...tree.decisions];
  for (const d of out) {
    const options = d.options.map((o) => (parts.includes(o.kills_component_id) ? o : { ...o, kills_component_id: 0 }));
    let id = d.id;
    while (used.has(id)) id += '-';
    used.add(id);
    const recommended = options[d.recommended] && !options[d.recommended]?.kills_component_id ? d.recommended
      : Math.max(0, options.findIndex((o) => !o.kills_component_id));
    decisions.push({ ...d, options, id, recommended, round, answer: null });
  }
  return { ...tree, round, decisions };
});

export const guessAnswers = (decisions: readonly Decision[]): SettledDecision[] =>
  decisions.map((d) => (d.answer ? d as SettledDecision : { ...d, answer: { choice: d.recommended, note: '' } }));
