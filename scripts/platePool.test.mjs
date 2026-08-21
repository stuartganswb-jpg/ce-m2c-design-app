// The plate pool, as the flow's options see it.
//   node scripts/platePool.test.mjs
//
// The bug this exists to prevent: the picker and the sweep disagreeing about what is on offer, so
// a plate is offered, chosen, read by the fabrication math, and then deleted for not belonging.

import { platePoolFrom, plateStillOffered } from '../src/components/Shared/platePool.js';

let pass = 0, fail = 0;
const eq = (n, got, want) => {
    const g = JSON.stringify(got), w = JSON.stringify(want);
    if (g === w) { pass++; return; }
    fail++; console.log(`✗ ${n}\n    got  ${g}\n    want ${w}`);
};
const ok = (n, c) => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}`); };
const ids = (pool) => pool.map(o => o.optId);

const RTN = { optId: 'p-rtn', returnOnly: true };
const INL = { optId: 'p-inl', inlineOnly: true };
const PLAIN = { optId: 'p-plain' };

// ── EACH ARM ASKS FOR ITS OWN FIRST ──────────────────────────────────────────────────────────
{
    const all = [RTN, INL, PLAIN];
    eq('a return takes the return plates', ids(platePoolFrom(all, { returnChosen: true })), ['p-rtn']);
    eq('an in-line arm takes the in-line plates', ids(platePoolFrom(all, { inlineBracket: true })), ['p-inl']);
    eq('anything else takes the plain ones', ids(platePoolFrom(all, {})), ['p-plain']);
}

// ── AND BORROWS ONLY WHERE ITS OWN SET DOES NOT EXIST ────────────────────────────────────────
{
    eq('a return with no return plates borrows the in-line ones',
        ids(platePoolFrom([INL, PLAIN], { returnChosen: true })), ['p-inl']);
    eq('…and with neither, the plain ones — a return always meets the wall',
        ids(platePoolFrom([PLAIN, { optId: 'x', inlineOnly: false, returnOnly: true, gone: true }].filter(o => !o.gone), { returnChosen: true })), ['p-plain']);
    eq('an in-line arm with no in-line copies borrows the return ones',
        ids(platePoolFrom([RTN, PLAIN], { inlineBracket: true })), ['p-rtn']);
    eq('…but is never handed a plain plate it does not sit on',
        ids(platePoolFrom([PLAIN, INL], { inlineBracket: true })), ['p-inl']);
}

// ── AN UNTAGGED COLLECTION HAS ONE POOL, AND IT IS ALL OF THEM ───────────────────────────────
{
    const plainOnly = [{ optId: 'a' }, { optId: 'b' }];
    eq('nothing tagged means nothing filtered', ids(platePoolFrom(plainOnly, { returnChosen: true })), ['a', 'b']);
}

// ── THE SIZE / PROJECTION GATE ───────────────────────────────────────────────────────────────
// Return plates exist only at their native diameter. When the gate kills them the pool must fall
// through — this is the exact case where the picker and the sweep had drifted apart.
{
    const all = [RTN, INL, PLAIN];
    const live = (o) => o.optId !== 'p-rtn';          // the return plate does not exist at this size
    const pool = platePoolFrom(all, { returnChosen: true }, live);
    eq('a size-gated return pool falls through rather than emptying', ids(pool), ['p-inl']);
    ok('and a plate that IS offered stays chosen', plateStillOffered(pool, INL));
    ok('while one that is not, does not', !plateStillOffered(pool, RTN));
    ok('nothing is "still offered" when nothing was chosen', !plateStillOffered(pool, null));
}

console.log(fail ? `\n❌  ${pass} passed, ${fail} failed` : `\n✅  ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
