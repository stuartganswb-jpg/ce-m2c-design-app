// ── ORDERS PARKED FOR A PERSON'S REVIEW — SAID ON RTG (Stuart 2026-10-12: "RTG is master of order details, state it there") ──
// SO60812 sat eleven days: the automatic start (Shared/oeGenerate.runOeAuto) had looked at it two minutes after it was
// entered, found a sourcing decision and a rod with no length, and recorded exactly why — on the order's own RTG card,
// which nobody had a reason to open. SO60583 was at twenty-two days the same way. The record was right; the board never
// said it. This is the list RTG now leads with: every Order Entry order whose automatic start is waiting on a person
// (or failed), oldest first, with the lines still not started and the reason recorded for each.
// A line that has since been started (its stamp is on the order) is no longer listed; an order with none left is gone.
// Pure — scripts/reviewWaiting.test.mjs. The banner is Shared/ReviewWaitingBanner.
const U = (v) => String(v == null ? '' : v).trim().toUpperCase();
const DEAD = ['Closed', 'Deleted', 'CANCELLED', 'Shipped', 'Completed'];

/**
 * @param orders  the live sales orders (hq_sales_orders) the board already holds
 * @returns Array<{ id, ref, customer, state, since, days, lines: [{ lineIdx, erp, finish, reason }], error }>
 */
export function reviewWaitingOf(orders = [], { now = Date.now() } = {}) {
    return (orders || []).filter(o => o && !o.deleted && !o.rtgArchived && !DEAD.includes(String(o.status || '')) && !o.displayRelease
        && o.oeAuto && ['NEEDS_REVIEW', 'FAILED'].includes(o.oeAuto.state))
        .map(o => {
            const a = o.oeAuto;
            const gen = o.oeGen || {};
            const lines = (Array.isArray(a.review) ? a.review : [])
                .filter(r => r && Number.isInteger(r.lineIdx) && !gen[r.lineIdx] && (o.lines || [])[r.lineIdx])
                .map(r => ({ lineIdx: r.lineIdx, erp: U(r.erp || ((o.lines || [])[r.lineIdx] || {}).erp), finish: U(r.finish), reason: String((r.reasons || [])[0] || '') }))
                .sort((x, y) => x.lineIdx - y.lineIdx);
            const since = Number(a.at) || 0;
            return { id: o.id, ref: String(o.soId || o.id), customer: String(o.customer || ''), state: a.state, since, days: since ? Math.floor((now - since) / 86400000) : 0, lines, error: a.state === 'FAILED' ? String(a.error || '') : '' };
        })
        .filter(r => r.lines.length || r.state === 'FAILED')
        .sort((a, b) => (a.since || 0) - (b.since || 0));
}

/** "12 days" · "today" · "1 day" */
export const waitedText = (days) => (days <= 0 ? 'today' : `${days} day${days === 1 ? '' : 's'}`);
