// ── THE STEPS OF A COAT RUN IN ORDER, AND A BAKE RUNS ITS TIME (Stuart 2026-10-13) ──────────────────────────────
// "there is a direct finishing order and recipe and all should follow it." The floor offered a coat's Setup, Spray
// and Bake side by side and took any of them first: WO11688's load 2 had its bake completed before its setup or its
// spray, and since 1 October the median sled bake was punched in 1.4 minutes against a six-minute oven, the median
// pole bake in twelve seconds. The punch notice (Shared/punchCheck) said so and nothing changed.
//
// Two stops, and one way past them (Stuart: "bake time warn that it is too soon to pin it complete, manager can
// override any of the step stops"):
//   · a step does not START until the step before it in the coat is complete — small parts Setup → Spray → Bake,
//     poles Spray → Bake. A hand-applied coat is one step and has nothing before it;
//   · a bake is not COMPLETED before the oven time set in Production Times has run from its start.
// A manager's PIN turns either stop into a confirm; the stop and the override are both written to the floor log.
//
// Which steps a coat has, the hand-coat PIN (Shared/floorActivity), the open-pick gate (Shared/orderStatus) and the
// punch notice on every other short step are untouched. Pure — no React, no Firestore. Harness: scripts/stepOrder.test.mjs.
//
// ON WOOD THE BAKE IS AN AIR DRY (Grace / Stuart 2026-10-19 · Shared/airDry): the same slot, twenty minutes on the rack. The
// caller passes `airDry` and the air dry's minutes as `ovenMins`; the stop then says air dry, never oven.

import { AIR_DRY_LABEL, AIR_DRY_LABEL_ES } from './airDry.js';

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const MIN = 60000;

export const STEP_STOP = { OUT_OF_ORDER: 'OUT_OF_ORDER', BAKE_TOO_SOON: 'BAKE_TOO_SOON' };

/** What must be complete, on this coat, before a step may start — in the order it is done. */
export const STEPS_BEFORE = {
    spinSetup: [], spinSpray: ['spinSetup'], spinBake: ['spinSetup', 'spinSpray'],
    poleSpray: [], poleBake: ['poleSpray'],
    hand: [], poleHand: [],
};
export const BAKE_KEYS = ['spinBake', 'poleBake'];

const STEP_EN = { spinSetup: 'Setup', spinSpray: 'Spray', spinBake: 'Bake', poleSpray: 'Pole Spray', poleBake: 'Pole Bake', hand: 'Hand Finish', poleHand: 'Pole Hand Finish' };
const STEP_ES = { spinSetup: 'Preparación', spinSpray: 'Pintura', spinBake: 'Horno', poleSpray: 'Pintura de barras', poleBake: 'Horno de barras', hand: 'Acabado a mano', poleHand: 'Acabado a mano (barras)' };
/** "Setup → Spray → Bake" — the coat this step belongs to, as the stop spells it. */
const airNames = (names, es) => ({ ...names, ...(es ? AIR_DRY_LABEL_ES : AIR_DRY_LABEL) });
const coatLine = (taskKey, names) => (String(taskKey || '').startsWith('pole') ? ['poleSpray', 'poleBake'] : ['spinSetup', 'spinSpray', 'spinBake']).map(k => names[k]).join(' → ');

/**
 * May this step START now? The first step before it that is not complete stops it.
 * `wo.tasks` is read as it stands — the floor resets a coat's steps to Pending when the coat advances (and when a
 * spin load loops), so "complete" always means complete on THIS coat.
 * @returns null | { kind: 'OUT_OF_ORDER', taskKey, waitsOn, running }
 */
export function startStopOf({ wo, taskKey, airDry = false } = {}) {
    const before = STEPS_BEFORE[String(taskKey || '')];
    if (!before || !before.length) return null;
    const tasks = (wo && wo.tasks) || {};
    const waitsOn = before.find(k => String((tasks[k] || {}).status || '') !== 'Complete');
    if (!waitsOn) return null;
    return { kind: STEP_STOP.OUT_OF_ORDER, taskKey, waitsOn, running: String((tasks[waitsOn] || {}).status || '') === 'Running', ...(airDry ? { airDry: true } : {}) };
}

/**
 * May this bake be COMPLETED now? Not before the oven time has run from its start. A bake that is not running has
 * not baked at all — a start time left on the step by an earlier coat is never read as this coat's.
 * @param task      the bake's own task as it stands ({ status, startTime })
 * @param ovenMins  the oven time set in Production Times; 0 / unset = no stop (nothing to hold it to) — on a wood coat, the
 *                  air dry's minutes, with `airDry` true (Shared/airDry.dryMinsOf)
 * @returns null | { kind: 'BAKE_TOO_SOON', taskKey, started, ranMins, ovenMins, leftMins, airDry? }
 */
export function bakeStopOf({ taskKey, task, nowMs, ovenMins, airDry = false } = {}) {
    if (!BAKE_KEYS.includes(String(taskKey || ''))) return null;
    const oven = num(ovenMins);
    if (!(oven > 0)) return null;
    const t = task || {};
    const started = String(t.status || '') === 'Running' && num(t.startTime) > 0;
    const ranMins = started ? Math.max(0, (num(nowMs) - num(t.startTime)) / MIN) : 0;
    if (started && ranMins >= oven) return null;
    return { kind: STEP_STOP.BAKE_TOO_SOON, taskKey, started, ranMins, ovenMins: oven, leftMins: Math.max(0, oven - ranMins), ...(airDry ? { airDry: true } : {}) };
}

const whole = (m) => Math.max(1, Math.ceil(num(m)));
const ran = (m) => (num(m) < 1 ? 'under 1 min' : `${Math.floor(num(m))} min`);
const ranEs = (m) => (num(m) < 1 ? 'menos de 1 min' : `${Math.floor(num(m))} min`);

/** The reason alone, in each language — the stop, the manager's confirm and the log all say it the same way. */
export function stepStopReason(stop) {
    const s = stop || {};
    if (s.kind === STEP_STOP.OUT_OF_ORDER) {
        const EN = s.airDry ? airNames(STEP_EN, false) : STEP_EN, ES = s.airDry ? airNames(STEP_ES, true) : STEP_ES;
        return {
            en: `${EN[s.waitsOn] || s.waitsOn} ${s.running ? 'is still running' : 'has not been completed'} on this coat — ${EN[s.taskKey] || s.taskKey} comes after it (${coatLine(s.taskKey, EN)}).`,
            es: `${ES[s.waitsOn] || s.waitsOn} ${s.running ? 'todavía está en proceso' : 'no se ha completado'} en esta capa — ${ES[s.taskKey] || s.taskKey} va después (${coatLine(s.taskKey, ES)}).`,
        };
    }
    if (s.kind === STEP_STOP.BAKE_TOO_SOON && s.airDry) {
        return s.started
            ? {
                en: `This air dry has run ${ran(s.ranMins)} of ${whole(s.ovenMins)} — about ${whole(s.leftMins)} min left. It is too soon to PIN it complete.`,
                es: `Este secado al aire lleva ${ranEs(s.ranMins)} de ${whole(s.ovenMins)} — faltan unos ${whole(s.leftMins)} min. Es demasiado pronto para marcarlo como completado.`,
            }
            : {
                en: `This air dry was never started on this coat — wood dries ${whole(s.ovenMins)} min on the rack, it does not go in the oven. Press START when it goes on the rack.`,
                es: `Este secado al aire nunca se inició en esta capa — la madera se seca ${whole(s.ovenMins)} min en el rack, no entra al horno. Presione EMPIEZA cuando quede en el rack.`,
            };
    }
    if (s.kind === STEP_STOP.BAKE_TOO_SOON) {
        return s.started
            ? {
                en: `This bake has run ${ran(s.ranMins)} of ${whole(s.ovenMins)} — about ${whole(s.leftMins)} min left. It is too soon to PIN it complete.`,
                es: `Este horneado lleva ${ranEs(s.ranMins)} de ${whole(s.ovenMins)} — faltan unos ${whole(s.leftMins)} min. Es demasiado pronto para marcarlo como completado.`,
            }
            : {
                en: `This bake was never started on this coat — the oven time is ${whole(s.ovenMins)} min. Press START when it goes in the oven.`,
                es: `Este horneado nunca se inició en esta capa — el tiempo de horno es de ${whole(s.ovenMins)} min. Presione EMPIEZA cuando entre al horno.`,
            };
    }
    return { en: '', es: '' };
}

/** What the operator reads when the step is stopped, in English and in Spanish. */
export function stepStopText({ stop = null, who = '', order = '', step = '', stepEs = '' } = {}) {
    const r = stepStopReason(stop);
    const bake = stop && stop.kind === STEP_STOP.BAKE_TOO_SOON;
    const air = bake && stop.airDry;
    return [
        `${bake ? (air ? '⏱ TOO SOON — THE AIR DRY HAS NOT RUN ITS TIME' : '⏱ TOO SOON — THE BAKE HAS NOT RUN ITS TIME') : '⛔ NOT YET — THE STEPS RUN IN ORDER'}${who ? ` — ${who}` : ''}`,
        `${step}${order ? ` · ${order}` : ''}`,
        '',
        r.en,
        '',
        'A manager can override this with their own PIN.',
        'This stop has been logged.',
        '',
        '────────────',
        '',
        `${bake ? (air ? '⏱ DEMASIADO PRONTO — EL SECADO AL AIRE NO HA CUMPLIDO SU TIEMPO' : '⏱ DEMASIADO PRONTO — EL HORNO NO HA CUMPLIDO SU TIEMPO') : '⛔ TODAVÍA NO — LOS PASOS VAN EN ORDEN'}${who ? ` — ${who}` : ''}`,
        `${stepEs || step}${order ? ` · ${order}` : ''}`,
        '',
        r.es,
        '',
        'Un gerente puede autorizarlo con su propio PIN.',
        'Este aviso ha sido registrado.',
    ].join('\n');
}

/** What a manager is asked before the stop is passed. OK = override, logged under their name. */
export function stepOverrideText({ stop = null, who = '', order = '', step = '' } = {}) {
    const r = stepStopReason(stop);
    return [
        `⚠ MANAGER OVERRIDE${who ? ` — ${who}` : ''}`,
        `${step}${order ? ` · ${order}` : ''}`,
        '',
        r.en,
        '',
        'Press Cancel to hold (normal).',
        'Press OK to override — it is logged under your name.',
    ].join('\n');
}

/** One line for the floor log. */
export function stepStopLogText(stop) {
    const s = stop || {};
    if (s.kind === STEP_STOP.OUT_OF_ORDER) return `${s.waitsOn} ${s.running ? 'still running' : 'not complete'} on this coat`;
    if (s.kind === STEP_STOP.BAKE_TOO_SOON && s.airDry) return s.started ? `air dry ran ${num(s.ranMins).toFixed(1)}m of ${whole(s.ovenMins)}m` : `air dry never started (wood, ${whole(s.ovenMins)}m)`;
    if (s.kind === STEP_STOP.BAKE_TOO_SOON) return s.started ? `bake ran ${num(s.ranMins).toFixed(1)}m of ${whole(s.ovenMins)}m` : `bake never started (oven ${whole(s.ovenMins)}m)`;
    return '';
}
