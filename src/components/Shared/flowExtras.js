// ── A HAND-ADDED ITEM IS OFFERED FOR THE ROD IT FITS (Stuart 2026-09-30, Eric's App Imp card on
//    H1-138: "HSCPC1 joiner — we do need the ability to add a different splice/joiner for each rod
//    type … as each flow may have this issue if it has different rod materials") ───────────────────
//
// H1-138 sells steel, wood and acrylic rods and offered ONE joiner, H1-138JNR — the steel rod's —
// on every rod, and over the one-piece limit the length step added it by itself to a wood rod too.
// Each item on a flow's tab-11 add-by-hand list may now name the rod materials it is for
// (`rodMaterials`, e.g. ['WOOD']). Blank = every rod, which is what every item on every flow was
// before this, so nothing already set up changes.
//
// The rod's material is the chosen rod's own 1.6 material tag — the tag that already decides which
// finishes it wears (hardwareModel.takesFinish; blank = METAL). Until a rod is chosen nothing is
// known, so every item stays offered: the length step can come before the rod step.
//
// An item that does not fit the chosen rod is not offered, is not auto-added and does not bill —
// FILTERED at render time, never deleted, the rule the configurator keeps for picks: the row the
// operator typed stays in the work, so switching back to the wood rod brings its joiner (and its
// note) back. Pure — no React, no Firestore. Harness: scripts/flowExtras.test.mjs.

import { ROD_ROLES } from './hardwareModel.js';

/** The materials tab 11 offers — the base materials 1.6 tags rods with. */
export const ROD_MATERIALS = [
    { key: 'METAL', label: 'Metal' },
    { key: 'WOOD', label: 'Wood' },
    { key: 'CLEAR', label: 'Clear (acrylic)' },
    // ⚠ A TRAVERSE ROD IS ITS OWN KIND (Stuart 2026-10-01, an H1-138 traverse quote carrying TWO joiners:
    // H1-138JNR from the length step and H1-138TRVJNR from the traverse chart). A traverse is steel, so
    // "METAL" let the round-rod joiner onto it — but its joiner is the chart's (Shared/traverseExplode,
    // from 11 ft). So a traverse rod answers TRAVERSE, never its material, and only an item ticked
    // TRAVERSE is offered with it.
    { key: 'TRAVERSE', label: 'Traverse rod' },
];
export const TRAVERSE_ROD = 'TRAVERSE';

const U = (v) => String(v == null ? '' : v).trim().toUpperCase();

/** 'CLEAR (NO FINISH)' is the clear material with its note — the material is the word before it. */
export const baseMaterial = (m) => U(m).replace(/\s*\(.*\)\s*$/, '');

/** A list as tagged: an array, or 'WOOD, METAL' typed as text. Base materials, deduped. */
const listOf = (v) => [...new Set((Array.isArray(v) ? v : String(v == null ? '' : v).split(/[,;|]+/))
    .map(baseMaterial).filter(Boolean))];

/** What the chosen rod(s) are: the material of a solid rod (untagged = METAL), TRAVERSE for a traverse. [] = none chosen yet. */
export function rodMaterialsOf(choices = [], selectedIds = []) {
    const want = new Set((selectedIds || []).filter(Boolean).map(String));
    const out = new Set();
    (choices || []).forEach(c => {
        if (!c || !want.has(String(c.id)) || !ROD_ROLES.includes(c.role)) return;
        if (U(c.rodKind) === TRAVERSE_ROD || c.role === 'FASCIA' || c.role === 'TRACK') { out.add(TRAVERSE_ROD); return; }
        const mats = listOf(c.materials);
        (mats.length ? mats : ['METAL']).forEach(m => out.add(m));
    });
    return [...out].sort();
}

/** The rod materials an add-by-hand item is for. [] = any rod. */
export const itemRodMaterials = (item) => listOf(item && item.rodMaterials);

/** Is this item offered with this rod? Any-rod items always; nothing is ruled out before a rod is chosen. */
export function extraFitsRod(item, rodMats = []) {
    const want = itemRodMaterials(item);
    if (!want.length || !(rodMats || []).length) return true;
    return want.some(m => rodMats.includes(m));
}

/** The flow's add-by-hand list, as offered with this rod. */
export const extrasForRod = (extraItems = [], rodMats = []) =>
    (extraItems || []).filter(it => it && extraFitsRod(it, rodMats));

/**
 * The typed rows that are live with this rod. A row is judged by the flow item of its code; a row
 * whose code is not on the flow's list (an older order, a restored line) cannot be judged and stays.
 */
export function liveExtrasOf(extras = [], extraItems = [], rodMats = []) {
    const byCode = new Map((extraItems || []).filter(Boolean).map(it => [U(it.code), it]));
    return (extras || []).filter(x => {
        if (!x) return false;
        const it = byCode.get(U(x.code));
        return !it || extraFitsRod(it, rodMats);
    });
}

// ── A POLE OVER THE ONE-PIECE LIMIT, WITH NO SPLICE (Stuart 2026-10-01: "at 12 ft it needs and
//    recommends one but we need to be able to make it 0 just in case and have it allow it with
//    warning") ────────────────────────────────────────────────────────────────────────────────
// The splice over the limit is a recommendation the operator may decline. When they do, the screen
// says so in plain words and the line carries the fact to the floor as a shop note, so a 144" pole
// with no joiner reads as a decision and not as something that was forgotten.
//   canSplice  the flow offers a joiner for this rod (the length step's, or the traverse chart's)
//   spliceQty  joiners actually on the line, from either source
export function noSpliceOf({ lengthInches, limitInches, canSplice = false, spliceQty = 0 } = {}) {
    const L = Number(lengthInches) || 0;
    const lim = Number(limitInches) > 0 ? Number(limitInches) : 120;
    return !!canSplice && L > lim && !(Number(spliceQty) > 0);
}
export const noSpliceNote = (lengthInches, limitInches) =>
    `NO SPLICE — ${Number(lengthInches) || 0}" pole ships in ONE PIECE (over the ${Number(limitInches) > 0 ? Number(limitInches) : 120}" one-piece limit; no joiner on this line)`;
