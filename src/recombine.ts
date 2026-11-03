import { traced } from '../shared/trace.ts';
import { ideaProblems } from './stack.ts';
import type { Candidate } from './types.ts';

export type Grave = 'exists' | 'no clear problem' | 'no clear gain';

export const graveOf = traced('recombine.graveOf', (c: Pick<Candidate, 'verdict' | 'problem' | 'evidence_url' | 'conventional' | 'gain_axis' | 'gain'>): Grave | null => {
  if (c.verdict === 'exists') return 'exists';
  const blank = (k: 'problem' | 'conventional' | 'gain_axis' | 'gain'): boolean => !String(c[k] || '').trim();
  if (c.verdict === 'no clear problem' || blank('problem') || !/^https?:\/\//i.test(c.evidence_url || '')) return 'no clear problem';
  if (c.verdict === 'no clear gain' || blank('conventional') || blank('gain_axis') || blank('gain')) return 'no clear gain';
  return null;
});

export interface IdeaInsert {
  name: string; pitch: string; component_ids: string; status: 'graveyard' | 'survivor'; proof_url: string; proof_note: string;
  problem: string; evidence_url: string; conventional: string; gain_axis: string; gain: string; mismatch: string | null;
  problem_ids: string | null;
}

export const ideaRow = traced('recombine.ideaRow', (c: Candidate, known: readonly number[], stack: boolean): IdeaInsert => {
  const ids = c.component_ids.filter((i) => known.includes(i));
  const grave = graveOf(c);
  const proofUrl = grave === 'exists' ? c.proof_url : '';
  const note = grave && grave !== 'exists' ? `${grave[0]?.toUpperCase()}${grave.slice(1)}: ${c.proof_note}` : c.proof_note;
  return { name: c.name, pitch: c.pitch, component_ids: JSON.stringify(ids), status: grave ? 'graveyard' : 'survivor',
    proof_url: proofUrl, proof_note: note, problem: c.problem, evidence_url: c.evidence_url, conventional: c.conventional,
    gain_axis: c.gain_axis, gain: c.gain, mismatch: stack ? c.mismatch : null,
    problem_ids: stack ? JSON.stringify(ideaProblems(c.problem_ids).problem_ids) : null };
});
