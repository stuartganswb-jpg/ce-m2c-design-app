// node scripts/materialGrid.test.mjs — the material grid on the floor card (Stuart 2026-09-23):
// computed once at release, stamped on every document, refreshed each morning until pulled.
import {
    materialRowsOf, materialRowsFromSplit, materialStampOf, refreshMaterialRows, materialCodesOf,
    materialRefreshable, materialAgeText, refreshDayKey, refreshDue, MATERIAL_STATE,
} from '../src/components/Shared/materialGrid.js';
let pass = 0, fail = 0;
const eq = (n, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) pass++; else { fail++; console.log(`✗ ${n}\n   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`); } };
const ok = (n, c) => { if (c) pass++; else { fail++; console.log(`✗ ${n}`); } };
const { COVERED, SHORT, UNVERIFIED } = MATERIAL_STATE;

// ── FROM THE ORDER ENTRY PLAN'S COMPONENTS ─────────────────────────────────────────────────
{
    const comp = (o) => ({ code: 'X', name: '', need: 10, have: 10, short: 0, onOrder: 0, actions: [], ...o });
    const rows = materialRowsOf({ components: [
        comp({ code: 'H1-2TRVBP/P', name: 'Backplate', need: 70, have: 120, short: 0 }),
        comp({ code: 'H1-2TRVLA/P', name: 'Lower arm', need: 70, have: 30, short: 40, onOrder: 50, actions: [{ kind: 'CONVERT', target: 'H1-2TRVLA/P', base: 'H1-2TRVLA', qty: 40, rawHave: 100 }] }),
        comp({ code: 'H1-2TRVNUT', need: 140, have: 0, short: 140, actions: [{ kind: 'PO', code: 'H1-2TRVNUT', qty: 140, vendorName: 'Fastenal' }] }),
        comp({ code: 'H1-2TRVCLP', need: 70, have: 10, short: 60, actions: [{ kind: 'SHOP', code: 'H1-2TRVCLP', qty: 60 }] }),
        comp({ code: 'HTSLNTCAR', need: 140, have: 5, short: 135, unitMismatch: true, nsUnit: 'PR', appUnit: 'EA', held: true }),
        comp({ code: 'HTTENDSTOP', need: 70, have: 0, short: 70, noStockRecord: true }),
    ], shopWoIds: ['WO-SHOP-1'] });
    const by = Object.fromEntries(rows.map(r => [r.code, r]));
    eq('covered: on hand, no short, nothing to say', [by['H1-2TRVBP/P'].state, by['H1-2TRVBP/P'].onHand, by['H1-2TRVBP/P'].short, by['H1-2TRVBP/P'].coveredBy], [COVERED, 120, 0, '']);
    eq('the phosphate convert names raw → /P', [by['H1-2TRVLA/P'].state, by['H1-2TRVLA/P'].short, by['H1-2TRVLA/P'].coveredBy], [SHORT, 40, '⇄ convert 40 × H1-2TRVLA → H1-2TRVLA/P']);
    eq('on order rides the row', by['H1-2TRVLA/P'].onOrder, 50);
    eq('a PO names the vendor', by['H1-2TRVNUT'].coveredBy, '🧾 PO · Fastenal · 140 × H1-2TRVNUT');
    eq('a shop action takes the work order the make-up raised, in order', by['H1-2TRVCLP'].coveredBy, '🏭 shop WO-SHOP-1 · 60 × H1-2TRVCLP');
    eq('a unit mismatch is UNVERIFIED — no number pretends to be a fact', [by['HTSLNTCAR'].state, by['HTSLNTCAR'].onHand, by['HTSLNTCAR'].short], [UNVERIFIED, null, null]);
    ok('…and says why', /units disagree \(NetSuite PR · app EA\)/.test(by['HTSLNTCAR'].coveredBy));
    eq('no inventory row at this location is UNVERIFIED too', [by['HTTENDSTOP'].state, by['HTTENDSTOP'].coveredBy], [UNVERIFIED, '⚠ no inventory row at this location']);
    eq('shorts first, then unverified, then covered — the person reads the problem first', rows.map(r => r.state), [SHORT, SHORT, SHORT, UNVERIFIED, UNVERIFIED, COVERED]);

    // the same code on two configurations is ONE row, need summed against one shelf
    const two = materialRowsOf({ components: [comp({ code: 'HCUMB410', need: 6, have: 10, short: 0 }), comp({ code: 'HCUMB410', need: 6, have: 10, short: 0 })] });
    eq('one row per code, need summed, short recomputed against the shelf', [two.length, two[0].need, two[0].onHand, two[0].short, two[0].state], [1, 12, 10, 2, SHORT]);

    // no components at all (a door that never read stock) → the pull lines, unverified
    const bare = materialRowsOf({ planLines: [{ legacyErpId: 'H1-1R', partName: 'Rod', quantity: 4 }, { legacyErpId: 'H1-1R', quantity: 2 }] });
    eq('without a stock read every line is UNVERIFIED and says so', [bare.length, bare[0].need, bare[0].state, bare[0].coveredBy], [1, 6, UNVERIFIED, 'stock not read at release']);

    // the pole decision (Q5)
    const cut = materialRowsOf({ components: [comp({ code: 'H1-1R-6', need: 20, have: 4, short: 16, actions: [] })], poleChoice: { pullErp: 'H1-1R-6', pullFt: 6, need: 20, have: 4, short: 16, chosen: 'CUT' }, gate: { awaitingRodCut: true, rodCutNote: '8 × H1-1R-8 → 16 × H1-1R-6' } });
    eq('a cut chosen for a short pole is said on its row', cut[0].coveredBy, '✂ cut · 8 × H1-1R-8 → 16 × H1-1R-6');
    const wait = materialRowsOf({ components: [comp({ code: 'H1-1R-6', need: 20, have: 4, short: 16 })], poleChoice: { pullErp: 'H1-1R-6', pullFt: 6, need: 20, have: 4, short: 16, chosen: 'BACKORDER' }, backOrder: '16 × H1-1R-6 short (4 on hand of 20) — waiting for the 6 ft length' });
    ok('a back order chosen for it is said on its row', /⏳ back order — 16 × H1-1R-6 short/.test(wait[0].coveredBy));
    const rcpt = materialRowsOf({ components: [comp({ code: 'H1-2TRVNUT', need: 140, have: 0, short: 140, actions: [{ kind: 'PO', code: 'H1-2TRVNUT', qty: 140, vendorName: 'V' }] })], gate: { awaitingReceipt: true, receiptGateNote: '140 × H1-2TRVNUT' } });
    ok('a receipt gate is added to the short rows', /📦 waiting on material — 140 × H1-2TRVNUT/.test(rcpt[0].coveredBy));
    eq('the stamp carries the rows and when they were read; nothing when there are none', [Object.keys(materialStampOf(rows, 5)), materialStampOf([], 5)], [['materialRows', 'materialAsOf', 'materialRefreshedAt'], {}]);
}

// ── FROM RTG'S WHOLE-ORDER SPLIT ───────────────────────────────────────────────────────────
{
    const lines = [
        { legacyErpId: 'H1-1CP-R/EP2', partName: 'Plated cap', qty: 35 },              // plated — only the finished code counts
        { legacyErpId: 'H1-138BS/P', partName: 'Painted stem', qty: 35 },              // painted — finished, /P or raw all count
        { legacyErpId: 'H1-138BS/P', partName: 'Painted stem', qty: 35 },              // twice → one row of 70
        { legacyErpId: 'HTTENDSTOP', partName: 'End stop', qty: 70 },
    ];
    const stock = { unitsKnown: true, map: { 'H1-1CP-R/EP2': { available: 20, onOrder: 40 }, 'H1-138BS/P': { available: 10, onOrder: 0 }, 'H1-138BS': { available: 100, onOrder: 0 } } };
    const plan = { backorder: [{ code: 'H1-1CP-R/EP2', qty: 15, kind: 'plated' }] };
    const rows = materialRowsFromSplit({ lines, plan, stock, recipe: 'P26' });
    const by = Object.fromEntries(rows.map(r => [r.code, r]));
    eq('a plated line is short against its own finished code and names the back order', [by['H1-1CP-R/EP2'].state, by['H1-1CP-R/EP2'].onHand, by['H1-1CP-R/EP2'].short, by['H1-1CP-R/EP2'].onOrder, by['H1-1CP-R/EP2'].coveredBy], [SHORT, 20, 15, 40, '⏳ BACK ORDER — recorded on the sales order']);
    eq('a painted line sums its cover codes, two configurations summed against one shelf', [by['H1-138BS/P'].need, by['H1-138BS/P'].onHand, by['H1-138BS/P'].state], [70, 110, COVERED]);
    ok('…and the cover codes ride on the row for the morning refresh', by['H1-138BS/P'].coverCodes.includes('H1-138BS') && by['H1-138BS/P'].coverCodes.includes('H1-138BS/P'));
    eq('a code with no inventory row is UNVERIFIED', [by['HTTENDSTOP'].state, by['HTTENDSTOP'].onHand], [UNVERIFIED, null]);
    eq('no stock read at all → every row UNVERIFIED', materialRowsFromSplit({ lines, plan: null, stock: null }).every(r => r.state === UNVERIFIED), true);
}

// ── THE MORNING REFRESH ────────────────────────────────────────────────────────────────────
{
    const rows = [
        { code: 'H1-2TRVNUT', need: 140, onHand: 0, short: 140, onOrder: 140, state: SHORT, coveredBy: '🧾 PO · Fastenal · 140 × H1-2TRVNUT', coverCodes: ['H1-2TRVNUT'] },
        { code: 'H1-138BS/P', need: 70, onHand: 110, short: 0, onOrder: 0, state: COVERED, coveredBy: '✔ on the shelf (finished, /P or raw)', coverCodes: ['H1-138BS/P', 'H1-138BS'] },
        { code: 'GONE', need: 5, onHand: 5, short: 0, onOrder: 0, state: COVERED, coveredBy: '', coverCodes: ['GONE'] },
    ];
    const avail = { unitsKnown: true, map: { 'H1-2TRVNUT': { available: 140, onOrder: 0 }, 'H1-138BS/P': { available: 0, onOrder: 0 }, 'H1-138BS': { available: 30, onOrder: 200 } } };
    const { rows: out, changed } = refreshMaterialRows(rows, avail);
    eq('the PO arrived: on hand up, short gone, covered — and covered-by is left as the release wrote it', [out[0].onHand, out[0].short, out[0].state, out[0].coveredBy], [140, 0, COVERED, '🧾 PO · Fastenal · 140 × H1-2TRVNUT']);
    eq('a painted row is re-summed over its cover codes, and turns SHORT when the shelf drops', [out[1].onHand, out[1].onOrder, out[1].short, out[1].state], [30, 200, 40, SHORT]);
    eq('a code the read no longer knows reads UNVERIFIED, never a number', [out[2].onHand, out[2].short, out[2].state], [null, null, UNVERIFIED]);
    eq('changed says something moved', changed, true);
    eq('nothing moved → unchanged', refreshMaterialRows([rows[0]], { unitsKnown: true, map: { 'H1-2TRVNUT': { available: 0, onOrder: 140 } } }).changed, false);
    eq('units unreadable → every row UNVERIFIED', refreshMaterialRows(rows, { unitsKnown: false, map: avail.map }).rows.every(r => r.state === UNVERIFIED), true);
    eq('the codes to read include the cover codes, once each', materialCodesOf([{ materialRows: rows }, { materialRows: [rows[1]] }]).sort(), ['GONE', 'H1-138BS', 'H1-138BS/P', 'H1-2TRVNUT']);

    // which documents may be refreshed — only while nothing has been pulled for them
    const fin = (o) => ({ materialRows: rows, currentPhase: 'Setup', status: 'Pending', pickStatus: 'Pending', ...o });
    eq('a finishing doc at Setup, pick pending → yes', materialRefreshable(fin({}), 'fin_workorders'), true);
    eq('…in the pick queue but not picked → still yes (the picker needs the truth)', materialRefreshable(fin({ sentToPickPack: true }), 'fin_workorders'), true);
    eq('…picked → no (the shelf dropped because of THIS order)', materialRefreshable(fin({ pickStatus: 'Picked_Awaiting_Staging' }), 'fin_workorders'), false);
    eq('…packed, closed, or without a grid → no', [materialRefreshable(fin({ packStatus: 'Packed' }), 'fin_workorders'), materialRefreshable(fin({ currentPhase: 'Closed' }), 'fin_workorders'), materialRefreshable({ currentPhase: 'Setup' }, 'fin_workorders')], [false, false, false]);
    eq('a shop doc pending → yes; started → no', [materialRefreshable({ materialRows: rows, status: 'Pending' }, 'shop_custom_orders'), materialRefreshable({ materialRows: rows, status: 'In Process' }, 'shop_custom_orders')], [true, false]);
    eq('an RTG record still parked → yes; dispatched → no', [materialRefreshable({ materialRows: rows, status: 'Approved' }, 'hq_work_orders'), materialRefreshable({ materialRows: rows, status: 'Dispatched' }, 'hq_work_orders')], [true, false]);

    // when the morning run is due
    const at = (h, m = 0) => { const d = new Date(2026, 8, 23, h, m); return d.getTime(); };
    eq('before six: never', refreshDue(null, at(5, 59)), false);
    eq('after six with no record: due', refreshDue(null, at(6, 1)), true);
    eq('already run today: not again', refreshDue({ lastRunDay: refreshDayKey(at(6, 1)) }, at(14)), false);
    eq('run yesterday: due', refreshDue({ lastRunDay: '2026-09-22' }, at(9)), true);
    eq('another session started it five minutes ago: not again', refreshDue({ lastRunDay: '2026-09-22', running: { at: at(8, 55) } }, at(9)), false);
    eq('…but a run that hung for an hour is not a lock', refreshDue({ lastRunDay: '2026-09-22', running: { at: at(7) } }, at(9)), true);
    eq('the age line', [materialAgeText(at(9) - 5 * 60000, at(9)), materialAgeText(at(9) - 3 * 3600000, at(9)), materialAgeText(at(9) - 2 * 86400000, at(9)), materialAgeText(null)], ['5 min ago', '3 h ago', '2 days ago', '']);
}

console.log(`materialGrid: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
