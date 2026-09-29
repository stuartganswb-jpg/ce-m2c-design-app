// WHO NETSUITE HOLDS THE STOCK FOR (Stuart 2026-09-30, commitments A: "when we have limited stock of items we
// can commit them to certain orders in netsuite, we will need to align this" — "warn and go ahead").
//
// NetSuite commits scarce stock to chosen sales orders (and a work order commits the components it will
// consume). The sales-side decisions already respect that (Shared/oeReviewPlan.fetchStockForOrder: free
// stock + this order's own hold). The WMS flows that TAKE stock — the pick, the plating pull, the convert,
// the arrival alert — read ON HAND, so they could hand one order the pieces NetSuite holds for another.
// This is the one reader they share: per item at a location, what is committed and to WHICH transaction.
//
// Rules, each learned live on 2026-09-30:
//   • committed = the sum of the holds. TransactionLine.quantitycommitted per transaction adds up exactly to
//     NetSuite's committed figure (HCUSR1: SO60161 16 + SO60676 88 + WO11652 300 = 404).
//   • ON HAND comes from the caller's own live bin read. NetSuite's location summary lags (H2-138-TB3 read 0
//     in AggregateItemLocation while 962 sat in RAW), so it is never the on-hand here.
//   • A hold is the job's OWN when its transaction matches the job — by NetSuite number (SO60676, WO11575)
//     or internal id. Free for the job = on hand − what NetSuite holds for everyone else.
//   • The warning only warns: the floor may go ahead (Stuart's choice). A failed or possibly-cut-off read is
//     unknown and says nothing — never a guess.
// Pure, except fetchStockHolds (it imports the proxy only when called).

const S = (v) => String(v == null ? '' : v).trim();
const U = (v) => S(v).toUpperCase();
const N = (v) => Math.abs(Number(v) || 0);
export const HOLDS_PAGE = 1000;

// Every non-zero commitment of these items at one location, by transaction.
export const holdsSql = (codes, locationId) => {
    const loc = S(locationId);
    if (!/^\d+$/.test(loc)) throw new Error(`Not a NetSuite location id: "${locationId}"`);
    const list = [...new Set((codes || []).map(U).filter(Boolean))];
    if (!list.length) return '';
    const idList = list.map(c => `'${c.replace(/'/g, "''")}'`).join(',');
    return `SELECT Item.itemid AS itemid, t.id AS tid, t.tranid AS tranid, t.type AS ttype, SUM(ABS(tl.quantitycommitted)) AS held `
        + `FROM TransactionLine tl JOIN Transaction t ON t.id = tl.transaction JOIN Item ON Item.id = tl.item `
        + `WHERE UPPER(Item.itemid) IN (${idList}) AND tl.location = ${loc} AND tl.quantitycommitted <> 0 `
        + `GROUP BY Item.itemid, t.id, t.tranid, t.type`;
};

// SuiteQL rows → { CODE: { committed, holds: [{ tid, tran, type, qty }] } }; null when the page may be cut off.
export function holdsOf(rows, codes = []) {
    if (!Array.isArray(rows) || rows.length >= HOLDS_PAGE) return null;
    const out = {};
    (codes || []).map(U).filter(Boolean).forEach(c => { out[c] = { committed: 0, holds: [] }; });
    rows.forEach(r => {
        const c = U(r.itemid);
        const qty = N(r.held);
        if (!c || !qty) return;
        const e = out[c] || (out[c] = { committed: 0, holds: [] });
        e.holds.push({ tid: S(r.tid), tran: U(r.tranid), type: S(r.ttype), qty });
        e.committed += qty;
    });
    Object.values(out).forEach(e => e.holds.sort((a, b) => b.qty - a.qty));
    return out;
}

// The references that make a hold a job's own — its sales order / work order numbers and ids.
export function ownRefsOf(...docs) {
    const refs = new Set();
    docs.filter(Boolean).forEach(d => {
        [d.salesOrderId, d.soId, d.soNum, d.soRef, d.nsSoTran, d.nsInternalId, d.soNsId,
            d.woNum, d.nsWoTran, d.nsWoId].map(U).filter(v => v && v !== 'N/A').forEach(v => refs.add(v));
    });
    return refs;
}
const isOwn = (h, own) => !!own && (own.has(h.tran) || own.has(U(h.tid)));

// One item seen from one job: { onHand, committed, ownHeld, othersHeld, free, others }. entry null → null.
export function holdsView(onHand, entry, own = new Set()) {
    if (!entry) return null;
    const oh = Math.max(0, Number(onHand) || 0);
    const ownHeld = entry.holds.filter(h => isOwn(h, own)).reduce((a, h) => a + h.qty, 0);
    const others = entry.holds.filter(h => !isOwn(h, own));
    const othersHeld = others.reduce((a, h) => a + h.qty, 0);
    return { onHand: oh, committed: entry.committed, ownHeld, othersHeld, free: Math.max(0, oh - othersHeld), others };
}
const holderList = (others, max = 3) => {
    const shown = others.slice(0, max).map(h => `${h.tran || h.tid} (${h.qty})`);
    return shown.join(', ') + (others.length > max ? ` +${others.length - max} more` : '');
};
// The warning a job reads when what it needs digs into stock NetSuite holds for someone else; null otherwise.
export function holdNote(code, need, view) {
    if (!view || view.othersHeld <= 0) return null;
    const want = Math.max(0, Number(need) || 0);
    if (want <= view.free) return null;
    const into = Math.min(want, view.onHand) - view.free;
    return `⚠ NetSuite holds ${view.othersHeld} of the ${view.onHand} × ${U(code)} here for ${holderList(view.others)} — ${view.free} free for this job.`
        + (into > 0 ? ` Taking ${want} uses ${into} of theirs.` : '');
}
// One line for a screen that shows stock: "404 on hand · 316 held for others · 88 free".
export function holdSummary(view) {
    if (!view || !view.committed) return '';
    return `${view.onHand} on hand · ${view.othersHeld} held for others${view.ownHeld ? ` · ${view.ownHeld} held for this job` : ''} · ${view.free} free`;
}
// What NetSuite holds of one code for each order reference (SO number / internal id) — for the arrival alert.
export function heldByRef(entry) {
    const m = {};
    ((entry && entry.holds) || []).forEach(h => {
        if (h.tran) m[h.tran] = (m[h.tran] || 0) + h.qty;
        if (h.tid) m[h.tid] = (m[h.tid] || 0) + h.qty;
    });
    return m;
}

// The read. { map, known }: known false = the read failed or may be cut off — callers then warn about nothing.
export const fetchStockHolds = async (codes, locationId, { chunk = 50 } = {}) => {
    const list = [...new Set((codes || []).map(U).filter(c => c && c !== 'PENDING' && c !== 'N/A'))];
    if (!list.length) return { map: {}, known: true };
    const { nsProxyFetch } = await import('./nsProxy');
    const map = {};
    try {
        for (let i = 0; i < list.length; i += chunk) {
            const part = list.slice(i, i + chunk);
            const resp = await nsProxyFetch({
                targetUrl: 'https://3728153.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql',
                method: 'POST', payload: { q: holdsSql(part, locationId) },
            });
            const data = await resp.json().catch(() => ({}));
            if (!resp.ok) throw new Error(JSON.stringify(data).slice(0, 200));
            const got = holdsOf(data.items || [], part);
            if (!got) return { map: {}, known: false };
            Object.assign(map, got);
        }
        return { map, known: true };
    } catch (e) {
        console.warn('Stock holds read failed — no hold warnings shown:', e);
        return { map: {}, known: false };
    }
};
