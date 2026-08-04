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
// THE OVEN IS NOT LATE, IT IS BAKING. A bake has a fixed dwell; running past the estimate on a
// spray step means someone is held up, but an oven sitting at 100% is just an oven. It reports
// `state: 'baking'` rather than 'overdue' so the panel never cries wolf at a working oven.

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
