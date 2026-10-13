// ── AN ORDER KEEPS THE RECIPE IT STARTED WITH (Grace, App Imp 2026-10-06 · Stuart 2026-10-13) ───────────────────────
// Grace: "the system returned the order to the Hand Finishing step, which had already been completed the day before.
// I think this happened because I added a step in the S03 recipe at the end of the day."  She was right. A finishing
// document remembers its place as a NUMBER (currentStepIndex / poleStepIndex) and the floor read the recipe LIVE — so a
// step added in front of the one an order was on moved that order back a coat (Row 3 of SO60585: S03-S gained "Wood
// Conditioner" as coat 1, and every order part-way through read one coat earlier).
//
// The rule: the moment a recipe is about to change under an order that has BEGUN it, the order is given a copy of the
// steps it is running, and from then on it reads its copy (Shared/recipeFreeze names which orders; Finishing → FINISH
// RECIPES is the one writer). An order that has not started a coat keeps reading FINISH RECIPES, so the change reaches
// it. The copy sits on the document under the pointer it belongs to:
//   recipeCopy.parts → the coats `currentStepIndex` counts      recipeCopy.poles → the coats `poleStepIndex` counts
// This file is the shape only — no imports, so the floor's readers (Shared/floorActivity) can use it.

const stepsOf = (r) => ((r && Array.isArray(r.steps)) ? r.steps : []);
const T = (v) => String(v == null ? '' : v).trim();

export const RECIPE_ROLES = ['parts', 'poles'];
export const ROLE_LABEL = { parts: 'small parts', poles: 'poles' };

/** The copy a document carries for one pointer ('parts' | 'poles'); null when it has none. */
export const recipeCopyOf = (wo, role) => {
    const c = wo && wo.recipeCopy && wo.recipeCopy[role];
    return (c && stepsOf(c).length) ? c : null;
};

/** Do two recipes ask for the same coats in the same order — the paint and how it goes on? */
export const sameSteps = (a, b) => {
    const x = stepsOf(a), y = stepsOf(b);
    if (x.length !== y.length) return false;
    return x.every((s, i) => T(s && s.color) === T(y[i] && y[i].color) && T(s && s.app).toUpperCase() === T(y[i] && y[i].app).toUpperCase());
};

/** What is written on the document: the recipe as it stood, when it was kept, by whom and why. null for a recipe with no steps. */
export const copyOfRecipe = (recipe, { at = Date.now(), by = '', why = '' } = {}) => {
    const steps = stepsOf(recipe);
    if (!steps.length) return null;
    return {
        code: T(recipe.code), name: T(recipe.name),
        steps: steps.map(s => ({ ...s })), instructions: String(recipe.instructions || ''),
        at, by: T(by), why: T(why),
    };
};
