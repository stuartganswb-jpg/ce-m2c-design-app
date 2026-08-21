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
export function adjustmentPayload({ nsItemId, qty, bin, location, subsidiary, memo }) {
    const n = Math.trunc(Number(qty) || 0);
    const b = String(bin || '').trim().toUpperCase();
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
