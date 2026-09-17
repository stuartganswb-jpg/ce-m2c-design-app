// THE FINISH, IN WORDS (Stuart 2026-08-03: "none of the items, docs, view item, pdf, etc. none
// show the finish that was selected?").
//
// It was always selected and always saved — CPQ resolves it to swap parts to their finish variants,
// and the finishing floor reads it off the batch strip as "BL - BLACK". But the only thing that
// ever turned it into WORDS was RTGDispatchTab, at dispatch, by matching cpqData.configuration
// against the flow's finishes list. So the floor knew the finish and the customer's quote did not.
//
// This does that translation at CHECKOUT instead, where CPQ already holds the finish objects — so
// one field is stamped on the cart line and every downstream document reads the same string. The
// quote can no longer disagree with the floor about what colour it is.
//
// MORE THAN ONE FINISH IS NORMAL. Since the multi-material Length-step work a configuration can
// carry a metal finish AND a wood species. One label per configuration would have to drop one of
// them, so distinct finishes are listed and named by their step; identical ones collapse, because
// "BL – BLACK · BL – BLACK" tells nobody anything.

const clean = (v) => String(v ?? '').trim();

// ── UNFINISHED — A PART THAT NEVER TAKES A FINISH (Stuart 2026-09-03) ────────────────────────
// Live order 1 (ST090326-01) sent the floor a sheet reading S04 on the joiner H1-138JNR: the
// engine stamped every tab-11 extra with the configuration's finish, because "takes no finish"
// existed only as a 1.6 pin tag and an ITEM could not say it about itself. Stuart: "add the tag
// to the master library for 'unfinished' so we can tag items that the cpq/order entry will not
// apply finish to — not a lot of parts compared to the number of finished parts."
//
// So the fact lives on the ITEM (manufacturingSpecs.customData.unfinished, the Master Library
// card and 4.5 Mass Update), and this is the ONE reader every surface asks — the engine that
// prices, the pick row, the floor sheet, the labels — so no second display surface can ever
// print a finish on a joiner again.
//
// PRECEDENCE (agreed with D, the classifyLine rule): the ITEM is the truth. A line's `noFinish`
// is either a 1.6 pin fact (a clear acrylic top — authored, never stale) or a save-time copy of
// this very flag; a line's finishCode is only what the engine stamped at save. So: the item says
// unfinished → true, whatever the line was stamped with (tonight's orders read right the moment
// the joiner is tagged); else a line that says noFinish → true (the pin fact); else false. A
// line's finishCode never outranks the record it was copied from.
//
// ⚠ WHAT THE TAG MEANS (D, 2026-09-03): "this part NEVER takes a finish" — a joiner inside a rod,
// a hidden fastener — a property of the ITEM. It does NOT mean "this line was ordered raw", which
// is an ORDER fact that changes per order and belongs on the line, not here. Tag an item because
// one customer wanted it bare and every future order of it prints no finish and the floor stops
// applying one. The 4.5 column makes that a two-click mistake in bulk; do not make it.
export function takesNoFinish(part, line) {
    const cd = part && part.manufacturingSpecs && part.manufacturingSpecs.customData;
    const v = cd ? cd.unfinished : undefined;
    if (v === true || clean(v).toUpperCase() === 'TRUE') return true;
    return !!(line && line.noFinish);
}

// THE SAME PRECEDENCE, ENFORCED WHERE A LINE IS WRITTEN AND WHERE IT IS SENT (Stuart 2026-09-17:
// "it is trying to map finish codes to the hidden tag along parts" — H1-2TRVPLUG/EP4, …CLP/EP4,
// …NUT/EP4 on a display order). The display surfaces already asked takesNoFinish; the SAVE and the
// NetSuite builder did not, so a cart line stamped before its item was tagged kept the finish: the
// estimate looked for a plated SKU that will never exist, and — worse — the save stamped the line
// finishOutsourced, which sends a nut to the plater's stock check at RTG's split and can hold the
// whole order on a backorder for an item nobody makes. A line whose ITEM takes no finish loses the
// code, the label and the routing stamp, and says noFinish like any other unfinished line.
// findPart(key) → the library record by doc id / item id / our number, or null. Pure.
export function dropFinishWhereItemTakesNone(lines, findPart) {
    return (lines || []).map(l => {
        if (!l || !l.finishCode || typeof findPart !== 'function') return l;
        const part = findPart(l.partId) || findPart(l.legacyErpId);
        if (!part || !takesNoFinish(part)) return l;
        const { finishCode, finishLabel, finishOutsourced, ...rest } = l;
        return { ...rest, noFinish: true };
    });
}

// "BL – BLACK" from a finish record; falls back to whichever half exists.
export function finishText(finish) {
    if (!finish) return '';
    const code = clean(finish.code).toUpperCase();
    const name = clean(finish.name);
    if (code && name && code !== name.toUpperCase()) return `${code} – ${name}`;
    return name || code;
}

/**
 * The finishes chosen in a configuration.
 *
 * CPQ stores a step's finish under `<stepId>__finish` in dynamicConfigParams; the id resolves
 * against the global + outsourced finish pools. Pure — the caller passes both.
 *
 * @returns {Array<{stepId, stepTitle, code, name, text}>} in step order, one per finish-bearing step
 */
export function selectedFinishes(dynamicConfigParams, steps, finishPools) {
    const pool = [].concat(...(finishPools || []).filter(Boolean));
    const byId = new Map(pool.filter(f => f && f.id).map(f => [f.id, f]));
    return (steps || [])
        .map(s => {
            const fid = (dynamicConfigParams || {})[`${s.id}__finish`];
            const f = fid ? byId.get(fid) : null;
            if (!f) return null;
            return { stepId: s.id, stepTitle: clean(s.title), code: clean(f.code).toUpperCase(), name: clean(f.name), text: finishText(f) };
        })
        .filter(e => e && e.text);
}

/**
 * One line for a document header.
 *   one finish            "BL – BLACK"
 *   two, same finish      "BL – BLACK"            (collapsed — repeating it says nothing)
 *   two, different        "Pole: BL – BLACK · Wood: WHTOAK"
 * Step titles only appear when they are needed to tell the finishes apart.
 */
export function finishLabelOf(finishes) {
    const list = (finishes || []).filter(f => f && f.text);
    if (!list.length) return '';
    const distinct = [...new Set(list.map(f => f.text))];
    if (distinct.length === 1) return distinct[0];
    const seen = new Set();
    return list
        .filter(f => (seen.has(f.text) ? false : (seen.add(f.text), true)))
        .map(f => (f.stepTitle ? `${f.stepTitle}: ${f.text}` : f.text))
        .join(' · ');
}

// Read the label off a saved cart line. Prefers the stamped string, rebuilds from the stamped
// array if only that survived, and returns '' for lines saved before any of this existed — those
// quotes need a Reopen CPQ + re-save to gain one, and an empty string renders as nothing.
export const finishLabelOfItem = (item) =>
    clean(item && item.finishLabel) || finishLabelOf((item && item.finishes) || []);
