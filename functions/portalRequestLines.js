// WHAT THE CUSTOMER CHOSE, IN WORDS — CJS MIRROR of src/components/Shared/portalRequestLines.js.
//
// ⚠ MIRROR: Cloud Functions deploys only functions/, CRA only imports from src/ — neither can
// reach the other, so this file is a line-for-line copy of the src module (ESM export swapped for
// module.exports). Change BOTH files; the parity test in the scratchpad asserts identical output
// on identical input. The WHY lives in the src copy's header — read it there.

const finishNameFor = (finishes, id, custNames) => {
    const f = (finishes || []).find((x) => x && x.id === id);
    if (!f) return '';
    if (custNames && custNames.size && Array.isArray(f.clientMapping)) {
        const m = f.clientMapping.find((x) => custNames.has(String((x && x.customerId) || '').trim().toUpperCase()));
        if (m && m.clientFinishName) return m.clientFinishName;
    }
    return f.clientName || f.name || f.code || '';
};

const optionFor = (st, sel) => {
    const objs = [
        ...(Array.isArray(st.styleOptions) ? st.styleOptions : []),
        ...(Array.isArray(st.allowedOptions) ? st.allowedOptions.filter((o) => o && typeof o === 'object') : []),
    ];
    return objs.find((o) => (o.optId || o.partId || o.id) === sel) || null;
};

function portalRequestLines(job, flowDoc, finishes, { custNames } = {}) {
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
            const label = (opt && (opt.partName || opt.name || opt.label))
                || finishNameFor(finishes, sel, custNames)
                || sel;
            const finName = finSel ? finishNameFor(finishes, finSel, custNames) : '';
            out.push({ name: `${st.title || 'Option'}: ${label}${finName ? ` · ${finName}` : ''}`, qty });
        } else if (finSel && typeof finSel === 'string') {
            const finName = finishNameFor(finishes, finSel, custNames) || finSel;
            out.push({ name: `${st.title || 'Option'}: ${finName}`, qty });
        }

        if (subSel && typeof subSel === 'string' && Array.isArray(st.subOptions)) {
            const so = st.subOptions.find((o) => o && (o.optId || o.partId) === subSel);
            if (so) out.push({ name: `${st.subLabel || 'Backplate'}: ${so.partName || so.name || subSel}`, qty });
        }
    });

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

module.exports = { portalRequestLines };
