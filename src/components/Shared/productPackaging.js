// ── HOW A PRODUCT IS PACKAGED — the picture and the note the ITEM carries (Stuart 2026-10-08) ─────────────────────────
// "packaging prep is really where the finished products are wrapped and placed in their individual product packaging
//  not the final order shipping boxes … just pack into each products set packaging (we will add images of proper
//  packaging for each product)."
//
// WHERE IT LIVES: on the item, in the Master Library's drawer ("Product packaging") —
//     manufacturingSpecs.customData.packagingImages   [url, …]   the picture(s) of the product in its packaging
//     manufacturingSpecs.customData.packagingNote     'text'     the bag, the box, the insert, how many to a pack
// App-only: nothing here is sent to NetSuite, and the 11.1 item sync leaves customData alone.
//
// ONE PRODUCT, EVERY FINISH. A finish variant (H1-138RG/P25, …/EP1) is the same piece in another colour and is
// packaged the same way, so a variant with nothing of its own shows what its base item carries — the rule the item's
// own picture already follows (Shared/partPicture): the item, else the mill item it is a finish of, else the product
// it is a species of. The pictures and the note are resolved APART: a variant may carry its own note ("bag of 7")
// over its base's picture.
//
// READ-side only, and pure — the Library drawer writes the two fields through its own save. Harness:
// scripts/productPackaging.test.mjs.
import { millBaseOf } from './finishRouting.js';

const U = (v) => String(v == null ? '' : v).trim().toUpperCase();
const S = (v) => String(v == null ? '' : v).trim();

export const PACKAGING_IMAGES_KEY = 'packagingImages';
export const PACKAGING_NOTE_KEY = 'packagingNote';
/** More pictures than this on one item is a gallery, not a packaging instruction. */
export const PACKAGING_IMAGES_MAX = 6;

const customDataOf = (part) => (part && part.manufacturingSpecs && part.manufacturingSpecs.customData) || {};

/** The picture list as stored, tidied: an array of non-empty urls (one url stored bare reads as a list of one). */
export const packagingImagesIn = (customData) => {
    const v = customData && customData[PACKAGING_IMAGES_KEY];
    return (Array.isArray(v) ? v : (v ? [v] : [])).map(S).filter(Boolean);
};
/** What the item ITSELF carries — nothing borrowed. */
export const ownPackagingOf = (part) => {
    const c = customDataOf(part);
    return { images: packagingImagesIn(c), note: S(c[PACKAGING_NOTE_KEY]) };
};

/**
 * How to package this item: its own picture(s) and note, else its base item's.
 * @param part        the library record
 * @param findByCode  (CODE) => library record | null — uppercase item-code lookup
 * @param speciesBase optional: Shared/partPicture.buildSpeciesBaseIndex(inventory)
 * @returns {{ images: string[], note: string, imagesFrom: string, noteFrom: string, any: boolean }}
 *          `…From` is '' for the item's own, else the code it was borrowed from.
 */
export const packagingOf = (part, findByCode, speciesBase = null) => {
    const none = { images: [], note: '', imagesFrom: '', noteFrom: '', any: false };
    if (!part) return none;
    const find = typeof findByCode === 'function' ? findByCode : () => null;
    const code = U(part.legacyErpId && part.legacyErpId !== 'PENDING' ? part.legacyErpId : part.itemId);
    const base = U(millBaseOf(code));
    const spOf = (c) => (speciesBase && c && speciesBase.get(c)) || '';
    const species = U(spOf(code) || spOf(base));
    // The item first, then the mill item it is a finish of, then the product it is a species of.
    const chain = [{ from: '', part }];
    if (base && base !== code) chain.push({ from: base, part: find(base) });
    if (species && species !== code && species !== base) chain.push({ from: species, part: find(species) });
    const read = chain.filter(x => x.part).map(x => ({ from: x.from, ...ownPackagingOf(x.part) }));
    const img = read.find(x => x.images.length) || null;
    const note = read.find(x => x.note) || null;
    return {
        images: img ? img.images : [], imagesFrom: img ? img.from : '',
        note: note ? note.note : '', noteFrom: note ? note.from : '',
        any: !!(img || note),
    };
};

// ── THE DRAWER'S LIST EDITS (pure — the drawer keeps the list in its edit state and saves it with the record) ───────
/** The list with this picture added: no blanks, no doubles, and never more than the cap. */
export const withPackagingImage = (list, url) => {
    const cur = (Array.isArray(list) ? list : []).map(S).filter(Boolean);
    const u = S(url);
    if (!u || cur.includes(u) || cur.length >= PACKAGING_IMAGES_MAX) return cur;
    return [...cur, u];
};
export const withoutPackagingImage = (list, url) => (Array.isArray(list) ? list : []).map(S).filter(x => x && x !== S(url));
/** Why another picture cannot be added, or ''. */
export const packagingImageRefusal = (list) => ((Array.isArray(list) ? list : []).filter(Boolean).length >= PACKAGING_IMAGES_MAX
    ? `An item carries at most ${PACKAGING_IMAGES_MAX} packaging pictures — remove one first.` : '');
