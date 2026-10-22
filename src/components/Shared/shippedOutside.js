// ── SHIPPED OUTSIDE THE APP — what NetSuite already shipped leaves the Fulfillment tab (Stuart 2026-10-21) ────────────────
// "there's still left over older orders on the fulfillments tab wms … look at how many and how we can clean up" → "go on
// the plan". Ready to Ship = packed, not yet stamped shipped — and only a UPS shipment from the tab stamps it. Of the 26
// there on 10-21, 21 had left long before (shipped before UPS went live, or fulfilled by hand in NetSuite): NetSuite held
// their fulfilment AND their invoice (SO Billed). So each sales order on the tab is asked of NetSuite once — its status and
// the item fulfilments made from it — and one NetSuite already shipped says so on its row, with a manager's
// "✓ Shipped outside the app" that stamps every packed piece of that order the way a UPS shipment does, without the UPS:
// the ship date is the NetSuite fulfilment's date (invoice dates read it as "when it left"), nothing is sent to NetSuite.
// One order at a time — never a "mark all" (the 2026-09-10 bulk close). An order NetSuite CLOSED with nothing shipped is
// said too; it is closed on RTG (✕ Close — the one closer), not here.
// Pure. Harness: scripts/shippedOutside.test.mjs. The React half: Shared/ShippedOutsideBox.

const S = (v) => String(v == null ? '' : v).trim();
const isId = (v) => /^\d+$/.test(S(v));
const isTran = (v) => /^[A-Z]{1,8}-?\d{3,}$/.test(S(v).toUpperCase());

/** The NetSuite sales order a packed document belongs to: its internal id (when the host knows it) and its number. */
export const soKeyOf = (d, nsSoId = '') => {
    const tran = [d && d.soId, d && d.salesOrderId, d && d.orderKey].map(v => S(v).toUpperCase()).find(isTran) || '';
    return { nsId: isId(nsSoId) ? S(nsSoId) : '', tran };
};

/** The reads for a set of orders: their status (by id or number), then the fulfilments made from them (by id). */
export const soStatusSqlOf = (keys = []) => {
    const ids = [...new Set((keys || []).map(k => k && k.nsId).filter(isId))].slice(0, 200);
    const trans = [...new Set((keys || []).map(k => k && k.tran).filter(isTran))].slice(0, 200);
    if (!ids.length && !trans.length) return '';
    const where = [ids.length ? `t.id IN (${ids.join(',')})` : '', trans.length ? `t.tranid IN (${trans.map(t => `'${t}'`).join(',')})` : ''].filter(Boolean).join(' OR ');
    return `SELECT t.id, t.tranid, BUILTIN.DF(t.status) AS st FROM transaction t WHERE t.type = 'SalesOrd' AND (${where})`;
};
export const fulfilmentsSqlOf = (soIds = []) => {
    const ids = [...new Set((soIds || []).map(S).filter(isId))].slice(0, 200);
    if (!ids.length) return '';
    return `SELECT t.id, t.tranid, t.trandate, tl.createdfrom AS src FROM transaction t, transactionline tl WHERE tl.transaction = t.id AND tl.mainline = 'T' AND t.type = 'ItemShip' AND tl.createdfrom IN (${ids.join(',')})`;
};

/** "Sales Order : Pending Billing" → "Pending Billing". */
export const statusWordOf = (st) => S(st).split(' : ').pop();

// NetSuite's sales order statuses, by what they say about shipping. "Pending Billing" = every line fulfilled, not invoiced.
const SHIPPED_ALL = ['Billed', 'Pending Billing'];
const SHIPPED_PART = ['Partially Fulfilled', 'Pending Billing/Partially Fulfilled'];
const ENDED = ['Closed', 'Cancelled'];

/** NetSuite's 'M/D/YYYY' → ms at noon that day (0 when unreadable). */
export const nsDateMs = (s) => {
    const m = S(s).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    return m ? new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2]), 12).getTime() : 0;
};
const shortDate = (ms) => (ms ? new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '');

/**
 * One order's shipping as NetSuite has it. so = { id, tranid, st } | null; ifs = [{ id, tranid, trandate }].
 * → { state: 'SHIPPED' | 'PART' | 'CLOSED_UNSHIPPED' | 'OPEN' | 'UNKNOWN', status, tran, nsId, ifs (newest first), shipDate, line }
 */
export const nsShipStateOf = (so, ifs = []) => {
    if (!so) return { state: 'UNKNOWN', status: '', tran: '', nsId: '', ifs: [], shipDate: 0, line: '' };
    const status = statusWordOf(so.st);
    const list = (ifs || []).map(f => ({ id: S(f.id), tranid: S(f.tranid), date: nsDateMs(f.trandate) }))
        .sort((a, b) => b.date - a.date || b.tranid.localeCompare(a.tranid));
    const ifWords = list.map(f => `${f.tranid}${f.date ? ` · ${shortDate(f.date)}` : ''}`).join(', ');
    const base = { status, tran: S(so.tranid), nsId: S(so.id), ifs: list, shipDate: list.length ? list[0].date : 0 };
    if (SHIPPED_ALL.includes(status) || (ENDED.includes(status) && list.length)) {
        return { ...base, state: 'SHIPPED', line: `NetSuite shipped this — ${ifWords || 'fulfilled'} · ${status}` };
    }
    if (ENDED.includes(status)) return { ...base, state: 'CLOSED_UNSHIPPED', line: `NetSuite ${status.toLowerCase()} ${base.tran} with nothing shipped — close it on RTG (✕ Close on its row)` };
    if (SHIPPED_PART.includes(status)) return { ...base, state: 'PART', line: `NetSuite has shipped part of ${base.tran}${ifWords ? ` (${ifWords})` : ''} — ship the rest here` };
    return { ...base, state: 'OPEN', line: '' };
};

/** The answers indexed → { byId: {nsId → check}, byTran: {tran → check} }. */
export const indexShipChecks = (soRows = [], ifRows = []) => {
    const ifsBySo = {};
    (ifRows || []).forEach(f => { const k = S(f.src); (ifsBySo[k] = ifsBySo[k] || []).push(f); });
    const byId = {}, byTran = {};
    (soRows || []).forEach(so => {
        const c = nsShipStateOf(so, ifsBySo[S(so.id)] || []);
        byId[c.nsId] = c;
        if (c.tran) byTran[c.tran.toUpperCase()] = c;
    });
    return { byId, byTran };
};
export const checkFor = (key, idx) => (!key || !idx ? null : ((key.nsId && idx.byId[key.nsId]) || (key.tran && idx.byTran[key.tran]) || null));

/** Every packed document on the tab that belongs to the same sales order (an order ships whole — SO60831's three pieces). */
export const sameOrderDocsOf = (doc, queue = [], keyOf = (d) => soKeyOf(d)) => {
    const k = keyOf(doc);
    return (queue || []).filter(x => {
        if (!x) return false;
        if (x === doc || x.id === doc.id) return true;
        const kx = keyOf(x);
        return !!((k.nsId && kx.nsId === k.nsId) || (k.tran && kx.tran === k.tran));
    });
};

/** What each document is stamped with — a shipment record with no UPS in it. `now` = when it was marked. */
export const outsideShipPatchOf = ({ check, by = '', now = Date.now() } = {}) => {
    const latest = (check && check.ifs && check.ifs[0]) || null;
    return {
        shippedAt: (check && check.shipDate) || now,
        shippedBy: S(by),
        shipCarrier: 'OUTSIDE',
        shipService: 'shipped outside the app',
        shippedOutside: {
            at: now, by: S(by), why: 'NETSUITE_FULFILLED',
            soTran: S(check && check.tran), soStatus: S(check && check.status),
            ifs: ((check && check.ifs) || []).slice(0, 10).map(f => ({ id: f.id, tranid: f.tranid, date: f.date || null })),
            ...(latest ? { nsIfTran: latest.tranid } : {}),
        },
    };
};

/** The confirm words: what is marked, from what NetSuite says, and what is not done. */
export const outsideShipConfirmOf = ({ check, docs = [], refOf = (d) => d.id } = {}) => [
    `✓ Mark ${S(check && check.tran) || 'this order'} shipped outside the app?`,
    '',
    `NetSuite: ${S(check && check.status)}${check && check.ifs && check.ifs.length ? ` · ${check.ifs.map(f => f.tranid).join(', ')}` : ''}${check && check.shipDate ? ` — left ${shortDate(check.shipDate)}` : ''}.`,
    '',
    `${docs.length} packed piece${docs.length === 1 ? '' : 's'} leave Ready to Ship:`,
    ...docs.map(d => `• ${refOf(d)}`),
    '',
    'No label is bought and nothing is sent to NetSuite — it already has the fulfilment. RTG is told it shipped.',
].join('\n');
