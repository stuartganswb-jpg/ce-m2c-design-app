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

/** Does a custom part finished in this recipe get phosphated? */
export const needsPhosphatingOf = (recipe) => {
    const r = String(recipe || '').trim();
    return !!r && r !== 'PENDING-RECIPE' && !isOutsourcedRecipe(r) && !MILL_RE.test(r) && !STAIN_RE.test(r);
};

/** What a shop document shows: its own stamp when it carries one, else the rule on its recipe. */
export const shopDocNeedsPhos = (order) => {
    if (!order) return false;
    if (typeof order.needsPhosphating === 'boolean') return order.needsPhosphating;
    return !order.isOutsourced && needsPhosphatingOf(order.finishRecipe);
};
