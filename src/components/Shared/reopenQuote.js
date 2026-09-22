// "Reopen in CPQ": load a finalized quote's configuration back into the CPQ configurator so
// details can change without rebuilding from scratch. Used by the CRM (ExternalCoopTab) and the
// ERP hub (ERPPushPullTab). Dispatches REOPEN_QUOTE_IN_CPQ, handled in HQ.js (which owns the
// global cart and the active tab); CPQTab restores the locked job context (customer/shipping)
// from the hq_reopen_quote payload on mount. From there the existing cart Edit + re-finalize
// machinery applies — finalize merges into the SAME job id, so BOM/CPQ links stay intact.
// "Reopen in Vision": jump back to the Vision Hardware board with this quote's session active —
// that's where dimensions, bracket/splice placements, and shop notes live. The board's LOAD
// control (Engineering view) pulls a saved line back for editing; re-saving updates the SAME
// draft, so a follow-up Reopen-in-CPQ / re-finalize picks up the corrected numbers.
// Handled by HQ.js (tab switch) + ClientVisionTab (session restore from hq_vision_reopen).
// The checkout add-ons a saved quote carries, as AddOnPicker selections { [partDocId]: qty | true }.
// Saved lines first (cpqData.breakdown, isAddOn — a percentage fee saves as qty 1, which the picker
// reads as ON); a quote with none falls back to the portal request's picks. Pure — exported for the harness.
export const savedAddOnSelOf = (job) => {
    const saved = ((job && job.cpqData && job.cpqData.breakdown) || []).filter(l => l && l.isAddOn && l.partId);
    if (saved.length) return Object.fromEntries(saved.map(l => [l.partId, parseFloat(l.qty) > 0 ? parseFloat(l.qty) : 1]));
    return Object.fromEntries(((job && job.portalRequest && job.portalRequest.addOns) || [])
        .filter(a => a && a.id)
        .map(a => [a.id, a.mode === 'PERCENT' ? true : (parseFloat(a.qty) || 1)]));
};

// ── WHICH DOOR MADE THIS QUOTE — AND THE WRONG-DOOR GUARD (Stuart 2026-09-20) ────────────────────────
// "if an order or quote was created using sales entry or vision/cpq and an operator mistakenly reopens
//  it in the other manner, can it warn them…?" Two of the three wrong doors already declined, by
// accident and with the wrong words ("saved before Order Entry began keeping its cart… rebuild it in
// tab 7" — said to somebody holding a thirty-line CPQ quote). The third did not decline at all: Reopen
// Vision locked the working session to an ORDER ENTRY quote and opened an empty board, so anything
// saved from it would have written CPQ lines into that quote's record beside its Order Entry cart.
// The quote says where it was made; each door reads that first. Pure — the CRM greys the button with
// the same sentence, so the mistake cannot be clicked, and the function still refuses if it is called.
export const quoteDoorOf = (job) => {
    if (!job) return '';
    if (job.source === 'QUICKSHIP' || job.orderClass === 'QUICKSHIP' || (Array.isArray(job.quickShipCart) && job.quickShipCart.length)) return 'ORDER_ENTRY';
    if (job.cpqData && ((Array.isArray(job.cpqData.cartItems) && job.cpqData.cartItems.length) || (Array.isArray(job.cpqData.breakdown) && job.cpqData.breakdown.length))) return 'CPQ';
    return '';   // too old, or empty, to say — each door keeps its own "nothing to reopen" words
};
const DOOR_NAME = { CPQ: 'Reopen CPQ', VISION: 'Reopen Vision', ORDER_ENTRY: 'Reopen Order Entry' };
// THE CRM'S APPROVE IS CPQ'S DOOR (Stuart 2026-09-23, SO60586): it transforms the estimate and
// builds the sales order from the JOB — a job id on it, no Order Entry class, no lines. RTG then
// read "approved, has a job" and split the order WHOLE from a Quick Ship quote's printed breakdown
// (prose: no part id, no cut length, no bin — an 18" pole went to finishing as a small part).
// An Order Entry quote becomes an order through Order Entry: reopen it there, save it as a sales
// order, and the record carries the class and the lines the WMS and the per-line route read.
export const approveDoorReason = (job) => {
    if (quoteDoorOf(job) !== 'ORDER_ENTRY') return '';
    const no = (job && (job.quoteNo || job.netsuiteEstimateNo || job.jobId || job.id)) || 'This quote';
    return `${no} was built in Order Entry (tab 7). Approving it here would build a CPQ-shaped order that RTG splits whole from the printed quote. Use "${DOOR_NAME.ORDER_ENTRY}", then save it there as a sales order. (The old estimate is closed in NetSuite by hand — tab 7 says so.)`;
};
/**
 * An ORDER ENTRY sales order — by its own class (tab 7 writes orderClass QUICKSHIP), its source,
 * or the quote it was approved from (a QSQUOTE-… job, or the job itself when the caller has it).
 * RTG's whole-order split must never take one: its lines start one at a time through the Order
 * Entry route, and the WMS packs its stocked lines off the order itself.
 */
export const isOrderEntryOrder = (so, job = null) => {
    if (!so) return false;
    const U = (v) => String(v == null ? '' : v).trim().toUpperCase();
    if (U(so.orderClass) === 'QUICKSHIP' || U(so.source) === 'QUICKSHIP') return true;
    if (/^QSQUOTE-/i.test(String(so.hqJobId || '').trim())) return true;
    return quoteDoorOf(job) === 'ORDER_ENTRY';
};
/** '' when `door` may open this quote, else the sentence that says why not and which door does. */
export const wrongDoorReason = (job, door) => {
    const made = quoteDoorOf(job);
    const no = (job && (job.quoteNo || job.netsuiteEstimateNo || job.jobId || job.id)) || 'This quote';
    if (made === 'ORDER_ENTRY' && (door === 'CPQ' || door === 'VISION'))
        return `${no} was built in Order Entry (tab 7) — it has no configuration for ${door === 'CPQ' ? 'the CPQ Configurator' : 'the Vision board'} to open. Use "${DOOR_NAME.ORDER_ENTRY}".`;
    if (made === 'CPQ' && door === 'ORDER_ENTRY')
        return `${no} was configured in CPQ / Vision — Order Entry cannot open a configured quote, and it does NOT need rebuilding in tab 7. Use "${DOOR_NAME.CPQ}" (or "${DOOR_NAME.VISION}").`;
    return '';
};

export const reopenQuoteInVision = (job) => {
    const wrong = wrongDoorReason(job, 'VISION');
    if (wrong) { alert(`⛔ Wrong door.\n\n${wrong}`); return false; }
    const jobId = job.jobId || job.id;
    window.dispatchEvent(new CustomEvent('REOPEN_QUOTE_IN_VISION', {
        detail: { session: { jobId, customerId: job.customer?.id || '', jobName: job.jobName || '' } }
    }));
    return true;
};

// "Reopen in Order Entry": a Quick Ship / Order Entry quote is not a CPQ configuration — it has
// no flow and no cartItems, so Reopen CPQ can never open one. What it does have (since 2026-08-31)
// is the CART it was built from, stored on the job. This hands that back to tab 7; saving there
// creates the corrected quote and marks this one superseded.
export const reopenQuoteInOrderEntry = (job) => {
    const wrong = wrongDoorReason(job, 'ORDER_ENTRY');
    if (wrong) { alert(`⛔ Wrong door.\n\n${wrong}`); return false; }
    const jobId = job.jobId || job.id;
    if (!Array.isArray(job.quickShipCart) || !job.quickShipCart.length) {
        alert(`Quote ${jobId} was saved before Order Entry began keeping its cart (2026-08-31), so there is nothing to reopen — its printed lines are prose, not a cart. Rebuild it in tab 7; every quote saved from now on reopens.`);
        return false;
    }
    if (job.netsuiteEstimateId) {
        if (!window.confirm(`⚠ This quote already reached NetSuite estimate ${job.netsuiteEstimateNo || job.netsuiteEstimateId}.\n\nReopening and re-saving creates a NEW estimate — the old one must be closed in NetSuite by hand.\n\nReopen anyway?`)) return false;
    }
    window.dispatchEvent(new CustomEvent('REOPEN_QUOTE_IN_ORDERENTRY', { detail: { jobId } }));
    return true;
};

export const reopenQuoteInCpq = (job) => {
    const wrongDoor = wrongDoorReason(job, 'CPQ');
    if (wrongDoor) { alert(`⛔ Wrong door.\n\n${wrongDoor}`); return false; }
    const jobId = job.jobId || job.id;
    const items = Array.isArray(job.cpqData?.cartItems) ? job.cpqData.cartItems : [];
    if (!items.length) {
        alert("This quote carries no CPQ cart snapshot (it was finalized before per-item carts existed), so it can't be reopened. Rebuild it as a new quote.");
        return false;
    }
    if (job.netsuiteEstimateId || job.dispatchStatus?.nsSalesOrder) {
        const what = job.netsuiteEstimateId ? `NetSuite estimate ${job.netsuiteEstimateId}` : 'a NetSuite sales order';
        if (!window.confirm(`⚠ This quote already reached ${what}.\n\nYou can reopen and modify it, but re-pushing creates a NEW estimate — the old one must be closed in NetSuite manually.\n\nReopen anyway?`)) return false;
    }
    try {
        const cur = JSON.parse(localStorage.getItem('hq_global_cart') || '[]');
        if (cur.length && cur[0]?.masterQuoteId !== jobId) {
            if (!window.confirm(`A CPQ cart with ${cur.length} item(s) is already in progress — reopening this quote REPLACES that cart.\n\nContinue?`)) return false;
        }
    } catch (e) { /* unreadable stored cart — proceed */ }
    window.dispatchEvent(new CustomEvent('REOPEN_QUOTE_IN_CPQ', {
        detail: {
            // masterQuoteId re-stamped on every item: it drives finalize's target job id, so the
            // re-finalize updates THIS job in place.
            cartItems: items.map(it => ({ ...it, masterQuoteId: jobId })),
            session: {
                jobId,
                customerId: job.customer?.id || '',
                jobName: job.jobName || '',
                // orderSidemark = the raw typed header sidemark (job.sidemark carries fallbacks —
                // jobName / 'Multi-Room Project' — that must not reappear as typed text on reopen).
                sidemark: job.orderSidemark || '',
                poNumber: job.poNumber || '',
                internalMemo: job.internalMemo || '',
                // The one header's two sales-side fields (Brief E): a quote saved before they
                // existed reopens blank — never with an invented date.
                needBy: job.needBy || '',
                productionNotes: job.productionNotes || '',
                // Portal checkout add-ons → CPQ's AddOnPicker selections (keyed by part doc id,
                // the same key addOnSel uses), so staff land at checkout with the customer's
                // picks already ticked instead of re-reading them from the request panel.
                // ⚠ THE QUOTE'S OWN ADD-ONS COME BACK TOO (Stuart 2026-09-17: 50 display bases ticked at
                // checkout vanished on every reopen). A staff-ticked add-on lives only on
                // cpqData.breakdown (isAddOn, keyed by the part's doc id) — reopen restored the portal's
                // picks and nothing else, so checkout opened at zero and the next save wrote the quote
                // WITHOUT them. Once a quote has saved add-ons they are the truth; the portal's list
                // only seeds a request nobody has finalized yet.
                addOnSel: savedAddOnSelOf(job),
                shippingMethod: job.shippingMethod || 'SAVED',
                shippingAddressId: job.shippingAddressId || '',
                shippingAmount: (parseFloat(job.shippingAmount) || 0) > 0 ? String(job.shippingAmount) : '',
                // A set % typed at checkout comes back typed (Stuart 2026-09-11); cart line discounts
                // ride cartItems[].lineDiscount above; the customer's code re-resolves live as always.
                orderDiscountPercent: (job.orderDiscount && job.orderDiscount.mode === 'ORDER_PERCENT' && Number(job.orderDiscount.percent) > 0) ? String(job.orderDiscount.percent) : '',
                customShippingAddress: job.customShippingAddress || null
            }
        }
    }));
    return true;
};
