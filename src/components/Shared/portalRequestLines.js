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

// ONE QUICK SHIP LINE IN WORDS — the code the counter showed (the collection's face code, else ours), the name, the packs, the note (a cut
// length, a component's "included at 13ft per chart"). A FEE prints by its description alone — the portal never shows a fee's item code
// (the Measure & Fit rule); a cut line is known by its `fee` flag or, on a request sent before it carried one, by the note the server writes.
const stockLineWords = (l) => {
    const isFee = !!l.fee || /^cut( @ |$)/.test(String(l.note || ''));
    const code = isFee ? '' : String(l.aliasErp || l.erp || '').trim();
    const name = String(l.name || '').trim();
    const named = code ? (name && name.toUpperCase() !== code.toUpperCase() ? `${code} — ${name}` : code) : name;
    const packs = l.packUom && Number(l.packSize) > 1 ? ` · ${l.packUom} of ${l.packSize} (${Number(l.eachQty) || (Number(l.qty) || 0) * Number(l.packSize)} ea)` : '';
    return `${named}${packs}${l.note ? ` · ${String(l.note).slice(0, 200)}` : ''}`;
};

// WHICH JOBS PRINT FROM THE REQUEST'S OWN RECORD: a portal request nobody has priced yet — PORTAL_REQUEST, or a Quick Ship request staff
// have loaded into 7. Quick Ship (QUICKSHIP_REVIEW), which until 2026-10-20 printed nothing at all on the customer's card. The customer's
// card (functions/portalMyOrders) and the CRM's Docs ask this one question.
export const printsFromRequest = (job) => !!(job && job.portalRequest)
    && (job.status === 'PORTAL_REQUEST' || (job.status === 'QUICKSHIP_REVIEW' && job.portalRequest.kind === 'QUICKSHIP'))
    && !((job.cpqData && job.cpqData.breakdown) || []).length;

// THE ONE CALL. job = the jobs doc (needs portalRequest), flowDoc = its cpq_flows doc (null-safe),
// finishes = master + outsourced finish list, custNames = Set of UPPER customer names for
// client-facing finish naming. Returns [{ name, qty }]; qty 0 means "show no quantity".
//
// MULTI-LINE (2026-08-10): a portal request may carry portalRequest.lines[] — several
// configurations in one order. Pass `flowById` ({ flowId: flowDoc }) so each line resolves
// through ITS flow; each line gets a `▶ FlowName [Room tag]` header row (isHeader: true).
// Checkout add-ons (portalRequest.addOns) print after the configurations. Single-line legacy
// requests (portalRequest.selections at the top level) render exactly as before.
export function portalRequestLines(job, flowDoc, finishes, { custNames, flowById } = {}) {
    const req = (job && job.portalRequest) || {};
    const out = [];

    // A QUICK SHIP REQUEST (portalRequest.kind 'QUICKSHIP' — the portal's stock counter; its traverse kits since 2026-10-20). It has no
    // flow: until 2026-10-20 it fell through to the configuration rows below and printed one bare "▶ Configuration" per line (Stuart:
    // "quick ship print fix is very important"). It prints what the customer built: each stock line by the code the counter showed them
    // (their collection's face code, else ours), its name, its packs and a cut length — a fee by its description alone; each traverse
    // kit as a block of its own — its lines, the track's answers in words, what it still needs.
    if (req.kind === 'QUICKSHIP') {
        const stock = Array.isArray(req.lines) ? req.lines.filter(Boolean) : [];
        if (stock.length) out.push({ name: `▶ Quick Ship${req.collection ? ` — ${req.collection}` : ''}`, qty: 0, isHeader: true });
        stock.forEach((l) => out.push({ name: stockLineWords(l), qty: Number(l.qty) || 0 }));
        (Array.isArray(req.traverse) ? req.traverse : []).forEach((t) => {
            if (!t) return;
            const tl = Array.isArray(t.lines) ? t.lines.filter(Boolean) : [];
            const code = String((tl[0] && (tl[0].aliasErp || tl[0].erp)) || t.kitCode || '').trim();
            out.push({ name: `▶ Traverse kit${code ? ` ${code}` : ''}`, qty: 0, isHeader: true });
            tl.forEach((l) => out.push({ name: stockLineWords(l), qty: Number(l.qty) || 0 }));
            const said = Array.isArray(t.answerWords) ? t.answerWords.filter(Boolean) : [];
            if (said.length) out.push({ name: `Track: ${said.join(' · ')}`, qty: 0 });
            if (Array.isArray(t.still) && t.still.length) out.push({ name: `Still needed: ${t.still.join(' · ')}`, qty: 0 });
        });
        if (req.note) out.push({ name: `Note: ${String(req.note).slice(0, 300)}`, qty: 0 });
        return out;
    }

    // BUILT ON HQ'S ENGINE (portalRequest.kind 'CONFIG' — the portal rebuild, 2026-10-13). The request's lines are real
    // cart lines (cpqData.cartItems, engine 'TAGS'): what was chosen is read off them — the parts the customer sees,
    // each with its finish in their own words — not re-derived from flow steps, which the tag engine does not use.
    if (req.kind === 'CONFIG') {
        const items = (job && job.cpqData && Array.isArray(job.cpqData.cartItems)) ? job.cpqData.cartItems : [];
        items.forEach((it, i) => {
            if (!it) return;
            const ln = (Array.isArray(req.lines) && req.lines[i]) || {};
            const tag = it.sidemark || ln.lineTag || '';
            out.push({ name: `▶ ${ln.flowName || it.assemblyName || 'Configuration'}${tag ? ` [${tag}]` : ''}${Number(it.qty) > 1 ? ` × ${it.qty}` : ''}`, qty: 0, isHeader: true });
            (Array.isArray(it.pricingBreakdown) ? it.pricingBreakdown : []).filter((l) => l && !l.hidden && !l.isNote).forEach((l) => {
                const finish = l.clientFinishName || l.finishLabel || '';
                out.push({ name: `${l.name || l.legacyErpId || ''}${finish ? ` — ${finish}` : ''}`, qty: Number(l.qty) || 0 });
            });
            // What was said as it was configured — fewer centre brackets than recommended (2026-10-19) — under its configuration.
            (Array.isArray(ln.notes) ? ln.notes : []).forEach((n) => out.push({ name: `Note: ${String(n).slice(0, 300)}`, qty: 0 }));
        });
        if (req.note) out.push({ name: `Note: ${String(req.note).slice(0, 300)}`, qty: 0 });
        return out;
    }

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
