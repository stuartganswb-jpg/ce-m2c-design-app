// CLOSING A WORK ORDER SHORT — build what's good, close the balance, account for the rest.
// (Eric 2026-08-18; decisions from Stuart 2026-08-19.)
//
// Eric filed four scenarios. Underneath they are ONE mechanism with two questions:
//
//   wrong parts finished  →  build 0, the whole order is re-issued for the right item
//   finishing flaw        →  build the good, the bad goes BACK TO RAW
//   shortage              →  build the good, there are no bad pieces at all
//   damaged received      →  build the good, the bad is ADJUSTED OUT
//
// So: how many are GOOD, how many BAD physically exist, and are those bad ones salvageable.
// Everything else follows. Settled with Stuart:
//   • never change the assembly on a live work order — CLOSE AND RE-ISSUE
//   • the replacement is PROMPTED, reusing the make-up-order pattern, parked in RTG for release
//   • salvageable → back to raw stock; otherwise adjusted out
//   • manager and above only
//
// Pure: no Firestore, no NetSuite. The arithmetic is the part that must not be wrong, so it is
// separable and tested.

const clamp = (v, lo, hi) => Math.min(Math.max(Number(v) || 0, lo), hi);

/**
 * @param {number} ordered  quantity the work order was raised for
 * @param {number} good     pieces actually good and being built
 * @param {number} bad      pieces that physically exist but are not good (0 for a pure shortage)
 * @param {boolean} salvage are those bad pieces recoverable to raw stock?
 */
export function planBalanceClose({ ordered, good, bad, salvage }) {
    const o = Math.max(0, Math.floor(Number(ordered) || 0));
    const g = clamp(Math.floor(Number(good) || 0), 0, o);
    // Bad pieces came out of the same raw as the good ones, so they cannot exceed what is left.
    const b = clamp(Math.floor(Number(bad) || 0), 0, Math.max(0, o - g));
    const balance = o - g;
    return {
        ordered: o,
        good: g,
        bad: b,
        balance,                                   // what the close writes off
        buildQty: g,                               // assembly build in NetSuite
        // NO ADJUSTMENT WHEN THE PARTS ARE SALVAGEABLE (Eric 2026-08-21, correcting my first pass).
        // "Notice to send any flawed finish parts back to the BIN … Result: no raw inventory
        // loss/discrepancy." The raw for the BAD pieces was never consumed — the build only
        // consumes what it builds — so it is still on the books. Adding it back would count it
        // TWICE. What is needed is a physical instruction with the bin, not a stock movement.
        returnToBinQty: salvage ? b : 0,           // go put them back — no NetSuite write
        adjustOutQty: salvage ? 0 : b,             // real scrap: the raw IS gone, take it off
        reissueQty: balance,                       // suggested replacement, always prompted
        // A shortage with nothing physical to account for is the commonest case; saying so stops
        // the salvage question being asked when there is nothing to salvage.
        hasPhysicalBad: b > 0,
        nothingToDo: o === 0 || (g === 0 && b === 0 && balance === 0),
    };
}

/** Human summary of what pressing Confirm will actually do — shown before anything is written. */
export function describeBalanceClose(plan, { itemCode, rawCode, bin }) {
    const l = [];
    if (plan.buildQty > 0) l.push(`• BUILD ${plan.buildQty} × ${itemCode} in NetSuite`);
    else l.push(`• No build — nothing good came off this order`);
    if (plan.returnToBinQty > 0) l.push(`• PUT BACK ${plan.returnToBinQty} × ${rawCode || 'the raw item'} into bin ${bin || '(bin unknown)'} — no stock movement: the build never consumed them, so they are still on the books`);
    if (plan.adjustOutQty > 0) l.push(`• SCRAP ${plan.adjustOutQty} × ${rawCode || 'the raw item'} (− adjustment — the raw is genuinely gone)`);
    l.push(`• CLOSE the balance of ${plan.balance} in the app, and raise the NetSuite close as a task`);
    if (plan.reissueQty > 0) l.push(`• You'll then be asked whether to re-issue ${plan.reissueQty}`);
    return l.join('\n');
}

/** NetSuite assembly build for the good pieces. Same shape as the pack build already in WMS. */
export function buildPayload({ nsItemId, qty, location, subsidiary, memo }) {
    return {
        item: { id: String(nsItemId) },
        quantity: Math.max(1, Math.floor(Number(qty) || 0)),
        location: { id: String(location) },
        subsidiary: { id: String(subsidiary) },
        memo: memo || 'Partial build — balance closed',
    };
}

/**
 * Inventory adjustment for the bad pieces, against the RAW item.
 * `qty` is signed by the caller's intent: positive returns to stock, negative scraps.
 * Mirrors the pack-scrap adjustment already in WMS (account 254) rather than inventing a second
 * way to move stock.
 */
export function adjustmentPayload({ nsItemId, qty, bin, binExact, location, subsidiary, memo }) {
    // A fractional pull (a rod's feet per piece) keeps three places; whole pieces are unchanged.
    const n = Math.round((Number(qty) || 0) * 1000) / 1000;
    // `binExact`: NetSuite's own spelling from a live bin read (the bin lock rule, 2026-09-25 — twin bins
    // differ only in case), posted as given. `bin` (a stored name) is tidied to upper case as before.
    const b = binExact ? String(binExact).trim() : String(bin || '').trim().toUpperCase();
    const useBin = b && b !== 'UNASSIGNED';
    return {
        account: { id: '254' },
        subsidiary: { id: String(subsidiary) },
        memo: memo || 'Work order balance close',
        inventory: {
            items: [{
                item: { id: String(nsItemId) },
                location: { id: String(location) },
                adjustQtyBy: n,
                ...(useBin ? { inventoryDetail: { quantity: n, inventoryAssignment: { items: [{ binNumber: { refName: b }, quantity: n }] } } } : {}),
            }],
        },
    };
}

// Manager and above. Deliberately a named list rather than a role check scattered inline — this
// moves NetSuite inventory, so widening it should be one deliberate edit here.
export const MANAGER_ROLES = ['superadmin', 'admin', 'executive'];
export const canCloseBalance = (role) => MANAGER_ROLES.includes(String(role || '').toLowerCase());

// ── A STOCK ORDER CLOSES SHORT; A CUSTOM ORDER DOES NOT (Stuart 2026-09-29) ─────────────────────
// "on the floor for stock orders when we complete a work order if there is scrap, order is 100, 96
//  good, 4 scrap we need to be able to close out the work order and call it complete. for custom
//  orders the rule is no, add warning and fix, but for stock orders this should be the standard
//  close short." Then, asked: floor scrap is thrown out (so its raw comes off NetSuite) — "yes"; the
//  shop's stock milling closes short the same way — "yes"; and a packing scrap on a stock order
//  before it is put away is the same close — "yes" (it used to lower the build AND adjust the
//  finished item out, so the shelf came up short twice).
//
// The ONE reading every screen uses: the finishing floor's final check, the shop's last op, the WMS
// put-away and packing scrap, and RTG's close list. The manager's ⚖ Close Short on RTG (above) stays
// the exception path — salvage, re-issue — for anything the floor did not close.

/** A custom sales order never closes short — the floor blocks it and alerts the supervisor. */
export const isCustomSalesDoc = (d) => !!d && (d.orderType === 'sales' || (d.orderType !== 'stock' && !!(d.soId || d.salesOrderId)));

/**
 * The close of a stock order that came off the floor short.
 * @returns { ordered, good, scrap, balance, short } — scrap never exceeds the pieces that were not good;
 *          balance is what the work order did not build (scrap, plus any pieces that never ran).
 */
export function stockCloseShortOf({ ordered, good, scrap }) {
    const o = Math.max(0, Math.floor(Number(ordered) || 0));
    const g = clamp(Math.floor(Number(good) || 0), 0, o);
    const s = clamp(Math.floor(Number(scrap) || 0), 0, o - g);
    return { ordered: o, good: g, scrap: s, balance: o - g, short: o > 0 && g < o };
}

/** The close a stock order's RTG record carries — the fields RTG's ⚖ Close Short writes, so the board reads one shape. */
export const closeShortStamps = (plan, { by = '', at = 0 } = {}) => ({
    closedShort: true, builtQty: plan.good, badQty: plan.scrap, balanceClosed: plan.balance,
    balanceClosedBy: by || '', balanceClosedAt: Number(at) || 0,
});

/** The screens' one sentence for a stock close-short. */
export const closeShortLine = (plan) => `built ${plan.good} of ${plan.ordered}${plan.scrap ? ` · ${plan.scrap} scrap` : ''}${plan.balance > plan.scrap ? ` · ${plan.balance - plan.scrap} never ran` : ''}`;

/**
 * What closing short sets in motion, said before anything is written. A paint-only run (JFP) has no work order: its
 * pull already took every piece out, and the put-away adjusts the good ones in, so the rest is accounted for.
 */
export const closeShortNext = (plan, { paintOnly = false, hasNsWo = true } = {}) => {
    if (paintOnly) return `At put-away the ${plan.good} good are adjusted into the bin — the pull already took all ${plan.ordered} out, so the other ${plan.balance} are accounted for.`;
    if (!hasNsWo) return `This run has no NetSuite work order, so nothing posts to NetSuite.`;
    return `At put-away NetSuite builds ${plan.good}${plan.scrap ? ` and the raw for the ${plan.scrap} scrapped piece(s) comes off the books` : ''}; RTG then lists the work order's balance of ${plan.balance} to close in NetSuite.`;
};

/**
 * WHAT NETSUITE STILL OWES AFTER A SHORT BUILD: the work order's unbuilt balance. A non-WIP work order
 * cannot be closed through the API (Eric 2026-08-21, Option 3), so RTG lists it for a person to close —
 * once the build has POSTED, never before (a work order closed ahead of its build refuses the build).
 * Stamped at the moment of the close (put-away, the shop's last op), so only closes from now on are
 * listed — older short builds are not guessed at.
 */
export const shortBuildStamps = ({ ordered, built }) => {
    const o = Math.max(0, Math.floor(Number(ordered) || 0));
    const b = clamp(Math.floor(Number(built) || 0), 0, o);
    return o > b ? { nsWoShortBalance: o - b, nsWoShortBuilt: b, nsWoShortOrdered: o } : {};
};
/** A short build's balance still open in NetSuite (cleared by the ✓ Closed in NetSuite confirmation). */
export const shortBalanceOpen = (d) => !!d && Number(d.nsWoShortBalance) > 0 && !d.nsWoClosed;

/**
 * THE RAW THAT WENT INTO THE SCRAPPED PIECES — thrown out, so it comes off NetSuite. A build consumes
 * only what it builds, so the scrapped pieces' raw is still on the books. Read from the document's own
 * pull list (what the WMS picked for the work order): per piece = the line's quantity ÷ the order's
 * quantity. A line the pick skipped was never pulled, so it is not scrapped either.
 * @returns [{ code, qty }]
 */
export function scrapRawOf({ partsList = [], ordered, scrap, skipped = [] } = {}) {
    const o = Number(ordered) || 0, s = Number(scrap) || 0;
    if (o <= 0 || s <= 0) return [];
    const U = (v) => String(v == null ? '' : v).trim().toUpperCase();
    const skip = new Set((skipped || []).map(x => U(x && typeof x === 'object' ? (x.itemId || x.code) : x)).filter(Boolean));
    const byCode = new Map();
    (partsList || []).forEach(l => {
        const code = U(l && (l.legacyErpId || l.partId || l.code));
        const q = Number(l && (l.quantity != null ? l.quantity : l.qty)) || 0;
        if (!code || q <= 0 || skip.has(code)) return;
        byCode.set(code, (byCode.get(code) || 0) + q);
    });
    return [...byCode.entries()]
        .map(([code, q]) => ({ code, qty: Math.round((q / o) * s * 1000) / 1000 }))
        .filter(r => r.qty > 0);
}

/**
 * The bin scrapped raw comes out of: a LIVE NetSuite bin holding at least that much, largest first —
 * never a guessed bin. null when no bin holds it; the caller names it and posts nothing.
 * @param bins [{ bin, name, qty }] — the WMS live per-bin read
 */
export const scrapBinOf = (bins = [], qty) => (bins || [])
    .filter(b => b && (b.name || b.bin) && (Number(b.qty) || 0) >= (Number(qty) || 0))
    .sort((a, b) => (Number(b.qty) || 0) - (Number(a.qty) || 0))[0] || null;
