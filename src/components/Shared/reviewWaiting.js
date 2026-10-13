// ── ORDERS PARKED FOR A PERSON'S REVIEW — SAID ON RTG (Stuart 2026-10-12: "RTG is master of order details, state it there") ──
// SO60812 sat eleven days: the automatic start (Shared/oeGenerate.runOeAuto) had looked at it two minutes after it was
// entered, found a sourcing decision and a rod with no length, and recorded exactly why — on the order's own RTG card,
// which nobody had a reason to open. SO60583 was at twenty-two days the same way. The record was right; the board never
// said it. This is the list RTG now leads with: every Order Entry order whose automatic start is waiting on a person
// (or failed), oldest first, with the lines still not started and the reason recorded for each.
// A line that has since been started (its stamp is on the order) is no longer listed; an order with none left is gone.
// Pure — scripts/reviewWaiting.test.mjs. The banner is Shared/ReviewWaitingBanner.
import { unstartedTbfLinesOf } from './orderStatus.js';

const U = (v) => String(v == null ? '' : v).trim().toUpperCase();
const DEAD = ['Closed', 'Deleted', 'CANCELLED', 'Shipped', 'Completed'];
const msOf = (v) => (v && typeof v.toMillis === 'function') ? v.toMillis() : (v && typeof v.seconds === 'number' ? v.seconds * 1000 : (typeof v === 'number' ? v : (Date.parse(v) || 0)));

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

// ── …AND THE ORDERS NOTHING HAS LOOKED AT (Stuart 2026-10-13) ────────────────────────────────────────────────────────
// The list above is what the automatic start PARKED. With ⚡ automatic release switched off the automatic start never
// runs, so an order's to-be-finished lines sit with no record of any kind — SO60993 (two lines, entered 10-08) was on no
// list until the switch came back on 10-12. This is that order: NetSuite has accepted it, it has to-be-finished lines
// with no start stamp, and the automatic start is neither parked on it (that is the list above) nor working on it now.
// A quarter of an hour's grace, so an order the automatic start is about to take is not flashed up.
// Its own list, never mixed into the one above — the Day summary reads that one to say WAITING FOR REVIEW.
export const NOT_STARTED_GRACE_MS = 15 * 60 * 1000;
/** @returns Array<{ id, ref, customer, since, days, lines: [{ lineIdx, erp }] }> — oldest first */
export function notStartedOf(orders = [], { now = Date.now(), graceMs = NOT_STARTED_GRACE_MS, isOrderEntry = () => true } = {}) {
    return (orders || []).filter(o => o && !o.deleted && !o.rtgArchived && !DEAD.includes(String(o.status || '')) && !o.displayRelease && o.packMode !== 'DISPLAY'
        && !!o.nsInternalId && isOrderEntry(o)
        && !(o.oeAuto && ['NEEDS_REVIEW', 'FAILED'].includes(o.oeAuto.state))
        && !(o.oeAuto && o.oeAuto.state === 'RUNNING' && (now - (Number(o.oeAuto.at) || 0)) < graceMs))
        .map(o => {
            const since = Math.max(msOf(o.createdAt), Number(o.oeAuto && o.oeAuto.at) || 0);
            return { id: o.id, ref: String(o.soId || o.id), customer: String(o.customer || ''), since, days: since ? Math.floor((now - since) / 86400000) : 0, lines: unstartedTbfLinesOf(o) };
        })
        .filter(r => r.lines.length && (now - r.since) >= graceMs)
        .sort((a, b) => (a.since || 0) - (b.since || 0));
}

/** "12 days" · "today" · "1 day" */
export const waitedText = (days) => (days <= 0 ? 'today' : `${days} day${days === 1 ? '' : 's'}`);
