// ── CHORES — WORK IN BETWEEN THE STEPS (Stuart 2026-10-13 / 10-14, phase 3 of the metrics work) ───────────────
// "it is important on the finishing floor for operators of any position when their job / step is in the oven / bake
// they are 'free' and should be expected to do other chores, we can add little in between steps on the orders for
// paint prep and set up prep that they pin in on and it does not start the job just tracks that they are doing
// something" · "yes once a pin starts a job the chore is automatically closed out".
//
// A chore is PINned onto an order on the floor (Manual Floor Control). It starts nothing: no step, no coat, no status
// — the order's tasks are never touched. It records who is doing what, on which order, since when:
//   fin_workorders.chores.<person key> = { kind, by, startedAt }        — open now (every floor screen sees it)
//   fin_logs  action CHORE_START / CHORE_END (elapsedMs, startedAtMs)   — the history Floor Metrics reads
// One chore per person. It closes when that person PINs onto a real step (any order — "once a pin starts a job the
// chore is automatically closed out"), when they start another chore, or when it is ended by hand. A chore is not
// started while the person has a hands-on step running — finish the step first; a bake in the oven never counts.
//
// Pure — no React, no Firestore (the caller writes; a removal is Firestore's deleteField at `fieldOf(by)`).
// Harness: scripts/floorChores.test.mjs.

import { woRefOf } from './woRef.js';

const MIN = 60000;
export const CHORE_KINDS = {
    paintPrep: { label: 'Paint prep', es: 'Preparar pintura' },
    setupPrep: { label: 'Setup prep', es: 'Preparar montaje' },
};
export const CHORE_ACTION = { START: 'CHORE_START', END: 'CHORE_END' };
/** Why a chore ended. */
export const CHORE_END_WHY = { ENDED: 'ended', STEP: 'step started', SWITCH: 'another chore' };

const clean = (s) => String(s == null ? '' : s).trim();
/** A person's slot in the `chores` map — a Firestore-safe key from their name ("Sandra G" → "sandra_g"). */
export const choreKeyOf = (name) => clean(name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
/** The field a person's open chore lives at on a finishing document. */
export const fieldOf = (name) => `chores.${choreKeyOf(name)}`;
export const choreLabelOf = (kind) => (CHORE_KINDS[kind] || { label: String(kind || 'Chore') }).label;

/** Every chore open on the floor → [{ wo, key, kind, by, startedAt }], oldest first. */
export function openChoresOf(workOrders = []) {
    const out = [];
    workOrders.forEach(wo => Object.entries((wo && wo.chores) || {}).forEach(([key, c]) => {
        if (!c || !clean(c.by)) return;
        out.push({ wo, key, kind: c.kind, by: clean(c.by), startedAt: Number(c.startedAt) || 0 });
    }));
    return out.sort((a, b) => a.startedAt - b.startedAt);
}
/** This person's open chore, wherever it is. */
export const openChoreFor = (workOrders, name) => {
    const k = choreKeyOf(name);
    return k ? openChoresOf(workOrders).find(c => c.key === k || choreKeyOf(c.by) === k) || null : null;
};

/**
 * May this person start a chore? → null, or why not.
 * @param openStep  the hands-on step this person has running (ActiveFloor.openStepFor — bakes excluded), or null
 */
export function choreStartRefusal({ actor, kind, openStep } = {}) {
    if (!clean(actor)) return { why: 'NO_PIN', text: 'No PIN — a chore is recorded under the person doing it.' };
    if (!CHORE_KINDS[kind]) return { why: 'UNKNOWN', text: `"${kind}" is not a chore here.` };
    if (openStep) return { why: 'STEP_OPEN', text: `${clean(actor)} has a step running — finish it first (✓ Complete · Completado). A chore is for the time a job is in the oven or waiting.\n\n${clean(actor)} tiene un paso abierto — termínelo primero. Las tareas son para cuando el trabajo está en el horno o esperando.` };
    return null;
}

/** The open chore, as written on the order. */
export const choreRecordOf = ({ actor, kind, nowMs }) => ({ kind, by: clean(actor), startedAt: nowMs });

/** The floor log line for a chore starting or ending. */
export function choreLogOf({ action, actor, kind, wo, nowMs, startedAt = null, why = '' }) {
    const ref = woRefOf(wo);
    const label = choreLabelOf(kind);
    const ran = startedAt ? nowMs - startedAt : null;
    return {
        u: clean(actor), cat: 'manual', at: nowMs, action, chore: kind, task: 'chore', station: 'MANUAL',
        woId: (wo && wo.id) || '', woRefNo: ref,
        msg: action === CHORE_ACTION.START
            ? `🧰 CHORE START · ${label} · ${ref} — ${clean(actor)}`
            : `🧰 CHORE END · ${label} · ${ref} — ${clean(actor)}${ran != null ? ` · ${(ran / MIN).toFixed(1)}m` : ''}${why ? ` (${why})` : ''}`,
        ...(action === CHORE_ACTION.END ? { elapsedMs: ran, startedAtMs: startedAt, endedWhy: why } : {}),
    };
}

/** Floor Metrics: every finished chore in the floor log → [{ who, woId, kind, startMs, endMs }]. */
export function choreIntervalsOf(finLogs = []) {
    const seen = new Set();
    return finLogs.filter(l => l && l.action === CHORE_ACTION.END && Number(l.startedAtMs) > 0 && Number(l.at) > Number(l.startedAtMs) && clean(l.u))
        .map(l => ({ who: clean(l.u), woId: String(l.woId || ''), kind: l.chore || '', startMs: Number(l.startedAtMs), endMs: Number(l.at) }))
        .filter(c => { const k = `${choreKeyOf(c.who)}|${c.startMs}`; if (seen.has(k)) return false; seen.add(k); return true; })
        .sort((a, b) => a.startMs - b.startMs);
}
