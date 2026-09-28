// node scripts/cpqJobFacts.test.mjs — ONE BUILDER FOR THE SHOP'S FACTS FROM A CPQ JOB (Stuart 2026-09-27): the CPQ
// split and RTG's shop release for a row pair write the same cut sheet, notes and drawing.
import { jobFabFactsOf, cutSheetMissingOf, jobDrawingOf, shopReleaseFieldsOf } from '../src/components/Shared/cpqJobFacts.js';
let pass = 0, fail = 0;
const eq = (n, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) pass++; else { fail++; console.log(`✗ ${n}\n   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`); } };
const job = { customer: { id: 'C1', name: 'FABRICUT' }, engineeringNotes: { shape: 'L', qtyMiters: 2, pole1: 40, svgString: '<svg/>' }, cpqData: { cartItems: [{ generalNotes: ['watch the return'], bracketNotes: [{ note: 'center bracket' }] }], breakdown: [{ isHeader: true, name: '▶ Config' }, { name: 'Rod', qty: 2 }] } };
const f = jobFabFactsOf(job);
eq('the cut sheet, method and notes the split stamps', [f.fabNotes.shape, f.fabNotes.qtyMiters, f.fabNotes.pole1, f.fabMethod, f.visionNotes, f.bracketNotes.length, f.visionUsed], ['L', 2, 40, 'MITER', ['watch the return'], 1, true]);
eq('no cut sheet flagged only when a cut pole has none', [cutSheetMissingOf(job, [{ cutLength: 30 }]), cutSheetMissingOf({ engineeringNotes: {} }, [{ cutLength: 30 }]), cutSheetMissingOf({ engineeringNotes: {} }, [{}])], [false, true, false]);
eq('the drawing: CRM svg first, then the job\'s own', [jobDrawingOf(job, 'https://x/y.svg'), /^data:image\/svg/.test(jobDrawingOf(job))], ['https://x/y.svg', true]);
const pair = { id: 'W-C', source: 'ORDER_ENTRY', itemName: 'Row 2 · S04 · 2 pole lines + 2 riding', totalParts: 100, customer: 'FABRICUT', customerId: 'C1', cutList: [{ name: 'Oak fascia', legacyErpId: 'H1-2RCTWR-O', qty: 50, cutLength: 30 }, { name: 'Miter', legacyErpId: 'H1-2TRVMTR', qty: 50, rider: true }], poles: 50, feet: 125, billableFeet: 125, riderLines: 1, rowLabel: 'Row 2', finishGroup: 'S04' };
const r = shopReleaseFieldsOf({ hqOrder: pair, originalJob: job });
eq('a row pair names itself and lists its own cut list as its spec', [r.item, Object.keys(r.cpqSpecs)], ['Row 2 · S04 · 2 pole lines + 2 riding', ['Oak fascia', 'Miter (rides the pole)']]);
eq('…and carries the job\'s cut sheet and drawing, as the CPQ split does', [r.fabMethod, !!r.fabNotes, /^data:image/.test(r.imageUrl), r.customerId, r.rowLabel], ['MITER', true, true, 'C1', 'Row 2']);
const stock = shopReleaseFieldsOf({ hqOrder: { id: 'WO1', source: 'STOCK_VIEW', rootItem: 'H1-75R', totalParts: 20 }, originalJob: null });
eq('a stock build is unchanged: no fab facts, its item', [stock.item, 'fabNotes' in stock, stock.qty], ['H1-75R', false, 20]);
// A ROW PAIR WITH RIDERS names its shop document for the pole, as the CPQ split does (partNum, 2026-09-28 — SO60551 ROW 1).
const riders = shopReleaseFieldsOf({ hqOrder: { id: 'WO-OE-SO60551-1234', source: 'ORDER_ENTRY', rootItem: '', variantErpId: '', itemName: 'ROW 1 · EP4 · 1 pole line + 2 riding', totalParts: 50,
    cutList: [{ legacyErpId: 'H1-1R', qty: 50, cutLength: 16.75 }, { legacyErpId: 'H1-FRPF', qty: 50, rider: true }, { legacyErpId: 'H1-FRPF', qty: 50, rider: true }] }, originalJob: null });
eq('a pole with two French return riders: partNum is the pole, the name stays the row\'s', [riders.partNum, riders.item], ['H1-1R', 'ROW 1 · EP4 · 1 pole line + 2 riding']);
console.log(`cpqJobFacts: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
