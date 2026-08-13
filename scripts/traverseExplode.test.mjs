// Explosion tests — the quantities that hit NetSuite inventory. Run against the REAL rules doc
// shape (parsed from the actual sheet when present) so the bracket/splice counts are the table's,
// not a fixture's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { explodeTraverse, usageAt } from './traverseExplode.mjs';
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
