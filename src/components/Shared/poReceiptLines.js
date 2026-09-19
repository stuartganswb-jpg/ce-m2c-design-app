// THE LINES OF A NETSUITE ITEM RECEIPT — addressed by the purchase order's OWN line numbers.
//
// Eric, App Imp 2026-09-17: PO2205's chips were received on the dock (28,600 pcs, then 720) and no
// receipt ever reached NetSuite — both sat FAILED in 11.1 with "You have attempted an invalid
// sublist or line item operation". Cause: `!transform/itemreceipt` hands back a receipt whose item
// sublist is ALREADY the PO's lines, and each one is addressed by `orderLine` (= the PO's
// transactionline.id). The WMS listed what arrived by ITEM id with no orderLine, which NetSuite
// reads as ADDING lines to a receipt — never allowed. Every vendor-dock receipt had this shape.
// (The packed-order fulfilment had the same fault; Shared/fulfilmentLines fixed it the same way.)
//
// Two rules, both learned the hard way on the fulfilment:
//   • EVERY open PO line is listed. A line that did not arrive says `itemReceive: false` —
//     left unsaid, the transform receives it IN FULL.
//   • A line is matched to NetSuite by the line id stored at import when there is one, else by
//     item + position: a PO carries the same code twice on purpose (once for stock, once for an
//     order), so the nth app line of an item is the nth NetSuite line of that item.
//
// Pure. The caller reads the rows (poLinesSql) and hands them here.

export const poLinesSql = (nsPoId) => {
    const id = String(nsPoId || '').trim();
    if (!/^\d+$/.test(id)) throw new Error(`Not a NetSuite purchase order id: "${nsPoId}"`);
    return `SELECT tl.id AS line, tl.item AS item_internal, UPPER(i.itemid) AS itemid, tl.location AS location, `
        + `ABS(NVL(tl.quantity, 0)) AS ordered, NVL(tl.quantityshiprecv, 0) AS done, NVL(tl.isclosed, 'F') AS isclosed `
        + `FROM transactionline tl JOIN item i ON i.id = tl.item `
        + `WHERE tl.transaction = ${id} AND tl.mainline = 'F' AND NVL(tl.taxline, 'F') = 'F' ORDER BY tl.id`;
};

const truthy = (v) => v === true || v === 'T' || v === 't';
const S = (v) => String(v == null ? '' : v).trim();
const U = (v) => S(v).toUpperCase();
const N = (v) => Number(v) || 0;

// SuiteQL rows → one shape.
export const nsPoLinesOf = (rows) => (Array.isArray(rows) ? rows : []).map(r => ({
    lineId: S(r.line), nsItemId: S(r.item_internal), itemId: U(r.itemid),
    ordered: N(r.ordered), done: N(r.done), closed: truthy(r.isclosed), location: S(r.location),
})).filter(l => l.lineId);

// app PO items[] (index = the cart's index) → { [index]: nsLine }. Stored line id first; then the
// nth line of the same item. A NetSuite line is never given to two app lines.
export function matchPoLines(poItems, nsLines) {
    const items = Array.isArray(poItems) ? poItems : [];
    const ns = Array.isArray(nsLines) ? nsLines : [];
    const out = {};
    const taken = new Set();
    items.forEach((l, i) => {
        const id = S(l && l.nsLineId);
        const hit = id && ns.find(n => n.lineId === id && !taken.has(n.lineId));
        if (hit) { out[i] = hit; taken.add(hit.lineId); }
    });
    const sameItem = (l, n) => (S(l.nsItemId) && S(l.nsItemId) === n.nsItemId) || (U(l.itemId) && U(l.itemId) === n.itemId);
    items.forEach((l, i) => {
        if (out[i] || !l) return;
        const hit = ns.find(n => !taken.has(n.lineId) && sameItem(l, n));
        if (hit) { out[i] = hit; taken.add(hit.lineId); }
    });
    return out;
}

// ── AN ITEM WITH A PREFERRED BIN ARRIVES PRE-BINNED (Eric, App Imp 2026-09-18 — PO2128) ──────────────
// "Still error in receiving … this part is where the BIN selection is made." Five lines failed with
// "The total inventory detail quantity must be 255". The payload DID say 255 everywhere. The cause is
// NetSuite's: when an item has a preferred bin, `!transform/itemreceipt` hands the line back with its
// inventory detail ALREADY filled for that bin — and the bin row this app sent was ADDED to it, so the
// detail no longer summed to the line. PO2205's chips have no preferred bin, which is why they posted.
// The documented working shape is to send such a line with NO inventory detail at all: NetSuite bins
// the whole received quantity in the preferred bin. When the dock scanned a DIFFERENT bin, the move is
// a second, ordinary record — a bin transfer, preferred → scanned — queued to run only after the receipt
// has posted (Stuart: option A). Nothing here guesses at NetSuite's undocumented sublist "replace".
export const preferredBinsSql = (nsItemIds) => {
    const ids = [...new Set((nsItemIds || []).map(v => String(v || '').trim()).filter(v => /^\d+$/.test(v)))];
    if (!ids.length) return '';
    // ⚠ THE TABLE IS itemBinQuantity (2026-09-19). The first cut read `itemBinNumber`, which this account's
    // SuiteQL refuses ("Record 'itemBinNumber' was not found") — so the lookup failed, the receipt went
    // the old way with its warning, and PO2128's catch-up failed exactly as before. Read live: every one
    // of its five lines has a preferred bin (COMP-001/009/010/011/012). itemBinQuantity carries the item's
    // bin associations WITH the preferred flag, and lists a preferred bin even at zero on hand.
    return `SELECT ibq.item AS item_internal, b.binnumber AS bin, b.location AS location `
        + `FROM itemBinQuantity ibq JOIN bin b ON b.id = ibq.bin WHERE ibq.preferredbin = 'T' AND ibq.item IN (${ids.join(',')})`;
};
// rows → { [nsItemId]: [{ bin, location }] }
export const preferredBinsOf = (rows) => (Array.isArray(rows) ? rows : []).reduce((m, r) => {
    const id = S(r.item_internal); const bin = U(r.bin);
    if (id && bin) (m[id] = m[id] || []).push({ bin, location: S(r.location) });
    return m;
}, {});
// The preferred bin that applies to THIS line: the one at the line's location; with no location to
// match on, the item's only one. Anything ambiguous is '' — the line is then sent as it always was.
export const preferredBinFor = (nsLine, preferred) => {
    const list = (preferred && nsLine && preferred[nsLine.nsItemId]) || [];
    if (!list.length) return '';
    const here = nsLine.location ? list.filter(b => b.location === nsLine.location) : [];
    if (here.length === 1) return here[0].bin;
    if (!here.length && list.length === 1 && (!nsLine.location || !list[0].location)) return list[0].bin;
    return '';
};

const openInNs = (n) => !n.closed && n.ordered > n.done;

// applied: [{ index, itemId, qty, bin }] — what is being received now, by app line index.
// Returns { ok: true, items } — the `item.items` sublist — or { ok: false, reason, lines }.
export function itemReceiptItemsOf({ poItems, nsLines, applied, bin = '', preferred = null }) {
    const ns = Array.isArray(nsLines) ? nsLines : [];
    const want = (Array.isArray(applied) ? applied : []).filter(a => N(a.qty) > 0);
    if (!ns.length) return { ok: false, reason: 'NO_LINES_READ', lines: [] };
    if (!want.length) return { ok: false, reason: 'NOTHING_TO_RECEIVE', lines: [] };
    const match = matchPoLines(poItems, ns);
    const unmatched = want.filter(a => !match[a.index]).map(a => ({ itemId: U(a.itemId), qty: N(a.qty) }));
    if (unmatched.length) return { ok: false, reason: 'LINE_NOT_ON_NETSUITE_PO', lines: unmatched };
    // A line NetSuite already holds as fully received (or closed) is not ON the transform at all.
    const shut = want.filter(a => !openInNs(match[a.index])).map(a => ({ itemId: U(a.itemId), qty: N(a.qty) }));
    if (shut.length) return { ok: false, reason: 'LINE_CLOSED_IN_NETSUITE', lines: shut };
    const byLine = {};
    want.forEach(a => {
        const id = match[a.index].lineId;
        const b = U(a.bin || bin);
        const cur = byLine[id] || (byLine[id] = { qty: 0, bins: {} });
        cur.qty += N(a.qty);
        if (b) cur.bins[b] = (cur.bins[b] || 0) + N(a.qty);
    });
    const transfers = [];
    const items = ns.filter(openInNs).map(n => {
        const got = byLine[n.lineId];
        if (!got) return { orderLine: Number(n.lineId), itemReceive: false };
        const bins = Object.entries(got.bins);
        // Pre-binned by NetSuite: no inventory detail; what was scanned elsewhere is moved afterwards.
        const pref = preferredBinFor(n, preferred);
        if (pref) {
            bins.filter(([b, q]) => b !== pref && q > 0).forEach(([toBin, quantity]) =>
                transfers.push({ nsItemId: n.nsItemId, itemId: n.itemId, fromBin: pref, toBin, quantity, orderLine: Number(n.lineId) }));
            return { orderLine: Number(n.lineId), itemReceive: true, quantity: got.qty };
        }
        return {
            orderLine: Number(n.lineId), itemReceive: true, quantity: got.qty,
            ...(bins.length ? { inventoryDetail: { quantity: got.qty, inventoryAssignment: { items: bins.map(([refName, quantity]) => ({ binNumber: { refName }, quantity })) } } } : {}),
        };
    });
    return { ok: true, items, transfers };
}

// A bin transfer's `inventory.items` line — the shape the WMS transfer tab has always posted.
export const binTransferLineOf = (tr) => ({
    item: { id: String(tr.nsItemId) }, quantity: tr.quantity,
    inventoryDetail: { quantity: tr.quantity, inventoryAssignment: { items: [{ binNumber: { refName: tr.fromBin }, toBinNumber: { refName: tr.toBin }, quantity: tr.quantity }] } },
});

// WHAT NETSUITE NEVER GOT. The app's record is written first, so when a receipt fails in the queue
// the app is AHEAD of NetSuite on those lines. Per app line: received here − received there.
// Returns [{ index, itemId, qty, bin, appReceived, nsReceived }] for the lines NetSuite is behind on.
export function receiptShortfallOf(poItems, nsLines) {
    const items = Array.isArray(poItems) ? poItems : [];
    const match = matchPoLines(items, nsLines);
    const out = [];
    items.forEach((l, i) => {
        const n = match[i];
        if (!l || !n) return;
        const gap = N(l.received) - n.done;
        if (gap > 0) out.push({ index: i, itemId: U(l.itemId), qty: gap, bin: U(l.receivedBin), appReceived: N(l.received), nsReceived: n.done });
    });
    return out;
}

// The words the dock reads when the NetSuite receipt cannot be queued.
export function receiptRefusalText(result) {
    if (!result || result.ok) return '';
    const list = (result.lines || []).map(l => `  • ${l.qty} × ${l.itemId}`).join('\n');
    if (result.reason === 'LINE_NOT_ON_NETSUITE_PO') return `These lines are not on the purchase order in NetSuite, so the NetSuite receipt was NOT queued:\n${list}\n\nThe PO in NetSuite must carry the item before it can be received against.`;
    if (result.reason === 'LINE_CLOSED_IN_NETSUITE') return `NetSuite already shows these lines fully received or closed, so the NetSuite receipt was NOT queued:\n${list}\n\nAn overage on a line NetSuite has closed is entered in NetSuite by hand.`;
    if (result.reason === 'NO_LINES_READ') return 'No lines came back from NetSuite for this purchase order, so the NetSuite receipt was NOT queued.';
    return 'Nothing to receive, so no NetSuite receipt was queued.';
}
