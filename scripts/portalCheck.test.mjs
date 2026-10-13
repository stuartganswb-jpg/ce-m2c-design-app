// Shared/portalCheck — does the portal's server work a configuration out as HQ does (PORTAL, step 3).
//   node scripts/portalCheck.test.mjs
// The server's side is the real module (functions/portalSession.js over a copy of the engine made as the deploy
// makes it), answering in the shape the Cloud Function portalConfigCheck answers in.
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mirrorPlan, writeMirror } from './sync-engine.mjs';
import { checkStatesOf, mineOf, compareCheck, checkSummary } from '../src/components/Shared/portalCheck.js';
import { ASSEMBLY, PINS } from './hardwareAutoPicks.fixture.mjs';

const P = createRequire(import.meta.url)('../functions/portalSession.js');
let pass = 0, fail = 0;
const eq = (n, got, want) => { const g = JSON.stringify(got), w = JSON.stringify(want); if (g === w) { pass++; return; } fail++; console.log(`✗ ${n}\n    got  ${String(g).slice(0, 300)}\n    want ${String(w).slice(0, 300)}`); };
const ok = (n, c) => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}`); };

const tmp = mkdtempSync(join(tmpdir(), 'portal-check-'));
writeMirror(mirrorPlan().plan, join(tmp, 'engine'));
const engine = await P.loadEngine(join(tmp, 'engine'));

const codes = [...new Map(PINS.map(pn => [pn.partId, pn.legacyErpId || pn.partName])).entries()];
const records = [...codes.map(([id, code], i) => ({ id, itemId: id, legacyErpId: code, itemName: `Item ${code}`, partClass: 'Inventory', brandId: 'ce', manufacturingSpecs: { basePrice: 5 + i, fabricut: { cost: 3 + i, wholesale: 9 + i, retail: 18 + i } } })),
    { id: 'X-JNR', itemId: 'X-JNR', legacyErpId: 'H1-2JNR', itemName: 'Joiner', partClass: 'Inventory', brandId: 'ce', manufacturingSpecs: { basePrice: 20, customData: { unfinished: true } } },
    { ...ASSEMBLY, id: 'ASM-TRV', itemId: 'ASM-TRV', itemName: 'H1 2" Traverse', partClass: 'Assembly', brandId: 'ce' }];
const flow = { id: 'FLOW-TRV', name: 'H1 2" Traverse', brandId: 'ce', linkedAssemblyId: 'ASM-TRV', spliceOverInches: 120, extraItems: [{ code: 'H1-2JNR', label: 'Joiner' }], flowFinishes: [] };
const FIN = [{ id: 'F-LBR', code: 'LBR', name: 'Brass', material: 'BRASS' }, { id: 'F-P14', code: 'P14', name: 'Matte Black', material: 'METAL' }, { id: 'F-S04', code: 'S04', name: 'Oak', material: 'WOOD' }];
const customer = { id: 'CUST-FAB', name: 'FABRICUT', brandId: 'ce', portalPriceLevel: 'FAB_RETAIL' };
const pins = PINS.map(pn => ({ ...pn, assemblyId: 'ASM-TRV' }));
// the server's world, and HQ's own — built the way each side builds it (CPQ's mount passes the lists it holds)
const serverWorld = P.worldFor(engine, { flow, records, pins, finishes: FIN, outsourceFinishes: [], spanDoc: null, trvRules: null, customer, customerId: customer.id });
const hq = { assembly: records.find(r => r.id === 'ASM-TRV'), pins, parts: records, kits: [], finishes: FIN, outsourceCodes: [], flow, spanMap: {}, spanCaps: {}, extraItems: flow.extraItems, flowFinishes: [], trvRules: null, customer, customerId: customer.id };
// portalConfigCheck's answer for a list of states (functions/index.js), from the same module it calls
const serverAnswers = (world, states) => states.map((raw) => {
    const finishCodes = new Set(P.portalFinishesOf(engine, world).map(f => String(f.code || f.name || '').trim().toUpperCase()));
    try { const req = P.requestLineOf(engine, world, P.stateFromClient(raw, { finishCodes }), { level: 'STANDARD' });
        return req.item ? { level: String(req.item.priceLevel || ''), total: req.total, picks: Object.keys(req.item.engineConfig.picks || {}).length, rows: req.item.pricingBreakdown.map(l => [String(l.legacyErpId || ''), Number(l.qty) || 0, Number(l.price) || 0, Number(l.total) || 0]) } : { refusal: req.refusal.kind };
    } catch (e) { return { error: String(e.message).slice(0, 200) }; }
});

const states = checkStatesOf(hq, { max: 40 });
ok(`the configurations asked cover every framing, two ways through the parts each (${states.length})`, states.length >= 8 && states.length <= 40 && states.every(s => Object.keys(s.picks).length > 0));
eq('…in a paint and a stain the flow offers — never another material\'s finish — at a length under and over the one-piece limit', [[...new Set(states.map(s => JSON.stringify(s.globalFinishes)))], [...new Set(states.map(s => s.lengthInches))].sort()], [['{"METAL":"P14","WOOD":"S04"}'], [150, 96]]);
ok('…and nothing in them that a customer cannot say', states.every(s => JSON.stringify(Object.keys(s).sort()) === JSON.stringify(['answers', 'globalFinishes', 'lengthInches', 'picks', 'qty'])));
const mine = states.map(s => mineOf(hq, s));
const theirs = serverAnswers(serverWorld, states);
const report = compareCheck(mine, theirs);
eq('the same records on both sides: every configuration agrees — lines row for row, refusals for the same reason', [report.asked, report.same, report.differ], [states.length, states.length, []]);
ok('…at the customer\'s own level, with lines among them', report.lines > 4 && mine.filter(m => !m.refusal).every(m => m.level === 'FAB_COST'));
// a server that reads something else is CAUGHT, and told apart
const cheaper = P.worldFor(engine, { flow, records: records.map((r, i) => (i === 3 ? { ...r, manufacturingSpecs: { ...r.manufacturingSpecs, fabricut: { ...r.manufacturingSpecs.fabricut, cost: 0.5 } } } : r)), pins, finishes: FIN, outsourceFinishes: [], customer, customerId: customer.id });
const r2 = compareCheck(mine, serverAnswers(cheaper, states));
ok('a price that differs on the server is named: which configuration, which row, both prices', r2.differ.length > 0 && r2.same === states.length - r2.differ.length && (/first difference: HQ .* at \$\d/.test(r2.differ[0].why) || /the total/.test(r2.differ[0].why)));
const fewerPins = P.worldFor(engine, { flow, records, pins: pins.slice(0, Math.floor(pins.length / 2)), finishes: FIN, outsourceFinishes: [], customer, customerId: customer.id });
ok('pins the server did not read: named', compareCheck(mine, serverAnswers(fewerPins, states)).differ.length > 0);
const otherLevel = P.worldFor(engine, { flow, records, pins, finishes: FIN, outsourceFinishes: [], customer: { ...customer, name: 'Somebody else' }, customerId: customer.id });
ok('another customer\'s level on the server: named as the level', compareCheck(mine, serverAnswers(otherLevel, states)).differ.some(d => /price level: HQ FAB_COST, the server STANDARD/.test(d.why)));
eq('no answer, a stopped server, a refusal on one side only — each said', compareCheck([{ refusal: 'BARE_WOOD' }, { level: 'A', total: 1, rows: [] }, { level: 'A', total: 1, rows: [] }, { refusal: 'BARE_WOOD' }], [{ level: 'A', total: 1, rows: [] }, { error: 'boom' }]).differ.map(d => d.why),
    ['HQ refuses (BARE_WOOD), the server builds a line', 'the server stopped: boom', 'the server gave no answer', 'the server gave no answer']);
const w = { assembly: 'ASM-TRV', pins: pins.length, parts: records.length, finishes: 3, chart: false };
const good = checkSummary({ flowName: 'H1 2" Traverse', customerName: 'FABRICUT', report, world: { ...w, customer: 'FABRICUT' }, mineWorld: w, server: engine.stamp, engineVersion: engine.stamp.engineVersion });
ok('the operator is told in one screen: agrees, how many, both read the same, the same engine', /^Portal server check — H1 2" Traverse, as FABRICUT/.test(good) && /✓ The server builds what HQ builds/.test(good) && /Both read the same/.test(good) && /Same engine on both sides/.test(good));
const badSummary = checkSummary({ flowName: 'F', report: r2, world: { ...w, parts: 7 }, mineWorld: w, server: { engineVersion: 'older' }, engineVersion: 'newer' });
ok('…or: how many differ and why, what each side read, and that the server is behind', /DIFFER/.test(badSummary) && /HQ: +\d+ pins/.test(badSummary) && /server: +\d+ pins · 7 library records/.test(badSummary) && /DIFFERENT ENGINES: HQ runs newer, the portal's server runs older/.test(badSummary) && /with no customer/.test(badSummary));

rmSync(tmp, { recursive: true, force: true });
console.log(fail ? `\n❌  ${pass} passed, ${fail} failed` : `\n✅  ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
