// Kit code ⇄ selections tests. The parser half is checked two ways: hand-picked codes with known
// meanings, and ROUND-TRIP against the real sheet when it is present — every code the importer
// produced must parse back to exactly the kitAlign the importer stored, and every per-motor code
// must resolve to its base kit and motor. If the grammar and the importer ever disagree, the sheet
// is the tiebreaker and these tests are where the disagreement surfaces.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { register } from 'node:module';
register('./_lib/extless-hook.mjs', import.meta.url);   // the app's own files, where they live (2026-10-20 — this suite ran from staged .mjs copies the runner could no longer make)
const KIT_SHEET = process.env.KIT_SHEET || './kit_sheet.json';   // the Fabricut sheet as JSON (run-traverse-tests.sh extracts it when the .xlsx is present)
const { parseKitCode, matchKit, resolveKitCode, kitCodeFor, describeKitAlign, axesKeyOf, kitForMount, motorCodeFor } = await import('../src/components/Shared/kitCode.js');
const { parseTraverseKitSheets } = await import('../src/components/Shared/traverseKitImport.js');

test('hand-picked codes parse to their known meanings', () => {
    assert.deepEqual(parseKitCode('H1-2TRV-4/P').align,
        { setup: 'SINGLE', frontRail: 'TRACK', drive: 'MANUAL', mount: 'WALL', material: 'P', minFeet: 4 });
    assert.deepEqual(parseKitCode('H1-2TRV-4FRT/W').align,
        { setup: 'DOUBLE', frontRail: 'RING', drive: 'MANUAL', mount: 'WALL', material: 'W', minFeet: 4 });
    assert.deepEqual(parseKitCode('H1-2TRV-4MDC/EP').align,
        { setup: 'DOUBLE', frontRail: 'TRACK', drive: 'MOTORIZED', mount: 'CEILING', material: 'EP', minFeet: 4 });
    // the motor suffix letter is the MOUNT — no C in the flags, ceiling all the same
    const c = parseKitCode('H1-2TRV-4M/P-35C');
    assert.equal(c.align.mount, 'CEILING');
    assert.equal(c.watt, '35');
    // not-kit-codes stay null rather than half-parsing
    assert.equal(parseKitCode('H1-2TRV-4X/P'), null);
    assert.equal(parseKitCode('H1-2TRVSRA/P'), null);
    assert.equal(parseKitCode(''), null);
});

test('describe reads like the CSR needs it to', () => {
    const chips = describeKitAlign(parseKitCode('H1-2TRV-4MFRT/EP-60W').align, 'HSOM-20');
    assert.deepEqual(chips, ['Double — front as ring', 'Motorized', 'HSOM-20', 'Wall', 'Plated aluminum', '4ft set minimum']);
});

// ── round-trip against the real sheet ────────────────────────────────────────────────────────────
const HAVE = existsSync(KIT_SHEET);
const skip = HAVE ? false : 'Fabricut/Aug12/Fabricut_Traverse.xlsx not present';
const parsed = HAVE ? parseTraverseKitSheets(JSON.parse(readFileSync(KIT_SHEET, 'utf8'))) : null;
// the shape the library holds after import: kitAlign + kitMotorCodes on manufacturingSpecs
const lib = HAVE ? parsed.kits.map(k => ({
    legacyErpId: k.code, itemId: k.code, partClass: 'Kit',
    manufacturingSpecs: { kitAlign: k.align, kitMotorCodes: k.motorCodes },
})) : [];

test('every imported base code parses back to the importer\'s own axes', { skip }, () => {
    parsed.kits.forEach(k => {
        const p = parseKitCode(k.code);
        assert.ok(p, `${k.code} did not parse`);
        assert.equal(axesKeyOf(p.align), axesKeyOf(k.align), k.code);
    });
});

test('every per-motor code resolves to its base kit AND its motor', { skip }, () => {
    parsed.kits.forEach(k => k.motorCodes.forEach(mc => {
        const r = resolveKitCode(lib, mc.code);
        assert.ok(r, `${mc.code} did not resolve`);
        assert.equal(r.kit.legacyErpId, k.code, mc.code);
        assert.equal(r.motorItem, mc.motorItem, mc.code);
    }));
});

test('the reverse banner: selections → the customer\'s own code', { skip }, () => {
    // manual double, front ring, wood, wall → the FRT base code
    assert.equal(kitCodeFor(lib, parseKitCode('H1-2TRV-4FRT/W').align), 'H1-2TRV-4FRT/W');
    // motorized single wall painted with the 60W motor → their per-motor code, not our base
    assert.equal(kitCodeFor(lib, parseKitCode('H1-2TRV-4M/P').align, 'HSOM-20'), 'H1-2TRV-4M/P-60W');
    // the base-included 35W motor still has its own Fabricut code — it wins over the base too
    assert.equal(kitCodeFor(lib, parseKitCode('H1-2TRV-4M/P').align, 'HSOM-21'), 'H1-2TRV-4M/P-35W');
    // no motor picked yet → the base set code
    assert.equal(kitCodeFor(lib, parseKitCode('H1-2TRV-4M/P').align), 'H1-2TRV-4M/P');
    // axes no kit matches → null = "custom order"
    assert.equal(kitCodeFor(lib, { setup: 'SINGLE', frontRail: 'TRACK', drive: 'MANUAL', mount: 'WALL', material: 'Z' }), null);
});

test('matchKit treats a blank frontRail as TRACK — importer and parser agree on the default', { skip }, () => {
    const single = parsed.kits.find(k => k.code === 'H1-2TRV-4/P');
    assert.ok(matchKit(lib, { ...single.align, frontRail: '' }));
});

// ── THE SECOND FAMILY: H1-138TRV (Stuart 2026-09-10) ──────────────────────────────────────────
test('H1-138TRV codes parse: style letter, double, painted or plated — and only those', () => {
    assert.deepEqual(parseKitCode('H1-138TRV-4H/P'),
        { family: 'H1-138TRV', align: { setup: 'SINGLE', frontRail: 'TRACK', drive: 'MANUAL', mount: 'WALL', material: 'P', minFeet: 4, rodKind: 'TRAVERSE', bracketStyle: 'H' }, watt: null });
    assert.deepEqual(parseKitCode('h1-138trv-4vd/ep').align,
        { setup: 'DOUBLE', frontRail: 'TRACK', drive: 'MANUAL', mount: 'WALL', material: 'EP', minFeet: 4, rodKind: 'TRAVERSE', bracketStyle: 'V' });
    // a bracket is a component, not a kit; wood, motor and ceiling letters are not this family's
    assert.equal(parseKitCode('H1-138TRV-H/P'), null);
    assert.equal(parseKitCode('H1-138TRV-4HD/W'), null);
    assert.equal(parseKitCode('H1-138TRV-4MH/P'), null);
    assert.equal(parseKitCode('H1-138TRV-4X/P'), null);
    assert.equal(parseKitCode('H1-138TRVJNR'), null);
});

test('the axes key tells H from V, and every H1-2TRV key is unchanged but for an empty last field', () => {
    assert.notEqual(axesKeyOf(parseKitCode('H1-138TRV-4H/P').align), axesKeyOf(parseKitCode('H1-138TRV-4V/P').align));
    assert.equal(axesKeyOf(parseKitCode('H1-138TRV-4H/P').align), 'SINGLE|TRACK|MANUAL|WALL|P|H');
    assert.equal(axesKeyOf(parseKitCode('H1-2TRV-4/P').align), 'SINGLE|TRACK|MANUAL|WALL|P|');
    // an H1-2TRV record saved before this field existed still matches its own code
    assert.equal(axesKeyOf({ setup: 'SINGLE', frontRail: 'TRACK', drive: 'MANUAL', mount: 'WALL', material: 'P' }), axesKeyOf(parseKitCode('H1-2TRV-4/P').align));
});

test('describe names the bracket style, and says nothing about it on an H1-2TRV kit', () => {
    assert.deepEqual(describeKitAlign(parseKitCode('H1-138TRV-4V/EP').align), ['Single', 'Vertical bracket', 'Manual', 'Wall', 'Plated aluminum', '4ft set minimum']);
    assert.deepEqual(describeKitAlign(parseKitCode('H1-138TRV-4HD/P').align), ['Double', 'Horizontal bracket', 'Manual', 'Wall', 'Painted aluminum', '4ft set minimum']);
    assert.ok(!describeKitAlign(parseKitCode('H1-2TRV-4/P').align).some(c => /bracket/i.test(c)));
});

const f138 = HAVE ? parsed.families.find(f => f.family === 'H1-138TRV') : null;
const lib138 = HAVE ? f138.kits.map(k => ({ legacyErpId: k.code, itemId: k.code, partClass: 'Kit', manufacturingSpecs: { kitAlign: k.align, kitMotorCodes: k.motorCodes } })) : [];

test('every imported H1-138TRV code parses back to the importer\'s own axes', { skip }, () => {
    f138.kits.forEach(k => {
        const p = parseKitCode(k.code);
        assert.ok(p, `${k.code} did not parse`);
        assert.equal(p.family, 'H1-138TRV');
        assert.equal(axesKeyOf(p.align), axesKeyOf(k.align), k.code);
    });
});

test('the reverse banner tells the H kit from the V kit, and a typed code resolves to its own record', { skip }, () => {
    assert.equal(kitCodeFor(lib138, parseKitCode('H1-138TRV-4H/P').align), 'H1-138TRV-4H/P');
    assert.equal(kitCodeFor(lib138, parseKitCode('H1-138TRV-4V/P').align), 'H1-138TRV-4V/P');
    assert.equal(kitCodeFor(lib138, parseKitCode('H1-138TRV-4VD/EP').align), 'H1-138TRV-4VD/EP');
    assert.equal(resolveKitCode(lib138, 'h1-138trv-4hd/p').kit.legacyErpId, 'H1-138TRV-4HD/P');
    // the two families never resolve into each other
    assert.equal(resolveKitCode(lib138, 'H1-2TRV-4/P'), null);
    assert.equal(resolveKitCode(lib, 'H1-138TRV-4H/P'), null);
});

// ── THE KIT FOLLOWS THE MOUNT (Stuart 2026-10-12) ─────────────────────────────────────────────
test('kitForMount: a wall kit under a ceiling answer becomes the ceiling kit of the same set-up, motor and all', { skip }, () => {
    const all = [...lib, ...lib138];
    const wall = lib.find(k => k.legacyErpId === 'H1-2TRV-4MD/P'), ceil = lib.find(k => k.legacyErpId === 'H1-2TRV-4MDC/P');
    assert.ok(wall && ceil);
    const r = kitForMount(all, wall, 'CEILING');
    assert.equal(r.mode, 'switched');
    assert.equal(r.kit, ceil);
    assert.equal(r.from, wall);
    assert.equal(r.align.mount, 'CEILING');
    // …and back again, and the same motor by its item, not by its code
    assert.equal(kitForMount(all, ceil, 'wall').kit, wall);
    assert.equal(motorCodeFor(wall, ceil, 'H1-2TRV-4MD/P-60W'), 'H1-2TRV-4MD/P-60C');
    assert.equal(motorCodeFor(ceil, wall, 'h1-2trv-4md/p-35c'), 'H1-2TRV-4MD/P-35W');
    assert.equal(motorCodeFor(wall, ceil, ''), '');
    assert.equal(motorCodeFor(wall, ceil, 'NOT-A-CODE'), '');
    // every single / double track kit of the family has its other mount, in every material
    lib.filter(k => !/FRT/.test(k.legacyErpId)).forEach(k => {
        const o = kitForMount(all, k, k.manufacturingSpecs.kitAlign.mount === 'WALL' ? 'CEILING' : 'WALL');
        assert.equal(o.mode, 'switched', k.legacyErpId);
        assert.equal(o.kit.manufacturingSpecs.kitAlign.material, k.manufacturingSpecs.kitAlign.material, k.legacyErpId);
        assert.equal(o.kit.manufacturingSpecs.kitAlign.setup, k.manufacturingSpecs.kitAlign.setup, k.legacyErpId);
        assert.equal(o.kit.manufacturingSpecs.kitAlign.drive, k.manufacturingSpecs.kitAlign.drive, k.legacyErpId);
    });
});

test('kitForMount: the same mount, no answer, or an inside mount leave the kit alone', { skip }, () => {
    const wall = lib.find(k => k.legacyErpId === 'H1-2TRV-4/P');
    for (const m of ['WALL', 'wall', '', null, undefined, 'END']) {
        const r = kitForMount(lib, wall, m);
        assert.equal(r.mode, 'same', String(m));
        assert.equal(r.kit, wall);
        assert.equal(r.align, wall.manufacturingSpecs.kitAlign);
    }
    assert.deepEqual(kitForMount(lib, null, 'CEILING'), { kit: null, align: null, mode: 'same' });
});

test('kitForMount: a family with no ceiling kit keeps its kit and carries the mount — the 1-3/8" traverse', { skip }, () => {
    const all = [...lib, ...lib138];
    const k = lib138.find(x => x.legacyErpId === 'H1-138TRV-4V/EP');
    const r = kitForMount(all, k, 'CEILING');
    assert.equal(r.mode, 'followed');
    assert.equal(r.kit, k);
    assert.equal(r.align.mount, 'CEILING');
    assert.equal(r.align.bracketStyle, 'V');
    assert.equal(k.manufacturingSpecs.kitAlign.mount, 'WALL', 'the record itself is not touched');
});

test('kitForMount: a set-up the family does not make on that mount stays as picked — the 2" stationary front on a ceiling', { skip }, () => {
    const frt = lib.find(k => k.legacyErpId === 'H1-2TRV-4FRT/P');
    assert.ok(frt);
    const r = kitForMount(lib, frt, 'CEILING');
    assert.equal(r.mode, 'nokit');
    assert.equal(r.kit, frt);
    assert.equal(r.align.mount, 'WALL');
});
