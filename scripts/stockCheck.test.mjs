// Unknown is unknown, not zero.   node scripts/stockCheck.test.mjs
import { stockCheckReport } from '../src/components/Shared/finishedGoodsRun.js';
let pass = 0, fail = 0;
const eq = (n, got, want) => { const g = JSON.stringify(got), w = JSON.stringify(want); if (g === w) { pass++; return; } fail++; console.log(`✗ ${n}\n    got  ${g}\n    want ${w}`); };
const lines = [{ legacyErpId: 'HCUSR1', quantity: 10 }, { legacyErpId: 'HCUBK1', quantity: 4 }, { legacyErpId: 'HCUFN1', quantity: 2 }];
const r = stockCheckReport(lines, { HCUSR1: 12, HCUBK1: 1 });
eq('known and enough → no short', [r.rows[0].have, r.rows[0].short, r.rows[0].known], [12, 0, true]);
eq('known and short → SHORT by the difference', [r.rows[1].have, r.rows[1].short], [1, 3]);
eq('no NetSuite row → unknown, have null, NOT short', [r.rows[2].have, r.rows[2].short, r.rows[2].unknown], [null, 0, true]);
eq('shortRows holds only the real shortage', r.shortRows.map(x => x.code), ['HCUBK1']);
eq('unknownRows names the unanswered code', r.unknownRows.map(x => x.code), ['HCUFN1']);
eq('ok is about shortages; warn is about unknowns', [r.ok, r.warn], [false, true]);
const clean = stockCheckReport(lines.slice(0, 1), { HCUSR1: 12 });
eq('all known, all covered → ok and no warning', [clean.ok, clean.warn], [true, false]);
eq('text says CHECK, not SHORT, for an unknown', /NO NETSUITE STOCK ROW/.test(r.text) && !/HCUFN1 — need 2, available 0/.test(r.text), true);
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
