// WHAT THE CUSTOMER CHOSE, IN WORDS (Stuart 2026-08-07: "the documents its capturing are all over
// the place and not data aligned" — the portal card printed a finish as FIN-1779248570692-e6246,
// and the CRM doc for the same quote showed different lines entirely).
//
// An unpriced PORTAL_REQUEST has no cpqData.breakdown — staff price it in CPQ later. Until then the
// only record of what was asked for is portalRequest.selections: raw param ids keyed by step id.
// This module turns that into display lines, and it is THE one way to do it — the portal "My
// Orders" card (functions/portalMyOrders) and the CRM DOCS view (ExternalCoopTab) both render
// through this logic, so the customer and the team read the SAME words for the same request.
//
// ⚠ MIRROR: functions/portalRequestLines.js is a line-for-line CJS copy (Cloud Functions deploys
// only functions/, CRA only imports from src/ — neither can reach the other). Change BOTH files;
// the parity test in the scratchpad asserts identical output on identical input.
//
// WHY THE OLD VERSION PRINTED RAW IDS. It looked a selection up in styleOptions/allowedOptions
// only. A finish pick is not there — it is a FIN-… id living in the FINISHES list (a dedicated
// finish step stores it under params[stepId]; a compound style+finish step stores it under
// params[`${stepId}__finish`], which was skipped entirely, as were backplate `__sub` picks). So a
// finish either printed as its raw id or vanished from the card.

// Resolve a finish id to the name THIS customer knows it by: their clientMapping entry first
// (a Fabricut login sees Fabricut's name for the finish, matching the configurator), else ours.
const finishNameFor = (finishes, id, custNames) => {
    const f = (finishes || []).find((x) => x && x.id === id);
    if (!f) return '';
    if (custNames && custNames.size && Array.isArray(f.clientMapping)) {
        const m = f.clientMapping.find((x) => custNames.has(String((x && x.customerId) || '').trim().toUpperCase()));
        if (m && m.clientFinishName) return m.clientFinishName;
    }
    return f.clientName || f.name || f.code || '';
};

// Option-object lookup across the two shapes steps carry: styleOptions ({optId|partId, partName})
// and object-form allowedOptions ({id|optId, name|label}). String-form allowedOptions (finish-id
// whitelists) hold no label — those resolve through the finishes list instead.
const optionFor = (st, sel) => {
    const objs = [
        ...(Array.isArray(st.styleOptions) ? st.styleOptions : []),
        ...(Array.isArray(st.allowedOptions) ? st.allowedOptions.filter((o) => o && typeof o === 'object') : []),
    ];
    return objs.find((o) => (o.optId || o.partId || o.id) === sel) || null;
};

// THE ONE CALL. job = the jobs doc (needs portalRequest), flowDoc = its cpq_flows doc (null-safe),
// finishes = master + outsourced finish list, custNames = Set of UPPER customer names for
// client-facing finish naming. Returns [{ name, qty }]; qty 0 means "show no quantity".
export function portalRequestLines(job, flowDoc, finishes, { custNames } = {}) {
    const req = (job && job.portalRequest) || {};
    const params = (req.selections && req.selections.params) || {};
    const qtys = (req.selections && req.selections.quantities) || {};
    const steps = (flowDoc && flowDoc.steps) || [];
    const out = [];

    steps.forEach((st) => {
        const sel = params[st.id];
        const finSel = params[`${st.id}__finish`];
        const subSel = params[`${st.id}__sub`];
        const qty = Number(qtys[st.id]) || 0;

        if (sel && typeof sel === 'string') {
            const opt = optionFor(st, sel);
            // A dedicated finish step's selection IS a finish id — resolve it as one before
            // giving up and echoing the raw value.
            const label = (opt && (opt.partName || opt.name || opt.label))
                || finishNameFor(finishes, sel, custNames)
                || sel;
            const finName = finSel ? finishNameFor(finishes, finSel, custNames) : '';
            out.push({ name: `${st.title || 'Option'}: ${label}${finName ? ` · ${finName}` : ''}`, qty });
        } else if (finSel && typeof finSel === 'string') {
            // Finish chosen on a compound step whose main pick is empty — still their choice.
            const finName = finishNameFor(finishes, finSel, custNames) || finSel;
            out.push({ name: `${st.title || 'Option'}: ${finName}`, qty });
        }

        if (subSel && typeof subSel === 'string' && Array.isArray(st.subOptions)) {
            const so = st.subOptions.find((o) => o && (o.optId || o.partId) === subSel);
            if (so) out.push({ name: `${st.subLabel || 'Backplate'}: ${so.partName || so.name || subSel}`, qty });
        }
    });

    // Flow gone or empty (deleted/renamed since the request): echo the raw selections rather than
    // showing an empty card — a raw id is a worse label but a better record than nothing.
    if (!steps.length) {
        Object.entries(params).forEach(([k, v]) => {
            if (typeof v !== 'string' || /__dims$/.test(k)) return;
            const label = finishNameFor(finishes, v, custNames) || v;
            out.push({ name: `${k}: ${label}`, qty: Number(qtys[k]) || 0 });
        });
    }

    if (req.note) out.push({ name: `Note: ${String(req.note).slice(0, 300)}`, qty: 0 });
    return out;
}
