// ── A PICTURE ON AN ORDER LINE — THE RULE, PURE (Uniquity samples · S7, step 7, 2026-10-11) ───────────
//
// Stuart 2026-09-13 (answer 6): "the samples can be sold thru sales order entry. we can attach an image
// from asset gallery to them." A tab 7 line may carry ONE picture: the one the operator picks from the
// Asset Gallery, or — with nothing picked — the item's own PHOTOGRAPH (Shared/partImage: provenance
// GALLERY only; a .glb render or an inherited stand-in never stands for a sample on a customer's paper).
// The quote carries the pictures as `cpqData.lineImages[]`; the CRM's documents print them beside the
// CPQ render snapshots (the same strip). Pure — proven by scripts/lineImage.test.mjs.

import { imageSourceOf, IMG_GALLERY } from './partImage.js';

const str = (v) => String(v == null ? '' : v).trim();
const isHttp = (u) => /^https?:\/\//i.test(str(u));

/** The item's own photograph, or null — never a stand-in. */
export const itemPhotoOf = (item) => {
    if (!item) return null;
    const url = str(item.finalImageUrl);
    if (!url || !isHttp(url)) return null;
    return imageSourceOf(item) === IMG_GALLERY ? url : null;
};

/** A gallery asset → the line's picture. */
export const lineImageOfAsset = (asset) => {
    if (!asset) return null;
    const url = str(asset.thumbnailUrl || asset.url || asset.originalUrl);
    if (!isHttp(url)) return null;
    return { url, fullUrl: str(asset.originalUrl || url), assetId: str(asset.id), name: str(asset.name), patternId: str(asset.patternId), finishId: str(asset.finishId), source: 'GALLERY' };
};

/** The picture a NEW line starts with: the item's own photograph, else none. */
export const lineImageForItem = (item) => {
    const url = itemPhotoOf(item);
    return url ? { url, fullUrl: url, assetId: '', name: str(item.itemName), patternId: '', finishId: '', source: 'ITEM' } : null;
};

/** What the quote / sales order records: one row per line that carries a picture, in cart order. */
export const lineImagesOf = (lines = []) => (lines || [])
    .filter(l => l && l.lineImage && isHttp(l.lineImage.url))
    .map(l => ({ code: str(l.aliasErp || l.erp), name: str(l.name), memo: str(l.lineMemo), qty: Number(l.qty) || 1, url: str(l.lineImage.url), fullUrl: str(l.lineImage.fullUrl || l.lineImage.url), assetId: str(l.lineImage.assetId), source: str(l.lineImage.source) }));

/** The document strip's rows for those pictures (the shape the CRM's packet prints: src + caption). */
export const lineImageStripOf = (lineImages = []) => (lineImages || [])
    .filter(x => x && isHttp(x.url))
    .map(x => ({ src: x.fullUrl || x.url, caption: `${x.code}${x.memo ? ` · ${x.memo}` : ''}` }));
