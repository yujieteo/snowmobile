import path from 'node:path';
import { assert } from '../shared/assert.ts';

let built: Promise<string> | null = null;

async function buildBundle(root: string): Promise<string> {
  assert(root.length > 0, 'the project root is named');
  assert(path.isAbsolute(root) || root.length > 0, 'the project root is a path');
  const r = await Bun.build({ entrypoints: [path.join(root, 'client', 'page.ts')], target: 'browser', minify: false });
  const out = r.outputs[0];
  if (!r.success || !out) {
    throw new Error(`cannot build the page script: ${r.logs.map(String).join('; ')}`);
  }
  assert(r.outputs.length > 0, 'the build wrote an output');
  assert(out.kind === 'entry-point', 'the first output is the entry point');
  return out.text();
}

export function clientBundle(root: string): Promise<string> {
  assert(root.length > 0, 'the project root is named');
  assert(built === null || built instanceof Promise, 'the bundle is a promise once started');
  built ??= buildBundle(root).catch((e: unknown) => {
    built = null;
    throw e;
  });
  assert(built instanceof Promise, 'the bundle is a promise');
  assert(root.length > 0, 'the root is still named');
  return built;
}
