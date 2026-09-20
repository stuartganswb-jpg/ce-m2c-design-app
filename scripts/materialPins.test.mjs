// node scripts/materialPins.test.mjs — a BOM member the library does not hold is raw material (CRS by
// default): never a pull line (Stuart 2026-09-20, SO60583 — H1-75SPF planned as "70 × 55812").
import { planFinishedRun } from '../src/components/Shared/finishedGoodsRun.js';
let pass = 0, fail = 0;
const eq = (n, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) pass++; else { fail++; console.log(`✗ ${n}\n   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`); } };
const lib = [
    { id: 'A', itemId: 'A', legacyErpId: 'H1-75SPF', partClass: 'Assembly', netSuiteInternalId: '60001' },
    { id: 'B', itemId: 'B', legacyErpId: 'H1-75SPF/P', partClass: 'Assembly' },
    { id: 'C', itemId: 'C', legacyErpId: 'HCUROD', netSuiteInternalId: '777' },
    { id: 'D', itemId: 'D', legacyErpId: 'HCUCAP' },
];
const steel = { partId: '55812', defaultQty: 0.2, syncedFromErp: true };   // CR112SQ, by its bare NetSuite id
const pull = (p) => p.lines.map(l => [l.legacyErpId, l.quantity]);

// SO60583: a milled part whose only BOM member is the steel it is cut from.
const milled = planFinishedRun({ part: { legacyErpId: 'H1-75SPF/P06', itemName: 'Square finial' }, qty: 70, pins: [steel], inventory: lib });
eq('the steel is not a pull line; the part plans as itself, through its phosphated core', pull(milled), [['H1-75SPF/P', 70]]);
eq('…it is one milled part, not an exploded kit', milled.exploded, false);
eq('…and the material is named on the plan', milled.materials.map(m => m.code), ['55812']);

// A real assembly with real components AND a stick of steel: the parts stay, the steel goes.
const kit = planFinishedRun({ part: { legacyErpId: 'HCUMLB/CP' }, qty: 10, pins: [{ partId: '777', defaultQty: 1 }, { partId: 'D', defaultQty: 2 }, steel], inventory: lib });
eq('library components stay, resolved to their codes — BOM literal', pull(kit), [['HCUROD', 10], ['HCUCAP', 20]]);
eq('…still an exploded assembly', kit.exploded, true);

// No library handed in → nothing can be judged → the pins are read exactly as before.
eq('a caller with no inventory is untouched', pull(planFinishedRun({ part: { legacyErpId: 'X/P06' }, qty: 2, pins: [steel], inventory: [] })), [['55812', 2]]);
eq('…and names no materials', planFinishedRun({ part: { legacyErpId: 'X/P06' }, qty: 2, pins: [steel], inventory: [] }).materials, []);
console.log(`materialPins: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
