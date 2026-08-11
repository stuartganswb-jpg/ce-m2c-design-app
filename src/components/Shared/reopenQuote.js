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
export const reopenQuoteInVision = (job) => {
    const jobId = job.jobId || job.id;
    window.dispatchEvent(new CustomEvent('REOPEN_QUOTE_IN_VISION', {
        detail: { session: { jobId, customerId: job.customer?.id || '', jobName: job.jobName || '' } }
    }));
    return true;
};

export const reopenQuoteInCpq = (job) => {
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
                // Portal checkout add-ons → CPQ's AddOnPicker selections (keyed by part doc id,
                // the same key addOnSel uses), so staff land at checkout with the customer's
                // picks already ticked instead of re-reading them from the request panel.
                addOnSel: Object.fromEntries(
                    ((job.portalRequest && job.portalRequest.addOns) || [])
                        .filter(a => a && a.id)
                        .map(a => [a.id, a.mode === 'PERCENT' ? true : (parseFloat(a.qty) || 1)])
                ),
                shippingMethod: job.shippingMethod || 'SAVED',
                shippingAddressId: job.shippingAddressId || '',
                shippingAmount: (parseFloat(job.shippingAmount) || 0) > 0 ? String(job.shippingAmount) : '',
                customShippingAddress: job.customShippingAddress || null
            }
        }
    }));
    return true;
};
