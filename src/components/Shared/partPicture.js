// THE PICTURE OF A PART TO SHOW OR PRINT — its own, else the picture of the item it is a finish of.
// (READ-side only. Which picture may be WRITTEN onto a part, and its provenance, is Shared/partImage.)
//
// Stuart 2026-09-20: the 4×3 box label carries the part's thumbnail, and a finish variant
// (H1-138CA/EP1 … /P25) has never had one of its own — the picture is made once, on the mill item,
// from the model. A variant is the same piece of metal in another colour, so until it has its own
// render the base item's picture is the right picture of it. Pure; the caller hands the lookup.
import { millBaseOf } from './finishRouting.js';

const U = (v) => String(v == null ? '' : v).trim().toUpperCase();

export const ownImageOf = (p) => (p && (p.finalImageUrl || p.componentImageUrl
    || (p.manufacturingSpecs && (p.manufacturingSpecs.finalImageUrl || p.manufacturingSpecs.referenceImageUrl)))) || '';

/**
 * @param part        the library record
 * @param findByCode  (CODE) => library record | null   — uppercase ERP code lookup
 * @param speciesBase (4th) optional: buildSpeciesBaseIndex(inventory) — oak / walnut items show their product
 * @param kits        optional: the library's kit records (manufacturingSpecs.kitComponents) — a part with
 *                    no picture of its own or its base's shows the kit it is a piece of
 * @returns { url, from }  `from` is '' for the part's own picture, else the code it was borrowed from
 */
// ── A WOOD SPECIES ITEM IS THE SAME PIECE IN OAK OR WALNUT (Stuart 2026-09-20: "the wood items H1-138
// … with -o or -w, the images should be there as well"). To the customer H1-138WEC is ONE product; the
// BOM item is per-species — H1-138WEC-O / -W by suffix, or a stem-different code named in the base's
// customData.speciesMap (H1-138WR → H1-138WHTOAK / H1-138WLNUT; Shared/sizeMatrix.speciesVariantOf is
// the forward rule). This is that rule read BACKWARDS: species code → the base that carries the picture.
export const buildSpeciesBaseIndex = (inventory = []) => {
    const codes = new Set();
    inventory.forEach(p => { const c = U(p.legacyErpId); if (c && c !== 'PENDING') codes.add(c); });
    const idx = new Map();
    inventory.forEach(p => {
        const base = U(p.legacyErpId);
        if (!base || base === 'PENDING') return;
        const map = p.manufacturingSpecs && p.manufacturingSpecs.customData && p.manufacturingSpecs.customData.speciesMap;
        if (map && typeof map === 'object') Object.values(map).forEach(v => { const c = U(v); if (c && c !== base && !idx.has(c)) idx.set(c, base); });
    });
    codes.forEach(c => {
        if (idx.has(c) || c.includes('/')) return;
        const m = c.match(/^(.+)-(O|W)$/);
        if (m && codes.has(m[1])) idx.set(c, m[1]);
    });
    return idx;
};

export const kitHolding = (part, kits = []) => {
    if (!part) return null;
    const keys = [part.id, part.itemId, part.legacyErpId].map(U).filter(Boolean);
    return (kits || []).find(k => ((k.manufacturingSpecs && k.manufacturingSpecs.kitComponents) || []).some(c => keys.includes(U(c.partId)))) || null;
};
export const partImageOf = (part, findByCode, kits = [], speciesBase = null) => {
    const own = ownImageOf(part);
    if (own || !part) return { url: own, from: '' };
    const find = typeof findByCode === 'function' ? findByCode : () => null;
    const code = U(part.legacyErpId && part.legacyErpId !== 'PENDING' ? part.legacyErpId : part.itemId);
    const base = U(millBaseOf(code));
    const basePart = (base && base !== code) ? find(base) : null;
    const fromBase = ownImageOf(basePart);
    if (fromBase) return { url: fromBase, from: base };
    // …then the product this is a SPECIES of (its own code, or the mill item it is a finish of).
    const spOf = (c) => (speciesBase && c && speciesBase.get(c)) || '';
    const sp = spOf(code) || spOf(base);
    const fromSpecies = sp ? ownImageOf(find(sp)) : '';
    if (fromSpecies) return { url: fromSpecies, from: sp };
    // One piece of a kit (its own code, or the mill item it is a finish of): the kit's picture.
    const kit = kitHolding(part, kits) || kitHolding(basePart, kits);
    const fromKit = ownImageOf(kit);
    return fromKit ? { url: fromKit, from: U(kit.legacyErpId || kit.itemId) } : { url: '', from: '' };
};
