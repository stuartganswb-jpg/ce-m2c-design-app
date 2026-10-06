// ─────────────────────────────────────────────────────────────────────────────────────────────
// THE SAME PART, MADE IN ANOTHER MATERIAL — the 1" brass (Stuart 2026-10-06)
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// "the brass items have their own part# and need to be pushed to the workorders/sales orders with their
//  own part#'s, but ideally in the cpq we just tag it as in the .glb the brass items are identical to
//  their steel counter parts. so there is no need to load all the same parts in the glb file, instead i
//  loaded brass finishes in the master library as LBR … can we set up the cpq in the H1-1 flow that when
//  LBR is selected it swaps out the standard parts for the brass parts"
//
// A brass bracket is drawn exactly like the steel one, but it is a DIFFERENT PRODUCT: its own number
// (H1-1BS → H1-1BBS), its own pattern number, its own price ("special prices for the brass, they are
// actually more money than the plated"), its own NetSuite item and its own stock. So the flow keeps ONE
// pin — the standard part — and the standard part's library record names its twin:
//
//      manufacturingSpecs.customData.materialTwins = [{ material: 'BRASS', code: 'H1-1BBS' }]
//
// A FINISH BELONGS TO A MATERIAL (4.5 — LBR · BRASS). A finish of a material the part names a twin in
//   · is WORN by that part (and by no other: "it is just the parts listed"), and
//   · makes the line that twin — "the line can be the plain brass item, the LBR is the finish".
// Nothing here is a second identity rule: the species swap (Shared/sizeMatrix.speciesVariantOf) and the
// finish variant (Shared/finishVariant) run after it, on the twin, exactly as they run on any part.
//
// An ARRAY, not a map: the Library drawer saves with a merge write, and a merge cannot remove one key
// of a nested map (see firestore-empty-map-merge-wipes) — an array is replaced whole.
//
// Pure. Harness: scripts/materialTwin.test.mjs.

const U = (v) => String(v == null ? '' : v).trim().toUpperCase();
const codeOf = (p) => U(p && ((p.legacyErpId && p.legacyErpId !== 'PENDING' ? p.legacyErpId : p.itemId) || ''));

/** The material a finish belongs to — '' when it names none (an unset material never finds a twin). */
export const finishMaterialOf = (finish) => U(finish && finish.material);

/** A part's twins, cleaned: [{ material, code }] — one per material, blanks dropped. */
export function materialTwinsOf(part) {
    const raw = part && part.manufacturingSpecs && part.manufacturingSpecs.customData && part.manufacturingSpecs.customData.materialTwins;
    const seen = new Set(), out = [];
    (Array.isArray(raw) ? raw : []).forEach(r => {
        const material = U(r && r.material), code = U(r && r.code);
        if (!material || !code || seen.has(material)) return;
        seen.add(material); out.push({ material, code });
    });
    return out;
}

/** The code of the item this part is made as in `material`, or ''. */
export const twinCodeOf = (part, material) => {
    const m = U(material);
    if (!m) return '';
    const hit = materialTwinsOf(part).find(t => t.material === m);
    return hit ? hit.code : '';
};

/**
 * The item a part becomes under a finish of another material — or null.
 *
 * @param part        the library doc of the part as pinned (the standard one)
 * @param finish      the finish RECORD (its material decides)
 * @param findByCode  UPPERCASE item code → library doc
 * @returns the twin's library doc; null when the finish has no material, the part names no twin in it,
 *          the twin is not in the library, or the part is already a finished variant ("…/EP2")
 */
export function materialTwinOf(part, finish, findByCode) {
    if (!part || !finish || typeof findByCode !== 'function') return null;
    const own = codeOf(part);
    if (!own || own.includes('/')) return null;
    const code = twinCodeOf(part, finishMaterialOf(finish));
    if (!code || code === own) return null;
    const hit = findByCode(code);
    return hit && hit !== part ? hit : null;
}

/** Does this part wear `finish` because it is made in the finish's material as a twin? */
export const wearsAsTwin = (part, finish, findByCode) => !!materialTwinOf(part, finish, findByCode);

/**
 * The twins list with one material set (or, with a blank code, removed) — for the Library drawer.
 * Returns a NEW array; the other materials are kept as they are.
 */
export function withTwin(list, material, code) {
    const m = U(material), c = U(code);
    const rest = (Array.isArray(list) ? list : []).filter(r => r && U(r.material) && U(r.material) !== m)
        .map(r => ({ material: U(r.material), code: U(r.code) }));
    return m && c ? [...rest, { material: m, code: c }] : rest;
}

/**
 * Why a twin cannot be saved as typed, or '' when it can.
 * @param part  the record being edited      @param findByCode  UPPERCASE item code → library doc
 */
export function twinRefusal(part, material, code, findByCode) {
    const m = U(material), c = U(code);
    if (!m && !c) return '';
    if (!m) return 'Pick the material this part is also made in.';
    if (!c) return `Type the item number this part is made as in ${m}.`;
    if (c.includes('/')) return `${c} is a finished item — name the plain ${m.toLowerCase()} item; the finish picks its own variant.`;
    if (c === codeOf(part)) return 'A part cannot be its own twin.';
    if (typeof findByCode === 'function' && !findByCode(c)) return `${c} is not in the Master Library.`;
    return '';
}
