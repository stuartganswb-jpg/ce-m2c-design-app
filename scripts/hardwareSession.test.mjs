// Shared/hardwareSession — the configuration without the screen (PORTAL, 2026-10-12).
//   node scripts/hardwareSession.test.mjs
//
// Two halves, the way hardwareAutoPicks.test.mjs is built. The RULES: what each piece must do. The MOVE: the CPQ
// screen's inline code as it stood before it moved to Shared/hardwareSession is kept below, verbatim, and must agree
// with the module on every set-up — of the live H1-2TRV pins, and of a small assembly that asks the rod diameter
// first — the proof that moving it changed nothing the CPQ screen does.
//
// SESSION_MODULE=<path> runs the same assertions against a mutated copy (mutation check).

import { resolve, reseatPicks, recommendedQty, bearingEnds, centreBracketsFor } from '../src/components/Shared/hardwareModel.js';
import { choicesFromAssembly, modelNodesOf } from '../src/components/Shared/hardwareAdapter.js';
import { autoPicksOf } from '../src/components/Shared/hardwareAutoPicks.js';
import { bracketAdviceFor, DEFAULT_DROP_FT } from '../src/components/Shared/bracketSpan.js';
import { carrierRows } from '../src/components/Shared/traverseConfigurator.js';
import { usageAt } from '../src/components/Shared/traverseExplode.js';
import { settleVision } from '../src/components/Shared/visionEngine.js';
import { SIZE_STEP_TYPE, sizeSelectionsOf, buildSizeIndex, sizeVariantOf, partAllowedAtSize, returnsAllowedFor, projInchesOfSel, buildSizeSteps } from '../src/components/Shared/sizeMatrix.js';
import { ENGINE_DOORS, engineClosure } from './sync-engine.mjs';
import { ASSEMBLY, PINS } from './hardwareAutoPicks.fixture.mjs';

const S = await import(process.env.SESSION_MODULE || new URL('../src/components/Shared/hardwareSession.js', import.meta.url).href);
const { partIndexOf, partIn, ourNumberOf, sizeStepsOf, sizeSelOf, sizeIndexOf, choicesAtSize, sizeProjInchesOf, answersAtSize, settle, sessionOf,
    lengthInchesOf, lengthFeetExactOf, lengthFeetOf, lengthFieldsOf, bracketAdviceOf, recommendedFor, quantitiesOf, resolvedOf } = S;

let pass = 0, fail = 0;
const eq = (n, got, want) => {
    const g = JSON.stringify(got), w = JSON.stringify(want);
    if (g === w) { pass++; return; }
    fail++; console.log(`✗ ${n}\n    got  ${String(g).slice(0, 300)}\n    want ${String(w).slice(0, 300)}`);
};
const ok = (n, c) => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}`); };
// A model holds Sets and Maps (what is visible, who owns a node) — said as plain data so two models compare whole.
const canon = (v) => JSON.stringify(v, (k, x) => (x instanceof Set ? { set: [...x].sort() } : x instanceof Map ? { map: [...x.entries()].map(([a, b]) => [a, b && b.id ? b.id : b]) } : x));

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE CPQ SCREEN'S INLINE CODE, AS IT STOOD (HardwareConfigurator.js @ 55beadf8) — verbatim, kept as the reference.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
const oldPartIndex = (parts) => {
    const m = new Map();
    parts.forEach(pt => [pt.id, pt.itemId, pt.legacyErpId].forEach(k => {
        const kk = String(k || '').trim().toUpperCase();
        if (kk && kk !== 'PENDING' && !m.has(kk)) m.set(kk, pt);
    }));
    return m;
};
const oldFindPartIn = (partIndex) => (id) => partIndex.get(String(id || '').trim().toUpperCase()) || null;
const oldOurIdWith = (findPart) => (id) => {
    const pt = findPart(id);
    const legacy = String(pt?.legacyErpId || '').trim();
    if (legacy && legacy.toUpperCase() !== 'PENDING') return legacy;
    return String(pt?.itemId || id || '').trim();
};
// sizeSteps → sizeSel → sizeIndex → choices → sizeProjInches → effAnswers, exactly the screen's memo chain.
const oldSizes = ({ assembly, pins, parts, flow, sizePick, answers, findPart }) => {
    const sizeSteps = (flow?.steps || []).filter(st => st?.type === SIZE_STEP_TYPE);
    const sizeSel = (sizeSteps.length ? sizeSelectionsOf(flow, sizePick) : null);
    const sizeIndex = (sizeSel ? buildSizeIndex(parts) : null);
    const choices = (() => {
        const raw = choicesFromAssembly(assembly, pins);
        if (!sizeSel || !sizeIndex) return raw;
        const returnsOk = returnsAllowedFor(sizeSel);
        const out = [];
        raw.forEach(c => {
            if (!returnsOk && c.role === 'RETURN') return;
            const part = findPart(c.partId);
            if (!part) { out.push(c); return; }
            if (!partAllowedAtSize(part, sizeSel, sizeIndex)) return;
            const swapped = sizeVariantOf(part, sizeSel, sizeIndex);
            out.push(swapped.swapped && swapped.part ? { ...c, partId: swapped.part.id } : c);
        });
        return out;
    })();
    const sizeProjInches = (sizeSel ? projInchesOfSel(sizeSel) : null);
    const effAnswers = (sizeProjInches != null ? { ...answers, proj: sizeProjInches } : answers);
    return { sizeSteps, sizeSel, sizeIndex, choices, sizeProjInches, effAnswers };
};
const oldModel = ({ choices, effAnswers, picks, modelNodes }) => {
    const resolvePicks = (m, raw) => reseatPicks(m, raw);
    let sel = Object.values(picks).filter(Boolean);
    let m = resolve({ choices, answers: effAnswers, selectedIds: sel, modelNodes });
    for (let pass2 = 0; pass2 < 4; pass2++) {
        const next = Object.values(resolvePicks(m, picks));
        if (next.length === sel.length && next.every(id => sel.includes(id))) break;
        sel = next;
        m = resolve({ choices, answers: effAnswers, selectedIds: sel, modelNodes });
    }
    return m;
};

// move 2 — length, the bracket advice, the counts (the memos lengthInches / advice / recommendFor / quantities / resolved)
const oldLength = (poleIn, poleFrac) => {
    const lengthInches = (() => {
        const whole = parseFloat(poleIn);
        const m = String(poleFrac).trim().match(/^(\d+)\s*\/\s*(\d+)$/);
        const frac = m ? Number(m[1]) / Number(m[2]) : (parseFloat(poleFrac) || 0);
        const total = (Number.isFinite(whole) ? whole : 0) + (Number.isFinite(frac) ? frac : 0);
        return total > 0 ? total : null;
    })();
    const lengthFeetExact = lengthInches ? Math.round((lengthInches / 12) * 100) / 100 : null;
    const lengthFeet = lengthInches ? Math.ceil(lengthInches / 12) : null;
    return { lengthInches, lengthFeetExact, lengthFeet };
};
const oldReopenLength = (s) => {            // the Edit restore, as it set the two fields
    let poleIn, poleFrac;
    if (Number(s.lengthInches) > 0) {
        const whole = Math.floor(Number(s.lengthInches));
        const frac = Number(s.lengthInches) - whole;
        poleIn = String(whole);
        poleFrac = frac > 0.001 ? `${Math.round(frac * 16)}/16` : '';
    } else { poleIn = ''; poleFrac = ''; }
    return { poleIn, poleFrac };
};
const oldCounts = ({ model, livePicks, lengthInches, lengthFeet, spanMap, spanCaps, fabricId, ourId, stepQty, trvRules, choices: chs, effAnswers, modelNodes: nodes }) => {
    const advice = (() => {
        const ids = new Set(Object.values(livePicks));
        const rod = model.choices.find(c => ids.has(c.id) && ['ROD', 'FASCIA', 'TRACK'].includes(c.role));
        if (!rod || !lengthInches) return null;
        return bracketAdviceFor({ itemCode: ourId(rod.partId) || rod.name || rod.partId, map: spanMap, caps: spanCaps, rodInches: lengthInches, fabricId, dropFt: DEFAULT_DROP_FT });
    })();
    const recommendFor = (slot, choice) => {
        if (!slot) return null;
        if (slot.kind === 'BRACKET' && String(slot.position || '').toUpperCase() === 'CENTER') {
            return advice ? centreBracketsFor(advice.brackets, bearingEnds(model.choices, Object.values(livePicks), model.slots)) : null;
        }
        return recommendedQty(choice, lengthFeet);
    };
    const quantities = (() => {
        const q = {};
        model.slots.forEach(sl => {
            const id = livePicks[sl.key];
            if (!id) return;
            const typed = Number(stepQty[sl.key]);
            if (typed > 0) { q[id] = typed; return; }
            const rec = recommendFor(sl, sl.options.find(o => o.id === id));
            if (rec != null && rec > 0) q[id] = rec;
        });
        (model.riders || []).forEach(r => {
            const row = (r.role === 'CARRIER' && lengthFeet > 0 && trvRules)
                ? carrierRows(trvRules).find(u => String(u.itemId || '').trim().toUpperCase() === String(ourId(r.partId) || '').trim().toUpperCase()) : null;
            const rec = row ? usageAt(row, Math.max(lengthFeet, 2)) : recommendedQty(r, lengthFeet);
            if (rec) q[r.id] = rec;
        });
        return q;
    })();
    const resolved = resolve({ choices: chs, answers: effAnswers, selectedIds: Object.values(livePicks), modelNodes: nodes, quantities });
    return { advice, quantities, resolved, recommendFor };
};

// ── THE RULES: how a part is found ────────────────────────────────────────────────────────────
{
    const a = { id: 'CE-INV-1', itemId: 'ce-inv-1', legacyErpId: ' h1-138be ' };
    const b = { id: 'CE-INV-2', itemId: 'CE-INV-2', legacyErpId: 'PENDING' };
    const c = { id: 'CE-INV-3', itemId: 'CE-INV-3', legacyErpId: 'H1-138BE' };       // the same number, later — the first keeps it
    const ix = partIndexOf([a, b, c]);
    ok('a part is found by its record id, its item id or OUR number, in any case', partIn(ix, 'ce-inv-1') === a && partIn(ix, ' H1-138BE') === a && partIn(ix, 'CE-INV-3') === c);
    ok('the first record to claim a number keeps it', partIn(ix, 'h1-138be') === a);
    ok("'PENDING' is nobody's number", partIn(ix, 'PENDING') === null && partIn(ix, 'pending') === null);
    ok('an unknown or empty id finds nothing', partIn(ix, 'NOPE') === null && partIn(ix, '') === null && partIn(ix, null) === null);
    ok('no parts at all is an empty index, not a crash', partIndexOf(undefined).size === 0 && partIndexOf([]).size === 0);
    eq('OUR number is legacyErpId, trimmed', ourNumberOf(a, 'CE-INV-1'), 'h1-138be');
    eq('an item not numbered yet prints its item id, never PENDING', ourNumberOf(b, 'CE-INV-2'), 'CE-INV-2');
    eq('a part the library does not hold prints what the pin said', ourNumberOf(null, ' CE-INV-9 '), 'CE-INV-9');
    eq('nothing in, nothing out', ourNumberOf(null, undefined), '');
}

// ── A SIZE WORLD: one flow that asks the rod diameter and the projection first (the real H2-RND rules, made-up codes) ──
const DIAS = ['05', '75', '1', '138'];
const sizeParts = [];
const mk = (code, base, extra = {}) => ({ id: `ID-${code}`, itemId: `ID-${code}`, legacyErpId: code, itemName: code, partClass: 'Inventory', manufacturingSpecs: { basePrice: base }, ...extra });
const fam = (style, base, only = DIAS) => only.forEach(d => sizeParts.push(mk(`H2-${d}${style}`, base)));
fam('R', 12); fam('F', 30); fam('AF', 55, ['138']); fam('BE', 22); fam('BP', 6, ['75', '1', '138']);
sizeParts.push(mk('H2-MRF', 40, { partClass: 'Fee' }));
const cl = (id, category, position) => ({ id, name: id, category, position, location: 'WALL', nodes: [`${id}_mesh`] });
const SIZE_ASM = { id: 'ASM-SIZE', itemName: 'H2-SIZE', nodeClusters: [cl('C-ROD', 'POLE', 'CENTER'), cl('C-FL', 'FINIAL', 'LEFT'), cl('C-BL', 'BRACKET', 'LEFT'), cl('C-PL', 'BACKPLATE', 'LEFT')] };
let pinNo = 0;
const pin = (clusterId, code, extra = {}) => ({ id: `PIN-${++pinNo}-${code}`, assemblyId: 'ASM-SIZE', clusterId, partId: `ID-${code}`, partName: code, targetNode: `${clusterId}_mesh`, defaultQty: 1, choiceSort: pinNo, ...extra });
const SIZE_PINS = [
    pin('C-ROD', 'H2-75R'), pin('C-FL', 'H2-75F', { endTreatment: 'FINIAL' }), pin('C-FL', 'H2-138AF', { endTreatment: 'FINIAL' }), pin('C-FL', 'H2-MRF', { endTreatment: 'MITER_RETURN' }),
    pin('C-BL', 'H2-75BE', { projInches: '3.625' }), pin('C-BL', 'H2-75BE', { projInches: '4.625' }), pin('C-BL', 'H2-75BE', { projInches: '6' }),
    pin('C-PL', 'H2-75BP'), pin('C-PL', 'NOT-IN-LIBRARY'),
];
const SIZE_FLOW = { id: 'FLOW-SIZE', steps: buildSizeSteps('H2-RND') };
const sizeFind = (id) => partIn(partIndexOf(sizeParts), id);
const at = (dia, proj) => {
    const sizePick = { ...(dia ? { 'SIZE-DIA': `SIZE-DIA-${dia}` } : {}), ...(proj ? { 'SIZE-PROJ': `SIZE-PROJ-${proj}` } : {}) };
    const sizeSteps = sizeStepsOf(SIZE_FLOW);
    const sizeSel = sizeSelOf(SIZE_FLOW, sizePick, sizeSteps);
    const sizeIndex = sizeIndexOf(sizeSel, sizeParts);
    return { sizePick, sizeSel, sizeIndex, choices: choicesAtSize({ assembly: SIZE_ASM, pins: SIZE_PINS, sizeSel, sizeIndex, findPart: sizeFind }), proj: sizeProjInchesOf(sizeSel) };
};
const codesOf = (choices) => choices.map(c => (sizeFind(c.partId) || {}).legacyErpId || c.partId);
{
    eq('the size steps are the flow\'s SIZE_SELECT steps, and only those', sizeStepsOf({ steps: [{ type: 'STYLE_SWAP' }, ...SIZE_FLOW.steps, null] }).map(s => s.id), ['SIZE-DIA', 'SIZE-PROJ']);
    ok('a flow with no size steps has no size selection, no index', sizeSelOf({ steps: [] }, {}, []) === null && sizeIndexOf(null, sizeParts) === null && sizeProjInchesOf(null) === null);
    const plain = choicesAtSize({ assembly: SIZE_ASM, pins: SIZE_PINS, sizeSel: null, sizeIndex: null, findPart: sizeFind });
    eq('…and its choices are the pins as tagged, untouched', plain, choicesFromAssembly(SIZE_ASM, SIZE_PINS));
    const answers = { rodKind: 'SOLID' };
    ok('…and its answers are the SAME object — nothing to re-render', answersAtSize(answers, null) === answers);
    eq('an unanswered size quotes the family\'s base cell (3/4" × 4-5/8")', [at().sizeSel.dia, at().sizeSel.proj, at().proj], ['75', 'E', 4.625]);
    eq('at 1-3/8" every part is the 1-3/8" item — the swap is on the CHOICE', codesOf(at('138', 'E').choices).filter(c => /^H2-/.test(c)).every(c => /^H2-138|^H2-MRF/.test(c)), true);
    const asTagged = new Map(choicesFromAssembly(SIZE_ASM, SIZE_PINS).map(c => [c.id, c]));
    ok('…and nothing else about the choice moves — its id, its nodes, its tags (the render is the master, scaled)',
        DIAS.every(d => at(d, 'E').choices.every(c => JSON.stringify({ ...c, partId: '' }) === JSON.stringify({ ...asTagged.get(c.id), partId: '' }))));
    ok('a part made only at 1-3/8" is offered there', codesOf(at('138', 'E').choices).includes('H2-138AF'));
    ok('…and nowhere else', !codesOf(at('1', 'E').choices).some(c => /AF$/.test(c)) && !codesOf(at('05', 'S').choices).some(c => /AF$/.test(c)));
    ok('a return needs depth: offered at 4-5/8", not at 3-5/8"', at('75', 'E').choices.some(c => c.role === 'RETURN') && !at('75', 'S').choices.some(c => c.role === 'RETURN'));
    ok('no 1/2" plate exists, so the plate stays the base item rather than vanishing', codesOf(at('05', 'S').choices).includes('H2-75BP'));
    ok('a part the library does not hold passes through for the diagnostics', at('1', 'E').choices.some(c => c.partId === 'ID-NOT-IN-LIBRARY'));
    eq('the matrix answers the projection: 3-5/8, 4-5/8, 6', [at('75', 'S').proj, at('75', 'E').proj, at('138', '6').proj], [3.625, 4.625, 6]);
    eq('a projection the diameter does not make is healed (6" at 3/4" → 4-5/8")', at('75', '6').sizeSel.proj, 'E');
    const eff = answersAtSize(answers, 6);
    ok('the matrix\'s projection overrides the engine\'s own, on a copy', eff.proj === 6 && eff.rodKind === 'SOLID' && answers.proj === undefined);
}

// ── THE MOVE, sizes: the module against the screen's old memo chain, every diameter × projection ──────────────
{
    let compared = 0, differ = 0;
    const picksList = [{}, ...DIAS.flatMap(d => ['P75', 'S', 'E', '6'].map(p => ({ 'SIZE-DIA': `SIZE-DIA-${d}`, 'SIZE-PROJ': `SIZE-PROJ-${p}` }))), { 'SIZE-DIA': 'SIZE-DIA-138' }, { 'SIZE-PROJ': 'SIZE-PROJ-S' }, { 'SIZE-DIA': 'nonsense' }];
    for (const flow of [SIZE_FLOW, { id: 'no-size', steps: [] }, null]) {
        for (const sizePick of picksList) {
            for (const answers of [{}, { rodKind: 'SOLID', proj: 3.625 }]) {
                const oldFind = oldFindPartIn(oldPartIndex(sizeParts));
                const o = oldSizes({ assembly: SIZE_ASM, pins: SIZE_PINS, parts: sizeParts, flow, sizePick, answers, findPart: oldFind });
                const sizeSteps = sizeStepsOf(flow);
                const sizeSel = sizeSelOf(flow, sizePick, sizeSteps);
                const sizeIndex = sizeIndexOf(sizeSel, sizeParts);
                const n = { sizeSteps, sizeSel, sizeIndex, choices: choicesAtSize({ assembly: SIZE_ASM, pins: SIZE_PINS, sizeSel, sizeIndex, findPart: sizeFind }), sizeProjInches: sizeProjInchesOf(sizeSel) };
                n.effAnswers = answersAtSize(answers, n.sizeProjInches);
                compared++;
                if (canon(o) !== canon(n) || (o.effAnswers === answers) !== (n.effAnswers === answers)) differ++;
            }
        }
    }
    eq(`sizes: the module agrees with the old inline code on every size (${compared} compared)`, differ, 0);
}

// ── THE MOVE, the settle: the live H1-2TRV pins, every framing, picks that agree and picks a later answer overturns ──
const choices = choicesFromAssembly(ASSEMBLY, PINS);
const modelNodes = modelNodesOf(ASSEMBLY);
const modelOf = (answers, picks) => resolve({ choices, answers, selectedIds: Object.values(picks).filter(Boolean), modelNodes });
const framings = [];
(function walk(answers) {
    const open = modelOf(answers, {}).axes.find(a => !a.implied && a.values.length > 1 && answers[a.key] == null);
    if (!open) { framings.push(answers); return; }
    open.values.forEach(v => walk({ ...answers, [open.key]: v }));
})({});
const rng = (seed) => { let h = 2166136261; for (const ch of String(seed)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 100000) / 100000; }; };
const picksFor = (answers, seed) => {
    const rand = rng(seed); let picks = {};
    for (let guard = 0; guard < 40; guard++) {
        const m = modelOf(answers, picks);
        picks = reseatPicks(m, picks);
        const slot = m.slots.find(s => !picks[s.key] && s.options.length && !s.suppressedBy);
        if (!slot) break;
        picks[slot.key] = slot.options[Math.floor(rand() * slot.options.length)].id;
    }
    return picks;
};
{
    ok(`the fixture offers real framings to walk (${framings.length})`, framings.length >= 8);
    let compared = 0, differ = 0, vision = 0, moved = 0, onePassWrong = 0;
    framings.forEach((answers, fi) => {
        for (let v = 0; v < 4; v++) {
            const agree = picksFor(answers, `${fi}|${v}`);
            // the same parts under the NEXT framing's answers, and under one answer changed — picks a later choice overturns
            const sets = [[answers, agree], [framings[(fi + 1) % framings.length], agree], [{ ...answers, proj: answers.proj === 6 ? 3.625 : 6 }, agree], [answers, {}]];
            for (const [ans, picks] of sets) {
                const o = oldModel({ choices, effAnswers: ans, picks, modelNodes });
                const n = settle({ choices, answers: ans, picks, modelNodes });
                compared++;
                if (canon(o) !== canon(n)) differ++;
                if (canon(settleVision({ choices, answers: ans, picks, modelNodes }).model) !== canon(n)) vision++;
                const live = reseatPicks(n, picks);
                if (Object.keys(picks).some(k => live[k] !== picks[k])) moved++;
                if (canon(modelOf(ans, picks)) !== canon(n)) onePassWrong++;
            }
        }
    });
    eq(`settle: the module agrees with the old inline loop on every set-up (${compared} compared)`, differ, 0);
    eq('…and with Vision\'s own copy of the same loop (Shared/visionEngine.settleVision)', vision, 0);
    ok(`the set-ups really overturn picks — in ${moved} a pick was removed or moved to its twin`, moved > 20);
    ok(`…and settling matters: in ${onePassWrong} of them one pass over the raw picks gives a different model`, onePassWrong > 0);
    const calm = picksFor(framings[0], 'calm');
    eq('nothing to drop → exactly the one resolve it always was', canon(settle({ choices, answers: framings[0], picks: calm, modelNodes })), canon(modelOf(framings[0], calm)));
    eq('nothing picked → the open model', canon(settle({ choices, answers: {}, picks: {}, modelNodes })), canon(modelOf({}, {})));
    eq('an un-pick (a blank) is not a pick', canon(settle({ choices, answers: framings[0], picks: { ...calm, 'RING|FRONT|SHARED': '' }, modelNodes })), canon(settle({ choices, answers: framings[0], picks: Object.fromEntries(Object.entries(calm).filter(([k]) => k !== 'RING|FRONT|SHARED')), modelNodes })));
}

// ── THE RULES: length ─────────────────────────────────────────────────────────────────────────
{
    eq('whole inches and a fraction, typed the way an installer measures', [lengthInchesOf('96', '1/2'), lengthInchesOf('96', ' 3 / 16 '), lengthInchesOf('96.25', ''), lengthInchesOf('', '7/8'), lengthInchesOf('90', '0.5')], [96.5, 96.1875, 96.25, 0.875, 90.5]);
    eq('nothing typed, or nothing that is a length, is no length', [lengthInchesOf('', ''), lengthInchesOf('abc', 'x'), lengthInchesOf('0', '0'), lengthInchesOf(undefined, undefined)], [null, null, null, null]);
    eq('WE BILL IN FULL FEET, ROUNDED UP — a quarter inch over is the next foot', [lengthFeetOf(96), lengthFeetOf(96.25), lengthFeetOf(90.5), lengthFeetOf(0.875), lengthFeetOf(null)], [8, 9, 8, 1, null]);
    eq('the exact feet beside it, to the hundredth', [lengthFeetExactOf(90.5), lengthFeetExactOf(96), lengthFeetExactOf(null)], [7.54, 8, null]);
    eq('a saved length goes back into whole inches and sixteenths', [lengthFieldsOf(96), lengthFieldsOf(96.5), lengthFieldsOf(96.3), lengthFieldsOf('120.25'), lengthFieldsOf(95.99)], [{ poleIn: '96', poleFrac: '' }, { poleIn: '96', poleFrac: '8/16' }, { poleIn: '96', poleFrac: '5/16' }, { poleIn: '120', poleFrac: '4/16' }, { poleIn: '95', poleFrac: '16/16' }]);
    eq('…and no saved length is two empty fields', [lengthFieldsOf(0), lengthFieldsOf(null), lengthFieldsOf('x'), lengthFieldsOf(-4)], Array(4).fill({ poleIn: '', poleFrac: '' }));
    const back = (x) => { const f = lengthFieldsOf(x); return lengthInchesOf(f.poleIn, f.poleFrac); };
    eq('a length in sixteenths comes back exactly; anything finer comes back as the nearest sixteenth', [back(96), back(60.5), back(119.9375), back(96.3), back(95.99)], [96, 60.5, 119.9375, 96.3125, 96]);
}

// ── THE MOVE, length: every way the two fields can be typed, and every saved length ──────────────────────────
{
    let compared = 0, differ = 0;
    const ins = ['', '0', '36', '96', '96.25', '119', 'abc', ' 120 ', '-5', undefined, null, 144];
    const fracs = ['', '1/2', '15/16', ' 3 / 8 ', '0.5', '16/16', 'x', '1/0', undefined, null, 0.25];
    for (const a of ins) for (const b of fracs) {
        const n = { lengthInches: lengthInchesOf(a, b) }; n.lengthFeetExact = lengthFeetExactOf(n.lengthInches); n.lengthFeet = lengthFeetOf(n.lengthInches);
        compared++; if (canon(oldLength(a, b)) !== canon({ lengthInches: n.lengthInches, lengthFeetExact: n.lengthFeetExact, lengthFeet: n.lengthFeet })) differ++;
    }
    for (const L of [0, null, undefined, '', 'x', -3, 36, 60.5, 96, 96.3, '120.25', 119.9375, 95.99, 132.25, 180, 0.0005, 1e6]) {
        compared++; if (canon(oldReopenLength({ lengthInches: L })) !== canon(lengthFieldsOf(L))) differ++;
    }
    eq(`length: the module agrees with the old inline code (${compared} compared)`, differ, 0);
}

// ── THE RULES + THE MOVE, counts: the live H1-2TRV pins at varied lengths, fabric weights, typed counts ────────
{
    const SPAN = { 'H1-ALU2': 'H1-2RCTAR, H1-2RCTWR, H1-2RCTACR' };
    const CAPS = { 'H1-ALU2': { maxSpan: 48 } };
    const RULES = { usage: [{ label: 'Pinch Pleat Carriers', itemId: 'HTSLNTCAR', byFeet: { 2: 8, 4: 16, 6: 24, 8: 32, 12: 48 } }, { label: 'Wall brackets', itemId: 'H1-2TRV-WB', byFeet: { 4: 2 } }], configurator: [] };
    const parts = [...new Map(PINS.map(p => [p.partId, { id: p.partId, itemId: p.partId, legacyErpId: p.legacyErpId || p.partName, itemName: p.partName }])).values()];
    const ix = partIndexOf(parts); const find = (id) => partIn(ix, id); const ourId = (id) => ourNumberOf(find(id), id);
    let compared = 0, differ = 0, withAdvice = 0, charted = 0, typedWins = 0, centre = 0;
    framings.forEach((answers, fi) => {
        for (let v = 0; v < 3; v++) {
            const picks = picksFor(answers, `counts|${fi}|${v}`);
            const model = settle({ choices, answers, picks, modelNodes });
            const { livePicks } = autoPicksOf({ model, answers, operatorPicks: reseatPicks(model, picks) });
            const countable = model.slots.filter(sl => livePicks[sl.key] && (sl.kind === 'RING' || sl.kind === 'BRACKET'));
            for (const L of [null, 18, 60.5, 96, 144.25]) {
                for (const world of [{ spanMap: {}, spanCaps: {}, trvRules: null }, { spanMap: SPAN, spanCaps: {}, trvRules: RULES }, { spanMap: SPAN, spanCaps: CAPS, trvRules: RULES }]) {
                    for (const fabricId of ['PRINT', 'BLACKOUT']) {
                        const stepQty = (v === 2 && countable.length) ? { [countable[0].key]: '7', [countable[countable.length - 1].key]: '0' } : {};
                        const f = lengthFieldsOf(L); const lengthInches = lengthInchesOf(f.poleIn, f.poleFrac); const lengthFeet = lengthFeetOf(lengthInches);
                        const o = oldCounts({ model, livePicks, lengthInches, lengthFeet, ...world, fabricId, ourId, stepQty, choices, effAnswers: answers, modelNodes });
                        const advice = bracketAdviceOf({ model, livePicks, lengthInches, spanMap: world.spanMap, spanCaps: world.spanCaps, fabricId, ourId });
                        const recommendFor = (slot, choice) => recommendedFor({ slot, choice, advice, model, livePicks, lengthFeet });
                        const quantities = quantitiesOf({ model, livePicks, stepQty, lengthFeet, recommendFor, trvRules: world.trvRules, ourId });
                        const resolved = resolvedOf({ choices, answers, livePicks, modelNodes, quantities });
                        compared++;
                        if (canon(o.advice) !== canon(advice) || canon(o.quantities) !== canon(quantities) || canon(o.resolved) !== canon(resolved)
                            || model.slots.some(sl => o.recommendFor(sl, sl.options[0]) !== recommendFor(sl, sl.options[0])) || o.recommendFor(null) !== recommendFor(null)) differ++;
                        if (advice) withAdvice++;
                        if (world.trvRules && (model.riders || []).some(r => r.role === 'CARRIER' && quantities[r.id] === usageAt(RULES.usage[0], Math.max(lengthFeet, 2)) && lengthFeet > 0)) charted++;
                        if (stepQty[countable[0]?.key] && quantities[livePicks[countable[0].key]] === 7) typedWins++;
                        if (advice && model.slots.some(sl => sl.kind === 'BRACKET' && String(sl.position || '').toUpperCase() === 'CENTER' && quantities[livePicks[sl.key]] > 1)) centre++;
                    }
                }
            }
        }
    });
    eq(`counts: the module agrees with the old inline code on every set-up (${compared} compared)`, differ, 0);
    ok(`the set-ups reach the rules: a span recommendation in ${withAdvice}, the carriers chart in ${charted}, a typed count winning in ${typedWins}, more than one centre bracket in ${centre}`, withAdvice > 50 && charted > 20 && typedWins > 20 && centre > 5);
    const model = settle({ choices, answers: framings[0], picks: {}, modelNodes });
    eq('no rod chosen, or no length → no recommendation, honestly', [bracketAdviceOf({ model, livePicks: {}, lengthInches: 96, spanMap: SPAN, spanCaps: {}, fabricId: 'PRINT', ourId }), recommendedFor({ slot: null })], [null, null]);
    eq('a centre bracket with no span to go on is not guessed', recommendedFor({ slot: { kind: 'BRACKET', position: 'center' }, choice: {}, advice: null, model, livePicks: {}, lengthFeet: 8 }), null);
}

// ── THE WHOLE CALL: what a caller that is not a screen gets ───────────────────────────────────────────────
{
    let compared = 0, differ = 0;
    framings.forEach((answers, fi) => {
        const picks = picksFor(answers, `whole|${fi}`);
        for (const [ans, pk] of [[answers, picks], [framings[(fi + 1) % framings.length], picks]]) {
            const s = sessionOf({ assembly: ASSEMBLY, pins: PINS, parts: [], flow: null }, { answers: ans, picks: pk });
            const model = oldModel({ choices, effAnswers: ans, picks: pk, modelNodes });
            const auto = autoPicksOf({ model, answers: ans, operatorPicks: reseatPicks(model, pk) });
            compared++;
            if (canon(s.model) !== canon(model) || canon(s.livePicks) !== canon(auto.livePicks) || canon([...s.settledKeys].sort()) !== canon([...auto.settledKeys].sort()) || canon(s.choices) !== canon(choices)) differ++;
        }
    });
    eq(`sessionOf: the one call gives what the screen's memos give, in order (${compared} compared)`, differ, 0);
    const sized = sessionOf({ assembly: SIZE_ASM, pins: SIZE_PINS, parts: sizeParts, flow: SIZE_FLOW }, { answers: { proj: 3.625 }, picks: {}, sizePick: { 'SIZE-DIA': 'SIZE-DIA-138', 'SIZE-PROJ': 'SIZE-PROJ-6' } });
    eq('sessionOf sizes the choices and lets the matrix answer the projection', [sized.sizeSel.dia, sized.effAnswers.proj, sized.choices.find(c => c.role === 'ROD').partId, sized.ourId(sized.choices.find(c => c.role === 'ROD').partId)], ['138', 6, 'ID-H2-138R', 'H2-138R']);
    const withLength = sessionOf({ assembly: ASSEMBLY, pins: PINS, parts: [] }, { answers: framings[0], picks: picksFor(framings[0], 'len'), lengthInches: 96.3, stepQty: {}, fabricId: 'BLACKOUT' });
    eq('sessionOf reads a saved length the way Edit restores it — 96.3" is 96 5/16", nine feet billed', [withLength.lengthInches, withLength.lengthFeet, withLength.lengthFeetExact], [96.3125, 9, 8.03]);
    ok('…and the counts are on the resolved configuration', Object.keys(withLength.quantities).length > 0 && canon(withLength.resolved) === canon(resolvedOf({ choices: withLength.choices, answers: withLength.effAnswers, livePicks: withLength.livePicks, modelNodes: withLength.modelNodes, quantities: withLength.quantities })));
    const empty = sessionOf();
    ok('called with nothing it answers with nothing, not a crash', Array.isArray(empty.choices) && empty.choices.length === 0 && Object.keys(empty.livePicks).length === 0);
}

// ── IT IS PART OF THE ENGINE: copied to the portal's server, held to the engine's one import rule ─────────────
{
    const { files, problems } = engineClosure();
    eq('the session is one of the engine\'s doors', ENGINE_DOORS['hardwareSession.js'], 'sessionOf');
    ok('…reached, and breaking no rule (pure: only the files beside it, with their .js)', files.has('hardwareSession.js') && problems.length === 0);
}

console.log(fail ? `\n❌  ${pass} passed, ${fail} failed` : `\n✅  ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
