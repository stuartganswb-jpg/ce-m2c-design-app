// ── LINK AN APP QUOTE TO THE SALES ORDER ALREADY IN NETSUITE (Stuart 2026-10-16: "go with option 2") ─────────────────
// From 9/12 to 10/14 every M2C quote saved in the app was refused before it reached NetSuite (no M2C form on file). M2C
// entered the orders in NetSuite by hand instead — Dahle Barn SOM2C-1033, Cresthaven SOM2C-1035, Laprade SOM2C-1038 —
// and re-sending the app's quotes would make a SECOND NetSuite order of each (as SOM2C-1010 became SOM2C-1018 in July).
// This links instead: the quote takes the existing order's NetSuite id and number, its RTG card is written (or
// updated) with them, and the NetSuite order is stamped with the quote's id (custbody50) — so RTG releases the order to
// the floors from the quote's configuration and nothing new is created in NetSuite.
// It refuses rather than guess: another division's order, another customer's, one that has shipped or closed, one
// already linked to another quote, or already on RTG. Pure. scripts/nsLink.test.mjs asserts it.
import { BRAND_NETSUITE_MAP } from './brandNetsuite.js';
import { nsCustomerIdOf } from './nsHeader.js';

const S = (v) => String(v == null ? '' : v).trim();
const U = (v) => S(v).toUpperCase();
const bare = (code) => { const c = U(code); const i = c.lastIndexOf(':'); return i >= 0 ? c.slice(i + 1) : c; };
// A NetSuite sales order still to be made: pending approval or pending fulfilment. Anything later has shipped part or
// all of itself, or closed — the floor would make it twice.
const OPEN = { A: 'pending approval', B: 'pending fulfilment' };

/** The SuiteQL read of one sales order by its number ('' when the number is not one). */
export const nsSoLookupSql = (tranid) => {
    const t = U(tranid);
    if (!/^[A-Z0-9][A-Z0-9-]{1,30}$/.test(t)) return '';
    return `SELECT t.id AS id, t.tranid AS tranid, t.type AS ttype, t.status AS status, t.entity AS entity, BUILTIN.DF(t.entity) AS cust, `
        + `t.subsidiary AS subsidiary, t.custbody50 AS jobid, t.foreigntotal AS total, t.trandate AS trandate, t.memo AS memo `
        + `FROM transaction t WHERE UPPER(t.tranid) = '${t}' AND t.type = 'SalesOrd'`;
};

/** The SuiteQL rows → the one order, or null. */
export const nsSoOf = (rows = []) => {
    const r = (rows || [])[0];
    if (!r || !S(r.id)) return null;
    return { id: S(r.id), tranid: S(r.tranid), status: bare(r.status), entity: S(r.entity), customer: S(r.cust), subsidiary: S(r.subsidiary), jobId: S(r.jobid), total: Number(r.total) || 0, date: S(r.trandate), memo: S(r.memo) };
};

/** The RTG card a CPQ quote's sales order lives on — the id CPQ's save and the CRM's approve both write. */
export const boardSoIdOf = (job) => `SO-APP-${String((job && (job.quoteNo || job.jobId || job.id)) || '').replace(/[^A-Za-z0-9-]/g, '')}`;

/**
 * @param job         the jobs doc (the app quote)
 * @param so          nsSoOf(...) — null when NetSuite has no such order
 * @param typed       what the person typed
 * @param brand       the division the board is on
 * @param boardHolders  ids of RTG cards that already carry this NetSuite order (hq_sales_orders where nsInternalId == so.id)
 * @returns '' when it may be linked, else the reason it may not
 */
export function linkRefusalOf({ job, so, typed = '', brand = '', boardHolders = [] } = {}) {
    if (!job) return 'No app quote to link.';
    if (!so) return `NetSuite has no sales order "${S(typed)}" — check the number (e.g. SOM2C-1038).`;
    const map = BRAND_NETSUITE_MAP[S(brand).toLowerCase()];
    if (!map) return `No NetSuite subsidiary on file for division "${brand}".`;
    if (S(so.subsidiary) !== S(map.subsidiary)) return `${so.tranid} belongs to another division (subsidiary ${so.subsidiary}, this board is ${map.subsidiary}).`;
    if (!OPEN[so.status]) return `${so.tranid} has already shipped or closed in NetSuite (status ${so.status}) — linking it would send the work to the floor a second time.`;
    const want = nsCustomerIdOf(job.customer && job.customer.id);
    if (!want || want !== S(so.entity)) return `${so.tranid} is for ${so.customer || `customer ${so.entity}`}; this quote is for ${(job.customer && job.customer.name) || 'another customer'}.`;
    const own = S(job.id || job.jobId);
    if (so.jobId && so.jobId !== own) return `${so.tranid} is already linked to another app quote (${so.jobId}).`;
    if (job.netsuiteSalesOrderId && S(job.netsuiteSalesOrderId) !== so.id) return `This quote is already linked to NetSuite sales order ${job.netsuiteSalesOrderNo || job.netsuiteSalesOrderId}.`;
    const others = (boardHolders || []).map(S).filter(id => id && id !== boardSoIdOf(job));
    if (others.length) return `${so.tranid} is already on RTG as ${others.join(', ')}.`;
    return '';
}

/**
 * What the link writes. The job keeps its own status unless it is still a quote — a sales order exists for it now.
 * @returns { jobPatch, boardId, boardPatch, nsPatch }
 */
export function linkPatchesOf({ job, so, by = '', at = Date.now() } = {}) {
    const stillQuote = !['APPROVED', 'SO_CONFIRMED'].includes(U(job && job.status));
    return {
        jobPatch: {
            netsuiteSalesOrderId: so.id, netsuiteSalesOrderNo: so.tranid,
            ...(stillQuote ? { status: 'APPROVED' } : {}),
            nsLinkedExisting: { tranid: so.tranid, id: so.id, at, by: S(by), wasStatus: S(job && job.status) },
        },
        boardId: boardSoIdOf(job),
        boardPatch: { nsInternalId: so.id, soId: so.tranid, nsLinkedExistingAt: at, nsLinkedExistingBy: S(by) },
        nsPatch: { custbody50: S(job.id || job.jobId) },
    };
}

/** The confirm the person reads before anything is written. */
export const linkConfirmText = ({ job, so, quoteTotal = 0, autoReleaseOn = null } = {}) => {
    const q = (job && (job.quoteNo || job.jobId || job.id)) || '';
    const diff = Math.abs((Number(so.total) || 0) - (Number(quoteTotal) || 0));
    return [`🔗 Link ${q} to ${so.tranid}?`, '',
        `NetSuite ${so.tranid} · ${so.customer} · ${OPEN[so.status]} · $${(Number(so.total) || 0).toFixed(2)}${so.date ? ` · ${so.date}` : ''}${so.memo ? ` · "${so.memo}"` : ''}`,
        `App quote ${q} · ${(job && job.customer && job.customer.name) || ''} · $${(Number(quoteTotal) || 0).toFixed(2)}${job && job.sidemark ? ` · "${job.sidemark}"` : ''}`,
        ...(diff >= 0.01 ? [`⚠ The totals differ by $${diff.toFixed(2)} (shipping, a discount, or a different order). NetSuite bills its own lines; the floor builds this quote's configuration.`] : []),
        '',
        `• No new NetSuite order is created. The quote and its RTG card take ${so.tranid}; ${so.tranid} is stamped with ${(job && (job.id || job.jobId)) || ''} (queued).`,
        autoReleaseOn === false
            ? '• RTG\'s automatic release is OFF for this division — release it from its RTG card.'
            : '• RTG releases it to the floors from this quote\'s configuration — automatically, once nothing holds it.',
    ].join('\n');
};
