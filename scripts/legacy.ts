// The adapter for the base commit: the old snowmobile.js, with its inline logic cut out as functions.
// Each cut uses exact markers of the base source. A marker that is not found throws.

export const LEGACY_NAMES: Record<string, string> = {
  'stack.practicalProblems': 'practicalProblems', 'stack.ideaProblems': 'ideaProblems', 'stack.eigen': 'eigen', 'stack.pca': 'pca', 'stack.gaps': 'gaps',
  'prompt.hunt': 'huntPrompt', 'prompt.create': 'createPrompt', 'prompt.stackCreate': 'stackCreatePrompt', 'prompt.axes': 'axesPrompt',
  'prompt.score': 'scorePrompt', 'prompt.paradigm': 'paradigmPrompt', 'prompt.point': 'pointPrompt', 'prompt.grill': 'grillPrompt',
  'prompt.machineFile': 'machineFilePrompt', 'prompt.machine': 'machinePrompt', 'machine.checkFindings': 'checkFindings',
  'brief.head': 'briefHead', 'brief.machineNotes': 'machineNotes', 'brief.render': '__renderBrief',
  'recombine.graveOf': 'graveOf', 'recombine.ideaRow': '__ideaRow', 'tree.frontierKey': 'frontierKey', 'tree.appendRound': '__appendRound',
};

function between(src: string, from: string, to: string): string {
  const a = src.indexOf(from);
  if (a < 0) throw new Error(`The base source has no marker: ${from}`);
  const b = src.indexOf(to, a);
  if (b < 0) throw new Error(`The base source has no marker: ${to}`);
  return src.slice(a, b);
}

export function legacySource(src: string): string {
  const row = between(src, 'for (const c of out.candidates) {', "    db.prepare(`UPDATE hunts SET status = 'created'");
  const round = between(src, '  const used = new Set(now.decisions', '  db.prepare(`UPDATE grills SET tree = ?, updated_at');
  const names = [...new Set(Object.values(LEGACY_NAMES))].filter((n) => !n.startsWith('__'));
  return `${src}
const __ideaRow = (c, knownIds, stack) => {
  const known = new Set(knownIds), hunt = { stack }, huntId = 0, out = { candidates: [c] };
  let args;
  const add = { run: (...a) => { args = a; } };
  ${row}
  const [, name, pitch, component_ids, status, proof_url, proof_note, problem, evidence_url, conventional, gain_axis, gain, mismatch, problem_ids] = args;
  return { name, pitch, component_ids, status, proof_url, proof_note, problem, evidence_url, conventional, gain_axis, gain, mismatch, problem_ids };
};
const __appendRound = (tree, decisions, partIds) => {
  const now = { ...tree, decisions: [...tree.decisions], round: tree.round + 1 };
  const out = { decisions };
  const sm = { component_ids: JSON.stringify(partIds) };
  ${round}
  return now;
};
const __renderBrief = (head, body, machine) => briefHead(head) + body + machineNotes(machine);
Object.assign(module.exports, { ${[...names, '__ideaRow', '__appendRound', '__renderBrief'].join(', ')} });
`;
}
