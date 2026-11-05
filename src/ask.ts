import { spawn } from 'node:child_process';
import { assert } from '../shared/assert.ts';
import type { Cfg } from './cfg.ts';
import type { Schema } from './prompts.ts';

export interface AskOptions { web?: boolean; model?: string }

const ASK_TIMEOUT_MS = 15 * 60 * 1000;
const MESSAGE_LIMIT = 400;

interface Reply<T> { is_error?: boolean; structured_output?: T; result?: unknown; subtype?: unknown }

function claudeArgs(schema: Schema, web: boolean, model: string | undefined): string[] {
  assert(typeof web === 'boolean', 'web is a flag');
  assert(model === undefined || model.length > 0, 'a model is named or absent');
  assert(Object.keys(schema).length > 0, 'the schema names its fields');
  const tools = web ? 'WebSearch,WebFetch' : '';
  const args = ['-p', '--output-format', 'json', '--json-schema', JSON.stringify(schema),
    '--setting-sources', '', '--strict-mcp-config', '--no-session-persistence',
    '--tools', tools, '--allowedTools', tools];
  if (model !== undefined && model.length > 0) {
    args.push('--model', model);
  }
  assert(args.every((a) => typeof a === 'string'), 'every argument is text');
  assert(args.length >= 12, 'the arguments name every option');
  return args;
}

function parseReply(out: string, err: string, code: number | null): unknown {
  assert(typeof out === 'string' && typeof err === 'string', 'the output and the error are text');
  assert(code === null || Number.isInteger(code), 'the exit code is a number or null');
  let res: Reply<unknown>;
  try {
    res = JSON.parse(out) as Reply<unknown>;
  } catch {
    throw new Error(`claude exited ${String(code)}: ${(err || out).slice(0, MESSAGE_LIMIT)}`);
  }
  if (res.is_error === true || !res.structured_output) {
    throw new Error(`claude: ${String(res.result ?? res.subtype).slice(0, MESSAGE_LIMIT)}`);
  }
  assert(typeof res.structured_output === 'object', 'the structured output is an object');
  assert(Object.keys(res).length > 0, 'the reply has fields');
  return res.structured_output;
}

export function ask<T>(cfg: Pick<Cfg, 'claude' | 'home'>, prompt: string, schema: Schema, { web = false, model }: AskOptions = {}): Promise<T> {
  assert(prompt.length > 0, 'a prompt is not empty');
  assert(cfg.claude.length > 0, 'the claude program is named');
  const args = claudeArgs(schema, web, model);
  assert(args.includes('-p'), 'the program runs in print mode');
  assert(args[0] === '-p', 'print mode comes first');
  assert(cfg.home.length > 0, 'the program runs in a folder');
  return new Promise<T>((resolve, reject) => {
    const child = spawn(cfg.claude, args, { cwd: cfg.home, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => {
      assert(ASK_TIMEOUT_MS > 0, 'the wait is bounded');
      child.kill();
    }, ASK_TIMEOUT_MS);
    child.stdout.on('data', (d: Buffer) => {
      assert(Buffer.isBuffer(d), 'a stream chunk is a buffer');
      out += d.toString();
    });
    child.stderr.on('data', (d: Buffer) => {
      assert(Buffer.isBuffer(d), 'a stream chunk is a buffer');
      err += d.toString();
    });
    child.on('error', (e) => {
      assert(e.message.length >= 0, 'an error has a message');
      clearTimeout(timer);
      assert(typeof cfg.claude === 'string', 'the program is named');
      reject(new Error(`cannot run ${cfg.claude}: ${e.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      assert(code === null || Number.isInteger(code), 'the exit code is a number or null');
      try {
        resolve(parseReply(out, err, code) as T);
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
    assert(prompt.length > 0, 'the prompt is sent');
    child.stdin.end(prompt);
  });
}
