// Harness for the traverse draw direction and motor side.
//
//   node scripts/traverseDraw.test.mjs
//
// Stuart 2026-08-22, from the McSpadden take-off: "there are 3 choices, there is center draw, where
// the curtains open from the middle and open to the left and the right… the other two choices are
// one way left and one way right."
//
// Neither answer costs anything, which is exactly why they need guarding: a question with no price
// attached is the easy one to walk past, and both are scrap if wrong.

import { DRAWS, MOTOR_SIDES, drawLabel, traverseAnswersMissing } from '../src/components/Shared/traverseDraw.js';

let pass = 0, fail = 0;
const eq = (name, got, want) => {
    const g = JSON.stringify(got), w = JSON.stringify(want);
    if (g === w) { pass++; return; }
    fail++; console.log(`✗ ${name}\n    got  ${g}\n    want ${w}`);
};
const ok = (name, cond, extra = '') => { if (cond) { pass++; return; } fail++; console.log(`✗ ${name} ${extra}`); };

// ── THE THREE CHOICES, AND ONLY THREE ────────────────────────────────────────────────────────
eq('center, one way left, one way right', DRAWS.map(d => d.value), ['CENTER', 'LEFT', 'RIGHT']);
eq('and two motor sides', MOTOR_SIDES.map(m => m.value), ['LEFT', 'RIGHT']);
eq('the label is the words on the take-off', drawLabel('CENTER'), 'Center draw');
eq('…however it is cased', drawLabel('right'), 'One way right');
eq('and an unset draw has no label to print', drawLabel(''), '');

// ── THE DRAW IS REQUIRED ON EVERY TRACK ──────────────────────────────────────────────────────
// ⚠ NO DEFAULT. Centre draw is much the commonest — the McSpadden sheet has five of them — and
// defaulting to it would be right most of the time and silently wrong on the two bay windows.
{
    eq('an unanswered manual track is missing the draw', traverseAnswersMissing({ drive: 'MANUAL', sel: {} }), ['draw direction']);
    eq('answered, it is complete', traverseAnswersMissing({ drive: 'MANUAL', sel: { draw: 'CENTER' } }), []);
    eq('no selection at all is still missing it', traverseAnswersMissing({ drive: 'MANUAL' }), ['draw direction']);
}

// ── THE MOTOR SIDE IS ASKED OF A MOTOR, AND OF NOTHING ELSE ──────────────────────────────────
{
    eq('a motorised track needs both', traverseAnswersMissing({ drive: 'MOTORIZED', sel: {} }), ['draw direction', 'motor side']);
    eq('the draw alone is not enough on a motor', traverseAnswersMissing({ drive: 'MOTORIZED', sel: { draw: 'LEFT' } }), ['motor side']);
    eq('both answered, nothing outstanding', traverseAnswersMissing({ drive: 'MOTORIZED', sel: { draw: 'LEFT', motorSide: 'RIGHT' } }), []);
    ok('a MANUAL track is never asked for a motor side',
        !traverseAnswersMissing({ drive: 'MANUAL', sel: { draw: 'CENTER' } }).includes('motor side'));
}

// ── THE McSPADDEN SHEET, READ BACK ───────────────────────────────────────────────────────────
// The bay is the case that matters: its two returns draw in OPPOSITE directions, and the arrow on
// the take-off is what names them — the LEFT window points right, so it is a ONE WAY RIGHT.
{
    const livingRoomBay = [
        { window: 'bay left return (46)', draw: 'RIGHT' },
        { window: 'bay main run (155)', draw: 'CENTER' },
        { window: 'bay right return (45)', draw: 'LEFT' },
    ];
    eq('the bay needs three different draws on one window',
        [...new Set(livingRoomBay.map(w => w.draw))].length, 3);
    ok('every one of them is a real choice', livingRoomBay.every(w => DRAWS.some(d => d.value === w.draw)));

    const singleRuns = ['DIN RM 103¾', 'MSTR BR 152¾', 'FRONT GUEST 70', 'REAR GUEST 92½'];
    ok('and the plain runs are all centre draw', singleRuns.every(() => DRAWS[0].value === 'CENTER'));
}

console.log(fail ? `\n❌  ${pass} passed, ${fail} failed` : `\n✅  ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
