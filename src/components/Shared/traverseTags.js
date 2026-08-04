// TRAVERSE (Stuart 2026-08-03). "TRV in the code stands for traverse — components that sit inside a
// track and traverse back and forth inside the track rather than rings on top of the pole."
//
// A traverse system is not a pole system with different parts; it is a different grammar, and the
// existing tags cannot express it:
//
//   FASCIA    the face of the track — chosen FIRST, before the track itself.
//   TRACK     the extrusion. Its CHOICE is a finish choice, but its CUT LENGTH depends on the
//             drive: a motorised track is cut differently from a manual one.
//   CARRIER   the pieces that ride inside. Never chosen, never changed, always present — they were
//             being tagged HIDE, which is the opposite of what they need: hide means "never render".
//
// DRIVE TYPE is the other axis. Some collections offer motorised AND manual; some are manual only.
// When both exist the flow needs a step after the track to choose between them, and each choice
// declares which drives it belongs to. A choice tagged for neither belongs to BOTH — the common
// case (a fascia is a fascia however the track is driven), so the default costs nobody a tick.

export const TRAVERSE_ROLES = ['FASCIA', 'TRACK', 'CARRIER'];
export const DRIVE_TYPES = ['MOTORIZED', 'MANUAL'];

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

/**
 * The track cut for a drive.
 *
 * The finished opening is the same either way — what differs is what the drive mechanism consumes
 * at the ends, so each drive carries its own allowance and the cut is opening + allowance. Returns
 * null rather than a guess when the allowance for that drive has not been set, because a track cut
 * from a made-up number is scrap.
 */
export function trackCutLength({ openingInches, drive, allowances }) {
    const opening = Number(openingInches);
    if (!Number.isFinite(opening) || opening <= 0) return null;
    const key = up(drive) || 'MANUAL';
    const add = allowances ? Number(allowances[key]) : NaN;
    if (!Number.isFinite(add)) return null;
    return Math.round((opening + add) * 100) / 100;
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
