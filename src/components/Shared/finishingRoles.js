// WHO IS A SUPERVISOR ON THE FINISHING FLOOR (Stuart 2026-08-03: "i have my setup manager with all
// matrix checked on the user matrix for finishing and she still does not have access to the force
// complete button").
//
// TWO SEPARATE THINGS WERE BEING CONFUSED. `fin_config/permissions` is a TAB matrix — role → which
// screens they may open. Ticking every box there gets someone onto the Active Floor; it says
// nothing about supervisor actions, which were gated by a hardcoded list of four role strings that
// simply did not include 'setup_manager'. Her matrix was right; the list was short.
//
// A fixed list is the wrong shape for this: every new manager title breaks it silently, and the
// person who ticked all the boxes has no way to tell the button is gated somewhere else. So intent
// is read from the role NAME — a role that manages (…manager, supervisor, …lead) supervises — with
// the known titles kept explicitly so a rename can never quietly remove access.
//
// SUPER ADMIN IS RESOLVED FROM THE DIRECTORY TOO, not just the login token. This is the trap
// CLAUDE.md warns about: super admin is a FLAG on the hq_users record, not a matrix role, so the
// token alone can't always identify it — a super admin could reach the tab and still be refused the
// button inside it. FinishingFloor already does this resolution for tab gating; this does the same
// for actions, so both answers come from the same evidence.
//
// The check is ADDITIVE — it only ever grants. Nothing here can take access away from a role that
// already had it.

export const normRole = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');

// Titles that supervise, kept explicit so a rename in the directory can't silently revoke access.
export const SUPERVISOR_ROLES = [
    'superadmin', 'admin', 'owner',
    'floormanager', 'paintmanager', 'setupmanager', 'productionmanager', 'plantmanager', 'shopmanager',
    'supervisor', 'leadpainter', 'shiftlead',
];

// A role that MANAGES supervises, whatever it is called. Deliberately not a bare 'lead' substring —
// that would catch nothing today and could catch something unintended later.
const nameImpliesSupervisor = (r) => /manager$|^manager|supervisor|lead$|^lead/.test(r);

// The directory record for the signed-in operator. The login token is thin; the hq_users record
// carries superAdmin and the authoritative role. Matched by pin, id, then name.
export function directoryRecordFor(user, users) {
    if (!user) return {};
    const uname = String(user.name || '').toLowerCase();
    return (users || []).find(u =>
        (user.pin && String(u.pin) === String(user.pin)) ||
        (user.id && String(u.id) === String(user.id)) ||
        (uname && String(u.name || '').toLowerCase() === uname)
    ) || {};
}

/**
 * May this person take supervisor actions on the finishing floor (Force Complete, Force Oven
 * Clear, overriding another operator's step)?
 */
export function isFloorSupervisor(user, users) {
    if (!user) return false;
    if (user.superAdmin === true) return true;
    const rec = directoryRecordFor(user, users);
    if (rec.superAdmin === true) return true;
    const roles = [normRole(user.role), normRole(rec.role)].filter(Boolean);
    return roles.some(r => SUPERVISOR_ROLES.includes(r) || nameImpliesSupervisor(r));
}
