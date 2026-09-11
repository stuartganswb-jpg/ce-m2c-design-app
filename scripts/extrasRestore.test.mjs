// Harness for Shared/extrasRestore — hand-added extras restored without multiplying
// (Stuart 2026-09-11, S1: "QUO147 has one splice entered on cpq but shows 3").
//
//   node scripts/extrasRestore.test.mjs
//
// The loop: saved line carries no extras → reopen rebuilds them from addedByHand rows keyed by
// DOC ID → the length step looks for the joiner by its tab-11 CODE, misses, auto-adds one more →
// re-save → one more row every cycle. QUO147 = three $6 joiners after two cycles.

import { mergeExtras, extrasFromSavedItem, normalizeExtras } from '../src/components/Shared/extrasRestore.js';

let pass = 0, fail = 0;
const eq = (name, got, want) => { const g = JSON.stringify(got), w = JSON.stringify(want); if (g === w) { pass++; return; } fail++; console.log(`✗ ${name}\n    got  ${g}\n    want ${w}`); };

// ── mergeExtras ──────────────────────────────────────────────────────────────────────────────
eq('three rows of one code merge to one row of 3', mergeExtras([{ code: 'A', qty: '1' }, { code: 'A', qty: 1 }, { code: 'a', qty: '1' }]), [{ code: 'A', qty: '3', note: '' }]);
eq('a slot keeps its own row (per-track fees)', mergeExtras([{ code: 'F', qty: '1', slot: 'T1' }, { code: 'F', qty: '1', slot: 'T2' }, { code: 'F', qty: '1', slot: 'T1' }]), [{ code: 'F', qty: '2', note: '', slot: 'T1' }, { code: 'F', qty: '1', note: '', slot: 'T2' }]);
eq('the first note survives a merge', mergeExtras([{ code: 'A', qty: '1', note: '' }, { code: 'A', qty: '1', note: '36" from left' }]), [{ code: 'A', qty: '2', note: '36" from left' }]);
eq('blank rows dropped, qty ≤ 0 counts as 1', mergeExtras([{ code: '', qty: '4' }, null, { code: 'B', qty: '0' }]), [{ code: 'B', qty: '1', note: '' }]);

// ── extrasFromSavedItem ──────────────────────────────────────────────────────────────────────
// QUO147 as saved: no engineConfig.extras, three addedByHand joiner rows by doc id
const quo147 = { engineConfig: { picks: {} }, pricingBreakdown: [
    { name: 'Rod', partId: 'CE-INV-1', qty: 1 },
    { name: 'Joiner', partId: 'CE-INV-57732', legacyErpId: 'H1-138JNR', qty: 1, addedByHand: true },
    { name: 'Joiner', partId: 'CE-INV-57732', legacyErpId: 'H1-138JNR', qty: 1, addedByHand: true },
    { name: 'Joiner', partId: 'CE-INV-57732', legacyErpId: 'H1-138JNR', qty: 1, addedByHand: true, customNote: 'center' },
] };
eq('a legacy triple reopens as ONE row of 3 under OUR number', extrasFromSavedItem(quo147), [{ code: 'H1-138JNR', qty: '3', note: 'center' }]);
eq('a line that carries its extras reopens exactly as typed (the rows are ignored)', extrasFromSavedItem({ engineConfig: { extras: [{ code: 'H1-138JNR', qty: '1', note: 'at 72"' }] }, pricingBreakdown: quo147.pricingBreakdown }), [{ code: 'H1-138JNR', qty: '1', note: 'at 72"' }]);
eq('a saved slot-scoped fee keeps its slot', extrasFromSavedItem({ engineConfig: { extras: [{ code: 'CE-FEE-PM', qty: '1', slot: 'track_1' }] } }), [{ code: 'CE-FEE-PM', qty: '1', note: '', slot: 'track_1' }]);
eq('no extras anywhere → []', extrasFromSavedItem({ engineConfig: {}, pricingBreakdown: [{ name: 'Rod', partId: 'X', qty: 1 }] }), []);
eq('a row with no legacyErpId falls back to partId', extrasFromSavedItem({ pricingBreakdown: [{ partId: 'CE-INV-9', qty: 2, addedByHand: true }] }), [{ code: 'CE-INV-9', qty: '2', note: '' }]);

// ── normalizeExtras (inside the configurator) ────────────────────────────────────────────────
const lib = { 'H1-138JNR': { id: 'CE-INV-57732' }, 'CE-INV-57732': { id: 'CE-INV-57732' }, 'H1-138WEC': { id: 'CE-INV-2' } };
const findPart = (c) => lib[String(c || '').toUpperCase()] || null;
const extraItems = [{ code: 'H1-138JNR', step: '' }, { code: 'H1-138WEC', step: 'End' }];
eq('a doc-id row is re-keyed to the flow\'s code for the same part', normalizeExtras([{ code: 'CE-INV-57732', qty: '1', note: '' }], extraItems, findPart), [{ code: 'H1-138JNR', qty: '1', note: '' }]);
eq('THE LOOP, CLOSED: doc-id row + auto-added code row = one row of 2, not two rows', normalizeExtras([{ code: 'CE-INV-57732', qty: '1' }, { code: 'H1-138JNR', qty: '1' }], extraItems, findPart), [{ code: 'H1-138JNR', qty: '2', note: '' }]);
eq('a code the flow does not offer is kept as is', normalizeExtras([{ code: 'ODD-1', qty: '1' }], extraItems, findPart), [{ code: 'ODD-1', qty: '1', note: '' }]);
eq('case-insensitive direct match wins without a lookup', normalizeExtras([{ code: 'h1-138wec', qty: '2' }], extraItems, () => null), [{ code: 'H1-138WEC', qty: '2', note: '' }]);
eq('no extraItems → rows untouched but merged', normalizeExtras([{ code: 'A', qty: '1' }, { code: 'A', qty: '1' }], [], findPart), [{ code: 'A', qty: '2', note: '' }]);

console.log(`\nextrasRestore: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
