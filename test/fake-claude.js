#!/usr/bin/env node
// A stand-in for `claude -p`: answers each snowmobile prompt with fixed structured output.
let prompt = '';
process.stdin.on('data', (d) => (prompt += d));
process.stdin.on('end', () => {
  let out;
  if (prompt.includes('You hunt for parts')) {
    out = { sources: [
      { name: 'git', kind: 'tool', url: 'https://git-scm.com', summary: 'Version control.',
        components: [{ name: 'content-addressed objects', mechanism: 'Objects are named by their hash.', url: 'https://git-scm.com/book' }] },
      { name: 'Erlang/OTP', kind: 'paradigm', url: 'https://erlang.org', summary: 'Actors.',
        components: [{ name: 'supervision trees', mechanism: 'A parent restarts failed children.', url: 'https://erlang.org/doc' }] },
    ] };
  } else if (prompt.includes('candidate snowmobiles')) {
    const ids = [...prompt.matchAll(/^(\d+) \|/gm)].map((m) => Number(m[1]));
    out = { candidates: [
      { name: 'Hashvisor', pitch: 'Restart tests by content hash.', component_ids: ids, exists: false, proof_url: '', proof_note: 'Nothing close.' },
      { name: 'Killme', pitch: 'A plan with a weak part.', component_ids: ids, exists: false, proof_url: '', proof_note: '' },
      { name: 'Oldnews', pitch: 'Already exists.', component_ids: ids, exists: true, proof_url: 'https://example.com', proof_note: 'Same thing.' },
    ] };
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
