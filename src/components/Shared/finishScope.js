// ── WHAT A SWATCH CLICK APPLIES TO (Stuart 2026-10-02) ───────────────────────────────────────────
// "when i change left to EP1 then right changes … this needs to work for all steps and typically does."
// It did not, and never had: the big swatch grid ALWAYS set the whole configuration, whichever step was open,
// and the "just this part" row sat at the very bottom of a long, scrolling rail — off the screen in both of
// his screenshots. His own 08-21 rule is the behaviour he was describing: "select a finish once for the whole
// configuration; select again at any part you would like in another finish."
//
// So the ONE grid serves both, and a switch at the top of the rail says which:
//   PART    this step's part only                 (default once the configuration has a finish for it)
//   COLLAR  the collar this step's finial brings   (a two-part finial — hardwareModel.companionsFor)
//   WHOLE   the whole configuration                (always there; the default until a finish exists)
// "The first finish picked still sets the whole configuration": a part the configuration has not finished yet
// is not an exception to anything, so the default stays WHOLE until there is a finish to depart from.
// A swatch the target cannot wear (a wood stain while a steel cap is the target) can only mean the
// configuration's finish for THAT material, so it sets that — the click is never thrown away.
//
// Pure — no React. The caller owns the state. Harness: scripts/finishScope.test.mjs.

export const SCOPE = { PART: 'PART', COLLAR: 'COLLAR', WHOLE: 'WHOLE' };

/**
 * The things a swatch click can apply to on this step, in the order the switch shows them.
 * @param option   the part chosen on this step (a slot's pick), or null on a step that has none
 * @param collar   the collar that part brings, or null
 * @param wears    (choice) → boolean: does this choice take ANY finish the flow offers?
 */
export function scopeTargetsOf({ option = null, collar = null, wears = () => true } = {}) {
    const out = [];
    if (option && !option.noFinish && wears(option)) out.push({ scope: SCOPE.PART, choice: option });
    if (collar && !collar.noFinish && wears(collar)) out.push({ scope: SCOPE.COLLAR, choice: collar });
    out.push({ scope: SCOPE.WHOLE, choice: null });
    return out;
}

/**
 * Which one the switch stands on before anybody touches it.
 * @param configFinishOf  (choice) → the finish the CONFIGURATION gives this choice ('' when none yet)
 */
export function defaultScopeOf({ targets = [], configFinishOf = () => '' } = {}) {
    const part = targets.find(t => t.scope === SCOPE.PART);
    if (part) return configFinishOf(part.choice) ? SCOPE.PART : SCOPE.WHOLE;
    const collar = targets.find(t => t.scope === SCOPE.COLLAR);
    if (collar && configFinishOf(collar.choice)) return SCOPE.COLLAR;
    return SCOPE.WHOLE;
}

/** The scope in force: the operator's own pick for THIS step while it is still offered, else the default. */
export function scopeInForce({ targets = [], picked = null, stepKey = '', configFinishOf } = {}) {
    if (picked && picked.step === stepKey && targets.some(t => t.scope === picked.scope)) return picked.scope;
    return defaultScopeOf({ targets, configFinishOf });
}

/**
 * What one swatch click does.
 * @param target    { scope, choice } in force
 * @param material  the swatch group's material ('METAL', 'WOOD' …)
 * @param code      the finish clicked ('' = the highlighted swatch clicked again)
 * @param wearsMaterial  (choice, material) → boolean
 * @returns { kind: 'PART', id, code } | { kind: 'WHOLE', material, code }
 */
export function swatchActionOf({ target = null, material = '', code = '', wearsMaterial = () => false } = {}) {
    const t = target && target.choice && target.scope !== SCOPE.WHOLE ? target : null;
    if (t && wearsMaterial(t.choice, material)) return { kind: 'PART', id: t.choice.id, code };
    return { kind: 'WHOLE', material, code };
}

/** The swatch a group highlights: the target's own finish where it wears this material, else the configuration's. */
export function highlightOf({ target = null, material = '', partFinish = {}, configFinishOf = () => '', globalFinishes = {}, wearsMaterial = () => false } = {}) {
    const t = target && target.choice && target.scope !== SCOPE.WHOLE ? target : null;
    if (t && wearsMaterial(t.choice, material)) return String(partFinish[t.choice.id] || configFinishOf(t.choice) || '');
    return String(globalFinishes[material] || '');
}
