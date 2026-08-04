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
//             ends BECOME the track's sub-choice, so picking one picks a real part.
//   CARRIER   the pieces that ride inside. Never chosen, never changed, always present — they were
//             being tagged HIDE, which is the opposite of what they need: hide means "never render".
//
// DRIVE TYPE is the other axis. Some collections offer motorised AND manual; some are manual only.
// When both exist the flow needs a step after the track to choose between them, and each choice
// declares which drives it belongs to. A choice tagged for neither belongs to BOTH — the common
// case (a fascia is a fascia however the track is driven), so the default costs nobody a tick.

export const TRAVERSE_ROLES = ['FASCIA', 'TRACK', 'TRV_END', 'FCLIP', 'CARRIER'];
export const DRIVE_TYPES = ['MOTORIZED', 'MANUAL'];

// ── SINGLE vs DOUBLE (Stuart 2026-08-04) ────────────────────────────────────────────────────────
// "second step should ask single or double? then if single we limit to one track shown and only
// the single brackets, if double we show both tracks and only the double brackets."
//
// A third axis, independent of drive: a double is TWO tracks on one bracket, so the bracket itself
// is a different part and only one of the two tracks exists on a single. Blank means the choice
// suits BOTH — the common case again (a fascia is a fascia), so the default costs nobody a tick.
export const TRV_SETUPS = ['SINGLE', 'DOUBLE'];
export const setupOf = (choice) => {
    const v = up(choice && choice.trvSetup);
    return TRV_SETUPS.includes(v) ? v : '';
};
export function setupAllows(choice, setup) {
    const want = up(setup);
    if (!want) return true;
    const tag = setupOf(choice);
    return !tag || tag === want;
}
// Ask only when the assembly actually carries both — a single-only collection must not be asked.
export function needsSetupStep(choices) {
    const tags = new Set((choices || []).map(setupOf).filter(Boolean));
    return tags.has('SINGLE') && tags.has('DOUBLE');
}
export function setupsOffered(choices) {
    const tags = [...new Set((choices || []).map(setupOf).filter(Boolean))];
    return tags.length ? TRV_SETUPS.filter(t => tags.includes(t)) : ['SINGLE'];
}

// ONE MATERIAL, LISTED ONCE (Stuart 2026-08-04: "currently showing 4 choices should just be 2").
// A double pins the SAME rod in the front cluster AND the rear one, so the material picker listed
// every material twice. Dedupe on the part, keeping the first — a material chooser is asking WHICH
// MATERIAL, not which cluster it happened to be pinned in.
export function dedupeByPart(choices) {
    const seen = new Set();
    return (choices || []).filter(c => {
        const k = String((c && (c.partId || c.optId)) || '').toUpperCase();
        if (!k || seen.has(k)) return !k;
        seen.add(k);
        return true;
    });
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

// The traverse ends, split by drive. When both drives are present these are the TRACK step's
// sub-choice; when only one is, there is nothing to ask and the single end must still be BUILT —
// so the caller rides it as an included part rather than dropping it. A real part that vanishes
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
