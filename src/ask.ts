import { spawn } from 'node:child_process';
import type { Cfg } from './cfg.ts';
import type { Schema } from './prompts.ts';

export interface AskOptions { web?: boolean; model?: string }

export function ask<T>(cfg: Pick<Cfg, 'claude' | 'home'>, prompt: string, schema: Schema, { web = false, model }: AskOptions = {}): Promise<T> {
  const tools = web ? 'WebSearch,WebFetch' : '';
  const args = ['-p', '--output-format', 'json', '--json-schema', JSON.stringify(schema),
    '--setting-sources', '', '--strict-mcp-config', '--no-session-persistence',
    '--tools', tools, '--allowedTools', tools];
  if (model) args.push('--model', model);
  return new Promise<T>((resolve, reject) => {
    const child = spawn(cfg.claude, args, { cwd: cfg.home, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => child.kill(), 15 * 60 * 1000);
    child.stdout.on('data', (d: Buffer) => (out += d));
    child.stderr.on('data', (d: Buffer) => (err += d));
    child.on('error', (e) => { clearTimeout(timer); reject(new Error(`cannot run ${cfg.claude}: ${e.message}`)); });
    child.on('close', (code) => {
      clearTimeout(timer);
      let res: { is_error?: boolean; structured_output?: T; result?: unknown; subtype?: unknown };
      try { res = JSON.parse(out); } catch { return reject(new Error(`claude exited ${code}: ${(err || out).slice(0, 400)}`)); }
      if (res.is_error || !res.structured_output) return reject(new Error(`claude: ${String(res.result || res.subtype).slice(0, 400)}`));
      resolve(res.structured_output);
    });
    child.stdin.end(prompt);
  });
}
