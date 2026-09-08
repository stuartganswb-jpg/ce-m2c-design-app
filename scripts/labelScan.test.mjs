// What a scanned label means, offline.
//   node scripts/labelScan.test.mjs
//
// Stuart 2026-09-08, the UOM label. A wrong answer here miscounts a customer's order — scanning
// two 7-packs must read as fourteen rings, not two — so the arithmetic is pinned before any screen
// depends on it. The rule that matters most: EVERY LABEL PRINTED BEFORE TODAY still parses to what
// it always meant, so a screen can adopt parseScan without changing behaviour.

import {
    upScan, encodeUomScan, parseScan, scannedCode, scannedPcs, scanTally, uomDisplay,
} from '../src/components/Shared/labelScan.js';

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}`); };
const eq = (n, got, want) => {
    const g = JSON.stringify(got), w = JSON.stringify(want);
    if (g === w) { pass++; return; }
    fail++; console.log(`✗ ${n}\n    got  ${g}\n    want ${w}`);
};

// ── EVERY OLD LABEL STILL MEANS WHAT IT MEANT ────────────────────────────────────────────────
eq('a plain code is that item, one piece', parseScan('H1-138RG'), { code: 'H1-138RG', uom: '', pcs: 1, isUom: false, raw: 'H1-138RG' });
eq('a finish suffix survives', scannedCode('h1-138bs/ep1'), 'H1-138BS/EP1');
eq('a fee code survives', scannedCode('FEE-H1-MRPF'), 'FEE-H1-MRPF');
eq('whitespace and case are normalised', scannedCode('  h1-138rg '), 'H1-138RG');
eq('an empty scan is empty, not a crash', parseScan('').code, '');
eq('null is safe', scannedPcs(null), 1);

// ── THE UOM LABEL ────────────────────────────────────────────────────────────────────────────
eq('a 7-pack encodes item*unit*pieces', encodeUomScan({ code: 'H1-138RG', uom: '7PK', pcs: 7 }), 'H1-138RG*7PK*7');
eq('and reads back whole', parseScan('H1-138RG*7PK*7'), { code: 'H1-138RG', uom: '7PK', pcs: 7, isUom: true, raw: 'H1-138RG*7PK*7' });
eq('a pair is two', parseScan(encodeUomScan({ code: 'HCUSMBF1/BL', uom: 'PR', pcs: 2 })).pcs, 2);
eq('a single does NOT become a fake pack', encodeUomScan({ code: 'H1-138RG', uom: 'EA', pcs: 1 }), 'H1-138RG');
eq('no unit means no composite', encodeUomScan({ code: 'H1-138RG', uom: '', pcs: 7 }), 'H1-138RG');
eq('no code encodes to nothing', encodeUomScan({ code: '', uom: '7PK', pcs: 7 }), '');
eq('a separator inside a unit name cannot lie', encodeUomScan({ code: 'A', uom: '7*PK', pcs: 7 }), 'A*7PK*7');
eq('lower case round-trips', parseScan(encodeUomScan({ code: 'h1-138rg', uom: '10pack', pcs: 10 })), { code: 'H1-138RG', uom: '10PACK', pcs: 10, isUom: true, raw: 'H1-138RG*10PACK*10' });

// ── MALFORMED FALLS BACK TO THE ITEM, NEVER TO A BIGGER NUMBER ───────────────────────────────
eq('a half-typed composite is the item, one piece', parseScan('H1-138RG*7PK'), { code: 'H1-138RG', uom: '', pcs: 1, isUom: false, raw: 'H1-138RG*7PK' });
eq('a non-numeric count is not trusted', parseScan('H1-138RG*7PK*SEVEN').pcs, 1);
eq('zero is not a pack', parseScan('H1-138RG*7PK*0').pcs, 1);
eq('a negative count is not a pack', parseScan('H1-138RG*7PK*-3').pcs, 1);
ok('and the item is still recoverable from a malformed scan', scannedCode('H1-138RG*7PK*SEVEN') === 'H1-138RG');

// ── THE WARNING STUART DESCRIBED ─────────────────────────────────────────────────────────────
const twoPacks = ['H1-138RG*7PK*7', 'H1-138RG*7PK*7'];
let t = scanTally(twoPacks, 14);
eq('two 7-packs are fourteen rings', t.pcs, 14);
ok('and that exactly meets a need of 14', t.exact && !t.over && !t.short);
ok('the summary reads as he said it', /2 × 7PK \(14 pcs\)/.test(t.summary));

t = scanTally(['HCUSMBF1*PR*2', 'HCUSMBF1*PR*2'], 4);
eq('two pairs are four pieces', t.pcs, 4);
ok('two 2PR meeting a need of 4 is exact', t.exact);

t = scanTally(['H1-138RG*7PK*7'], 14);
ok('one 7-pack against 14 needed is SHORT', t.short && !t.over);
eq('and says how many are still wanted', t.remaining, 7);

t = scanTally(twoPacks, 4);
ok('two 7-packs against 4 needed is OVER', t.over && !t.short);
eq('over does not report a remainder', t.remaining, 0);

t = scanTally(['H1-138RG', 'H1-138RG', 'H1-138RG*7PK*7'], 9);
eq('mixed singles and packs add up', t.pcs, 9);
ok('and the summary groups them', /2 × EA/.test(t.summary) && /1 × 7PK \(7 pcs\)/.test(t.summary));
eq('nothing scanned is nothing counted', scanTally([], 5).pcs, 0);
eq('no need stated means no verdict', [scanTally(twoPacks, 0).over, scanTally(twoPacks, 0).short, scanTally(twoPacks, 0).exact], [false, false, false]);

// ── DISPLAY ──────────────────────────────────────────────────────────────────────────────────
eq('a pack shows its piece count', uomDisplay('7PK', 7), '7PK (7 pcs)');
eq('a pair shows its two', uomDisplay('pr', 2), 'PR (2 pcs)');
eq('a single stays plain', uomDisplay('EA', 1), 'EA');
eq('a missing unit reads EA', uomDisplay('', 1), 'EA');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
