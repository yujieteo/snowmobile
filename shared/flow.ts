import { assert } from './assert.ts';
import type { Machine } from './fsm.ts';

export type HuntState = 'seeded' | 'hunting' | 'hunted' | 'creating' | 'created' | 'failed';
export type HuntEvent = 'seed' | 'seed_stack' | 'hunt' | 'hunt_done' | 'create' | 'create_done' | 'fail';

export const huntMachine: Machine<HuntState, HuntEvent> = {
  name: 'hunt',
  initial: 'seeded',
  table: {
    seeded: { seed: 'hunting', seed_stack: 'creating' },
    hunting: { hunt_done: 'hunted', fail: 'failed', hunt: '-', create: '-' },
    hunted: { hunt: 'hunting', create: 'creating' },
    creating: { create_done: 'created', fail: 'failed', hunt: '-', create: '-' },
    created: { hunt: 'hunting', create: 'creating' },
    failed: { hunt: 'hunting', create: 'creating' },
  },
};

export type IdeaState = 'candidate' | 'survivor' | 'graveyard' | 'grilled' | 'killed';
export type IdeaEvent = 'pass' | 'exile' | 'bury' | 'restore' | 'finish' | 'kill' | 'undo';

export const ideaMachine: Machine<IdeaState, IdeaEvent> = {
  name: 'idea',
  initial: 'candidate',
  table: {
    candidate: { pass: 'survivor', exile: 'graveyard' },
    survivor: { bury: 'graveyard', finish: 'grilled', kill: 'killed', undo: '-' },
    graveyard: { restore: 'survivor' },
    grilled: { undo: 'survivor' },
    killed: { undo: 'survivor' },
  },
};

export type GrillState = 'fresh' | 'asking' | 'thinking' | 'failed' | 'done' | 'killed';
export type GrillEvent = 'open' | 'answer' | 'round' | 'finish' | 'kill' | 'error' | 'retry' | 'undo';

export const grillMachine: Machine<GrillState, GrillEvent> = {
  name: 'grill',
  initial: 'fresh',
  table: {
    fresh: { open: 'thinking' },
    thinking: { open: '-', answer: '-', retry: '-', round: 'asking', finish: 'done', kill: 'killed', error: 'failed', undo: 'asking' },
    asking: { open: '-', answer: 'thinking', kill: 'killed', retry: '-', undo: 'asking' },
    failed: { open: '-', answer: 'thinking', retry: 'thinking', undo: 'asking' },
    done: { open: '-', undo: 'asking' },
    killed: { open: '-', undo: 'asking' },
  },
};

export type StackJobState = 'idle' | 'running' | 'failed';
export type StackJobEvent = 'start' | 'done' | 'fail';

export const stackJobMachine: Machine<StackJobState, StackJobEvent> = {
  name: 'stack-job',
  initial: 'idle',
  table: {
    idle: { start: 'running' },
    running: { start: '-', done: 'idle', fail: 'failed' },
    failed: { start: 'running' },
  },
};

assert(Object.keys(huntMachine.table).includes(huntMachine.initial), 'the hunt machine starts in one of its states');
assert(Object.keys(grillMachine.table).includes(grillMachine.initial), 'the grill machine starts in one of its states');
