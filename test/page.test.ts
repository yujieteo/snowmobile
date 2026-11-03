// Runs page.html in headless Chrome through the DevTools protocol. Without Chrome, the tests are skipped.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { start } from '../src/server.ts';

// The API bodies carry too much shape to type by hand.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

function findChrome(): string | undefined {
  const names = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ...['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'].map((n) => {
      try { return execFileSync('which', [n], { encoding: 'utf8' }).trim(); } catch { return ''; }
    })];
  return names.find((n) => n && fs.existsSync(n));
}
const chrome = findChrome();

async function lab(t: TestContext) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'snowmobile-'));
  const { server, cfg, port } = await start({ home, port: 0, smAxi: null, claude: path.join(import.meta.dirname, 'fake-claude.ts') });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snowmobile-chrome-'));
  const proc = spawn(chrome as string, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${dir}`, '--no-first-run',
    '--no-default-browser-check', '--window-size=390,844', ...(process.platform === 'linux' ? ['--no-sandbox'] : []), 'about:blank'],
  { stdio: 'ignore' });
  const portFile = path.join(dir, 'DevToolsActivePort');
  for (let i = 0; i < 200 && !(fs.existsSync(portFile) && fs.readFileSync(portFile, 'utf8').includes('\n')); i++) {
    await new Promise((r) => setTimeout(r, 50));
  }
  const devtools = fs.readFileSync(portFile, 'utf8').split('\n')[0];
  const page = (await (await fetch(`http://127.0.0.1:${devtools}/json/list`)).json()).find((p: Json) => p.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = () => r(null); ws.onerror = j; });
  let n = 0;
  const pending = new Map<number, { r: (v: Json) => void; j: (e: Error) => void }>();
  ws.onmessage = (m) => {
    const d = JSON.parse(String(m.data));
    const hit = pending.get(d.id);
    if (!hit) return;
    const { r, j } = hit;
    pending.delete(d.id);
    if (d.error) j(new Error(d.error.message)); else r(d.result);
  };
  const send = (method: string, params: object = {}): Promise<Json> => new Promise((r, j) => { pending.set(++n, { r, j }); ws.send(JSON.stringify({ id: n, method, params })); });
  // A headless page has no window focus, so focus events would not fire.
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  const run = async (expression: string): Promise<Json> => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const until = async (expression: string, ms = 5000): Promise<Json> => {
    for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 50))) {
      const v = await run(expression);
      if (v) return v;
    }
    throw new Error(`timeout: ${expression}`);
  };
  const open = async (hash: string) => {
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/?token=${cfg.token}${hash}` });
    await until(`document.readyState === 'complete' && !!document.querySelector('#app h1')`);
  };
  const api = async (p: string, body?: object): Promise<Json> => (await fetch(`http://127.0.0.1:${port}${p}`, { method: body ? 'POST' : 'GET',
    headers: { 'x-token': cfg.token }, body: body ? JSON.stringify(body) : undefined })).json();
  t.after(() => { ws.close(); proc.kill(); server.close(); });
  return { run, until, open, api };
}

const opts = { skip: !chrome && 'no Chrome found (set CHROME_PATH)' };

test('a double tap on "Hunt" makes 1 hunt', opts, async (t) => {
  const { run, until, open, api } = await lab(t);
  await open('#/');
  await run(`document.getElementById('seed').value = 'double tap';
    document.getElementById('primary').click(); document.getElementById('primary').click();
    document.getElementById('f').requestSubmit();`);
  await until(`location.hash.startsWith('#/hunt/')`);
  const { hunts } = await api('/api/search?q=double');
  assert.strictEqual(hunts.length, 1);
});

test('the toast timer stops on hover, focus and a hidden page, and continues with the time that it had left', opts, async (t) => {
  const { run, until, open } = await lab(t);
  await open('#/');
  // The countdown that the toast uses, with a short time.
  const left = await run(`new Promise((done) => {
    const { countdown } = window.__snowmobile; const t0 = performance.now(), c = countdown(300, () => done(performance.now() - t0));
    c.start(); setTimeout(() => c.hold('pointer'), 100);
    setTimeout(() => { c.hold('focus'); c.free('pointer'); }, 300);
    setTimeout(() => { c.hold('hidden'); c.free('focus'); }, 500);
    setTimeout(() => c.free('hidden'), 700);
  })`);
  assert.ok(left >= 800 && left < 1500, `done after ${left} ms`);

  // The toast holds its countdown for each event.
  await run(`window.undone = 0; window.__snowmobile.toast('Buried x.', () => window.undone++)`);
  await until(`getComputedStyle(window.__snowmobile.toastEl).visibility === 'visible'`);
  const held = (expression: string) => run(`(() => { const { toastEl, clock, setClock } = window.__snowmobile; const h = []; const real = clock();
    setClock({ hold: (w) => h.push('+' + w), free: (w) => h.push('-' + w) }); ${expression}; setClock(real); return h.join(' '); })()`);
  assert.strictEqual(await held(`toastEl.dispatchEvent(new PointerEvent('pointerenter')); toastEl.dispatchEvent(new PointerEvent('pointerleave'))`),
    '+pointer -pointer');
  assert.strictEqual(await held(`window.__snowmobile.toastEl.querySelector('button').focus(); window.__snowmobile.toastEl.querySelector('button').blur()`), '+focus -focus');
  assert.strictEqual(await held(`Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange')); delete document.hidden;
    document.dispatchEvent(new Event('visibilitychange'))`), '+hidden -hidden');

  // A keyboard reaches "Undo": Ctrl+Z, and the toast is first in the tab order. A hidden toast is inert.
  assert.strictEqual(await run(`document.getElementById('skip').nextElementSibling.id`), 'toast');
  await run(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }))`);
  await until('window.undone === 1');
  assert.strictEqual(await run(`window.__snowmobile.toastEl.inert && !window.__snowmobile.toastEl.classList.contains('show')`), true);
});

test('a redraw keeps the keyboard focus: a poll of a busy hunt, and a pick on the stack', opts, async (t) => {
  process.env.FAKE_CLAUDE_DELAY_MS = '4000';
  t.after(() => delete process.env.FAKE_CLAUDE_DELAY_MS);
  const { run, until, open, api } = await lab(t);
  const { id } = await api('/api/hunts', { seed: 'busy' });
  await open(`#/hunt/${id}`);
  await run(`document.querySelector('.tabs a[href$="/graveyard"]').focus()`);
  // The page polls every 2 s while it hunts. Its status changes when the hunt ends.
  await until(`!document.querySelector('.status .spin')`, 8000);
  assert.match(await run('document.activeElement.getAttribute("href")'), /\/graveyard$/);

  await open('#/stack');
  await until(`!!document.querySelector('[data-pick]')`);
  const pid = await run(`(() => { const b = document.querySelector('[data-pick]'); b.focus(); b.click(); return b.dataset.pick; })()`);
  await until(`document.querySelector('[data-pick="${pid}"]').getAttribute('aria-pressed') === 'true'`);
  assert.strictEqual(await run('document.activeElement.dataset.pick'), pid);
  assert.strictEqual(await run('document.activeElement.getAttribute("aria-pressed")'), 'true');
});
