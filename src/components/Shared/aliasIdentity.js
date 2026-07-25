// ALIAS IDENTITY — the app-wide rule (Stuart 2026-07-25).
//
//   CUSTOMER-FACING FORMS ALWAYS SHOW THE ALIAS, never the item it refers back to.
//   INTERNAL / ERP / SHOP-FLOOR SURFACES SHOW THE REAL ITEM, with the alias in minor form.
//
// An Alias doc (partClass 'Alias', aliasOf → the real item, created in Visual Assembly) renders as
// its own node but IS the real item in the BOM. H2-1BE and H2-1BS alias back to H1-1BE: one
// physical part, two codes, sold under different product lines at different prices.
//
// Where the rule already holds for free: CPQ and the portal resolve parts straight from the flow's
// styleOptions, and those options point at the ALIAS doc — so quotes, the configurator and
// portalEngine already name and price the alias without doing anything special. The places that
// need care are the ones that deliberately dereference to the real item for stock/ERP reasons
// (ERPPushPull's estimate lines, Quick Ship's sales orders and pick/pack): those must keep the
// alias for DISPLAY while the item id, barcode and inventory stay real.
//
// Applies to: Quick Ship (cart/SO/invoice + WMS), ERPPushPull (estimate line descriptions).
// Not needed in: CPQTab, portalEngine (see above).

export const bareCode = (v) => String(v || '').trim().toUpperCase().split('/')[0];

// The ERP code a doc is known by, PENDING-aware (same convention as sizeMatrix/the stamper).
export const codeOfPart = (p) => bareCode((p && p.legacyErpId && p.legacyErpId !== 'PENDING') ? p.legacyErpId : (p && p.itemId));

export const aliasTargetIdOf = (d) => (d && (d.aliasOf || (d.manufacturingSpecs && d.manufacturingSpecs.aliasOf))) || null;
export const isAliasDoc = (d) => !!aliasTargetIdOf(d);

// Follow an alias to the part it really is. Returns the input unchanged when it isn't an alias, so
// callers can apply it unconditionally. `find` resolves an id/code to a part.
export function realPartOf(part, find) {
    const target = aliasTargetIdOf(part);
    if (!target) return part;
    return (typeof find === 'function' && find(target)) || part;
}

// Index of alias relationships across a parts list. `groups` maps a bare code to the SET of codes
// that are the same physical part (merge-on-link, so a chain A→B→C collapses into one set and the
// link reads in both directions — a flow may name either side, stock may carry either side).
export function buildAliasIndex(parts) {
    const byKey = new Map();        // any identity → doc
    const docsByCode = new Map();   // bare code → docs carrying it
    (parts || []).forEach(p => {
        [p.id, p.itemId, p.legacyErpId].forEach(k => {
            const kk = String(k || '').trim().toUpperCase();
            if (kk && kk !== 'PENDING') byKey.set(kk, p);
        });
        const c = codeOfPart(p);
        if (c) docsByCode.set(c, [...(docsByCode.get(c) || []), p]);
    });

    const groups = new Map();
    const link = (a, b) => {
        if (!a || !b || a === b) return;
        const merged = new Set([...(groups.get(a) || [a]), ...(groups.get(b) || [b])]);
        merged.forEach(c => groups.set(c, merged));
    };
    (parts || []).forEach(p => {
        const target = aliasTargetIdOf(p);
        if (!target) return;
        const real = byKey.get(String(target).trim().toUpperCase());
        link(codeOfPart(p), real ? codeOfPart(real) : bareCode(target));
    });
    return { groups, docsByCode, byKey };
}

// Every code an item answers to — its own identities plus anything aliased to or from them.
export function aliasCodesOf(index, it) {
    const out = new Set();
    [codeOfPart(it), bareCode(it && it.itemId), bareCode(it && it.id)].filter(Boolean).forEach(c => {
        out.add(c);
        (index.groups.get(c) || []).forEach(x => out.add(x));
    });
    return out;
}

const collectionsOfDoc = (it) => {
    const ms = (it && it.manufacturingSpecs) || {};
    const raw = Array.isArray(ms.collections)
        ? ms.collections
        : ((ms.customData && ms.customData.collection) ? [ms.customData.collection] : []);
    return raw.map(c => String(c || '').trim().toUpperCase()).filter(Boolean);
};
export { collectionsOfDoc as collectionsOf };

// Collections reachable through the alias link — the tag may live on either side of it.
export function effectiveCollectionsOf(index, it) {
    const cols = new Set(collectionsOfDoc(it));
    aliasCodesOf(index, it).forEach(c => (index.docsByCode.get(c) || []).forEach(d => collectionsOfDoc(d).forEach(x => cols.add(x))));
    return cols;
}

// THE CUSTOMER-FACING DOC for an item being sold inside a collection: the alias doc carrying that
// collection, or null when there isn't one. Without a collection there is no unambiguous answer
// (an item can carry several aliases), so nothing is substituted.
export function customerFaceOf(index, it, collection) {
    if (!collection) return null;
    const scope = String(collection).trim().toUpperCase();
    const own = codeOfPart(it);
    for (const c of aliasCodesOf(index, it)) {
        if (c === own) continue;
        const d = (index.docsByCode.get(c) || []).find(x => isAliasDoc(x) && collectionsOfDoc(x).includes(scope));
        if (d) return d;
    }
    return null;
}

// The alias code wearing a variant's finish suffix: H2-1BE + H1-1BE/CC → H2-1BE/CC.
export function faceCodeFor(aliasDoc, it) {
    const base = codeOfPart(aliasDoc);
    const fin = String((it && (it.legacyErpId || it.itemId)) || '').toUpperCase().split('/')[1] || '';
    return fin ? `${base}/${fin}` : base;
}
