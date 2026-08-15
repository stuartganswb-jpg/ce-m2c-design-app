// TRAVERSE (Stuart 2026-08-03). "TRV in the code stands for traverse — components that sit inside a
// track and traverse back and forth inside the track rather than rings on top of the pole."
//
// A traverse system is not a pole system with different parts; it is a different grammar, and the
// existing tags cannot express it:
//
//   FASCIA    the face of the track — chosen FIRST, before the track itself.
//   TRACK     the extrusion. Its CHOICE is a finish choice, but its CUT LENGTH depends on the
//             drive: a motorised track is cut differently from a manual one.
//   TRV_END   the traverse end — a REAL PART that differs by drive (Stuart 2026-08-04: "should i
//             just tag them the ends?" — yes). Tagging an end as TRACK put it in the track picker
//             beside the actual extrusion, and left the motorised/manual choice as a synthetic
//             label with no part behind it: nothing to bill, nothing to render. As its own role the
//             ends BECOME the answer to the Drive step, so picking one picks a real part.
//   CARRIER   the pieces that ride inside. Never chosen, never changed, always present — they were
//             being tagged HIDE, which is the opposite of what they need: hide means "never render".
//   TRV_BRACKET / TRV_BACKPLATE   mixed-assembly attachments (Stuart 2026-08-15, H1-138): traverse-
//             only brackets and backplates that swap in for the standard ones while the traverse
//             unit is the selected pole. See the MIXED ASSEMBLY block below.
//
// DRIVE TYPE is the other axis. Some collections offer motorised AND manual; some are manual only.
// When both exist the flow needs a step after the track to choose between them, and each choice
// declares which drives it belongs to. A choice tagged for neither belongs to BOTH — the common
// case (a fascia is a fascia however the track is driven), so the default costs nobody a tick.

export const TRAVERSE_ROLES = ['FASCIA', 'TRACK', 'TRV_END', 'FCLIP', 'CARRIER', 'TRV_BRACKET', 'TRV_BACKPLATE', 'TRV_PART'];
export const DRIVE_TYPES = ['MOTORIZED', 'MANUAL'];

// ── SINGLE vs DOUBLE (Stuart 2026-08-04) ────────────────────────────────────────────────────────
// "second step should ask single or double? then if single we limit to one track shown and only
// the single brackets, if double we show both tracks and only the double brackets."
//
// A third axis, independent of drive: a double is TWO tracks on one bracket, so the bracket itself
// is a different part and only one of the two tracks exists on a single. Blank means the choice
// suits BOTH — the common case again (a fascia is a fascia), so the default costs nobody a tick.
// BLANK MEANS SINGLE (Stuart 2026-08-04: "if left blank it should default to single as that is most
// popular, then i only need to go in and select the doubles or both which is a much lower number").
//
// The DEFAULT should be the common case, and here the common case is not "suits both" — a part that
// genuinely fits either setup is rare. So the untagged majority reads as SINGLE and only the doubles
// (and the rare true both) need touching. That inverts the tagging work from hundreds of rows to a
// handful, and it makes an UNTAGGED part safe: it shows on a single, which is what it almost always
// is, instead of showing on everything.
export const TRV_SETUPS = ['SINGLE', 'DOUBLE', 'BOTH'];
// ⚠ REVERTED 2026-08-04, and his own tag dump is why. Blank meant SINGLE for exactly one commit,
// on the theory that "most parts are single parts". The H1-2TRV data says otherwise: rings, plugs,
// drive pulleys, carriers, nuts, the centre/right brackets and every return arm are untagged — and
// under blank=SINGLE every one of them disappeared the moment DOUBLE was chosen. A double order
// rendered a bare rail because almost the whole assembly had been filtered out.
//
// The parts that are genuinely exclusive are a SMALL, PAIRED set — the single bracket vs the double
// bracket, the front track vs the rear. Those are worth tagging on BOTH sides, and everything else
// is shared. So blank means SHARED again: only an explicitly tagged part is ever filtered.
export const setupOf = (choice) => {
    const v = up(choice && choice.trvSetup);
    return TRV_SETUPS.includes(v) ? v : '';        // blank = shared, filtered by nothing
};
export function setupAllows(choice, setup) {
    const want = up(setup);
    if (!want) return true;                          // nothing chosen yet — everything on the table
    // THE FASCIA IS SHARED BY DEFINITION and so are the riders. His 2026-08-04 rule: a double on a
    // fascia system is two TRACKS behind ONE fascia — the fascia is not doubled, in the render or in
    // the BOM. Flipping the default to SINGLE would otherwise have deleted the fascia from every
    // double, so these roles are exempt rather than needing a BOTH tag on every one of them.
    const role = traverseRoleOf(choice);
    // THE TRACK IN THE PICKER IS THE BASE TRACK, and a double has it too. The generator has already
    // partitioned the tracks: a setup:DOUBLE pin is the ADDED track and never becomes an option at
    // all (it rides on the DOUBLE answer's geometry), so whatever survives into the Track step is
    // present in every configuration. Filtering it by setup removed the front track from its own
    // one-option picker the moment DOUBLE was chosen — the pool emptied, the selection was dropped,
    // and the front vanished (Stuart 2026-08-05: "switch to double and rear now appears but front
    // goes away"). Exempt by role for the same reason the fascia is: shared by definition.
    if (role === 'FASCIA' || role === 'TRACK' || isRider(choice)) return true;
    const tag = setupOf(choice);
    return !tag || tag === 'BOTH' || tag === want;   // untagged rides both setups
}
// Ask only when the assembly can actually be built as a double. With blank reading as SINGLE, any
// DOUBLE-capable part means both setups exist — a collection with none of them is single-only and
// must not be asked a question with one answer.
export function needsSetupStep(choices) {
    return (choices || []).some(c => ['DOUBLE', 'BOTH'].includes(setupOf(c)));
}
export function setupsOffered(choices) {
    return needsSetupStep(choices) ? ['SINGLE', 'DOUBLE'] : ['SINGLE'];
}

// ONE MATERIAL, LISTED ONCE (Stuart 2026-08-04: "currently showing 4 choices should just be 2").
// A double pins the SAME rod in the front cluster AND the rear one, so the material picker listed
// every material twice. Dedupe on the part, keeping the first — a material chooser is asking WHICH
// MATERIAL, not which cluster it happened to be pinned in.
// ⚠ DEDUPE MUST MERGE THE GEOMETRY, NOT DISCARD IT (Stuart 2026-08-04: "when H1-2RCTAR is selected
// the fascia disappears").
//
// H1-2RCTAR is pinned in BOTH fascia clusters — SHORT-ROD-CENTER and NEW-SLOT-POLE-CENTER — and each
// copy carries its OWN nodes. Keeping the first and dropping the second meant selecting that
// material lit one cluster's node and left the other's controlled by nothing, so the fascia the eye
// was looking for never appeared. H1-2RCTWR happened to survive because its surviving copy was the
// one holding the visible geometry; that is luck, not correctness, and it is exactly why it looked
// random.
//
// So the duplicates COLLAPSE INTO ONE OPTION THAT OWNS EVERY COPY'S NODES. One material, listed
// once, rendering all of itself.
export function dedupeByPart(choices) {
    const byKey = new Map();
    const out = [];
    (choices || []).forEach(c => {
        const k = String((c && (c.partId || c.optId)) || '').toUpperCase();
        if (!k) { out.push(c); return; }              // unidentifiable: never merged away
        const hit = byKey.get(k);
        if (!hit) { const copy = { ...c }; byKey.set(k, copy); out.push(copy); return; }
        const nodes = [hit.targetNode, c.targetNode]
            .flatMap(t => String(t || '').split(','))
            .map(x => x.trim()).filter(Boolean);
        hit.targetNode = [...new Set(nodes)].join(', ');
    });
    return out;
}

// Parts that are never a customer choice: they ride along and get built. Excluding them is what
// keeps an F-clip out of the Pole / Rod Material picker, where it was appearing.
export const isRider = (choice) => ['FCLIP', 'CARRIER'].includes(traverseRoleOf(choice)) || isAlwaysShown(choice);

const up = (v) => String(v ?? '').trim().toUpperCase();

export const traverseRoleOf = (choice) => {
    const r = up(choice && (choice.traverseRole || choice.role));
    return TRAVERSE_ROLES.includes(r) ? r : '';
};
export const driveTypeOf = (choice) => {
    const d = up(choice && choice.driveType);
    return DRIVE_TYPES.includes(d) ? d : '';
};

// ── MIXED ASSEMBLY ATTACHMENTS (Stuart 2026-08-15, H1-138) ──────────────────────────────────────
// H1-138 sells BOTH grammars in one assembly: standard rods with standard brackets, and an
// integrated traverse unit with its own arms and backplates. "not sure how we could control their
// visibility vs. the standard brackets" — these two roles are that control. They mark a bracket /
// backplate choice as TRAVERSE-ONLY. The standard generator keeps the pole path (AdminTab's mixed
// guard: attach markers + an untagged rod = never fork to buildTraverseFlow, which only offers
// role-tagged poles), and CPQ swaps the pool on the pole answer instead: select the traverse unit
// (a pole choice tagged FASCIA or TRACK) and the trv-tagged attachments are offered while the
// untagged ones hide; select a standard rod and it swaps back.
// TRV_PART (H1-138 first test, 2026-08-15) = the generic "traverse-only" marker for choices that
// are neither brackets nor backplates — e.g. the traverse track returns (138TRVFR / 138TRVMTR)
// that were showing in the End Treatment picker with a standard rod selected.
export const TRV_ATTACH_ROLES = ['TRV_BRACKET', 'TRV_BACKPLATE', 'TRV_PART'];
export const isTrvAttach = (choice) => TRV_ATTACH_ROLES.includes(traverseRoleOf(choice));
// The pole / material choices that flip an order into traverse mode when selected.
export const isTrvPoleChoice = (choice) => ['FASCIA', 'TRACK'].includes(traverseRoleOf(choice));
// One rule for a step's option pool, shared by CPQ's live filter and its stale-selection sweep.
//
// TWO STRENGTHS (H1-138 first test): trv-tagged choices are ALWAYS traverse-only. What happens to
// the UNTAGGED half differs by pool:
//  - mutual (bracket steps + backplate sub-pools): the pools swap — the traverse rod uses ITS OWN
//    arms and plates, so the standard ones hide while it is selected. Activates only in a pool
//    that MIXES tagged and untagged (a pure traverse assembly's untagged brackets — H1-2TRV —
//    are never touched).
//  - asymmetric (everything else, e.g. End Treatment): untagged choices stay put in BOTH modes —
//    a gem finial belongs on the decorative traverse front exactly as on a standard rod. Hiding
//    it there (the first cut of this gate) was wrong; only the trv-tagged returns filter.
export function trvAttachGate(pool, trvPoleSelected, { mutual = true } = {}) {
    const mixes = (pool || []).some(isTrvAttach);
    return (o) => isTrvAttach(o)
        ? !!trvPoleSelected
        : !(mutual && mixes && trvPoleSelected);
}

// ALWAYS SHOWN: present in every configuration, never an option, never swapped. It is a real part —
// it bills and it renders — which is exactly why HIDE was the wrong tag for a carrier.
export const isAlwaysShown = (choice) => !!(choice && choice.alwaysShown === true);

/**
 * Is this choice offered for the selected drive?
 *
 * An untagged choice belongs to BOTH drives — the common case, so the default costs nobody a tick.
 * With no drive selected yet, everything is still on the table.
 */
export function driveAllows(choice, drive) {
    const want = up(drive);
    if (!want) return true;
    const tag = driveTypeOf(choice);
    return !tag || tag === want;
}

/**
 * Does this flow need a Motorised / Manual step at all?
 *
 * Only when the assembly actually carries choices for BOTH. A manual-only collection must not grow
 * a one-option step asking a question with a single answer.
 */
export function needsDriveStep(choices) {
    const tags = new Set((choices || []).map(driveTypeOf).filter(Boolean));
    return tags.has('MOTORIZED') && tags.has('MANUAL');
}

// The drives an assembly can actually be built in. Untagged-only → manual (nothing declared a
// motor), which is the safe reading: a motorised system always has motorised parts to declare.
export function drivesOffered(choices) {
    const tags = [...new Set((choices || []).map(driveTypeOf).filter(Boolean))];
    return tags.length ? DRIVE_TYPES.filter(d => tags.includes(d)) : ['MANUAL'];
}

// The traverse ends, split by drive. When both drives are present they ARE the Drive step — an
// either/or for the whole order (Stuart 2026-08-05: "no combination"), not a per-track sub-choice.
// When only one drive exists there is nothing to ask and the single end must still be BUILT — so
// the caller rides it as an included part rather than dropping it. A real part that vanishes
// because it had no question attached is the failure worth designing against.
export function traverseEnds(choices) {
    const ends = (choices || []).filter(c => traverseRoleOf(c) === 'TRV_END' && !isAlwaysShown(c));
    const drives = [...new Set(ends.map(driveTypeOf).filter(Boolean))];
    return { ends, drives: DRIVE_TYPES.filter(d => drives.includes(d)), isChoice: drives.length > 1 };
}

// ── THE CUT LIST (Stuart 2026-08-04, his numbers) ───────────────────────────────────────────────
// THE FASCIA IS THE DATUM. The customer orders a fascia length the same way they order a pole
// length, and everything else is cut SHORTER than it by a fixed amount that depends on the drive:
//
//                     MANUAL      MOTORIZED
//   fascia            as ordered  as ordered
//   track             −0.5"       −2"
//   F-clip            −1"         −3"
//
// The F-clip is the piece that attaches the track to the fascia — it was missing from the model
// entirely until he named it, which is why it gets its own role rather than riding as hardware.
//
// Deductions, not allowances: the earlier shape (opening + allowance) had the sign and the datum
// both wrong. Nothing is ever cut LONGER than the fascia, so a negative deduction is refused.
export const TRAVERSE_DEDUCTIONS = {
    TRACK: { MANUAL: 0.5, MOTORIZED: 2 },
    FCLIP: { MANUAL: 1, MOTORIZED: 3 },
    FASCIA: { MANUAL: 0, MOTORIZED: 0 },
};

/**
 * What a traverse part is cut to, from the fascia length.
 *
 * Returns null rather than a guess whenever the role, the drive or the length is unusable — a
 * track cut from a made-up number is scrap, and a silent default is how that happens.
 *
 * `deductions` overrides the table above (per assembly, once there is somewhere to enter them).
 */
export function traverseCutLength({ fasciaInches, role, drive, deductions }) {
    const len = Number(fasciaInches);
    if (!Number.isFinite(len) || len <= 0) return null;
    const r = up(role);
    const d = up(drive) || 'MANUAL';
    if (!DRIVE_TYPES.includes(d)) return null;
    const table = (deductions && deductions[r]) || TRAVERSE_DEDUCTIONS[r];
    if (!table) return null;
    const cut = Number(table[d]);
    if (!Number.isFinite(cut) || cut < 0) return null;
    const out = len - cut;
    return out > 0 ? Math.round(out * 100) / 100 : null;
}

// The whole cut list for one configuration — what the shop actually needs on the traveller.
// Roles with no rule are simply absent rather than present-and-wrong.
export function traverseCutList({ fasciaInches, drive, deductions }) {
    return ['FASCIA', 'TRACK', 'FCLIP']
        .map(role => ({ role, cutInches: traverseCutLength({ fasciaInches, role, drive, deductions }) }))
        .filter(x => x.cutInches !== null);
}

// Choices that are never offered but always built — the carriers. Kept separate from the option
// list so a generator can add them to the BOM without ever making them a question.
export const alwaysShownChoices = (choices) => (choices || []).filter(isAlwaysShown);

// Choices a picker should offer for this role and drive: real options only.
export function offeredChoices(choices, { role, drive } = {}) {
    const wantRole = up(role);
    return (choices || []).filter(c =>
        !isAlwaysShown(c) &&
        !(c && c.isHidden) &&
        (!wantRole || traverseRoleOf(c) === wantRole) &&
        driveAllows(c, drive));
}

// SEED THE DOUBLE FROM THE NAME (Stuart 2026-08-04). His double parts already say so —
// "Traverse Double End Return Arm", H12TRVBDBL, H1-2TRVRAD. Reading that is not a guess about
// intent, it is reading the name the designer already wrote, and it turns a tagging pass over
// every row into a review of the handful it flags. Always overridable; only ever SEEDS a blank.
//
// Deliberately narrow: DBL / DOUBLE as a whole word or code tail. "DOUBLED", "TROUBLE" and a
// stray D do not count — a false DOUBLE hides the part from every single, which is the expensive
// direction to be wrong in.
export function suggestSetupFromName(...names) {
    const hay = names.map(n => String(n || '').toUpperCase()).join(' ');
    return /\bDOUBLE\b|\bDBL\b|DBL$|[A-Z]AD$/.test(hay) ? 'DOUBLE' : '';
}
