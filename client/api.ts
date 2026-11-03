import type { Layer } from '../src/data.ts';
import type { Decision, Tree } from '../src/types.ts';
import type { Axis, Paradigm, Score } from '../src/stack.ts';

export interface Hunt { id: number; seed: string; status: string; error: string | null; created_at: string; stack: string | null }
export interface Component { id: number; name: string; mechanism: string; url: string; bad_reason: string | null; source?: string; hunt_id?: number }
export interface Source { id: number; name: string; kind: string; url: string; summary: string; components: Component[] }
export interface PracticalProblem { id: string; name: string; percent: number }
export interface Idea {
  id: number; hunt_id: number; name: string; pitch: string; status: string; proof_url: string | null; proof_note: string | null;
  problem: string | null; evidence_url: string | null; conventional: string | null; gain_axis: string | null; gain: string | null;
  mismatch: string | null; component_ids: number[]; practical_problems: PracticalProblem[]; problem_priority: number; seed?: string;
}
export interface SourceInfo { title: string; url: string; respondents: number; scope: string; measure: string; limit: string }
export interface HuntView {
  hunt: Hunt; sources: Source[]; snowmobiles: Idea[];
  problemCoverage: { total: number; named: number; share: number | null; source: SourceInfo; limit: string } | null;
}
export interface GrillView {
  snowmobile: Idea; components: Component[]; tree: Tree; status: 'open' | 'done' | 'killed'; brief: string | null;
  pending: boolean; error: string | null;
}
export interface SearchView { hunts: Hunt[]; snowmobiles: Idea[]; components: (Component & { source: string; hunt_id: number })[] }
export interface Coverage { withoutReduction: string[]; unassessedParadigms: number; limit: string }
export interface Link {
  paradigm: string; paradigm_id: number; problem_id: string; effect: string; reason: string; source: { title: string; url: string };
}
export interface MapData { mean: number[]; components: number[][]; explained: number[]; points: number[][]; ids: number[] }
export interface StackView {
  axes: Axis[]; paradigms: Paradigm[]; scores: Record<number, Record<number, Score>>;
  practicalProblems: { source: SourceInfo; items: PracticalProblem[]; links: Link[]; coverage: Coverage };
  map: MapData | null; layers: Record<Layer, string>; mismatch: number; job: { step: string; error?: string } | null;
  selectedProblemCoverage: Coverage | null; gaps: { axis_id: number; name: string; gap: number; mismatch: boolean }[];
}
export interface PointAnswer { layer: string; name: string; exists: boolean; url: string; why: string }
export interface PointView { x: number; y: number; profile: number[]; answer: PointAnswer }
export type { Decision, Tree };
