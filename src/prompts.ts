import { LAYERS, PRACTICAL_PROBLEMS } from './data.ts';
import { assert } from '../shared/assert.ts';
import { traced } from '../shared/trace.ts';
import { gaps, practicalProblems, type Axis, type Paradigm, type ScoreTable } from './stack.ts';
import type { ComponentRow, PartRow } from './db.ts';
import type { MachineResult, SettledDecision } from './types.ts';

export type Schema = Record<string, unknown>;
export interface Idea { name: string; pitch: string; problem: string | null; conventional: string | null; gain_axis: string | null; gain: string | null }
export interface StackData { axes: Axis[]; scores: ScoreTable; practicalProblems: ReturnType<typeof practicalProblems> }

const BOYD = `A Boydian snowmobile (John Boyd, "Destruction and Creation") is a new whole built from parts taken out of unrelated wholes: skis, an outboard motor, tank treads and bicycle handlebars make a snowmobile.`;

const str = { type: 'string' };
const int = { type: 'integer' };

function chosenLabel(d: SettledDecision): string {
  assert(Number.isInteger(d.answer.choice), 'answer.choice must be an integer');
  assert(Number.isInteger(d.options.length), 'decision options must be an array');
  const label = d.answer.choice >= 0 ? d.options[d.answer.choice]?.label ?? '(no option)' : '(no option)';
  assert(label.length > 0, 'chosen label must not be empty');
  return label;
}

// One line per settled decision, with the owner's note when there is one.
function settledLines(decisions: readonly SettledDecision[]): string {
  assert(Number.isInteger(decisions.length), 'decisions must be an array');
  const lines: string[] = [];
  for (const d of decisions) {
    const a = d.answer;
    lines.push(`- ${d.id}: ${d.question}\n  answer: ${chosenLabel(d)}${a.note ? `\n  note from the owner: ${a.note}` : ''}`);
  }
  assert(lines.length === decisions.length, 'one line per decision');
  return lines.join('\n');
}

function axisRows(axes: readonly Axis[]): string {
  assert(Number.isInteger(axes.length), 'axes must be an array');
  const rows: string[] = [];
  for (const a of axes) { rows.push(`${String(a.id)} | ${a.name} | ${a.low} | ${a.high}`); }
  assert(rows.length === axes.length, 'one row per axis');
  assert(axes.length === 0 || rows[0] !== undefined, 'first row exists when axes exist');
  return rows.join('\n');
}

type ParadigmRowKind = 'with-id' | 'with-summary' | 'name-only';

function paradigmRows(paradigms: readonly Pick<Paradigm, 'id' | 'layer' | 'name' | 'summary'>[], kind: ParadigmRowKind): string {
  assert(Number.isInteger(paradigms.length), 'paradigms must be an array');
  assert(kind.length > 0, 'paradigm row kind must be given');
  const rows: string[] = [];
  for (const p of paradigms) {
    if (kind === 'with-id') {
      rows.push(`${String(p.id)} | ${p.layer} | ${p.name} | ${p.summary}`);
    } else if (kind === 'with-summary') {
      rows.push(`${p.layer} | ${p.name} | ${p.summary}`);
    } else {
      rows.push(`${p.layer} | ${p.name}`);
    }
  }
  assert(rows.length === paradigms.length, 'one row per paradigm');
  assert(paradigms.length === 0 || rows[0] !== undefined, 'first row exists when paradigms exist');
  return rows.join('\n');
}

function huntSchema(): Schema {
  const component = { type: 'object', required: ['name', 'mechanism', 'url'], properties: { name: str, mechanism: str, url: str } };
  const source = {
    type: 'object', required: ['name', 'kind', 'url', 'summary', 'components'],
    properties: { name: str, kind: { enum: ['tool', 'paradigm'] }, url: str, summary: str, components: { type: 'array', items: component } },
  };
  const schema: Schema = { type: 'object', required: ['sources'], properties: { sources: { type: 'array', items: source } } };
  assert(Object.keys(schema).length === 3, 'hunt schema has type, required and properties');
  assert(Object.keys(schema).includes('required'), 'hunt schema lists required fields');
  return schema;
}

function badLines(bad: readonly Pick<ComponentRow, 'name' | 'bad_reason'>[]): string {
  assert(Number.isInteger(bad.length), 'bad components must be an array');
  if (bad.length === 0) {
    return '';
  }
  const lines: string[] = [];
  for (const c of bad) { lines.push(`- ${c.name}: ${String(c.bad_reason)}`); }
  assert(lines.length === bad.length, 'one line per bad component');
  return `These components killed earlier ideas. Do not use them again:\n${lines.join('\n')}\n`;
}

function huntPromptImpl(seed: string, bad: readonly Pick<ComponentRow, 'name' | 'bad_reason'>[]): string {
  assert(typeof seed === 'string', 'seed must be a string');
  assert(BOYD.length > 0, 'Boyd definition must not be empty');
  const text = `${BOYD}

You hunt for parts. Seed (a pain, a domain, a tool or a paradigm): ${JSON.stringify(seed)}

Use web search and fetch to find 6 real, existing software tools or programming paradigms: 2 close to the seed and 4 from distant domains that could carry a useful part for it.
Break each one into its 3 to 5 principal components. A component is a mechanism that makes the whole work ("content-addressed objects named by their hash"), never a quality ("fast", "scalable") or a feature list.
Each source and each component has a URL that you found and that shows it: docs, source code, a paper or a talk. Do not invent tools or URLs.
${badLines(bad)}Keep each summary and each mechanism to one sentence.`;
  assert(text.startsWith(BOYD), 'hunt prompt starts with the Boyd definition');
  return text;
}

function candidateSchema(stack: boolean): Schema {
  assert(typeof stack === 'boolean', 'stack flag must be a boolean');
  const required = ['name', 'pitch', 'component_ids', 'problem', 'evidence_url', 'conventional',
    'gain_axis', 'gain', 'mismatch', 'verdict', 'proof_url', 'proof_note'];
  const properties: Record<string, unknown> = { name: str, pitch: str, component_ids: { type: 'array', items: int },
    problem: str, evidence_url: str, conventional: str, gain_axis: str, gain: str, mismatch: str,
    verdict: { enum: ['survives', 'exists', 'no clear problem', 'no clear gain'] },
    proof_url: str, proof_note: str };
  if (stack) {
    const ids: string[] = [];
    for (const p of PRACTICAL_PROBLEMS.items) { ids.push(p.id); }
    required.push('problem_ids');
    properties['problem_ids'] = { type: 'array', items: { enum: ids } };
  }
  assert(required.length === Object.keys(properties).length, 'every required field has a property');
  return { type: 'object', required: ['candidates'],
    properties: { candidates: { type: 'array', items: { type: 'object', required, properties } } } };
}

// The case that each candidate must make before its creative description counts.
const PROBLEM = `For each candidate, also fill these 4 fields:
- problem: who has the problem, and what it is, in one sentence.
- evidence_url: a page that your web search found and that shows people have this problem: a forum thread, a review, an issue or an article. Never invent it.
- conventional: the solution that people use today, as a named product or method.
- gain_axis: the one axis on which this candidate does better (cost, speed, privacy, offline use, effort or similar), and gain: the mechanism by which it does better, with a claim that a test could prove false ("opens a 1 GB file in under 1 second on a 2020 phone, where X takes 30 seconds").
Then set verdict:
- "exists" if a product, project or paper already does the same thing with the same core mechanism: proof_url to it and proof_note to one sentence.
- "no clear problem" if you found no real source for the problem, and "no clear gain" if the candidate does not clearly beat the conventional solution on a named axis: proof_url "" and proof_note to one sentence why.
- "survives" otherwise: proof_url "" and proof_note to the closest thing you found and the difference.
Be strict and honest: a surviving candidate that already exists, or that solves no real problem better than today's solution, wastes the owner's time.`;

function partLines(comps: readonly PartRow[]): string {
  assert(Number.isInteger(comps.length), 'parts must be an array');
  const lines: string[] = [];
  for (const c of comps) { lines.push(`${String(c.id)} | ${c.source} | ${c.name} | ${c.mechanism}`); }
  assert(lines.length === comps.length, 'one line per part');
  assert(comps.length === 0 || lines[0] !== undefined, 'first line exists when parts exist');
  return lines.join('\n');
}

function createPromptImpl(seed: string, comps: readonly PartRow[]): string {
  assert(typeof seed === 'string', 'seed must be a string');
  assert(BOYD.length > 0, 'Boyd definition must not be empty');
  const text = `${BOYD}

Seed: ${JSON.stringify(seed)}
Parts (id, source, component, mechanism):
${partLines(comps)}

Combine parts from at least 2 different sources, the more distant the better, into 5 candidate snowmobiles: new software tools or techniques for the seed.
Each pitch is one concrete sentence: what a developer does with it and what the combination gives that no single source gives.
Search the web for the problem and for prior art for each candidate. Set mismatch to "".
${PROBLEM}`;
  assert(text.endsWith(PROBLEM), 'create prompt ends with the problem case');
  return text;
}

// Ids of the paradigms in layers that have exactly one paradigm among the parts.
function fixedLayerIds(comps: readonly PartRow[]): number[] {
  assert(Number.isInteger(comps.length), 'parts must be an array');
  const fixed: string[] = [];
  for (const l of Object.keys(LAYERS)) {
    if (comps.filter((c) => c.source_kind === l).length === 1) {
      fixed.push(l);
    }
  }
  const ids: number[] = [];
  for (const c of comps) {
    if (fixed.includes(c.source_kind) && c.paradigm_id !== null) {
      ids.push(c.paradigm_id);
    }
  }
  assert(ids.length <= comps.length, 'fixed ids cannot outnumber parts');
  return ids;
}

function scoreCells(c: PartRow, axes: readonly Axis[], scores: ScoreTable): string {
  assert(Number.isInteger(axes.length), 'axes must be an array');
  assert(typeof scores === 'object', 'scores must be an object');
  const cells: string[] = [];
  for (const a of axes) { cells.push(`${String(a.id)}=${String(scores[c.paradigm_id ?? -1]?.[a.id]?.score ?? '?')}`); }
  assert(cells.length === axes.length, 'one cell per axis');
  return cells.join(' ');
}

function scoredParadigmRows(comps: readonly PartRow[], axes: readonly Axis[], scores: ScoreTable): string {
  assert(Number.isInteger(comps.length), 'parts must be an array');
  const rows: string[] = [];
  for (const c of comps) { rows.push(`${String(c.id)} | ${c.source_kind} | ${c.name} | ${c.mechanism} | ${scoreCells(c, axes, scores)}`); }
  assert(rows.length === comps.length, 'one row per part');
  return rows.join('\n');
}

function problemRows(): string {
  const rows: string[] = [];
  for (const p of PRACTICAL_PROBLEMS.items) { rows.push(`${p.id} | ${p.name} | ${String(p.percent)}%`); }
  assert(rows.length > 0, 'there are practical problems');
  return rows.join('\n');
}

function gapNote(axes: readonly Axis[], scores: ScoreTable, comps: readonly PartRow[]): string {
  assert(Number.isInteger(axes.length), 'axes must be an array');
  const ids = fixedLayerIds(comps);
  const spread = ids.length > 1 ? gaps(axes, scores, ids) : [];
  if (spread.length === 0) {
    return '';
  }
  const parts: string[] = [];
  for (const g of spread) { parts.push(`${g.name} ${String(g.gap)}`); }
  assert(parts.length === spread.length, 'one part per gap');
  return `Gaps of the fixed layers on each axis (max - min): ${parts.join(', ')}\n`;
}

function stackCreatePromptImpl(seed: string, comps: readonly PartRow[], data: StackData): string {
  const { axes, scores } = data;
  assert(typeof seed === 'string', 'seed must be a string');
  assert(Number.isInteger(axes.length), 'stack data needs axes');
  // Reason: the brainstorm prompt omitted all five source assessments, which include a harmful effect.
  const available = new Set(comps.map((c) => c.paradigm_id));
  const assessments = data.practicalProblems.links.filter((l) => available.has(l.paradigm_id));
  const text = `A stack is one paradigm from each of 4 layers: ${Object.values(LAYERS).join(', ')}.
Where two layers of a stack disagree on a design axis, there is a mismatch: a chance for a product that no conventional stack makes possible, cheap or fast.

Seed (a practical problem, a stack, or both): ${JSON.stringify(seed)}
Design axes (id | name | 0 means | 10 means):
${axisRows(axes) || '(none yet)'}
Paradigms (id | layer | paradigm | summary | scores as axis id=score):
${scoredParadigmRows(comps, axes, scores)}
${gapNote(axes, scores, comps)}
Propose 5 candidate consumer apps or developer tools. Give practical developer problems priority over novelty.
Set component_ids to exactly one paradigm id from each layer. A layer with only one paradigm above is fixed.
The stack is the unfair advantage: it makes the app possible, cheap or fast where a conventional stack cannot.
Each pitch states what a person does with the app or tool and what the stack gives.
Set mismatch to one sentence that names the 2 layers, their paradigms and the axis on which they disagree, and how the app uses that mismatch.
Practical problems (id | name | respondent share):
${problemRows()}
Source: ${PRACTICAL_PROBLEMS.source.url}
${PRACTICAL_PROBLEMS.source.limit}
Problems without a documented paradigm reduction: ${data.practicalProblems.coverage.withoutReduction.join(', ')}.
Source assessments for available paradigms (JSON):
${JSON.stringify(assessments)}
Use these mechanisms and limits to assess each candidate. State how the chosen stack can reduce its named problems.
If a chosen paradigm can worsen a named problem, explain that cost in gain and compare it with the benefit.
A source assessment does not prove that a candidate works. No assessment means an unknown effect.
For each candidate, set problem_ids to the listed problems that it directly reduces. Use [] for no direct reduction.
Explain each claimed reduction in problem and gain. A survey link alone does not prove that the candidate helps.
Prefer a greater respondent share when evidence and gain are comparable. Do not add shares or equate prevalence with severity.
Search the web for the problem and for prior art for each candidate.
${PROBLEM}`;
  assert(text.endsWith(PROBLEM), 'stack prompt ends with the problem case');
  return text;
}

function axesSchema(): Schema {
  const axis = { type: 'object', required: ['name', 'low', 'high'], properties: { name: str, low: str, high: str } };
  const schema: Schema = { type: 'object', required: ['axes'], properties: { axes: { type: 'array', items: axis } } };
  assert(Object.keys(schema).includes('required'), 'axes schema lists required fields');
  assert(Object.keys(schema).length === 3, 'axes schema has type, required and properties');
  return schema;
}

function axesPromptImpl(paradigms: readonly Paradigm[]): string {
  assert(Number.isInteger(paradigms.length), 'paradigms must be an array');
  const text = `You design the axes of a map of computing paradigms in 4 layers: ${Object.values(LAYERS).join(', ')}.
Paradigms (layer | name | summary):
${paradigmRows(paradigms, 'with-summary')}

Propose 8 to 12 design axes that run through all 4 layers, so that a paradigm of each layer has a position on each axis. Examples: where state lives, when binding happens, who schedules, how parallelism is shown.
For each axis: a short name, what a score of 0 means (low) and what a score of 10 means (high), each in a few words.
Prefer axes that separate the paradigms well and that are not the same axis twice.`;
  assert(text.includes('Paradigms (layer | name | summary):'), 'axes prompt lists the paradigms');
  return text;
}

function scoreSchema(): Schema {
  const score = { type: 'object', required: ['paradigm_id', 'axis_id', 'score', 'reason'],
    properties: { paradigm_id: int, axis_id: int, score: int, reason: str } };
  const schema: Schema = { type: 'object', required: ['scores'], properties: { scores: { type: 'array', items: score } } };
  assert(Object.keys(schema).includes('required'), 'score schema lists required fields');
  assert(Object.keys(schema).length === 3, 'score schema has type, required and properties');
  return schema;
}

function scorePromptImpl(axes: readonly Axis[], paradigms: readonly Paradigm[]): string {
  assert(Number.isInteger(axes.length), 'axes must be an array');
  assert(Number.isInteger(paradigms.length), 'paradigms must be an array');
  const text = `Score each paradigm on each design axis, from 0 to 10, with a one-line reason.
Axes (id | name | 0 means | 10 means):
${axisRows(axes)}
Paradigms (id | layer | name | summary):
${paradigmRows(paradigms, 'with-id')}

Return one score for each pair of paradigm and axis. Use the whole range, so that the paradigms spread out.`;
  assert(text.startsWith('Score each paradigm'), 'score prompt starts with its task');
  return text;
}

function paradigmSchema(): Schema {
  const item = { type: 'object', required: ['layer', 'name', 'summary', 'url'],
    properties: { layer: { enum: Object.keys(LAYERS) }, name: str, summary: str, url: str } };
  const schema: Schema = { type: 'object', required: ['paradigms'], properties: { paradigms: { type: 'array', items: item } } };
  assert(Object.keys(schema).includes('required'), 'paradigm schema lists required fields');
  assert(Object.keys(schema).length === 3, 'paradigm schema has type, required and properties');
  return schema;
}

function layerList(): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(LAYERS)) {
    parts.push(`${k} (${v})`);
  }
  assert(parts.length === Object.keys(LAYERS).length, 'one part per layer');
  return parts.join(', ');
}

function paradigmPromptImpl(paradigms: readonly Paradigm[]): string {
  assert(Number.isInteger(paradigms.length), 'paradigms must be an array');
  const text = `You hunt for paradigms in 4 layers of a computing stack: ${layerList()}.
The map has these already:
${paradigmRows(paradigms, 'name-only')}

Use web search and fetch to find 8 more real paradigms, 2 in each layer.
Search research, history and niche practice for mechanisms that reduce practical problems.
Each paradigm needs a URL that you opened: documentation, a paper or a talk.
Do not invent paradigms or URLs.

Practical problems and source assessments (JSON):
${JSON.stringify(practicalProblems(paradigms))}
Prefer evidence of practical benefit over map distance.
Order candidates by the greatest respondent share of a problem they can reduce, when evidence and benefit are comparable.
Do not add shares or equate prevalence with severity.
For comparable priorities, prefer problems without a documented reduction, then mechanisms absent from the map.
Use source links to explain each benefit, harm and limit in the summary.
Name the problem that each mechanism can reduce, or state that its effect is unknown.
An absent assessment does not prove an absent benefit. A survey source alone does not prove a paradigm's benefit.`;
  assert(text.includes('The map has these already:'), 'paradigm prompt lists the map');
  return text;
}

function pointSchema(): Schema {
  const schema: Schema = {
    type: 'object', required: ['layer', 'name', 'exists', 'url', 'why'],
    properties: { layer: { enum: Object.keys(LAYERS) }, name: str, exists: { type: 'boolean' }, url: str, why: str },
  };
  assert(Object.keys(schema).includes('required'), 'point schema lists required fields');
  assert(Object.keys(schema).length === 3, 'point schema has type, required and properties');
  return schema;
}

function profileRows(axes: readonly Axis[], profile: readonly number[]): string {
  assert(Number.isInteger(axes.length), 'axes must be an array');
  assert(Number.isInteger(profile.length), 'profile must be an array');
  const rows: string[] = [];
  axes.forEach((a, i) => { rows.push(`${a.name}: ${String(profile[i])} (0 = ${a.low}, 10 = ${a.high})`); });
  assert(rows.length === axes.length, 'one row per axis');
  return rows.join('\n');
}

function nearList(near: readonly Pick<Paradigm, 'name' | 'layer'>[]): string {
  assert(Number.isInteger(near.length), 'near paradigms must be an array');
  const parts: string[] = [];
  for (const p of near) { parts.push(`${p.name} (${p.layer})`); }
  assert(parts.length === near.length, 'one part per paradigm');
  return parts.join(', ');
}

function pointPromptImpl(axes: readonly Axis[], profile: readonly number[], near: readonly Pick<Paradigm, 'name' | 'layer'>[], problems: unknown): string {
  assert(Number.isInteger(axes.length), 'axes must be an array');
  assert(problems !== undefined, 'problems must be given');
  const text = `A map of computing paradigms in 4 layers (${Object.values(LAYERS).join(', ')}) has an empty point with this profile (axis: score out of 10, where 0 and 10 mean):
${profileRows(axes, profile)}
The nearest paradigms on the map: ${nearList(near)}.

Practical problems and source assessments (JSON):
${JSON.stringify(problems)}

Which paradigm would live at this point?
Use web search and fetch to find a real paradigm that fits the profile.
Each real paradigm needs a URL that you opened. Do not invent paradigms or URLs.
If no real paradigm fits, set exists false, name "No verified match", and url "".
Otherwise, set exists true and give the real name and URL.
Among comparable fits, prefer evidence of practical benefit over map distance.
When evidence and benefit are comparable, use the greatest respondent share of a problem the paradigm can reduce.
Do not add shares or equate prevalence with severity.
In why, explain the profile fit and the difference from nearby paradigms.
In why, name the practical problem and source links for the benefit, harm and limits.
State unknown effects.
A survey source alone does not prove a paradigm's benefit. No assessment means an unknown effect.`;
  assert(text.includes('Which paradigm would live at this point?'), 'point prompt asks its question');
  assert(Number.isInteger(near.length), 'near paradigms must be an array');
  return text;
}

function findingLines(machine: { findings: MachineResultFindings }): string {
  assert(Number.isInteger(machine.findings.length), 'findings must be an array');
  const lines: string[] = [];
  for (const f of machine.findings) { lines.push(`- ${f.kind} ${f.machine} ${f.at}: ${f.detail}`); }
  assert(lines.length === machine.findings.length, 'one line per finding');
  return lines.join('\n');
}

type MachineResultFindings = NonNullable<MachineResult['findings']>;

function machinePromptImpl(machine: MachineResult | undefined, decisions: readonly { round: number }[]): string {
  assert(Number.isInteger(decisions.length), 'decisions must be an array');
  if (!machine?.findings?.length) {
    return '';
  }
  const asked = decisions.some((d) => d.round > machine.round);
  const text = `State machine of the settled decisions (checked with sm-axi):
${machine.file}

Check findings:
${findingLines({ findings: machine.findings })}

${asked ? 'The owner already answered decisions on these findings. Ask no decision about them again.'
  : `A finding is an architecture problem that is open while the design is open. Ask one decision for each finding that no settled decision answers, in this round, with 2 to 4 options:
a hidden state or an unhandled event (what must happen), a row with no requirement (keep it with a reason, or delete it), a requirement with no row (still necessary?), two transitions or a guard gap (which rule wins).
Ask no decision about a finding that comes from a gap in the file and not from the design.
If the settled decisions answer every finding, set verdict "done".`}

`;
  assert(text.endsWith('\n\n'), 'machine prompt ends with a blank line');
  return text;
}

export const machinePrompt = traced('prompt.machine', machinePromptImpl);

function grillSchema(): Schema {
  const option = { type: 'object', required: ['label', 'why', 'kills_component_id'],
    properties: { label: str, why: str, kills_component_id: int } };
  const decision = {
    type: 'object', required: ['id', 'question', 'depends_on', 'options', 'recommended'],
    properties: { id: str, question: str, depends_on: { type: 'array', items: str },
      recommended: int,
      options: { type: 'array', items: option } },
  };
  const schema: Schema = {
    type: 'object', required: ['verdict', 'decisions', 'brief', 'killed_component_id', 'reason'],
    properties: {
      verdict: { enum: ['open', 'done', 'killed'] },
      decisions: { type: 'array', items: decision },
      brief: str, killed_component_id: int, reason: str,
    },
  };
  assert(Object.keys(schema).includes('required'), 'grill schema lists required fields');
  assert(Object.keys(schema).length === 3, 'grill schema has type, required and properties');
  return schema;
}

function planHeader(sm: Idea): string {
  assert(typeof sm.name === 'string', 'plan needs a name');
  assert(typeof sm.pitch === 'string', 'plan needs a pitch');
  const problem = sm.problem ? `Problem: ${sm.problem}\nConventional solution: ${String(sm.conventional)}\nClaimed gain (${String(sm.gain_axis)}): ${String(sm.gain)}\n` : '';
  return `Plan: ${sm.name}. ${sm.pitch}\n${problem}`;
}

function mechanismLines(comps: readonly PartRow[], withId: boolean): string {
  assert(Number.isInteger(comps.length), 'parts must be an array');
  const lines: string[] = [];
  for (const c of comps) { lines.push(withId ? `${String(c.id)} | ${c.name} | ${c.mechanism}` : `- ${c.name}: ${c.mechanism}`); }
  assert(lines.length === comps.length, 'one line per part');
  return lines.join('\n');
}

function grillPromptImpl(sm: Idea, comps: readonly PartRow[], decisions: readonly SettledDecision[], machine: MachineResult | undefined): string {
  assert(Number.isInteger(decisions.length), 'decisions must be an array');
  assert(Number.isInteger(comps.length), 'parts must be an array');
  const settled = settledLines(decisions);
  const text = `You run Matt Pocock's "grill me" on a plan: walk the design tree, one round at a time, until no decision is open.

${planHeader(sm)}Parts (id | component | mechanism):
${mechanismLines(comps, true)}

Settled decisions:
${settled || '(none yet)'}

${machinePrompt(machine, decisions)}Return the next round: every open decision whose prerequisites are all settled, not only one. At most 6. Ask only decisions that change what gets built.
${settled ? '' : 'This is the first round. It must include a decision that tests why the plan beats the conventional solution on its claimed gain: an option under which the gain fails makes the plan pointless.\n'}
For each decision: a new short id (lowercase-with-dashes, not used above), the question, depends_on (ids of the settled decisions it builds on), 2 to 4 options with a short label and a one-sentence why, and the index of the option you recommend.
For an option that makes the whole plan pointless because one part fails, set kills_component_id to that part's id. Otherwise set it to 0. Never recommend such an option.
If a settled answer or note already makes the plan pointless, set verdict "killed", decisions [], killed_component_id to the part to blame and reason to one sentence.
If no decision is open, set verdict "done", decisions [] and brief to a build brief in Markdown: what to build, the settled decisions, the first three steps and the main risk.
Otherwise set verdict "open". Set unused fields to "" or 0. Aim for done in 3 to 5 rounds.`;
  assert(text.includes('Aim for done in 3 to 5 rounds.'), 'grill prompt ends with its goal');
  return text;
}

function machineFilePromptImpl(sm: Idea, comps: readonly PartRow[], decisions: readonly SettledDecision[], format: string): string {
  assert(typeof format === 'string', 'format must be a string');
  assert(Number.isInteger(comps.length), 'parts must be an array');
  assert(Number.isInteger(decisions.length), 'decisions must be an array');
  const text = `Write the state machine file (a .sm.md file) of this design, from the settled decisions only.

Plan: ${sm.name}. ${sm.pitch}
Parts (mechanism):
${mechanismLines(comps, false)}

Settled decisions:
${settledLines(decisions)}

Each requirement is one settled decision. Its source is the decision id. Write a requirement only for a decision that changes what is built.
Write one row for each transition that the decisions imply, and every state that the design can be in, also a state that only the combination of two decisions makes (for example: closed input while a job runs). Write each machine flat. Set "file" to the whole file and nothing else.

The format of the file:

${format}`;
  assert(text.endsWith(format), 'machine file prompt ends with the format');
  return text;
}

export const HUNT_SCHEMA: Schema = huntSchema();
export const huntPrompt = traced('prompt.hunt', huntPromptImpl);
export const CREATE_SCHEMA: Schema = candidateSchema(false);
export const createPrompt = traced('prompt.create', createPromptImpl);
export const stackCreatePrompt = traced('prompt.stackCreate', stackCreatePromptImpl);
// Reason: the Stack trial had no explicit problem links in generated ideas.
export const STACK_CREATE_SCHEMA: Schema = candidateSchema(true);
export const AXES_SCHEMA: Schema = axesSchema();
export const axesPrompt = traced('prompt.axes', axesPromptImpl);
export const SCORE_SCHEMA: Schema = scoreSchema();
export const scorePrompt = traced('prompt.score', scorePromptImpl);
export const PARADIGM_SCHEMA: Schema = paradigmSchema();
export const paradigmPrompt = traced('prompt.paradigm', paradigmPromptImpl);
export const POINT_SCHEMA: Schema = pointSchema();
export const pointPrompt = traced('prompt.point', pointPromptImpl);
export const GRILL_SCHEMA: Schema = grillSchema();
export const grillPrompt = traced('prompt.grill', grillPromptImpl);
export const MACHINE_SCHEMA: Schema = { type: 'object', required: ['file'], properties: { file: str } };
export const machineFilePrompt = traced('prompt.machineFile', machineFilePromptImpl);
