// ── THE STAGING KEY IS THE WORK ORDER (Stuart 2026-09-23) ──────────────────────────────────
// "each row, i want the small parts that have been picked and then the custom parts that have
//  been completed, i want them scanned together to confirm proper match before staging is allowed."
//
// The two staging labels — the small-parts label printed at pick complete, the shop's completion
// label — used to barcode the SALES ORDER key (orderKey / salesOrderId / soNum). On a one-line order
// that is the same thing as the work order. On a multi-row order (SO60565's rows, the wall's) every
// row's document shares the key, so a scan named the order and not the row, and the handshake took
// the first document it found. Now both halves of a pair barcode the FINISHING work order's id —
// the pair's spine (the shop half carries it as finSiblingId) — and the handshake resolves each scan
// to a document and requires the two documents to be the same one.
//
// Labels printed before today still carry the sales-order key. They are accepted only when they
// identify exactly one open document; two or more, and the answer is to reprint from the card.
// Pure. scripts/stagingKey.test.mjs asserts it; Shared/workOrderContract re-exports it.

const norm = (v) => String(v == null ? '' : v).trim().toUpperCase();
export const normalizeStagingKey = norm;

/** What a document's staging label barcodes: a finishing document's own id; a shop document's finishing half. */
export const stagingKeyOf = (d) => {
    if (!d) return '';
    if (d.finSiblingId) return String(d.finSiblingId);             // the shop half → the pair's spine
    return String(d.id || d.woNum || d.orderKey || '');
};

/** The keys an OLDER label may carry — the sales order's — accepted only when unambiguous. */
export const legacyStagingKeysOf = (d) => (d ? [d.orderKey, d.salesOrderId, d.soNum].map(norm).filter(Boolean) : []);

const isOpen = (w) => !!w && w.currentPhase !== 'Closed' && w.stepStatus !== 'Closed' && w.status !== 'Closed' && !w.deleted;

/**
 * A scanned label → the finishing document it names.
 * @returns { job, ambiguous: [], legacy }  job null when nothing matches or several do (ambiguous lists them);
 *          legacy true when the match came through an older sales-order key.
 */
export const resolveStagingScan = (finWOs = [], scan) => {
    const s = norm(scan);
    if (!s) return { job: null, ambiguous: [], legacy: false };
    const open = (finWOs || []).filter(isOpen);
    const exact = open.find(w => norm(w.id) === s || norm(w.woNum) === s);
    if (exact) return { job: exact, ambiguous: [], legacy: false };
    const cands = open.filter(w => legacyStagingKeysOf(w).includes(s));
    if (cands.length === 1) return { job: cands[0], ambiguous: [], legacy: true };
    return { job: null, ambiguous: cands, legacy: cands.length > 0 };
};

/** Does a scanned label identify THIS finishing document? Exact on the work order; tolerant on an older sales-order key. */
export const stagingScanMatches = (finWO, scan) => {
    const s = norm(scan);
    if (!s || !finWO) return false;
    if (norm(finWO.id) === s || norm(finWO.woNum) === s) return true;
    const c = legacyStagingKeysOf(finWO);
    return c.some(k => k === s || k.includes(s) || s.includes(k));
};

/** The older name, kept for its callers: the one document a scan names, or null (an ambiguous older key is null too). */
export const resolveByExactKey = (finWOs = [], scan) => resolveStagingScan(finWOs, scan).job;
