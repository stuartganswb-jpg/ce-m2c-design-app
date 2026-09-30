// node scripts/assemblyBuild.test.mjs — stock an assembly the way NetSuite makes one (Stuart 2026-09-30: "the proper
// way to put these in stock is with an assembly build").
import { buildablePartsOf, buildPreviewOf, buildMemoOf, buildRowError } from '../src/components/Shared/assemblyBuild.js';
let pass = 0, fail = 0;
const eq = (n, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) pass++; else { fail++; console.log(`✗ ${n}\n   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`); } };

const lib = [
    { id: 'a', legacyErpId: 'H1-TTB1', itemName: 'Table Top Base 1', partClass: 'Assembly', netSuiteInternalId: '66367' },
    { id: 'b', legacyErpId: 'H1-1BF/EP2', itemName: 'Ball Finial EP2', partClass: 'Assembly', netSuiteInternalId: '56407' },
    { id: 'c', legacyErpId: 'H1-1BF', itemName: 'Ball Finial', partClass: 'Inventory', netSuiteInternalId: '100' },
    { id: 'd', legacyErpId: 'H1-OLD/EP2', itemName: 'Old', partClass: 'Assembly', netSuiteInternalId: '5', isRetired: true },
    { id: 'e', legacyErpId: 'H1-NOID', itemName: 'No id', partClass: 'Assembly' },
    { id: 'f', legacyErpId: 'H1-TTB1-C1', itemName: 'Base plate', partClass: 'Inventory', netSuiteInternalId: '700' },
    { id: 'g', legacyErpId: 'H1-TTB1-C2', itemName: 'Post', partClass: 'Inventory', netSuiteInternalId: '701' },
];
eq('buildable: Assembly class with a NetSuite id, not retired, matching the search', [buildablePartsOf(lib).map(p => p.legacyErpId), buildablePartsOf(lib, 'ttb').map(p => p.legacyErpId), buildablePartsOf(lib, 'finial').map(p => p.legacyErpId)],
    [['H1-TTB1', 'H1-1BF/EP2'], ['H1-TTB1'], ['H1-1BF/EP2']]);

// NetSuite's CHECK for 15 × H1-TTB1: two components, one charge line with no bin, one short.
const diag = [
    { line: 0, item: 700, qtyUsed: 15, useBinId: 91, srcOnhand: 40, detailed: true },
    { line: 1, item: 701, qtyUsed: 30, useBinId: 92, srcOnhand: 12, detailed: true },
    { line: 2, item: 999, qtyUsed: 15, detailed: false, cancelled: true },       // a charge line NetSuite cancels
    { line: 3, item: 998, qtyUsed: 15, detailed: false },                         // a line with no bin at all
];
const byNs = (id) => lib.find(p => String(p.netSuiteInternalId) === String(id)) || null;
const bins = { 'H1-TTB1-C1': [{ id: '91', name: 'M E5R-N1-R1', qty: 40 }], 'H1-TTB1-C2': [{ id: '92', name: 'RAW', qty: 12 }] };
eq('the review: what NetSuite will consume, from which bin, and what cannot be covered', buildPreviewOf({ diag, findByNsId: byNs, binsByCode: bins }), [
    { code: 'H1-TTB1-C1', name: 'Base plate', qty: 15, bin: 'M E5R-N1-R1', onHand: 40, ok: true, why: '' },
    { code: 'H1-TTB1-C2', name: 'Post', qty: 30, bin: 'RAW', onHand: 12, ok: false, why: 'only 12 in that bin' },
    { code: 'NetSuite item 998', name: '', qty: 15, bin: '—', onHand: null, ok: true, why: '' },
]);
eq('a component NetSuite found no stock of is named, never passed', buildPreviewOf({ diag: [{ item: 700, qtyUsed: 5, detailed: true, srcOnhand: null }], findByNsId: byNs }).map(r => [r.ok, r.why, r.bin]), [[false, 'no stock of it at this location', 'no stock found']]);
eq('a line NetSuite refused carries its words', buildPreviewOf({ diag: [{ item: 700, qtyUsed: 5, useBinId: 91, srcOnhand: 50, error: 'You cannot create an inventory detail for this item.' }], findByNsId: byNs, binsByCode: bins }).map(r => [r.ok, r.why]), [[false, 'You cannot create an inventory detail for this item.']]);
eq('the memo says who built it and the note', [buildMemoOf({ by: 'Andrea', note: ' for SO60551 ' }), buildMemoOf({ by: 'Andrea' })], ['Assembly build by Andrea — for SO60551', 'Assembly build by Andrea']);
eq('a row needs a whole number above 0 and a bin', [buildRowError({ qty: 15, toBin: 'RAW' }), buildRowError({ qty: 0, toBin: 'RAW' }), buildRowError({ qty: 2.5, toBin: 'RAW' }), buildRowError({ qty: 15, toBin: ' ' })],
    ['', 'enter how many to build (a whole number)', 'enter how many to build (a whole number)', 'scan the bin the built pieces go into']);

console.log(`assemblyBuild: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
