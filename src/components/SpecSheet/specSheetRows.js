// ─────────────────────────────────────────────────────────────────────────────────────────────
// WHAT A SPEC SHEET DRAWS — asked of the engine, not worked out again (Stuart 2026-08-21)
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// "we just need it to render like the attached, be able to select a bracket arm and it basically
//  works the same as the steps/rules in the cpq. for the brackets with the backplates with matching
//  tags, ie. inline renders with inline back and cover plates, basic renders with no backplates."
//
// The sheet is a QUOTE WITH NO PRICES: the same parts, paired by the same rules, drawn instead of
// listed. The old one re-derived those rules — which arm takes which plate, which arm takes none —
// off node names and geometry, and got them wrong in ways the CPQ never did, because the CPQ reads
// the tags in 1.6 and the sheet was guessing.
//
// So it does not decide anything. It ANSWERS THE ARM and asks the engine what follows, exactly as
// the configurator does when an operator clicks that same arm:
//
//   · a BASIC arm is one piece — `slots()` suppresses its plate question, so the row has no plates
//   · an IN-LINE arm takes the in-line copies — `slots()` narrows the pool to them
//   · a plain arm takes the plain plates
//   · a plate made at another projection is not in the pool, so it is not on the sheet
//
// Every one of those sentences is a rule that already exists and is already tested
// (scripts/hardwareModel.test.mjs). Nothing here can disagree with the quote, because there is
// nothing here to disagree with — only the same call the configurator makes.

import { resolve, slots } from '../Shared/hardwareModel.js';

const U = (v) => String(v ?? '').trim().toUpperCase();

/**
 * Every bracket arm this assembly offers, in the order the sheet lists them.
 *
 * ONE ROW PER PART, not per pin: an arm pinned left and right is one product on a drawing, and the
 * sheet draws one side (the reference sheets are all left-hand views).
 */
export function armsOf(model) {
    const out = [];
    const seen = new Set();
    (model?.slots || []).filter(s => s.kind === 'BRACKET').forEach(slot => {
        (slot.options || []).forEach(o => {
            const key = U(o.partId || o.id);
            if (!key || seen.has(key)) return;
            seen.add(key);
            out.push(o);
        });
    });
    // The hand-made sheets run H, R, S, V — the plate profiles in that order — then alphabetically.
    const rank = (o) => { const m = String(o.name || o.partId || '').match(/-(H|R|S|V)$/i); return m ? 'HRSV'.indexOf(m[1].toUpperCase()) : 9; };
    return out.sort((a, b) => rank(a) - rank(b) || String(a.partId).localeCompare(String(b.partId)));
}

/**
 * The plates that pair with ONE arm — answered by the engine, with that arm selected.
 *
 * ⚠ TAKES THE MODEL'S OWN CHOICE LIST (`model.choices`), NOT RAW PINS. resolve() normalizes what it
 * is handed, and normalizing an already-normalized choice drops the projection tag — the very tag
 * this pairing is judged on. So it is passed the list resolve already made.
 *
 * @returns { plates, suppressedBy, reason }  `plates` empty WITH a reason is a real answer, not a
 *          failure: a basic arm carries its own plate, so the row is the arm alone — which is
 *          exactly how the hand-made drawings show it.
 */
export function platesForArm({ choices, answers = {}, arm, rod = null }) {
    if (!arm) return { plates: [], suppressedBy: null, reason: '' };
    // A rod is selected alongside the arm because the world rules need one: slots are filtered by
    // which rod world the order is in, and with nothing chosen a traverse-only plate would stand
    // beside a solid one. The sheet's rod is whichever the caller is drawing against.
    const selected = [arm.id, ...(rod ? [rod.id] : [])];
    const sl = slots(choices, answers, selected);
    const plateSlot = sl.find(s => s.kind === 'BACKPLATE'
        && U(s.position || '') === U(arm.position || ''))
        || sl.find(s => s.kind === 'BACKPLATE');
    if (!plateSlot) return { plates: [], suppressedBy: null, reason: 'this assembly pins no backplates' };
    if (plateSlot.suppressedBy) {
        return { plates: [], suppressedBy: plateSlot.suppressedBy, reason: plateSlot.suppressedReason || '' };
    }
    // One row per plate PART, for the same reason as the arms.
    const seen = new Set();
    const plates = (plateSlot.options || []).filter(o => {
        const k = U(o.partId || o.id);
        if (!k || seen.has(k)) return false;
        seen.add(k); return true;
    });
    return { plates, suppressedBy: null, reason: '' };
}

/**
 * The sheet, as rows: every arm with the plates that belong to it.
 *
 * @param choices  RAW choices from the adapter — resolve() normalizes, and normalizing twice drops
 *                 the projection tag every one of these rules is judged on.
 */
export function sheetRows({ choices, answers = {}, rodId = null }) {
    const model = resolve({ choices, answers, selectedIds: rodId ? [rodId] : [] });
    const norm = model.choices || [];
    const rod = rodId ? norm.find(c => c.id === rodId) : null;
    return armsOf(model).map(arm => ({
        arm,
        ...platesForArm({ choices: norm, answers, arm, rod }),
    }));
}
