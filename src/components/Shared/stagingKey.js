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

// A pair's start-now / purchase tag, as its short id writes it (Shared/rowPairShape.pairIdsOf).
export const PAIR_TAG_LETTER = { '-NOW': 'N', '-PO': 'P' };

// ── A LONG PAIR ID SCANS AS ITS SHORT FORM (Stuart 2026-09-29, SO60551 at packing) ─────────────────
// "the orders still have long string barcodes to complete the handshake." Pairs written before the
// short ids (4c742b82) carry WO-OE-<SO>-<row>-<finish>-<13-digit clock><tag> — 43 characters, wider
// than a 4" label can print scannably. Their labels now barcode the SAME short form a new pair's id
// is: WO-OE-<SO>-<last 4 clock digits><N|P>. Every label reads stagingKeyOf and every scan resolves
// through here, so a reprint scans — and a label already on the parts (the long id) still does.
const LONG_PAIR_RE = /^WO-OE-(SO\d+)-.+-(\d{13})(-NOW|-PO)?$/;
export const shortPairKeyOf = (id) => {
    const m = norm(id).match(LONG_PAIR_RE);
    return m ? `WO-OE-${m[1]}-${m[2].slice(-4)}${PAIR_TAG_LETTER[m[3]] || ''}` : '';
};

/** What a document's staging label barcodes: a finishing document's own id; a shop document's finishing half. */
export const stagingKeyOf = (d) => {
    if (!d) return '';
    const key = d.finSiblingId ? String(d.finSiblingId)            // the shop half → the pair's spine
        : String(d.id || d.woNum || d.orderKey || '');
    return shortPairKeyOf(key) || key;
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
    // The short form of a long pair id — one open document, or refused as ambiguous (a newer pair's id can
    // equal an older one's short form: then neither is guessed).
    const short = open.filter(w => shortPairKeyOf(w.id) === s && w !== exact);
    if (exact && short.length) return { job: null, ambiguous: [exact, ...short], legacy: false };
    if (exact) return { job: exact, ambiguous: [], legacy: false };
    if (short.length === 1) return { job: short[0], ambiguous: [], legacy: false };
    if (short.length > 1) return { job: null, ambiguous: short, legacy: false };
    const cands = open.filter(w => legacyStagingKeysOf(w).includes(s));
    if (cands.length === 1) return { job: cands[0], ambiguous: [], legacy: true };
    return { job: null, ambiguous: cands, legacy: cands.length > 0 };
};

/** Does a scanned label identify THIS finishing document? Exact on the work order; tolerant on an older sales-order key. */
export const stagingScanMatches = (finWO, scan) => {
    const s = norm(scan);
    if (!s || !finWO) return false;
    if (norm(finWO.id) === s || norm(finWO.woNum) === s) return true;
    if (shortPairKeyOf(finWO.id) === s) return true;
    // A label that names A WORK ORDER must name this one (2026-09-29): every row of SO60551 carries
    // "SO60551" inside its id, so the tolerant test below let another row's poles pass this row's box.
    // The tolerance is for the older labels that barcode the sales order alone.
    if (/^(WO|SHOP)-/.test(s)) return false;
    const c = legacyStagingKeysOf(finWO);
    return c.some(k => k === s || k.includes(s) || s.includes(k));
};

/** The older name, kept for its callers: the one document a scan names, or null (an ambiguous older key is null too). */
export const resolveByExactKey = (finWOs = [], scan) => resolveStagingScan(finWOs, scan).job;
