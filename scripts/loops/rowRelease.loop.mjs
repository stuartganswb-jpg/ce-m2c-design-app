// A ROW RELEASED BY COUNT, END TO END (Stuart 2026-10-05: "put say just 10pcs (full rows) of the 35pcs into motion").
// The REAL row start — the row's count written on the sales order, then runOeAuto → buildOeJobs → buildOeReviewPlan →
// executeOeJobs → parkRowPair — against the in-memory Firestore and a scripted NetSuite, on the tabletop fixture (50
// displays): ROW 1 for 10, then 15 more, then run again; base front 4 whole; and what the WMS then reads.
//   node --import ./scripts/loops/register.mjs scripts/loops/rowRelease.loop.mjs
import * as F from './so60551.fixture.mjs';
import { __fs } from './fake-firestore.mjs';

const { rowLinesFromBreakdown, displayAnchorPatch, rowKeyOf, rowOfLine, rowStateOf, rowReleaseCountOf, rereadLinesPatchOf } = await import('../../src/components/Shared/displayRelease.js');
const { runOeAuto, oeInventoryOf } = await import('../../src/components/Shared/oeGenerate.js');
const R = await import('../../src/components/Shared/rowRelease.js');
const P = await import('../../src/components/Shared/pickLines.js');
const B = await import('../../src/components/Shared/orderBinPick.js');

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
__fs.reset();
F.library.forEach(p => __fs.seed('Approved_Designs', p.id, p));
__fs.seed('jobs', F.JOB_ID, F.job);
// The lines as 10.5 holds them once ↻ Re-read has applied CPQ's current rules (a 9/16 quote: the standoffs' stale EP4
// comes off — they are tagged Unfinished, so they are plain shelf picks).
const read0 = rowLinesFromBreakdown(F.breakdown);
const reread = rereadLinesPatchOf({ so: { ...F.salesOrder(read0), displayRelease: true }, breakdown: F.breakdown, finishes: F.finishes, inventory: F.library });
const lines0 = reread ? reread.lines : read0;
// The order goes on the row route today: released by count, of 50 displays (10.5's anchor).
__fs.seed('hq_sales_orders', F.SO_APP_ID, { ...F.salesOrder(lines0), ...displayAnchorPatch({ buildId: 'BUILD-T', lines: lines0, so: F.salesOrder(lines0) }), ...R.releaseByCountPatch(OF) });
const inventory = oeInventoryOf(F.library, F.BRAND);
const logs = [];
const soNow = () => ({ id: F.SO_APP_ID, ...__fs.get('hq_sales_orders', F.SO_APP_ID) });
// 10.5's ▶ Start n: the count first, then the generator.
const release = async (label, add) => {
    const key = rowKeyOf(label);
    const so = soNow();
    __fs.seed('hq_sales_orders', F.SO_APP_ID, { ...__fs.get('hq_sales_orders', F.SO_APP_ID), releaseOf: OF, rowRelease: { ...(so.rowRelease || {}), [key]: R.nextRowReleaseOf({ so, rowKey: key, add, of: OF, by: 'loop', now: Date.now() }) } });
    return runOeAuto({ so: soNow(), brand: F.BRAND, user: 'loop', inventory, finishes: F.finishes, log: (m) => logs.push(m),
        only: (line) => R.releaseRowKeyOf(line) === key, slot: `displayRows.${key}`, force: true });
};
const hqAll = () => __fs.all('hq_work_orders');
const idxOf = (erp, n = 0) => soNow().lines.map((l, i) => ({ l, i })).filter(x => x.l.erp === erp && rowKeyOf(rowOfLine(x.l)) === 'ROW_1')[n]?.i;
const gen = (erp, n = 0) => (soNow().oeGen || {})[idxOf(erp, n)] || null;
const pairs = (rowLabel) => hqAll().filter(h => h.rowLabel === rowLabel && h.routeTo === 'FINISHING').sort((a, b) => (a.releaseNo || 0) - (b.releaseNo || 0));
const shopOf = (pair) => pair && hqAll().find(h => h.id === pair.shopWoId);

ok('the order is on release counts', R.isReleaseByCount(soNow()) && soNow().releaseOf === OF);

// ── nothing released: nothing is in motion and nothing is offered to the warehouse ──
{
    const so = soNow();
    eq('nothing released → the WMS waits, with nothing in motion', (({ stage, anyReleased }) => [stage, anyReleased])(B.soGatherStageOf({ so, statOf: () => ({ avail: 999 }) })), ['WAITING', false]);
    eq('…and no shelf pick is offered — not even the plain stocked standoffs', B.shelfPickPlanOf({ so, binsOf: () => [{ bin: 'A1', qty: 999 }], toBin: 'ORDERS-COM1' }), []);
}

// ── ROW 1 for 10 of 50 ──
const r1 = await release('ROW 1', 10);
{
    const ps = pairs('ROW 1');
    eq('one pair for the release', ps.length, 1);
    const p = ps[0], s = shopOf(p);
    ok('…with its shop half', !!p && !!s, logs.join(' | '));
    eq('the shop cuts 10 poles (not 50) and the two French returns ride at 10 each', (s?.cutList || []).map(c => [c.legacyErpId, c.qty, c.cutLength || null, !!c.rider]), [['H1-1R', 10, 18, false], ['H1-FRPF', 10, null, true], ['H1-FRPF', 10, null, true]]);
    eq('…counted as 10 poles', [s?.poles, s?.qty], [10, 10]);
    eq('the pair says which displays it is', [p.releaseLabel, p.releaseNo, p.releaseFrom, p.releaseTo, p.releaseOf, /ROW 1 · EP4 · displays 1–10 of 50/.test(p.itemName), /displays 1–10 of 50/.test(s.itemName)], ['displays 1–10 of 50', 1, 0, 10, 50, true, true]);
    eq('…and what it carries of each order line', [p.soLineQty[idxOf('H1-1R')], p.finPayload.soLineQty[idxOf('H1-1R')]], [10, 10]);
    eq('the pole line: 10 of 50 released, on that pair', [gen('H1-1R').kind, gen('H1-1R').released, gen('H1-1R').releases.length, gen('H1-1R').ids.includes(p.id)], ['WO', 10, 1, true]);
    eq('the French returns ride it (the stamp says rider, so they are never picked)', [gen('H1-FRPF', 0).rider, gen('H1-FRPF', 0).released, gen('H1-FRPF', 1).released], [true, 10, 10]);
    eq('the plated fittings found on the shelf: 10 each, as shelf picks', [gen('H1-1CP-V').kind, gen('H1-1CP-V').released, gen('H1-1CP-V').code, gen('H1-1BR').kind, gen('H1-1BR').released], ['STOCK', 10, 'H1-1CP-V/EP4', 'STOCK', 10]);
    eq('the sales order\'s lines are untouched — still as sold', soNow().lines.filter(l => rowKeyOf(rowOfLine(l)) === 'ROW_1').map(l => l.qty), [50, 50, 50, 50, 50, 50, 50]);
    eq('the run reports what it started', [r1.state, r1.review.length], ['DONE', 0]);
    // the WMS
    const so = soNow();
    eq('to pick from the shelf now: 10 of each plated fitting and 20 standoffs (two lines of 10) — nothing of any other row', B.shelfPickPlanOf({ so, binsOf: (c) => [{ bin: 'A1', qty: (F.stock[c] || {}).available || 0 }], toBin: 'ORDERS-COM1' }).map(x => [x.code, x.qty, x.ok]), [['H1-1CP-V/EP4', 10, true], ['H1-1BR/EP4', 10, true], ['H1-1STDOFF', 20, true]]);
    eq('the bin needs 10 poles now; the order still needs 50', [P.soCodeReleasedNeedOf(so, 'H1-1R/EP4'), P.soCodeNeedOf(so, 'H1-1R/EP4')], [10, 50]);
    const fdoc = __fs.get('fin_workorders', p.id) || p.finPayload;
    eq('the pair\'s document gathers ITS 10 poles into the order — not the line\'s 50', P.gatherPlanOf({ job: fdoc, order: so }).filter(w => w.code === 'H1-1R/EP4').map(w => [w.qty, w.add]), [[10, 10]]);
    eq('10.5: ROW 1 reads 10 of 50, with 40 left', rowReleaseCountOf({ orders: [so], rowKey: 'ROW_1', of: OF }), { byCount: true, released: 10, of: OF, left: 40 });
}

// ── run it again at the same count: nothing more is due, nothing is written ──
{
    const before = hqAll().length;
    const again = await release('ROW 1', 0);
    eq('run again at 10 of 50 → nothing started, no new document', [again.ran, again.state, hqAll().length], [0, 'DONE', before]);
    eq('…and the lines stand at 10', [gen('H1-1R').released, gen('H1-1CP-V').released], [10, 10]);
}

// ── 15 more → 25 of 50 ──
await release('ROW 1', 15);
{
    const ps = pairs('ROW 1');
    eq('a second pair, for displays 11–25', ps.map(p => [p.releaseLabel, shopOf(p)?.poles]), [['displays 1–10 of 50', 10], ['displays 11–25 of 50', 15]]);
    ok('the two pairs are different documents', ps.length === 2 && ps[0].id !== ps[1].id);
    eq('the pole line: 25 of 50 released across both pairs', [gen('H1-1R').released, gen('H1-1R').releases.map(r => r.qty), ps.every(p => gen('H1-1R').ids.includes(p.id))], [25, [10, 15], true]);
    eq('the plated fittings: 25 each off the shelf', [gen('H1-1CP-V').released, gen('H1-1BR').released, gen('H1-1BR').kind], [25, 25, 'STOCK']);
    eq('the second pair carries 15 of the pole line', ps[1].soLineQty[idxOf('H1-1R')], 15);
    const so = soNow();
    // the first release's pieces are in the bin; the second is on the floors
    const inBin = { ...so, committedBin: 'ORDERS-COM1', committedQty: { 'H1-1R/EP4': 10, 'H1-1CP-V/EP4': 10, 'H1-1BR/EP4': 10, 'H1-1STDOFF': 20 } };
    eq('with release 1 in the bin: 15 more of each fitting and 30 standoffs to pick — never the whole line', B.shelfPickPlanOf({ so: inBin, binsOf: (c) => [{ bin: 'A1', qty: (F.stock[c] || {}).available || 0 }], toBin: 'ORDERS-COM1' }).map(x => [x.code, x.qty]), [['H1-1CP-V/EP4', 15], ['H1-1BR/EP4', 15], ['H1-1STDOFF', 30]]);
    eq('…and the second pair gathers its 15 poles on top of the 10', P.gatherPlanOf({ job: ps[1].finPayload, order: inBin }).filter(w => w.code === 'H1-1R/EP4').map(w => [w.qty, w.add]), [[15, 15]]);
    // 10.5 reads each release off its own documents
    const links = { wos: hqAll(), pos: [], demands: [] };
    const st = rowStateOf({ entries: so.lines.map((line, lineIdx) => ({ so, line, lineIdx, links })).filter(x => rowKeyOf(rowOfLine(x.line)) === 'ROW_1') });
    const pole = st.lines.find(l => l.erp === 'H1-1R');
    ok('10.5: the pole line reads 25 of 50 released, each release named', /^25 of 50 released — 10 \(displays 1–10 of 50\): .* · 15 \(displays 11–25 of 50\): /.test(pole.text), pole.text);
    eq('…and nothing on the row is waiting to start at this count', st.open, 0);
}

// ── a row whose every display is released at once: the whole line, one pair ──
await release('base front 4', OF);
{
    const ps = pairs('base front 4');
    eq('base front 4, all 50: one pair of 50 rods', ps.map(p => [p.releaseLabel, shopOf(p)?.poles]), [['displays 1–50 of 50', 50]]);
    const so = soNow();
    const i = so.lines.findIndex(l => l.erp === 'H1-75R');
    eq('the rod line is wholly released', [so.oeGen[i].released, R.lineDueOf(so, so.lines[i], i).qty], [50, 0]);
    eq('10.5: nothing left on that row', rowReleaseCountOf({ orders: [so], rowKey: rowKeyOf('base front 4'), of: OF }).left, 0);
}

// ── the order's own line (the base) follows ITS count; a row never released offers nothing ──
{
    const so0 = soNow();
    const baseIdx = so0.lines.findIndex(l => l.erp === 'H1-TTB1');
    __fs.seed('hq_sales_orders', F.SO_APP_ID, { ...__fs.get('hq_sales_orders', F.SO_APP_ID), lines: so0.lines.map((l, i) => (i === baseIdx ? { ...l, row: '', orderLevel: true } : l)) });
    eq('the base, not yet released: nothing to pick', P.soShelfToPickOf(soNow(), 'H1-TTB1'), 0);
    const res = await release('The order (not a row)', 7).catch(e => ({ error: String(e) }));
    ok('releasing the order\'s own line is a run with nothing to make', res && !res.error && res.ran === 0, JSON.stringify(res));
    // the panel writes it under ORDER
    const so = soNow();
    __fs.seed('hq_sales_orders', F.SO_APP_ID, { ...__fs.get('hq_sales_orders', F.SO_APP_ID), rowRelease: { ...(so.rowRelease || {}), [R.ORDER_ROW_KEY]: R.nextRowReleaseOf({ so, rowKey: R.ORDER_ROW_KEY, add: 7, of: OF, by: 'loop' }) } });
    eq('the base released for 7: 7 to pick', P.soShelfToPickOf(soNow(), 'H1-TTB1'), 7);
    eq('Row 2 was never released: its stocked plugs are not offered', P.soShelfToPickOf(soNow(), 'H1-2TRVPLUG'), 0);
}

if (globalThis.__NS_UNANSWERED) console.log('⚠ unanswered NetSuite calls:', globalThis.__NS_UNANSWERED.map(b => String(b.payload?.q || b.targetUrl).slice(0, 80)));
if (fail) console.log('\n--- route log ---\n' + logs.join('\n'));
console.log(`rowRelease loop: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
