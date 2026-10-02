// 🎨 What a swatch click applies to (Stuart 2026-10-02).   node scripts/finishScope.test.mjs
import { SCOPE, scopeTargetsOf, defaultScopeOf, scopeInForce, swatchActionOf, highlightOf } from '../src/components/Shared/finishScope.js';
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}`); };
const eq = (n, a, b) => ok(`${n} — got ${JSON.stringify(a)}`, JSON.stringify(a) === JSON.stringify(b));

// H1-2TRV as quoted: a steel end cap on the right, the acrylic end cap kit (clear top + steel collar) on the left.
const CAP = { id: 'PIN-CAP', partId: 'H1-2RCTEC', materials: ['METAL'] };
const ACRYLIC = { id: 'PIN-AEC', partId: 'H1-2RCTAEC', materials: ['CLEAR (NO FINISH)'], noFinish: true };
const COLLAR = { id: 'PIN-COL', partId: 'H1-2RCTAECC', materials: ['METAL'] };
const WOODFIN = { id: 'PIN-WGF', partId: 'H1-138WCGF', materials: ['WOOD'] };
const wearsMaterial = (c, m) => (c.materials || ['METAL']).includes(m);
const wears = (c) => !c.noFinish;
const scopes = (t) => t.map(x => x.scope);

// ── what a step offers ──────────────────────────────────────────────────────────────────────
eq('a steel cap: this part, or the whole configuration', scopes(scopeTargetsOf({ option: CAP, wears })), ['PART', 'WHOLE']);
eq('the acrylic end cap: its top is clear — the COLLAR, or the whole configuration', scopes(scopeTargetsOf({ option: ACRYLIC, collar: COLLAR, wears })), ['COLLAR', 'WHOLE']);
eq('a wood gem with its metal collar: the finial, its collar, or the whole configuration', scopes(scopeTargetsOf({ option: WOODFIN, collar: COLLAR, wears })), ['PART', 'COLLAR', 'WHOLE']);
eq('a step with no part chosen (length, a question): the whole configuration only', scopes(scopeTargetsOf({})), ['WHOLE']);
eq('a part that takes none of the finishes this flow offers is not a target', scopes(scopeTargetsOf({ option: CAP, wears: () => false })), ['WHOLE']);

// ── the default: this part only — once there is a configuration finish to depart from ───────
const none = () => '';
const metalSet = (c) => (wearsMaterial(c, 'METAL') ? 'EP2' : '');
eq('nothing picked yet on the quote: the first click sets the WHOLE configuration', defaultScopeOf({ targets: scopeTargetsOf({ option: CAP, wears }), configFinishOf: none }), SCOPE.WHOLE);
eq('a metal finish is set: on the cap\'s step a click is THIS PART ONLY', defaultScopeOf({ targets: scopeTargetsOf({ option: CAP, wears }), configFinishOf: metalSet }), SCOPE.PART);
eq('on the acrylic end\'s step it is the COLLAR only', defaultScopeOf({ targets: scopeTargetsOf({ option: ACRYLIC, collar: COLLAR, wears }), configFinishOf: metalSet }), SCOPE.COLLAR);
eq('a wood finial with no wood finish chosen yet: the whole configuration (its stain is not an exception to anything)', defaultScopeOf({ targets: scopeTargetsOf({ option: WOODFIN, collar: COLLAR, wears }), configFinishOf: metalSet }), SCOPE.WHOLE);
eq('…and once a stain is set, this part only', defaultScopeOf({ targets: scopeTargetsOf({ option: WOODFIN, collar: COLLAR, wears }), configFinishOf: (c) => (wearsMaterial(c, 'WOOD') ? 'S11' : 'EP2') }), SCOPE.PART);
eq('no part on the step', defaultScopeOf({ targets: scopeTargetsOf({}), configFinishOf: metalSet }), SCOPE.WHOLE);

// ── the operator's own switch holds for the step it was made on ─────────────────────────────
const capTargets = scopeTargetsOf({ option: CAP, wears });
eq('switched to whole configuration on this step: it stays', scopeInForce({ targets: capTargets, picked: { step: 'SLOT:RIGHT_END', scope: 'WHOLE' }, stepKey: 'SLOT:RIGHT_END', configFinishOf: metalSet }), SCOPE.WHOLE);
eq('on the next step the default is back', scopeInForce({ targets: capTargets, picked: { step: 'SLOT:RIGHT_END', scope: 'WHOLE' }, stepKey: 'SLOT:LEFT_END', configFinishOf: metalSet }), SCOPE.PART);
eq('a pick that is no longer offered falls back to the default', scopeInForce({ targets: capTargets, picked: { step: 'S', scope: 'COLLAR' }, stepKey: 'S', configFinishOf: metalSet }), SCOPE.PART);

// ── what a click does ───────────────────────────────────────────────────────────────────────
const capT = { scope: SCOPE.PART, choice: CAP }, colT = { scope: SCOPE.COLLAR, choice: COLLAR }, wholeT = { scope: SCOPE.WHOLE, choice: null };
eq('right end, this part only, EP2 → the cap alone', swatchActionOf({ target: capT, material: 'METAL', code: 'EP2', wearsMaterial }), { kind: 'PART', id: 'PIN-CAP', code: 'EP2' });
eq('left end, collar only, EP1 → the collar alone — the cap on the other end is untouched', swatchActionOf({ target: colT, material: 'METAL', code: 'EP1', wearsMaterial }), { kind: 'PART', id: 'PIN-COL', code: 'EP1' });
eq('whole configuration → the configuration\'s metal finish', swatchActionOf({ target: wholeT, material: 'METAL', code: 'EP1', wearsMaterial }), { kind: 'WHOLE', material: 'METAL', code: 'EP1' });
eq('a wood stain clicked while a steel cap is the target can only be the configuration\'s wood finish', swatchActionOf({ target: capT, material: 'WOOD', code: 'S11', wearsMaterial }), { kind: 'WHOLE', material: 'WOOD', code: 'S11' });
eq('the highlighted swatch clicked again on a part takes its exception off', swatchActionOf({ target: capT, material: 'METAL', code: '', wearsMaterial }), { kind: 'PART', id: 'PIN-CAP', code: '' });
eq('no target at all → the configuration', swatchActionOf({ material: 'METAL', code: 'P14', wearsMaterial }), { kind: 'WHOLE', material: 'METAL', code: 'P14' });

// ── what the grid highlights ────────────────────────────────────────────────────────────────
const gf = { METAL: 'EP1', WOOD: 'S11' };
const cfgOf = (c) => (wearsMaterial(c, 'METAL') ? gf.METAL : gf.WOOD);
eq('the cap has its own EP2: on its step the metal group shows EP2, the wood group the configuration\'s stain',
    [highlightOf({ target: capT, material: 'METAL', partFinish: { 'PIN-CAP': 'EP2' }, configFinishOf: cfgOf, globalFinishes: gf, wearsMaterial }), highlightOf({ target: capT, material: 'WOOD', partFinish: { 'PIN-CAP': 'EP2' }, configFinishOf: cfgOf, globalFinishes: gf, wearsMaterial })], ['EP2', 'S11']);
eq('the collar has no exception: it shows the configuration finish it is wearing', highlightOf({ target: colT, material: 'METAL', partFinish: { 'PIN-CAP': 'EP2' }, configFinishOf: cfgOf, globalFinishes: gf, wearsMaterial }), 'EP1');
eq('whole configuration: the configuration\'s own', highlightOf({ target: wholeT, material: 'METAL', partFinish: { 'PIN-CAP': 'EP2' }, configFinishOf: cfgOf, globalFinishes: gf, wearsMaterial }), 'EP1');
eq('nothing set', highlightOf({ target: wholeT, material: 'METAL' }), '');

// ── his quote, start to finish ──────────────────────────────────────────────────────────────
{
    let globalFinishes = {}, partFinish = {};
    const apply = (a) => { if (a.kind === 'PART') { const n = { ...partFinish }; if (a.code) n[a.id] = a.code; else delete n[a.id]; partFinish = n; } else { const n = { ...globalFinishes }; if (a.code) n[a.material] = a.code; else delete n[a.material]; globalFinishes = n; } };
    const cfg = (c) => (c.noFinish ? '' : (globalFinishes[(c.materials || ['METAL'])[0]] || ''));
    const click = (option, collar, code) => {
        const targets = scopeTargetsOf({ option, collar, wears });
        const scope = defaultScopeOf({ targets, configFinishOf: cfg });
        apply(swatchActionOf({ target: targets.find(t => t.scope === scope), material: 'METAL', code, wearsMaterial }));
        return scope;
    };
    const wearing = (c) => partFinish[c.id] || cfg(c);
    eq('1 · first click anywhere (EP1): the whole configuration', click(ACRYLIC, COLLAR, 'EP1'), SCOPE.WHOLE);
    eq('    both ends are EP1', [wearing(COLLAR), wearing(CAP)], ['EP1', 'EP1']);
    eq('2 · on the RIGHT end\'s step, EP2: this part only', click(CAP, null, 'EP2'), SCOPE.PART);
    eq('    the metal cap is EP2 and the acrylic end\'s collar is STILL EP1', [wearing(CAP), wearing(COLLAR)], ['EP2', 'EP1']);
    eq('3 · back on the LEFT end\'s step, EP3: the collar only', click(ACRYLIC, COLLAR, 'EP3'), SCOPE.COLLAR);
    eq('    the collar is EP3, the cap still EP2, the configuration still EP1', [wearing(COLLAR), wearing(CAP), globalFinishes.METAL], ['EP3', 'EP2', 'EP1']);
}

console.log(`finishScope: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
