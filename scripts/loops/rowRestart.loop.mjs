// AN ORDER RELEASED WHOLE, SWITCHED ONTO COUNTS AND RESTARTED ROW BY ROW (Stuart 2026-10-06, the wall: "i prefer to
// restart and just alert the floor not to duplicate … we can restart the entire order and run thru with the new code.
// Note row 2 is entirely complete"). The REAL pieces, on the in-memory Firestore: two rows started whole by the real row
// start (no release counts), shop documents on the floor with work on them; then the switch (countSwitchOf), the row
// restart (rowRestartPlanOf + the lifecycle's closeDocsExactly) on ONE row, and that row started again for 2 of 50.
//   node --import ./scripts/loops/register.mjs scripts/loops/rowRestart.loop.mjs
import * as F from './so60551.fixture.mjs';
import { __fs, doc, getDoc, getDocs, query, collection, where, updateDoc, setDoc, deleteDoc } from './fake-firestore.mjs';

const { rowLinesFromBreakdown, displayAnchorPatch, rowKeyOf, rowOfLine, rowStateOf, rowReleaseCountOf, rereadLinesPatchOf, rowRestartPlanOf } = await import('../../src/components/Shared/displayRelease.js');
const { runOeAuto, oeInventoryOf } = await import('../../src/components/Shared/oeGenerate.js');
const R = await import('../../src/components/Shared/rowRelease.js');
const P = await import('../../src/components/Shared/pickLines.js');
const L = await import('../../src/components/Shared/orderLifecycle.js');

let pass = 0, fail = 0;
const ok = (n, c, detail = '') => { if (c) pass++; else { fail++; console.log(`✗ ${n}${detail ? `\n    ${detail}` : ''}`); } };
const eq = (n, got, want) => ok(n, JSON.stringify(got) === JSON.stringify(want), `got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`);

const inList = (q) => ((q.match(/IN \(([^)]*)\)/g) || []).pop() || '').replace(/^IN \(|\)$/g, '').split(',').map(s => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
globalThis.__NS = async ({ payload }) => {
    const q = String((payload && payload.q) || '');
    if (/AggregateItemLocation/i.test(q)) return { items: inList(q).filter(c => F.stock[c]).map(c => ({ itemid: c, unitname: F.stock[c].unit, available: F.stock[c].available, onorder: 0 })) };
    if (/FROM TransactionLine tl/i.test(q)) return { items: [] };
    if (/PurchOrd/.test(q)) return { items: [] };
    return undefined;
};

const OF = 50;
const db = { __fake: true };
const ctx = { db, doc, getDoc, getDocs, query, collection, where, updateDoc, setDoc, deleteDoc };
__fs.reset();
F.library.forEach(p => __fs.seed('Approved_Designs', p.id, p));
__fs.seed('jobs', F.JOB_ID, F.job);
const read0 = rowLinesFromBreakdown(F.breakdown);
const reread = rereadLinesPatchOf({ so: { ...F.salesOrder(read0), displayRelease: true }, breakdown: F.breakdown, finishes: F.finishes, inventory: F.library });
const lines0 = reread ? reread.lines : read0;
// On the row route the OLD way: no release counts.
__fs.seed('hq_sales_orders', F.SO_APP_ID, { ...F.salesOrder(lines0), ...displayAnchorPatch({ buildId: 'BUILD-T', lines: lines0, so: F.salesOrder(lines0) }) });
const inventory = oeInventoryOf(F.library, F.BRAND);
const logs = [];
const soNow = () => ({ id: F.SO_APP_ID, ...__fs.get('hq_sales_orders', F.SO_APP_ID) });
const start = (label) => { const key = rowKeyOf(label); return runOeAuto({ so: soNow(), brand: F.BRAND, user: 'loop', inventory, finishes: F.finishes, log: (m) => logs.push(m), only: (line) => R.releaseRowKeyOf(line) === key, slot: `displayRows.${key}`, force: true }); };
const hqAll = () => __fs.all('hq_work_orders');
const pairsOf = (rowLabel) => hqAll().filter(h => h.rowLabel === rowLabel && h.routeTo === 'FINISHING');
const idxOf = (erp, row) => soNow().lines.findIndex(l => l.erp === erp && rowKeyOf(rowOfLine(l)) === rowKeyOf(row));

// ── two rows started WHOLE, the way the wall was ──
await start('ROW 1');
await start('base front 4');
const p1 = pairsOf('ROW 1')[0], p4 = pairsOf('base front 4')[0];
ok('both rows are on whole-row pairs of 50', !!p1 && !!p4 && !p1.releaseLabel && !p4.releaseLabel, logs.join(' | '));
// RTG put their shop halves on the floor, and the shop worked them — each carries the SALES ORDER NUMBER as its orderKey,
// the key every row of the order shares.
const shopId = (p) => `SHOP-${p.shopWoId}`;
__fs.seed('shop_custom_orders', shopId(p1), { id: shopId(p1), status: 'Completed', startedAt: 5, completedAt: 6, completedBy: 'Eric', orderKey: 'SO60551', finSiblingId: p1.id, qty: 50, poles: 50, rowLabel: 'ROW 1' });
__fs.seed('shop_custom_orders', shopId(p4), { id: shopId(p4), status: 'In Process', startedAt: 7, orderKey: 'SO60551', finSiblingId: p4.id, qty: 50, poles: 50, rowLabel: 'base front 4' });
// …an open rod cut raised for ROW 1's pair, and one for the other row
__fs.seed('rod_cut_orders', `RC-${p1.id}`, { id: `RC-${p1.id}`, status: 'OPEN', finWoId: p1.id });
__fs.seed('rod_cut_orders', `RC-${p4.id}`, { id: `RC-${p4.id}`, status: 'OPEN', finWoId: p4.id });

// ── ⇄ the switch ──
{
    const sw = R.countSwitchOf({ so: soNow(), of: OF, by: 'stuart', now: 100 });
    eq('the switch names the two started rows', sw.rows.sort(), ['BASE_FRONT_4', 'ROW_1']);
    await updateDoc(doc(db, 'hq_sales_orders', F.SO_APP_ID), sw.patch);
    const so = soNow();
    eq('both read 50 of 50, every other row 0', [rowReleaseCountOf({ orders: [so], rowKey: 'ROW_1', of: OF }).released, rowReleaseCountOf({ orders: [so], rowKey: 'BASE_FRONT_4', of: OF }).released, rowReleaseCountOf({ orders: [so], rowKey: 'ROW_2', of: OF }).released], [50, 50, 0]);
    eq('nothing more is due on a started row, and no document changed', [R.lineDueOf(so, so.lines[idxOf('H1-1R', 'ROW 1')], idxOf('H1-1R', 'ROW 1')).qty, __fs.get('hq_work_orders', p1.id).status, __fs.get('shop_custom_orders', shopId(p1)).status], [0, p1.status, 'Completed']);
    const again = await start('ROW 1');
    eq('…and running the row again raises nothing', [again.ran, hqAll().length], [0, hqAll().length]);
}

// ── ⟲ restart ROW 1 — exactly its documents ──
{
    const so = soNow();
    const plan = rowRestartPlanOf({ so, rowKey: 'ROW_1' });
    eq('the row names its own pair, nothing else', plan.ids.sort(), [p1.id, p1.shopWoId].sort());
    const records = [], fins = [], shops = [];
    for (const id of plan.ids) {
        const h = await getDoc(doc(db, 'hq_work_orders', id)); if (h.exists()) records.push({ id: h.id, data: h.data() });
        const f = await getDoc(doc(db, 'fin_workorders', id)); if (f.exists()) fins.push({ id: f.id, data: f.data() });
        const sh = await getDoc(doc(db, 'shop_custom_orders', `SHOP-${id}`)); if (sh.exists()) shops.push({ id: sh.id, data: sh.data() });
    }
    eq('read by id: two RTG records, the finishing document, the shop document', [records.length, fins.length, shops.length], [2, 1, 1]);
    const res = await L.closeDocsExactly(ctx, { fins, shops, records, by: 'stuart', from: '10.5', reason: 'ROW 1: restarted to release by count', label: 'ROW 1 of SO60551' });
    eq('closed: 1 finishing, 1 shop, 2 RTG records, its open rod cut cancelled', [res.fin, res.shop, res.records, res.rodCuts], [1, 1, 2, 1]);
    const f1 = __fs.get('fin_workorders', p1.id), s1 = __fs.get('shop_custom_orders', shopId(p1)), h1 = __fs.get('hq_work_orders', p1.id), h1c = __fs.get('hq_work_orders', p1.shopWoId);
    eq('each takes the closer\'s stamps and keeps the state it had (reopenable)', [f1.currentPhase, f1.pickStatus, f1.closedFrom, f1.closeReason, f1.stateBeforeClose.currentPhase, s1.status, s1.closed, s1.stateBeforeClose.status, h1.status, h1.stateBeforeClose.status, h1c.status, h1c.closedBy], ['Closed', 'Closed', '10.5', 'ROW 1: restarted to release by count', fins[0].data.currentPhase, 'Completed', true, 'Completed', 'Closed', p1.status, 'Closed', 'stuart']);
    // THE OTHER ROW — same sales order, same orderKey on its shop document — is not touched
    const f4 = __fs.get('fin_workorders', p4.id), s4 = __fs.get('shop_custom_orders', shopId(p4)), h4 = __fs.get('hq_work_orders', p4.id);
    eq('the other row\'s documents are untouched: its shop job still In Process, its rod cut still open', [s4.status, s4.closed || false, h4.status, f4 ? f4.currentPhase !== 'Closed' : 'no fin doc', __fs.get('rod_cut_orders', `RC-${p4.id}`).status, __fs.get('rod_cut_orders', `RC-${p1.id}`).status], ['In Process', false, p4.status, true, 'OPEN', 'CANCELLED']);
    // a second press closes nothing more
    const res2 = await L.closeDocsExactly(ctx, { fins: [{ id: p1.id, data: f1 }], shops: [{ id: shopId(p1), data: s1 }], records: [{ id: p1.id, data: h1 }], by: 'x', from: '10.5', reason: 'again' });
    eq('a document already closed is left as it is', [res2.fin + res2.shop + res2.records, __fs.get('fin_workorders', p1.id).closedBy], [0, 'stuart']);
    // the sales order: the row's lines drop their records, its count goes
    const cur = __fs.get('hq_sales_orders', F.SO_APP_ID);
    const oeGen = { ...cur.oeGen }; plan.hit.forEach(i => { delete oeGen[i]; });
    const rowRelease = { ...cur.rowRelease }; delete rowRelease.ROW_1;
    const displayRows = { ...(cur.displayRows || {}) }; delete displayRows.ROW_1;
    __fs.seed('hq_sales_orders', F.SO_APP_ID, { ...cur, oeGen, rowRelease, displayRows, ...(plan.boChanged ? { backorderLines: plan.backorderLines } : {}) });
}

// ── the row reads NOT STARTED though its closed documents still exist — and starts again for 2 of 50 ──
{
    const so = soNow();
    const links = { wos: hqAll(), pos: [], demands: [] };
    const st = rowStateOf({ entries: so.lines.map((line, lineIdx) => ({ so, line, lineIdx, links })).filter(x => rowKeyOf(rowOfLine(x.line)) === 'ROW_1') });
    eq('ROW 1 reads not started — the closed pair does not count as work', [st.key, rowReleaseCountOf({ orders: [so], rowKey: 'ROW_1', of: OF }).released, st.lines.filter(l => l.key === 'DONE').length], ['NOT_STARTED', 0, 0]);
    eq('…and nothing of it is offered to the warehouse', [P.soShelfToPickOf(so, 'H1-1STDOFF'), P.soShelfToPickOf(so, 'H1-1CP-V/EP4')], [0, 0]);
    const key = 'ROW_1';
    __fs.seed('hq_sales_orders', F.SO_APP_ID, { ...__fs.get('hq_sales_orders', F.SO_APP_ID), rowRelease: { ...(so.rowRelease || {}), [key]: R.nextRowReleaseOf({ so, rowKey: key, add: 2, of: OF, by: 'stuart', now: 200 }) } });
    const res = await start('ROW 1');
    const live = pairsOf('ROW 1').filter(h => h.status !== 'Closed');
    eq('one new pair, for displays 1–2 — the closed one stays closed', [res.state, live.length, live[0] && live[0].releaseLabel, pairsOf('ROW 1').length], ['DONE', 1, 'displays 1–2 of 50', 2]);
    const shopRec = hqAll().find(h => h.id === live[0].shopWoId);
    eq('the shop is asked for 2 poles and the returns ride at 2 each', (shopRec.cutList || []).map(c => [c.legacyErpId, c.qty]), [['H1-1R', 2], ['H1-FRPF', 2], ['H1-FRPF', 2]]);
    const now = soNow();
    eq('the line\'s record is the new release only: 2 of 50', [now.oeGen[idxOf('H1-1R', 'ROW 1')].released, now.oeGen[idxOf('H1-1R', 'ROW 1')].ids.includes(p1.id), now.oeGen[idxOf('H1-1CP-V', 'ROW 1')].released], [2, false, 2]);
    eq('the warehouse is offered 2 displays of ROW 1\'s stocked parts', [P.soShelfToPickOf(now, 'H1-1STDOFF'), P.soShelfToPickOf(now, 'H1-1CP-V/EP4')], [4, 2]);
    eq('the row left alone is still whole: 50 of 50 on its own pair', [rowReleaseCountOf({ orders: [now], rowKey: 'BASE_FRONT_4', of: OF }).released, R.isWholeStamp(now.oeGen[now.lines.findIndex(l => l.erp === 'H1-75R')]), P.gatherPlanOf({ job: p4.finPayload, order: now }).find(w => /H1-75R/.test(w.code)).add], [50, true, 50]);
}

if (globalThis.__NS_UNANSWERED) console.log('⚠ unanswered NetSuite calls:', globalThis.__NS_UNANSWERED.map(b => String(b.payload?.q || b.targetUrl).slice(0, 80)));
if (fail) console.log('\n--- route log ---\n' + logs.join('\n'));
console.log(`rowRestart loop: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
