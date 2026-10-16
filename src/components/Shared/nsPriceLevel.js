// ── THE CUSTOMER'S NETSUITE PRICE LEVEL → THE ORDER DISCOUNT, PURE (Stuart 2026-10-12) ─────────────
//
// "when we select a customer we need to look at netsuite field pricelevel for the discount level to
// apply prior to check out." NetSuite's customer record carries `pricelevel`; the price level record
// carries a name ("U - 30%", "20% Discount - Jobber/165yd", "Base Price") and, when it was set up as a
// markup / discount level, `discountpct` (negative for a discount). The percent is read in that order:
// the record's own discountpct, else the first "n%" in the name, else Base Price = 0, else UNKNOWN
// (said, never guessed — "R2 Wholesale" carries no percent). The order discount tab 7 already has
// (soExtras.orderDiscountPercent → every item line's rate, net to NetSuite) is what it sets.
// Pure: the read lives in fetchCustomerPriceLevel (one SuiteQL, like the availability read).

const str = (v) => String(v == null ? '' : v).trim();
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };

/** Stuart's list of 2026-10-12 — the fallback when NetSuite answers the id but not the name. */
export const NS_PRICE_LEVELS_KNOWN = {
    1: 'Base Price', 32: '10% Discount', 33: '20% Discount - Jobber/165yd', 34: '40% Discount - 500yd', 36: 'R2 Wholesale',
    38: 'U - 30%', 39: 'U - 40%', 40: 'U - 50%', 41: 'U - 60%', 42: 'U - 20%',
};

/**
 * { id, name, discountpct } → { percent (number | null), name, id, known: bool, reason }
 *   reason: 'DISCOUNTPCT' | 'NAME' | 'BASE' | 'NONE' (no level) | 'UNKNOWN' (a level with no percent anywhere)
 */
export function discountPctOfPriceLevel({ id = '', name = '', discountpct = null } = {}) {
    const lvlId = str(id);
    const lvlName = str(name) || (lvlId && NS_PRICE_LEVELS_KNOWN[Number(lvlId)]) || '';
    if (!lvlId && !lvlName) return { percent: null, name: '', id: '', known: false, reason: 'NONE' };
    const dp = num(discountpct);
    if (dp !== null && dp !== 0) return { percent: Math.round(Math.abs(dp) * 100) / 100, name: lvlName, id: lvlId, known: true, reason: 'DISCOUNTPCT' };
    const m = lvlName.match(/(\d+(?:\.\d+)?)\s*%/);
    if (m) return { percent: Math.round(parseFloat(m[1]) * 100) / 100, name: lvlName, id: lvlId, known: true, reason: 'NAME' };
    if (/^base price$/i.test(lvlName) || lvlId === '1') return { percent: 0, name: lvlName || 'Base Price', id: lvlId || '1', known: true, reason: 'BASE' };
    return { percent: null, name: lvlName, id: lvlId, known: false, reason: 'UNKNOWN' };
}

/** What the screen and the log say. */
export const priceLevelNoteOf = (lvl) => {
    if (!lvl || lvl.reason === 'NONE') return 'NetSuite: no price level on this customer — no order discount set';
    if (lvl.reason === 'UNKNOWN') return `NetSuite price level "${lvl.name || lvl.id}" carries no percent — set the order discount by hand`;
    if (lvl.percent === 0) return `NetSuite price level ${lvl.name} — no order discount`;
    return `NetSuite price level ${lvl.name} → ${lvl.percent}% order discount`;
};

/**
 * Whether the auto-read percent may be written over what the discount box holds: only a blank box, or a
 * box still holding the LAST auto-set value (a percent someone typed is theirs).
 */
export const mayAutoSetDiscount = (current, lastAuto) => {
    const c = str(current);
    if (!c) return true;
    return lastAuto !== null && lastAuto !== undefined && num(c) === num(lastAuto);
};

/** The SuiteQL for one customer's level (joined to the level's name and discount %); the plain one as the fallback. */
export const priceLevelQuery = (nsCustomerId) => `SELECT c.pricelevel AS id, pl.name AS name, pl.discountpct AS discountpct FROM customer c LEFT JOIN pricelevel pl ON pl.id = c.pricelevel WHERE c.id = ${parseInt(nsCustomerId, 10)}`;
export const priceLevelPlainQuery = (nsCustomerId) => `SELECT c.pricelevel AS id FROM customer c WHERE c.id = ${parseInt(nsCustomerId, 10)}`;

/** One read of the customer's level. Returns discountPctOfPriceLevel's shape (+ `read: false` when NetSuite could not answer). */
export async function fetchCustomerPriceLevel(nsCustomerId) {
    const idNum = parseInt(nsCustomerId, 10);
    if (!(idNum > 0)) return { ...discountPctOfPriceLevel({}), read: false, error: 'no NetSuite customer id' };
    const { nsProxyFetch } = await import('./nsProxy');
    const run = async (q) => {
        const resp = await nsProxyFetch({ targetUrl: 'https://3728153.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql', method: 'POST', payload: { q } });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(JSON.stringify(data).slice(0, 300));
        return data.items || [];
    };
    try {
        const rows = await run(priceLevelQuery(idNum));
        const r = rows[0] || {};
        return { ...discountPctOfPriceLevel({ id: r.id, name: r.name, discountpct: r.discountpct }), read: true };
    } catch (e1) {
        try {
            const rows = await run(priceLevelPlainQuery(idNum));
            const r = rows[0] || {};
            return { ...discountPctOfPriceLevel({ id: r.id }), read: true };
        } catch (e2) {
            return { ...discountPctOfPriceLevel({}), read: false, error: e2.message || String(e2) };
        }
    }
}

// ── THE LEVEL ON THE CUSTOMER'S TILE (Stuart 2026-10-16: "when selecting the customer in the card that comes up … add their
// price level discount to show in the card so we know right away"). The CRM record caches the last read
// (`nsPriceLevel`), stamped on every pick-time read and by the one-press bulk read of every customer's level. ─────
export const priceLevelCacheOf = (lvl, at = 0) => ({ id: str(lvl && lvl.id), name: str(lvl && lvl.name), percent: lvl && lvl.percent === null ? null : (num(lvl && lvl.percent) === null ? null : num(lvl.percent)), reason: str(lvl && lvl.reason) || 'NONE', readAt: at || Date.now() });

/** The words on the tile: "U - 60% · 60% off" · "Base Price · no discount" · "no price level" · "level not read yet". */
export const tileLevelWordsOf = (rec) => {
    const c = rec && rec.nsPriceLevel;
    if (!c || !c.readAt) return { words: 'level not read yet', tone: 'unknown', percent: null };
    if (c.reason === 'NONE' || (!c.id && !c.name)) return { words: 'no price level', tone: 'none', percent: null };
    if (c.percent === null || c.percent === undefined) return { words: `${c.name || c.id} · no percent`, tone: 'unknown', percent: null };
    if (c.percent === 0) return { words: `${c.name || 'Base Price'} · no discount`, tone: 'none', percent: 0 };
    return { words: `${c.name || c.id} · ${c.percent}% off`, tone: 'discount', percent: c.percent };
};

/** One page of every customer's level (SuiteQL pages at 1000): id → { id, name, discountpct }. */
export const priceLevelsBulkQuery = () => 'SELECT c.id AS customerid, c.pricelevel AS id, pl.name AS name, pl.discountpct AS discountpct FROM customer c LEFT JOIN pricelevel pl ON pl.id = c.pricelevel WHERE c.isinactive = \'F\' ORDER BY c.id';

/** Reads every customer's level, paged. Returns Map(nsCustomerId → discountPctOfPriceLevel shape) and the row count. */
export async function fetchAllCustomerPriceLevels({ pageSize = 1000, maxPages = 20 } = {}) {
    const { nsProxyFetch } = await import('./nsProxy');
    const out = new Map();
    let offset = 0, pages = 0, total = 0;
    for (; pages < maxPages; pages += 1) {
        const resp = await nsProxyFetch({ targetUrl: `https://3728153.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql?limit=${pageSize}&offset=${offset}`, method: 'POST', payload: { q: priceLevelsBulkQuery() } });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(JSON.stringify(data).slice(0, 300));
        const rows = data.items || [];
        rows.forEach(r => { out.set(String(r.customerid), discountPctOfPriceLevel({ id: r.id, name: r.name, discountpct: r.discountpct })); });
        total += rows.length;
        if (rows.length < pageSize || data.hasMore === false) break;
        offset += pageSize;
    }
    return { levels: out, rows: total, pages: pages + 1 };
}
