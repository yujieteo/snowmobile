export type Replayable = (args: unknown[]) => unknown;

export const registry = new Map<string, Replayable>();

type Capture = (name: string, args: unknown[]) => void;
let capture: Capture | null = null;

export function onCapture(fn: Capture | null): void {
  capture = fn;
}

export function traced<A extends unknown[], R>(name: string, fn: (...args: A) => R): (...args: A) => R {
  registry.set(name, (args) => fn(...(args as A)));
  return (...args: A): R => {
    capture?.(name, args);
    return fn(...args);
  };
}
