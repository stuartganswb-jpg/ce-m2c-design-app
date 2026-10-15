// ── A PHOTO TAKEN AT THE COUNTER, PURE (S7, 2026-10-15) ───────────────────────────────────────────
//
// Stuart: "on the counter for items that do not yet have a photograph can you add a camera icon to open the
// tablet camera and catch images and add the first to the item in the hq master library and any others taken
// attached to the item in the asset gallery". The screen uploads through the one gallery writer
// (Shared/guideCapture, kind PRODUCT); this module decides WHICH library items the first shot lands on and
// what is written. A colourway's tile reads its picture from the fabric, the throw or a pillow
// (pillowCatalog.tilePictureOf), so the first shot is stamped on the throw and the fabric — both — and on
// the first pillow when the colourway has neither. Every shot's gallery asset is attached to all of them.

const str = (v) => String(v == null ? '' : v).trim();

/** The library items a colourway's photo is written on, and the codes a gallery asset is attached to. */
export const photoTargetsOf = (cw) => {
    if (!cw) return { items: [], codes: [] };
    const throws = cw.throws || {};
    const stamp = [throws.STD, throws.XL, throws.XXL, cw.fabric].filter(Boolean);
    const pillows = Object.values(cw.pillows || {}).filter(Boolean);
    const items = stamp.length ? stamp : pillows.slice(0, 1);
    const codes = [...stamp, ...pillows, ...Object.values(cw.samples || {})].filter(Boolean).map(it => str(it.legacyErpId || it.itemId)).filter(Boolean);
    return { items, codes: [...new Set(codes)] };
};

/** The library patch for the picture: the hi-res as the item's image, the thumb beside it, the gallery as its source. */
export const itemPicturePatchOf = ({ originalUrl = '', thumbnailUrl = '', by = '', at = 0 } = {}) => ({
    finalImageUrl: str(originalUrl),
    componentImageUrl: str(thumbnailUrl) || str(originalUrl),
    imageSource: 'GALLERY',
    pictureTakenAt: at || Date.now(),
    pictureTakenBy: str(by),
    updatedAt: at || Date.now(),
});
