export interface Diff { name: string; i: number; args: unknown[]; base: string; branch: string }

function stable(_key: string, v: unknown): unknown {
  if (v === undefined) {
    return '__undefined';
  }
  return typeof v === 'number' && !Number.isFinite(v) ? `__${String(v)}` : v;
}

// JSON.stringify gives undefined for a function or a symbol, although its type says string.
function stringify(value: unknown): string | undefined {
  return JSON.stringify(value, stable);
}

// A stable text of a result. A thrown error counts as a result.
export function show(run: () => unknown): string {
  try {
    return stringify(run()) ?? '__undefined';
  } catch (e) {
    return `__throws ${(e as Error).message}`;
  }
}

export function compare(name: string, i: number, args: unknown[], base: (a: unknown[]) => unknown, branch: (a: unknown[]) => unknown): Diff | null {
  const a = show(() => base(structuredClone(args))), b = show(() => branch(structuredClone(args)));
  return a === b ? null : { name, i, args, base: a, branch: b };
}
