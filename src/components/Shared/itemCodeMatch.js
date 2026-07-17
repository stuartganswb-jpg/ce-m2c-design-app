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
const CATEGORY_NAME_RX = {
    RING: /\bRINGS?\b/i,
    BACKPLATE: /BACK\s*-?\s*PLATE|BACKPLATE|COVER\s*-?\s*PLATE|COVERPLATE/i,
    BRACKET: /BRACKET|\bARMS?\b/i,
    FINIAL: /FINIAL|RETURN|END\s*CAP|ENDCAP/i,
    POLE: /\bPOLE\b|\bRODS?\b|TUBE/i,
};

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
        const rx = CATEGORY_NAME_RX[String(category || '').toUpperCase().trim()];
        if (rx) {
            const preferred = hits.filter(h => rx.test(h.name || ''));
            if (preferred.length) hits = preferred;
        }
    }
    return hits[0];
}
