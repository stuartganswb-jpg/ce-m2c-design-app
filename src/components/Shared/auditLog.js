// ── THE AUDIT LOG — what happened, where, by whom, what the app says and what NETSUITE says (Stuart 2026-10-03) ──
// "i think we need a stronger audit log, at bottom of RTG … what page, item/qty affect, whom did it, what it states
//  on page, what it states in Netsuite (WO, SO, IA, etc) add a orange text on any netsuite transaction that may be
//  questionable that it went thru."
//
// The day it was asked for, WO11639 was the case in point: the app said "build skipped, never posted"; NetSuite had
// Assembly Build ASSYB10633 × 192 against the work order (made by hand), and the app's scrap adjustment IA27606 —
// POSTED in the queue, number written back — was in NetSuite no more. Neither screen could say so.
//
// One row per event, from what the app already keeps (history from 7/17):
//   · NS_QUEUE  — every NetSuite write the app queued (ns_outbox): WO, build, SO, estimate, IA, IR, IF, bin transfer;
//   · NS_DIRECT — the few NetSuite writes that skip the queue (the /P convert RESTlet, record updates), logged from
//                 2026-10-03 by Shared/nsProxy into hq_logs (audit.kind 'NS_DIRECT');
//   · APP / FLOOR — the apps' activity logs (hq_logs) and the finishing floor's punches (fin_logs);
//   · DELETION  — the master deletion ledger;
//   · EXPECTED  — something the app did that should have produced a NetSuite transaction and has none: a packed job
//                 the server builds with no build posted or queued (Shared/skippedBuild.buildRepairOf), a plating
//                 return received with no item receipt.
// Colours: red = it did NOT go through (FAILED); orange = it MAY not have — still waiting after 10 minutes, posted
// with no number back, the app record never got the number, posted for an order the app had closed, not found /
// voided / a different quantity when read back from NetSuite, or expected and missing; green ✓ = read back from
// NetSuite and it matches. Nothing here writes anything — the NetSuite read-back is a SuiteQL read.
// Pure. Harness: scripts/auditLog.test.mjs.

import { buildRepairOf } from './skippedBuild.js';

const U = (v) => String(v == null ? '' : v).trim().toUpperCase();
const N = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
export const STUCK_MINUTES = 10;
export const RECEIPT_GRACE_MINUTES = 30;

/** A Firestore Timestamp, a Date, a number or nothing → ms. */
export const msOf = (t) => {
    if (t == null) return null;
    if (typeof t === 'number') return t;
    if (t instanceof Date) return t.getTime();
    if (typeof t.toMillis === 'function') return t.toMillis();
    if (typeof t.seconds === 'number') return t.seconds * 1000 + Math.floor((t.nanoseconds || 0) / 1e6);
    const n = Date.parse(t);
    return Number.isFinite(n) ? n : null;
};

// ── NetSuite record types ────────────────────────────────────────────────────────────────────────────────────
const KIND_LABEL = {
    workorder: 'Work Order', workordercompletion: 'Assembly Build', assemblybuild: 'Assembly Build',
    salesorder: 'Sales Order', estimate: 'Estimate', inventoryadjustment: 'Inventory Adj.',
    itemreceipt: 'Item Receipt', itemfulfillment: 'Item Fulfillment', bintransfer: 'Bin Transfer',
    purchaseorder: 'Purchase Order', invoice: 'Invoice', inventorytransfer: 'Inventory Transfer',
    customer: 'Customer', vendor: 'Vendor', inventoryitem: 'Item', assemblyitem: 'Item', noninventoryitem: 'Item',
};
/** SuiteQL's transaction.type codes. */
export const NS_TYPE_CODE = {
    WorkOrd: 'Work Order', Build: 'Assembly Build', Unbuild: 'Unbuild', SalesOrd: 'Sales Order', Estimate: 'Estimate',
    InvAdjst: 'Inventory Adj.', ItemRcpt: 'Item Receipt', ItemShip: 'Item Fulfillment', BinTrnfr: 'Bin Transfer',
    PurchOrd: 'Purchase Order', CustInvc: 'Invoice', InvTrnfr: 'Inventory Transfer', CashSale: 'Cash Sale',
};

/** What NetSuite record a queue entry / direct call makes. */
export const nsTypeOf = (kind, targetUrl) => {
    const k = String(kind || '').toLowerCase();
    if (KIND_LABEL[k]) return KIND_LABEL[k];
    const url = String(targetUrl || '');
    if (/restlet/i.test(url)) return 'RESTlet (convert build)';
    const m = url.match(/\/record\/v1\/([a-zA-Z]+)(?:\/[^/?]+\/!transform\/([a-zA-Z]+))?/);
    if (m) { const r = String(m[2] || m[1]).toLowerCase(); return KIND_LABEL[r] || r; }
    return k || 'NetSuite write';
};

// ── pages ────────────────────────────────────────────────────────────────────────────────────────────────────
const SOURCE_PAGE = {
    HQ: 'HQ', WMS: 'WMS', FINISHING: 'Finishing floor', RTG: 'RTG', QUICKSHIP: 'Quick Ship (tab 7)', SHOP: 'Shop',
    MASTER_LIBRARY: 'Master Library', ORDER_ENTRY: 'Order Entry', CPQ: 'CPQ', CRM: 'CRM',
    'ORDER_ENTRY-PRECHECK': 'Order Entry · precheck', 'STOCKVIEW_GRID-PRECHECK': 'Stock View · precheck',
    RTG_ANCHOR_REVIEW: 'RTG · anchor review',
};
const CAT_PAGE = { wms: 'WMS', packing: 'WMS · Packing', setup: 'Finishing', recipes: 'Finishing · Recipes', paint: 'Finishing' };

/** The page a record names: its own stamp first (from 2026-10-03), else the app it came from. */
export const pageOf = (sourceApp, page) => {
    if (page) return String(page);
    const s = String(sourceApp || '');
    return SOURCE_PAGE[U(s)] || s || '—';
};

// ── item × qty ───────────────────────────────────────────────────────────────────────────────────────────────
const ITEM = '[A-Z0-9][A-Z0-9/.\\-]*[A-Z0-9]';
const NUM = '[−-]?\\d+(?:\\.\\d+)?';
const ITEM_QTY_RE = new RegExp(`(${ITEM})\\s*[×x]\\s*(${NUM})(?![A-Z0-9])`);
const QTY_ITEM_RE = new RegExp(`(${NUM})\\s*[×x]\\s*(${ITEM})`);
const num = (s) => Number(String(s).replace('−', '-'));

/** The item and quantity a label / message names ("Scrap −248 × HCUSR15", "build HCUSR15/SG-EA ×440"). */
export const itemQtyOf = (text, payload = null) => {
    const t = String(text || '');
    let item = '', qty = null;
    let m = t.match(ITEM_QTY_RE);
    if (m && /[A-Z]/i.test(m[1])) { item = m[1]; qty = num(m[2]); }
    else {
        m = t.match(QTY_ITEM_RE);
        if (m && /[A-Z]/i.test(m[2])) { qty = num(m[1]); item = m[2]; }
    }
    if (qty == null && payload && N(payload.quantity) != null) qty = N(payload.quantity);
    return { item: item ? U(item) : '', qty };
};

// ── rows ─────────────────────────────────────────────────────────────────────────────────────────────────────
/** One NetSuite queue entry. */
export const rowFromOutbox = (e) => {
    const wb = e.writeBack && e.writeBack.collection && e.writeBack.docId ? e.writeBack : null;
    return {
        key: `ob:${e.id}`, at: N(e.createdAt), source: 'NS_QUEUE',
        page: pageOf(e.sourceApp, e.page), who: e.createdBy || '',
        action: e.label || e.kind || '', ...itemQtyOf(e.label, e.payload),
        appRef: wb ? { coll: wb.collection, id: String(wb.docId) } : null,
        ns: {
            type: nsTypeOf(e.kind, e.targetUrl), kind: e.kind || '', status: e.status || '',
            id: e.nsId ? String(e.nsId) : '', tran: e.nsTran || '', error: e.lastError || '', attempts: N(e.attempts) || 0,
            postedAt: N(e.postedAt), nextAttemptAt: N(e.nextAttemptAt), writeBack: wb,
            closedOrder: e.postedForClosedOrder === true && !e.postedForClosedOrderAckAt,
        },
        raw: e,
    };
};

/** One activity-log line (hq_logs) — an app event, or (from 2026-10-03) a direct NetSuite call. */
export const rowFromHqLog = (l) => {
    const at = msOf(l.t);
    const a = l.audit || null;
    const page = l.page || (l.app === 'HQ' ? `HQ${l.tab ? ` · ${l.tab}` : ''}` : (l.src ? pageOf(l.src) : (CAT_PAGE[l.cat] || (l.cat ? `(${l.cat})` : '—'))));
    const text = String(l.msg || l.action || '');
    if (a && a.kind === 'NS_DIRECT') {
        return {
            key: `hl:${l.id}`, at, source: 'NS_DIRECT', page, who: l.u || '', action: text, ...itemQtyOf(text, a.payloadQty != null ? { quantity: a.payloadQty } : null),
            appRef: null,
            ns: { type: nsTypeOf(a.recordKind, a.targetUrl), kind: a.recordKind || '', status: a.ok ? 'POSTED' : 'FAILED', id: a.nsId ? String(a.nsId) : '', tran: '', error: a.error || (a.ok ? '' : `HTTP ${a.httpStatus || '?'}`), attempts: 1, direct: true, httpStatus: a.httpStatus || null },
            raw: l,
        };
    }
    return { key: `hl:${l.id}`, at, source: 'APP', page, who: l.u || '', action: text, ...itemQtyOf(text), appRef: null, ns: null, raw: l };
};

/** One finishing-floor log line (fin_logs). */
export const rowFromFinLog = (l) => {
    const text = String(l.msg || [l.action, l.task, l.woRefNo || l.woId].filter(Boolean).join(' · '));
    return {
        key: `fl:${l.id}`, at: N(l.at) || msOf(l.t), source: 'FLOOR',
        page: `Finishing floor${l.station ? ` · ${l.station}` : ''}`, who: l.u || '', action: text, ...itemQtyOf(text),
        appRef: l.woId ? { coll: 'fin_workorders', id: String(l.woId) } : null, ns: null, raw: l,
    };
};

/** One deletion-ledger entry. */
export const rowFromDeletion = (d) => ({
    key: `del:${d.id}`, at: N(d.at), source: 'DELETION', page: pageOf(d.from), who: d.by || '',
    action: `${d.mode === 'HARD' ? 'Destroyed' : 'Deleted'} ${d.collection || ''}/${d.docId || ''}${d.reason ? ` — ${d.reason}` : ''}`,
    item: '', qty: null, appRef: null, ns: null, raw: d,
});

/** A packed job the server builds in NetSuite, with no build posted and none in the queue. */
export const expectedBuildRowOf = (fin) => {
    const r = buildRepairOf(fin);
    if (!r) return null;
    return {
        key: `exp:build:${fin.id}`, at: N(fin.packedAt) || msOf(fin.packedAt), source: 'EXPECTED',
        page: r.sales ? 'WMS · Pack' : 'WMS · Put-away', who: fin.packedBy || '',
        action: `Packed — NetSuite build expected against ${r.ref}${fin.forceCompletedBy ? ` (force-completed by ${fin.forceCompletedBy})` : ''}`,
        item: U(r.builds), qty: r.qty,
        appRef: { coll: 'fin_workorders', id: String(fin.id) },
        ns: { type: 'Assembly Build', kind: 'workordercompletion', status: 'MISSING', id: '', tran: '', woId: String(fin.nsWoId), woTran: r.ref, markedBuilt: r.markedBuilt },
        raw: fin,
    };
};

/** A plating return received with no item receipt posted. */
export const expectedReceiptRowOf = (line, { now = Date.now() } = {}) => {
    if (!line || line.status !== 'received' || line.itemReceiptPosted === true || line.itemReceiptId) return null;
    const at = N(line.receivedAtMs) || msOf(line.receivedAt);
    if (at && now - at < RECEIPT_GRACE_MINUTES * 60000) return null;
    return {
        key: `exp:ir:${line.id}`, at, source: 'EXPECTED', page: 'WMS · Plating', who: line.operator || '',
        action: `Plating return received — item receipt expected against ${line.nsPoTran || 'the plating PO'}`,
        item: U(line.targetErpId || line.erpId), qty: N(line.qty),
        appRef: { coll: 'plating_shipments', id: String(line.id) },
        ns: { type: 'Item Receipt', kind: 'itemreceipt', status: 'MISSING', id: '', tran: '', poId: line.nsPoId ? String(line.nsPoId) : '' },
        raw: line,
    };
};

// ── what the app says ────────────────────────────────────────────────────────────────────────────────────────
/** One line on what the app record says now. */
export const appSaysOf = (coll, d) => {
    if (d === undefined) return '';
    if (!d) return 'record not found in the app';
    const bits = [];
    if (coll === 'fin_workorders') {
        bits.push(d.nsWoTran || d.woNum || d.id);
        if (d.closed) bits.push('closed'); else if (d.currentPhase) bits.push(d.currentPhase);
        if (d.packStatus) bits.push(`${d.packStatus}${d.putawayBin ? ` → ${d.putawayBin}` : ''}`);
        if (N(d.totalParts)) bits.push(`${N(d.completedParts) != null ? `${N(d.completedParts)} good of ` : ''}${N(d.totalParts)}`);
        if (d.nsWoCompletionTran) bits.push(`build ${d.nsWoCompletionTran}`);
        else if (d.forceCompleteNsBuildSkipped === true) bits.push('build SKIPPED (marked already built)');
        else if (d.nsWoCompletionPosted) bits.push('build posted');
        if (d.forceCompletedBy) bits.push(`force-completed by ${d.forceCompletedBy}`);
    } else if (coll === 'plating_shipments') {
        bits.push(`${d.status || '—'}`, d.itemReceiptPosted ? `receipt posted${d.itemReceiptId ? ` (${d.itemReceiptId})` : ''}` : 'no receipt posted');
    } else if (coll === 'hq_purchase_orders') {
        bits.push(d.poId || d.id, d.status || '', d.nsPoTran ? `NetSuite ${d.nsPoTran}` : '');
    } else if (coll === 'hq_work_orders' || coll === 'hq_sales_orders') {
        bits.push(d.woDisplayId || d.soId || d.id, d.status || '', d.nsWoTran || d.nsTran ? `NetSuite ${d.nsWoTran || d.nsTran}` : '');
    } else {
        bits.push(d.status || d.currentPhase || 'exists');
        const t = d.nsTran || d.netsuiteTranId || d.nsWoTran || d.nsPoTran;
        if (t) bits.push(`NetSuite ${t}`);
    }
    return bits.filter(Boolean).join(' · ');
};

/** Did the queue's write-back land on the app record? true / false / null (not known). */
export const writeBackLanded = (wb, d) => {
    if (!wb || !d) return null;
    const patch = wb.patch && typeof wb.patch === 'object' ? wb.patch : {};
    const patchOk = Object.entries(patch).every(([k, v]) => (typeof v === 'object' ? true : d[k] === v));
    const idOk = !wb.idField || !!d[wb.idField];
    const tranOk = !wb.tranField || !!d[wb.tranField];
    return patchOk && idOk && tranOk;
};

// ── reading NetSuite back (SuiteQL, read-only) ───────────────────────────────────────────────────────────────
const ids = (list) => [...new Set((list || []).map(String).filter(s => /^\d+$/.test(s)))];
export const txQueryOf = (list) => { const i = ids(list); return i.length ? `SELECT t.id, t.tranid, t.type, BUILTIN.DF(t.status) AS st, t.trandate, t.voided FROM transaction t WHERE t.id IN (${i.join(',')})` : ''; };
export const linesQueryOf = (list) => { const i = ids(list); return i.length ? `SELECT tl.transaction AS tr, tl.mainline AS ml, BUILTIN.DF(tl.item) AS item, tl.quantity AS q FROM transactionline tl WHERE tl.transaction IN (${i.join(',')}) AND tl.item IS NOT NULL` : ''; };
export const buildLinksQueryOf = (woIds) => { const i = ids(woIds); return i.length ? `SELECT DISTINCT l.previousdoc AS wo, l.nextdoc AS id, BUILTIN.DF(l.nextdoc) AS nx FROM PreviousTransactionLineLink l WHERE l.previousdoc IN (${i.join(',')}) AND l.linktype = 'OrdBuild'` : ''; };
/** The ids a read-back needs: every NetSuite transaction the rows name, and every work order an expected build points at. */
export const verifyTargetsOf = (rows) => ({
    txIds: ids((rows || []).filter(r => r.ns && r.ns.id).map(r => r.ns.id)),
    woIds: ids((rows || []).filter(r => r.source === 'EXPECTED' && r.ns && r.ns.woId).map(r => r.ns.woId)),
});
export const QTY_CHECKED = ['WorkOrd', 'Build', 'InvAdjst', 'ItemRcpt', 'ItemShip', 'BinTrnfr'];
const MAINLINE_QTY = ['WorkOrd', 'Build'];
export const itemMatches = (nsName, code) => { const a = U(nsName), b = U(code); return !!a && !!b && (a === b || a.endsWith(` : ${b}`) || a.startsWith(`${b} `)); };
const statusShort = (st) => { const s = String(st || '').split(' : ').pop(); return /undefined/i.test(s) ? '' : s; };

/**
 * Index the SuiteQL answers: tx rows, line rows, build-link rows → lookups the verdicts read.
 * A transaction the query did not return is ABSENT (complete knowledge: the ids were asked for by number).
 */
export const indexReadBack = ({ tx = [], lines = [], links = [], linesComplete = true } = {}) => {
    const txById = {}; tx.forEach(t => { txById[String(t.id)] = t; });
    const linesById = {}; lines.forEach(l => { (linesById[String(l.tr)] = linesById[String(l.tr)] || []).push(l); });
    const buildsByWo = {};
    links.forEach(l => {
        const list = (buildsByWo[String(l.wo)] = buildsByWo[String(l.wo)] || []);
        if (!list.some(b => b.id === String(l.id))) list.push({ id: String(l.id), tranid: (String(l.nx || '').match(/#(\S+)/) || [])[1] || String(l.id) });
    });
    // A line read NetSuite cut short (hasMore) is never used to call a quantity different — the validator rule.
    return { txById, linesById, buildsByWo, linesComplete: linesComplete !== false };
};

/** What NetSuite says about one row, once read back. null = nothing to read. */
export const verifyVerdictOf = (row, idx) => {
    if (!row || !row.ns || !idx) return null;
    if (row.source === 'EXPECTED' && row.ns.woId) {
        const builds = idx.buildsByWo[row.ns.woId] || [];
        if (!builds.length) return { found: false, text: `no build in NetSuite against ${row.ns.woTran} either` };
        const qtys = builds.map(b => (idx.linesById[b.id] || []).filter(l => l.ml === 'T').reduce((s, l) => s + Math.abs(Number(l.q) || 0), 0));
        const total = qtys.reduce((s, q) => s + q, 0);
        const text = `built in NetSuite outside the app: ${builds.map((b, i) => `${b.tranid}${qtys[i] ? ` ×${qtys[i]}` : ''}`).join(', ')}`;
        const mismatch = idx.linesComplete && row.qty != null && total > 0 && total !== Math.abs(row.qty);
        return { found: true, outside: true, text, ...(mismatch ? { qtyMismatch: `NetSuite built ${total}, the app counted ${Math.abs(row.qty)} good` } : {}) };
    }
    if (!row.ns.id) return null;
    const t = idx.txById[row.ns.id];
    if (!t) return { found: false, text: `NOT FOUND in NetSuite (internal id ${row.ns.id}${row.ns.tran ? `, ${row.ns.tran}` : ''}) — deleted there?` };
    const label = NS_TYPE_CODE[t.type] || t.type || '';
    const st = statusShort(t.st);
    const text = `${label} ${t.tranid || ''}${st ? ` · ${st}` : ''}${t.trandate ? ` · ${t.trandate}` : ''}`.trim();
    if (String(t.voided) === 'T') return { found: true, voided: true, text: `${text} · VOIDED` };
    if (idx.linesComplete && row.item && row.qty != null && QTY_CHECKED.includes(t.type)) {
        const main = MAINLINE_QTY.includes(t.type);
        const cand = (idx.linesById[row.ns.id] || []).filter(l => (main ? l.ml === 'T' : l.ml !== 'T') && itemMatches(l.item, row.item));
        if (cand.length && !cand.some(l => Math.abs(Number(l.q)) === Math.abs(row.qty))) {
            return { found: true, text, qtyMismatch: `NetSuite shows ${[...new Set(cand.map(l => Math.abs(Number(l.q))))].join(' / ')} × ${row.item}, the app says ${Math.abs(row.qty)}` };
        }
        if (cand.length) return { found: true, text, qtyMatched: true };
    }
    return { found: true, text };
};

// ── the colour ───────────────────────────────────────────────────────────────────────────────────────────────
const LIVE = ['PENDING', 'PROCESSING', 'POSTING', 'WAITING'];
/**
 * { level, reasons } — level 'red' (did not go through) · 'orange' (may not have) · 'ok' (read back, matches) ·
 * 'posted' (posted, not read back yet) · 'info' (an app event, nothing sent to NetSuite) · 'cancelled'.
 */
export const flagsOf = (row, { now = Date.now(), appDoc, verify } = {}) => {
    if (!row || !row.ns) return { level: 'info', reasons: [] };
    const ns = row.ns, reasons = [];
    if (row.source === 'EXPECTED') {
        if (verify && verify.found && verify.outside) {
            if (verify.qtyMismatch) return { level: 'orange', reasons: [verify.qtyMismatch, 'the app never recorded this build'] };
            return { level: 'ok', reasons: ['built in NetSuite outside the app — the app record still says not posted'] };
        }
        if (ns.kind === 'itemreceipt') reasons.push(`received in the WMS ${RECEIPT_GRACE_MINUTES}+ min ago, no item receipt posted`);
        else reasons.push(ns.markedBuilt ? 'marked ALREADY BUILT at force-complete — not verified in NetSuite' : 'packed, but no build was posted or queued');
        if (verify && verify.found === false) reasons.push(verify.text);
        return { level: 'orange', reasons };
    }
    if (ns.status === 'FAILED') return { level: 'red', reasons: [ns.direct ? `the direct NetSuite call failed${ns.error ? ` — ${ns.error}` : ''}` : `FAILED in the NetSuite queue — did not go through${ns.error ? ` (${String(ns.error).slice(0, 200)})` : ''}`] };
    if (ns.status === 'CANCELLED') return { level: 'cancelled', reasons: ['cancelled — nothing was sent'] };
    if (LIVE.includes(ns.status)) {
        const mins = row.at ? Math.round((now - row.at) / 60000) : 0;
        if (mins >= STUCK_MINUTES) return { level: 'orange', reasons: [`still ${ns.status} in the queue after ${mins} min${ns.attempts ? ` (try ${ns.attempts})` : ''}`] };
        return { level: 'posted', reasons: [`${ns.status.toLowerCase()} — the queue drains about one a minute`] };
    }
    // POSTED
    if (!ns.id && !ns.tran) reasons.push('posted, but no NetSuite number came back');
    if (ns.writeBack && appDoc !== undefined && writeBackLanded(ns.writeBack, appDoc) === false) reasons.push('posted, but the app record never got the number (write-back missing)');
    if (ns.closedOrder) reasons.push('posted after the order was closed in the app — close it in NetSuite');
    if (verify) {
        if (verify.found === false) reasons.push(verify.text);
        if (verify.voided) reasons.push('VOIDED in NetSuite');
        if (verify.qtyMismatch) reasons.push(verify.qtyMismatch);
    }
    if (reasons.length) return { level: 'orange', reasons };
    if (verify && verify.found) return { level: 'ok', reasons: [verify.qtyMatched ? 'read back from NetSuite — quantity matches' : 'read back from NetSuite'] };
    return { level: 'posted', reasons: [] };
};

export const QUESTIONABLE = ['red', 'orange'];
export const isNsRow = (row) => ['NS_QUEUE', 'NS_DIRECT', 'EXPECTED'].includes(row && row.source);

/** The view's filter. `levelOf(row)` gives the row's current colour. */
export const filterRows = (rows = [], { page = '', who = '', q = '', nsOnly = false, questionableOnly = false } = {}, levelOf = () => 'info') => {
    const needle = U(q);
    return rows.filter(r => {
        if (page && r.page !== page && !String(r.page).startsWith(`${page} ·`)) return false;
        if (who && r.who !== who) return false;
        if (nsOnly && !isNsRow(r)) return false;
        if (questionableOnly && !QUESTIONABLE.includes(levelOf(r))) return false;
        if (needle) {
            const hay = U([r.action, r.item, r.who, r.page, r.ns && r.ns.tran, r.ns && r.ns.woTran, r.ns && r.ns.id, r.appRef && r.appRef.id].filter(Boolean).join(' '));
            if (!needle.split(/\s+/).every(w => hay.includes(w))) return false;
        }
        return true;
    });
};

/** The app's page names for the page filter — "HQ · 8. CPQ" counts under "HQ". */
export const pageGroupsOf = (rows = []) => [...new Set(rows.map(r => String(r.page || '').split(' · ')[0]).filter(s => s && s !== '—'))].sort();
