// Harness for Shared/kitSeed.js — the Quick Ship kit → CPQ seeder.
//
//   node scripts/kitSeed.test.mjs
//
// The model is built by the real resolve(), never hand-faked, so "does this assembly offer a
// ceiling mount" is answered by the same code the walk answers it with. That matters more here
// than anywhere else in this file: the ceiling foundation IS the axis test, and a fixture that
// stubbed `axes` would prove nothing about the day the brackets arrive.

import { resolve } from '../src/components/Shared/hardwareModel.js';
import { seedFromKit, kitsForSeeding, applyKitPricing } from '../src/components/Shared/kitSeed.js';

let pass = 0, fail = 0;
const eq = (name, got, want) => {
    const g = JSON.stringify(got), w = JSON.stringify(want);
    if (g === w) { pass++; return; }
    fail++; console.log(`✗ ${name}\n    got  ${g}\n    want ${w}`);
};
const ok = (name, cond, extra = '') => { if (cond) { pass++; return; } fail++; console.log(`✗ ${name} ${extra}`); };
const C = (o) => o;

// ── THE ASSEMBLY, AS H1-2TRV STANDS TODAY (verified in the app 2026-08-22) ────────────────────
// setup: both values tagged → asked.   drive: both values tagged → asked.
// mount: WALL only → IMPLIED, never asked, and no ceiling parts tagged anywhere.
const wallOnly = [
    C({ id: 'TRK', partId: 'H1-2TRV', role: 'TRACK', rodKind: 'TRAVERSE', nodes: ['trk'] }),
    C({ id: 'BKT-S', partId: 'TB-S', role: 'BRACKET', position: 'CENTER', setup: 'SINGLE', mount: 'WALL', nodes: ['bs'] }),
    C({ id: 'BKT-D', partId: 'TB-D', role: 'BRACKET', position: 'CENTER', setup: 'DOUBLE', mount: 'WALL', nodes: ['bd'] }),
    C({ id: 'MOT', partId: 'MTR', role: 'ACCESSORY', position: 'CENTER', drive: 'MOTORIZED', nodes: ['mot'] }),
    C({ id: 'MAN', partId: 'PULL', role: 'ACCESSORY', position: 'CENTER', drive: 'MANUAL', nodes: ['man'] }),
    C({ id: 'RING-F', partId: 'RG', role: 'RING', position: 'CENTER', nodes: ['rg'] }),
];
const wallModel = resolve({ choices: wallOnly, answers: {} });

const kit = (align, code = 'HTS7504F') => ({ legacyErpId: code, partClass: 'Kit', manufacturingSpecs: { kitAlign: align } });

// ── 1. THE ORDINARY CASE: a wall kit on a wall assembly ──────────────────────────────────────
{
    const r = seedFromKit({ model: wallModel, kit: kit({ setup: 'SINGLE', drive: 'MANUAL', mount: 'WALL', material: 'EP', minFeet: 4 }) });
    eq('nothing blocks a buildable kit', r.blocked, null);
    eq('the three axes come across', r.answers, { setup: 'SINGLE', drive: 'MANUAL', mount: 'WALL' });
    eq('the base set becomes a starting length', r.lengthInches, 48);
    ok('and it says the length is a starting point', r.carried.some(c => /replace with the measured/.test(c)));
}

// ── 2. AN IMPLIED AXIS IS STILL AN ANSWER ────────────────────────────────────────────────────
// mount is never ASKED on this assembly — one value — but WALL is still what it builds, so a wall
// kit is perfectly buildable. Reading model.axes rather than "is there a question" is what makes
// this fall out instead of needing a special case.
{
    const mount = wallModel.axes.find(a => a.key === 'mount');
    ok('mount holds one value and is implied', mount.implied === true && mount.values.length === 1);
    const r = seedFromKit({ model: wallModel, kit: kit({ mount: 'WALL' }) });
    eq('a wall kit seeds against an implied wall axis', r.answers.mount, 'WALL');
}

// ── 3. THE CEILING KIT, TODAY: REFUSED, AND NOTHING HALF-WRITTEN ─────────────────────────────
// Stuart's six ceiling kits (H1-2TRV-4C/P and siblings). setup and drive would both seed happily,
// which is exactly what makes this dangerous — four confident lines and one quiet one.
{
    const r = seedFromKit({ model: wallModel, kit: kit({ setup: 'SINGLE', drive: 'MANUAL', mount: 'CEILING', minFeet: 4 }, 'HTS7510F') });
    ok('a ceiling kit is blocked outright', !!r.blocked);
    eq('and blocked on the mount', r.blocked.what, 'mount');
    eq('NOTHING is written when it refuses', r.answers, {});
    eq('not even the answers it could have honoured', r.picks, {});
    ok('the refusal names the kit and the remedy', /HTS7510F/.test(r.blocked.why) && /1\.6/.test(r.blocked.why), r.blocked.why);
}

// ── 4. THE FOUNDATION: tag one ceiling bracket, and the same kit seeds ────────────────────────
// No code changes between this block and the one above. The bracket is the whole difference —
// which is the claim the ceiling "foundation" rests on, so it is asserted rather than promised.
{
    const withCeiling = [...wallOnly,
        C({ id: 'BKT-C', partId: 'TB-C', role: 'BRACKET', position: 'CENTER', setup: 'SINGLE', mount: 'CEILING', nodes: ['bc'] })];
    const model = resolve({ choices: withCeiling, answers: {} });
    const r = seedFromKit({ model, kit: kit({ setup: 'SINGLE', drive: 'MANUAL', mount: 'CEILING', minFeet: 4 }, 'HTS7510F') });
    eq('the ceiling kit stops being blocked', r.blocked, null);
    eq('and seeds the ceiling mount', r.answers.mount, 'CEILING');
    ok('the Mount question appears in the walk too', !model.axes.find(a => a.key === 'mount').implied);
}

// ── 5. THE FINISH IS REPORTED, NEVER CHOSEN ──────────────────────────────────────────────────
// A family (P / EP / W) is not one of a hundred codes, and a finish nobody chose on a customer's
// quote is the one kind of wrong this must not be.
{
    const r = seedFromKit({ model: wallModel, kit: kit({ setup: 'SINGLE', material: 'EP' }) });
    ok('the plated family is surfaced', r.missed.some(m => m.what === 'finish' && /plated/.test(m.why)));
    ok('but no finish is selected', !('finish' in r.answers) && !('globalFinish' in r.answers));
    const w = seedFromKit({ model: wallModel, kit: kit({ setup: 'SINGLE', material: 'W' }) });
    ok('a wood kit says stain', w.missed.some(m => /wood stain/.test(m.why)));
}

// ── 6. THE FRONT RAIL ONLY EXISTS ON A DOUBLE ────────────────────────────────────────────────
// Quick Ship: trackCount = DOUBLE && frontRail !== 'RING' ? 2 : 1. On a single there is nothing to
// say, and saying it would be noise in the one list the operator has to read.
{
    const dbl = seedFromKit({ model: wallModel, kit: kit({ setup: 'DOUBLE', frontRail: 'RING' }) });
    ok('a double ring front rail is placed', Object.keys(dbl.picks).length === 1);
    ok('and reported as carried', dbl.carried.some(c => /ring front rail/.test(c)));

    const sgl = seedFromKit({ model: wallModel, kit: kit({ setup: 'SINGLE', frontRail: 'RING' }) });
    eq('a single says nothing about the front rail', sgl.picks, {});
    ok('and does not report it missing either', !sgl.missed.some(m => m.what === 'front rail'));

    const noRing = resolve({ choices: wallOnly.filter(c => c.role !== 'RING'), answers: {} });
    const r = seedFromKit({ model: noRing, kit: kit({ setup: 'DOUBLE', frontRail: 'RING' }) });
    ok('a ring the assembly cannot offer is reported, not forced', r.missed.some(m => m.what === 'front rail'));
    eq('and it does not block — the rest of the kit is still buildable', r.blocked, null);
}

// ── 7. THINGS THAT ARE NOT KITS ──────────────────────────────────────────────────────────────
{
    ok('a record with no alignment is refused', !!seedFromKit({ model: wallModel, kit: { partClass: 'Kit' } }).blocked);
    ok('so is no model at all', !!seedFromKit({ model: null, kit: kit({ setup: 'SINGLE' }) }).blocked);
    const parts = [{ partClass: 'Kit', manufacturingSpecs: { kitAlign: {} } }, { partClass: 'Inventory' }, { partClass: 'Kit' }];
    eq('only Kit records carrying an alignment are offerable', kitsForSeeding(parts).length, 1);
}

// ── 8. THE BILL: THE KIT, THEN WHAT WAS ADDED TO IT ──────────────────────────────────────────
// Stuart 2026-08-22: "a 10 ft kit will bill at 4ft kit + 6ft additional feet."
{
    const priced = {
        lines: [
            { partId: 'H1-2TRVF', name: 'fascia', qty: 1, perFoot: true, feet: 10, unit: 9, total: 90, cutLength: 120, role: 'FASCIA' },
            { partId: 'H1-2TRVT', name: 'track', qty: 1, perFoot: true, feet: 10, unit: 6, total: 60, role: 'TRACK' },
            { partId: 'H1-1CC', name: 'finial', qty: 2, perFoot: false, unit: 15, total: 30, role: 'FINIAL' },
        ],
        total: 180,
    };
    const r = applyKitPricing(priced, { kitCode: 'H1-2TRV-4/EP', kitName: '2in wall mount', kitPrice: 318, baseFeet: 4, clientSku: 'HTS7504F PREMIUM' });

    eq('the kit is the first line', [r.lines[0].partId, r.lines[0].qty, r.lines[0].total], ['H1-2TRV-4/EP', 1, 318]);
    ok('and says what it is', r.lines[0].detail === '4 ft kit' && r.lines[0].isKit === true);
    eq("it carries THEIR number too", r.lines[0].sku, 'HTS7504F PREMIUM');
    ok('and is marked off the NetSuite component list', r.lines[0].noNs === true);

    // ONE additional-foot line, named for the part the customer understands. The fascia carries
    // the money for every per-foot part; the track is shop work and bills nothing.
    const fascia = r.lines.find(l => l.partId === 'H1-2TRVF');
    eq('the fascia carries the WHOLE additional-foot charge', [fascia.billedFeet, fascia.total], [6, 90]);
    ok('and says so on the line', /6 ft above the 4 ft kit/.test(fascia.detail));
    eq('THE REAL LENGTH IS UNTOUCHED — the shop still cuts 10 ft', [fascia.feet, fascia.cutLength], [10, 120]);

    const track = r.lines.find(l => l.partId === 'H1-2TRVT');
    eq('the track bills nothing — its cost is inside that foot', track.total, 0);
    ok('it is marked shop work, and still ships', track.shopOnly === true && track.feet === 10);
    ok('and it never leaves the list', r.lines.some(l => l.partId === 'H1-2TRVT'));
    eq('a customisation bills in full — it was never in the kit', r.lines.find(l => l.partId === 'H1-1CC').total, 30);
    eq('318 kit + 90 additional feet + 30 finial', r.total, 438);
}

// ── 9. A COVERED LINE STAYS ON THE LIST, AT ZERO ─────────────────────────────────────────────
// ⚠ THE BUG THIS EXISTS TO CATCH: dropping the lines the kit paid for is right for the bill and
// catastrophic for everything else. pricingBreakdown is the SAME list the NetSuite push, the pick
// list and the packing slip read — so a 4 ft order would have billed correctly and shipped nothing.
{
    const priced = { lines: [{ partId: 'F', name: 'fascia', qty: 1, perFoot: true, feet: 4, unit: 9, total: 36, cutLength: 48 }], total: 36 };
    const r = applyKitPricing(priced, { kitCode: 'K', kitPrice: 318, baseFeet: 4 });

    eq('the component is STILL THERE, so it ships and it pushes', r.lines.length, 2);
    const f = r.lines.find(l => l.partId === 'F');
    eq('it just bills nothing', [f.billedFeet, f.total], [0, 0]);
    ok('and says why, so a document can print it as included', f.inKit === true && /included in the 4 ft kit/.test(f.detail));
    eq('its cut length is untouched', f.cutLength, 48);
    eq('and the order totals the kit', r.total, 318);

    const shortCut = applyKitPricing({ lines: [{ partId: 'F', qty: 1, perFoot: true, feet: 3, unit: 9, total: 27 }], total: 27 },
        { kitCode: 'K', kitPrice: 318, baseFeet: 4 });
    eq('a shorter cut still bills the set, never less', shortCut.total, 318);
}

// ── 10. EVERY OTHER CONFIGURATION IS UNTOUCHED ───────────────────────────────────────────────
// The safety property the whole change rests on: no kit, no transform.
{
    const priced = { lines: [{ partId: 'X', qty: 1, perFoot: true, feet: 10, unit: 9, total: 90 }], total: 90 };
    eq('no kit code leaves it exactly as it was', applyKitPricing(priced, {}), priced);
    eq('and so does no priced object at all', applyKitPricing(null, { kitCode: 'K' }), null);
}

console.log(fail ? `\n❌  ${pass} passed, ${fail} failed` : `\n✅  ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
