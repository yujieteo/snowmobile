import { LAYERS, PRACTICAL_PROBLEMS } from './data.ts';
import { traced } from '../shared/trace.ts';
import { gaps, practicalProblems, type Axis, type Paradigm, type ScoreTable } from './stack.ts';
import type { ComponentRow, PartRow } from './db.ts';
import type { MachineResult, SettledDecision } from './types.ts';

function chosenLabel(d: SettledDecision): string {
  return d.answer.choice >= 0 ? d.options[d.answer.choice]?.label ?? '(no option)' : '(no option)';
}

export type Schema = Record<string, unknown>;
export interface Idea { name: string; pitch: string; problem: string | null; conventional: string | null; gain_axis: string | null; gain: string | null }
export interface StackData { axes: Axis[]; scores: ScoreTable; practicalProblems: ReturnType<typeof practicalProblems> }

const BOYD = `A Boydian snowmobile (John Boyd, "Destruction and Creation") is a new whole built from parts taken out of unrelated wholes: skis, an outboard motor, tank treads and bicycle handlebars make a snowmobile.`;

const str = { type: 'string' };
const int = { type: 'integer' };

export const HUNT_SCHEMA: Schema = {
  type: 'object', required: ['sources'],
  properties: { sources: { type: 'array', items: {
    type: 'object', required: ['name', 'kind', 'url', 'summary', 'components'],
    properties: { name: str, kind: { enum: ['tool', 'paradigm'] }, url: str, summary: str,
      components: { type: 'array', items: { type: 'object', required: ['name', 'mechanism', 'url'],
        properties: { name: str, mechanism: str, url: str } } } } } } },
};

export const huntPrompt = traced('prompt.hunt', (seed: string, bad: readonly Pick<ComponentRow, 'name' | 'bad_reason'>[]): string => {
  return `${BOYD}

You hunt for parts. Seed (a pain, a domain, a tool or a paradigm): ${JSON.stringify(seed)}

Use web search and fetch to find 6 real, existing software tools or programming paradigms: 2 close to the seed and 4 from distant domains that could carry a useful part for it.
Break each one into its 3 to 5 principal components. A component is a mechanism that makes the whole work ("content-addressed objects named by their hash"), never a quality ("fast", "scalable") or a feature list.
Each source and each component has a URL that you found and that shows it: docs, source code, a paper or a talk. Do not invent tools or URLs.
${bad.length ? `These components killed earlier ideas. Do not use them again:\n${bad.map((c) => `- ${c.name}: ${c.bad_reason}`).join('\n')}\n` : ''}Keep each summary and each mechanism to one sentence.`;
});

function candidateSchema(stack: boolean): Schema {
  const required = ['name', 'pitch', 'component_ids', 'problem', 'evidence_url', 'conventional',
    'gain_axis', 'gain', 'mismatch', 'verdict', 'proof_url', 'proof_note'];
  const properties: Record<string, unknown> = { name: str, pitch: str, component_ids: { type: 'array', items: int },
    problem: str, evidence_url: str, conventional: str, gain_axis: str, gain: str, mismatch: str,
    verdict: { enum: ['survives', 'exists', 'no clear problem', 'no clear gain'] },
    proof_url: str, proof_note: str };
  if (stack) {
    required.push('problem_ids');
    properties.problem_ids = { type: 'array', items: { enum: PRACTICAL_PROBLEMS.items.map((p) => p.id) } };
  }
  return { type: 'object', required: ['candidates'],
    properties: { candidates: { type: 'array', items: { type: 'object', required, properties } } } };
}

export const CREATE_SCHEMA: Schema = candidateSchema(false);

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

export const createPrompt = traced('prompt.create', (seed: string, comps: readonly PartRow[]): string => {
  return `${BOYD}

Seed: ${JSON.stringify(seed)}
Parts (id, source, component, mechanism):
${comps.map((c) => `${c.id} | ${c.source} | ${c.name} | ${c.mechanism}`).join('\n')}

Combine parts from at least 2 different sources, the more distant the better, into 5 candidate snowmobiles: new software tools or techniques for the seed.
Each pitch is one concrete sentence: what a developer does with it and what the combination gives that no single source gives.
Search the web for the problem and for prior art for each candidate. Set mismatch to "".
${PROBLEM}`;
});

export const stackCreatePrompt = traced('prompt.stackCreate', (seed: string, comps: readonly PartRow[], data: StackData): string => {
  const { axes, scores } = data;
  // Reason: the brainstorm prompt omitted all five source assessments, which include a harmful effect.
  const available = new Set(comps.map((c) => c.paradigm_id));
  const assessments = data.practicalProblems.links.filter((l) => available.has(l.paradigm_id));
  const fixed = Object.keys(LAYERS).filter((l) => comps.filter((c) => c.source_kind === l).length === 1);
  const ids = comps.filter((c) => fixed.includes(c.source_kind)).flatMap((c) => (c.paradigm_id === null ? [] : [c.paradigm_id]));
  const spread = ids.length > 1 ? gaps(axes, scores, ids) : [];
  return `A stack is one paradigm from each of 4 layers: ${Object.values(LAYERS).join(', ')}.
Where two layers of a stack disagree on a design axis, there is a mismatch: a chance for a product that no conventional stack makes possible, cheap or fast.

Seed (a practical problem, a stack, or both): ${JSON.stringify(seed)}
Design axes (id | name | 0 means | 10 means):
${axes.map((a) => `${a.id} | ${a.name} | ${a.low} | ${a.high}`).join('\n') || '(none yet)'}
Paradigms (id | layer | paradigm | summary | scores as axis id=score):
${comps.map((c) => `${c.id} | ${c.source_kind} | ${c.name} | ${c.mechanism} | ${axes.map((a) => `${a.id}=${scores[c.paradigm_id ?? -1]?.[a.id]?.score ?? '?'}`).join(' ')}`).join('\n')}
${spread.length ? `Gaps of the fixed layers on each axis (max - min): ${spread.map((g) => `${g.name} ${g.gap}`).join(', ')}\n` : ''}
Propose 5 candidate consumer apps or developer tools. Give practical developer problems priority over novelty.
Set component_ids to exactly one paradigm id from each layer. A layer with only one paradigm above is fixed.
The stack is the unfair advantage: it makes the app possible, cheap or fast where a conventional stack cannot.
Each pitch states what a person does with the app or tool and what the stack gives.
Set mismatch to one sentence that names the 2 layers, their paradigms and the axis on which they disagree, and how the app uses that mismatch.
Practical problems (id | name | respondent share):
${PRACTICAL_PROBLEMS.items.map((p) => `${p.id} | ${p.name} | ${p.percent}%`).join('\n')}
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
});

// Reason: the Stack trial had no explicit problem links in generated ideas.
export const STACK_CREATE_SCHEMA: Schema = candidateSchema(true);

export const AXES_SCHEMA: Schema = {
  type: 'object', required: ['axes'],
  properties: { axes: { type: 'array', items: { type: 'object', required: ['name', 'low', 'high'],
    properties: { name: str, low: str, high: str } } } },
};

export const axesPrompt = traced('prompt.axes', (paradigms: readonly Paradigm[]): string => {
  return `You design the axes of a map of computing paradigms in 4 layers: ${Object.values(LAYERS).join(', ')}.
Paradigms (layer | name | summary):
${paradigms.map((p) => `${p.layer} | ${p.name} | ${p.summary}`).join('\n')}

Propose 8 to 12 design axes that run through all 4 layers, so that a paradigm of each layer has a position on each axis. Examples: where state lives, when binding happens, who schedules, how parallelism is shown.
For each axis: a short name, what a score of 0 means (low) and what a score of 10 means (high), each in a few words.
Prefer axes that separate the paradigms well and that are not the same axis twice.`;
});

export const SCORE_SCHEMA: Schema = {
  type: 'object', required: ['scores'],
  properties: { scores: { type: 'array', items: { type: 'object', required: ['paradigm_id', 'axis_id', 'score', 'reason'],
    properties: { paradigm_id: int, axis_id: int, score: int, reason: str } } } },
};

export const scorePrompt = traced('prompt.score', (axes: readonly Axis[], paradigms: readonly Paradigm[]): string => {
  return `Score each paradigm on each design axis, from 0 to 10, with a one-line reason.
Axes (id | name | 0 means | 10 means):
${axes.map((a) => `${a.id} | ${a.name} | ${a.low} | ${a.high}`).join('\n')}
Paradigms (id | layer | name | summary):
${paradigms.map((p) => `${p.id} | ${p.layer} | ${p.name} | ${p.summary}`).join('\n')}

Return one score for each pair of paradigm and axis. Use the whole range, so that the paradigms spread out.`;
});

export const PARADIGM_SCHEMA: Schema = {
  type: 'object', required: ['paradigms'],
  properties: { paradigms: { type: 'array', items: { type: 'object', required: ['layer', 'name', 'summary', 'url'],
    properties: { layer: { enum: Object.keys(LAYERS) }, name: str, summary: str, url: str } } } },
};

export const paradigmPrompt = traced('prompt.paradigm', (paradigms: readonly Paradigm[]): string => {
  return `You hunt for paradigms in 4 layers of a computing stack: ${Object.entries(LAYERS).map(([k, v]) => `${k} (${v})`).join(', ')}.
The map has these already:
${paradigms.map((p) => `${p.layer} | ${p.name}`).join('\n')}

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
});

export const POINT_SCHEMA: Schema = {
  type: 'object', required: ['layer', 'name', 'exists', 'url', 'why'],
  properties: { layer: { enum: Object.keys(LAYERS) }, name: str, exists: { type: 'boolean' }, url: str, why: str },
};

export const pointPrompt = traced('prompt.point', (axes: readonly Axis[], profile: readonly number[], near: readonly Pick<Paradigm, 'name' | 'layer'>[], problems: unknown): string => {
  return `A map of computing paradigms in 4 layers (${Object.values(LAYERS).join(', ')}) has an empty point with this profile (axis: score out of 10, where 0 and 10 mean):
${axes.map((a, i) => `${a.name}: ${profile[i]} (0 = ${a.low}, 10 = ${a.high})`).join('\n')}
The nearest paradigms on the map: ${near.map((p) => `${p.name} (${p.layer})`).join(', ')}.

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
});

export const GRILL_SCHEMA: Schema = {
  type: 'object', required: ['verdict', 'decisions', 'brief', 'killed_component_id', 'reason'],
  properties: {
    verdict: { enum: ['open', 'done', 'killed'] },
    decisions: { type: 'array', items: {
      type: 'object', required: ['id', 'question', 'depends_on', 'options', 'recommended'],
      properties: { id: str, question: str, depends_on: { type: 'array', items: str },
        recommended: int,
        options: { type: 'array', items: { type: 'object', required: ['label', 'why', 'kills_component_id'],
          properties: { label: str, why: str, kills_component_id: int } } } } } },
    brief: str, killed_component_id: int, reason: str,
  },
};

export const grillPrompt = traced('prompt.grill', (sm: Idea, comps: readonly PartRow[], decisions: readonly SettledDecision[], machine: MachineResult | undefined): string => {
  const settled = decisions.map((d) => {
    const a = d.answer;
    const choice = chosenLabel(d);
    return `- ${d.id}: ${d.question}\n  answer: ${choice}${a.note ? `\n  note from the owner: ${a.note}` : ''}`;
  }).join('\n');
  return `You run Matt Pocock's "grill me" on a plan: walk the design tree, one round at a time, until no decision is open.

Plan: ${sm.name}. ${sm.pitch}
${sm.problem ? `Problem: ${sm.problem}\nConventional solution: ${sm.conventional}\nClaimed gain (${sm.gain_axis}): ${sm.gain}\n` : ''}Parts (id | component | mechanism):
${comps.map((c) => `${c.id} | ${c.name} | ${c.mechanism}`).join('\n')}

Settled decisions:
${settled || '(none yet)'}

${machinePrompt(machine, decisions)}Return the next round: every open decision whose prerequisites are all settled, not only one. At most 6. Ask only decisions that change what gets built.
${settled ? '' : 'This is the first round. It must include a decision that tests why the plan beats the conventional solution on its claimed gain: an option under which the gain fails makes the plan pointless.\n'}
For each decision: a new short id (lowercase-with-dashes, not used above), the question, depends_on (ids of the settled decisions it builds on), 2 to 4 options with a short label and a one-sentence why, and the index of the option you recommend.
For an option that makes the whole plan pointless because one part fails, set kills_component_id to that part's id. Otherwise set it to 0. Never recommend such an option.
If a settled answer or note already makes the plan pointless, set verdict "killed", decisions [], killed_component_id to the part to blame and reason to one sentence.
If no decision is open, set verdict "done", decisions [] and brief to a build brief in Markdown: what to build, the settled decisions, the first three steps and the main risk.
Otherwise set verdict "open". Set unused fields to "" or 0. Aim for done in 3 to 5 rounds.`;
});

export const MACHINE_SCHEMA: Schema = { type: 'object', required: ['file'], properties: { file: str } };

export const machineFilePrompt = traced('prompt.machineFile', (sm: Idea, comps: readonly PartRow[], decisions: readonly SettledDecision[], format: string): string => {
  const settled = decisions.map((d) => {
    const a = d.answer;
    return `- ${d.id}: ${d.question}\n  answer: ${chosenLabel(d)}${a.note ? `\n  note from the owner: ${a.note}` : ''}`;
  }).join('\n');
  return `Write the state machine file (a .sm.md file) of this design, from the settled decisions only.

Plan: ${sm.name}. ${sm.pitch}
Parts (mechanism):
${comps.map((c) => `- ${c.name}: ${c.mechanism}`).join('\n')}

Settled decisions:
${settled}

Each requirement is one settled decision. Its source is the decision id. Write a requirement only for a decision that changes what is built.
Write one row for each transition that the decisions imply, and every state that the design can be in, also a state that only the combination of two decisions makes (for example: closed input while a job runs). Write each machine flat. Set "file" to the whole file and nothing else.

The format of the file:

${format}`;
});

export const machinePrompt = traced('prompt.machine', (machine: MachineResult | undefined, decisions: readonly { round: number }[]): string => {
  if (!machine || !machine.findings || !machine.findings.length) return '';
  const asked = decisions.some((d) => d.round > machine.round);
  return `State machine of the settled decisions (checked with sm-axi):
${machine.file}

Check findings:
${machine.findings.map((f) => `- ${f.kind} ${f.machine} ${f.at}: ${f.detail}`).join('\n')}

${asked ? 'The owner already answered decisions on these findings. Ask no decision about them again.'
  : `A finding is an architecture problem that is open while the design is open. Ask one decision for each finding that no settled decision answers, in this round, with 2 to 4 options:
a hidden state or an unhandled event (what must happen), a row with no requirement (keep it with a reason, or delete it), a requirement with no row (still necessary?), two transitions or a guard gap (which rule wins).
Ask no decision about a finding that comes from a gap in the file and not from the design.
If the settled decisions answer every finding, set verdict "done".`}

`;
});
