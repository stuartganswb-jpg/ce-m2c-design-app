// ── QUICK ADD — A PLACEHOLDER LINE FOR AN ITEM NOT YET IN THE SYSTEM, PURE (S7, 2026-10-16) ─────────
//
// Stuart: "add to the counter a 'quick add' for items that are not yet in the system, it could prompt for
// description and sales price, no item #, then on end of day summary and on the customer CRM or RTG before the
// order can be processed an item needs to be added into the library and associated with this temporary
// placeholder item, we got to keep the impatient customers happy".
//
// The shape: a cart line with NO item — a description, a price, a quantity — flagged `placeholder`. It sells at
// its price (the customer's level applies), prints as its description. When an order or a quote carrying one is
// saved, the record is written as every record is, but the NetSuite write is HELD on the record (`nsHold`: the
// payload exactly as it would have been queued, the placeholder items with an empty item id) and the status says
// so. Identify the item on RTG's card or the CRM card: the stored line is rewritten to the real item (code,
// NetSuite id, bin; the description kept as the note; the price untouched), and when the last placeholder is
// identified the held write is queued — so the floors, the pick and NetSuite only ever see the real item.
//
//   placeholderLineOf     the cart line (refuses a blank description / a bad price or quantity)
//   placeholdersOf        the open placeholders on a stored order / quote (by line index)
//   nsHoldOf              what the record keeps instead of queuing
//   resolvePlaceholderOf  the patch for one identified line, and the NetSuite write when it was the last
//   dayPlaceholdersOf     the day summary's "To identify" rows

const str = (v) => String(v == null ? '' : v).trim();
const num = (v) => (v === null || v === undefined || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
const cents = (v) => Math.round((Number(v) || 0) * 100) / 100;

export const PLACEHOLDER_HELD_STATUS = 'HELD_PLACEHOLDER';
export const PLACEHOLDER_ERP = 'TBD';   // what the line's code reads until it is identified

/** The cart line for a quick add. */
export function placeholderLineOf({ description = '', price = '', qty = 1, by = '', at = 0 } = {}) {
    const errors = [];
    const d = str(description);
    if (!d) errors.push({ code: 'NO_DESCRIPTION', message: 'Describe the item — that is what the customer and the office read.' });
    const p = num(price);
    if (p === null || p <= 0) errors.push({ code: 'NO_PRICE', message: 'Type the sale price.' });
    const q = num(qty);
    if (q === null || q < 1 || Math.floor(q) !== q) errors.push({ code: 'BAD_QTY', message: 'Quantity must be a whole number, 1 or more.' });
    if (errors.length) return { ok: false, errors, line: null };
    const now = at || Date.now();
    return {
        ok: true, errors: [],
        line: {
            key: `tbd-${now}-${Math.floor(Math.random() * 10000)}`,
            itemId: '', erp: PLACEHOLDER_ERP, aliasErp: '', aliasItemId: null, nsId: '',
            name: d, note: '', bin: '',
            qty: q, packUom: '', packSize: 1,
            rateOverride: cents(p), discountable: true, noPack: true,
            kitKey: null, kitName: null, kitBrand: null, kitFinish: '',
            placeholder: { description: d, by: str(by), at: now },
        },
    };
}

export const isPlaceholderLine = (l) => !!(l && l.placeholder && !str(l.nsId));

/** Where a record keeps its lines: an order's `lines[]`, a quote's stored cart. */
export const linesFieldOf = (record) => (record && Array.isArray(record.lines) ? 'lines' : (record && Array.isArray(record.quickShipCart) ? 'quickShipCart' : 'lines'));

/** The open placeholders on a stored record, by index. */
export const placeholdersOf = (record) => ((record && record[linesFieldOf(record)]) || []).map((l, lineIdx) => ({ l, lineIdx }))
    .filter(x => isPlaceholderLine(x.l))
    .map(x => ({ lineIdx: x.lineIdx, description: str(x.l.placeholder.description || x.l.name), qty: num(x.l.qty) || 1, rate: num(x.l.rate), by: str(x.l.placeholder.by), at: x.l.placeholder.at || 0 }));

export const hasPlaceholders = (record) => placeholdersOf(record).length > 0;

/**
 * The held NetSuite write: the queue entry's own fields, kept on the record. The payload's placeholder items
 * carry `item: { id: '' }` and `_placeholderLineIdx` so the resolve can fill them in place.
 */
export const nsHoldOf = ({ kind, label, targetUrl, method = 'POST', payload, sourceApp = '', writeBack = null, at = 0 } = {}) => ({
    kind: str(kind), label: str(label), targetUrl: str(targetUrl), method, payload: payload || {}, sourceApp, writeBack: writeBack || null, heldAt: at || Date.now(),
});

/**
 * One identified line.
 *   record    the stored order / quote (lines[], nsHold)
 *   lineIdx   which placeholder
 *   item      the library record it is (needs a NetSuite id to be pushed)
 * → { ok, errors, patch, release: bool, nsWrite }  — `patch` rewrites `lines` whole (an array) and, on release,
 *   the status; `nsWrite` is the entry to queue when this was the last placeholder (null otherwise).
 */
export function resolvePlaceholderOf({ record, lineIdx, item, by = '', at = 0, queuedStatus = 'NS_QUEUED' } = {}) {
    const errors = [];
    const field = linesFieldOf(record);
    const lines = (record && Array.isArray(record[field])) ? record[field] : null;
    if (!lines) errors.push({ code: 'NO_LINES', message: 'The record carries no lines.' });
    const l = lines ? lines[lineIdx] : null;
    if (lines && !isPlaceholderLine(l)) errors.push({ code: 'NOT_PLACEHOLDER', message: `Line ${lineIdx + 1} is not an open placeholder.` });
    const code = str(item && (item.legacyErpId || item.itemId));
    const nsId = str(item && item.netSuiteInternalId);
    if (!item || !code) errors.push({ code: 'NO_ITEM', message: 'Pick the library item it is.' });
    else if (!nsId) errors.push({ code: 'ITEM_NO_NS_ID', message: `${code} carries no NetSuite id — sync it from NetSuite (11.1) first, then identify.` });
    if (errors.length) return { ok: false, errors, patch: null, release: false, nsWrite: null };
    const now = at || Date.now();
    const specs = (item.manufacturingSpecs || {});
    const resolved = {
        ...l,
        erp: code, itemId: item.id || item.itemId || '', nsId,
        name: str(item.itemName) || code,
        note: [str(l.note), `sold as "${str(l.placeholder.description || l.name)}"`].filter(Boolean).join(' · '),
        bin: str(specs.homeBin || specs.binLocation || l.bin),
        placeholder: { ...l.placeholder, resolvedTo: code, resolvedNsId: nsId, resolvedBy: str(by), resolvedAt: now },
    };
    const newLines = lines.map((x, i) => (i === lineIdx ? resolved : x));
    const open = newLines.filter(isPlaceholderLine).length;
    const hold = record.nsHold || null;
    let nsWrite = null;
    if (hold && hold.payload) {
        // fill THIS line's item in the held payload, in place
        const items = (((hold.payload || {}).item || {}).items || []).map(it => (it && it._placeholderLineIdx === lineIdx ? { ...it, item: { id: nsId }, _placeholderLineIdx: undefined } : it));
        const payload = { ...hold.payload, item: { ...(hold.payload.item || {}), items: items.map(it => { const c = { ...it }; if (c._placeholderLineIdx === undefined) delete c._placeholderLineIdx; return c; }) } };
        const newHold = { ...hold, payload };
        if (open === 0) nsWrite = { kind: hold.kind, label: hold.label, targetUrl: hold.targetUrl, method: hold.method || 'POST', payload, sourceApp: hold.sourceApp || '', writeBack: hold.writeBack || null };
        return {
            ok: true, errors: [], release: open === 0, nsWrite,
            patch: { [field]: newLines, nsHold: open === 0 ? null : newHold, ...(open === 0 ? { ...(queuedStatus ? { status: queuedStatus, nsQueuedAt: now } : {}), placeholderHeld: false, placeholdersReleasedAt: now, placeholdersReleasedBy: str(by) } : {}), updatedAt: now },
        };
    }
    return { ok: true, errors: [], release: open === 0, nsWrite: null, patch: { [field]: newLines, ...(open === 0 ? { ...(queuedStatus ? { status: queuedStatus } : {}), placeholderHeld: false, placeholdersReleasedAt: now, placeholdersReleasedBy: str(by) } : {}), updatedAt: now } };
}

/** The day summary's rows: every open placeholder on a record created within [start, end). */
export const dayPlaceholdersOf = (records = [], { start = 0, end = Infinity } = {}) => {
    const out = [];
    (records || []).forEach(r => {
        const at = Number(r && (r.createdAt && r.createdAt.toMillis ? r.createdAt.toMillis() : r.createdAt)) || Number(r && r.nsQueuedAt) || 0;
        if (at && (at < start || at >= end)) return;
        placeholdersOf(r).forEach(p => out.push({ recordId: r.id, number: r.soId || r.jobId || r.id, kind: r.jobId && !r.soId ? 'QUOTE' : 'SALES ORDER', customer: str(r.customer && r.customer.name ? r.customer.name : r.customer), ...p }));
    });
    return out.sort((a, b) => (b.at || 0) - (a.at || 0));
};
