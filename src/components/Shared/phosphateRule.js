// ── DOES THIS ORDER'S CUSTOM WORK GET PHOSPHATED? — ONE RULE (Eric, App Imp 2026-10-02) ──────────────
// Fundamental rule (Stuart 2026-07-15): ANY in-house finish — a real recipe that is not outsourced and not
// mill / raw / unfinished — sends the custom parts to the phosphate station beside custom fab. A WOOD STAIN
// (S01…S99, the pole rule's small-parts stains, Stuart 2026-09-01) is in-house too, but on WOOD: nothing to
// phosphate (Stuart 2026-09-27, SO60551 Row 2's stained oak fascia).
//
// The rule lived twice: the dispatch write (Shared/floorRelease.buildShopDoc) knew the stain exemption and
// stamped the document; the Shop card re-derived it live without the exemption and without reading the
// stamp, so a stained wood rod stamped "no phosphate" still read "Parts Require Phosphate" on the card
// (Eric 2026-10-02: wood rods). One definition, here; the card honours the document's own stamp first.
//
// WOOD IS WHAT THE FINISH IS TAGGED, NOT ONLY WHAT ITS CODE LOOKS LIKE (Stuart 2026-10-05: "if any finish is
// tagged wood that should remove the phosphate rather than just relying on the s code"). M2C's stains are
// SM01…SM10 — no "S + digit" — so an oak rod in SM01 would have been sent to the phosphate station. The finish
// library's MATERIAL is the fact: a recipe whose finish is tagged WOOD is never phosphated. The S-code stays as
// the fallback for a caller that has no finish list to ask, so nothing that was exempt becomes un-exempt.
// Pure. Harness: scripts/phosphateRule.test.mjs.

import { isOutsourcedFinishCode, finishRouteOf } from './finishRouting.js';

const MILL_RE = /\b(MILL|RAW|UNFINISHED)\b/i;
const STAIN_RE = /^S\d+\b/i;

/** Is this finish applied by an outside plater (EP*, MEP*, P25 …)? */
export const isOutsourcedRecipe = (recipe) => {
    const r = String(recipe || '').trim();
    if (!r) return false;
    return isOutsourcedFinishCode(r) || !!finishRouteOf({ recipe: r }).outsourced;
};

const U = (v) => String(v == null ? '' : v).trim().toUpperCase();
/** The finish code a recipe string leads with: "S03", "S03 - Pure Oak", "SM01 Natural Oak" → the code. */
export const recipeCodeOf = (recipe) => U(recipe).split(/\s+-\s+|\s+/)[0] || '';

/**
 * Is this recipe a WOOD finish? Tagged WOOD in the finish library (any record with that code, or named exactly
 * as the recipe reads) — or, with no list to ask or no tag found, an S-code stain.
 * @param finishes  system/master_finishes' list, when the caller has it
 */
export const isWoodFinishRecipe = (recipe, finishes = null) => {
    const r = String(recipe || '').trim();
    if (!r) return false;
    if (STAIN_RE.test(r)) return true;
    if (!Array.isArray(finishes) || !finishes.length) return false;
    const whole = U(r), code = recipeCodeOf(r);
    return finishes.some(f => f && /WOOD/.test(U(f.material)) && (U(f.code) === code || U(f.name) === whole || (!U(f.code) && U(f.name) === code)));
};

/**
 * Does a custom part finished in this recipe get phosphated?
 * @param finishes  the finish library's list (optional) — a finish tagged WOOD is never phosphated
 */
export const needsPhosphatingOf = (recipe, finishes = null) => {
    const r = String(recipe || '').trim();
    return !!r && r !== 'PENDING-RECIPE' && !isOutsourcedRecipe(r) && !MILL_RE.test(r) && !isWoodFinishRecipe(r, finishes);
};

/** What a shop document shows: its own stamp when it carries one, else the rule on its recipe. */
export const shopDocNeedsPhos = (order) => {
    if (!order) return false;
    if (typeof order.needsPhosphating === 'boolean') return order.needsPhosphating;
    return !order.isOutsourced && needsPhosphatingOf(order.finishRecipe);
};
