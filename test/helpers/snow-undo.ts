// The owner's edits and the undo cases of the API tests.
import assert from 'node:assert';
import { createdHunt, lab, openGrill, plant, route, type Lab } from './snow-api.ts';

type Api = Pick<Lab, 'call' | 'until'>;

/** The owner leaves out a part, and buries and restores ideas. */
async function leaveOutAndBury({ call }: Api, id: number, partId: number, ids: { good: number; old: number }): Promise<void> {
  await call(route('components', partId), { out: true });
  let h = (await call(route('hunts', id))).body;
  assert.strictEqual(h.sources[1].components[0].bad_reason, 'left out by you');
  await call(route('components', partId), { out: false });
  h = (await call(route('hunts', id))).body;
  assert.strictEqual(h.sources[1].components[0].bad_reason, null);
  // An undo of "bring back" sends the earlier reason, so a part that a kill left out gets the reason of the kill back.
  await call(route('components', partId), { out: true, reason: 'Killme: hashes are too slow' });
  h = (await call(route('hunts', id))).body;
  assert.strictEqual(h.sources[1].components[0].bad_reason, 'Killme: hashes are too slow');
  await call(route('components', partId), { out: false });

  await call(route('snowmobiles', ids.good), { status: 'graveyard' });
  h = (await call(route('hunts', id))).body;
  assert.strictEqual(h.snowmobiles[0].status, 'graveyard');
  assert.strictEqual(h.snowmobiles[0].proof_note, 'Buried by you. Nothing close.');
  assert.strictEqual((await call(route('snowmobiles', ids.good), { status: 'graveyard' })).status, 409);
  await call(route('snowmobiles', ids.good), { status: 'survivor' });
  await call(route('snowmobiles', ids.old), { status: 'survivor' });
  h = (await call(route('hunts', id))).body;
  assert.deepStrictEqual(h.snowmobiles.slice(0, 3).map((s) => [s.status, s.proof_note]),
    [['survivor', 'Nothing close.'], ['survivor', ''], ['survivor', 'Same thing.']]);
}

/** The owner undoes a round, a kill and a brief. */
async function undoRounds({ call, until }: Api, id: number, ids: { good: number; weak: number }): Promise<void> {
  await until(route('grills', ids.weak), (b) => !b.pending);
  assert.strictEqual((await call(route('grills', ids.weak, 'undo'), {})).status, 409);
  await call(route('grills', ids.weak, 'answer'), { answers: { scope: { choice: 1 }, lang: { choice: 0 } } });
  let g = (await call(route('grills', ids.weak, 'undo'), {})).body;
  assert.strictEqual(g.status, 'open');
  assert.ok(g.tree.decisions.every((d) => !d.answer) && !g.tree.killed);
  let h = (await call(route('hunts', id))).body;
  assert.strictEqual(h.sources[0].components[0].bad_reason, null);
  assert.deepStrictEqual([h.snowmobiles[1].status, h.snowmobiles[1].proof_note], ['survivor', '']);

  await until(route('grills', ids.good), (b) => !b.pending);
  await call(route('grills', ids.good, 'answer'), { answers: { scope: { choice: 0 }, lang: { choice: 0 } } });
  await until(route('grills', ids.good), (b) => b.status === 'done');
  g = (await call(route('grills', ids.good, 'undo'), {})).body;
  assert.deepStrictEqual([g.status, g.brief, g.tree.decisions.filter((d) => !d.answer).length], ['open', null, 2]);
  h = (await call(route('hunts', id))).body;
  assert.strictEqual(h.snowmobiles[0].status, 'survivor');
}

export async function ownerEdits(): Promise<void> {
  const l = await lab();
  const { id, h } = await createdHunt(l);
  const part = h.sources[1].components[0];
  const [good, weak, old] = [h.snowmobiles[0].id, h.snowmobiles[1].id, h.snowmobiles[2].id];
  await leaveOutAndBury(l, id, part.id, { good, old });
  await undoRounds(l, id, { good, weak });
  l.server.close();
}

/** Two kills on one part, undone in the order of the kills and in the reverse order. */
async function undoMarks({ call, until }: Api, partId: number, good: number, weak: number, id: number): Promise<void> {
  const mark = async (): Promise<string | null> => (await call(route('hunts', id))).body.sources[0].components[0].bad_reason;
  const killOne = async (sm: number): Promise<void> => {
    await until(route('grills', sm), (b) => !b.pending);
    await call(route('grills', sm, 'answer'), { answers: { scope: { choice: 1 }, lang: { choice: 0 } } });
  };
  const killBoth = async (): Promise<void> => {
    await killOne(good);
    await killOne(weak);
    assert.match(await mark() ?? '', /^Killme: /);
  };

  // An undo in the order of the kills: the part keeps the mark of the kill that still stands, then has no mark.
  await killBoth();
  await call(route('grills', good, 'undo'), {});
  assert.match(await mark() ?? '', /^Killme: /);
  await call(route('grills', weak, 'undo'), {});
  assert.strictEqual(await mark(), null);

  // An undo in the reverse order on a part that you left out: the part gets back the standing mark, then your mark.
  await call(route('components', partId), { out: true });
  await killBoth();
  await call(route('grills', weak, 'undo'), {});
  assert.match(await mark() ?? '', /^Hashvisor: /);
  await call(route('grills', good, 'undo'), {});
  assert.strictEqual(await mark(), 'left out by you');

  // An undo in the order of the kills on a part that you left out: the part gets back your mark.
  await killBoth();
  await call(route('grills', good, 'undo'), {});
  await call(route('grills', weak, 'undo'), {});
  assert.strictEqual(await mark(), 'left out by you');

  // You bring the part back between 2 kills: an undo of the second kill keeps your bring-back.
  await killOne(good);
  await call(route('components', partId), { out: false });
  await killOne(weak);
  await call(route('grills', weak, 'undo'), {});
  assert.strictEqual(await mark(), null);
  await call(route('grills', good, 'undo'), {});
  assert.strictEqual(await mark(), null);
}

/** Burying an idea and restoring prior art are not undone by the undo of a round. */
async function undoNotes({ cfg, call }: Lab, id: number, old: { id: number; proof_note: string }): Promise<void> {
  // An idea that you bury while its grill is open stays buried after an undo of the grill round.
  const sm = plant(cfg.db, ['Buried']).ids[0];
  openGrill(cfg, sm, 'q', 'Q?', 'Yes');
  await call(route('snowmobiles', sm), { status: 'graveyard' });
  assert.strictEqual((await call(route('grills', sm, 'undo'), {})).status, 200);
  const buried = cfg.db.prepare(`SELECT status, proof_note FROM snowmobiles WHERE id = ?`).get(sm);
  assert.deepStrictEqual({ ...buried }, { status: 'graveyard', proof_note: 'Buried by you. ' });

  // An undo of a restore sends the earlier note, so prior art does not become an idea that you buried.
  await call(route('snowmobiles', old.id), { status: 'survivor' });
  await call(route('snowmobiles', old.id), { status: 'graveyard', proof_note: old.proof_note });
  const h = (await call(route('hunts', id))).body;
  assert.deepStrictEqual([h.snowmobiles[2].status, h.snowmobiles[2].proof_note], ['graveyard', 'Same thing.']);
}

export async function undoExact(): Promise<void> {
  const l = await lab();
  const { id, h } = await createdHunt(l);
  await undoMarks(l, h.sources[0].components[0].id, h.snowmobiles[0].id, h.snowmobiles[1].id, id);
  await undoNotes(l, id, h.snowmobiles[2]);
  l.server.close();
}
