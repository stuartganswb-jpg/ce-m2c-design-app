// THE ROW ROUTE, END TO END (Stuart 2026-09-27: "test the loops"). Runs the REAL 10.5 row start —
// rowLinesFromBreakdown → displayAnchorPatch → runOeAuto → buildOeReviewPlan → executeOeJobs → parkRowPair →
// releaseFinWoToFloor → the shop release — against the in-memory Firestore and a scripted NetSuite, on
// SO60551's ROW 1 and Row 2, and asserts what CPQ's own split does with the same lines.
//   node --import ./scripts/loops/register.mjs scripts/loops/rowRoute.loop.mjs
import * as F from './so60551.fixture.mjs';
import { __fs } from './fake-firestore.mjs';

const { rowLinesFromBreakdown, displayAnchorPatch, rowKeyOf, rowOfLine } = await import('../../src/components/Shared/displayRelease.js');
const { runOeAuto, oeInventoryOf } = await import('../../src/components/Shared/oeGenerate.js');

let pass = 0, fail = 0;
const ok = (n, c, detail = '') => { if (c) pass++; else { fail++; console.log(`✗ ${n}${detail ? `\n    ${detail}` : ''}`); } };
const eq = (n, got, want) => ok(n, JSON.stringify(got) === JSON.stringify(want), `got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`);

// ── scripted NetSuite ──
const inList = (q) => ((q.match(/IN \(([^)]*)\)/g) || []).pop() || '').replace(/^IN \(|\)$/g, '').split(',').map(s => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
const held = {};   // `${soNs}|${ITEM}` → qty NetSuite has committed to the order
globalThis.__NS = async ({ payload }) => {
    const q = String((payload && payload.q) || '');
    if (/AggregateItemLocation/i.test(q)) {
        return { items: inList(q).filter(c => F.stock[c]).map(c => ({ itemid: c, unitname: F.stock[c].unit, available: F.stock[c].available, onorder: 0 })) };
    }
    if (/FROM TransactionLine tl/i.test(q)) {
        const codes = inList(q);
        return { items: Object.entries(held).filter(([k]) => codes.includes(k.split('|')[1])).map(([k, v]) => ({ soid: k.split('|')[0], itemid: k.split('|')[1], held: v })) };
    }
    if (/PurchOrd/.test(q)) return { items: [] };
    return undefined;
};

// ── the order, as 10.5 anchors it from the CPQ job ──
__fs.reset();
F.library.forEach(p => __fs.seed('Approved_Designs', p.id, p));
__fs.seed('jobs', F.JOB_ID, F.job);
const lines = rowLinesFromBreakdown(F.breakdown);
__fs.seed('hq_sales_orders', F.SO_APP_ID, { ...F.salesOrder(lines), ...displayAnchorPatch({ buildId: 'BUILD-T', lines, so: F.salesOrder(lines) }) });
const inventory = oeInventoryOf(F.library, F.BRAND);
const logs = [];
for (const label of ['ROW 1', 'Row 2', 'base front 4']) {
    const so = __fs.get('hq_sales_orders', F.SO_APP_ID);
    const key = rowKeyOf(label);
    await runOeAuto({ so: { id: F.SO_APP_ID, ...so }, brand: F.BRAND, user: 'loop', inventory, log: (m) => logs.push(m),
        only: (line) => rowKeyOf(rowOfLine(line)) === key, slot: `displayRows.${key}`, force: true });
}
const so = __fs.get('hq_sales_orders', F.SO_APP_ID);
const hq = __fs.all('hq_work_orders');
const fin = __fs.all('fin_workorders');
const lineIdx = (erp, n = 0) => so.lines.map((l, i) => ({ l, i })).filter(x => x.l.erp === erp)[n]?.i;
const gen = (erp, n = 0) => (so.oeGen || {})[lineIdx(erp, n)] || null;
const bo = (so.backorderLines || []).map(b => b.code);
const pairOf = (rowLabel, finish) => hq.find(h => h.rowLabel === rowLabel && h.finishGroup === finish && h.routeTo === 'FINISHING');
const shopOf = (pair) => pair && hq.find(h => h.id === pair.shopWoId);

// ── ROW 1: the pole and its two French returns are ONE shop job; the plated fittings are stock-first ──
{
    const p = pairOf('ROW 1', 'EP4'); const s = shopOf(p);
    ok('ROW 1 · EP4 pair written', !!p && !!s, `pairs: ${hq.map(h => `${h.id}(${h.rowLabel}/${h.finishGroup}/${h.routeTo})`).join(', ')}`);
    eq('ROW 1 shop cut list = the pole + both French returns (riders, no cut)', (s?.cutList || []).map(c => [c.legacyErpId, c.qty, c.cutLength || null]), [['H1-1R', 50, 18], ['H1-FRPF', 50, null], ['H1-FRPF', 50, null]]);
    eq('…counted as 50 poles, 2 riders', [s?.poles, s?.riderLines], [50, 2]);
    ok('the French returns are never stock-checked or backordered', !bo.includes('H1-FRPF/EP4') && !bo.includes('H1-FRPF'), `backorders: ${bo.join(', ')}`);
    eq('the French returns are covered by the pair', [gen('H1-FRPF', 0)?.kind, gen('H1-FRPF', 1)?.kind], ['WO', 'WO']);
    eq('plated fittings in stock are SO Pack picks', [gen('H1-1CP-V')?.kind, gen('H1-1BR')?.kind], ['STOCK', 'STOCK']);
    ok('a plated fitting with none in stock is on the Backorder board', bo.includes('H1-1STDOFF/EP4'), `backorders: ${bo.join(', ')}`);
}
// ── Row 2: the stained fascia and the wood track (no finish on the quote → the row's rod finish S04) are ONE
//    S04 shop job with their miters riding; the plated wall bracket is stock-first; the rest is stocked ──
{
    const p = pairOf('Row 2', 'S04'); const s = shopOf(p);
    ok('Row 2 · S04 pair written', !!p && !!s, `pairs: ${hq.map(h => `${h.id}(${h.rowLabel}/${h.finishGroup}/${h.routeTo})`).join(', ')}`);
    eq('Row 2 shop cut list = fascia + track (poles) + both miters (riders)', (s?.cutList || []).map(c => [c.legacyErpId, c.cutLength || null]).sort(), [['H1-2RCTWR-O', 30], ['H1-2TRV', 30], ['H1-2TRVMTR', null], ['H1-2TRVMTR', null]].sort());
    eq('…recipe S04, not EP4', [s?.recipe, p?.recipe], ['S04', 'S04']);
    ok('no Row 2 wood goes to the finishing floor as a small part', !(p?.finPayload?.partsList || []).some(l => /RCTWR|2TRV$/.test(l.legacyErpId)));
    ok('the miters are never stock-checked or backordered', !bo.some(c => /TRVMTR/.test(c)), `backorders: ${bo.join(', ')}`);
    eq('the track is covered by the pair', gen('H1-2TRV')?.kind, 'WO');
    ok('the plated wall bracket with none in stock is on the Backorder board', bo.includes('H1-2TRV-WB/EP4'), `backorders: ${bo.join(', ')}`);
    eq('stocked hardware stays a shelf pick', [gen('H1-2TRVPLUG'), gen('HTSLNTCAR')], [null, null]);
    ok('no EP4 pair is written for Row 2 (the miters follow their rod)', !pairOf('Row 2', 'EP4'));
}
// ── base front 4: a bought rod read in FEET (50 × 84" = 350 ft of 430) and a painted finial with the customer's code ──
{
    const p = pairOf('base front 4', 'P30'); const s = shopOf(p);
    ok('base front 4 · P30 pair written (the rod covered in feet — nothing ordered)', !!p && !!s, logs.filter(m => /base front 4|H1-75/.test(m)).join(' | '));
    eq('the rod is the shop\'s, at its cut', (s?.cutList || []).map(c => [c.legacyErpId, c.qty, c.cutLength]), [['H1-75R', 50, 84]]);
    const fl = (p?.finPayload?.partsList || []).find(l => /H1-75KF/.test(l.legacyErpId));
    eq('the finial is painted from its /P, carrying the customer\'s code', [fl?.legacyErpId, fl?.clientSku], ['H1-75KF/P', 'FAB-KF-75']);
    ok('the released finishing document exists', fin.some(f => f.id === p?.id));
}
// ── THE SHOP DOCUMENT RTG WRITES FOR EACH PAIR (HQ/RTGDispatchTab.pushToShop: buildShopDoc + the shared fields) ──
{
    const { buildShopDoc } = await import('../../src/components/Shared/floorRelease.js');
    const { shopReleaseFieldsOf } = await import('../../src/components/Shared/cpqJobFacts.js');
    const release = (h) => buildShopDoc({ hqOrder: h, orderType: 'sales', shopId: `SHOP-${h.id}`,
        finishRecipe: (h.source === 'ORDER_ENTRY' && h.recipe) ? h.recipe : 'PENDING-RECIPE', finSiblingId: h.finSiblingId || null, part: null, by: 'loop',
        fields: shopReleaseFieldsOf({ hqOrder: h, originalJob: F.job, svgUri: null }) });
    const r1 = release(shopOf(pairOf('ROW 1', 'EP4')));
    eq('ROW 1 shop doc: plated EP4 → goes to the plater, no phosphate', [r1.finishRecipe, r1.isOutsourced, r1.needsPhosphating], ['EP4', true, false]);
    eq('…carries the returns on its cut list and the job\'s cut sheet + drawing, named for the row', [(r1.cutList || []).filter(c => c.rider).length, !!r1.fabNotes, /^data:image\/svg/.test(r1.imageUrl || ''), /ROW 1/.test(r1.item), r1.customerId], [2, true, true, true, 'CUST-FAB']);
    const r2 = release(shopOf(pairOf('Row 2', 'S04')));
    eq('Row 2 shop doc: S04 stain on wood → in-house, NOT phosphated, not plated', [r2.finishRecipe, r2.isOutsourced, r2.needsPhosphating], ['S04', false, false]);
    eq('…fascia + track + both miters on the cut list', (r2.cutList || []).map(c => c.legacyErpId).sort(), ['H1-2RCTWR-O', 'H1-2TRV', 'H1-2TRVMTR', 'H1-2TRVMTR']);
}
// ── WHAT THE 10.5 BOARD SAYS ABOUT THE ROWS NOW ──
{
    const { rowStateOf } = await import('../../src/components/Shared/displayRelease.js');
    const links = { wos: hq, pos: [], demands: [] };
    const entries = (label) => so.lines.map((line, lineIdx) => ({ line, lineIdx })).filter(x => rowKeyOf(rowOfLine(x.line)) === rowKeyOf(label));
    const r2 = rowStateOf({ so, entries: entries('Row 2'), links });
    const tr = r2.lines.find(l => l.erp === 'H1-2TRV');
    ok('the wood track reads as made (on its pair), not as a shelf pick', tr && tr.key !== 'STOCKED', JSON.stringify(tr));
    const mt = r2.lines.find(l => l.erp === 'H1-2TRVMTR');
    ok('a miter reads "rides the pole"', mt && /rides the pole/.test(mt.text), JSON.stringify(mt));
}
// ── THE BACK HALF: SO Pack (Shared/pickLines — the card's own functions) and the gather at Packaging Prep ──
{
    const { soPackLineStateOf, soOrderReadyOf, gatherPlanOf, packLinesOf } = await import('../../src/components/Shared/pickLines.js');
    const libFee = (code) => { const p = F.library.find(x => x.legacyErpId === code); return !!p && (p.partClass === 'Fee' || String(p.manufacturingSpecs?.productType || '').toUpperCase() === 'FEE'); };
    const statOf = (code) => (F.stock[code] ? { avail: F.stock[code].available, held: 0, prod: 0 } : null);
    let order = __fs.get('hq_sales_orders', F.SO_APP_ID); order.id = F.SO_APP_ID;
    const stateOf = (erp, n = 0) => { const i = lineIdx(erp, n); return soPackLineStateOf({ so: order, line: order.lines[i], idx: i, stat: statOf(require_code(order.lines[i])), isFeeCode: libFee }); };
    function require_code(l) { return (l.toBeFinished && l.finishCode && !String(l.erp).endsWith('/' + l.finishCode)) ? `${l.erp}/${l.finishCode}` : l.erp; }
    eq('the wood track now names what is made (the rod\'s S04 written on the line)', [order.lines[lineIdx('H1-2TRV')].finishCode, stateOf('H1-2TRV').code], ['S04', 'H1-2TRV/S04']);
    eq('fees are never picked', [stateOf('H1-FRPF').state, stateOf('H1-2TRVMTR').state], ['FEE', 'FEE']);
    eq('stocked hardware and in-stock plated picks read READY from the shelf', [stateOf('HTSLNTCAR').state, stateOf('H1-1CP-V').state, stateOf('H1-1BR').state], ['READY', 'READY', 'READY']);
    eq('a line made on a floor waits for its pieces', [stateOf('H1-2TRV').state, stateOf('H1-1R').state], ['FROM THE FLOOR', 'FROM THE FLOOR']);
    ok('packing lists no fee', !packLinesOf(order, { isFeeCode: libFee }).some(l => /FRPF|TRVMTR/.test(l.erp)));
    ok('not ready before anything is gathered', !soOrderReadyOf({ so: order, statOf, isFeeCode: libFee }));
    // Packaging Prep gathers each finished pair; the plated pole comes back through plating put-away.
    const gather = (plan) => { order.committedQty = { ...(order.committedQty || {}) }; plan.forEach(w => { order.committedQty[w.code] = (order.committedQty[w.code] || 0) + w.add; }); };
    const docFor = (row, fin) => __fs.get('fin_workorders', pairOf(row, fin).id);
    const row2 = gatherPlanOf({ job: docFor('Row 2', 'S04'), order, isFeeCode: libFee });
    eq('Row 2\'s document gathers the fascia and the track, not its miters', row2.map(w => [w.code, w.add]).sort(), [['H1-2RCTWR-O/S04', 50], ['H1-2TRV/S04', 50]]);
    gather(row2);
    gather(gatherPlanOf({ job: docFor('base front 4', 'P30'), order, isFeeCode: libFee }));
    gather([{ code: 'H1-1R/EP4', add: 50 }]);   // ROW 1's plated pole: plating put-away commits the plated code
    eq('gathered lines read GATHERED', [stateOf('H1-2TRV').state, stateOf('H1-2RCTWR-O').state, stateOf('H1-75R').state, stateOf('H1-75KF').state, stateOf('H1-1R').state], ['GATHERED', 'GATHERED', 'GATHERED', 'GATHERED', 'GATHERED']);
    const blockers = order.lines.map((l, i) => ({ l, i })).filter(x => { const st = soPackLineStateOf({ so: order, line: x.l, idx: x.i, stat: statOf(require_code(x.l)), isFeeCode: libFee }); return !['GATHERED', 'READY', 'FEE'].includes(st.state); }).map(x => require_code(x.l));
    eq('what still holds the order is exactly its backorders', blockers.sort(), ['H1-1STDOFF/EP4', 'H1-2TRV-WB/EP4'].sort());
}
if (globalThis.__NS_UNANSWERED) console.log('⚠ unanswered NetSuite calls:', globalThis.__NS_UNANSWERED.map(b => String(b.payload?.q || b.targetUrl).slice(0, 80)));
if (fail) console.log('\n--- route log ---\n' + logs.join('\n'));
console.log(`rowRoute loop: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
