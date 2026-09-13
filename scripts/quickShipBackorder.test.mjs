// Harness for Shared/quickShipBackorder — an Order Entry order carries its true backorders through
// the SAME planner and definition RTG's split uses (STATE #17, close-out item 4; S1 2026-09-13).
//
//   node scripts/quickShipBackorder.test.mjs

import { quickShipPullLines, quickShipCoverCodes, quickShipBackorderLines } from '../src/components/Shared/quickShipBackorder.js';
import { planSmallLines } from '../src/components/Shared/splitPlan.js';

let pass = 0, fail = 0;
const eq = (name, got, want) => { const g = JSON.stringify(got), w = JSON.stringify(want); if (g === w) { pass++; return; } fail++; console.log(`✗ ${name}\n    got  ${g}\n    want ${w}`); };
const ok = (name, cond) => { if (cond) { pass++; return; } fail++; console.log(`✗ ${name}`); };

// tab 7's priced lines as the push sees them
const lines = [
    { erp: 'H1-1CP-V/EP4', name: 'Plated bracket', eachQty: 4, qty: 4 },                         // plated stocked good
    { erp: 'HCUMR15/BS', name: 'Ring', eachQty: 14, qty: 2, packUom: '7 PACK' },                 // sold by the pack, pulled as eaches
    { erp: 'HCUMP610', name: '6ft pole', eachQty: 12, qty: 2, perFoot: true, feetPer: 6 },        // per foot: pulled as PIECES
    { erp: 'HCUMB410', name: 'Raw bracket', eachQty: 6, qty: 6, toBeFinished: true, finishCode: 'CP' },   // made to order, painted
    { erp: 'HCUFN1', name: 'Finial to plate', eachQty: 2, qty: 2, toBeFinished: true, finishCode: 'EP4', finishOutsourced: true },
    { erp: '', name: 'blank', eachQty: 1 },
    { erp: 'ZERO', name: 'zero qty', eachQty: 0 },
];
const trvDocLines = [
    { kind: 'KIT', code: 'H1-2TRV-4/P', qty: 1 },
    { kind: 'PART', code: 'H1-2TRVCLP', name: 'F-clip', qty: 3 },
    { kind: 'FEET', code: 'H1-2TRV-FT', qty: 2 },
];

// ── the shape handed to the split ────────────────────────────────────────────────────────────
const pull = quickShipPullLines(lines, trvDocLines);
eq('every real line, in the split\'s shape; blank and zero dropped; kit + feet rows skipped, PART rows kept',
    pull.map(l => [l.legacyErpId, l.qty, !!l.finishOutsourced, !!l.trvComponent]),
    [['H1-1CP-V/EP4', 4, false, false], ['HCUMR15/BS', 14, false, false], ['HCUMP610', 2, false, false], ['HCUMB410', 6, false, false], ['HCUFN1', 2, true, false], ['H1-2TRVCLP', 3, false, true]]);
eq('cover codes: plated = the code; painted = code, /P, mill; unique', quickShipCoverCodes(pull, 'CP').sort(),
    ['H1-1CP-V/EP4', 'H1-2TRVCLP', 'H1-2TRVCLP/P', 'HCUFN1', 'HCUMB410', 'HCUMB410/P', 'HCUMP610', 'HCUMP610/P', 'HCUMR15', 'HCUMR15/BS', 'HCUMR15/P'].sort());

// ── the records, from the ONE planner ────────────────────────────────────────────────────────
const map = {
    'H1-1CP-V/EP4': { available: 1, onOrder: 12, unit: 'EA' },                                   // 4 wanted, 1 on hand → 3 short (plated)
    'HCUMR15/BS': { available: 0, onOrder: 0, unit: 'EA' }, 'HCUMR15/P': { available: 20, onOrder: 0, unit: 'EA' }, 'HCUMR15': { available: 0, onOrder: 0, unit: 'EA' },   // /P covers 14
    'HCUMP610': { available: 0, onOrder: 0, unit: 'EA' }, 'HCUMP610/P': { available: 0, onOrder: 0, unit: 'EA' },   // nothing → painted backorder of 2 pieces
    'HCUMB410': { available: 0, onOrder: 50, unit: 'EA' }, 'HCUMB410/P': { available: 0, onOrder: 0, unit: 'EA' }, 'HCUMB410/CP': { available: 0, onOrder: 0, unit: 'EA' },  // raw on order, none on hand
    'HCUFN1': { available: 5, onOrder: 0, unit: 'EA' },                                            // plated-to-order: the raw is there
    // H1-2TRVCLP has no row → unknown, never a backorder
};
const bo = quickShipBackorderLines(pull, 'CP', { map, unitsKnown: true }, { since: 777 });
eq('the shorts, and only the shorts', bo.map(b => [b.code, b.kind, b.qty, b.wanted]).sort(),
    [['H1-1CP-V/EP4', 'plated', 3, 4], ['HCUMB410', 'painted', 6, 6], ['HCUMP610', 'painted', 2, 2]].sort());
ok('a covered /P ring is not on the list', !bo.some(b => b.code === 'HCUMR15/BS'));
ok('the plated-to-order finial with raw on hand is not on the list', !bo.some(b => b.code === 'HCUFN1'));
ok('an unreadable component is unknown, not a backorder', !bo.some(b => b.code === 'H1-2TRVCLP'));
ok('records carry since, cover codes and on-order for the board', bo.every(b => b.since === 777 && b.coverCodes.length >= 1 && typeof b.onOrder === 'number'));
eq('byte-identical to what RTG\'s split would write for the same lines', bo, planSmallLines(pull, 'CP', { map, unitsKnown: true }, { since: 777 }).backorder);

// ── no read, no claim ────────────────────────────────────────────────────────────────────────
eq('stock not read → nothing claimed', quickShipBackorderLines(pull, 'CP', null), []);
eq('units unknown → painted lines claim nothing (the split\'s rule)', quickShipBackorderLines(pull, 'CP', { map, unitsKnown: false }).map(b => b.code), ['H1-1CP-V/EP4'].filter(() => false));
eq('empty order → []', quickShipBackorderLines([], 'CP', { map, unitsKnown: true }), []);

console.log(`\nquickShipBackorder: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
