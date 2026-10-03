// ── A SHOP JOB IS WRITTEN ONCE — AND A ROW'S JOB IS ONE CONFIGURATION (Eric, App Imp 2026-10-02 · SO60585 Row 2) ──
// "I also did the plating and receipt for this row, and at some point Row 2 as 'Row 2 · EP2 · 1 pole line + 2
//  riding' has shown back up in Shop."
// Row 2's shop job was completed at 12:29 (Sent to Plating), scanned out, put on PO2344 and received — then at
// 12:55 RTG released the same job AGAIN, and the release wrote the shop document from scratch (setDoc, no merge):
// status Pending, the completion gone. The plating receipt had nothing to do with it.
//
//   · CREATE ONCE. A release writes the shop job only when none exists; one that exists is never rewritten. The
//     one deliberate exception is RTG's confirmed ↻ Re-dispatch of a whole sales order, whose confirm says it
//     overwrites (Shared/floorRelease.writeShopDocOnce reads this).
//   · A PAIR'S JOB IS ONE CONFIGURATION. A row / Order Entry pair carries ONE row and ONE finish; the shop card
//     listed every configuration of the whole quote under it (Rows 2–6 on Row 2's card) — checkboxes that were
//     never this job's. The per-configuration checklist belongs to a whole-quote job only.
//   · ALREADY DONE. A job whose finishing half already says the shop work is done (Sent to Plating / Complete)
//     while the job itself is still open is a copy that came back — the card says so, and a supervisor closes it
//     without a second plating card (Shop: "Already done — close").
// Pure. Harness: scripts/shopJobOnce.test.mjs.

/** CREATE · KEEP · REPLACE — what a release does to the shop job it is about to write. */
export const shopWriteDecision = (existing, { replace = false } = {}) => (!existing ? 'CREATE' : (replace ? 'REPLACE' : 'KEEP'));

/** The line a release logs when it keeps a job that exists. */
export const keptShopJobText = (existing) => {
    if (!existing) return '';
    const by = existing.completedBy ? `, completed by ${existing.completedBy}` : '';
    return `${existing.id || 'The shop job'} is already on the shop floor (${existing.status || 'Pending'}${by}) — not re-written.`;
};

/** Is this shop document a row / Order Entry pair's half (one row, one finish)? */
export const isPairShopDoc = (order) => !!order && (
    !!order.rowKey
    || /^SHOP-WO-OE-/i.test(String(order.id || ''))
    || /^WO-OE-/i.test(String(order.finSiblingId || '')));

/** The configurations the card lists one box each for — the quote's, on a whole-quote job only. */
export const shopConfigsOf = (order, configsByQuote = {}) => {
    if (!order || !order.quoteId || isPairShopDoc(order)) return [];
    return (configsByQuote && configsByQuote[order.quoteId]) || [];
};

const DONE_BY_SIBLING = ['Sent to Plating', 'Complete'];
const SHOP_DONE = ['Completed', 'Sent to Plating'];

/**
 * The finishing half says the shop work is done while this job is still open — a copy that came back.
 * @returns {null | { siblingStatus, siblingAt, closeStatus }}  closeStatus: what the shop's own Complete would
 *          have written (a plated job → 'Sent to Plating', else 'Completed').
 */
export const alreadyDoneOf = (order, sibling, { plated = false } = {}) => {
    if (!order || !sibling || order.closed) return null;
    if (SHOP_DONE.includes(String(order.status || ''))) return null;
    const st = String(sibling.customFabStatus || '');
    if (!DONE_BY_SIBLING.includes(st)) return null;
    return { siblingStatus: st, siblingAt: Number(sibling.customFabAt) || null, closeStatus: plated ? 'Sent to Plating' : 'Completed' };
};

/** The fields the supervisor's close writes on the shop job — only the shop job: no sibling mirror, no plating card. */
export const alreadyDoneClosePatch = (done, { by = '', now = Date.now() } = {}) => (done ? {
    status: done.closeStatus, completedAt: now, completedBy: by,
    alreadyDoneClose: { by, at: now, siblingStatus: done.siblingStatus, siblingAt: done.siblingAt },
} : null);
