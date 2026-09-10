// Explosion tests — the quantities that hit NetSuite inventory. Run against the REAL rules doc
// shape (parsed from the actual sheet when present) so the bracket/splice counts are the table's,
// not a fixture's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { explodeTraverse, usageAt, singleProjections, projLabel } from './traverseExplode.mjs';
import { parseTraverseKitSheets } from './traverseKitImport.mjs';
import * as KI from './traverseKitImport.mjs';
import { TRAVERSE_FAMILY_PARTS } from './traverseExplode.mjs';

const HAVE = existsSync('./kit_sheet.json');
const skip = HAVE ? false : 'Fabricut/Aug12/Fabricut_Traverse.xlsx not present';
const rules = HAVE ? parseTraverseKitSheets(JSON.parse(readFileSync('./kit_sheet.json', 'utf8'))).rules : null;
const A = (over = {}) => ({ setup: 'SINGLE', frontRail: 'TRACK', drive: 'MANUAL', mount: 'WALL', material: 'P', minFeet: 4, ...over });
const q = (r, code) => r.lines.find(l => l.code === code)?.qty;

test('usageAt: exact foot, else the next entry UP — a 4.5ft system consumes 5ft counts', () => {
    const row = { byFeet: { 4: 2, 5: 3, 10: 4 } };
    assert.equal(usageAt(row, 4), 2);
    assert.equal(usageAt(row, 5), 3);
    assert.equal(usageAt(row, 7), 4);      // between entries → up
    assert.equal(usageAt(row, 50), 4);     // past the table → last
});

test('a 4ft manual single wall painted set — the sheet-defined bare system', { skip }, () => {
    const r = explodeTraverse({ align: A(), feet: 4, rules });
    assert.equal(q(r, 'H1-2RCTAR'), 4);        // aluminum fascia per ft
    assert.equal(q(r, 'H1-2TRVTRK/C'), 4);     // one track per ft
    assert.equal(q(r, 'H1-2TRV-WB'), 2);       // brackets at 4ft per the table
    assert.equal(q(r, 'H1-2TRVPLUG'), 2);      // manual: a plug each end
    assert.equal(q(r, 'H1-2TRVSPLC'), undefined); // no splice until 11ft
    assert.ok(r.skipped.some(s => /carriers/.test(s)));
});

test('a 12ft motorized double wood ceiling set — every axis flips', { skip }, () => {
    const r = explodeTraverse({ align: A({ setup: 'DOUBLE', drive: 'MOTORIZED', mount: 'CEILING', material: 'W' }), feet: 12, motorItem: 'HSOM-20', rules });
    assert.equal(q(r, 'H1-2RCTWR'), 12);       // wood fascia
    assert.equal(q(r, 'H1-2TRVTRK/C'), 24);    // two tracks × 12ft
    assert.equal(q(r, 'H1-2TRV-CB'), 5);       // ceiling brackets, count from the standard table at 12ft
    assert.equal(q(r, 'HSOM-20'), 1);          // the chosen motor, not the base
    assert.equal(q(r, 'H1-2TRVPLUG'), undefined);
    assert.equal(q(r, 'H1-2TRVSPLC'), 1);      // one splice at 12ft per the table
});

test('front-as-ring: ONE track, the front ring pole, the DRT bracket', { skip }, () => {
    const r = explodeTraverse({ align: A({ setup: 'DOUBLE', frontRail: 'RING' }), feet: 6, rules });
    assert.equal(q(r, 'H1-2TRVTRK/C'), 6);     // rear track only
    assert.equal(q(r, 'H1-2RCTPR'), 1);        // front ring pole
    assert.equal(q(r, 'H1-2TRV-DRTWB'), 3);    // the front-ring bracket at 6ft
    assert.ok(r.skipped.some(s => /ring COUNT/.test(s)));
});

test('below the minimum still consumes the 4ft set', { skip }, () => {
    const r = explodeTraverse({ align: A(), feet: 3, rules });
    assert.equal(q(r, 'H1-2RCTAR'), 4);
});

// ── PROJECTION → BRACKET (Stuart 2026-08-22) ──────────────────────────────────────────────────
test('projLabel speaks the shop\'s language, to sixteenths', () => {
    assert.equal(projLabel('3.625'), '3-5/8"');
    assert.equal(projLabel('4.625'), '4-5/8"');
    assert.equal(projLabel(6), '6"');
    assert.equal(projLabel('4.5'), '4-1/2"');
});

test('the three single projections, shallowest first, the standard marked', () => {
    const ps = singleProjections();
    assert.deepEqual(ps.map(p => p.inches), ['3.625', '4.625', '6']);
    assert.deepEqual(ps.map(p => p.code), ['H1-2TRV-WB', 'H1-2TRV-EWB', 'H1-2TRV-6WB']);
    assert.equal(ps[0].standard, true);
    assert.equal(ps[1].standard, false);
    assert.equal(ps[1].returnArm, 'H1-2TRVERA');
});

test('a single consumes the bracket for the projection SOLD, counted off its own chart row', { skip }, () => {
    const std = explodeTraverse({ align: A(), feet: 4, rules, proj: '3.625' });
    assert.equal(q(std, 'H1-2TRV-WB'), 2);
    const ext = explodeTraverse({ align: A(), feet: 4, rules, proj: '4.625' });
    assert.equal(q(ext, 'H1-2TRV-EWB'), 2);
    assert.equal(q(ext, 'H1-2TRV-WB'), undefined);   // the standard bracket is NOT on a 4-5/8 order
    const six = explodeTraverse({ align: A(), feet: 4, rules, proj: '6' });
    assert.equal(q(six, 'H1-2TRV-6WB'), 2);
});

test('no projection given still explodes the standard, and says so', { skip }, () => {
    const r = explodeTraverse({ align: A(), feet: 4, rules });
    assert.equal(q(r, 'H1-2TRV-WB'), 2);
    assert.ok(r.skipped.some(s => /no projection on this line/.test(s)));
});

test('a DOUBLE ignores projection entirely — one bracket carries both rods', { skip }, () => {
    const r = explodeTraverse({ align: A({ setup: 'DOUBLE' }), feet: 6, rules, proj: '6' });
    assert.equal(q(r, 'H1-2TRV-DWB'), 3);
    assert.equal(q(r, 'H1-2TRV-6WB'), undefined);
    assert.ok(!r.skipped.some(s => /no projection/.test(s)));
});

test('the track AND the brackets wear the base colour; the fascia and the ends do not', { skip }, () => {
    const r = explodeTraverse({ align: A(), feet: 4, rules, proj: '4.625' });
    const line = (code) => r.lines.find(l => l.code === code);
    assert.equal(line('H1-2TRVTRK/C').subFinish, true);    // track
    assert.equal(line('H1-2TRV-EWB').subFinish, true);     // the bracket goes with it
    assert.equal(line('H1-2RCTAR').subFinish, false);      // fascia — the colour that was sold
    assert.equal(line('H1-2TRVPLUG').subFinish, false);    // end treatment
    assert.equal(line('H1-2TRV-EWB').role, 'bracket');
});

test('every bracket shape carries the base-colour fact, not just the single', { skip }, () => {
    const dbl = explodeTraverse({ align: A({ setup: 'DOUBLE' }), feet: 6, rules });
    assert.equal(dbl.lines.find(l => l.code === 'H1-2TRV-DWB').subFinish, true);
    const ceil = explodeTraverse({ align: A({ mount: 'CEILING' }), feet: 6, rules });
    assert.equal(ceil.lines.find(l => l.code === 'H1-2TRV-CB').subFinish, true);
    const ring = explodeTraverse({ align: A({ setup: 'DOUBLE', frontRail: 'RING' }), feet: 6, rules });
    assert.equal(ring.lines.find(l => l.code === 'H1-2TRV-DRTWB').subFinish, true);
    assert.equal(ring.lines.find(l => l.code === 'H1-2RCTPR').subFinish, false);   // the front ring pole is visible
});

test('a splice below the chart\'s first length is not consumed — optional up to 10 ft (Stuart 2026-09-09)', () => {
    const rules = { usage: [{ itemId: 'H1-2TRVSPLC', byFeet: { 11: 1, 20: 1, 21: 2 } }] };
    const at = (feet) => explodeTraverse({ family: 'H1-2TRV', align: { setup: 'SINGLE', drive: 'MANUAL', mount: 'WALL', material: 'P', frontRail: '' }, feet, rules, proj: '' })
        .lines.filter(l => l.role === 'splice').reduce((n, l) => n + l.qty, 0);
    assert.equal(at(5), 0);
    assert.equal(at(10), 0);
    assert.equal(at(11), 1);
    assert.equal(at(15), 1);
    assert.equal(at(21), 2);
});

test('the motor is not a painted part', { skip }, () => {
    const r = explodeTraverse({ align: A({ drive: 'MOTORIZED' }), feet: 4, motorItem: 'HSOM-20', rules });
    assert.equal(r.lines.find(l => l.code === 'HSOM-20').subFinish, false);
});


// ── THE 1-3/8" TRAVERSE (S5 hand-off, Stuart 2026-09-10) ─────────────────────────────────────
// "just the rod and brackets change": the rod IS the track (one per-foot part), brackets come in
// two styles at every depth, returns are the fee items on the end steps (never exploded), the
// plug is the H1-2TRV code as a placeholder. Counts here are a fixture in the rules-doc shape;
// the real document is S5's 4.6 import (derived from the H1-2TRV Carrier Usage tab, re-keyed).
const R138 = { usage: [
    { itemId: 'H1-138TRV-H', byFeet: { 4: 2, 6: 3, 8: 4, 12: 5 } },
    { itemId: 'H1-138TRV-V', byFeet: { 4: 2, 6: 3, 8: 4, 12: 5 } },
    { itemId: 'H1-138TRV-VD', byFeet: { 4: 2, 6: 3, 8: 4, 12: 5 } },
    { itemId: 'H1-138TRVJNR', byFeet: { 11: 1, 20: 1 } },
] };
const A138 = (over = {}) => ({ setup: 'SINGLE', drive: 'MANUAL', mount: 'WALL', material: 'P', minFeet: 4, rodKind: 'TRAVERSE', bracketStyle: 'H', ...over });

test('H1-138TRV: a 4 ft -4H/P set = 4 × rod, 2 × H1-138TRV-H, 2 plugs, no splice, no fascia, no track', () => {
    const r = explodeTraverse({ family: 'H1-138TRV', align: A138(), feet: 4, rules: R138, proj: '3.625' });
    assert.equal(q(r, 'H1-138TRV'), 4);
    assert.equal(q(r, 'H1-138TRV-H'), 2);
    assert.equal(q(r, 'H1-2TRVPLUG'), 2);
    assert.equal(q(r, 'H1-138TRVJNR'), undefined);
    assert.ok(!r.lines.some(l => l.role === 'fascia' || l.role === 'track'), 'no fascia / track line');
    assert.equal(r.lines.find(l => l.code === 'H1-138TRV').role, 'rod');
    assert.ok(r.lines.every(l => l.subFinish === false), 'mainline finish — nothing wears the base colour');
});

test('H1-138TRV: the bracket follows the STYLE and the depth', () => {
    const v = explodeTraverse({ family: 'H1-138TRV', align: A138({ bracketStyle: 'V' }), feet: 4, rules: R138, proj: '4.625' });
    assert.equal(q(v, 'H1-138TRV-VE'), 2);
    assert.equal(q(v, 'H1-138TRV-H'), undefined);
    assert.deepEqual(singleProjections('H1-138TRV', 'V').map(p => p.code), ['H1-138TRV-V', 'H1-138TRV-VE', 'H1-138TRV-V6']);
    assert.deepEqual(singleProjections('H1-138TRV').map(p => p.code), ['H1-138TRV-H', 'H1-138TRV-HE', 'H1-138TRV-H6'], 'no style → the first style');
    assert.ok(singleProjections('H1-138TRV').every(p => p.returnArm === ''), 'returns are fee items on the end steps, never arms here');
});

test('H1-138TRV: a 12 ft -4VD/EP double = two rods per ft, 5 × H1-138TRV-VD, 1 × H1-138TRVJNR', () => {
    const r = explodeTraverse({ family: 'H1-138TRV', align: A138({ setup: 'DOUBLE', bracketStyle: 'V', material: 'EP' }), feet: 12, rules: R138 });
    assert.equal(q(r, 'H1-138TRV'), 24);
    assert.equal(q(r, 'H1-138TRV-VD'), 5);
    assert.equal(q(r, 'H1-138TRVJNR'), 1);
    assert.equal(q(r, 'H1-2TRVPLUG'), 2);
});

test('H1-138TRV: motorised has no base motor on the sheet — nothing consumed, and it says so', () => {
    const r = explodeTraverse({ family: 'H1-138TRV', align: A138({ drive: 'MOTORIZED' }), feet: 4, rules: R138 });
    assert.ok(!r.lines.some(l => l.role === 'motor' || l.role === 'plug'));
    assert.ok(r.skipped.some(x => /no base motor/.test(x)));
});

test('H1-138TRV: the explode table and the importer export the SAME codes', { skip: KI.H1_138TRV_PARTS ? false : 'importer export not on this checkout yet' }, () => {
    const mine = TRAVERSE_FAMILY_PARTS['H1-138TRV'];
    assert.equal(mine.rod, KI.H1_138TRV_PARTS.rod);
    assert.equal(mine.splice, KI.H1_138TRV_PARTS.splice);
    assert.deepEqual(mine.brackets, KI.H1_138TRV_PARTS.brackets);
});

test('H1-2TRV is untouched by the style-aware table', { skip }, () => {
    const r = explodeTraverse({ align: A({ setup: 'DOUBLE' }), feet: 12, rules });
    assert.equal(q(r, 'H1-2TRVTRK/C'), 24);
    assert.equal(q(r, 'H1-2TRV-DWB') > 0, true);
    assert.deepEqual(singleProjections().map(p => p.code), ['H1-2TRV-WB', 'H1-2TRV-EWB', 'H1-2TRV-6WB']);
});
