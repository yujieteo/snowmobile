export interface Diff { name: string; i: number; args: unknown[]; base: string; branch: string }

// A stable text of a result. A thrown error counts as a result.
export function show(run: () => unknown): string {
  try {
    return JSON.stringify(run(), (_k, v: unknown) => (v === undefined ? '__undefined' : typeof v === 'number' && !Number.isFinite(v) ? `__${v}` : v)) ?? '__undefined';
  } catch (e) { return `__throws ${(e as Error).message}`; }
}

export function compare(name: string, i: number, args: unknown[], base: (a: unknown[]) => unknown, branch: (a: unknown[]) => unknown): Diff | null {
  const a = show(() => base(structuredClone(args))), b = show(() => branch(structuredClone(args)));
  return a === b ? null : { name, i, args, base: a, branch: b };
}
