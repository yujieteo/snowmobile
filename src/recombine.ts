import { assert } from '../shared/assert.ts';
import { traced } from '../shared/trace.ts';
import { ideaProblems } from './stack.ts';
import type { Candidate } from './types.ts';

export type Grave = 'exists' | 'no clear problem' | 'no clear gain';

type GraveInput = Pick<Candidate, 'verdict' | 'problem' | 'evidence_url' | 'conventional' | 'gain_axis' | 'gain'>;

function isBlank(c: GraveInput, key: 'problem' | 'conventional' | 'gain_axis' | 'gain'): boolean {
  assert(key.length > 0, 'a field has a name');
  assert(typeof c === 'object', 'the candidate is an object');
  assert(key !== 'gain' || 'gain' in c, 'a candidate has its gain field');
  return !(c[key] || '').trim();
}

function graveOfImpl(c: GraveInput): Grave | null {
  assert(typeof c === 'object', 'the candidate is an object');
  assert(c.verdict.length > 0, 'a candidate has a verdict');
  assert('evidence_url' in c, 'a candidate has an evidence field');
  if (c.verdict === 'exists') {
    return 'exists';
  }
  if (c.verdict === 'no clear problem' || isBlank(c, 'problem') || !/^https?:\/\//i.test(c.evidence_url || '')) {
    return 'no clear problem';
  }
  if (c.verdict === 'no clear gain' || isBlank(c, 'conventional') || isBlank(c, 'gain_axis') || isBlank(c, 'gain')) {
    return 'no clear gain';
  }
  return null;
}

export const graveOf = traced('recombine.graveOf', graveOfImpl);

export interface IdeaInsert {
  name: string; pitch: string; component_ids: string; status: 'graveyard' | 'survivor'; proof_url: string; proof_note: string;
  problem: string; evidence_url: string; conventional: string; gain_axis: string; gain: string; mismatch: string | null;
  problem_ids: string | null;
}

function noteOf(c: Candidate, grave: Grave | null): string {
  assert(typeof c.proof_note === 'string', 'a proof note is text');
  assert(grave === null || grave.length > 0, 'a grave is named or absent');
  assert(c.name.length >= 0, 'a candidate has a name');
  if (grave && grave !== 'exists') {
    return `${grave[0]?.toUpperCase() ?? ''}${grave.slice(1)}: ${c.proof_note}`;
  }
  return c.proof_note;
}

function ideaRowImpl(c: Candidate, known: readonly number[], stack: boolean): IdeaInsert {
  assert(Number.isInteger(known.length), 'known ids are a list');
  assert(typeof stack === 'boolean', 'stack is a flag');
  const ids = c.component_ids.filter((i) => known.includes(i));
  const grave = graveOf(c);
  const proofUrl = grave === 'exists' ? c.proof_url : '';
  const note = noteOf(c, grave);
  assert(ids.length <= c.component_ids.length, 'known ids are a subset');
  assert(grave === null || proofUrl.length >= 0, 'a grave has a proof url');
  return { name: c.name, pitch: c.pitch, component_ids: JSON.stringify(ids), status: grave ? 'graveyard' : 'survivor',
    proof_url: proofUrl, proof_note: note, problem: c.problem, evidence_url: c.evidence_url, conventional: c.conventional,
    gain_axis: c.gain_axis, gain: c.gain, mismatch: stack ? c.mismatch : null,
    problem_ids: stack ? JSON.stringify(ideaProblems(c.problem_ids).problem_ids) : null };
}

export const ideaRow = traced('recombine.ideaRow', ideaRowImpl);
