#!/usr/bin/env node
// A stand-in for `claude -p`: answers each snowmobile prompt with fixed structured output.
let prompt = '';
process.stdin.on('data', (d) => (prompt += d));
process.stdin.on('end', () => {
  if (prompt.includes('Plan: Broken.')) {
    // Runs in the snowmobile home, so the test can count the calls.
    require('node:fs').appendFileSync('broken-calls', 'x');
    return process.stdout.write(JSON.stringify({ type: 'result', is_error: true, result: 'Not logged in' }));
  }
  let out;
  if (prompt.includes('You hunt for parts')) {
    out = { sources: [
      { name: 'git', kind: 'tool', url: 'https://git-scm.com', summary: 'Version control.',
        components: [{ name: 'content-addressed objects', mechanism: 'Objects are named by their hash.', url: 'https://git-scm.com/book' }] },
      { name: 'Erlang/OTP', kind: 'paradigm', url: 'https://erlang.org', summary: 'Actors.',
        components: [{ name: 'supervision trees', mechanism: 'A parent restarts failed children.', url: 'https://erlang.org/doc' }] },
    ] };
  } else if (prompt.includes('candidate snowmobiles') || prompt.includes('candidate consumer apps')) {
    let ids = [...prompt.matchAll(/^(\d+) \|/gm)].map((m) => Number(m[1]));
    // A stack: the first paradigm of each layer.
    if (prompt.includes('candidate consumer apps')) {
      const seen = new Set();
      ids = [...prompt.split('Paradigms (')[1].matchAll(/^(\d+) \| (\w+) \|/gm)].filter((m) => !seen.has(m[2]) && seen.add(m[2])).map((m) => Number(m[1]));
    }
    const mismatch = prompt.includes('candidate consumer apps') ? 'Hardware and software disagree on where state lives.' : '';
    const why = { problem: 'Testers lose a day to flaky tests.', evidence_url: 'https://example.com/thread', conventional: 'Retry plugins',
      gain_axis: 'effort', gain: 'Restarts only changed tests; saves 50% of reruns.', mismatch };
    if (prompt.includes('candidate consumer apps')) {
      require('node:fs').writeFileSync('stack-prompt', prompt);
      if (!prompt.includes('technical-debt | Technical debt | 62.4%') ||
          !prompt.includes('https://survey.stackoverflow.co/2024/professional-developers/') ||
          !prompt.includes('problem_ids') || !prompt.includes('developer tools')) throw new Error('No practical problem context.');
    }
    out = { candidates: [
      { name: 'Hashvisor', pitch: 'Restart tests by content hash.', component_ids: ids, ...why, problem_ids: ['technical-debt', 'technical-debt', 'unknown'], verdict: 'survives', proof_url: '', proof_note: 'Nothing close.' },
      { name: 'Killme', pitch: 'A plan with a weak part.', component_ids: ids, ...why, problem_ids: ['unreliable-tools'], verdict: 'survives', proof_url: '', proof_note: '' },
      { name: 'Oldnews', pitch: 'Already exists.', component_ids: ids, ...why, verdict: 'exists', proof_url: 'https://example.com', proof_note: 'Same thing.' },
      { name: 'Nosource', pitch: 'A pain without a source.', component_ids: ids, ...why, evidence_url: '', verdict: 'survives', proof_url: '', proof_note: 'Sounds good.' },
      { name: 'Nobetter', pitch: 'No better than today.', component_ids: ids, ...why, verdict: 'no clear gain', proof_url: 'https://example.com', proof_note: 'Retry plugins do the same.' },
    ] };
    if (prompt.includes('candidate consumer apps')) [out.candidates[0], out.candidates[1]] = [out.candidates[1], out.candidates[0]];
  } else if (prompt.includes('design axes')) {
    out = { axes: ['state', 'binding', 'scheduling', 'parallelism'].map((n) => ({ name: n, low: `${n} low`, high: `${n} high` })) };
  } else if (prompt.includes('Score each paradigm')) {
    const ps = [...prompt.split('Paradigms (')[1].matchAll(/^(\d+) \|/gm)].map((m) => Number(m[1]));
    const as = [...prompt.split('Paradigms (')[0].matchAll(/^(\d+) \|/gm)].map((m) => Number(m[1]));
    out = { scores: ps.flatMap((p) => as.map((a) => ({ paradigm_id: p, axis_id: a, score: (p * 7 + a * a * 3) % 11, reason: 'fake' }))) };
  } else if (prompt.includes('You hunt for paradigms')) {
    out = { paradigms: [
      { layer: 'os', name: 'Microkernel', summary: 'A copy of one that exists.', url: 'https://example.com/a' },
      { layer: 'hardware', name: 'Processing in memory', summary: 'Compute next to the DRAM.', url: 'https://example.com/pim' },
    ] };
  } else if (prompt.includes('Which paradigm would live')) {
    out = { layer: 'os', name: 'Gap OS', exists: false, url: '', why: 'Nothing lives here.' };
  } else {
    const id = Number(prompt.match(/^(\d+) \|/m)[1]);
    // A part that is not in the plan: the plan's parts are inserted first in the tests.
    const foreign = id + 1;
    out = prompt.includes('Plan: Blameless.') ? { verdict: 'killed', decisions: [], brief: '', killed_component_id: 0, reason: 'Nobody needs it.' }
      : prompt.includes('Plan: Blamer.') ? { verdict: 'killed', decisions: [], brief: '', killed_component_id: foreign, reason: 'Wrong part.' }
      : prompt.includes('Plan: Stranger.') && !prompt.includes('answer:') ? { verdict: 'open', brief: '', killed_component_id: 0, reason: '', decisions: [
          { id: 'mode', question: 'Mode?', depends_on: [], recommended: 1, options: [
            { label: 'Batch', why: 'Simple.', kills_component_id: 0 },
            { label: 'Stream', why: 'Live.', kills_component_id: foreign }] }] }
      : prompt.includes('answer:')
      ? { verdict: 'done', decisions: [], brief: '# Build\nDo it.', killed_component_id: 0, reason: '' }
      : { verdict: 'open', brief: '', killed_component_id: 0, reason: '', decisions: [
          { id: 'scope', question: 'Scope?', depends_on: [], recommended: 0, options: [
            { label: 'Small', why: 'Fast.', kills_component_id: 0 },
            { label: 'Hashes are too slow', why: 'Then nothing works.', kills_component_id: id }] },
          { id: 'lang', question: 'Language?', depends_on: [], recommended: 1, options: [
            { label: 'Go', why: 'One binary.', kills_component_id: 0 },
            { label: 'Rust', why: 'Speed.', kills_component_id: 0 }] }] };
  }
  process.stdout.write(JSON.stringify({ type: 'result', is_error: false, structured_output: out }));
});
