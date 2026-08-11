// WHAT THE CUSTOMER CHOSE, IN WORDS — CJS MIRROR of src/components/Shared/portalRequestLines.js.
//
// ⚠ MIRROR: Cloud Functions deploys only functions/, CRA only imports from src/ — neither can
// reach the other, so this file is a line-for-line copy of the src module (ESM export swapped for
// module.exports). Change BOTH files; the parity test in the scratchpad asserts identical output
// on identical input. The WHY lives in the src copy's header — read it there.

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

// Rows for ONE configuration's selections against one flow doc (null-safe).
const selectionRows = (selections, flowDoc, finishes, custNames) => {
    const params = (selections && selections.params) || {};
    const qtys = (selections && selections.quantities) || {};
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
    return out;
};

// THE ONE CALL. job = the jobs doc (needs portalRequest), flowDoc = its cpq_flows doc (null-safe),
// finishes = master + outsourced finish list, custNames = Set of UPPER customer names for
// client-facing finish naming. Returns [{ name, qty }]; qty 0 means "show no quantity".
//
// MULTI-LINE (2026-08-10): a portal request may carry portalRequest.lines[] — several
// configurations in one order. Pass `flowById` ({ flowId: flowDoc }) so each line resolves
// through ITS flow; each line gets a `▶ FlowName [Room tag]` header row (isHeader: true).
// Checkout add-ons (portalRequest.addOns) print after the configurations. Single-line legacy
// requests (portalRequest.selections at the top level) render exactly as before.
function portalRequestLines(job, flowDoc, finishes, { custNames, flowById } = {}) {
    const req = (job && job.portalRequest) || {};
    const out = [];

    const lines = Array.isArray(req.lines) && req.lines.length ? req.lines : null;
    if (lines) {
        lines.forEach((ln) => {
            if (!ln) return;
            const fd = (flowById && flowById[String(ln.flowId || '')]) || (lines.length === 1 ? flowDoc : null);
            out.push({ name: `▶ ${ln.flowName || 'Configuration'}${ln.lineTag ? ` [${ln.lineTag}]` : ''}`, qty: 0, isHeader: true });
            out.push(...selectionRows(ln.selections, fd, finishes, custNames));
        });
    } else {
        out.push(...selectionRows(req.selections, flowDoc, finishes, custNames));
    }

    (Array.isArray(req.addOns) ? req.addOns : []).forEach((a) => {
        if (!a) return;
        out.push({ name: `Add-on: ${a.name || a.code || ''}`, qty: Number(a.qty) || 0 });
    });

    if (req.note) out.push({ name: `Note: ${String(req.note).slice(0, 300)}`, qty: 0 });
    return out;
}

module.exports = { portalRequestLines };
