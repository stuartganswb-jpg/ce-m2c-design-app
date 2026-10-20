// Shared/portalRequestLines (what the customer's Orders & Quotes card and the CRM's Docs print for a portal request) and its CJS mirror
// functions/portalRequestLines.js (the server's copy — Cloud Functions cannot import src/). The two must print the same rows for every
// request; a Quick Ship request prints its own lines (2026-10-20 — it printed one bare "▶ Configuration" per line).
// Run: node scripts/portalRequestLines.test.mjs
import { createRequire } from 'node:module';
import { portalRequestLines, printsFromRequest } from '../src/components/Shared/portalRequestLines.js';
const require = createRequire(import.meta.url);
const mirror = require('../functions/portalRequestLines.js');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.log(`✗ ${name} ${extra}`); } };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `\n   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`);

// ── requests of every kind ──
const flow = { steps: [{ id: 'S1', title: 'Rod', styleOptions: [{ optId: 'O1', partName: '1" Rod' }] }, { id: 'S2', title: 'Finish', allowedOptions: ['FIN-1'] }] };
const finishes = [{ id: 'FIN-1', name: 'Oil Rubbed Bronze', code: 'P01', clientMapping: [{ customerId: 'FABRICUT', clientFinishName: 'Antique Bronze' }] }];
const custNames = new Set(['FABRICUT']);
const stockLines = [
  { itemId: 'a', erp: 'H1-138R/P01', name: '1-3/8" Round Rod', aliasErp: '', qty: 2, packUom: '', packSize: 1, eachQty: 2, rate: 12.5, note: '' },
  { itemId: 'b', erp: 'CE-FEE-CUT', name: 'Pole cut service', aliasErp: '', qty: 2, packUom: '', packSize: 1, eachQty: 2, rate: 10, note: 'cut @ 84-1/2"', fee: true },
  { itemId: 'c', erp: 'H2-138RNG/CG', name: 'Ring for 1-3/8"', aliasErp: 'H1-138RNG/CG', qty: 3, packUom: 'PK', packSize: 7, eachQty: 21, rate: 4, note: '' },
  { itemId: 'd', erp: 'CE-FEE-CUT', name: 'Pole cut service', aliasErp: '', qty: 1, packUom: '', packSize: 1, eachQty: 1, rate: 10, note: 'cut' },   // sent before the fee flag
];
const kit = { kitId: 'K', kitCode: 'H1-2TRV-4M/P-60W', finish: 'P09', proj: '4.625', motorItem: 'HSOM-20', feet: 13, still: [], answerWords: ['Center draw', 'Motor left', '80% Ripplefold Carriers'],
  lines: [
    { itemId: 'K', erp: 'H1-2TRV-4M/P-60W', name: '2" MOTORIZED TRAVERSE SYSTEM', aliasErp: 'HMTS7501F', qty: 1, packSize: 1, eachQty: 1, rate: 995, note: '13ft system — 4ft set · P09 · 4-5/8" · HSOM-20' },
    { itemId: 'K', erp: 'H1-2TRV-4M/P-60W', name: '2" MOTORIZED TRAVERSE SYSTEM', aliasErp: 'HMTS7501F', qty: 9, packSize: 1, eachQty: 9, rate: 65, note: 'Additional foot · P09' },
    { itemId: 'E', erp: 'HTTENDSTOP', name: 'End Stopper', aliasErp: '', qty: 2, packSize: 1, eachQty: 2, rate: 0, note: 'included component · P09 [H1-2TRV-4M/P-60W]' },
  ] };
const kitStill = { ...kit, answerWords: [], still: ['draw direction', 'carrier style'], lines: kit.lines.slice(0, 1) };
const JOBS = {
  quickShip: { status: 'PORTAL_REQUEST', portalRequest: { kind: 'QUICKSHIP', collection: 'FABRICUT H1', lines: stockLines, total: 99, note: 'please rush' } },
  quickShipKits: { status: 'PORTAL_REQUEST', portalRequest: { kind: 'QUICKSHIP', collection: '', lines: [stockLines[0]], traverse: [kit, kitStill], total: 1700 } },
  kitOnly: { status: 'PORTAL_REQUEST', portalRequest: { kind: 'QUICKSHIP', lines: [], traverse: [kit] } },
  loaded: { status: 'QUICKSHIP_REVIEW', portalRequest: { kind: 'QUICKSHIP', lines: [stockLines[0]], loadedBy: 'Grace' } },
  config: { status: 'PORTAL_REQUEST', portalRequest: { kind: 'CONFIG', lines: [{ flowName: 'H1-138', lineTag: 'Den', notes: ['Fewer centre brackets than recommended'] }] },
    cpqData: { cartItems: [{ qty: 2, pricingBreakdown: [{ name: 'Rod', qty: 1, clientFinishName: 'Antique Bronze' }, { name: 'Standoff', qty: 2, hidden: true }] }] } },
  legacyMulti: { status: 'PORTAL_REQUEST', portalRequest: { lines: [{ flowId: 'F1', flowName: 'H1-1', lineTag: 'Bed', selections: { params: { S1: 'O1', S2: 'FIN-1' }, quantities: { S1: 1 } } }], addOns: [{ name: 'Rush', qty: 1 }], note: 'n' } },
  legacySingle: { status: 'PORTAL_REQUEST', portalRequest: { selections: { params: { S1: 'O1' } } } },
  priced: { status: 'CONFIGURED', portalRequest: { kind: 'QUICKSHIP', lines: [] }, cpqData: { breakdown: [{ name: 'x' }] } },
  plainQuote: { status: 'CONFIGURED', cpqData: { breakdown: [{ name: 'x' }] } },
  pillowLoaded: { status: 'QUICKSHIP_REVIEW', pillowRequest: { lines: [] } },
};

// the two copies print the same rows for every request
Object.entries(JOBS).forEach(([k, job]) => {
  const a = portalRequestLines(job, flow, finishes, { custNames, flowById: { F1: flow } });
  const b = mirror.portalRequestLines(job, flow, finishes, { custNames, flowById: { F1: flow } });
  ok(`the server's copy prints what HQ's prints — ${k}`, JSON.stringify(a) === JSON.stringify(b), `\n   src ${JSON.stringify(a)}\n   cjs ${JSON.stringify(b)}`);
  ok(`…and asks the same "does it print from its request" — ${k}`, printsFromRequest(job) === mirror.printsFromRequest(job));
});

// a Quick Ship request prints what the customer built — never "Configuration"
eq('a stock request: its collection, each line by the code the counter showed, packs, the cut length — a fee by its description alone',
  portalRequestLines(JOBS.quickShip),
  [{ name: '▶ Quick Ship — FABRICUT H1', qty: 0, isHeader: true },
   { name: 'H1-138R/P01 — 1-3/8" Round Rod', qty: 2 },
   { name: 'Pole cut service · cut @ 84-1/2"', qty: 2 },
   { name: 'H1-138RNG/CG — Ring for 1-3/8" · PK of 7 (21 ea)', qty: 3 },
   { name: 'Pole cut service · cut', qty: 1 },
   { name: 'Note: please rush', qty: 0 }]);
eq('a request with kits: the stock block, then each kit by THEIR code — its lines, the track in words, what it still needs',
  portalRequestLines(JOBS.quickShipKits),
  [{ name: '▶ Quick Ship', qty: 0, isHeader: true },
   { name: 'H1-138R/P01 — 1-3/8" Round Rod', qty: 2 },
   { name: '▶ Traverse kit HMTS7501F', qty: 0, isHeader: true },
   { name: 'HMTS7501F — 2" MOTORIZED TRAVERSE SYSTEM · 13ft system — 4ft set · P09 · 4-5/8" · HSOM-20', qty: 1 },
   { name: 'HMTS7501F — 2" MOTORIZED TRAVERSE SYSTEM · Additional foot · P09', qty: 9 },
   { name: 'HTTENDSTOP — End Stopper · included component · P09 [H1-2TRV-4M/P-60W]', qty: 2 },
   { name: 'Track: Center draw · Motor left · 80% Ripplefold Carriers', qty: 0 },
   { name: '▶ Traverse kit HMTS7501F', qty: 0, isHeader: true },
   { name: 'HMTS7501F — 2" MOTORIZED TRAVERSE SYSTEM · 13ft system — 4ft set · P09 · 4-5/8" · HSOM-20', qty: 1 },
   { name: 'Still needed: draw direction · carrier style', qty: 0 }]);
eq('a kit-only request has no stock block', portalRequestLines(JOBS.kitOnly).map((r) => r.name).slice(0, 1), ['▶ Traverse kit HMTS7501F']);
ok('no Quick Ship row says "Configuration"', ['quickShip', 'quickShipKits', 'kitOnly', 'loaded'].every((k) => !portalRequestLines(JOBS[k]).some((r) => /Configuration/.test(r.name))));
ok('no fee prints its item code', ['quickShip'].every((k) => !portalRequestLines(JOBS[k]).some((r) => /CE-FEE-CUT/.test(r.name))));

// the other kinds print as they did
eq('a configured request (CONFIG) still prints its parts in the customer\'s finish words, hidden parts left out, its notes',
  portalRequestLines(JOBS.config),
  [{ name: '▶ H1-138 [Den] × 2', qty: 0, isHeader: true }, { name: 'Rod — Antique Bronze', qty: 1 }, { name: 'Note: Fewer centre brackets than recommended', qty: 0 }]);
eq('an older multi-line request still resolves its selections through its flow',
  portalRequestLines(JOBS.legacyMulti, null, finishes, { custNames, flowById: { F1: flow } }),
  [{ name: '▶ H1-1 [Bed]', qty: 0, isHeader: true }, { name: 'Rod: 1" Rod', qty: 1 }, { name: 'Finish: Antique Bronze', qty: 0 }, { name: 'Add-on: Rush', qty: 1 }, { name: 'Note: n', qty: 0 }]);

// which jobs print from their request's own record
ok('a request nobody priced prints from its record', printsFromRequest(JOBS.quickShip) && printsFromRequest(JOBS.config) && printsFromRequest(JOBS.legacySingle));
ok('a Quick Ship request loaded into tab 7 and not priced still prints from its record', printsFromRequest(JOBS.loaded));
eq('…and prints its lines', portalRequestLines(JOBS.loaded), [{ name: '▶ Quick Ship', qty: 0, isHeader: true }, { name: 'H1-138R/P01 — 1-3/8" Round Rod', qty: 2 }]);
ok('a priced job, a plain quote and a loaded pillow request do not', !printsFromRequest(JOBS.priced) && !printsFromRequest(JOBS.plainQuote) && !printsFromRequest(JOBS.pillowLoaded) && !printsFromRequest(null));

console.log(`portalRequestLines: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
