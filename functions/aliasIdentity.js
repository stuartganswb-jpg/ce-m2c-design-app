// ALIAS IDENTITY — CommonJS PORT of src/components/Shared/aliasIdentity.js for the portal BFF
// (Quick Ship stock counter). ⚠ MIRROR RULE: the app copy is the master — edit THERE, re-port
// here in the same commit, and keep the logic line-for-line identical. The whole alias bug saga
// (Simple Elegance items skipping the counter) came from surfaces resolving aliases differently.
//
//   CUSTOMER-FACING FORMS ALWAYS SHOW THE ALIAS, never the item it refers back to.
//   INTERNAL / ERP / SHOP-FLOOR SURFACES SHOW THE REAL ITEM, with the alias in minor form.

const bareCode = (v) => String(v || '').trim().toUpperCase().split('/')[0];

// The ERP code a doc is known by, PENDING-aware (same convention as sizeMatrix/the stamper).
const codeOfPart = (p) => bareCode((p && p.legacyErpId && p.legacyErpId !== 'PENDING') ? p.legacyErpId : (p && p.itemId));

const aliasTargetIdOf = (d) => (d && (d.aliasOf || (d.manufacturingSpecs && d.manufacturingSpecs.aliasOf))) || null;
const isAliasDoc = (d) => !!aliasTargetIdOf(d);

// Index of alias relationships across a parts list. `groups` maps a bare code to the SET of codes
// that are the same physical part (merge-on-link, both directions).
function buildAliasIndex(parts) {
    const byKey = new Map();        // any identity → doc
    const docsByCode = new Map();   // bare code → docs carrying it
    (parts || []).forEach((p) => {
        [p.id, p.itemId, p.legacyErpId].forEach((k) => {
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
        merged.forEach((c) => groups.set(c, merged));
    };
    (parts || []).forEach((p) => {
        const target = aliasTargetIdOf(p);
        if (!target) return;
        const real = byKey.get(String(target).trim().toUpperCase());
        link(codeOfPart(p), real ? codeOfPart(real) : bareCode(target));
    });
    return { groups, docsByCode, byKey };
}

// Every code an item answers to — its own identities plus anything aliased to or from them.
function aliasCodesOf(index, it) {
    const out = new Set();
    [codeOfPart(it), bareCode(it && it.itemId), bareCode(it && it.id)].filter(Boolean).forEach((c) => {
        out.add(c);
        (index.groups.get(c) || []).forEach((x) => out.add(x));
    });
    return out;
}

const collectionsOf = (it) => {
    const ms = (it && it.manufacturingSpecs) || {};
    const raw = Array.isArray(ms.collections)
        ? ms.collections
        : ((ms.customData && ms.customData.collection) ? [ms.customData.collection] : []);
    return raw.map((c) => String(c || '').trim().toUpperCase()).filter(Boolean);
};

// Collections reachable through the alias link — the tag may live on either side of it.
function effectiveCollectionsOf(index, it) {
    const cols = new Set(collectionsOf(it));
    aliasCodesOf(index, it).forEach((c) => (index.docsByCode.get(c) || []).forEach((d) => collectionsOf(d).forEach((x) => cols.add(x))));
    return cols;
}

// THE CUSTOMER-FACING DOC for an item sold inside a collection: the alias doc carrying that
// collection, or null when there isn't one.
function customerFaceOf(index, it, collection) {
    if (!collection) return null;
    const scope = String(collection).trim().toUpperCase();
    const own = codeOfPart(it);
    for (const c of aliasCodesOf(index, it)) {
        if (c === own) continue;
        const d = (index.docsByCode.get(c) || []).find((x) => isAliasDoc(x) && collectionsOf(x).includes(scope));
        if (d) return d;
    }
    return null;
}

// The alias code wearing a variant's finish suffix: H2-1BE + H1-1BE/CC → H2-1BE/CC.
function faceCodeFor(aliasDoc, it) {
    const base = codeOfPart(aliasDoc);
    const fin = String((it && (it.legacyErpId || it.itemId)) || '').toUpperCase().split('/')[1] || '';
    return fin ? `${base}/${fin}` : base;
}

module.exports = { bareCode, codeOfPart, aliasTargetIdOf, isAliasDoc, buildAliasIndex, aliasCodesOf, collectionsOf, effectiveCollectionsOf, customerFaceOf, faceCodeFor };
