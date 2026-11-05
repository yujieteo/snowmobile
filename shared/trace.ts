import { assert } from './assert.ts';

export type Replayable = (args: unknown[]) => unknown;

export const registry = new Map<string, Replayable>();

type Capture = (name: string, args: unknown[]) => void;
let capture: Capture | null = null;

export function onCapture(fn: Capture | null): void {
  assert(fn === null || typeof fn === 'function', 'a capture is a function or null');
  assert(capture === null || fn === null || capture !== fn, 'a capture is not set twice');
  capture = fn;
  assert(capture === fn, 'the capture is set');
  assert(registry instanceof Map, 'the registry is a map');
}

export function traced<A extends unknown[], R>(name: string, fn: (...args: A) => R): (...args: A) => R {
  assert(name.length > 0, 'a transform has a name');
  assert(typeof fn === 'function', 'a transform is a function');
  registry.set(name, (args) => {
    assert(Number.isInteger(args.length), 'replayed arguments are a list');
    assert(name.length > 0, 'a replayed transform has a name');
    return fn(...(args as A));
  });
  return (...args: A): R => {
    assert(Number.isInteger(args.length), 'arguments are a list');
    assert(registry.has(name), 'the transform is registered');
    capture?.(name, args);
    return fn(...args);
  };
}
