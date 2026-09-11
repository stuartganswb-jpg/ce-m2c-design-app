// ── VISION'S PICKERS, FROM THE ENGINE (Stuart 2026-09-10: "fix vision … runs on new engine and can
// open and reopen with no problems") ───────────────────────────────────────────────────────────
//
// Until now Vision Hardware built its hardware pickers from the OLD flow's steps and filtered every
// option one at a time through the engine, then re-derived the engine's rules by hand (a return
// greys the bracket, a decorative end keeps it, the plate follows the arm holding the rod, a basic
// bracket takes no plate) and swept picks the rules no longer allowed. Every one of those rules
// already lives in Shared/hardwareModel.slots(), which is what CPQ walks — so this module asks the
// engine for the walk and shapes it for the drawing. The board (dimensions, placement, cut sheet)
// is Vision's own and is untouched; only where the parts come from changes.
//
// Pure. Harnessed in scripts/visionEngine.test.mjs.

import { resolve, reseatPicks, ROD_ROLES } from './hardwareModel.js';

const U = (v) => String(v ?? '').trim().toUpperCase();
const END_STYLE = { FRENCH_RETURN: 'RETURN_BEND', MITER_RETURN: 'RETURN_MITER', INSIDE_MOUNT: 'FLUSH', FINIAL: 'FINIAL' };

/** The same settle CPQ runs: keep the picks the model still offers (or their twin), re-resolve, stop when nothing moves. */
export function settleVision({ choices = [], answers = {}, picks = {}, modelNodes = [] } = {}) {
    let sel = Object.values(picks || {}).filter(Boolean);
    let m = resolve({ choices, answers, selectedIds: sel, modelNodes });
    for (let pass = 0; pass < 4; pass++) {
        const next = Object.values(reseatPicks(m, picks));
        if (next.length === sel.length && next.every(id => sel.includes(id))) break;
        sel = next;
        m = resolve({ choices, answers, selectedIds: sel, modelNodes });
    }
    return { model: m, live: reseatPicks(m, picks) };
}

/** What the drawing's fabrication math calls this end. */
export const endStyleOf = (choice) => {
    if (!choice) return '';
    if (choice.role === 'INSIDE_MOUNT') return 'FLUSH';
    if (choice.role === 'RETURN') return END_STYLE[U(choice.endTreatment)] || 'RETURN_MITER';
    if (choice.role === 'FINIAL') return 'FINIAL';
    return END_STYLE[U(choice.endTreatment)] || '';
};

/** A return that carries the rod (not decorative: END-ARM + NO PLATE dresses the end and leaves the bracket). */
export const carriesRod = (choice) => !!choice && (choice.role === 'RETURN' || choice.role === 'INSIDE_MOUNT') && !(choice.isReturnArm && choice.noBackplate);

const optionOf = (c, nameOf) => ({
    id: c.id, partId: c.partId || '', name: (typeof nameOf === 'function' && nameOf(c.partId)) || c.name || c.partId || c.id,
    role: c.role, endStyle: endStyleOf(c), isReturn: c.role === 'RETURN' || c.role === 'INSIDE_MOUNT',
    decorative: !!(c.isReturnArm && c.noBackplate), isReturnArm: !!c.isReturnArm, isBasic: !!c.isBasic,
    depths: Array.isArray(c.projs) ? c.projs.slice() : [], projTiers: c.projTiers || null,
});

/**
 * The pickers, as the engine asks them.
 *
 * @returns {
 *   live:    { slotKey: choiceId }          — the settled picks (what is actually chosen)
 *   pickers: [{ key, kind, tier, position, options, chosen, locked, lockedBy, lockedReason }]
 *   at:      (kind, position, tier?) => picker   — 'END' | 'BRACKET' | 'BACKPLATE' | 'ROD' | 'RING'
 *   model:   the settled resolve() result
 * }
 * Picks are keyed by the engine's slot key; options by the engine's choice id. A one-part step
 * (an option nobody can change) is still a picker — the drawing shows it chosen.
 */
export function visionPickers({ choices = [], answers = {}, picks = {}, modelNodes = [], nameOf = null } = {}) {
    const { model, live } = settleVision({ choices, answers, picks, modelNodes });
    const pickers = (model.slots || []).map(s => {
        const options = (s.options || []).map(c => optionOf(c, nameOf));
        // Where one part is listed more than once, say its depth (CPQ never lists twice — the
        // projection answer picks the copy; a dropdown has to say it).
        const counts = options.reduce((m, o) => { m[o.partId] = (m[o.partId] || 0) + 1; return m; }, {});
        options.forEach(o => { o.twice = counts[o.partId] > 1; });
        return {
            key: s.key, kind: s.kind, tier: s.tier || '', position: s.position || '',
            options, chosen: live[s.key] || '',
            locked: !!s.suppressedBy, lockedBy: s.suppressedBy || '', lockedReason: s.suppressedReason || '',
        };
    });
    const at = (kind, position = '', tier) => pickers.find(p => p.kind === kind && (p.position || '') === (position || '')
        && (tier === undefined ? true : (p.tier || '') === (tier || ''))) || null;
    return { model, live, pickers, at };
}

/**
 * The engData fields Vision's fabrication math reads, derived from the settled picks — the same
 * one-way writes the old step effect made: a chosen part sets the id; a locked place clears it.
 */
export function engDataFromPickers(pk, { libraryIdOf = (partId) => partId } = {}) {
    const out = {};
    const chosenAt = (kind, pos, tier = 'FRONT') => {
        const p = pk.at(kind, pos, tier) || pk.at(kind, pos, '');
        if (!p) return { p: null, c: null };
        const c = p.chosen ? (pk.model.choices || []).find(x => x.id === p.chosen) : null;
        return { p, c };
    };
    [['BRACKET', 'LEFT', 'bracketId'], ['BRACKET', 'RIGHT', 'bracketIdRight'], ['BRACKET', 'CENTER', 'bracketIdCenter']].forEach(([k, pos, key]) => {
        const { p, c } = chosenAt(k, pos);
        if (c) out[key] = libraryIdOf(c.partId) || '';
        else if (p && p.locked) out[key] = '';
    });
    [['BACKPLATE', 'LEFT', 'backplateIdLeft'], ['BACKPLATE', 'RIGHT', 'backplateIdRight'], ['BACKPLATE', 'CENTER', 'backplateIdCenter']].forEach(([k, pos, key]) => {
        const { p, c } = chosenAt(k, pos);
        if (c) out[key] = libraryIdOf(c.partId) || '';
        else if (p && p.locked) out[key] = '';
    });
    [['LEFT', 'endStyle', 'mountLeft'], ['RIGHT', 'endStyleRight', 'mountRight']].forEach(([pos, key, mkey]) => {
        const { c } = chosenAt('END', pos);
        if (!c) return;
        const style = endStyleOf(c);
        if (style) out[key] = style;
        out[mkey] = c.role === 'INSIDE_MOUNT' ? 'INSIDE' : 'OPEN';
    });
    return out;
}

/** What a saved line carries so CPQ (visionBridge.visionPartIds) seeds by part, no flow lookup. */
export function enginePicksForDraft(pk) {
    return pk.pickers.filter(p => p.chosen).map(p => {
        const c = (pk.model.choices || []).find(x => x.id === p.chosen) || {};
        return { slotKey: p.key, choiceId: p.chosen, partId: c.partId || '', kind: p.kind === 'END' ? '' : p.kind, position: p.position, tier: p.tier };
    });
}

/** The rod-role choices the drawing draws (for the bridge's rod-kind read and the cut sheet). */
export const chosenRods = (pk) => Object.values(pk.live).map(id => (pk.model.choices || []).find(c => c.id === id)).filter(c => c && ROD_ROLES.includes(c.role));
