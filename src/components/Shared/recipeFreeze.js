// ── WHICH ORDERS A RECIPE CHANGE WOULD MOVE — AND THE COPY EACH IS GIVEN FIRST (Stuart 2026-10-13) ──────────────────
// The rule is in Shared/recipeCopy: an order that has BEGUN a recipe finishes on the steps it began with. This is the
// question FINISH RECIPES asks before it saves, deletes or un-ticks a recipe: of the documents on the floor, which
// streams have begun and would read DIFFERENT coats once the change is in? Each of those is given a copy of what it is
// running now — written BEFORE the recipe is, so a failure in between leaves an order holding a copy of steps that did
// not change, never an order moved. Pure: the caller passes the dictionary as it stands and as it will stand.
//   • not begun (no coat finished, no step of coat 1 started) → nothing written; it takes the new steps
//   • begun, already holding a copy → nothing written; it is named as staying on its steps
//   • a change that leaves the coats as they are (a name, the floor instructions) → nothing written, nobody named
import { liveRecipeOfWo, recipeCopyInForce, streamBegun, woHasPoles, woHasSmallParts, poleCoatIndexOf } from './floorActivity.js';
import { copyOfRecipe, sameSteps, ROLE_LABEL } from './recipeCopy.js';

const stepsOf = (r) => ((r && Array.isArray(r.steps)) ? r.steps : []);
/** A document still to be finished — not complete, not closed, not removed. */
export const stillOnTheFloor = (wo) => !!wo && !wo.deleted
    && !['Complete', 'Closed'].includes(String(wo.currentPhase || '')) && !/^(closed|cancelled|canceled)$/i.test(String(wo.status || ''));
const rolesOf = (wo) => [...(woHasSmallParts(wo) ? ['parts'] : []), ...(woHasPoles(wo) ? ['poles'] : [])];
const coatOf = (wo, role) => (role === 'poles' ? poleCoatIndexOf(wo) : (Number(wo.currentStepIndex) || 0)) + 1;

/**
 * @param workOrders     every finishing document (the finishing app's own list)
 * @param recipesBefore  FINISH RECIPES as it stands, keyed by code
 * @param recipesAfter   …as it will stand once the change is written
 * @returns { patches: [{ id, patch }], staying: [{ id, wo, role, code, coat, of }] }
 *          patches — the copy to write on each document that has none yet (updateDoc field paths)
 *          staying — every begun stream that will read different coats from FINISH RECIPES after the change
 */
export function recipeFreezesOf({ workOrders = [], recipesBefore = {}, recipesAfter = {}, at = Date.now(), by = '', why = '' } = {}) {
    const patches = [], staying = [];
    (workOrders || []).filter(stillOnTheFloor).forEach(wo => {
        const patch = {};
        rolesOf(wo).forEach(role => {
            if (!streamBegun(wo, role)) return;
            const after = liveRecipeOfWo(recipesAfter, wo, role);
            const held = recipeCopyInForce(wo, role);
            if (held) {
                if (!sameSteps(held, after)) staying.push({ id: wo.id, wo, role, code: held.code, coat: coatOf(wo, role), of: stepsOf(held).length });
                return;
            }
            const before = liveRecipeOfWo(recipesBefore, wo, role);
            if (!stepsOf(before).length || sameSteps(before, after)) return;   // nothing to keep, or nothing moves
            const copy = copyOfRecipe(before, { at, by, why });
            patch[`recipeCopy.${role}`] = copy;
            staying.push({ id: wo.id, wo, role, code: copy.code, coat: coatOf(wo, role), of: copy.steps.length });
        });
        if (Object.keys(patch).length) patches.push({ id: wo.id, patch });
    });
    return { patches, staying };
}

/** What FINISH RECIPES says before the change is written. '' when no order is part-way through. */
export const freezeText = ({ staying = [], refOf = (wo) => (wo && wo.id) || '', what = 'this change' } = {}) => {
    if (!staying.length) return '';
    const orders = new Set(staying.map(s => s.id)).size;
    const lines = staying.slice(0, 12).map(s => `  • ${refOf(s.wo)} — ${ROLE_LABEL[s.role] || s.role}, coat ${Math.min(s.coat, s.of)} of ${s.of}${s.code ? ` (${s.code})` : ''}`);
    if (staying.length > 12) lines.push(`  • …and ${staying.length - 12} more`);
    return `${orders} order${orders === 1 ? ' is' : 's are'} part-way through and will FINISH ON THE STEPS ${orders === 1 ? 'IT' : 'THEY'} STARTED WITH — ${what} does not move ${orders === 1 ? 'it' : 'them'}:\n\n${lines.join('\n')}\n\nOrders that have not started a coat take the new steps.`;
};
