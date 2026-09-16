// The unit a line is counted in (Stuart 2026-09-16).   node scripts/uom.test.mjs
import { rawUomOf, uomOf, piecesPerUnit, isMultiPiece, uomStampOf, uomLabel } from '../src/components/Shared/uom.js';
let pass = 0, fail = 0;
const eq = (n, got, want) => { const g = JSON.stringify(got), w = JSON.stringify(want); if (g === w) { pass++; return; } fail++; console.log(`✗ ${n}\n    got  ${g}\n    want ${w}`); };
const ok = (n, c) => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}`); };

// ── READING THE UNIT ──────────────────────────────────────────────────────────────────────────
eq('off the item master', uomOf({ manufacturingSpecs: { uom: 'Pair' } }), 'PR');
eq('off a line that already carries it', uomOf({ uom: 'PR' }), 'PR');
eq("a LINE's own stamp wins over the item it came from",
   uomOf({ uom: 'EA', manufacturingSpecs: { uom: 'Pair' } }), 'EA');
eq('a bare string works too', uomOf('Pairs'), 'PR');
eq('an item with no unit is EACH, the honest default', uomOf({ manufacturingSpecs: {} }), 'EA');
eq('nothing at all is EACH', uomOf(null), 'EA');
eq('raw keeps the text verbatim — the count hint lives in it', rawUomOf({ manufacturingSpecs: { uom: 'BAKERS DOZEN - 13' } }), 'BAKERS DOZEN - 13');

// ── ONE SPELLING FOR WHAT THE FLOOR SAYS OUT LOUD ─────────────────────────────────────────────
['Pair', 'PAIRS', 'pr', 'PRS'].forEach(v => eq(`${v} → PR`, uomOf(v), 'PR'));
['Each', 'EACHES', 'ea', 'PC', 'pcs', 'Piece'].forEach(v => eq(`${v} → EA`, uomOf(v), 'EA'));
['Feet', 'foot', 'FT'].forEach(v => eq(`${v} → FT`, uomOf(v), 'FT'));
eq('a real pack keeps its own name — pack units are DATA, not code', uomOf('7PK'), '7PK');

// ── PIECES: ONE PARSER, REUSED ────────────────────────────────────────────────────────────────
eq('a pair is two', piecesPerUnit('PR'), 2);
eq('an each is one', piecesPerUnit('EA'), 1);
eq('a 7-pack is seven', piecesPerUnit('7PK'), 7);
eq('a dozen is twelve', piecesPerUnit('DOZEN'), 12);
ok('a pair is multi-piece', isMultiPiece('PR'));
ok('an each is not', !isMultiPiece('EA'));

// ⚠ THE FOOTGUN: the explicit "- N" suffix OVERRIDES the name, and the display normaliser strips it.
// Counting from the normalised label would silently turn thirteen into twelve.
eq('the explicit count wins over the name', piecesPerUnit('BAKERS DOZEN - 13'), 13);
eq('uomStampOf counts from the RAW unit, so 13 survives',
   uomStampOf({ manufacturingSpecs: { uom: 'BAKERS DOZEN - 13' } }, 2), { uom: 'BAKERS DOZEN', pcs: 26 });

// ── THE STAMP ─────────────────────────────────────────────────────────────────────────────────
eq('3 pairs is 6 pieces', uomStampOf({ manufacturingSpecs: { uom: 'Pair' } }, 3), { uom: 'PR', pcs: 6 });
eq('3 each is 3 pieces', uomStampOf({ manufacturingSpecs: { uom: 'EA' } }, 3), { uom: 'EA', pcs: 3 });
eq('2 × 7PK is 14 pieces', uomStampOf({ manufacturingSpecs: { uom: '7 PACK' } }, 2), { uom: '7 PACK', pcs: 14 });
eq('an unstamped item counts one-for-one', uomStampOf({}, 4), { uom: 'EA', pcs: 4 });
eq('feet keep their fraction — a pole is not pieces', uomStampOf({ manufacturingSpecs: { uom: 'ft' } }, 8.875), { uom: 'FT', pcs: 8.875 });
eq('a missing qty is zero, never NaN', uomStampOf({ manufacturingSpecs: { uom: 'PR' } }, undefined), { uom: 'PR', pcs: 0 });

// ── THE ONE LINE STRING (Stuart's ruling) ─────────────────────────────────────────────────────
eq('3 EA has no meaningless tail', uomLabel(3, 'EA'), '3 EA');
eq("Stuart's exact wording for pairs", uomLabel(3, 'PR'), '3 PR = 6 pcs');
eq('a pack reads as a multiple', uomLabel(3, '7PK'), '3 × 7PK = 21 pcs');
eq('one pair is still two pieces', uomLabel(1, 'Pair'), '1 PR = 2 pcs');
eq('an unknown unit is treated as each', uomLabel(5, ''), '5 EA');

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
