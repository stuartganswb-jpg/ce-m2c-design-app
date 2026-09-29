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

// ── A TAB-7 TRAVERSE KIT (Stuart 2026-09-27): QuickShipTab explodes the kit (Shared/traverseExplode) and shapes each
//    consumed part for the floor with CPQ's rules (Shared/subFinish.traverseOrderLinesOf) — an 8 ft manual wood
//    single in S04: the fascia cut at 96", the track (the library's H1-2TRV) at 95.5" in TCP, the bracket the
//    stocked champagne item ──
{
    const { explodeTraverse } = await import('../../src/components/Shared/traverseExplode.js');
    const { traverseOrderLinesOf } = await import('../../src/components/Shared/subFinish.js');
    const T = (code, name, specs = {}, more = {}) => ({ id: `t-${code}`, legacyErpId: code, itemId: code, itemName: name, brandId: BRAND, partClass: 'Inventory', netSuiteInternalId: String(7000 + code.length), manufacturingSpecs: { isInHouse: true, ...specs }, ...more });
    const trvLib = [
        T('H1-2RCTWR', '2" x 3/4" Rectangular Rod Wood Mill', { productType: 'Pole', partHandling: 'Custom', material: 'Wood', isInHouse: false, vendorName: 'Oak Supply' }),
        T('H1-2RCTWR-O', '2" x 3/4" Rectangular Oak Rod', { productType: 'Pole', partHandling: 'Custom', material: 'Wood', isInHouse: false, vendorName: 'Oak Supply' }),
        T('H1-2TRV', '1.5" Square Traverse Track', { productType: 'Pole', partHandling: 'Custom' }),
        T('H1-2TRVCLP', 'F-Clip Hanger for 1.5" Square Traverse Track', { productType: 'Pole', partHandling: 'Custom' }),
        T('H1-2TRV-WB', 'Traverse Wall Bracket', { productType: 'BRACKET', partHandling: 'Small Parts', usesSubFinish: true }, { partClass: 'Kit' }),
        T('H1-2TRV-WB/C', 'Traverse Wall Bracket - Champagne', { productType: 'Bracket', partHandling: 'Small Parts' }, { partClass: 'Assembly' }),
        T('H1-2TRVPLUG', 'End Plug', { productType: 'Component', partHandling: 'Small Parts' }, { partClass: 'Assembly' }),
    ];
    Object.assign(stock, { 'H1-2RCTWR-O': { available: 300, unit: 'FOOT' }, 'H1-2TRV': { available: 300, unit: 'FOOT' }, 'H1-2TRVCLP': { available: 300, unit: 'FOOT' }, 'H1-2TRV-WB/C': { available: 40, unit: 'EACH' }, 'H1-2TRVPLUG': { available: 400, unit: 'EACH' } });
    const finishes = [{ code: 'S04', subFinishCode: 'TCP', bomSuffix: 'OAK' }, { code: 'TCP', isSubFinish: true }];
    const byCode = (c) => trvLib.find(p => p.legacyErpId === String(c).toUpperCase()) || null;
    // tab 7's resolveComponent: the exact code, else the base with the suffix carried
    const resolve = (code) => { const x = byCode(code); if (x) return { part: x, suffix: '' }; const m = String(code).match(/^(.+)\/([A-Za-z0-9]+)$/); return m && byCode(m[1]) ? { part: byCode(m[1]), suffix: m[2].toUpperCase() } : { part: null, suffix: '' }; };
    const align = { setup: 'SINGLE', material: 'W', drive: 'MANUAL', minFeet: 4, mount: 'WALL' };
    const ex = explodeTraverse({ family: 'H1-2TRV', align, feet: 8, proj: '3.625', rules: null });
    const shaped = traverseOrderLinesOf({ exploded: ex.lines, family: 'H1-2TRV', finish: 'S04', feet: 8, drive: 'MANUAL', finishes, resolve });
    const tLines = shaped.filter(c => c.part).map(c => ({ erp: c.consumeCode, name: c.part.itemName, qty: c.qty, trvComponent: true, trvOfKit: 'K1', ...(c.floor || {}) }));
    eq('tab 7 consumes the OAK fascia, the library\'s track, its F-clip, the champagne bracket and the plugs', tLines.map(l => l.erp), ['H1-2RCTWR-O', 'H1-2TRV', 'H1-2TRVCLP', 'H1-2TRV-WB/C', 'H1-2TRVPLUG']);
    const fc = tLines.find(l => l.erp === 'H1-2TRVCLP');
    eq('…the F-clip: by the foot like the track (8 ft), cut 95" (manual −1"), finished TCP → H1-2TRVCLP/C', [fc.qty, fc.billedFeet, fc.cutLength, fc.finishCode, shaped.find(c => c.consumeCode === 'H1-2TRVCLP').finishedCode], [1, 8, 95, 'TCP', 'H1-2TRVCLP/C']);
    const tr = tLines.find(l => l.erp === 'H1-2TRV');
    eq('…the track: 1 piece of 8 ft, cut 95.5", finished TCP → H1-2TRVTRK/C', [tr.qty, tr.billedFeet, tr.cutLength, tr.finishCode, shaped.find(c => c.consumeCode === 'H1-2TRV').finishedCode], [1, 8, 95.5, 'TCP', 'H1-2TRVTRK/C']);
    __fs.seed('hq_sales_orders', 'OE-2', { id: 'OE-2', soId: 'SO70002', brand: BRAND, orderClass: 'QUICKSHIP', customer: 'Test Co', customerId: 'C1', nsInternalId: '8802', status: 'Pending', createdAt: 1, lines: tLines });
    trvLib.forEach(p => __fs.seed('Approved_Designs', p.id, p));
    const logs2 = [];
    await runOeAuto({ so: { id: 'OE-2', ...__fs.get('hq_sales_orders', 'OE-2') }, brand: BRAND, user: 'rtg-auto', inventory: oeInventoryOf([...library, ...trvLib], BRAND), finishes, log: (m) => logs2.push(m) });
    const so2 = { id: 'OE-2', ...__fs.get('hq_sales_orders', 'OE-2') };
    const hq2 = __fs.all('hq_work_orders').filter(h => h.soAppId === 'OE-2');
    const g2 = (erp) => (so2.oeGen || {})[so2.lines.findIndex(l => l.erp === erp)] || null;
    const tcp = hq2.find(h => h.routeTo === 'SHOP' && h.finishGroup === 'TCP');
    eq('the track and its F-clip are the TCP shop job at 95.5" / 95"', (tcp?.cutList || []).map(c => [c.legacyErpId, c.cutLength, c.finishedCode]), [['H1-2TRV', 95.5, 'H1-2TRVTRK/C'], ['H1-2TRVCLP', 95, 'H1-2TRVCLP/C']]);
    ok('the S04 fascia is started (CPQ\'s rule: a straight wood rod is finishing\'s)', !!hq2.find(h => h.routeTo === 'FINISHING' && h.finishGroup === 'S04'), hq2.map(h => `${h.routeTo}/${h.finishGroup}`).join(', ') + ' | ' + logs2.join(' | '));
    // THE SHELF FIRST FOR A STOCK COLOUR (Stuart 2026-09-28): the start reads the champagne bracket's shelf — 40 on hand
    // covers 2 — and records it a SHELF PICK: no work order, no paint. The plugs are an ordinary stocked line, untouched.
    eq('the champagne bracket: the shelf covers it — a shelf pick (STOCK), not painted; the plugs untouched', [g2('H1-2TRV-WB/C') && g2('H1-2TRV-WB/C').kind, g2('H1-2TRV-WB/C') && g2('H1-2TRV-WB/C').code, g2('H1-2TRVPLUG')], ['STOCK', 'H1-2TRV-WB/C', null]);
    // …and when the shelf does NOT cover it (60 wanted, 40 on hand): the whole line is painted TCP from its /P.
    {
        const wbp = T('H1-2TRV-WB/P', 'Traverse Wall Bracket - Phosphate', { productType: 'Bracket', partHandling: 'Small Parts' }, { partClass: 'Assembly' });
        __fs.seed('Approved_Designs', wbp.id, wbp);
        Object.assign(stock, { 'H1-2TRV-WB/P': { available: 100, unit: 'EACH' } });
        __fs.seed('hq_sales_orders', 'OE-2B', { id: 'OE-2B', soId: 'SO70012', brand: BRAND, orderClass: 'QUICKSHIP', customer: 'Test Co', customerId: 'C1', nsInternalId: '8812', status: 'Pending', createdAt: 1,
            lines: [{ erp: 'H1-2TRV-WB/C', name: 'Traverse Wall Bracket - Champagne', qty: 60 }] });
        const logs2b = [];
        await runOeAuto({ so: { id: 'OE-2B', ...__fs.get('hq_sales_orders', 'OE-2B') }, brand: BRAND, user: 'rtg-auto', inventory: oeInventoryOf([...library, ...trvLib, wbp], BRAND), finishes, log: (m) => logs2b.push(m) });
        const so2b = __fs.get('hq_sales_orders', 'OE-2B');
        const fin2b = __fs.all('hq_work_orders').filter(h => h.soAppId === 'OE-2B' && h.routeTo === 'FINISHING');
        eq('short on the shelf: a TCP finishing pair painting 60 from the /P — no shelf pick', [(so2b.oeGen || {})[0] && so2b.oeGen[0].kind, fin2b.map(h => h.finishGroup), fin2b.flatMap(h => (h.partsList || []).map(l => [l.legacyErpId, l.quantity]))],
            ['WO', ['TCP'], [['H1-2TRV-WB/P', 60]]], logs2b.join(' | '));
    }
    const { soPackLineStateOf: sp } = await import('../../src/components/Shared/pickLines.js');
    const bi = so2.lines.findIndex(l => l.erp === 'H1-2TRV-WB/C');
    eq('SO Pack: the bracket is READY from the shelf; the track names H1-2TRVTRK/C', [sp({ so: so2, line: so2.lines[bi], idx: bi, stat: { avail: 40 } }).state, sp({ so: so2, line: so2.lines[1], idx: 1, stat: null }).code], ['READY', 'H1-2TRVTRK/C']);
}

// ── TAB 7, SAME RULES AS CPQ AND 10.5 (Stuart 2026-09-28): an item tagged Unfinished is entered CUT ONLY — the
//    clear acrylic rod at 12" — and a standoff (Unfinished) as an ordinary stocked line ──
{
    const A = (code, name, specs = {}, more = {}) => ({ id: `a-${code}`, legacyErpId: code, itemId: code, itemName: name, brandId: BRAND, partClass: 'Inventory', netSuiteInternalId: String(8000 + code.length), manufacturingSpecs: { isInHouse: true, ...specs }, ...more });
    const aLib = [
        A('H1-2RCTACR', '2" x 3/4" Rectangular Acrylic Pole', { productType: 'POLE', partHandling: 'Custom', isInHouse: false, vendorName: 'ARLINEA', uom: 'FT', customData: { unfinished: true } }),
        A('H1-1STDOFF', 'Standoff', { productType: 'Component', partHandling: 'Small Parts', customData: { unfinished: true } }, { partClass: 'Assembly' }),
    ];
    Object.assign(stock, { 'H1-2RCTACR': { available: 100, unit: 'FOOT' }, 'H1-1STDOFF': { available: 300, unit: 'EACH' } });
    aLib.forEach(p => __fs.seed('Approved_Designs', p.id, p));
    // what QuickShipTab's cut-only add writes (noFinish, no finish, not to be finished) and a stocked line
    const aLines = [
        { erp: 'H1-2RCTACR', name: 'Acrylic Pole', qty: 20, perFoot: true, feetPer: 1, billedFeet: 20, cutLength: 12, noFinish: true, note: 'CUT ONLY · UNFINISHED · Cut 12" (billed 1 ft)' },
        { erp: 'H1-1STDOFF', name: 'Standoff', qty: 40 },
    ];
    __fs.seed('hq_sales_orders', 'OE-3', { id: 'OE-3', soId: 'SO70003', brand: BRAND, orderClass: 'QUICKSHIP', customer: 'Test Co', customerId: 'C1', nsInternalId: '8803', status: 'Pending', createdAt: 1, lines: aLines });
    const logs3 = [];
    await runOeAuto({ so: { id: 'OE-3', ...__fs.get('hq_sales_orders', 'OE-3') }, brand: BRAND, user: 'rtg-auto', inventory: oeInventoryOf([...library, ...aLib], BRAND), finishes: [], log: (m) => logs3.push(m) });
    const so3 = { id: 'OE-3', ...__fs.get('hq_sales_orders', 'OE-3') };
    const hq3 = __fs.all('hq_work_orders').filter(h => h.soAppId === 'OE-3');
    const sh3 = hq3.find(h => h.routeTo === 'SHOP'); const fh3 = hq3.find(h => h.routeTo === 'FINISHING');
    eq('tab 7: the acrylic is an UNFINISHED shop cut at 12" — the same as a 10.5 row', [sh3?.finishGroup, (sh3?.cutList || []).map(c => [c.legacyErpId, c.cutLength])], ['UNFINISHED', [['H1-2RCTACR', 12]]], );
    eq('…its finishing half is pick-only (never on the finishing floor)', [fh3?.finPayload?.pickOnly, fh3?.finPayload?.finishingRequired], [true, false]);
    eq('the standoff is never started — a shelf pick', (so3.oeGen || {})[1] || null, null);
    const { soPackLineStateOf: sp3 } = await import('../../src/components/Shared/pickLines.js');
    eq('SO Pack: the acrylic comes from the floor, the standoff from the shelf', [sp3({ so: so3, line: so3.lines[0], idx: 0, stat: { avail: 100 } }).state, sp3({ so: so3, line: so3.lines[1], idx: 1, stat: { avail: 300 } }).state], ['FROM THE FLOOR', 'READY']);
    if (!sh3) console.log(logs3.join('\n'));
}

// ── A LINE TAKEN OFF THE ORDER IS NEVER STARTED (2026-09-29, SO60551's second Base Back 1 end cap) ──
{
    const { oeLinePlansOf, oeStartsLine } = await import('../../src/components/Shared/oeGenerate.js');
    const offSo = { id: 'SO-OFF', soId: 'SO-OFF', lines: [
        { erp: 'H1-1BF', finishCode: 'EP2', toBeFinished: true, finishOutsourced: true, qty: 10 },
        { erp: 'H1-1BF', finishCode: 'EP2', toBeFinished: true, finishOutsourced: true, qty: 0, offOrder: true },
    ] };
    const plans = oeLinePlansOf({ so: offSo, inventory: library, finishes: [] });
    const byIdx = (i) => plans.find(p => p.lineIdx === i);
    eq('off the order: billing only, never started — its twin on the order still is', [!!(byIdx(1) && byIdx(1).billingOnly), oeStartsLine(byIdx(1)), oeStartsLine(byIdx(0))], [true, false, true]);
}

if (globalThis.__NS_UNANSWERED) console.log('⚠ unanswered NetSuite calls:', globalThis.__NS_UNANSWERED.map(b => String(b.payload?.q || b.targetUrl).slice(0, 80)));
if (fail) console.log('\n--- route log ---\n' + logs.join('\n'));
console.log(`orderEntry loop: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
