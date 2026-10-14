// ─────────────────────────────────────────────────────────────────────────────────────────────
// A PRODUCT ON THE PORTAL IS OFF, ON PREVIEW, OR LIVE (Stuart 2026-10-14: "yes love the preview idea")
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// CRM → Portal Access sets, per customer, which CPQ flows their portal may configure. LIVE is what it always was
// (crm_records.portalFlowIds). PREVIEW (portalPreviewFlowIds) is a product tried on the customer's own account —
// their numbers, their level — and seen ONLY by the logins ticked "sees previews" (portalPreviewUids, by login
// uid). So a flow is proved as the customer will see it before any of their people can; then it goes live.
//
// The portal's server reads the same three fields (functions/portalSession.flowIdsFor); scripts/portalAccess.test.mjs
// holds the two to the same answer.

const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x) : []);

export const FLOW_MODE = { OFF: 'OFF', PREVIEW: 'PREVIEW', LIVE: 'LIVE' };

// One flow's mode on a customer record — live wins if a flow is somehow on both lists.
export function flowModeOf(crm, flowId) {
    if (list(crm && crm.portalFlowIds).includes(flowId)) return FLOW_MODE.LIVE;
    if (list(crm && crm.portalPreviewFlowIds).includes(flowId)) return FLOW_MODE.PREVIEW;
    return FLOW_MODE.OFF;
}

// The mode of several flows that are one product (a size group): one mode when they agree, MIXED when not.
export function groupModeOf(crm, flowIds) {
    const modes = [...new Set((flowIds || []).map((id) => flowModeOf(crm, id)))];
    return modes.length === 1 ? modes[0] : 'MIXED';
}

// The two lists after setting these flows to a mode — every other flow untouched, no flow on both lists.
export function withFlowMode(crm, flowIds, mode) {
    const ids = list(flowIds);
    const live = list(crm && crm.portalFlowIds).filter((id) => !ids.includes(id));
    const preview = list(crm && crm.portalPreviewFlowIds).filter((id) => !ids.includes(id));
    if (mode === FLOW_MODE.LIVE) live.push(...ids);
    if (mode === FLOW_MODE.PREVIEW) preview.push(...ids);
    return { portalFlowIds: live, portalPreviewFlowIds: preview.filter((id) => !live.includes(id)) };
}

// The logins that see previews, after ticking one on or off.
export function withPreviewer(crm, uid, on) {
    const uids = list(crm && crm.portalPreviewUids).filter((x) => x !== uid);
    return on && uid ? [...uids, uid] : uids;
}

// What a login may open — the same answer the portal's server gives (functions/portalSession.flowIdsFor).
export function flowIdsForLogin(crm, uid) {
    const live = list(crm && crm.portalFlowIds);
    const previewer = !!uid && list(crm && crm.portalPreviewUids).includes(String(uid));
    const preview = previewer ? list(crm && crm.portalPreviewFlowIds).filter((id) => !live.includes(id)) : [];
    return { live, preview, all: [...live, ...preview] };
}
