// ONE NAME PER COLLECTION (Eric 2026-09-29, App Imp: a Fabricut H1 1" checkout "missing the H1-PCKF1 standard
// $12 package fee" · Stuart 2026-09-30: "go with A").
//
// A collection is matched by its NAME everywhere it is read — CPQ checkout scopes its fees by the collections of
// the flow's parts, the portal and Quick Ship entitle a customer's catalog by it, 4.6 and 4.5 group and filter by
// it. Fabricut H1 had two: NetSuite's item sync writes FABRICUT H1 (1,608 records, and the master list's own
// "Fabricut H1", which holds the customer entitlement), while 328 records — 162 brackets, 46 kits, 26 screws and
// 16 fees, H1-PCKF1 among them — carried H1 FABRICUT. It came in with NetSuite's own "H1 Fabricut" value on some
// screws, and from there every dropdown built from the records offered it to whoever tagged next. An H1-1 flow
// whose parts say FABRICUT H1 therefore never saw the Fabricut fees tagged the other way.
//
// Every writer passes a name through canonicalCollection, so the other spelling can never be written again, and
// 4.6's merge (collectionMergesOf) moves the records that already carry it. Pure.

// Another spelling (uppercased) → the one name. Add a row only for a name that is the SAME collection.
export const COLLECTION_ALIASES = Object.freeze({
    'H1 FABRICUT': 'FABRICUT H1',
});

/** The one name for a collection: trimmed, single-spaced, uppercased, and an alias mapped to its name. */
export function canonicalCollection(name) {
    const u = String(name == null ? '' : name).trim().replace(/\s+/g, ' ').toUpperCase();
    return COLLECTION_ALIASES[u] || u;
}

/** A record's list in the one-name form: every entry canonical, blanks dropped, duplicates merged, order kept. */
export function canonicalCollections(list) {
    const out = [];
    (Array.isArray(list) ? list : []).forEach(c => { const n = canonicalCollection(c); if (n && !out.includes(n)) out.push(n); });
    return out;
}

const keyOf = (c) => String(c == null ? '' : c).trim().replace(/\s+/g, ' ').toUpperCase();
/** Is this entry another spelling of a collection (an alias row), rather than the name itself? */
export const isAliasCollection = (c) => Object.prototype.hasOwnProperty.call(COLLECTION_ALIASES, keyOf(c));
/** Does this list carry another spelling? */
export const hasAliasCollection = (list) => (Array.isArray(list) ? list : []).some(isAliasCollection);

/**
 * The merge for records that carry another spelling. → [{ id, code, before, after }]
 * Only the alias entries change — each becomes its one name, and a record already carrying that name keeps one
 * entry. Every other entry stays exactly as it was written (case included): this merges spellings, it does not
 * restyle anybody's tags.
 */
export function collectionMergesOf(records) {
    const out = [];
    (records || []).forEach(p => {
        const before = p && p.manufacturingSpecs && Array.isArray(p.manufacturingSpecs.collections) ? p.manufacturingSpecs.collections : null;
        if (!before || !hasAliasCollection(before)) return;
        const after = [];
        before.forEach(c => {
            const v = isAliasCollection(c) ? canonicalCollection(c) : c;
            if (!after.some(a => keyOf(a) === keyOf(v))) after.push(v);
        });
        out.push({ id: p.id, code: String(p.legacyErpId || p.itemId || p.id || ''), before: [...before], after });
    });
    return out;
}

/** What the merge would do, in words: "328 records: H1 FABRICUT → FABRICUT H1". */
export function collectionMergeSummary(merges) {
    const pairs = new Map();
    (merges || []).forEach(m => m.before.filter(isAliasCollection).forEach(c => {
        const k = `${keyOf(c)} → ${canonicalCollection(c)}`;
        pairs.set(k, (pairs.get(k) || 0) + 1);
    }));
    return [...pairs.entries()].map(([k, n]) => `${n} × ${k}`);
}
