// ── WHAT NETSUITE LISTS FOR AN ITEM: ON HAND AND COMMITTED (Stuart 2026-10-13) ───────────────────────────────────────
// "can't we make it show what NS lists as stock and committed but allow them to proceed" — the material box said ONE
// number, "on hand", that was really NetSuite's AVAILABLE (on hand minus everything committed) plus the order's own
// hold; a shelf of fifty with fifty committed read "on hand 0 · short". This is the plain pair, per item at a location:
//   nsOnHand    — what is physically in the bins (InventoryBalance — the live count; the location summary can lag)
//   nsCommitted — what NetSuite has committed to every order (AggregateItemLocation; equals the sum of the holds)
// Read on 2026-10-13 against twelve live items, the two tables agreed on every on-hand figure.
// It is a second, separate read: the availability read the release decisions use (Shared/oeReviewPlan) is not touched.
// A code with no figure is UNKNOWN — a caller shows "—", never 0. Pure, except fetchShelfFigures.

const S = (v) => String(v == null ? '' : v).trim();
const U = (v) => S(v).toUpperCase();
const listOf = (codes) => [...new Set((codes || []).map(U).filter(c => c && c !== 'PENDING' && c !== 'N/A'))];
const inList = (list) => list.map(c => `'${c.replace(/'/g, "''")}'`).join(',');
const locOf = (locationId) => { const loc = S(locationId); if (!/^\d+$/.test(loc)) throw new Error(`Not a NetSuite location id: "${locationId}"`); return loc; };

export const onHandSql = (codes, locationId) => {
    const list = listOf(codes);
    if (!list.length) return '';
    return `SELECT Item.itemid AS itemid, SUM(ib.quantityonhand) AS onhand FROM InventoryBalance ib JOIN Item ON Item.id = ib.item `
        + `WHERE UPPER(Item.itemid) IN (${inList(list)}) AND ib.location = ${locOf(locationId)} GROUP BY Item.itemid`;
};
export const committedSql = (codes, locationId) => {
    const list = listOf(codes);
    if (!list.length) return '';
    return `SELECT Item.itemid AS itemid, SUM(a.quantitycommitted) AS committed FROM AggregateItemLocation a JOIN Item ON Item.id = a.item `
        + `WHERE UPPER(Item.itemid) IN (${inList(list)}) AND a.location = ${locOf(locationId)} GROUP BY Item.itemid`;
};

/**
 * The two reads → { CODE: { nsOnHand, nsCommitted } }. An item NetSuite keeps a row for at the location but has none
 * of in any bin is 0 on hand (a fact); an item with no row at all is left out (unknown).
 */
export function shelfFiguresOf(onHandRows = [], committedRows = []) {
    const out = {};
    const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
    (committedRows || []).forEach(r => { const c = U(r && r.itemid); if (c) out[c] = { nsOnHand: 0, nsCommitted: Math.max(0, num(r.committed)) }; });
    (onHandRows || []).forEach(r => {
        const c = U(r && r.itemid);
        if (!c) return;
        out[c] = { nsCommitted: 0, ...(out[c] || {}), nsOnHand: Math.max(0, num(r.onhand)) };
    });
    return out;
}

/** The read. { map, known } — known false = it failed; the caller shows no figure. */
export const fetchShelfFigures = async (codes, locationId, { chunk = 100 } = {}) => {
    const list = listOf(codes);
    if (!list.length) return { map: {}, known: true };
    const { nsProxyFetch } = await import('./nsProxy');
    const run = async (q) => {
        const resp = await nsProxyFetch({ targetUrl: 'https://3728153.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql', method: 'POST', payload: { q } });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(JSON.stringify(data).slice(0, 200));
        return data.items || [];
    };
    const map = {};
    try {
        for (let i = 0; i < list.length; i += chunk) {
            const part = list.slice(i, i + chunk);
            const committed = await run(committedSql(part, locationId));
            const onHand = await run(onHandSql(part, locationId));
            Object.assign(map, shelfFiguresOf(onHand, committed));
        }
        return { map, known: true };
    } catch (e) {
        console.warn('Shelf figures read failed — on hand and committed are not shown:', e);
        return { map: {}, known: false };
    }
};
