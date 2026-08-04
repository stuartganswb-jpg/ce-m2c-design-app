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
