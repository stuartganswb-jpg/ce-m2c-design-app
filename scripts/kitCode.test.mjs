// Kit code ⇄ selections tests. The parser half is checked two ways: hand-picked codes with known
// meanings, and ROUND-TRIP against the real sheet when it is present — every code the importer
// produced must parse back to exactly the kitAlign the importer stored, and every per-motor code
// must resolve to its base kit and motor. If the grammar and the importer ever disagree, the sheet
// is the tiebreaker and these tests are where the disagreement surfaces.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { parseKitCode, matchKit, resolveKitCode, kitCodeFor, describeKitAlign, axesKeyOf } from './kitCode.mjs';
import { parseTraverseKitSheets } from './traverseKitImport.mjs';

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
const HAVE = existsSync('./kit_sheet.json');
const skip = HAVE ? false : 'Fabricut/Aug12/Fabricut_Traverse.xlsx not present';
const parsed = HAVE ? parseTraverseKitSheets(JSON.parse(readFileSync('./kit_sheet.json', 'utf8'))) : null;
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
