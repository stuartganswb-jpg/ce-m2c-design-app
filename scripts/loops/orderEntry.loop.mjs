// THE ORDER ENTRY ROUTE, END TO END — a tab-7 order (no rows, no CPQ job) as QuickShipTab saves it, started by RTG's
// automatic run (runOeAuto), then read by the SO Pack. Same classifier, doors, pair writer and pack readers as a
// 10.5 row: the floor is the same whatever door the order came through (Stuart 2026-09-23 / 09-27).
//   node --import ./scripts/loops/register.mjs scripts/loops/orderEntry.loop.mjs
import { __fs } from './fake-firestore.mjs';
const { runOeAuto, oeInventoryOf } = await import('../../src/components/Shared/oeGenerate.js');
const { soPackLineStateOf, packLinesOf, soLineIsFee } = await import('../../src/components/Shared/pickLines.js');

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { if (c) pass++; else { fail++; console.log(`✗ ${n}${d ? `\n    ${d}` : ''}`); } };
const eq = (n, got, want) => ok(n, JSON.stringify(got) === JSON.stringify(want), `got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`);

const BRAND = 'ce';
const P = (code, name, specs = {}, more = {}) => ({ id: `lib-${code}`, legacyErpId: code, itemId: code, itemName: name, brandId: BRAND, partClass: 'Inventory', netSuiteInternalId: String(5000 + code.length), manufacturingSpecs: { isInHouse: true, ...specs }, ...more });
const library = [
    P('H1-75SR', '3/4" Square Rod', { productType: 'POLE', isInHouse: false, vendorName: 'Metals USA' }),
    P('H1-1R', '1" Round Rod', { productType: 'RODS', isInHouse: false, vendorName: 'Metals USA', stockUnit: 'FT' }),
    P('H1-1BF', 'Ball Finial'), P('H1-1BF/EP2', 'Ball Finial Polished Nickel', {}, { partClass: 'Assembly' }),
    P('CE-FEE-BEND', 'Bend Fee', { productType: 'FEE' }, { partClass: 'Fee' }),
    P('CE-FEE-RUSH', 'Rush Fee', { productType: 'FEE' }, { partClass: 'Fee' }),
    P('HTTENDSTOP', 'End Stop', { partHandling: 'Small Parts' }),
    P('H1-2TRVCLP', 'Traverse Clip', { partHandling: 'Small Parts' }),
];
const stock = { 'H1-75SR': { available: 1000, unit: 'FOOT' }, 'H1-1R': { available: 500, unit: 'FOOT' }, 'H1-1BF/EP2': { available: 60, unit: 'EACH' }, 'HTTENDSTOP': { available: 400, unit: 'EACH' }, 'H1-2TRVCLP': { available: 100, unit: 'EACH' } };
const inList = (q) => ((q.match(/IN \(([^)]*)\)/g) || []).pop() || '').replace(/^IN \(|\)$/g, '').split(',').map(s => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
globalThis.__NS = async ({ payload }) => {
    const q = String((payload && payload.q) || '');
    if (/AggregateItemLocation/i.test(q)) return { items: inList(q).filter(c => stock[c]).map(c => ({ itemid: c, unitname: stock[c].unit, available: stock[c].available, onorder: 0 })) };
    if (/FROM TransactionLine tl/i.test(q)) return { items: [] };
    if (/PurchOrd/.test(q)) return { items: [] };
    return undefined;
};

// Tab 7's lines[] (QuickShipTab.pushToNetSuite): base item + finish beside it; fees as plain lines (no flag).
const lines = [
    { erp: 'H1-75SR', name: '3/4" Square Rod', qty: 50, toBeFinished: true, finishCode: 'P24', cutLength: 90, note: 'TO BE FINISHED · P24' },
    { erp: 'H1-1R', name: '1" Round Rod', qty: 10, perFoot: true, feetPer: 8, billedFeet: 80, toBeFinished: true, finishCode: 'P24', note: 'TO BE FINISHED · P24' },  // per-foot, blank cut
    { erp: 'H1-1BF', name: 'Ball Finial', qty: 50, toBeFinished: true, finishCode: 'EP2', finishOutsourced: true, note: 'TO BE FINISHED · EP2' },
    { erp: 'CE-FEE-BEND', name: 'Bend Fee', qty: 50 },
    { erp: 'CE-FEE-RUSH', name: 'Rush Fee', qty: 1 },
    { erp: 'HTTENDSTOP', name: 'End Stop', qty: 100 },
    { erp: 'H1-2TRVCLP', name: 'Traverse Clip', qty: 10, trvComponent: true, trvOfKit: 'K1', kit: 'H1-2TRV-KIT' },
];
__fs.reset();
library.forEach(p => __fs.seed('Approved_Designs', p.id, p));
__fs.seed('hq_sales_orders', 'OE-1', { id: 'OE-1', soId: 'SO70001', brand: BRAND, orderClass: 'QUICKSHIP', customer: 'Test Co', customerId: 'C1', nsInternalId: '8801', status: 'Pending', createdAt: 1, lines });
const logs = [];
await runOeAuto({ so: { id: 'OE-1', ...__fs.get('hq_sales_orders', 'OE-1') }, brand: BRAND, user: 'rtg-auto', inventory: oeInventoryOf(library, BRAND), log: (m) => logs.push(m) });
const so = { id: 'OE-1', ...__fs.get('hq_sales_orders', 'OE-1') };
const hq = __fs.all('hq_work_orders');
const gen = (i) => (so.oeGen || {})[i] || null;
const pair = hq.find(h => h.routeTo === 'FINISHING' && h.finishGroup === 'P24');
const shop = pair && hq.find(h => h.id === pair.shopWoId);

eq('both rods are ONE P24 shop job with the bend fee riding', (shop?.cutList || []).map(c => [c.legacyErpId, c.cutLength || null, c.feetPer || null, !!c.rider]), [['H1-75SR', 90, null, false], ['H1-1R', null, 8, false], ['CE-FEE-BEND', null, null, true]]);
eq('…the plater/shop counts: 60 poles, 375 + 80 = 455 ft, 1 rider', [shop?.poles, shop?.feet, shop?.riderLines], [60, 455, 1]);
eq('the plated finial on the shelf is a SO Pack pick, no work order', gen(2)?.kind, 'STOCK');
eq('the bend fee is covered by the pair (rider)', [gen(3)?.kind, gen(3)?.rider], ['WO', true]);
eq('the rush fee is billing only — nothing raised', gen(4), null);
eq('stocked lines and the traverse clip are never started', [gen(5), gen(6)], [null, null]);
const libFee = (c) => { const p = library.find(x => x.legacyErpId === c); return !!p && p.partClass === 'Fee'; };
eq('SO Pack: fees are never picked (no flag — the library says Fee)', [soLineIsFee(so, so.lines[3], 3, libFee), soLineIsFee(so, so.lines[4], 4, libFee)], [true, true]);
eq('SO Pack: the traverse clip and the end stop are shelf picks', [soPackLineStateOf({ so, line: so.lines[6], idx: 6, stat: { avail: 100 }, isFeeCode: libFee }).state, soPackLineStateOf({ so, line: so.lines[5], idx: 5, stat: { avail: 400 }, isFeeCode: libFee }).state], ['READY', 'READY']);
ok('the pack bench lists no fee', !packLinesOf(so, { isFeeCode: libFee }).some(l => /FEE/.test(l.erp)));
eq('the pack bench names the finished pieces', packLinesOf(so, { isFeeCode: libFee }).map(l => l.erp).slice(0, 3), ['H1-75SR/P24', 'H1-1R/P24', 'H1-1BF/EP2']);

if (globalThis.__NS_UNANSWERED) console.log('⚠ unanswered NetSuite calls:', globalThis.__NS_UNANSWERED.map(b => String(b.payload?.q || b.targetUrl).slice(0, 80)));
if (fail) console.log('\n--- route log ---\n' + logs.join('\n'));
console.log(`orderEntry loop: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
