// The picks the configurator makes on the operator's behalf — the tracks and the traverse ends.
//   node scripts/hardwareAutoPicks.test.mjs
//
// Two halves. The RULES: each assertion is one of Stuart's decisions (2026-08-21 the drive names the end,
// 08-29 nothing settles before a traverse rod is chosen, 08-31 step 1 decides the tracks), asked of the live
// H1-2TRV pins. The MOVE: the configurator's inline code as it stood before it moved to
// Shared/hardwareAutoPicks is kept below, verbatim, and must agree with the module on every set-up — the
// proof that moving the rule changed nothing the CPQ screen does.
//
// AUTOPICKS_MODULE=<path> runs the same assertions against a mutated copy (mutation check).

import { resolve, reseatPicks, ROD_ROLES, TRAVERSE } from '../src/components/Shared/hardwareModel.js';
import { choicesFromAssembly } from '../src/components/Shared/hardwareAdapter.js';
import { ASSEMBLY, PINS } from './hardwareAutoPicks.fixture.mjs';

const { autoPicksOf } = await import(process.env.AUTOPICKS_MODULE || new URL('../src/components/Shared/hardwareAutoPicks.js', import.meta.url).href);

let pass = 0, fail = 0;
const eq = (n, got, want) => {
    const g = JSON.stringify(got), w = JSON.stringify(want);
    if (g === w) { pass++; return; }
    fail++; console.log(`✗ ${n}\n    got  ${g}\n    want ${w}`);
};
const ok = (n, c) => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}`); };

// Part ids as they sit in the library (read 2026-09-29).
const TRACK = 'CE-INV-52988';        // H1-2TRV — 1.5" square traverse track
const PLUG = 'CE-INV-57902';         // H1-2TRVPLUG — manual end
const SOMFY = 'CE-INV-48935';        // HSOM-04 — motorized end
const FASCIA_AL = 'CE-INV-2446';     // H1-2RCTAR — aluminium fascia / rod

const CHOICES = choicesFromAssembly(ASSEMBLY, PINS);

// The configurator's own settling of a set-up: resolve, reseat the operator's picks, repeat.
function configure(answers, picks = {}) {
    let sel = Object.values(picks).filter(Boolean);
    let m = resolve({ choices: CHOICES, answers, selectedIds: sel });
    for (let pass = 0; pass < 4; pass++) {
        const next = Object.values(reseatPicks(m, picks));
        if (next.length === sel.length && next.every(id => sel.includes(id))) break;
        sel = next;
        m = resolve({ choices: CHOICES, answers, selectedIds: sel });
    }
    return m;
}
const slotOf = (m, kind, tier, position) => (m.slots || []).find(s => s.kind === kind
    && (tier === undefined || (s.tier || '') === tier) && (position === undefined || (s.position || '') === position));
const partOf = (m, id) => (m.choices || []).find(c => c.id === id)?.partId;
const autoFor = (answers, picks = {}) => {
    const m = configure(answers, picks);
    return { m, ...autoPicksOf({ model: m, answers, operatorPicks: reseatPicks(m, picks) }) };
};
const trackParts = (r) => Object.values(r.trackAuto).map(id => partOf(r.m, id));
const endPicks = (r, tier) => (r.m.slots || []).filter(s => s.kind === 'TRV_END' && (s.tier || '') === tier)
    .map(s => partOf(r.m, r.livePicks[s.key]) || null);
const pickFascia = (m) => { const s = slotOf(m, 'FASCIA', 'FRONT'); const o = (s?.options || []).find(c => c.partId === FASCIA_AL); return s && o ? { [s.key]: o.id } : {}; };

// ── NOTHING SETTLES ON AN UNTOUCHED SCREEN (Stuart 2026-08-29) ────────────────────────────────
{
    const r = autoFor({});
    eq('untouched: no track picks itself', r.trackAuto, {});
    eq('untouched: no end settles (the plug + Somfy billed on an empty screen)', [...r.settledKeys], []);
    eq('untouched: nothing is picked', r.livePicks, {});
}

// ── THE DRIVE NAMES THE END, ONCE A TRAVERSE ROD IS CHOSEN (Stuart 2026-08-21 / 08-29) ─────────
{
    const answers = { rodKind: 'TRAVERSE', drive: 'MANUAL' };
    const before = autoFor(answers);
    eq('drive answered, no rod chosen yet: no end settles', [...before.settledKeys], []);
    const r = autoFor(answers, pickFascia(before.m));
    eq('setup unanswered: no track picks itself, even with the fascia chosen', r.trackAuto, {});
    ok('the fascia (a traverse rod) chosen: the front ends settle', r.settledKeys.size >= 2);
    eq('and they are the manual plug, left and right', endPicks(r, 'FRONT'), [PLUG, PLUG]);
}

// ── STEP 1 DECIDES THE TRACKS (Stuart 2026-08-31) ────────────────────────────────────────────
{
    const single = autoFor({ rodKind: 'TRAVERSE', setup: 'SINGLE', drive: 'MANUAL' });
    eq('single: one track picks itself', trackParts(single), [TRACK]);
    eq('single: the auto-picked track is a traverse rod, so its ends settle — the plug each side', endPicks(single, 'FRONT'), [PLUG, PLUG]);
    ok('single: a settled end is in the picks everything reads', Object.values(single.livePicks).some(id => partOf(single.m, id) === PLUG));

    const motor = autoFor({ rodKind: 'TRAVERSE', setup: 'SINGLE', drive: 'MOTORIZED' });
    eq('motorized: the same track, and the Somfy drive each side', [trackParts(motor), endPicks(motor, 'FRONT')], [[TRACK], [SOMFY, SOMFY]]);

    const dblTrack = autoFor({ rodKind: 'TRAVERSE', setup: 'DOUBLE', frontLayer: 'TRACK', drive: 'MANUAL' });
    eq('double, track front: two tracks', trackParts(dblTrack), [TRACK, TRACK]);
    eq('double, track front: ends on both tracks', [endPicks(dblTrack, 'FRONT'), endPicks(dblTrack, 'BACK')], [[PLUG, PLUG], [PLUG, PLUG]]);

    const dblRod = autoFor({ rodKind: 'TRAVERSE', setup: 'DOUBLE', frontLayer: 'FASCIA', drive: 'MANUAL' });
    eq('double, rod front: the stationary fascia leaves ONE track — the rear', [trackParts(dblRod), slotOf(dblRod.m, 'TRACK', 'BACK') ? Object.keys(dblRod.trackAuto).includes(slotOf(dblRod.m, 'TRACK', 'BACK').key) : false], [[TRACK], true]);
    ok('double, rod front: the front track slot is suppressed and not picked', !Object.keys(dblRod.trackAuto).includes(slotOf(dblRod.m, 'TRACK', 'FRONT')?.key));
    eq('double, rod front: ends on the rear track only', [endPicks(dblRod, 'FRONT').filter(Boolean), endPicks(dblRod, 'BACK')], [[], [PLUG, PLUG]]);

    const solid = autoFor({ rodKind: 'SOLID', setup: 'SINGLE' });
    eq('solid: no track, no traverse end', [solid.trackAuto, [...solid.settledKeys]], [{}, []]);
}

// ── AN OPERATOR'S OWN PICK ALWAYS WINS ───────────────────────────────────────────────────────
{
    const m = configure({ rodKind: 'TRAVERSE', setup: 'SINGLE', drive: 'MANUAL' });
    const trackKey = slotOf(m, 'TRACK', 'FRONT').key;
    const r = autoPicksOf({ model: m, answers: { setup: 'SINGLE' }, operatorPicks: { [trackKey]: 'THE-OPERATORS-OWN' } });
    eq('an operator pick on an auto slot is never overwritten', r.livePicks[trackKey], 'THE-OPERATORS-OWN');
}

// ── THE MOVE CHANGED NOTHING: the configurator's inline code before 2026-09-29, verbatim ─────
function legacy(model, answers, picksReseated) {
    const trackAuto = (() => {
        const auto = {};
        if (!answers.setup) return auto;
        model.slots.forEach(s => {
            if (s.kind === 'TRACK' && !s.suppressedBy && s.options.length === 1) auto[s.key] = s.options[0].id;
        });
        return auto;
    })();
    const settledKeys = (() => {
        const chosenIds = new Set([...Object.values(picksReseated), ...Object.values(trackAuto)]);
        const trvChosen = model.choices.some(c => chosenIds.has(c.id) && ROD_ROLES.includes(c.role) && c.rodKind === TRAVERSE);
        if (!trvChosen) return new Set();
        return new Set(model.slots.filter(s => s.kind === 'TRV_END' && s.options.length === 1).map(s => s.key));
    })();
    const livePicks = (() => {
        const auto = { ...trackAuto };
        model.slots.forEach(s => { if (settledKeys.has(s.key)) auto[s.key] = s.options[0].id; });
        return { ...auto, ...picksReseated };
    })();
    return { trackAuto, settledKeys: [...settledKeys].sort(), livePicks };
}
{
    const ANSWERS = [
        {}, { rodKind: 'TRAVERSE' }, { rodKind: 'TRAVERSE', drive: 'MANUAL' }, { rodKind: 'TRAVERSE', drive: 'MOTORIZED' },
        { rodKind: 'TRAVERSE', setup: 'SINGLE' }, { rodKind: 'TRAVERSE', setup: 'SINGLE', drive: 'MANUAL' },
        { rodKind: 'TRAVERSE', setup: 'SINGLE', drive: 'MOTORIZED' }, { rodKind: 'TRAVERSE', setup: 'DOUBLE', drive: 'MANUAL' },
        { rodKind: 'TRAVERSE', setup: 'DOUBLE', frontLayer: 'FASCIA', drive: 'MANUAL' }, { rodKind: 'TRAVERSE', setup: 'DOUBLE', frontLayer: 'TRACK', drive: 'MOTORIZED' },
        { rodKind: 'SOLID' }, { rodKind: 'SOLID', setup: 'SINGLE' }, { setup: 'SINGLE' },
    ];
    let compared = 0, differ = 0;
    for (const answers of ANSWERS) {
        const base = configure(answers);
        for (const picks of [{}, pickFascia(base)]) {
            const m = configure(answers, picks);
            const own = reseatPicks(m, picks);
            const a = legacy(m, answers, own);
            const b = autoPicksOf({ model: m, answers, operatorPicks: own });
            const same = JSON.stringify(a) === JSON.stringify({ trackAuto: b.trackAuto, settledKeys: [...b.settledKeys].sort(), livePicks: b.livePicks });
            compared++; if (!same) { differ++; console.log(`  differs at ${JSON.stringify(answers)} picks ${JSON.stringify(picks)}`); }
        }
    }
    eq(`the module agrees with the old inline code on every set-up (${compared} compared)`, differ, 0);
}

console.log(fail ? `\n❌  ${pass} passed, ${fail} failed` : `\n✅  ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
