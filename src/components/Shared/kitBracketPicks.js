// ── A KIT FILLS IN ITS OWN BRACKETS (Stuart 2026-10-01, quoting H1-138TRV-4V/P) ─────────────────
// "when starting from kit … it should prepopulate ideally the steps and at a minimum the cart with the
//  bracket selections in the kit, that is part of the whole point. i had to manually select vertical
//  backplates and it is expressly stated in the kit."
//
// Since 09-10 a kit only REPORTED its bracket — "pick the V backplate; the arm follows the measured
// projection" — and left every bracket step to the operator. But nothing about it is a decision:
//   · the ARM is the family's arm at the depth answered (H1-138TRV: SBA 3-5/8" · EBA 4-5/8" · 6BA 6";
//     one arm for a double; the ceiling arm under a ceiling mount);
//   · the BACKPLATE is the family's plate in the orientation the KIT is sold with (BP-H / BP-V; the
//     ceiling plate under the ceiling arm).
// Both are named by the same table the kit's explosion consumes (Shared/traverseExplode.
// TRAVERSE_FAMILY_PARTS), so what is picked on screen is what the kit says it contains.
//
// ⚠ THEY ARE REAL PICKS, MADE IN ORDER. The engine offers a backplate only once an arm is chosen at
// its position ("a plate with no arm is not a question yet" — hardwareModel.slots), so a derived
// pick could never reach the plates: the arms are picked, the model re-resolves, the plate slots
// open, and the plates are picked. Each (slot, part) is filled ONCE — `done` — so the operator can
// change or clear any of them and it stays as they left it; a new projection names a new arm and
// that one is filled once too. A slot that already holds a live pick is never touched, and the arm
// waits for the projection: nothing is guessed. Pure. Harness: scripts/kitBracketPicks.test.mjs.

import { TRAVERSE_FAMILY_PARTS, singleProjections } from './traverseExplode.js';

const U = (v) => String(v == null ? '' : v).trim().toUpperCase();
const sameDepth = (a, b) => { const x = parseFloat(a), y = parseFloat(b); return Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - y) < 0.01; };

/**
 * The arm and the plate a kit is sold with, as OUR item codes ('' where the kit does not say).
 * @param kit   the Kit-class record (manufacturingSpecs.kitFamily + kitAlign)
 * @param proj  the projection answered, in inches — a single's arm waits for it
 */
export function kitBracketCodesOf({ kit, proj } = {}) {
    const ms = (kit && kit.manufacturingSpecs) || {};
    const align = ms.kitAlign || null;
    const family = String(ms.kitFamily || 'H1-2TRV');
    const P = TRAVERSE_FAMILY_PARTS[family];
    if (!align || !P || !P.brackets) return { arm: '', plate: '' };
    const style = U(align.bracketStyle);
    const ceiling = U(align.mount) === 'CEILING';
    const double = U(align.setup) === 'DOUBLE';
    const ring = U(align.frontRail) === 'RING';
    let arm = '';
    if (ceiling) arm = P.brackets.CEILING || '';
    else if (double) {
        const D = P.brackets.DOUBLE;
        arm = typeof D === 'string' ? D
            : (D && typeof D === 'object') ? (D[style] || '')
            : ((ring ? P.brackets.DOUBLE_RING : P.brackets.DOUBLE_TRACK) || '');
    } else {
        const hit = (proj == null || proj === '') ? null : singleProjections(family, style).find(p => sameDepth(p.inches, proj));
        arm = hit ? hit.code : '';
    }
    const plate = P.plates ? (ceiling ? (P.plates.CEILING || '') : (P.plates[style] || '')) : '';
    return { arm: U(arm), plate: U(plate) };
}

/**
 * The bracket and backplate slots the kit can fill right now.
 * @param model      the resolved model — its slots as they are offered at this moment
 * @param kit        the kit the operator started from
 * @param answers    the answers in force (proj names a single's arm)
 * @param livePicks  the picks that currently stand, by slot key — a slot holding one is left alone
 * @param codeOf     (option) → our item code for it
 * @param done       Set of `${slotKey}|${choiceId}` already filled once — never filled twice
 * @param wants      optional (slot) → boolean: is a bracket wanted at this slot at all? The CENTRE is the
 *                   one that repeats, and a short pole held at both ends wants NONE — a centre arm picked
 *                   there would still count as one, a bracket above the kit's chart, billed. The caller
 *                   knows the span; where it cannot say, the centre is left to the operator.
 * @returns { [slotKey]: choiceId }
 */
export function kitBracketPicksOf({ model, kit, answers = {}, livePicks = {}, codeOf, done, wants } = {}) {
    const out = {};
    if (!model || !kit || typeof codeOf !== 'function') return out;
    const codes = kitBracketCodesOf({ kit, proj: answers ? answers.proj : null });
    if (!codes.arm && !codes.plate) return out;
    const seen = done instanceof Set ? done : new Set();
    const live = livePicks || {};
    // ⚠ THE PLATE FOLLOWS AN ARM THAT IS ALREADY STANDING. The plate is pinned once per depth, so until an
    // arm holds its position the slot can offer every depth's plate at once — and the first vertical one
    // is not the right one (the harness caught a 6" plate picked before any projection was answered).
    // An arm filled in THIS pass does not count: the model re-resolves with it first, and the next pass
    // sees only the plates cut for it.
    const armedAt = new Set((model.slots || []).filter(s => s.kind === 'BRACKET' && live[s.key]).map(s => U(s.position)));
    (model.slots || []).forEach(s => {
        const want = s.kind === 'BRACKET' ? codes.arm : s.kind === 'BACKPLATE' ? codes.plate : '';
        if (!want || s.suppressedBy || !Array.isArray(s.options) || !s.options.length) return;
        if (live[s.key]) return;
        if (s.kind === 'BACKPLATE' && !armedAt.has(U(s.position))) return;
        if (s.kind === 'BRACKET' && typeof wants === 'function' && !wants(s)) return;
        const opt = s.options.find(o => U(codeOf(o)) === want);
        if (!opt || seen.has(`${s.key}|${opt.id}`)) return;
        out[s.key] = opt.id;
    });
    return out;
}

/** The sentence for the "Started from kit" strip — what the kit fills in, in the operator's words. */
export function kitBracketSummary({ kit } = {}) {
    const ms = (kit && kit.manufacturingSpecs) || {};
    const align = ms.kitAlign || {};
    const P = TRAVERSE_FAMILY_PARTS[String(ms.kitFamily || 'H1-2TRV')];
    if (!P || !P.brackets) return '';
    const style = { H: 'horizontal', V: 'vertical' }[U(align.bracketStyle)];
    const ceiling = U(align.mount) === 'CEILING';
    const single = !ceiling && U(align.setup) !== 'DOUBLE';
    const arm = single ? 'the bracket arm for the projection you answer' : `the ${ceiling ? 'ceiling' : 'double'} bracket arm`;
    const plate = P.plates ? (ceiling ? ' and its ceiling plate' : style ? ` and the ${style} backplates` : '') : '';
    return `brackets — ${arm}${plate}, at every position`;
}
