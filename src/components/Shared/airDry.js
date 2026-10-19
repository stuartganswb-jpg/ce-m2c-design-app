// ── A SPRAYED COAT ON WOOD AIR-DRIES; IT IS NEVER BAKED (Grace, App Imp 2026-10-19 · Stuart, same day) ─────────────────
//
// Grace: "the Wood orders, such as CW, W, SM0, and S0 should not have a bake step. Wood orders do not need to be baked nor
// can be." Stuart: "yes, 20min air dry". The recipes never asked for a bake — a recipe is coats, Hand Applied or Sprayed —
// the FLOOR gave every sprayed coat a spray and then a bake (spinBake / poleBake). On a wood finish that slot is now an
// AIR DRY: twenty minutes on the rack, out of the oven. The task keys stay exactly as they are, so no document, writer or
// gate changes shape; only what the slot MEANS — its words, its minutes, and whether it is in the oven — depends on the
// coat's finish.
//
// WOOD IS WHAT THE FINISH IS TAGGED (Shared/phosphateRule.isWoodFinishRecipe — the finish library's material, the S-code
// stain as the fallback when a caller has no list). Never inferred from a code here: M2C's SM01…SM10 are wood only because
// the library says so, which is why every floor screen passes the list it already holds.
// Pure. Harness: scripts/airDry.test.mjs.

import { isWoodFinishRecipe, recipeCodeOf } from './phosphateRule.js';
import { woRecipeCode, streamMasterOf } from './finishingTime.js';

export const WOOD_AIR_DRY_MINS = 20;
/** The slot after a sprayed coat: the bake — or, on wood, the air dry. */
export const DRY_SLOT_KEYS = Object.freeze(['spinBake', 'poleBake']);

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/** Does this finishing document's sprayed coat air-dry? Its finish (the -S / -P stream variants share it) is WOOD. */
export const woAirDries = (wo, finishes = null) => {
    if (!wo) return false;
    const code = streamMasterOf(recipeCodeOf(woRecipeCode(wo)));
    return !!code && isWoodFinishRecipe(code, finishes);
};

/** Is this task an air dry — the dry slot, on a wood coat? */
export const isAirDryStep = (taskKey, wo, finishes = null) => DRY_SLOT_KEYS.includes(String(taskKey || '')) && woAirDries(wo, finishes);

/** Is this task in the OVEN? The dry slot, unless the coat air-dries. */
export const isOvenStep = (taskKey, wo, finishes = null) => DRY_SLOT_KEYS.includes(String(taskKey || '')) && !woAirDries(wo, finishes);

/** The air dry's minutes: Stuart's 20, unless the floor config ever carries its own. */
export const airDryMinsOf = (cfg) => num(cfg && cfg.woodAirDryMins) || WOOD_AIR_DRY_MINS;

/** The minutes the dry slot takes for this document: the air dry's on wood, else the oven's (`bakeMins` accepted, as before). */
export const dryMinsOf = (taskKey, wo, cfg = {}, finishes = null) => {
    if (!DRY_SLOT_KEYS.includes(String(taskKey || ''))) return 0;
    if (woAirDries(wo, finishes)) return airDryMinsOf(cfg);
    return num(cfg && cfg.ovenMins) || num(cfg && cfg.bakeMins);
};

/** The words for an air dry, English and Spanish, by slot. */
export const AIR_DRY_LABEL = Object.freeze({ spinBake: 'Air Dry', poleBake: 'Pole Air Dry' });
export const AIR_DRY_LABEL_ES = Object.freeze({ spinBake: 'Secado al aire', poleBake: 'Secado al aire de barras' });

/** A step's name: the air dry's on a wood coat, else the caller's own label for it. */
export const dryAwareLabel = (taskKey, wo, finishes, label) => (isAirDryStep(taskKey, wo, finishes) ? AIR_DRY_LABEL[taskKey] : label);
export const dryAwareLabelEs = (taskKey, wo, finishes, label) => (isAirDryStep(taskKey, wo, finishes) ? AIR_DRY_LABEL_ES[taskKey] : label);
