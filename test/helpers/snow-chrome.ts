// Headless Chrome through the DevTools protocol, for the tests of page.html.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { start } from '../../src/server.ts';
import { sleep } from './snow-api.ts';

export interface Cdp { send: (method: string, params?: object) => Promise<unknown>; close: () => void }
export interface PageLab {
  run: (expression: string) => Promise<unknown>;
  str: (expression: string) => Promise<string>;
  num: (expression: string) => Promise<number>;
  until: (expression: string, ms?: number) => Promise<unknown>;
  open: (hash: string) => Promise<void>;
  api: (p: string, body?: object) => Promise<{ id: number; hunts: unknown[] }>;
  close: () => void;
}
interface Message { id: number; error?: { message: string }; result?: unknown }
interface Evaluated { exceptionDetails?: { exception?: { description?: string }; text: string }; result: { value: unknown } }

export function findChrome(): string | undefined {
  const which = (n: string): string => {
    try {
      return execFileSync('which', [n], { encoding: 'utf8' }).trim();
    } catch {
      return '';
    }
  };
  const names = [process.env['CHROME_PATH'], '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ...['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'].map(which)];
  return names.find((n) => n && fs.existsSync(n));
}

async function launch(chrome: string): Promise<{ proc: ChildProcess; devtools: string }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snowmobile-chrome-'));
  const proc = spawn(chrome, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${dir}`, '--no-first-run',
    '--no-default-browser-check', '--window-size=390,844', ...(process.platform === 'linux' ? ['--no-sandbox'] : []), 'about:blank'],
  { stdio: 'ignore' });
  const portFile = path.join(dir, 'DevToolsActivePort');
  for (let i = 0; i < 200 && !(fs.existsSync(portFile) && fs.readFileSync(portFile, 'utf8').includes('\n')); i++) {
    await sleep(50);
  }
  return { proc, devtools: fs.readFileSync(portFile, 'utf8').split('\n')[0] ?? '' };
}

async function connect(devtools: string): Promise<Cdp> {
  const list = (await (await fetch(`http://127.0.0.1:${devtools}/json/list`)).json()) as { type: string; webSocketDebuggerUrl: string }[];
  const target = list.find((p) => p.type === 'page');
  if (!target) {
    throw new Error('no page target');
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise<void>((resolve, reject) => { ws.onopen = () => {
    resolve();
  }; ws.onerror = reject; });
  let n = 0;
  const pending = new Map<number, { r: (v: unknown) => void; j: (e: Error) => void }>();
  ws.onmessage = (m) => {
    const d = JSON.parse(String(m.data)) as Message;
    const hit = pending.get(d.id);
    if (!hit) {
      return;
    }
    pending.delete(d.id);
    if (d.error) {
      hit.j(new Error(d.error.message));
    }
    else {
      hit.r(d.result);
    }
  };
  const send = (method: string, params: object = {}): Promise<unknown> => new Promise((r, j) => {
    pending.set(++n, { r, j });
    ws.send(JSON.stringify({ id: n, method, params }));
  });
  return { send, close: () => { ws.close(); } };
}

/** A server on a fake claude, a Chrome page, and the calls that a test makes on them. */
export async function pageLab(chrome: string): Promise<PageLab> {
  const { server, cfg, port } = await start({ home: fs.mkdtempSync(path.join(os.tmpdir(), 'snowmobile-')), port: 0, smAxi: null,
    claude: path.join(import.meta.dirname, '..', 'fake-claude.ts') });
  const { proc, devtools } = await launch(chrome);
  const cdp = await connect(devtools);
  // A headless page has no window focus, so focus events would not fire.
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  const run = async (expression: string): Promise<unknown> => {
    const r = (await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })) as Evaluated;
    const ex = r.exceptionDetails;
    if (ex) {
      throw new Error(ex.exception?.description !== undefined && ex.exception.description !== '' ? ex.exception.description : ex.text);
    }
    return r.result.value;
  };
  const until = async (expression: string, ms = 5000): Promise<unknown> => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const v = await run(expression);
      if (v) {
        return v;
      }
      await sleep(50);
    }
    throw new Error(`timeout: ${expression}`);
  };
  const open = async (hash: string): Promise<void> => {
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${String(port)}/?token=${cfg.token}${hash}` });
    await until(`document.readyState === 'complete' && !!document.querySelector('#app h1')`);
  };
  const api = async (p: string, body?: object): Promise<{ id: number; hunts: unknown[] }> => (await fetch(`http://127.0.0.1:${String(port)}${p}`,
    { method: body ? 'POST' : 'GET', headers: { 'x-token': cfg.token }, ...(body ? { body: JSON.stringify(body) } : {}) })).json() as Promise<{ id: number; hunts: unknown[] }>;
  return { run, until, open, api, str: async (e) => String(await run(e)), num: async (e) => Number(await run(e)),
    close: () => { cdp.close(); proc.kill(); server.close(); } };
}
