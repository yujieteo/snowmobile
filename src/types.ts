export interface Answer { choice: number; note: string }
export interface Option { label: string; why: string; kills_component_id: number }
export interface Decision {
  id: string; question: string; depends_on: string[]; options: Option[]; recommended: number;
  round: number; answer: Answer | null;
}
export interface Finding { kind: string; machine: string; at: string; detail: string }
export type MachineResult =
  | { skipped: string; file?: undefined; findings?: undefined; round?: undefined }
  | { skipped?: undefined; file: string; findings: Finding[]; round: number };
export interface Killed {
  component_id: number; reason: string; note: string | null; bad_reason: string | null; under: string[];
}
export interface Tree { round: number; decisions: Decision[]; machine?: MachineResult; killed?: Killed }
export type SettledDecision = Decision & { answer: Answer };

export interface RoundDecision {
  id: string; question: string; depends_on: string[]; options: Option[]; recommended: number;
}
export interface GrillOut {
  verdict: 'open' | 'done' | 'killed'; decisions: RoundDecision[]; brief: string; killed_component_id: number; reason: string;
}

export interface Candidate {
  name: string; pitch: string; component_ids: number[]; problem: string; evidence_url: string; conventional: string;
  gain_axis: string; gain: string; mismatch: string; verdict: 'survives' | 'exists' | 'no clear problem' | 'no clear gain';
  proof_url: string; proof_note: string; problem_ids?: unknown;
}
