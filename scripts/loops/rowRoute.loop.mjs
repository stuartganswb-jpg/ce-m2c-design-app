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
// The live order was anchored by the OLD reader: no part id, no sub finish on its lines — reproduced here, so the
// route is proven to derive the track's colour from the row itself.
const lines = rowLinesFromBreakdown(F.breakdown).map(l => { const x = { ...l }; delete x.subFinishCode; delete x.finishLabel; delete x.partId; return x; });
__fs.seed('hq_sales_orders', F.SO_APP_ID, { ...F.salesOrder(lines), ...displayAnchorPatch({ buildId: 'BUILD-T', lines, so: F.salesOrder(lines) }) });
const inventory = oeInventoryOf(F.library, F.BRAND);
const logs = [];
for (const label of ['ROW 1', 'Row 2', 'Base Back 1', 'base front 4']) {
    const so = __fs.get('hq_sales_orders', F.SO_APP_ID);
    const key = rowKeyOf(label);
    await runOeAuto({ so: { id: F.SO_APP_ID, ...so }, brand: F.BRAND, user: 'loop', inventory, finishes: F.finishes, log: (m) => logs.push(m),
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
    ok('the standoffs (tagged Unfinished — CPQ never finishes them) are never plated or backordered', !bo.some(c => /STDOFF/.test(c)), `backorders: ${bo.join(', ')}`);
    eq('…and never started: they are shelf picks of the plain item', [gen('H1-1STDOFF', 0), gen('H1-1STDOFF', 1)], [null, null]);
}
// ── Row 2 (CPQ's traverse rules, Stuart 2026-09-27): the stained fascia and its two miters are ONE S04 shop job; the
//    track and the F-clips are cut shorter than the fascia (manual: −0.5" / −1") and finished TCP — the sub finish 4.5
//    aligns to S04 — as their own pair; nothing in Row 2 is EP4 but the (not yet re-read) brackets ──
{
    const p = pairOf('Row 2', 'S04'); const s = shopOf(p);
    ok('Row 2 · S04 pair written', !!p && !!s, `pairs: ${hq.map(h => `${h.id}(${h.rowLabel}/${h.finishGroup}/${h.routeTo})`).join(', ')}`);
    eq('S04 shop cut list = the fascia at 18" + both miters riding', (s?.cutList || []).map(c => [c.legacyErpId, c.cutLength || null, !!c.rider]).sort(), [['H1-2RCTWR-O', 18, false], ['H1-2TRVMTR', null, true], ['H1-2TRVMTR', null, true]].sort());
    eq('…recipe S04, not EP4', [s?.recipe, p?.recipe], ['S04', 'S04']);
    const pt = pairOf('Row 2', 'TCP'); const st = shopOf(pt);
    ok('Row 2 · TCP pair written (the track and F-clips)', !!pt && !!st, `pairs: ${hq.map(h => `${h.id}(${h.rowLabel}/${h.finishGroup}/${h.routeTo})`).join(', ')}`);
    eq('TCP shop cut list = the track at 17.5" and both F-clip lines at 17"', (st?.cutList || []).map(c => [c.legacyErpId, c.cutLength, c.finishedCode]).sort(), [['H1-2TRV', 17.5, 'H1-2TRVTRK/C'], ['H1-2TRVCLP', 17, 'H1-2TRVCLP/C'], ['H1-2TRVCLP', 17, 'H1-2TRVCLP/C']].sort());
    eq('…recipe TCP, not S04 or EP4', [st?.recipe, pt?.recipe], ['TCP', 'TCP']);
    ok('no Row 2 wood or track goes to the finishing floor as a small part', ![...(p?.finPayload?.partsList || []), ...(pt?.finPayload?.partsList || [])].some(l => /RCTWR|2TRV$|2TRVCLP/.test(l.legacyErpId)));
    ok('the miters are never stock-checked or backordered', !bo.some(c => /TRVMTR/.test(c)), `backorders: ${bo.join(', ')}`);
    eq('the track, F-clips and miters are covered by the pairs', [gen('H1-2TRV')?.kind, gen('H1-2TRVCLP', 0)?.kind, gen('H1-2TRVCLP', 1)?.kind, gen('H1-2TRVMTR')?.kind], ['WO', 'WO', 'WO', 'WO']);
    eq('the start wrote CPQ\'s rules on the track line (so every screen names what is made)', [so.lines[lineIdx('H1-2TRV')].finishCode, so.lines[lineIdx('H1-2TRV')].subFinishCode, so.lines[lineIdx('H1-2TRV')].cutLength], ['TCP', 'TCP', 17.5]);
    ok('the EP4 brackets (not re-read yet) are on the Backorder board as quoted', bo.includes('H1-2TRV-WB/EP4'), `backorders: ${bo.join(', ')}`);
    eq('stocked hardware stays a shelf pick', [gen('H1-2TRVPLUG'), gen('HTSLNTCAR'), gen('H1-2TRVNUT')], [null, null, null]);
    ok('no EP4 pair is written for Row 2', !pairOf('Row 2', 'EP4'));
}
// ── Base Back 1 (Stuart 2026-09-28): the clear acrylic rod wears nothing — the shop cuts it, no finishing floor ──
{
    const p = pairOf('Base Back 1', 'UNFINISHED'); const s = shopOf(p);
    ok('Base Back 1 · UNFINISHED pair written', !!p && !!s, `pairs: ${hq.map(h => `${h.rowLabel}/${h.finishGroup}/${h.routeTo}`).join(', ')} | ${logs.filter(m => /Base Back 1|RCTACR/.test(m)).join(' | ')}`);
    eq('the shop cuts the acrylic at 12"', (s?.cutList || []).map(c => [c.legacyErpId, c.cutLength, c.finishedCode]), [['H1-2RCTACR', 12, 'H1-2RCTACR']]);
    const fdoc = fin.find(f => f.id === p?.id);
    eq('its finishing half is the pick-only document — the finishing floor never sees it', [fdoc?.pickOnly, fdoc?.finishingRequired, fdoc?.currentPhase], [true, false, 'Complete']);
    eq('the plated end cap in stock is a SO Pack pick', gen('H1-2RCTAEC')?.kind, 'STOCK');
}
// ── base front 4: a bought rod read in FEET (50 × 84" = 350 ft of 430) and a painted finial with the customer's code ──
{
    const p = pairOf('base front 4', 'P30'); const s = shopOf(p);
    ok('base front 4 · P30 pair written (the rod covered in feet — nothing ordered)', !!p && !!s, logs.filter(m => /base front 4|H1-75/.test(m)).join(' | '));
    eq('the rod is the shop\'s, at its cut', (s?.cutList || []).map(c => [c.legacyErpId, c.qty, c.cutLength]), [['H1-75R', 50, 84]]);
    const fl = (p?.finPayload?.partsList || []).find(l => /H1-75KF/.test(l.legacyErpId));
    eq('the finial is painted from its /P, carrying the customer\'s code', [fl?.legacyErpId, fl?.clientSku], ['H1-75KF/P', 'FAB-KF-75']);
    ok('the released finishing document exists', fin.some(f => f.id === p?.id));
    const FA = await import('../../src/components/Shared/floorActivity.js');
    const fd = fin.find(f => f.id === p?.id) || {};
    eq('…and it runs TWO tracks: the 50 poles on the pole recipe, the finial on the small-parts recipe', [fd.totalPoles, FA.woHasPoles(fd), FA.woHasSmallParts(fd), FA.partsStreamOf(fd), FA.poleStreamOf(fd), fd.finishStream || null, fd.shapeWarning || null], [50, true, true, 'SMALL', 'POLES', null, null]);
    const r2d = fin.find(f => f.id === pairOf('Row 2', 'S04')?.id) || {};
    eq('Row 2\'s S04 document is poles alone (the fascia) — the pole stream, no sled to wait on', [r2d.finishStream, FA.woHasSmallParts(r2d)], ['POLES', false]);
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
    eq('Row 2 S04 shop doc: stain on wood → in-house, NOT phosphated, not plated', [r2.finishRecipe, r2.isOutsourced, r2.needsPhosphating], ['S04', false, false]);
    eq('…fascia + both miters on the cut list', (r2.cutList || []).map(c => c.legacyErpId).sort(), ['H1-2RCTWR-O', 'H1-2TRVMTR', 'H1-2TRVMTR']);
    const ra = release(shopOf(pairOf('Base Back 1', 'UNFINISHED')));
    eq('Base Back 1 shop doc: UNFINISHED — not plated, NOT phosphated', [ra.finishRecipe, ra.isOutsourced, ra.needsPhosphating], ['UNFINISHED', false, false]);
    const r3 = release(shopOf(pairOf('Row 2', 'TCP')));
    eq('Row 2 TCP shop doc: in-house TCP, the track and F-clips at their deducted cuts', [r3.finishRecipe, r3.isOutsourced, (r3.cutList || []).map(c => `${c.legacyErpId}@${c.cutLength}`).sort()], ['TCP', false, ['H1-2TRV@17.5', 'H1-2TRVCLP@17', 'H1-2TRVCLP@17']]);
}
// ── WHAT THE 10.5 BOARD SAYS ABOUT THE ROWS NOW ──
{
    const { rowStateOf } = await import('../../src/components/Shared/displayRelease.js');
    const links = { wos: hq, pos: [], demands: [] };
    const entries = (label) => so.lines.map((line, lineIdx) => ({ line, lineIdx })).filter(x => rowKeyOf(rowOfLine(x.line)) === rowKeyOf(label));
    const r2 = rowStateOf({ so, entries: entries('Row 2'), links });
    const tr = r2.lines.find(l => l.erp === 'H1-2TRV');
    ok('the track reads as made (on its pair), not as a shelf pick', tr && tr.key !== 'STOCKED', JSON.stringify(tr));
    const mt = r2.lines.find(l => l.erp === 'H1-2TRVMTR');
    ok('a miter reads "rides the pole"', mt && /rides the pole/.test(mt.text), JSON.stringify(mt));
}
// ── THE BACK HALF: SO Pack (Shared/pickLines — the card's own functions) and the gather at Packaging Prep ──
{
    const { soPackLineStateOf, soOrderReadyOf, gatherPlanOf, packLinesOf, soLineCodeOf } = await import('../../src/components/Shared/pickLines.js');
    const libFee = (code) => { const p = F.library.find(x => x.legacyErpId === code); return !!p && (p.partClass === 'Fee' || String(p.manufacturingSpecs?.productType || '').toUpperCase() === 'FEE'); };
    const statOf = (code) => (F.stock[code] ? { avail: F.stock[code].available, held: 0, prod: 0 } : null);
    let order = __fs.get('hq_sales_orders', F.SO_APP_ID); order.id = F.SO_APP_ID;
    const stateOf = (erp, n = 0) => { const i = lineIdx(erp, n); return soPackLineStateOf({ so: order, line: order.lines[i], idx: i, stat: statOf(require_code(order.lines[i])), isFeeCode: libFee }); };
    function require_code(l) { return soLineCodeOf(l); }
    eq('the track names what comes off the floor (TCP written on the line → H1-2TRVTRK/C)', [order.lines[lineIdx('H1-2TRV')].finishCode, stateOf('H1-2TRV').code, stateOf('H1-2TRVCLP').code], ['TCP', 'H1-2TRVTRK/C', 'H1-2TRVCLP/C']);
    eq('fees are never picked', [stateOf('H1-FRPF').state, stateOf('H1-2TRVMTR').state], ['FEE', 'FEE']);
    eq('stocked hardware and in-stock plated picks read READY from the shelf', [stateOf('HTSLNTCAR').state, stateOf('H1-1CP-V').state, stateOf('H1-1BR').state], ['READY', 'READY', 'READY']);
    eq('a line made on a floor waits for its pieces', [stateOf('H1-2TRV').state, stateOf('H1-1R').state], ['FROM THE FLOOR', 'FROM THE FLOOR']);
    ok('packing lists no fee', !packLinesOf(order, { isFeeCode: libFee }).some(l => /FRPF|TRVMTR/.test(l.erp)));
    ok('not ready before anything is gathered', !soOrderReadyOf({ so: order, statOf, isFeeCode: libFee }));
    // Packaging Prep gathers each finished pair; the plated pole comes back through plating put-away.
    const gather = (plan) => { order.committedQty = { ...(order.committedQty || {}) }; plan.forEach(w => { order.committedQty[w.code] = (order.committedQty[w.code] || 0) + w.add; }); };
    const docFor = (row, fin) => __fs.get('fin_workorders', pairOf(row, fin).id);
    const row2 = gatherPlanOf({ job: docFor('Row 2', 'S04'), order, isFeeCode: libFee });
    eq('Row 2\'s S04 document gathers the fascia, not its miters', row2.map(w => [w.code, w.add]).sort(), [['H1-2RCTWR-O/S04', 50]]);
    gather(row2);
    const row2t = gatherPlanOf({ job: docFor('Row 2', 'TCP'), order, isFeeCode: libFee });
    eq('Row 2\'s TCP document gathers the finished track and F-clips', row2t.map(w => [w.code, w.add]).sort(), [['H1-2TRVCLP/C', 50], ['H1-2TRVCLP/C', 50], ['H1-2TRVTRK/C', 50]]);
    gather(row2t);
    gather(gatherPlanOf({ job: docFor('base front 4', 'P30'), order, isFeeCode: libFee }));
    eq('the acrylic comes from the floor (a cut piece is never looked for on the shelf)', stateOf('H1-2RCTACR').state, 'FROM THE FLOOR');
    const bb1 = gatherPlanOf({ job: docFor('Base Back 1', 'UNFINISHED'), order, isFeeCode: libFee });
    eq('Base Back 1\'s document gathers the acrylic as it is', bb1.map(w => [w.code, w.add]), [['H1-2RCTACR', 50]]);
    gather(bb1);
    gather([{ code: 'H1-1R/EP4', add: 50 }]);   // ROW 1's plated pole: plating put-away commits the plated code
    eq('gathered lines read GATHERED', [stateOf('H1-2TRV').state, stateOf('H1-2TRVCLP', 1).state, stateOf('H1-2RCTWR-O').state, stateOf('H1-75R').state, stateOf('H1-75KF').state, stateOf('H1-1R').state], ['GATHERED', 'GATHERED', 'GATHERED', 'GATHERED', 'GATHERED', 'GATHERED']);
    const blockers = order.lines.map((l, i) => ({ l, i })).filter(x => { const st = soPackLineStateOf({ so: order, line: x.l, idx: x.i, stat: statOf(require_code(x.l)), isFeeCode: libFee }); return !['GATHERED', 'READY', 'FEE'].includes(st.state); }).map(x => require_code(x.l));
    // Before ↻ Re-read the standoff lines still SAY EP4 (the 9/16 quote) and the brackets are the EP4 backorder.
    eq('what still holds the order: the stale standoff lines and the EP4 brackets (both fixed by ↻ Re-read, below)', blockers.sort(), ['H1-1STDOFF/EP4', 'H1-1STDOFF/EP4', 'H1-2TRV-WB/EP4', 'H1-2TRV-WB/EP4'].sort());
    eq('the base H1-TTB1 is READY from the shelf', stateOf('H1-TTB1').state, 'READY');
}
// ── ↻ RE-READ LINES ON THE LIVE ROW 2, THEN ▶ START ROW (a fresh order — the repair Stuart presses) ──
{
    const { rereadLinesPatchOf, rereadLinesText } = await import('../../src/components/Shared/displayRelease.js');
    const { soPackLineStateOf } = await import('../../src/components/Shared/pickLines.js');
    const soAt = { id: 'SO-APP-REREAD', ...F.salesOrder(lines), ...displayAnchorPatch({ buildId: 'BUILD-R', lines, so: F.salesOrder(lines) }),
        // as live: the retired split's record for the bracket, and the old row start's OE_ROW record for a miter line
        backorderLines: [{ code: 'H1-2TRV-WB/EP4', qty: 50 }, { code: 'H1-2TRVMTR/EP4', qty: 50, source: 'OE_ROW', lineIndex: lines.findIndex(l => l.erp === 'H1-2TRVMTR') }] };
    const patch = rereadLinesPatchOf({ so: soAt, breakdown: F.breakdown, finishes: F.finishes, inventory: F.library });
    ok('↻ Re-read has something to do', !!patch);
    const text = rereadLinesText(soAt, patch || {});
    const L2 = (erp, n = 0) => (patch.lines.map((l, i) => ({ l, i })).filter(x => x.l.erp === erp || x.l.identityFrom === erp)[n] || {}).l || {};
    eq('the track: TCP, 17.5"', [L2('H1-2TRV').finishCode, L2('H1-2TRV').subFinishCode, L2('H1-2TRV').cutLength], ['TCP', 'TCP', 17.5]);
    eq('both F-clips: TCP, 17"', [L2('H1-2TRVCLP', 0).cutLength, L2('H1-2TRVCLP', 1).cutLength, L2('H1-2TRVCLP', 1).finishCode], [17, 17, 'TCP']);
    eq('both brackets become the stocked champagne item, picked', [L2('H1-2TRV-WB/C', 0).erp, L2('H1-2TRV-WB/C', 1).erp, L2('H1-2TRV-WB/C', 0).toBeFinished, L2('H1-2TRV-WB/C', 0).subFinishCode], ['H1-2TRV-WB/C', 'H1-2TRV-WB/C', false, 'TCP']);
    eq('both miters take the fascia\'s S04', [L2('H1-2TRVMTR', 0).finishCode, L2('H1-2TRVMTR', 1).finishCode], ['S04', 'S04']);
    eq('the standoffs lose the stale EP4 — tagged Unfinished, picked as H1-1STDOFF', [L2('H1-1STDOFF', 0).finishCode, L2('H1-1STDOFF', 0).toBeFinished, L2('H1-1STDOFF', 0).noFinish, L2('H1-1STDOFF', 1).finishCode], ['', false, true, '']);
    ok('the confirm names the standoff change', /H1-1STDOFF\/EP4 → H1-1STDOFF: tagged Unfinished/.test(text), text);
    ok('the confirm names the NetSuite line to change', /change the NetSuite line to H1-2TRV-WB\/C/.test(text) && /change the same line in NetSuite/.test(text), text);
    eq('the EP4 bracket backorder goes with the old item', (patch.backorderLines || []).map(b => b.code), ['H1-2TRVMTR/EP4']);
    {
        const { soRowsOf, ORDER_ROW_LABEL } = await import('../../src/components/Shared/displayRelease.js');
        const rows = ['ROW 1', 'Row 2', 'Base Back 1', 'base front 4'];
        eq('the base H1-TTB1 names no row → unassigned', soRowsOf({ lines: patch.lines }, rows).unassigned.map(e => e.line.erp), ['H1-TTB1']);
        const marked = patch.lines.map(l => (l.erp === 'H1-TTB1' ? { ...l, row: '', orderLevel: true } : l));
        const r = soRowsOf({ lines: marked }, rows);
        eq('marked "' + ORDER_ROW_LABEL + '": no longer unassigned, the order\'s own line', [r.unassigned.length, r.orderLines.map(e => e.line.erp)], [0, ['H1-TTB1']]);
    }
    eq('ROW 1: only the standoffs change (their stale EP4) — the pole, returns and fittings are as quoted', patch.lines.filter(l => /ROW 1/i.test(l.row || '') && !/STDOFF/.test(l.erp)).map(l => [l.erp, l.finishCode || '', l.cutLength || null]), lines.filter(l => /ROW 1/i.test(l.row || '') && !/STDOFF/.test(l.erp)).map(l => [l.erp, l.finishCode || '', l.cutLength || null]));
    // Idempotent: a second press changes nothing more.
    const again = rereadLinesPatchOf({ so: { ...soAt, lines: patch.lines, backorderLines: patch.backorderLines }, breakdown: F.breakdown, finishes: F.finishes, inventory: F.library });
    ok('a second ↻ Re-read finds nothing to change', !again || (!(again.restamped || []).length && !again.added.length), JSON.stringify(again && again.restamped));
    // ▶ Start row on the re-read order
    __fs.seed('hq_sales_orders', soAt.id, { ...soAt, lines: patch.lines, backorderLines: patch.backorderLines });
    const before = new Set(__fs.all('hq_work_orders').map(h => h.id));
    await runOeAuto({ so: { ...__fs.get('hq_sales_orders', soAt.id), id: soAt.id }, brand: F.BRAND, user: 'loop', inventory, finishes: F.finishes, log: (m) => logs.push(m),
        only: (line) => rowKeyOf(rowOfLine(line)) === rowKeyOf('Row 2'), slot: 'displayRows.ROW_2', force: true });
    const so2 = __fs.get('hq_sales_orders', soAt.id); so2.id = soAt.id;
    const fresh = __fs.all('hq_work_orders').filter(h => !before.has(h.id));
    eq('Row 2 after the re-read starts exactly two pairs: S04 and TCP', [...new Set(fresh.filter(h => h.routeTo === 'FINISHING').map(h => h.finishGroup))].sort(), ['S04', 'TCP']);
    const bo2 = (so2.backorderLines || []).map(b => b.code);
    ok('nothing in Row 2 is backordered now (brackets are on the shelf)', !bo2.some(c => /2TRV/.test(c)), `backorders: ${bo2.join(', ')}`);
    const bi = so2.lines.findIndex(l => l.erp === 'H1-2TRV-WB/C');
    eq('the /C bracket is a SO Pack shelf pick', soPackLineStateOf({ so: so2, line: so2.lines[bi], idx: bi, stat: { avail: 200, held: 0, prod: 0 } }).state, 'READY');
    const si = so2.lines.findIndex(l => l.erp === 'H1-1STDOFF');
    eq('the re-read standoff is a SO Pack shelf pick of H1-1STDOFF', [soPackLineStateOf({ so: so2, line: so2.lines[si], idx: si, stat: { avail: 300, held: 0, prod: 0 } }).code, soPackLineStateOf({ so: so2, line: so2.lines[si], idx: si, stat: { avail: 300, held: 0, prod: 0 } }).state], ['H1-1STDOFF', 'READY']);
}
if (globalThis.__NS_UNANSWERED) console.log('⚠ unanswered NetSuite calls:', globalThis.__NS_UNANSWERED.map(b => String(b.payload?.q || b.targetUrl).slice(0, 80)));
if (fail) console.log('\n--- route log ---\n' + logs.join('\n'));
console.log(`rowRoute loop: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
