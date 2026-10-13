// ── THE DAY'S ORDERS, AS MANAGEMENT READS THEM (Stuart 2026-10-12) ───────────────────────────────────────────────────
// "can we create a screen for end of day summary of orders entered and their status from both sales entry and cpq, so
//  that management can see what has happened and overrule. this way cpq stays the same but management can override it
//  and start an order if necessary. same for sales order entry maybe csr enters it to ship complete but it needs to be
//  finished as available, also it would help each backordered parts the day they occur."
// One screen on RTG — the master of order details — for one day: every sales order entered that day from EITHER door,
// what NetSuite said, how it finishes (complete / as available, and who chose), what has started and where it stands,
// what is waiting on a person and why — and every part that went on backorder that day, across all orders.
// It reads the feeds the board already holds and decides nothing: each state is the one RTG's own card shows
// (Shared/orderStatus gates, Shared/reviewWaiting, the split's backorder record), and the overrule buttons on the
// screen are the card's own. Pure — scripts/daySummary.test.mjs.
import { gateSummary, isReleasable, wholeOrderWait, finishModeOf, FINISH_MODE, unstartedTbfLinesOf } from './orderStatus.js';
import { stockToReallocateText, REALLOCATE_WORD, orderLine, holdersText } from './stockReallocate.js';
import { reviewWaitingOf } from './reviewWaiting.js';

const U = (v) => String(v == null ? '' : v).trim().toUpperCase();
const N = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
export const msOf = (v) => (v && typeof v.toMillis === 'function') ? v.toMillis() : (v && typeof v.seconds === 'number' ? v.seconds * 1000 : (typeof v === 'number' ? v : (v ? (Date.parse(v) || 0) : 0)));
const pad = (n) => String(n).padStart(2, '0');
/** 'YYYY-MM-DD' of a moment, in the screen's own time zone. */
export const dayStrOf = (ms = Date.now()) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
/** The day's bounds: local midnight to the next. */
export const dayBoundsOf = (dayStr) => {
    const m = String(dayStr || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(new Date().setHours(0, 0, 0, 0));
    const start = d.getTime();
    return { start, end: new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime() };
};

const DEAD = ['Closed', 'Deleted', 'CANCELLED'];
export const DOOR = Object.freeze({ OE: 'Order Entry', CPQ: 'CPQ', DISPLAY: 'Display (10.5)' });
export const VERDICT = Object.freeze({
    NETSUITE: 'WAITING ON NETSUITE', REVIEW: 'WAITING FOR REVIEW', HOLD: 'ON HOLD', PARKED: 'PARKED IN RTG', NOT_STARTED: 'NOT STARTED',
    FLOOR: 'ON THE FLOOR', STOCK: 'STOCK — PICK AND PACK', DONE: 'DONE', CLOSED: 'CLOSED',
});
const finPhaseText = (f) => (!f ? '' : (f.held ? `ON HOLD — ${String(f.heldReason || '').slice(0, 140)}` : (f.packStatus === 'Packed' ? 'packed' : String(f.currentPhase || f.status || ''))));

/** One order's work, as the board knows it: [{ id, ref, side, state, text, held }]. */
export function orderWorkOf({ so, workOrders = [], finDocs = [], shopDocs = [], refOf = (d) => (d && (d.nsWoTran || d.woDisplayId || d.id)) || '' } = {}) {
    const soNo = String((so && so.soId) || '');
    const out = [];
    const seen = new Set();
    // Order Entry / row pairs: their own RTG records, keyed to the order.
    const recs = (workOrders || []).filter(w => w && !w.deleted && w.soAppId && w.soAppId === so.id);
    recs.forEach(w => {
        const fin = (finDocs || []).find(f => f.id === w.id || f.id === (w.finPayload && w.finPayload.id)) || null;
        const shop = (shopDocs || []).find(s => s.id === `SHOP-${w.id}`) || null;
        const side = w.routeTo === 'SHOP' ? 'SHOP' : 'FINISHING';
        let state, text;
        if (DEAD.includes(String(w.status || ''))) { state = 'CLOSED'; text = 'closed'; }
        else if (w.status === 'Approved') {
            const gates = gateSummary(w);
            const wait = !gates && isReleasable(w) ? wholeOrderWait(w, recs, so) : { wait: false, reason: '' };
            state = 'PARKED'; text = gates ? `parked — ${gates}` : (wait.wait ? `parked — ${wait.reason.split(';')[0]}` : 'ready — awaiting release');
        } else { state = 'FLOOR'; text = side === 'SHOP' ? `shop: ${String((shop && shop.status) || w.floorPhase || 'on the floor')}` : `finishing: ${finPhaseText(fin) || w.floorPhase || 'on the floor'}`; }
        if (fin) seen.add(fin.id);
        if (shop) seen.add(shop.id);
        out.push({ id: w.id, ref: refOf(w), side, state, text, held: !!((fin && fin.held) || (shop && shop.held)), finish: String(w.finishGroup || w.recipe || '') });
    });
    // A CPQ order's floor documents: keyed by the sales order number (the split's ids), no RTG record of their own.
    const mine = (d) => d && !d.deleted && !seen.has(d.id) && soNo && (U(d.orderKey) === U(soNo) || U(d.salesOrderId) === U(so.id) || U(d.orderKey) === U(so.id));
    (finDocs || []).filter(mine).forEach(f => out.push({ id: f.id, ref: refOf(f), side: 'FINISHING', state: f.currentPhase === 'Closed' ? 'CLOSED' : 'FLOOR', text: `finishing: ${finPhaseText(f) || 'on the floor'}`, held: !!f.held, finish: String(f.recipe || '') }));
    (shopDocs || []).filter(mine).forEach(s => out.push({ id: s.id, ref: refOf(s), side: 'SHOP', state: s.closed ? 'CLOSED' : 'FLOOR', text: `shop: ${s.held ? `ON HOLD — ${String(s.heldReason || '').slice(0, 140)}` : String(s.status || 'on the floor')}`, held: !!s.held, finish: String(s.recipe || '') }));
    return out.sort((a, b) => a.side.localeCompare(b.side) || String(a.ref).localeCompare(String(b.ref)));
}

/**
 * THE DAY.
 * @param orders      the live sales orders (hq_sales_orders)     @param workOrders  hq_work_orders
 * @param finDocs     fin_workorders                              @param shopDocs    shop_custom_orders
 * @param start/end   the day's bounds (dayBoundsOf)              @param isOrderEntry (so) → came through Order Entry
 * @returns { rows, backorders, counts }
 */
export function daySummaryOf({ orders = [], workOrders = [], finDocs = [], shopDocs = [], start = 0, end = 0, isOrderEntry = () => false, refOf, now = Date.now() } = {}) {
    const inDay = (ms) => ms >= start && ms < end;
    const live = (orders || []).filter(o => o && !o.deleted && o.packMode !== 'DISPLAY');
    const rows = live.filter(o => inDay(msOf(o.createdAt))).map(o => {
        const door = o.displayRelease ? DOOR.DISPLAY : (isOrderEntry(o) ? DOOR.OE : DOOR.CPQ);
        const work = orderWorkOf({ so: o, workOrders, finDocs, shopDocs, ...(refOf ? { refOf } : {}) });
        const review = door === DOOR.OE ? ((reviewWaitingOf([o], { now })[0] || {}).lines || []) : [];
        const unstarted = door === DOOR.OE ? unstartedTbfLinesOf(o) : [];
        const backorders = (Array.isArray(o.backorderLines) ? o.backorderLines : []).filter(b => b && N(b.qty) > 0).map(b => ({ code: U(b.code), qty: N(b.qty), onOrder: N(b.onOrder), name: String(b.name || '') }));
        const accepted = !!o.nsInternalId;
        const closed = DEAD.includes(String(o.status || ''));
        const liveWork = work.filter(w => w.state !== 'CLOSED');
        const heldWork = work.find(w => w.held);
        const verdict = closed ? VERDICT.CLOSED
            : !accepted ? VERDICT.NETSUITE
            : heldWork ? VERDICT.HOLD
            : review.length ? VERDICT.REVIEW
            : liveWork.some(w => w.state === 'PARKED') && !liveWork.some(w => w.state === 'FLOOR') ? VERDICT.PARKED
            : liveWork.some(w => w.state === 'FLOOR') ? VERDICT.FLOOR
            : (unstarted.length || (door === DOOR.CPQ && o.status === 'Approved')) ? VERDICT.NOT_STARTED
            : work.length ? VERDICT.DONE
            : VERDICT.STOCK;
        return {
            id: o.id, ref: String(o.soId || o.id), customer: String(o.customer || o.customerName || ''), door,
            enteredAt: msOf(o.createdAt), enteredBy: String((o.createdBy && (o.createdBy.name || o.createdBy)) || o.savedBy || ''),
            netsuite: accepted ? `accepted · ${String(o.soId || '')}` : (o.status === 'NS_QUEUED' ? 'queued for NetSuite' : 'not in NetSuite yet'),
            accepted, status: String(o.status || ''),
            finishMode: finishModeOf(o), finishAsked: !!o.finishMode, finishBy: String(o.finishAsAvailableBy || o.finishModeBy || ''),
            lineCount: (o.lines || []).length, work, review, unstarted, backorders, verdict,
            // What the screen may offer for this order (the card's own buttons): the switch, the review, the dispatch.
            canDispatch: door === DOOR.CPQ && !closed && o.status === 'Approved' && !!o.hqJobId,
            canReview: review.length > 0 && accepted,
        };
    }).sort((a, b) => a.enteredAt - b.enteredAt);
    // EVERY PART THAT WENT ON BACKORDER THAT DAY — whichever day its order was entered.
    const byPart = new Map();
    live.filter(o => inDay(msOf(o.backorderAt)) && !DEAD.includes(String(o.status || ''))).forEach(o => {
        (Array.isArray(o.backorderLines) ? o.backorderLines : []).filter(b => b && N(b.qty) > 0).forEach(b => {
            const code = U(b.code);
            if (!byPart.has(code)) byPart.set(code, { code, name: String(b.name || ''), qty: 0, onOrder: 0, orders: [] });
            const r = byPart.get(code);
            r.qty += N(b.qty); r.onOrder = Math.max(r.onOrder, N(b.onOrder));
            const ref = String(o.soId || o.id);
            if (!r.orders.includes(ref)) r.orders.push(ref);
        });
    });
    const backorders = [...byPart.values()].sort((a, b) => b.qty - a.qty || a.code.localeCompare(b.code));
    const count = (v) => rows.filter(r => r.verdict === v).length;
    return {
        rows, backorders,
        counts: {
            entered: rows.length, orderEntry: rows.filter(r => r.door === DOOR.OE).length, cpq: rows.filter(r => r.door === DOOR.CPQ).length, display: rows.filter(r => r.door === DOOR.DISPLAY).length,
            needAttention: rows.filter(r => [VERDICT.NETSUITE, VERDICT.REVIEW, VERDICT.HOLD, VERDICT.NOT_STARTED].includes(r.verdict)).length,
            onFloor: count(VERDICT.FLOOR), parked: count(VERDICT.PARKED), asAvailable: rows.filter(r => r.finishMode === FINISH_MODE.AS_AVAILABLE).length,
            backorderedParts: backorders.length,
        },
    };
}

/** "SO60812" stays as it is; an app id that is not a sales-order number yet says what it is. */
export const soLabel = (ref) => (/^SO/i.test(String(ref || '')) ? String(ref) : `SO ${String(ref || '')}`);
const timeOf = (ms) => (ms ? new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '');
const finishText = (r) => (r.finishMode === FINISH_MODE.AS_AVAILABLE ? 'as available' : 'complete') + (r.finishBy ? ` (${r.finishBy})` : (r.finishAsked ? '' : ' (default)'));

/** The day in plain text — to paste into a message or an email. */
export function daySummaryText(sum, { day = '', brand = '', stock = [] } = {}) {
    const c = sum.counts;
    const out = [`ORDERS ENTERED ${day}${brand ? ` · ${U(brand)}` : ''}`,
        `${c.entered} entered (${c.orderEntry} Order Entry, ${c.cpq} CPQ${c.display ? `, ${c.display} display` : ''}) · ${c.needAttention} need attention · ${c.onFloor} on the floor · ${c.backorderedParts} part${c.backorderedParts === 1 ? '' : 's'} backordered today`, ''];
    sum.rows.forEach(r => {
        out.push(`${soLabel(r.ref)} · ${r.customer} · ${r.door}${r.enteredBy ? ` · ${r.enteredBy}` : ''} ${timeOf(r.enteredAt)} — ${r.verdict}`);
        out.push(`   NetSuite: ${r.netsuite} · finish ${finishText(r)}`);
        r.work.forEach(w => out.push(`   ${w.ref}${w.finish ? ` (${w.finish})` : ''} — ${w.text}`));
        r.review.forEach(l => out.push(`   needs review — line ${l.lineIdx + 1} ${l.erp}: ${l.reason}`));
        r.backorders.forEach(b => out.push(`   backorder — ${b.qty} × ${b.code}${b.onOrder ? ` (${b.onOrder} on order)` : ''}`));
    });
    if (sum.backorders.length) {
        out.push('', 'BACKORDERED TODAY');
        sum.backorders.forEach(b => out.push(`   ${b.qty} × ${b.code}${b.name ? ` — ${b.name}` : ''} · ${b.orders.join(', ')}${b.onOrder ? ` · ${b.onOrder} on order` : ' · nothing on order'}`));
    }
    // Stock to reallocate (Stuart 2026-10-13 · Shared/stockReallocate) — every open order, as NetSuite read when the screen was opened.
    if (stock && stock.length) out.push('', stockToReallocateText(stock));
    return out.join('\n');
}

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** The day as a printable page (letter, portrait) — Shared/labelPrint.printHtmlDocument prints it. */
export function daySummaryHtml(sum, { day = '', brand = '', printedBy = '', stock = [] } = {}) {
    const c = sum.counts;
    const st = (stock || []).map(it => `<tr>
        <td><b>${esc(it.code)}</b><br><span class="s">${esc(it.name)}</span></td>
        <td><b>${esc(REALLOCATE_WORD[it.kind] || it.kind)}</b><br><span class="s">on hand ${it.onHand} · committed ${it.committed}<br>wanted ${it.wanted} · free ${it.free}</span></td>
        <td>${it.orders.map(o => esc(orderLine(o))).join('<br>')}<br><span class="s">NetSuite holds it for: ${esc(holdersText(it, 12))}</span></td>
    </tr>`).join('');
    const rows = sum.rows.map(r => `<tr>
        <td><b>${esc(soLabel(r.ref))}</b><br>${esc(r.customer)}<br><span class="s">${esc(r.door)}${r.enteredBy ? ` · ${esc(r.enteredBy)}` : ''} · ${esc(timeOf(r.enteredAt))}</span></td>
        <td><b>${esc(r.verdict)}</b><br><span class="s">NetSuite: ${esc(r.netsuite)}<br>finish ${esc(finishText(r))}</span></td>
        <td>${[...r.work.map(w => `${esc(w.ref)}${w.finish ? ` (${esc(w.finish)})` : ''} — ${esc(w.text)}`), ...r.review.map(l => `<b>review</b> — line ${l.lineIdx + 1} ${esc(l.erp)}: ${esc(l.reason)}`), ...r.backorders.map(b => `<b>backorder</b> — ${b.qty} × ${esc(b.code)}${b.onOrder ? ` (${b.onOrder} on order)` : ''}`)].join('<br>') || '<span class="s">nothing to make — stock lines</span>'}</td>
    </tr>`).join('');
    const bo = sum.backorders.map(b => `<tr><td><b>${esc(b.code)}</b><br><span class="s">${esc(b.name)}</span></td><td>${b.qty}</td><td>${b.onOrder || '—'}</td><td>${esc(b.orders.join(', '))}</td></tr>`).join('');
    return `<html><head><style>
        @page { size: letter portrait; margin: 0.5in; }
        body { font-family: Helvetica, Arial, sans-serif; font-size: 10pt; color: #111; }
        h1 { font-size: 15pt; margin: 0 0 2pt; } h2 { font-size: 11pt; margin: 14pt 0 4pt; }
        .s { color: #555; font-size: 8.5pt; } .k { color: #555; font-size: 9pt; margin-bottom: 8pt; }
        table { width: 100%; border-collapse: collapse; } td, th { border-top: 1px solid #999; padding: 5pt 6pt; vertical-align: top; text-align: left; }
        th { font-size: 8pt; text-transform: uppercase; letter-spacing: .06em; color: #555; border-top: 2px solid #111; }
        tr { page-break-inside: avoid; }
    </style></head><body>
        <h1>Orders entered ${esc(day)}${brand ? ` · ${esc(U(brand))}` : ''}</h1>
        <div class="k">${c.entered} entered (${c.orderEntry} Order Entry, ${c.cpq} CPQ${c.display ? `, ${c.display} display` : ''}) · ${c.needAttention} need attention · ${c.onFloor} on the floor · ${c.parked} parked · ${c.backorderedParts} part${c.backorderedParts === 1 ? '' : 's'} backordered today${printedBy ? ` · printed by ${esc(printedBy)}` : ''}</div>
        <table><tr><th style="width:27%">Order</th><th style="width:25%">Status</th><th>Work orders · review · backorders</th></tr>${rows || '<tr><td colspan="3">No sales order was entered that day.</td></tr>'}</table>
        ${sum.backorders.length ? `<h2>Backordered today</h2><table><tr><th>Part</th><th>Short</th><th>On order</th><th>Orders</th></tr>${bo}</table>` : ''}
        ${st ? `<h2>Stock to reallocate — every open order, as NetSuite reads now</h2><div class="k">Nothing here stops the floor. Re-commit in NetSuite before the build if the stock should go to a different order.</div><table><tr><th style="width:24%">Item</th><th style="width:26%">NetSuite</th><th>Orders that want it</th></tr>${st}</table>` : ''}
    </body></html>`;
}
