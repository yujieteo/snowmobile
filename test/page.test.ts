// Runs page.html in headless Chrome through the DevTools protocol. Without Chrome, the tests are skipped.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert';
import { findChrome, pageLab, type PageLab } from './helpers/snow-chrome.ts';

const chrome = findChrome();
const opts = { skip: !chrome && 'no Chrome found (set CHROME_PATH)' };

async function lab(t: TestContext): Promise<PageLab> {
  assert.ok(chrome);
  const l = await pageLab(chrome);
  t.after(l.close);
  return l;
}

async function doubleTap(t: TestContext): Promise<void> {
  const { run, until, open, api } = await lab(t);
  await open('#/');
  await run(`document.getElementById('seed').value = 'double tap';
    document.getElementById('primary').click(); document.getElementById('primary').click();
    document.getElementById('f').requestSubmit();`);
  await until(`location.hash.startsWith('#/hunt/')`);
  const { hunts } = await api('/api/search?q=double');
  assert.strictEqual(hunts.length, 1);
}

/** The countdown that the toast uses, with a short time. */
async function countdownHolds({ num }: PageLab): Promise<void> {
  const left = await num(`new Promise((done) => {
    const { countdown } = window.__snowmobile; const t0 = performance.now(), c = countdown(300, () => done(performance.now() - t0));
    c.start(); setTimeout(() => c.hold('pointer'), 100);
    setTimeout(() => { c.hold('focus'); c.free('pointer'); }, 300);
    setTimeout(() => { c.hold('hidden'); c.free('focus'); }, 500);
    setTimeout(() => c.free('hidden'), 700);
  })`);
  assert.ok(left >= 800 && left < 1500, `done after ${String(left)} ms`);
}

/** The toast holds its countdown for each event. */
async function toastHolds({ run, str, until }: PageLab): Promise<void> {
  await run(`window.undone = 0; window.__snowmobile.toast('Buried x.', () => window.undone++)`);
  await until(`getComputedStyle(window.__snowmobile.toastEl).visibility === 'visible'`);
  const held = (expression: string): Promise<string> => str(`(() => { const { toastEl, clock, setClock } = window.__snowmobile; const h = []; const real = clock();
    setClock({ hold: (w) => h.push('+' + w), free: (w) => h.push('-' + w) }); ${expression}; setClock(real); return h.join(' '); })()`);
  assert.strictEqual(await held(`toastEl.dispatchEvent(new PointerEvent('pointerenter')); toastEl.dispatchEvent(new PointerEvent('pointerleave'))`),
    '+pointer -pointer');
  assert.strictEqual(await held(`window.__snowmobile.toastEl.querySelector('button').focus(); window.__snowmobile.toastEl.querySelector('button').blur()`), '+focus -focus');
  assert.strictEqual(await held(`Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange')); delete document.hidden;
    document.dispatchEvent(new Event('visibilitychange'))`), '+hidden -hidden');
}

async function toastTimer(t: TestContext): Promise<void> {
  const l = await lab(t);
  await l.open('#/');
  await countdownHolds(l);
  await toastHolds(l);
  // A keyboard reaches "Undo": Ctrl+Z, and the toast is first in the tab order. A hidden toast is inert.
  assert.strictEqual(await l.run(`document.getElementById('skip').nextElementSibling.id`), 'toast');
  await l.run(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }))`);
  await l.until('window.undone === 1');
  assert.strictEqual(await l.run(`window.__snowmobile.toastEl.inert && !window.__snowmobile.toastEl.classList.contains('show')`), true);
}

async function keepsFocus(t: TestContext): Promise<void> {
  process.env['FAKE_CLAUDE_DELAY_MS'] = '4000';
  t.after(() => { delete process.env['FAKE_CLAUDE_DELAY_MS']; });
  const { run, str, until, open, api } = await lab(t);
  const { id } = await api('/api/hunts', { seed: 'busy' });
  await open(`#/hunt/${String(id)}`);
  await run(`document.querySelector('.tabs a[href$="/graveyard"]').focus()`);
  // The page polls every 2 s while it hunts. Its status changes when the hunt ends.
  await until(`!document.querySelector('.status .spin')`, 8000);
  assert.match(await str('document.activeElement.getAttribute("href")'), /\/graveyard$/);

  await open('#/stack');
  await until(`!!document.querySelector('[data-pick]')`);
  const pid = await str(`(() => { const b = document.querySelector('[data-pick]'); b.focus(); b.click(); return b.dataset.pick; })()`);
  await until(`document.querySelector('[data-pick="${pid}"]').getAttribute('aria-pressed') === 'true'`);
  assert.strictEqual(await str('document.activeElement.dataset.pick'), pid);
  assert.strictEqual(await str('document.activeElement.getAttribute("aria-pressed")'), 'true');
}

function registerPage(): void {
  void test('a double tap on "Hunt" makes 1 hunt', opts, doubleTap);
  void test('the toast timer stops on hover, focus and a hidden page, and continues with the time that it had left', opts, toastTimer);
  void test('a redraw keeps the keyboard focus: a poll of a busy hunt, and a pick on the stack', opts, keepsFocus);
}

registerPage();
