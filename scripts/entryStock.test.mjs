// 🧪 Stock, said the moment a line is picked (Stuart 2026-10-20).   node scripts/entryStock.test.mjs
import { entryStockAsksOf, entryStockLinesOf } from '../src/components/Shared/entryStock.js';
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}`); };
const eq = (n, a, b) => ok(`${n} — got ${JSON.stringify(a)}`, JSON.stringify(a) === JSON.stringify(b));

eq('a stocked item asks as itself', entryStockAsksOf({ mode: 'STOCKED', code: 'h1-1be/ep4', qty: 2 }), [{ code: 'H1-1BE/EP4', need: 2 }]);
eq('a part to be plated asks as its finished item', entryStockAsksOf({ mode: 'TO_BE_FINISHED', code: 'H1-1BE', qty: 3, finish: 'EP4', plated: true }), [{ code: 'H1-1BE/EP4', need: 3 }]);
eq('a part to be PAINTED is not asked — made on the floor, as today', entryStockAsksOf({ mode: 'TO_BE_FINISHED', code: 'H1-1BE', qty: 3, finish: 'P16', plated: false }), []);
eq('a plated POLE is made, then plated — not asked', entryStockAsksOf({ mode: 'TO_BE_FINISHED', code: 'H1-1R', qty: 2, finish: 'EP4', plated: true, pole: true }), []);
eq('no finish yet, nothing asked', entryStockAsksOf({ mode: 'TO_BE_FINISHED', code: 'H1-1BE', plated: true }), []);
const kit = [{ erp: 'H1-2RCTAECC', qty: 2, finishCode: 'EP3', toBeFinished: true }, { erp: 'H1-2RCTACEC', qty: 2, noFinish: true }];
eq('a plated kit asks for each part — in the finish, or as itself when it wears nothing (PO 682688)', entryStockAsksOf({ mode: 'TO_BE_FINISHED', code: 'H1-2RCTAEC', qty: 2, finish: 'EP3', plated: true, kitParts: kit }), [{ code: 'H1-2RCTAECC/EP3', need: 2 }, { code: 'H1-2RCTACEC', need: 2 }]);
eq('…a PAINTED kit keeps today\'s route', entryStockAsksOf({ mode: 'TO_BE_FINISHED', code: 'H1-2RCTAEC', qty: 2, finish: 'P16', plated: false, kitParts: kit }), []);

const rows = entryStockLinesOf([{ code: 'H1-1BE/EP4', need: 3 }, { code: 'H1-2RCTAECC/EP3', need: 2 }, { code: 'H1-NEW', need: 1 }], { 'H1-1BE/EP4': { available: 6 }, 'H1-2RCTAECC/EP3': { available: 1 } });
eq('covered, short, and not listed (reads 0)', rows.map(r => [r.covered, r.available]), [[true, 6], [false, 1], [false, 0]]);
eq('the words', rows.map(r => r.words), ['H1-1BE/EP4 · 6 available — 3 pulled from stock', 'H1-2RCTAECC/EP3 · 1 available of 2 — short 1: goes on the Backorder board (12.5)', 'H1-NEW · 0 available of 1 — short 1: goes on the Backorder board (12.5)']);
eq('a failed read is said, never "short"', entryStockLinesOf([{ code: 'X', need: 1 }], null, { failed: true }).map(r => [r.known, r.covered, /could not be read/.test(r.words)]), [[false, false, true]]);

console.log(`entryStock: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
