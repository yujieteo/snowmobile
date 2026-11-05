#!/usr/bin/env bun
import fs from 'node:fs';
// A stand-in for `claude -p`: answers each snowmobile prompt with fixed structured output.
let prompt = '';

type Out = Record<string, unknown>;

const option = (label: string, why: string, kills = 0): Out => ({ label, why, kills_component_id: kills });
const empty = { brief: '', killed_component_id: 0, reason: '' };

function huntOut(): Out {
  return { sources: [
    { name: 'git', kind: 'tool', url: 'https://git-scm.com', summary: 'Version control.',
      components: [{ name: 'content-addressed objects', mechanism: 'Objects are named by their hash.', url: 'https://git-scm.com/book' }] },
    { name: 'Erlang/OTP', kind: 'paradigm', url: 'https://erlang.org', summary: 'Actors.',
      components: [{ name: 'supervision trees', mechanism: 'A parent restarts failed children.', url: 'https://erlang.org/doc' }] },
  ] };
}

function scoresOut(): Out {
  const ids = (text: string | undefined): number[] => [...(text ?? '').matchAll(/^(\d+) \|/gm)].map((m) => Number(m[1]));
  const ps = ids(prompt.split('Paradigms (')[1]);
  const as = ids(prompt.split('Paradigms (')[0]);
  return { scores: ps.flatMap((p) => as.map((a) => ({ paradigm_id: p, axis_id: a, score: (p * 7 + a * a * 3) % 11, reason: 'fake' }))) };
}

function candidatesOut(): Out {
  const stack = prompt.includes('candidate consumer apps');
  let ids = [...prompt.matchAll(/^(\d+) \|/gm)].map((m) => Number(m[1]));
  // A stack: the first paradigm of each layer.
  if (stack) {
    const seen = new Set<string | undefined>();
    ids = [...(prompt.split('Paradigms (')[1] ?? '').matchAll(/^(\d+) \| (\w+) \|/gm)].filter((m) => !seen.has(m[2]) && seen.add(m[2])).map((m) => Number(m[1]));
  }
  const mismatch = stack ? 'Hardware and software disagree on where state lives.' : '';
  const why = { problem: 'Testers lose a day to flaky tests.', evidence_url: 'https://example.com/thread', conventional: 'Retry plugins',
    gain_axis: 'effort', gain: 'Restarts only changed tests; saves 50% of reruns.', mismatch };
  if (stack) {
    fs.writeFileSync('stack-prompt', prompt);
    if (!prompt.includes('technical-debt | Technical debt | 62.4%') ||
        !prompt.includes('https://survey.stackoverflow.co/2024/professional-developers/') ||
        !prompt.includes('problem_ids') || !prompt.includes('developer tools')) {
          throw new Error('No practical problem context.');
        }
  }
  const c = [
    { name: 'Hashvisor', pitch: 'Restart tests by content hash.', component_ids: ids, ...why, problem_ids: ['technical-debt', 'technical-debt', 'unknown'], verdict: 'survives', proof_url: '', proof_note: 'Nothing close.' },
    { name: 'Killme', pitch: 'A plan with a weak part.', component_ids: ids, ...why, problem_ids: ['unreliable-tools'], verdict: 'survives', proof_url: '', proof_note: '' },
    { name: 'Oldnews', pitch: 'Already exists.', component_ids: ids, ...why, verdict: 'exists', proof_url: 'https://example.com', proof_note: 'Same thing.' },
    { name: 'Nosource', pitch: 'A pain without a source.', component_ids: ids, ...why, evidence_url: '', verdict: 'survives', proof_url: '', proof_note: 'Sounds good.' },
    { name: 'Nobetter', pitch: 'No better than today.', component_ids: ids, ...why, verdict: 'no clear gain', proof_url: 'https://example.com', proof_note: 'Retry plugins do the same.' },
  ];
  if (stack) {
    c.splice(0, 2, ...c.slice(0, 2).reverse());
  }
  return { candidates: c };
}

function grillOut(): Out {
  const id = Number((/^(\d+) \|/m.exec(prompt) ?? [0, 0])[1]);
  // A part that is not in the plan: the plan's parts are inserted first in the tests.
  const foreign = id + 1;
  if (prompt.includes('Write the state machine file')) {
    fs.appendFileSync('machine-prompt', prompt);
    return { file: [
      '# Design', '', '## Requirements', '', '- R1: Small scope. — scope', '', '## Machine job', 'initial: idle', 'final: done', '',
      ...(prompt.includes('Plan: Hidden.') ? ['HIDDEN'] : []), ...(prompt.includes('Plan: Garbled.') ? ['BROKEN'] : [])].join('\n') };
  }
  if (prompt.includes('Plan: Blameless.')) {
    return { verdict: 'killed', decisions: [], brief: '', killed_component_id: 0, reason: 'Nobody needs it.' };
  }
  if (prompt.includes('Plan: Blamer.')) {
    return { verdict: 'killed', decisions: [], brief: '', killed_component_id: foreign, reason: 'Wrong part.' };
  }
  if (prompt.includes('Plan: Stranger.') && !prompt.includes('answer:')) {
    return { verdict: 'open', ...empty, decisions: [
      { id: 'mode', question: 'Mode?', depends_on: [], recommended: 1, options: [option('Batch', 'Simple.'), option('Stream', 'Live.', foreign)] }] };
  }
  if (prompt.includes('Check findings:') && !prompt.includes('already answered')) {
    return { verdict: 'open', ...empty, decisions: [
      { id: 'closed-input', question: 'What happens when input arrives while a job runs?', depends_on: [], recommended: 0,
        options: [option('Queue it', 'Nothing is lost.'), option('Refuse it', 'Simple.')] }] };
  }
  if (prompt.includes('answer:')) {
    return { verdict: 'done', decisions: [], brief: '# Build\nDo it.', killed_component_id: 0, reason: '' };
  }
  return { verdict: 'open', ...empty, decisions: [
    { id: 'scope', question: 'Scope?', depends_on: [], recommended: 0, options: [option('Small', 'Fast.'), option('Hashes are too slow', 'Then nothing works.', id)] },
    { id: 'lang', question: 'Language?', depends_on: [], recommended: 1, options: [option('Go', 'One binary.'), option('Rust', 'Speed.')] }] };
}

function structured(): Out {
  if (prompt.includes('You hunt for parts')) {
    return huntOut();
  }
  if (prompt.includes('candidate snowmobiles') || prompt.includes('candidate consumer apps')) {
    return candidatesOut();
  }
  if (prompt.includes('design axes')) {
    return { axes: ['state', 'binding', 'scheduling', 'parallelism'].map((n) => ({ name: n, low: `${n} low`, high: `${n} high` })) };
  }
  if (prompt.includes('Score each paradigm')) {
    return scoresOut();
  }
  if (prompt.includes('You hunt for paradigms')) {
    fs.writeFileSync('paradigm-prompt', prompt);
    return { paradigms: [
      { layer: 'os', name: 'Microkernel', summary: 'A copy of one that exists.', url: 'https://example.com/a' },
      { layer: 'hardware', name: 'Processing in memory', summary: 'Compute next to the DRAM.', url: 'https://example.com/pim' },
    ] };
  }
  if (prompt.includes('Which paradigm would live')) {
    fs.writeFileSync('point-prompt', prompt);
    return { layer: 'os', name: 'No verified match', exists: false, url: '', why: 'No verified match. The practical effect is unknown.' };
  }
  return grillOut();
}

function answer(): void {
  if (prompt.includes('Plan: Broken.')) {
    // Runs in the snowmobile home, so the test can count the calls.
    fs.appendFileSync('broken-calls', 'x');
    process.stdout.write(JSON.stringify({ type: 'result', is_error: true, result: 'Not logged in' }));
    return;
  }
  process.stdout.write(JSON.stringify({ type: 'result', is_error: false, structured_output: structured() }));
}

process.stdin.on('data', (d: Buffer) => { prompt += d.toString(); });
// FAKE_CLAUDE_DELAY_MS keeps a job busy for that time, so that a browser test can see a page that polls.
process.stdin.on('end', () => setTimeout(answer, Number(process.env['FAKE_CLAUDE_DELAY_MS']) || 0));
