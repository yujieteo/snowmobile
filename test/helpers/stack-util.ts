import assert from 'node:assert';

// Small typed helpers: they replace the non-null `!` and the `any` JSON of the stack tests.
export function defined<T>(value: T | null | undefined, what = 'value'): T {
  if (value === null || value === undefined) {throw new Error(`${what} is missing`);}
  return value;
}

export function at<T>(items: readonly T[], index: number): T {
  return defined(items[index], `item ${String(index)}`);
}

export function near(a: number, b: number): void {
  assert.ok(Math.abs(a - b) < 1e-9, `${String(a)} is not ${String(b)}`);
}

export function asJson(text: string): unknown {
  const value: unknown = JSON.parse(text);
  return value;
}

// The prompts embed their data as one JSON line after a marker.
export function promptJson(prompt: string, marker: string): unknown {
  const after = defined(prompt.split(marker)[1], 'marker');
  return asJson(defined(after.split('\n')[0], 'json line'));
}

export async function bodyOf(res: Response): Promise<unknown> {
  const body: unknown = await res.json();
  return body;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
