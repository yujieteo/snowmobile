import { assert } from '../shared/assert.ts';
import practicalJson from './seeds/practical-problems.json' with { type: 'json' };
import startJson from './seeds/start.json' with { type: 'json' };
import linksJson from './seeds/problem-links.json' with { type: 'json' };

export type Layer = 'language' | 'hardware' | 'os' | 'software';
export const LAYER_KEYS: readonly Layer[] = ['language', 'hardware', 'os', 'software'];

export type ParadigmSeed = readonly [name: string, summary: string, url: string];
export type ProblemId = 'technical-debt' | 'build-complexity' | 'deployment-complexity' | 'unreliable-tools';
export interface ProblemLink {
  paradigm: string;
  layer: Layer;
  problem_id: ProblemId;
  effect: 'reduces' | 'worsens';
  reason: string;
  source: { title: string; url: string };
}

export const LAYERS: Record<Layer, string> = { language: 'Programming language', hardware: 'Hardware', os: 'Operating system', software: 'Software' };

// Reason: the Stack API had no sourced practical problems for the map or idea seed.
export interface ProblemItem { id: ProblemId; name: string; percent: number }
export interface PracticalProblems {
  source: { title: string; url: string; checked: string; respondents: number; scope: string; measure: string; limit: string };
  items: readonly ProblemItem[];
}

// The JSON seed files hold the tables; the shape is checked here once at load.
function practical(raw: unknown): PracticalProblems {
  assert(typeof raw === 'object' && raw !== null, 'practical problems must be an object');
  const table = raw as PracticalProblems;
  assert(table.items.length > 0, 'practical problems need items');
  assert(table.source.respondents > 0, 'the survey needs respondents');
  for (const item of table.items) {
    assert(item.percent >= 0 && item.percent <= 100, 'shares are percentages');
    assert(item.name.length > 0, 'a problem needs a name');
  }
  return table;
}

function startTable(raw: unknown): Record<Layer, readonly ParadigmSeed[]> {
  assert(typeof raw === 'object' && raw !== null, 'start table must be an object');
  const table = raw as Record<Layer, readonly ParadigmSeed[]>;
  assert(Object.keys(table).length === LAYER_KEYS.length, 'start table has exactly the known layers');
  for (const layer of LAYER_KEYS) {
    assert(table[layer].length > 0, 'start table needs seeds for every layer');
    assert(table[layer].every((seed) => seed[2].startsWith('http')), 'every seed has a url');
  }
  return table;
}

function linkTable(raw: unknown): readonly ProblemLink[] {
  assert(Array.isArray(raw) && raw.length > 0, 'problem links must be a non-empty array');
  const links = raw as ProblemLink[];
  for (const link of links) {
    assert(link.reason.length > 0 && link.source.url.startsWith('https://'), 'links need a reason and a source');
    assert(['reduces', 'worsens'].includes(link.effect), 'link effect is known');
    assert(link.paradigm.length > 0, 'a link names its paradigm');
  }
  return links;
}

export const PRACTICAL_PROBLEMS: PracticalProblems = practical(practicalJson);

// The start list includes taxonomies, papers, project documentation and architecture styles.
export const START: Record<Layer, readonly ParadigmSeed[]> = startTable(startJson);

// A gap of this size or more (out of 10) on one axis is a mismatch between the layers of a stack.
export const MISMATCH = 5;

// Reason: the API trial found zero links and no measure of problems without a documented reduction.
export const PROBLEM_LINKS: readonly ProblemLink[] = linkTable(linksJson);
