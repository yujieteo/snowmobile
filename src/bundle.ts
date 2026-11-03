import path from 'node:path';

let built: Promise<string> | null = null;

export function clientBundle(root: string): Promise<string> {
  built ??= Bun.build({ entrypoints: [path.join(root, 'client', 'page.ts')], target: 'browser', minify: false }).then(async (r) => {
    const out = r.outputs[0];
    if (!r.success || !out) throw new Error(`cannot build the page script: ${r.logs.map(String).join('; ')}`);
    return out.text();
  }).catch((e: unknown) => { built = null; throw e; });
  return built;
}
