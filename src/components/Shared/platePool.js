// ─────────────────────────────────────────────────────────────────────────────────────────────
// WHICH PLATES AN ARM SITS ON — the flow-option side of the rule (Stuart 2026-08-21)
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// The tag engine answers this from pins (Shared/hardwareModel: three plate pools, each arm asking
// for its own copies first). Vision answers it from a flow step's `subOptions`, which are the same
// plates wearing a different shape — and it answered it TWICE, once in the picker and once in the
// sweep that validates what is picked. The two copies drifted, and the drift had teeth:
//
//   Stuart: "when backplate choices are made, the math in the vision correctly adjusts but the
//            selection does not stick in fabrication settings so no way it can push back to cpq."
//
// The picker fell back to the plain plates when no return plate survived the size gate; the sweep
// did not. So a plate was OFFERED, chosen, read by the fabrication math — and deleted a moment
// later for not being a return plate. The drawing updated, the dropdown blanked, and the selection
// that should have pushed back to CPQ no longer existed.
//
// So it lives here, once, and both readers call it. The order matches the engine's exactly:
// each arm asks for its own copies first and borrows only where its own set does not exist.

/**
 * @param options   the step's plate options (each may carry returnOnly / inlineOnly)
 * @param flags     { returnChosen, inlineBracket } — the caller's view of what is holding the rod.
 *                  Passed IN rather than derived here because the picker reads live state while
 *                  the sweep works on an in-flight copy of the params; one rule, two vantage points.
 * @param isLive    optional per-option gate (size matrix + projection tag). Default: everything.
 */
export function platePoolFrom(options, { returnChosen = false, inlineBracket = false } = {}, isLive = null) {
    const subs = Array.isArray(options) ? options : [];
    // A collection that tags none of its plates has one pool, and it is all of them.
    if (!subs.some(o => o && (o.returnOnly || o.inlineOnly))) return subs;
    const live = typeof isLive === 'function' ? isLive : () => true;
    const rtn = subs.filter(o => o && o.returnOnly && live(o));
    const inl = subs.filter(o => o && o.inlineOnly && live(o));
    const plain = subs.filter(o => o && !o.returnOnly && !o.inlineOnly && live(o));
    // A RETURN ALWAYS MEETS THE WALL, so it falls all the way through rather than being left with
    // nothing to pick: its own plates, then the in-line copies, then the plain ones. Return plates
    // exist only at their native diameter (RBP/RCP = ¾"), which is why the last step is reachable.
    if (returnChosen) return rtn.length ? rtn : (inl.length ? inl : plain);
    // An in-line bracket is a STYLE: where its own copies do not exist it takes the return copies,
    // and where neither exists it is not given a mismatched plain plate.
    if (inlineBracket) return inl.length ? inl : rtn;
    return plain;
}

/** Is this option still on offer? The question the sweep asks before keeping a selection. */
export function plateStillOffered(pool, option) {
    if (!option) return false;
    const key = (o) => String((o.optId || o.partId) ?? '');
    return (pool || []).some(o => key(o) === key(option));
}
