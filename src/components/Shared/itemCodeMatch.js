// Node-name → Master-Library item matcher. The designer's convention is to name each choice node
// "<ITEM#> <POSITION/VERSION>" (e.g. "H1-75RBP-H RIGHT", "H1-75RCP-V v2:6"), and merges/exports may
// strip the punctuation ("H175RBPHRIGHT"). So we match by NORMALIZED LONGEST PREFIX: strip everything
// but A-Z0-9 from both the node name and every library ERP id / item id, and the longest library code
// that prefixes the node name wins. Shared hardware (screws, standoffs, washers) matches nothing and
// correctly stays blank. Used by the Assembly Builder to prefill item #s on upload and in the
// "Assign item numbers to choices" tool — so nobody types item numbers line by line.
export const normCode = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// parts: [{ legacyErpId, itemId, itemName }] → index sorted longest-first so the first prefix hit is
// the longest (H1-75RBP-H beats H1-75RBP). Codes under 4 chars are dropped — too short to be safe.
// `name` rides along for pickers/labels.
export function buildCodeIndex(parts) {
    const seen = new Set();
    const out = [];
    (parts || []).forEach(p => {
        [p.legacyErpId, p.itemId].forEach(code => {
            if (!code || code === 'PENDING') return;
            const n = normCode(code);
            if (n.length < 4 || seen.has(n)) return;
            seen.add(n);
            // itemId/erp ride along so pins can be written fully LINKED to the library part
            // (Visual Assembly's isExistingLibraryPart shape) at build/assign time.
            out.push({ code: String(code), norm: n, name: p.itemName || '', itemId: p.itemId || '', erp: p.legacyErpId || '' });
        });
    });
    return out.sort((a, b) => b.norm.length - a.norm.length);
}

export function matchItemByName(nodeName, index) {
    const n = normCode(nodeName);
    if (!n) return null;
    for (const e of index) { if (n.startsWith(e.norm)) return e; }
    return null;
}
