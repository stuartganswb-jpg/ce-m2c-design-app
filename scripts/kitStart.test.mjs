// "Start from a kit" moved out of CPQ's screen into Shared/kitStart (2026-10-20 — Stuart: "the traverse kits needs to behave the same
// cpq in the app"), so the customer portal starts a kit exactly as CPQ does.   node scripts/kitStart.test.mjs
//
// CPQ's OWN inline code, as it stood before the move, is kept below verbatim as the reference (CPQTab seedableKits / kitSeedDiag,
// HardwareConfigurator applyKit + its kit-bracket effect). Every function of the module is held against it.
import { kitsForFlowOf, unalignedKitsForFlowOf, kitMatcherOf, kitIdOf, kitStartOf, kitFillsOf, kitAsItsCodeSays } from '../src/components/Shared/kitStart.js';
import { kitsForSeeding, seedFromKit } from '../src/components/Shared/kitSeed.js';
import { kitBracketPicksOf, kitBracketSummary } from '../src/components/Shared/kitBracketPicks.js';
import { sessionOf } from '../src/components/Shared/hardwareSession.js';
import { ASSEMBLY, PINS } from './hardwareAutoPicks.fixture.mjs';

let pass = 0, fail = 0;
const eq = (n, a, b) => { if (JSON.stringify(a) === JSON.stringify(b)) { pass++; return; } fail++; console.log(`✗ ${n}\n    got  ${JSON.stringify(a).slice(0, 300)}\n    want ${JSON.stringify(b).slice(0, 300)}`); };

// ── THE REFERENCE: CPQ's code before the move, verbatim (bodies only; React state replaced by return values) ──
const oldSeedableKits = ({ activeAssembly, flowDoc, kitLibrary }) => {
    const a = activeAssembly;
    if (!a) return [];
    const base = String((a.legacyErpId && a.legacyErpId !== 'PENDING' ? a.legacyErpId : '') || a.itemName || a.itemId || '').trim().toUpperCase();
    const famFlow = String(flowDoc?.kitFamily || '').trim().toUpperCase();
    if (!base && !famFlow) return [];
    const baseFam = base.includes(' — ') ? base.split(' — ')[0].trim() : (base.includes(' - ') ? base.split(' - ')[0].trim() : '');
    const matches = (k) => {
        const kf = String(k.manufacturingSpecs?.kitFamily || '').trim().toUpperCase();
        if (famFlow && kf === famFlow) return true;
        if (kf && base && kf === base) return true;
        if (kf && baseFam && kf === baseFam) return true;
        const code = String(k.legacyErpId || k.itemName || '').trim().toUpperCase();
        if (base && (code === base || code.startsWith(base + '-'))) return true;
        return !!baseFam && (code === baseFam || code.startsWith(baseFam + '-'));
    };
    return kitsForSeeding(kitLibrary).filter(matches);
};
const oldKitSeedDiag = ({ activeAssembly, flowDoc, kitLibrary }) => {
    const a = activeAssembly;
    const base = a ? String((a.legacyErpId && a.legacyErpId !== 'PENDING' ? a.legacyErpId : '') || a.itemName || a.itemId || '').trim().toUpperCase() : '';
    const famFlow = String(flowDoc?.kitFamily || '').trim().toUpperCase();
    const baseFam = base.includes(' — ') ? base.split(' — ')[0].trim() : (base.includes(' - ') ? base.split(' - ')[0].trim() : '');
    const match = (k) => {
        const kf = String(k.manufacturingSpecs?.kitFamily || '').trim().toUpperCase();
        if (famFlow && kf === famFlow) return true;
        if (kf && base && kf === base) return true;
        if (kf && baseFam && kf === baseFam) return true;
        const code = String(k.legacyErpId || k.itemName || '').trim().toUpperCase();
        if (base && (code === base || code.startsWith(base + '-'))) return true;
        return !!baseFam && (code === baseFam || code.startsWith(baseFam + '-'));
    };
    return { base, famFlow, unaligned: base ? kitLibrary.filter(k => !k.manufacturingSpecs?.kitAlign).filter(match).length : 0 };
};
// applyKit: what it set (answers / picks merged, the length, the report, the kit in hand, armed)
const oldApplyKit = ({ id, kits, model, poleIn }) => {
    const out = { kitPick: id, kitMotor: '', armed: false, answers: null, picks: null, poleIn: null, report: null, kitSource: undefined };
    if (!id) { out.report = null; out.kitSource = null; return out; }
    const chosen = kits.find(k => String(k.id || k.legacyErpId || '') === id);
    if (!chosen) return out;
    const name = String(chosen.legacyErpId || chosen.itemName || 'the kit');
    const seed = seedFromKit({ model, kit: chosen });
    if (seed.blocked) { out.report = { name, blocked: seed.blocked, carried: [], missed: [] }; out.kitSource = null; return out; }
    if (Object.keys(seed.answers).length) out.answers = seed.answers;
    if (Object.keys(seed.picks).length) out.picks = seed.picks;
    if (seed.lengthInches && !String(poleIn || '').trim()) out.poleIn = String(Math.floor(seed.lengthInches));
    const fills = kitBracketSummary({ kit: chosen });
    out.report = { name, blocked: null, carried: fills ? [...seed.carried, fills] : seed.carried, missed: fills ? seed.missed.filter(m => m.what !== 'bracket style') : seed.missed };
    out.armed = true;
    out.kitSource = { code: name, name: chosen.itemName || name, baseFeet: Number(chosen.manufacturingSpecs.kitAlign.minFeet) || 4, record: chosen };
    return out;
};
const oldEffectAdd = ({ model, kitSource, effAnswers, livePicks, ourId, recommendFor, done }) => kitBracketPicksOf({ model, kit: kitSource.record, answers: effAnswers, livePicks,
    codeOf: (o) => ourId(o.partId) || o.name, done,
    wants: (slot) => String(slot.position || '').toUpperCase() !== 'CENTER' || recommendFor(slot) > 0 });
// …the same through the new module, shaped the way the screen applies it
const newApplyKit = ({ id, kits, model, poleIn }) => {
    const out = { kitPick: id, kitMotor: '', armed: false, answers: null, picks: null, poleIn: null, report: null, kitSource: undefined };
    if (!id) { out.report = null; out.kitSource = null; return out; }
    const chosen = kits.find(k => kitIdOf(k) === id);
    if (!chosen) return out;
    const start = kitStartOf({ model, kit: chosen, lengthTyped: !!String(poleIn || '').trim() });
    if (start.blocked) { out.report = start.report; out.kitSource = null; return out; }
    if (Object.keys(start.answers).length) out.answers = start.answers;
    if (Object.keys(start.picks).length) out.picks = start.picks;
    if (start.lengthInches) out.poleIn = String(Math.floor(start.lengthInches));
    out.report = start.report;
    out.armed = true;
    out.kitSource = start.kitSource;
    return out;
};

// ── 1. WHICH KITS: every assembly spelling × every flow tag × a library of kits spelled every way ──
const assemblies = [null, { legacyErpId: 'H1-2TRV' }, { legacyErpId: 'H1-2TRV — GENERATED' }, { legacyErpId: 'PENDING', itemName: 'H1-138' }, { legacyErpId: '', itemName: 'h1-138 - generated' },
    { itemId: 'CE-ASM-1' }, { legacyErpId: ' h1-75s ' }, { legacyErpId: 'H1-2TRV-SOMETHING' }, { legacyErpId: '', itemName: '', itemId: '' }];
const flows = [null, {}, { kitFamily: 'h1-2trv' }, { kitFamily: 'H1-138TRV' }, { kitFamily: ' H1-75S ' }, { kitFamily: 'CE-ASM-1787667238456' }];
const align = { setup: 'SINGLE', drive: 'MANUAL', mount: 'WALL', minFeet: 4 };
const k = (id, code, fam, al = align, extra = {}) => ({ id, legacyErpId: code, itemName: `Kit ${code}`, partClass: 'Kit', manufacturingSpecs: { ...(fam !== undefined ? { kitFamily: fam } : {}), ...(al ? { kitAlign: al } : {}) }, ...extra });
const LIB = [k('A', 'H1-2TRV-4/P', 'H1-2TRV'), k('B', 'H1-2TRV-4M/P', 'h1-2trv '), k('C', 'H1-138TRV-4H/P', 'H1-138TRV'), k('D', 'H1-2TRV-4X/P', 'H1-2TRV', null), k('E', 'H1-138-KIT', undefined),
    k('F', 'H1-2TRV', undefined), k('G', 'H1-2TRVX-4', undefined), k('H', 'H1-75S-4/P', 'H1-75S'), k('', 'NO-ID-KIT', 'H1-2TRV'), k('I', '', 'H1-2TRV', align, { itemName: 'H1-2TRV-NAMED' }),
    k('J', 'H1-138-4/P', undefined, null), { id: 'NOTKIT', legacyErpId: 'H1-2TRV-4/W', partClass: 'Inventory', manufacturingSpecs: { kitFamily: 'H1-2TRV', kitAlign: align } }, k('K', 'CE-ASM-1-4', undefined)];
let combos = 0, nonEmpty = 0;
assemblies.forEach((activeAssembly, ai) => flows.forEach((flowDoc, fi) => {
    combos++;
    const want = oldSeedableKits({ activeAssembly, flowDoc, kitLibrary: LIB }).map(kitIdOf);
    const got = kitsForFlowOf(LIB, { assembly: activeAssembly, flow: flowDoc }).map(kitIdOf);
    if (want.length) nonEmpty++;
    eq(`the kits a flow offers — assembly #${ai} × flow #${fi}`, got, want);
    const d = oldKitSeedDiag({ activeAssembly, flowDoc, kitLibrary: LIB });
    const m = kitMatcherOf({ assembly: activeAssembly, flow: flowDoc });
    eq(`…the diagnostic (what was matched against, the unaligned count) — #${ai} × #${fi}`, [m.base, m.famFlow, unalignedKitsForFlowOf(LIB, { assembly: activeAssembly, flow: flowDoc })], [d.base, d.famFlow, d.unaligned]);
}));
eq(`…${combos} combinations, ${nonEmpty} of them offering kits (the comparison is not vacuous)`, nonEmpty > 10, true);
eq('nothing, nothing to offer', [kitsForFlowOf(), unalignedKitsForFlowOf(), kitsForFlowOf(null, {})], [[], 0, []]);

// ── 2. WHAT PICKING ONE FILLS IN, and 3. ITS BRACKETS — on the real engine's traverse model ──
const parts = [...new Map(PINS.map(pn => [pn.partId, { id: pn.partId, legacyErpId: pn.legacyErpId || pn.partName, itemName: pn.partName, partClass: 'Inventory' }])).values()];
const data = { assembly: ASSEMBLY, pins: PINS, parts };
const kit = (id, code, al, family = 'H1-2TRV') => ({ id, legacyErpId: code, itemName: `System ${code}`, partClass: 'Kit', manufacturingSpecs: { kitFamily: family, kitAlign: { frontRail: 'TRACK', material: 'P', minFeet: 4, ...al } } });
const KITS = [kit('K-4P', 'H1-2TRV-4/P', { setup: 'SINGLE', drive: 'MANUAL', mount: 'WALL' }), kit('K-4MP', 'H1-2TRV-4M/P', { setup: 'SINGLE', drive: 'MOTORIZED', mount: 'WALL' }),
    kit('K-4D', 'H1-2TRV-4D/P', { setup: 'DOUBLE', drive: 'MANUAL', mount: 'WALL' }), kit('K-4C', 'H1-2TRV-4C/P', { setup: 'SINGLE', drive: 'MANUAL', mount: 'CEILING' }),
    kit('K-4DR', 'H1-2TRV-4DR/P', { setup: 'DOUBLE', drive: 'MANUAL', mount: 'WALL', frontRail: 'RING' }), kit('K-6FT', 'H1-2TRV-6/P', { setup: 'SINGLE', drive: 'MANUAL', mount: 'WALL', minFeet: 6 }),
    kit('K-SOLID', 'H1-2TRV-S/P', { rodKind: 'SOLID', setup: 'SINGLE' }), kit('K-4V', 'H1-2TRV-4V/P', { setup: 'SINGLE', drive: 'MANUAL', mount: 'WALL', bracketStyle: 'V' }), kit('K-NOPE', 'H1-2TRV-X/P', { setup: 'TRIPLE' }), { id: 'K-NOALIGN', legacyErpId: 'H1-2TRV-Q', partClass: 'Kit', manufacturingSpecs: { kitFamily: 'H1-2TRV' } }];
const starts = [{ answers: {}, poleIn: '' }, { answers: {}, poleIn: '84' }, { answers: { rodKind: 'TRAVERSE', setup: 'DOUBLE' }, poleIn: '' }, { answers: { drive: 'MOTORIZED', proj: '6' }, poleIn: ' ' }];
let started = 0, blocked = 0, typedKept = 0;
starts.forEach((st, si) => {
    const model = sessionOf(data, { answers: st.answers, picks: {} }).model;
    [...KITS.map(kitIdOf), '', 'K-GONE'].forEach((id) => {
        // (the reference is handed each kit as its code says — the one change since the move, held on its own below)
        const want = oldApplyKit({ id, kits: KITS.map(kitAsItsCodeSays), model, poleIn: st.poleIn });
        // …while the kit in hand stays the record as stored — the bill prices that, not the reading of its code
        if (want.kitSource && want.kitSource.record) want.kitSource = { ...want.kitSource, record: KITS.find(x => kitIdOf(x) === id) };
        const got = newApplyKit({ id, kits: KITS, model, poleIn: st.poleIn });
        if (want.armed) started++;
        if (want.report && want.report.blocked) blocked++;
        if (want.armed && String(st.poleIn).trim() && want.poleIn === null) typedKept++;
        eq(`start #${si} from "${id}": answers, picks, length, words and the kit in hand are CPQ's`, got, want);
    });
});
eq(`…${started} kit starts, ${blocked} refusals, ${typedKept} typed lengths left standing (none vacuous)`, [started > 10, blocked > 2, typedKept > 1], [true, true, true]);
{   // THE KIT'S CODE ANSWERS ROD TYPE (Stuart 2026-10-22, H1-2TRV-4M/P: "it did not push the traverse rod as selected and that allows
    // the wrong options to still be shown"). This assembly holds solid rods beside the traverse; the kits were imported before it did.
    const model = sessionOf(data, { answers: {}, picks: {} }).model;
    const axis = (model.axes || []).find(a => a.key === 'rodKind');
    eq('the assembly asks Rod Type — solid rods beside the traverse (why a kit must answer it)', axis ? [...axis.values].sort() : null, ['SOLID', 'TRAVERSE']);
    const k4mp = KITS.find(x => x.id === 'K-4MP');
    const start = kitStartOf({ model, kit: k4mp });
    eq('picking H1-2TRV-4M/P (no rod type stored) answers Rod Type: Traverse, first on the strip', [start.answers.rodKind, start.report.carried[0]], ['TRAVERSE', 'traverse rod type']);
    const after = sessionOf(data, { answers: start.answers, picks: {} }).model;
    eq('…so no solid rod is offered any more', after.slots.flatMap(s => s.options || []).filter(o => o.rodKind === 'SOLID').map(o => o.name), []);
    eq('…where before the kit answered, the solid rods were on offer (the test is not vacuous)', model.slots.flatMap(s => s.options || []).some(o => o.rodKind === 'SOLID'), true);
    const stored = { ...k4mp, manufacturingSpecs: { ...k4mp.manufacturingSpecs, kitAlign: { ...k4mp.manufacturingSpecs.kitAlign, rodKind: 'SOLID' } } };
    eq('a rod type stored on the kit wins over its code', kitAsItsCodeSays(stored).manufacturingSpecs.kitAlign.rodKind, 'SOLID');
    eq('a kit whose code is not a system code is left exactly as it is', kitAsItsCodeSays(KITS.find(x => x.id === 'K-4V')) === KITS.find(x => x.id === 'K-4V'), true);
    eq('…and the record in hand is never changed', [k4mp.manufacturingSpecs.kitAlign.rodKind, kitAsItsCodeSays(null), kitAsItsCodeSays({ id: 'X' })], [undefined, null, { id: 'X' }]);
}
{   // a kit sold with its own backplates: the old "pick the V backplate" instruction is dropped — the kit fills them in
    const model = sessionOf(data, { answers: {}, picks: {} }).model;
    const seed = seedFromKit({ model, kit: KITS.find(x => x.id === 'K-4V') });
    const start = kitStartOf({ model, kit: KITS.find(x => x.id === 'K-4V') });
    eq('a kit sold with its own backplates: the seed names a "bracket style" to pick, the strip does not (the kit fills them in)', [seed.missed.some(m => m.what === 'bracket style'), start.report.missed.some(m => m.what === 'bracket style'), start.report.carried.some(c => /^brackets — /.test(c))], [true, false, true]);
}

// the kit's brackets: CPQ's effect on the session's own model, every projection and setup, pass after pass
let passes = 0, filled = 0, centreHeld = 0;
[['K-4P', { proj: '3.625' }], ['K-4P', { proj: '4.625' }], ['K-4P', { proj: '6' }], ['K-4P', {}], ['K-4D', { setup: 'DOUBLE' }], ['K-4DR', { setup: 'DOUBLE' }], ['K-4MP', { drive: 'MOTORIZED', proj: '6' }]].forEach(([id, ans], ci) => {
    [36, 96, 150].forEach((L) => {
        const chosen = KITS.find(x => kitIdOf(x) === id);
        let state = { answers: { rodKind: 'TRAVERSE', setup: 'SINGLE', drive: 'MANUAL', mount: 'WALL', ...ans }, picks: {}, lengthInches: L, kitPick: id };
        const doneOld = new Set(), doneNew = new Set();
        for (let i = 0; i < 6; i++) {
            const s = sessionOf({ ...data, kits: KITS }, state);
            const want = oldEffectAdd({ model: s.model, kitSource: { record: chosen }, effAnswers: s.effAnswers, livePicks: s.livePicks, ourId: s.ourId, recommendFor: s.recommendFor, done: doneOld });
            const got = kitFillsOf({ model: s.model, kit: chosen, answers: s.effAnswers, livePicks: s.livePicks, ourId: s.ourId, recommendFor: s.recommendFor, done: doneNew });
            eq(`brackets #${ci} at ${L}" pass ${i}: what CPQ's effect fills`, got, want);
            const keys = Object.keys(want);
            if (!keys.length) break;
            passes++; filled += keys.length;
            keys.forEach(key => { doneOld.add(`${key}|${want[key]}`); doneNew.add(`${key}|${got[key]}`); });
            state = { ...state, picks: { ...state.picks, ...want } };
        }
        const s = sessionOf({ ...data, kits: KITS }, state);
        if (s.model.slots.some(sl => sl.kind === 'BRACKET' && String(sl.position || '').toUpperCase() === 'CENTER' && !s.livePicks[sl.key]) && s.recommendFor(s.model.slots.find(sl => String(sl.position || '').toUpperCase() === 'CENTER' && sl.kind === 'BRACKET')) === 0) centreHeld++;
    });
});
eq(`…${passes} passes filled ${filled} brackets; a short pole held at both ends had no centre filled (${centreHeld}) — the comparison is not vacuous`, [passes > 5, filled > 10], [true, true]);
{   // the bracket is found by OUR number, not by its name: a pin whose name is a description (as most real pins are) still fills
    const named = PINS.map(pn => ({ ...pn, partName: `Bracket ${pn.legacyErpId || pn.partName} (painted)` }));
    const dataN = { assembly: ASSEMBLY, pins: named, parts };
    const st = { answers: { rodKind: 'TRAVERSE', setup: 'SINGLE', drive: 'MANUAL', mount: 'WALL', proj: '4.625' }, picks: {}, lengthInches: 96 };
    const s = sessionOf(dataN, st);
    const got = kitFillsOf({ model: s.model, kit: KITS[0], answers: s.effAnswers, livePicks: s.livePicks, ourId: s.ourId, recommendFor: s.recommendFor, done: new Set() });
    const want = oldEffectAdd({ model: s.model, kitSource: { record: KITS[0] }, effAnswers: s.effAnswers, livePicks: s.livePicks, ourId: s.ourId, recommendFor: s.recommendFor, done: new Set() });
    eq('a pin named by a description, not its number: the kit still finds its bracket by our number (what CPQ\'s effect does)', [got, Object.keys(got).length > 0], [want, true]);
}
// a bracket the customer chose is never touched, and none is filled twice
{
    const chosen = KITS[0];
    const state = { answers: { rodKind: 'TRAVERSE', setup: 'SINGLE', drive: 'MANUAL', mount: 'WALL', proj: '4.625' }, picks: {}, lengthInches: 96 };
    const s = sessionOf(data, state);
    const add = kitFillsOf({ model: s.model, kit: chosen, answers: s.effAnswers, livePicks: s.livePicks, ourId: s.ourId, recommendFor: s.recommendFor, done: new Set() });
    const [key, choice] = Object.entries(add)[0] || [];
    const done = new Set([`${key}|${choice}`]);
    const again = kitFillsOf({ model: s.model, kit: chosen, answers: s.effAnswers, livePicks: s.livePicks, ourId: s.ourId, recommendFor: s.recommendFor, done });
    // (at one projection a slot offers one arm — so "the customer's own" is a slot that already holds a pick: it is left alone)
    const s2 = sessionOf(data, { ...state, picks: { [key]: choice } });
    const kept = kitFillsOf({ model: s2.model, kit: chosen, answers: s2.effAnswers, livePicks: s2.livePicks, ourId: s2.ourId, recommendFor: s2.recommendFor, done: new Set() });
    eq('a bracket filled once is never filled again; a slot already holding a pick is left alone', [!!key, key in again, !!s2.livePicks[key], key in kept], [true, false, true, false]);
}

console.log(`kitStart: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
