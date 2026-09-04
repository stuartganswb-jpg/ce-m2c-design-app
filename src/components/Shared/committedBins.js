// ══ COMMITTED ORDER BINS — where a customer's parts wait for each other ═══════════════════════
//
// Stuart 2026-09-03, describing what the warehouse actually needs:
//   "20 arrived, 10 can go to the stock bin, 10 are for SO## and need to go to a sales order
//    committed bin (operator assigns bin when scanning away first part on the order, once a part
//    is in a commited bin we tell the balance of parts to go there)."
//   "packer scans any empty committed bin and it becomes that order's until it ships"
//   "we want more detail in the app to prevent product from going to the wrong order or a newer
//    order getting something that should not be available."
//
// ── THE ONE THING TO UNDERSTAND ───────────────────────────────────────────────────────────────
// A committed bin is APP-ONLY AND IS NEVER PUSHED TO NETSUITE (Stuart, same conversation: "no it
// only shows in netsuite that it is committed to the order, it does not move the bin there… that
// stays in app does not push to netsuite"). NetSuite goes on believing the stock sits in its shelf
// bin, and shows it committed to the sales order. The app carries the finer physical truth —
// WHICH bin, for WHICH order — because that is what stops a newer order being handed pieces an
// older one is already waiting on. Nothing in here produces a NetSuite write, ever.
//
// ── NO NAMING CONVENTION, DELIBERATELY ────────────────────────────────────────────────────────
// A committed bin is not a code shape; it is whichever bin the packer scans. Inventing a pattern
// (CO-01, COMMIT-*) would reject the labels they actually have on the racks and would be one more
// place a rule can drift. "Empty" therefore means ONE thing, and it is the only rule enforced
// here: no OTHER open order is already using that bin. That is the whole guard, and it is exact.
//
// Pure on purpose: no Firestore, no NetSuite, no browser. The arithmetic is the part that must not
// be wrong, so it is separable and tested (scripts/committedBins.test.mjs).

export const upBin = (b) => String(b || '').trim().toUpperCase().replace(/\s+/g, ' ');
export const upCode = (c) => String(c || '').trim().toUpperCase();

/** The bin an order is gathering into, or '' when it has not been given one yet. */
export const committedBinOf = (order) => upBin(order && order.committedBin);

/** How many of one code are already gathered for this order. */
export const committedQtyOf = (order, code) => {
    const m = (order && order.committedQty) || {};
    return Number(m[upCode(code)] || 0) || 0;
};

/**
 * Is this bin free to become `selfId`'s bin?
 *
 * Free means: no OTHER order that is still open is gathering into it. An order that has shipped or
 * closed has released its bin by definition — the pieces left with the order — so a terminal order
 * never blocks a bin. Returns the blocking order, or null.
 *
 * @param {string} bin
 * @param {Array}  orders   every order in play (the caller passes what it already has in memory)
 * @param {string} selfId   the order asking; its own claim is not a conflict
 * @param {function} isOpen (order) => boolean — the caller owns "what counts as open"
 */
export function binConflict(bin, orders, selfId, isOpen) {
    const b = upBin(bin);
    if (!b) return null;
    const open = typeof isOpen === 'function' ? isOpen : (() => true);
    return (orders || []).find(o => o && o.id !== selfId && committedBinOf(o) === b && open(o)) || null;
}

/**
 * What happens when `qty` of `code` is gathered for this order.
 *
 * Two refusals, both of them the point of the feature:
 *   • a bin already held by another open order — the pieces would join the wrong customer's pile;
 *   • gathering MORE than the order asked for — the surplus belongs to stock or to another order,
 *     and silently absorbing it here is how a second order goes short with no trace.
 *
 * `ordered` is what the line asks for; pass 0 to skip the over-commit check (a caller that cannot
 * see the line quantity should say so rather than pretend the check passed).
 */
export function planCommit({ order, code, qty, bin, ordered = 0, orders = [], isOpen }) {
    const c = upCode(code);
    const n = Math.floor(Number(qty) || 0);
    const already = committedQtyOf(order, c);
    const existing = committedBinOf(order);
    const want = upBin(bin) || existing;

    if (!c) return { ok: false, reason: 'no item code on this line' };
    if (n <= 0) return { ok: false, reason: 'nothing to commit — quantity must be at least 1' };
    if (!want) return { ok: false, reason: 'scan the committed bin these pieces are going into' };

    // The bin can only change while nothing is gathered yet; moving a part-full order is a physical
    // act (someone carries the pieces), so it goes through release, not through a quiet re-stamp.
    if (existing && want !== existing && already + otherGathered(order, c) > 0) {
        return { ok: false, reason: `this order is already gathering into ${existing} — release it before moving to ${want}` };
    }
    const clash = binConflict(want, orders, order && order.id, isOpen);
    if (clash) return { ok: false, reason: `${want} is already holding ${clash.soId || clash.id} — scan an empty committed bin`, conflict: clash };

    if (ordered > 0 && already + n > ordered) {
        return { ok: false, reason: `${already + n} would be more than the ${ordered} ordered (${already} already gathered) — the surplus belongs to stock or another order` };
    }
    return { ok: true, bin: want, code: c, qty: n, total: already + n, wasFirst: !existing };
}

/** Total gathered across every OTHER code on the order — "is this order holding anything at all". */
function otherGathered(order, exceptCode) {
    const m = (order && order.committedQty) || {};
    return Object.keys(m).reduce((a, k) => (k === upCode(exceptCode) ? a : a + (Number(m[k]) || 0)), 0);
}

/** Everything gathered for this order, across all codes. */
export const totalGathered = (order) => {
    const m = (order && order.committedQty) || {};
    return Object.keys(m).reduce((a, k) => a + (Number(m[k]) || 0), 0);
};

/**
 * Give some of it back.
 *
 * PARTIAL IS THE NORMAL CASE, not the edge one (Brief E, 2026-09-03): plated poles come back short,
 * part of the bin ships and part stays committed. So release is per code and quantity, and the
 * whole-bin release is the shortcut over that, never the only shape.
 */
export function planRelease({ order, code, qty }) {
    const c = upCode(code);
    const have = committedQtyOf(order, c);
    const n = Math.floor(Number(qty) || 0);
    if (!c) return { ok: false, reason: 'no item code' };
    if (have <= 0) return { ok: false, reason: 'none of this item is gathered for this order' };
    if (n <= 0) return { ok: false, reason: 'quantity must be at least 1' };
    if (n > have) return { ok: false, reason: `only ${have} gathered — cannot release ${n}` };
    const left = have - n;
    const emptyAfter = left === 0 && otherGathered(order, c) === 0;
    return { ok: true, code: c, qty: n, left, emptyAfter };
}

/** Where should the next piece for this order go? The whole point of the "tell them" rule. */
export const nextBinFor = (order) => committedBinOf(order) || '';

/**
 * The line-level picture the SO Pack card renders: what is asked, gathered, and still to come.
 * Kept here so the screen and any future one cannot each invent their own arithmetic.
 */
export function lineGathering({ order, code, ordered }) {
    const gathered = committedQtyOf(order, code);
    const want = Math.max(0, Math.floor(Number(ordered) || 0));
    return { gathered, ordered: want, outstanding: Math.max(0, want - gathered), complete: want > 0 && gathered >= want };
}

// ══ WHO IS WAITING FOR THESE? — the arrival alert ═════════════════════════════════════════════
//
// Stuart 2026-09-03, describing the gap this closes:
//   "the small parts are ordered in bulk and kept in stock, so when they come back they at this
//    point may not realize there are back orders against them. so what is the tool that alerts the
//    wms operators that hey this just came in and 20 arrived 10 can go to the stock bin but 10 are
//    for SO## and need to go to a sales order commited bin."
//
// Two different arrivals, and only the second needs this:
//   • A pole plated FOR one order comes back FOR that order. Its shipment line carries the sales
//     order, so nobody has to work anything out — it goes straight to that order's bin.
//   • Small parts come back in BULK to stock, and the backorders against them are invisible at the
//     dock. That is the case that quietly ships a customer's parts onto the open shelf, where the
//     next order takes them.
//
// So: given what just arrived, which open orders are short of it, oldest need first, and what is
// left over for stock. OLDEST FIRST is the rule because it is the only one that cannot be gamed by
// the order of arrival — and it is the same instinct behind the whole feature, that an older
// order must not lose its pieces to a newer one.
//
// Pure: the caller resolves its own orders into `demands` and keeps line shapes out of here.

/**
 * @param {number} qty      pieces that just arrived
 * @param {Array}  demands  [{ orderId, ref, ordered, gathered, needBy, createdAt }] — open orders
 *                          carrying this code. `ordered - gathered` is what each still needs.
 * @returns {{allocations: Array, toStock: number, demandTotal: number, shortfall: number}}
 */
export function planAllocation({ qty, demands = [] }) {
    let left = Math.max(0, Math.floor(Number(qty) || 0));
    const rows = (demands || [])
        .map(d => ({
            orderId: d.orderId, ref: d.ref || d.orderId,
            outstanding: Math.max(0, (Math.floor(Number(d.ordered) || 0)) - (Math.floor(Number(d.gathered) || 0))),
            needBy: String(d.needBy || ''), createdAt: Number(d.createdAt) || 0,
        }))
        .filter(d => d.orderId && d.outstanding > 0)
        // Oldest NEED first; an order with no date sorts after ones that have one (it is not
        // urgent by absence), then by when the order was raised.
        .sort((a, b) => {
            const an = a.needBy || '￿', bn = b.needBy || '￿';
            if (an !== bn) return an < bn ? -1 : 1;
            return a.createdAt - b.createdAt;
        });

    const demandTotal = rows.reduce((s, r) => s + r.outstanding, 0);
    const allocations = [];
    for (const r of rows) {
        if (left <= 0) break;
        const take = Math.min(left, r.outstanding);
        allocations.push({ orderId: r.orderId, ref: r.ref, qty: take, outstanding: r.outstanding });
        left -= take;
    }
    return {
        allocations,
        toStock: left,
        demandTotal,
        shortfall: Math.max(0, demandTotal - (Math.floor(Number(qty) || 0))),
    };
}

/** One line of plain words for the operator: what this arrival does. */
export function allocationSummary(plan, code) {
    if (!plan) return '';
    const c = upCode(code);
    if (!plan.allocations.length) return `All ${plan.toStock} × ${c} to stock — no open order is waiting for it.`;
    const parts = plan.allocations.map(a => `${a.qty} for ${a.ref}`);
    if (plan.toStock > 0) parts.push(`${plan.toStock} to stock`);
    const tail = plan.shortfall > 0 ? ` · still short ${plan.shortfall} across the open orders` : '';
    return `${c}: ${parts.join(' · ')}${tail}`;
}
