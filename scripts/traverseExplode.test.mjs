// Explosion tests — the quantities that hit NetSuite inventory. Run against the REAL rules doc
// shape (parsed from the actual sheet when present) so the bracket/splice counts are the table's,
// not a fixture's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { explodeTraverse, usageAt, singleProjections, projLabel } from './traverseExplode.mjs';
import { parseTraverseKitSheets } from './traverseKitImport.mjs';

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
