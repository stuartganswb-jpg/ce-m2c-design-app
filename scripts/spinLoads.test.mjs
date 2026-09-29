// The spin machine runs in loads — every step of the recipe per load (Stuart 2026-09-29).   node scripts/spinLoads.test.mjs
import { smallPartsTotalOf, runsInLoads, spinLoadsOf, spinLoadQtyError, spinLoadRollover, spinFinalLoadRecord } from '../src/components/Shared/spinLoads.js';
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}`); };
const eq = (n, a, b) => ok(`${n} — got ${JSON.stringify(a)}`, JSON.stringify(a) === JSON.stringify(b));

// ── what runs in loads ──────────────────────────────────────────────────────────────────────
const job = { totalParts: 420, sprayStation: 'SPIN' };
eq('a small-parts job counts all its pieces', smallPartsTotalOf(job), 420);
eq('a mixed job counts only its small parts', smallPartsTotalOf({ totalParts: 430, totalPoles: 10 }), 420);
ok('the spin machine runs in loads', runsInLoads(job));
ok('unchosen reads the spin machine — it runs in loads too', runsInLoads({ totalParts: 420 }));
ok('the booth never does', !runsInLoads({ ...job, sprayStation: 'BOOTH' }));
ok('a pole-only job never does', !runsInLoads({ totalParts: 20, totalPoles: 20, sprayStation: 'SPIN' }));
ok('nothing to load, no loads', !runsInLoads({ totalParts: 0 }) && !runsInLoads(null));

// ── nobody types: one load of everything — how every job ran before ─────────────────────────
let s = spinLoadsOf(job);
eq('untyped = all 420 in load 1, the last', [s.n, s.qty, s.typed, s.last, s.done, s.remaining], [1, 420, false, true, 0, 420]);
eq('…so the last coat finishes the job, as it always did', spinLoadRollover(job), null);

// ── Stuart's 420 at 140 a load ──────────────────────────────────────────────────────────────
let wo = { ...job, spinLoadQty: 140 };
s = spinLoadsOf(wo);
eq('typed 140: load 1 of 140, not the last', [s.n, s.qty, s.typed, s.last], [1, 140, true, false]);
let r = spinLoadRollover(wo, { by: 'Rafa', at: 1 });
eq('the last coat of load 1 loops the recipe: load 1 recorded, 140 next, 280 after this one', [r.record, r.nextQty, r.after, r.n], [{ n: 1, qty: 140, doneAt: 1, by: 'Rafa' }, 140, 280, 1]);
wo = { ...wo, spinLoads: r.loads, spinLoadQty: r.nextQty };
s = spinLoadsOf(wo);
eq('load 2: 140 of 420 done', [s.n, s.qty, s.done, s.remaining, s.last], [2, 140, 140, 280, false]);
r = spinLoadRollover(wo, { by: 'Rafa', at: 2 });
wo = { ...wo, spinLoads: r.loads, spinLoadQty: r.nextQty };
s = spinLoadsOf(wo);
eq('load 3 is the last — 140 left', [s.n, s.qty, s.done, s.remaining, s.last], [3, 140, 280, 140, true]);
eq('the last coat of the last load does not loop — the job finishes (QC, Complete)', spinLoadRollover(wo), null);
eq('…and its load is recorded with the completion', spinFinalLoadRecord(wo, { by: 'Grace', at: 3 }).loads.map(l => [l.n, l.qty]), [[1, 140], [2, 140], [3, 140]]);

// ── "expected to fit 70 but only 35 fit" ────────────────────────────────────────────────────
wo = { totalParts: 420, spinLoadQty: 70, spinLoads: [{ n: 1, qty: 70 }] };
eq('a 35 typed mid-job is load 2', (() => { const x = spinLoadsOf({ ...wo, spinLoadQty: 35 }); return [x.n, x.qty, x.done, x.remaining]; })(), [2, 35, 70, 350]);
r = spinLoadRollover({ ...wo, spinLoadQty: 35 }, { at: 9 });
eq('…the next load keeps 35 until someone types again', [r.nextQty, r.after], [35, 315]);
// the tail load: 50 left, 140 typed → the load is the 50
wo = { totalParts: 330, spinLoadQty: 140, spinLoads: [{ n: 1, qty: 140 }, { n: 2, qty: 140 }] };
s = spinLoadsOf(wo);
eq('a typed size bigger than what is left runs what is left, as the last load', [s.qty, s.last], [50, true]);
r = spinLoadRollover({ totalParts: 330, spinLoadQty: 140, spinLoads: [{ n: 1, qty: 140 }] });
eq('the size carried forward is capped at what is left', [r.nextQty, r.after], [50, 50]);

// ── the typed size is checked ───────────────────────────────────────────────────────────────
wo = { totalParts: 420, spinLoads: [{ n: 1, qty: 140 }] };
eq('a sane size passes', spinLoadQtyError(wo, '35'), null);
ok('blank / zero / not a number refused', !!spinLoadQtyError(wo, '') && !!spinLoadQtyError(wo, '0') && !!spinLoadQtyError(wo, '3.5') && !!spinLoadQtyError(wo, 'abc'));
ok('more than is left refused, naming what is left', /Only 280 of 420 are left/.test(spinLoadQtyError(wo, '300') || ''));

// ── moved to the booth part-way: the rest runs in one pass ───────────────────────────────────
wo = { totalParts: 420, sprayStation: 'BOOTH', spinLoadQty: 140, spinLoads: [{ n: 1, qty: 140 }] };
eq('on the booth the last coat finishes the job', spinLoadRollover(wo), null);
eq('…and writes no load record', spinFinalLoadRecord(wo), null);

console.log(`spinLoads: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
