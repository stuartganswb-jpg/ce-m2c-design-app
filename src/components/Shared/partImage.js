// WHICH PICTURE DOES THIS PART SHOW, AND WHERE DID IT COME FROM?
//
// Stuart 2026-08-27: "i just added a feature to use the thumbnail from their cpq .glb files until
// images arrive, but actual images are to always over ride and rule so once you fix it, they should
// overwrite the thumbnails when needed."
//
// That rule was unstateable before this module, because a rendered stand-in and a real photograph
// were written to the SAME field with nothing to tell them apart. Once `finalImageUrl` held a GLB
// render, every tool that fills pictures read it as "this part has a photo" and skipped it forever
// — so the photograph could never land. The stand-in outranked the thing it was standing in for.
//
// PROVENANCE IS THE FIX. Every writer stamps WHERE the picture came from, and the precedence falls
// out of it:
//
//     GALLERY        a real photograph (14.5 Batch Processor → global_assets)   ← always wins
//     BASE_INHERIT   a variant borrowing its base part's picture                ← stand-in
//     GLB_RENDER     geometry photographed from the assembly's own .glb         ← stand-in
//     (unstamped)    written before provenance existed — treated as REAL, because
//                    most of them are, and demoting someone's uploaded photo to a
//                    stand-in would let a render overwrite it. The one safe default.
//
// A stand-in is always overwritable by a photograph. A photograph is never overwritten by a
// stand-in. Two photographs are the same photograph arriving twice, so the newer one may land.

export const IMG_GALLERY = 'GALLERY';
export const IMG_BASE_INHERIT = 'BASE_INHERIT';
export const IMG_GLB_RENDER = 'GLB_RENDER';

const AUTO = new Set([IMG_BASE_INHERIT, IMG_GLB_RENDER]);

/** Where a part's current picture came from. '' when it has none. */
export const imageSourceOf = (part) => {
    if (!part || !part.finalImageUrl) return '';
    return String(part.imageSource || '').toUpperCase();
};

/** A stand-in — a render or an inherited base picture — that a real photograph may overwrite. */
export const isAutoImage = (part) => AUTO.has(imageSourceOf(part));

/**
 * May a REAL photograph be written onto this part? True when it has no picture at all, or only a
 * stand-in. This is the test that replaces `!part.finalImageUrl` everywhere a gallery photo lands.
 */
export const photoMayOverwrite = (part) => !part || !part.finalImageUrl || isAutoImage(part);

/**
 * May a STAND-IN be written onto this part? Only when it has no picture at all. A render must never
 * displace a photograph, and re-running a sweep must not churn one stand-in for another.
 */
export const standInMayWrite = (part) => !part || !part.finalImageUrl;

/** The field pair to write. Always stamps provenance so the next tool can reason about it. */
export const imageUpdate = (url, source) => ({ finalImageUrl: url, imageSource: source });

// ── ONE MATCHER, TWO KEYS ──────────────────────────────────────────────────────────────────────
// The two tools that fill pictures joined assets to parts by DIFFERENT keys and therefore covered
// different parts:
//   • 14.5 writes `associatedParts: [<library doc id>]` — the BASE doc (fabricutAssetTags), which
//     the Library's own sync never looked at;
//   • the Library's sync parsed `<pattern>/<finish>` off legacyErpId and REQUIRED the slash — so a
//     base code like H1-75BF was excluded by construction and could never receive its own photo.
// Between them a "plate only" finial import landed nowhere: the asset pointed at the base, and the
// only stamper refused to look at base codes. Both keys are honoured here, in one place.

/** EP01 → EP1; P01 stays P01 (master_finishes zero-pads P##/S##, parts don't zero-pad EP). */
export const normFinish = (s) => String(s || '').toUpperCase().trim().replace(/^EP0+(\d+)$/, 'EP$1');

const U = (v) => String(v == null ? '' : v).trim().toUpperCase();

/** Split an item code into { pattern, finish }. finish is '' for a base code (no slash). */
export const splitCode = (erp) => {
    const s = U(erp);
    if (!s) return null;
    const i = s.indexOf('/');
    return i < 0 ? { pattern: s, finish: '' } : { pattern: s.slice(0, i), finish: normFinish(s.slice(i + 1)) };
};

/**
 * Index global_assets docs for lookup. Returns { byPartId, byCode } where byCode is keyed
 * `PATTERN|FINISH` (finish '' for a pattern-level image).
 * @param {object[]} assets raw global_assets documents
 */
export const buildGalleryIndex = (assets = []) => {
    const byPartId = new Map();
    const byCode = new Map();
    (assets || []).forEach(a => {
        if (!a) return;
        const url = a.thumbnailUrl || a.url || a.originalUrl || null;
        if (!url) return;
        (Array.isArray(a.associatedParts) ? a.associatedParts : []).forEach(pid => {
            if (pid && !byPartId.has(pid)) byPartId.set(pid, url);
        });
        if (a.patternId) {
            const k = `${U(a.patternId)}|${normFinish(a.finishId)}`;
            if (!byCode.has(k)) byCode.set(k, url);
        }
    });
    return { byPartId, byCode };
};

/**
 * The gallery photograph for a part, or null.
 * Resolution order — most specific first, so a part never borrows a picture that belongs to a
 * different finish:
 *   1. the asset names this exact library document   (associatedParts — how 14.5 tags)
 *   2. pattern + finish exactly                       (H1-75BF/EP1 → asset EP1)
 *   3. the pattern's own picture, for a BASE code only (H1-75BF → asset with no finish)
 * A finish VARIANT deliberately does not fall back to the pattern-level image here: that is the
 * BASE_INHERIT stand-in's job, and it must stay distinguishable from a photograph of that finish.
 */
export const galleryImageForPart = (part, index) => {
    if (!part || !index) return null;
    const direct = index.byPartId.get(part.id);
    if (direct) return direct;
    const k = splitCode(part.legacyErpId || part.itemId);
    if (!k) return null;
    const exact = index.byCode.get(`${k.pattern}|${k.finish}`);
    if (exact) return exact;
    if (!k.finish) return index.byCode.get(`${k.pattern}|`) || null;
    return null;
};
