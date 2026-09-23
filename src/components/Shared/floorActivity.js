// WHAT IS ACTUALLY HAPPENING RIGHT NOW (Stuart 2026-08-03: "once the jobs are started there should
// be a visual in the center of the screen of what is actively happening (and by whom)").
//
// The floor had the data and no picture of it. Running work was legible only as a one-line "OPEN
// NOW" list buried under the scan box, and the Machine View that used to fill the middle is hidden
// while the machines are offline — so a started job left the centre of the screen empty.
//
// This is the model behind that panel. Kept pure and separate because the SAME arithmetic already
// exists inline in Live Operator Status, and two copies of "is this step overdue" drifting apart is
// exactly how a floor stops trusting its own screens.
//
// Also the home of the facts both floor screens read about a finishing document (poles or small
// parts, which stream recipe, is a coat hand-applied) and of the three windows (2026-09-23).
//
// THE OVEN IS NOT LATE, IT IS BAKING. A bake has a fixed dwell; running past the estimate on a
// spray step means someone is held up, but an oven sitting at 100% is just an oven. It reports
// `state: 'baking'` rather than 'overdue' so the panel never cries wolf at a working oven.

import { isPoleCategory } from './poleCut.js';
import { resolveStreamRecipe } from './finishingTime.js';

export const OVEN_KEYS = ['spinBake', 'poleBake'];
export const TASK_LABEL = {
    spinSetup: 'Sled Setup', spinSpray: 'Spray Coat', spinBake: 'Sled Bake',
    poleSpray: 'Pole Spray', poleBake: 'Pole Bake', hand: 'Hand Finish',
};
export const isOvenTask = (key) => OVEN_KEYS.includes(key);

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

// The estimate for a step, from the floor's configured rates. Mirrors what Live Operator Status
// computes; both now call this so they can never disagree about who is late.
export function estMinsForTask(taskKey, wo, cfg) {
    const c = cfg || {};
    const parts = num(wo && wo.totalParts);
    if (taskKey === 'spinSetup') return num(c.spinSetupMins);
    if (taskKey === 'spinSpray') return num(c.spinPaintMins);
    // The floor config calls the bake dwell `ovenMins`; `bakeMins` is accepted so a future rename
    // of that setting cannot silently zero every oven estimate.
    if (taskKey === 'spinBake' || taskKey === 'poleBake') return num(c.ovenMins) || num(c.bakeMins);
    if (String(taskKey).includes('pole')) return parts * num(c.poleMins);
    if (taskKey === 'hand') return parts * num(wo && wo.type === 'Poles' ? c.handPoleMins : c.handSmallMins);
    return 0;
}

// Every step running anywhere on the floor, newest last. One entry per running task — an operator
// with a bake going AND a spray going appears twice, because that is two things happening.
export function runningStepsOf(workOrders) {
    const out = [];
    (workOrders || []).forEach(wo => {
        Object.entries((wo && wo.tasks) || {}).forEach(([key, task]) => {
            if (!task || task.status !== 'Running') return;
            out.push({ wo, key, task, operator: task.assignedTo || '', startTime: task.startTime || null });
        });
    });
    return out.sort((a, b) => (a.startTime || 0) - (b.startTime || 0));
}

/**
 * One running step, described.
 *
 * state: 'baking'   an oven at or past its dwell — working, not late
 *        'overdue'  past estimate on a hands-on step — someone is held up
 *        'running'  inside estimate
 *        'untimed'  no estimate configured, so no claim is made about it
 */
export function activityOf(step, { cfg, now } = {}) {
    const t = Number(now) || 0;
    const est = estMinsForTask(step.key, step.wo, cfg);
    const elapsed = step.startTime ? Math.max(0, Math.floor((t - step.startTime) / 60000)) : null;
    const oven = isOvenTask(step.key);
    const over = est > 0 && elapsed !== null ? Math.max(0, elapsed - est) : 0;
    // Capped at 100 so a long overrun can't run the bar off its track; the number tells the truth.
    const pct = est > 0 && elapsed !== null ? Math.min(100, Math.round((elapsed / est) * 100)) : null;
    const state = est <= 0 || elapsed === null ? 'untimed'
        : over > 0 ? (oven ? 'baking' : 'overdue')
            : 'running';
    return {
        label: TASK_LABEL[step.key] || step.key,
        operator: step.operator,
        isOven: oven,
        elapsedMins: elapsed,
        estMins: est,
        overdueMins: over,
        remainingMins: est > 0 && elapsed !== null ? Math.max(0, est - elapsed) : null,
        pct, state,
    };
}

// Colour by state, matching the rest of the floor: brass = working, red = held up, blue = oven.
export const activityTone = (state) =>
    state === 'overdue' ? '#d9534f' : state === 'baking' ? '#3f7fc4' : state === 'untimed' ? '#9b968c' : '#b08d57';

// ── WHAT A FINISHING DOCUMENT CARRIES (moved here from ActiveFloor, 2026-09-23, unchanged) ────────
// The Setup Queue now needs the same answers to ask Spin or Booth, and a second copy of "is this a
// pole order" is how the floor ended up with four of them.
//
// The pole COUNT is what splits the two streams, and orders raised before the category test was
// shared never carried one — so a rod order showed no pole row at all. The category is the
// fallback: a pole/rod order with no count is all poles, which is what it always was.
export const woHasPoles = (wo) => Number(wo.totalPoles || (wo.poles && wo.poles.qty)) > 0 || wo.type === 'Poles'
    || isPoleCategory(wo && wo.productType);
// A POLE-ONLY ORDER HAS NO SMALL PARTS (Grace 2026-08-18: "with orders that are only Poles, an
// option to spray small parts shows up … in this instance there are no small parts and it's only
// an order of 20 poles"). The small-parts stream was unconditional, so the floor was offered
// Setup/Spray/Bake for a sled that was never going to be loaded — and, worse, the order could
// never COMPLETE, because completion waits for a parts stream that has nothing to run.
//
// Deliberately conservative: it only says "no small parts" when poles are present AND nothing
// counts small parts (no S/M/L sled sizes) AND the total is fully accounted for by the poles.
// Anything ambiguous keeps both streams, because hiding real work is the worse mistake.
export const woHasSmallParts = (wo) => {
    if (!wo || !woHasPoles(wo)) return true;                       // no poles → it is all small parts
    const sizes = wo.paintSizes || null;
    if (sizes && Object.values(sizes).some(v => Number(v) > 0)) return true;
    // On a pole/rod order that never got a count stamped, the pieces ARE the poles — otherwise
    // this falls straight back to "it is all small parts", which is the bug Grace reported.
    const poleQty = Number(wo.totalPoles || (wo.poles && wo.poles.qty) || 0)
        || (isPoleCategory(wo.productType) ? Number(wo.totalParts || 0) : 0);
    const total = Number(wo.totalParts || 0);
    if (!poleQty) return true;
    return total > poleQty;
};
// FINISH-STREAM EXCEPTION (the elbow): a WO stamped finishStream 'POLES' (from the item
// master's flag) runs its PARTS stream on the -P recipe — physically still a small part on a
// sled, finished to match the poles. 'SMALL' forces the reverse on a pole item.
// AUTO (BY PRODUCT TYPE) NOW MEANS SOMETHING (Grace 2026-08-25). The Library's Finish Stream
// dropdown has always offered a blank option labelled "Auto (by product type)" — and blank simply
// fell through to SMALL here, whatever the item was. So her CP rods, correctly tagged ROD and
// needing no flag at all, ran CP-S. An untagged pole/rod now resolves to POLES, which is what
// the label says and what the floor expects; an explicit flag still wins over the category.
export const streamFlagOf = (wo) => {
    const flag = String(wo?.finishStream || '').toUpperCase();
    if (flag === 'POLES' || flag === 'SMALL') return flag;
    return isPoleCategory(wo?.productType) ? 'POLES' : '';
};
export const partsStreamOf = (wo) => streamFlagOf(wo) === 'POLES' ? 'POLES' : 'SMALL';
export const poleStreamOf = (wo) => streamFlagOf(wo) === 'SMALL' ? 'SMALL' : 'POLES';
// Recipes author this through a dropdown ("Sprayed" / "Hand Applied" / "None"), but older and
// imported recipes spell it their own way — match on the word, so a hand step is never silently
// treated as a spray step, which is what leaves an operator with no control to press.
export const isHandStep = (step) => !!step && /hand/i.test(String(step.app || ''));

// ── THE FLOOR'S THREE WINDOWS (Stuart 2026-09-23) ────────────────────────────────────────────────
// "On the Floor really needs 3 job windows — Large Booth, Spin Machine and Hand Finish, the jobs and
// steps should be shown in the appropriate window." The single panel listed only RUNNING steps, so a
// coat nobody had started yet — P24's hand coat on WO-OE-H1-75SPF — was on no screen at all.
//
// Where a coat is worked:
//   · a HAND-APPLIED coat → Hand Finish, always — the recipe decides, poles or small parts
//   · a sprayed POLE coat → the Large Booth, always — no decision
//   · a sprayed SMALL-PARTS coat → the station chosen at Start Setup (`sprayStation`), Spin when
//     none was chosen, which is what every document written before today is
// The task keys underneath do not change — a booth coat still runs spinSetup/spinSpray/spinBake —
// because NetSuite's build trigger, Force Complete, Where Is It and the estimates read those keys.
export const FLOOR_WINDOWS = ['BOOTH', 'SPIN', 'HAND'];
export const WINDOW_LABEL = { BOOTH: 'Large Booth', SPIN: 'Spin Machine', HAND: 'Hand Finish' };
export const SPRAY_STATIONS = { SPIN: 'SPIN', BOOTH: 'BOOTH' };
export const sprayStationOf = (wo) =>
    String((wo && wo.sprayStation) || '').trim().toUpperCase() === SPRAY_STATIONS.BOOTH ? SPRAY_STATIONS.BOOTH : SPRAY_STATIONS.SPIN;

// The window a coat of one stream ('parts' | 'poles') is worked in; null past the end of the recipe.
export function windowOfCoat(stream, step, wo) {
    if (!step) return null;
    if (isHandStep(step)) return 'HAND';
    return stream === 'poles' ? 'BOOTH' : sprayStationOf(wo);
}
// The window a single task belongs to — for a step running outside the coat it belongs to.
export function windowOfTask(key, wo) {
    if (key === 'hand' || key === 'poleHand') return 'HAND';
    if (key === 'poleSpray' || key === 'poleBake') return 'BOOTH';
    return sprayStationOf(wo);
}
// The tasks one coat is made of — the same split the Manual Floor Control buttons use.
export function coatTaskKeys(stream, step) {
    if (!step) return [];
    if (stream === 'poles') return isHandStep(step) ? ['poleHand'] : ['poleSpray', 'poleBake'];
    return isHandStep(step) ? ['hand'] : ['spinSetup', 'spinSpray', 'spinBake'];
}
// THE COATS COMING — the first coat AHEAD of the current one in each OTHER window, so the hand bench
// sees a job before it arrives. A later coat in the window the job is already in adds nothing.
// → [{ window, coat (1-based), of, step }]
export function comingCoatsOf(steps, idx, stream, wo) {
    const list = Array.isArray(steps) ? steps : [];
    const i0 = Number(idx) || 0;
    const here = windowOfCoat(stream, list[i0], wo);
    const seen = new Set(here ? [here] : []);
    const out = [];
    for (let i = i0 + 1; i < list.length; i++) {
        const w = windowOfCoat(stream, list[i], wo);
        if (!w || seen.has(w)) continue;
        seen.add(w);
        out.push({ window: w, coat: i + 1, of: list.length, step: list[i] });
    }
    return out;
}
// START SETUP ASKS SPIN OR BOOTH only when there is something to spray on the small-parts stream.
// Poles always go to the booth; a small-parts stream that is hand-applied on every coat never
// touches either. An unresolvable recipe still asks — the floor refuses to advance it anyway, and
// a choice is harmless where a missing one is not.
export function asksSprayStation(wo, recipes) {
    if (!wo || !woHasSmallParts(wo)) return false;
    const r = resolveStreamRecipe(recipes, wo.recipe, partsStreamOf(wo));
    const steps = r && Array.isArray(r.steps) ? r.steps : [];
    if (!steps.length) return true;
    return steps.some(s => !isHandStep(s));
}
