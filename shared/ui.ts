import type { Machine } from './fsm.ts';

export type SwipeState = 'idle' | 'pending' | 'scrolling' | 'dragging' | 'leaving';
export type SwipeEvent = 'down' | 'move_x' | 'move_y' | 'release_far' | 'release_near' | 'done';

export const swipeMachine: Machine<SwipeState, SwipeEvent> = {
  name: 'swipe',
  initial: 'idle',
  table: {
    idle: { down: 'pending', release_near: '-' },
    pending: { move_x: 'dragging', move_y: 'scrolling', release_near: 'idle', down: '-' },
    scrolling: { release_near: 'idle', move_y: '-', move_x: '-', down: '-' },
    dragging: { move_x: 'dragging', release_far: 'leaving', release_near: 'idle', down: '-' },
    leaving: { down: 'pending', done: 'idle' },
  },
};

export type ToastState = 'hidden' | 'shown' | 'held';
export type ToastEvent = 'show' | 'hold' | 'free' | 'expire' | 'dismiss';

export const toastMachine: Machine<ToastState, ToastEvent> = {
  name: 'toast',
  initial: 'hidden',
  table: {
    hidden: { show: 'shown', hold: '-', free: '-', expire: '-', dismiss: '-' },
    shown: { show: 'shown', hold: 'held', free: '-', expire: 'hidden', dismiss: 'hidden' },
    held: { show: 'shown', hold: '-', free: 'shown', expire: '-', dismiss: 'hidden' },
  },
};

export type PointState = 'closed' | 'asking' | 'answered' | 'failed';
export type PointEvent = 'tap' | 'answer' | 'error' | 'close';

export const pointMachine: Machine<PointState, PointEvent> = {
  name: 'point-sheet',
  initial: 'closed',
  table: {
    closed: { tap: 'asking', close: '-' },
    asking: { tap: 'asking', answer: 'answered', error: 'failed', close: 'closed' },
    answered: { tap: 'asking', close: 'closed' },
    failed: { tap: 'asking', close: 'closed' },
  },
};

export type OnceState = 'idle' | 'running';
export type OnceEvent = 'run' | 'settle';

export const onceMachine: Machine<OnceState, OnceEvent> = {
  name: 'once',
  initial: 'idle',
  table: {
    idle: { run: 'running' },
    running: { run: '-', settle: 'idle' },
  },
};
