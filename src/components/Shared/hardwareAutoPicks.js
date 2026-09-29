// ── THE PICKS THE CONFIGURATOR MAKES ON THE OPERATOR'S BEHALF ────────────────────────────────────
//
// Moved here, rule for rule, from HardwareConfigurator (2026-09-29) so that every reader of a
// configuration settles it the same way: the CPQ screen, and the spec sheets that draw each set-up
// exactly as the configurator would show it. One rule, one module — never a copy.
//
// Pure: no React, no Firestore. It reads the resolved model and the operator's own (already
// reseated) picks and says which slots the configurator fills by itself.
//
// ── A DECISION ALREADY MADE IS NOT A STEP (Stuart 2026-08-21) ────────────────────────────
// "when selecting the h1-2trv … the drive on step 1 manual or motorized, that can be set to
// ahead and make the decision for the traverse end which is being presented as steps 12 + 13 …
// it just only presents one choice since there is only one end for manual and one end for
// motorized so this just really needs to be put in the bom and not presented as another
// decision that has already been made by selecting the drive choice."
//
// Exactly so. The traverse end is a REAL part that differs by drive — which is why it has its
// own role rather than sitting in the track picker — and the drive answer at step 1 already
// names it. Asking again is asking the same question twice and calling the second one step 12.
//
// ⚠ THE TAGS ALREADY DID THE WORK. This adds no rule about drives: the end that survives is the
// one whose tag admits the answer given, which is the same filtering every other slot gets. All
// that changes is that a slot left holding ONE end stops being a question and becomes a pick
// the engine makes — so it prices, renders, reaches the BOM and pushes exactly as if it had
// been clicked. Tag a second manual end tomorrow and the question comes back on its own.
// ⚠ NOTHING SETTLES BEFORE ITS WORLD EXISTS (Stuart 2026-08-29, H1-2TRV: an end plug AND a
// Somfy pulley rendered and billed on an untouched screen). The settle rule fired the moment a
// TRV_END slot held one option — including before the rod type was even answered, when the 1.6
// rework left each end in its own single-option slot. Same restraint the ring and return rules
// state: only judged once a rod is CHOSEN. The ends still auto-pick the instant a traverse rod
// is selected and the drive answer has filtered them — that behavior is unchanged.
// ── STEP 1 DECIDES THE TRACKS (Stuart 2026-08-31) ────────────────────────────────────────
// "if single, then show one track … if double then show 2 tracks, if double with front
//  stationary fascia rings then one track." Which tracks are on the order falls out of the
//  setup + frontLayer answers, so a track slot left holding ONE admissible option is not a
//  question — it picks itself. The STEP stays on screen (unlike a settled end) because it
//  still carries a real decision: the custom-finish upcharge. Gated on setup being ANSWERED —
//  the same restraint as the ends, so an untouched screen never bills a track.
import { ROD_ROLES, TRAVERSE } from './hardwareModel.js';

/**
 * @param {object} p
 * @param {object} p.model          a resolved model (hardwareModel.resolve): its slots and choices
 * @param {object} p.answers        the operator's answers (setup gates the tracks)
 * @param {object} p.operatorPicks  the operator's own picks by slot key, already reseated (reseatPicks)
 * @returns {{ trackAuto: object, settledKeys: Set<string>, livePicks: object }}
 *   trackAuto   — slot key → choice id for the tracks STEP 1 decided
 *   settledKeys — the TRV_END slots the drive answer settled (never shown as a step)
 *   livePicks   — every pick the configuration reads: the automatic ones, with the operator's own on top
 */
export function autoPicksOf({ model, answers, operatorPicks }) {
    const slots = model?.slots || [];
    const own = operatorPicks || {};
    const trackAuto = {};
    if (answers?.setup) {
        slots.forEach(s => {
            if (s.kind === 'TRACK' && !s.suppressedBy && s.options.length === 1) trackAuto[s.key] = s.options[0].id;
        });
    }
    const chosenIds = new Set([...Object.values(own), ...Object.values(trackAuto)]);
    const trvChosen = (model?.choices || []).some(c => chosenIds.has(c.id) && ROD_ROLES.includes(c.role) && c.rodKind === TRAVERSE);
    const settledKeys = trvChosen
        ? new Set(slots.filter(s => s.kind === 'TRV_END' && s.options.length === 1).map(s => s.key))
        : new Set();
    const auto = { ...trackAuto };
    slots.forEach(s => { if (settledKeys.has(s.key)) auto[s.key] = s.options[0].id; });
    // An operator's own pick still wins, so nothing here can overwrite an answer.
    return { trackAuto, settledKeys, livePicks: { ...auto, ...own } };
}
