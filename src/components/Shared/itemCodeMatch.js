// Node-name → Master-Library item matcher. The designer's convention is to name each choice node
// "<ITEM#> <POSITION/VERSION>" (e.g. "H1-75RBP-H RIGHT", "H1-75RCP-V v2:6"), and merges/exports may
// strip the punctuation ("H175RBPHRIGHT"). So we match by NORMALIZED LONGEST PREFIX: strip everything
// but A-Z0-9 from both the node name and every library ERP id / item id, and the longest library code
// that prefixes the node name wins. Shared hardware (screws, standoffs, washers) matches nothing and
// correctly stays blank. Used by the Assembly Builder to prefill item #s on upload and in the
// "Assign item numbers to choices" tool — so nobody types item numbers line by line.
export const normCode = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// COLLISIONS ARE REAL (Stuart 2026-07-16): H1-75BPR (passing ring) and H1-75BP-R (backplate)
// BOTH normalize to "H175BPR". The old index dropped the second arrival entirely — the mill
// ring vanished from pickers and auto-match returned the backplate. So the index now KEEPS
// every distinct code, and matchItemByName breaks ties with the slot/cluster CATEGORY the
// caller is filling (a RING slot prefers the item whose NAME says ring).
export const CATEGORY_NAME_RX = {
    RING: /\bRINGS?\b|EYELET/i,
    BACKPLATE: /BACK\s*-?\s*PLATE|BACKPLATE|COVER\s*-?\s*PLATE|COVERPLATE|MOUNTING\s+BASE|\bPLATE\b/i,
    BRACKET: /BRACKET|\bARMS?\b|SUPPORT/i,
    FINIAL: /FINIAL|RETURN|END\s*CAP|ENDCAP|\bKNOB\b/i,
    POLE: /\bPOLE\b|\bRODS?\b|TUBE/i,
};

// Which category words appear in an item's NAME (sorted, '+'-joined; '' = none). Two colliding
// codes are machine-distinguishable when their signatures differ — the audit uses this to flag
// the pairs that need a human rename instead.
export const nameCategorySignature = (name) =>
    Object.keys(CATEGORY_NAME_RX).filter(k => CATEGORY_NAME_RX[k].test(String(name || ''))).sort().join('+');

// parts: [{ legacyErpId, itemId, itemName }] → index sorted longest-first so the first prefix hit is
// the longest (H1-75RBP-H beats H1-75RBP). Codes under 4 chars are dropped — too short to be safe.
// Only IDENTICAL raw codes dedupe; same-norm different-code entries all stay. `name` rides along
// for pickers/labels and the category tie-break.
export function buildCodeIndex(parts) {
    const seenRaw = new Set();
    const out = [];
    (parts || []).forEach(p => {
        [p.legacyErpId, p.itemId].forEach(code => {
            if (!code || code === 'PENDING') return;
            const n = normCode(code);
            const raw = String(code).toUpperCase();
            if (n.length < 4 || seenRaw.has(raw)) return;
            seenRaw.add(raw);
            // itemId/erp ride along so pins can be written fully LINKED to the library part
            // (Visual Assembly's isExistingLibraryPart shape) at build/assign time.
            out.push({ code: String(code), norm: n, name: p.itemName || '', itemId: p.itemId || '', erp: p.legacyErpId || '' });
        });
    });
    return out.sort((a, b) => b.norm.length - a.norm.length);
}

// category (optional): the slot/cluster category being filled — used ONLY to pick between
// entries tied at the same matched length (normalized-code collisions).
export function matchItemByName(nodeName, index, category) {
    const n = normCode(nodeName);
    if (!n) return null;
    // Collect every entry tied at the LONGEST matching prefix length (index is sorted
    // longest-norm-first, so the first hit fixes that length).
    let hits = [];
    for (const e of index) {
        if (hits.length && e.norm.length < hits[0].norm.length) break;
        if (n.startsWith(e.norm)) hits.push(e);
    }
    if (!hits.length) return null;
    if (hits.length > 1) {
        const cat = String(category || '').toUpperCase().trim();
        const rx = CATEGORY_NAME_RX[cat];
        if (rx) {
            const positive = hits.filter(h => rx.test(h.name || ''));
            if (positive.length) hits = positive;
            else {
                // No candidate is named for THIS category — drop the ones clearly named as a
                // DIFFERENT one (a RING slot choosing between a blandly-named item and
                // "…Backplate…" should take the bland one).
                const neutral = hits.filter(h => !Object.entries(CATEGORY_NAME_RX).some(([k, r]) => k !== cat && r.test(h.name || '')));
                if (neutral.length) hits = neutral;
            }
        }
    }
    return hits[0];
}
