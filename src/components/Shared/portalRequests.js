// PORTAL REQUESTS WAITING FOR US (Stuart 2026-10-20: "Portal Requests right on CRM main screen add * everytime a new that has never
// been opened arrives"). One reading for the CRM's Portal Requests panel and HQ's red * on the CRM tab: a request is a jobs doc in
// PORTAL_REQUEST — the portal's Configure door writes kind CONFIG, its Quick Ship door kind QUICKSHIP — and it is NEW until a member of
// staff first opens it, which stamps portalRequest.openedAt / openedBy (the first opening is the one kept; nothing else on the request
// is touched). A request leaves the list when staff take it on — priced in CPQ, loaded in Quick Ship — because its status moves on. Pure.

export const isPortalRequest = (j) => !!j && j.status === 'PORTAL_REQUEST';
/** Nobody has opened it yet. */
export const isUnopened = (j) => isPortalRequest(j) && !(j.portalRequest && j.portalRequest.openedAt);

const whenOf = (j) => {
    const c = j && j.createdAt;
    if (c && typeof c.seconds === 'number') return c.seconds * 1000;
    const d = Date.parse((j && j.dateSaved) || '');
    return Number.isFinite(d) ? d : 0;
};
/** This brand's requests, newest first — and any that carry no brand at all (a customer with none on their record), so none is invisible. */
export const portalRequestsOf = (jobs, brand) => (Array.isArray(jobs) ? jobs : [])
    .filter((j) => isPortalRequest(j) && (!j.brandId || j.brandId === brand))
    .sort((a, b) => whenOf(b) - whenOf(a));

/** Which door it came through, in words. */
export const requestKindOf = (j) => ((j && j.portalRequest && j.portalRequest.kind) === 'QUICKSHIP' ? 'Quick Ship' : 'Configured');
/** What it holds, in words: Quick Ship's stock lines and traverse kits, or the configurations. */
export function requestSummaryOf(j) {
    const pr = (j && j.portalRequest) || {};
    const n = Array.isArray(pr.lines) ? pr.lines.length : 0;
    if (pr.kind === 'QUICKSHIP') {
        const k = Array.isArray(pr.traverse) ? pr.traverse.length : 0;
        return [n ? `${n} stock line${n === 1 ? '' : 's'}` : '', k ? `${k} traverse kit${k === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ') || 'nothing in it';
    }
    const c = n || (pr.selections ? 1 : 0);
    return `${c} configuration${c === 1 ? '' : 's'}`;
}
/** Its total as the request was priced, or null when it carries none. */
export function requestTotalOf(j) {
    const pr = (j && j.portalRequest) || {};
    const t = Number(pr.total != null ? pr.total : (j && j.cpqData && j.cpqData.totalPrice));
    return Number.isFinite(t) && t > 0 ? t : null;
}
/** The first opening, as an update to the job — field paths, so nothing else on the request moves. */
export const openedPatchOf = (who, at = new Date().toISOString()) => ({ 'portalRequest.openedAt': at, 'portalRequest.openedBy': String(who || 'staff') });
