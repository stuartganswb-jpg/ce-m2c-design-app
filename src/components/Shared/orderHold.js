// A CUSTOM ORDER THAT GOES WRONG STOPS — IT DOES NOT JOIN A LIST.
//
// Stuart 2026-08-21, on Eric's "Custom Order – Parts Shortage / Damaged Parts" case:
//   "I thought we had set the system so this scenario can not even happen. On a custom order if
//    something is bad, missing, etc. the whole order must stop, they fix the issue and carry on
//    finishing … it should sit as a pinned order on top of the screen — if it is scrap then at top
//    of finishing, at packaging at time of packing, etc. This is the type of issue that needs
//    management to see and react immediately, not be added to a list of to-do's."
//
// That is a different mechanism from the stock-order scrap path, and deliberately so. A stock build
// short by two is an accounting event: build what is good, close the balance, re-issue. A CUSTOM
// order short by two cannot ship at all — the customer ordered a set. So there is nothing to
// reconcile and nothing to close; there is a problem, and someone has to fix it before the order
// moves another step.
//
// A hold therefore:
//   • lands on EVERY document the order owns, so it pins wherever the order is looked at rather
//     than only on the screen that raised it;
//   • records WHERE it happened, because "scrap at packing" and "scrap at finishing" are different
//     conversations;
//   • goes out on OS Comms the moment it is raised — an escalation nobody is told about is a list;
//   • can only be lifted with a note saying what was done.

import { linkedDocsOf } from './orderLifecycle';

export const HOLD_STAGES = {
    SHOP: 'Shop floor',
    FINISHING: 'Finishing floor',
    PACKING: 'Packing',
    WMS: 'Warehouse',
};

export const isHeld = (d) => !!(d && d.held === true);

// Held orders sort above everything, oldest first — the one that has been stopped longest is the
// one costing the most.
export const holdFirst = (a, b) => {
    const ha = isHeld(a), hb = isHeld(b);
    if (ha !== hb) return ha ? -1 : 1;
    if (ha) return (a.heldAt || 0) - (b.heldAt || 0);
    return 0;
};

/**
 * Stop an order everywhere it appears.
 * @param stage one of HOLD_STAGES keys — where the problem was found
 */
export async function holdOrder(ctx, { order, kind, stage, reason, detail, by, notify }) {
    const { db, doc, updateDoc } = ctx;
    if (!reason) throw new Error('A hold needs a reason — it is what the next person acts on.');
    const links = await linkedDocsOf(ctx, order, kind);
    const patch = {
        held: true,
        heldAt: Date.now(),
        heldBy: by || '',
        heldStage: stage || 'WMS',
        heldReason: reason,
        ...(detail ? { heldDetail: detail } : {}),
        heldClearedAt: null, heldClearedBy: null, heldClearedNote: null,
    };
    let n = 0;
    for (const [id] of links.fin) { await updateDoc(doc(db, 'fin_workorders', id), patch).catch(() => {}); n++; }
    for (const [id] of links.shop) { await updateDoc(doc(db, 'shop_custom_orders', id), patch).catch(() => {}); n++; }
    if (links.hq) { await updateDoc(doc(db, links.hq.coll, links.hq.id), patch).catch(() => {}); n++; }
    if (notify) {
        await notify(`🛑 ORDER STOPPED at ${HOLD_STAGES[stage] || stage || 'the floor'} — ${order.nsWoTran || order.soId || order.id}: ${reason}${detail ? ` (${detail})` : ''}. Raised by ${by || 'the floor'}. This order does not move until it is resolved.`).catch(() => {});
    }
    return { docs: n, hqFound: !!links.hq };
}

/** Lift the hold — only with a note, because "fixed" without saying how is not an answer. */
export async function releaseHold(ctx, { order, kind, note, by, notify }) {
    const { db, doc, updateDoc } = ctx;
    if (!note) throw new Error('Say what was done — a hold lifted silently teaches nobody anything.');
    const links = await linkedDocsOf(ctx, order, kind);
    const patch = {
        held: false, heldClearedAt: Date.now(), heldClearedBy: by || '', heldClearedNote: note,
    };
    let n = 0;
    for (const [id] of links.fin) { await updateDoc(doc(db, 'fin_workorders', id), patch).catch(() => {}); n++; }
    for (const [id] of links.shop) { await updateDoc(doc(db, 'shop_custom_orders', id), patch).catch(() => {}); n++; }
    if (links.hq) { await updateDoc(doc(db, links.hq.coll, links.hq.id), patch).catch(() => {}); n++; }
    if (notify) {
        await notify(`▶ RESUMED — ${order.nsWoTran || order.soId || order.id} is moving again. ${note} (cleared by ${by || 'unknown'})`).catch(() => {});
    }
    return n;
}
