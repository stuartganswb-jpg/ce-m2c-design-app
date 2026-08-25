// ─────────────────────────────────────────────────────────────────────────────────────────────
// DRAW DIRECTION — WHICH WAY THE CURTAIN OPENS
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// Its own module, and deliberately IMPORT-FREE. The spec sheet, the floor screens and the
// configurator all need these words, and traverseConfigurator.js cannot be loaded by a plain Node
// test — it imports './traverseExplode' without an extension — so anything living in there is
// untestable without the rewriting harness. Three constants and a validator have no business
// being hard to test.
// From the McSpadden take-off, where it is drawn as arrows on every window: "there are 3 choices,
// there is center draw, where the curtains open from the middle and open to the left and the
// right… the other two choices are one way left and one way right."
//
// It is not a part and it changes no price — it is an INSTRUCTION. The carriers are assembled to
// it, the master carrier goes on the drawn side, and a track built to the wrong draw opens away
// from the room. So it is captured with the carriers, travels on the order, and prints.
//
// ⚠ ONE WAY LEFT / ONE WAY RIGHT NAME THE DIRECTION THE CURTAIN TRAVELS AS IT CLOSES, which is the
// way the arrow points on the take-off. On the McSpadden bay the LEFT window is drawn pointing
// right — it is a ONE WAY RIGHT — and the right window points left. Naming it after the side the
// stack ends up on would read the opposite way round on the same sheet, so the arrow wins.
export const DRAWS = [
    { value: 'CENTER', label: 'Center draw', hint: 'opens from the middle, to the left and the right' },
    { value: 'LEFT', label: 'One way left', hint: 'the whole curtain travels left as it closes' },
    { value: 'RIGHT', label: 'One way right', hint: 'the whole curtain travels right as it closes' },
];

/** Which side the motor sits on. Only ever asked of a motorised track. */
export const MOTOR_SIDES = [
    { value: 'LEFT', label: 'Motor left' },
    { value: 'RIGHT', label: 'Motor right' },
];

export const drawLabel = (v) => (DRAWS.find(d => d.value === String(v || '').toUpperCase()) || {}).label || '';

/**
 * What is still missing before this track can be built, in the operator's words.
 *
 * The draw is required on EVERY traverse — there is no sensible default, and a track assembled to
 * the wrong one is scrap. The motor side is required only where there is a motor.
 */
export function traverseAnswersMissing({ drive, sel } = {}) {
    const out = [];
    if (!sel || !sel.draw) out.push('draw direction');
    if (String(drive || '').toUpperCase() === 'MOTORIZED' && !sel?.motorSide) out.push('motor side');
    return out;
}
