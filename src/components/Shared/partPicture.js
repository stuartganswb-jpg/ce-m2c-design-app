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
 * @returns { url, from }  `from` is '' for the part's own picture, else the code it was borrowed from
 */
export const partImageOf = (part, findByCode) => {
    const own = ownImageOf(part);
    if (own || !part) return { url: own, from: '' };
    const code = U(part.legacyErpId && part.legacyErpId !== 'PENDING' ? part.legacyErpId : part.itemId);
    const base = U(millBaseOf(code));
    if (!base || base === code || typeof findByCode !== 'function') return { url: '', from: '' };
    const url = ownImageOf(findByCode(base));
    return { url, from: url ? base : '' };
};
