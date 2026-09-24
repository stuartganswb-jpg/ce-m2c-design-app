// THE OPEN-INVOICE QUERY — one SQL, written once, used by the staff panel.
//
// Staff screens reach NetSuite the way every other HQ read does: through the netsuiteProxy, which
// already holds the credentials and OAuth-signs the request (Shared/nsProxy). A second server-side
// path with its own secret bindings was the wrong shape — it failed to deploy and bought nothing
// (2026-09-24). The PORTAL keeps its own function, because a customer has no proxy access.
//
// Eric's field list (2026-09-24): status Invoice:Open; subsidiary and location live on the MAIN
// LINE, not the header; amount due is the remaining balance, with total-minus-paid as the fallback.
import { nsProxyFetch } from './nsProxy';

const SUITEQL = 'https://3728153.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql';
// Each brand is its own NetSuite subsidiary and must only ever see its own invoices (Stuart).
export const NS_BRAND_SUBSIDIARY = { m2c: '3', ce: '2', uniquity: '6', leyla: '5' };

const esc = (v) => String(v === undefined || v === null ? '' : v).replace(/'/g, "''");
const sqlDate = (v) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || '').trim()); return m ? m[0] : ''; };
export const nsCustomerIdOf = (id) => { const s = String(id || '').trim(); return s.startsWith('CUST-') ? s.slice(5) : s; };

export function openInvoiceSql({ brand, entityId, customerLike = '', dueFrom = '', dueTo = '' }) {
    const subsidiary = NS_BRAND_SUBSIDIARY[String(brand || 'ce').toLowerCase()];
    if (!subsidiary) throw new Error(`No NetSuite subsidiary on file for "${brand}".`);
    const name = esc(customerLike).toUpperCase().slice(0, 60);
    const from = sqlDate(dueFrom);
    const to = sqlDate(dueTo);
    const where = [
        "t.type = 'CustInvc'",
        "t.status = 'CustInvc:A'",
        `tl.subsidiary = ${Number(subsidiary)}`,
        ...(entityId ? [`t.entity = ${Number(entityId)}`] : []),
        ...(name ? [`(UPPER(c.companyname) LIKE '%${name}%' OR UPPER(c.entityid) LIKE '%${name}%')`] : []),
        ...(from ? [`t.duedate >= TO_DATE('${from}', 'YYYY-MM-DD')`] : []),
        ...(to ? [`t.duedate <= TO_DATE('${to}', 'YYYY-MM-DD')`] : []),
    ].join(' AND ');
    return `SELECT t.id, t.tranid, TO_CHAR(t.trandate, 'YYYY-MM-DD') AS trandate, TO_CHAR(t.duedate, 'YYYY-MM-DD') AS duedate, `
        + `t.entity, c.companyname AS customername, t.otherrefnum AS ponumber, BUILTIN.DF(t.terms) AS terms, t.memo, `
        + `ABS(NVL(t.foreigntotal, 0)) AS total, ABS(NVL(t.foreignamountpaid, 0)) AS paid, `
        + `ABS(NVL(t.foreignamountunpaid, NVL(t.foreigntotal, 0) - NVL(t.foreignamountpaid, 0))) AS due `
        + `FROM transaction t `
        + `JOIN transactionline tl ON tl.transaction = t.id AND tl.mainline = 'T' `
        + `JOIN customer c ON c.id = t.entity `
        + `WHERE ${where} ORDER BY t.duedate, t.id`;
}

export const invoiceRowsOf = (items = []) => (items || []).map((r) => ({
    id: String(r.id), tranid: r.tranid || '', date: r.trandate || '', dueDate: r.duedate || '',
    customerNsId: String(r.entity || ''), customerName: r.customername || '',
    poNumber: r.ponumber || '', terms: r.terms || '', memo: r.memo || '',
    total: Number(r.total || 0), paid: Number(r.paid || 0),
    due: Math.round(Number(r.due || 0) * 100) / 100,
})).filter((i) => i.due > 0.005);

// Read a page. `hasMore` is NetSuite's own word for "there is more behind this" — the caller must
// say so rather than presenting a quiet half-list (the 1000-row cap rule).
export async function fetchOpenInvoices({ brand, customerId = '', customerLike = '', dueFrom = '', dueTo = '', limit = 200, offset = 0 }) {
    const q = openInvoiceSql({ brand, entityId: customerId ? nsCustomerIdOf(customerId) : '', customerLike, dueFrom, dueTo });
    const r = await nsProxyFetch({
        targetUrl: `${SUITEQL}?limit=${Math.min(Number(limit) || 200, 1000)}&offset=${Number(offset) || 0}`,
        method: 'POST', payload: { q },
    });
    const b = await r.json().catch(() => ({}));
    if (!r.ok) {
        // A failed query must never read as "nothing open".
        const detail = (b && b['o:errorDetails'] && b['o:errorDetails'][0] && b['o:errorDetails'][0].detail) || (b && b.title) || `HTTP ${r.status}`;
        throw new Error(`NetSuite refused the query: ${String(detail).slice(0, 300)}`);
    }
    return { invoices: invoiceRowsOf(b.items), hasMore: b.hasMore === true };
}

// Counts at each step, so an empty list names its own cause instead of being guessed at.
export async function diagnoseOpenInvoices(brand) {
    const sub = Number(NS_BRAND_SUBSIDIARY[String(brand || 'ce').toLowerCase()] || 0);
    const steps = [
        ['any transaction at all', 'SELECT COUNT(*) AS n FROM transaction'],
        ['sales orders (read by the app today)', "SELECT COUNT(*) AS n FROM transaction WHERE type = 'SalesOrd'"],
        ['customers', 'SELECT COUNT(*) AS n FROM customer'],
        ['invoices of any kind', "SELECT COUNT(*) AS n FROM transaction WHERE type = 'CustInvc'"],
        ['invoices with status open', "SELECT COUNT(*) AS n FROM transaction WHERE type = 'CustInvc' AND status = 'CustInvc:A'"],
        [`open invoices in subsidiary ${sub} (line)`, `SELECT COUNT(DISTINCT t.id) AS n FROM transaction t JOIN transactionline tl ON tl.transaction = t.id AND tl.mainline = 'T' WHERE t.type = 'CustInvc' AND t.status = 'CustInvc:A' AND tl.subsidiary = ${sub}`],
    ];
    const out = [];
    for (const [step, q] of steps) {
        try {
            const r = await nsProxyFetch({ targetUrl: SUITEQL, method: 'POST', payload: { q } });
            const b = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(((b['o:errorDetails'] || [])[0] || {}).detail || b.title || `HTTP ${r.status}`);
            out.push({ step, count: Number(((b.items || [])[0] || {}).n || 0) });
        } catch (e) { out.push({ step, error: String(e.message || e).slice(0, 200) }); }
    }
    return out;
}
