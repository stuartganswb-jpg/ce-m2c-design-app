import { isDisplayOnlyLine } from './lineClassification.js';
import { shopLeadCodeOf } from './splitPlan.js';

// ── THE SHOP'S FACTS FROM A CPQ JOB — one builder (Stuart 2026-09-27, SO60551) ─────────────────────
// The CPQ split (HQ/RTGDispatchTab.autoSplitSalesOrder) put the job's cut sheet, fabrication method, Vision
// notes and drawing on its shop document, built inline; RTG's shop release for any other record (pushToShop —
// an Order Entry / 10.5 row pair) never read them, so a row's pole reached the shop with no bend or return
// instructions and no drawing. Both now call this. Pure: the job document in, the fields out.
//
// Note the scope CPQ has always had: `engineeringNotes` is the JOB's (CPQ saves one cart item's), so on a
// multi-configuration job the counts are that configuration's. A row's own fabrication rides its cut list as
// riders (Shared/oeClassify) — the notes here are the job's, labelled as such by the shop card.

/** The job's Vision cut sheet, method and notes — exactly the fields the CPQ split stamped. */
export const jobFabFactsOf = (job) => {
    const eng = (job && job.engineeringNotes) || {};
    const fabNotes = {
        shape: eng.shape || null,
        qtyBends: eng.qtyBends || 0,
        qtySplices: eng.qtySplices || 0,
        qtyMiters: eng.qtyMiters || 0,
        qtyMiterReturns: eng.qtyMiterReturns || 0,
        poleO2O: eng.poleO2O || null,
        totalSystemO2O: eng.totalSystemO2O || null,
        // Full cut sheet from Vision: per-segment finished lengths + raw cuts + miter saw / wall angles + bend
        // radius / pole diameter, so the shop gets the cut+bend detail, not just counts.
        pole1: eng.pole1 ?? null, pole2: eng.pole2 ?? null, pole3: eng.pole3 ?? null,
        rawLeft: eng.rawLeft ?? null, rawCenter: eng.rawCenter ?? null, rawRight: eng.rawRight ?? null,
        sawAngle1: eng.sawAngle1 ?? null, sawAngle2: eng.sawAngle2 ?? null,
        wallAngleL: eng.wallAngleL ?? null, wallAngleR: eng.wallAngleR ?? null,
        returnRadius: eng.returnRadius ?? null, poleDiameter: eng.poleDiameter ?? null,
        // Hidden-hanger mount positions captured in Vision (FIPBH per bracket, FIPBHS per splice).
        hangerLocations: Array.isArray(eng.hangerLocations) ? eng.hangerLocations : [],
        // Traverse cuts by drive (RTG_TRAVERSE_CUTS_PATCH 2026-09-08); absent on every solid-pole job.
        traverseCuts: Array.isArray(eng.traverseCuts) ? eng.traverseCuts : null,
        drive: eng.drive || null, setup: eng.setup || null, frontLayer: eng.frontLayer || null, rodKind: eng.rodKind || null,
    };
    const fabMethod = eng.qtyBends > 0 ? 'BEND' : (eng.qtySplices > 0 ? 'SPLICE' : (eng.qtyMiters > 0 ? 'MITER' : null));
    const cartItems = (job && job.cpqData && job.cpqData.cartItems) || [];
    const visionNotes = cartItems.flatMap(it => Array.isArray(it.generalNotes) ? it.generalNotes : []).map(s => String(s || '').trim()).filter(Boolean);
    const bracketNotes = cartItems.flatMap(it => Array.isArray(it.bracketNotes) ? it.bracketNotes : []).filter(b => b && b.note && String(b.note).trim());
    const visionUsed = !!(Object.keys(eng).length || (Array.isArray(eng.hangerLocations) && eng.hangerLocations.length) || bracketNotes.length);
    return { fabNotes, fabMethod, visionNotes, bracketNotes, visionUsed };
};

/** A custom pole with a cut and a job with no Vision cut sheet: the shop card says so (C, 2026-09-03). */
export const cutSheetMissingOf = (job, customLines = []) => {
    const eng = (job && job.engineeringNotes) || {};
    return (customLines || []).some(l => l && l.cutLength) && !eng.shape && !eng.poleO2O && eng.pole1 == null && eng.pole2 == null && eng.pole3 == null;
};

/** The drawing: the CRM's Vision drawing, else the job's own SVG, else its final image. */
export const jobDrawingOf = (job, svgUri = null) => {
    const eng = (job && job.engineeringNotes) || {};
    return svgUri
        || (eng.svgString ? 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(eng.svgString) : null)
        || (job && job.finalImageUrl) || null;
};

/**
 * The fields RTG's shop release (HQ/RTGDispatchTab.pushToShop) writes on a shop document for a parked record —
 * a stock build, a component work order, or an Order Entry / 10.5 row pair. A row pair (source ORDER_ENTRY)
 * names itself, lists its own cut list as its spec, and — with a quote behind it — carries the job's cut
 * sheet, notes and drawing exactly as the CPQ split's shop document does. Pure; the loop tests call it.
 */
export const shopReleaseFieldsOf = ({ hqOrder = {}, originalJob = null, svgUri = null, outsourcePrice = 0 } = {}) => {
    const isOePair = hqOrder.source === 'ORDER_ENTRY';
    let cpqSpecs = {};
    if (isOePair && Array.isArray(hqOrder.cutList) && hqOrder.cutList.length) {
        hqOrder.cutList.forEach(c => { cpqSpecs[`${c.name || c.legacyErpId}${c.rider ? ' (rides the pole)' : ''}`] = `Qty: ${c.qty}${c.cutLength ? ` @ ${c.cutLength}"` : ''}`; });
    } else if (originalJob && originalJob.cpqData && originalJob.cpqData.breakdown) {
        originalJob.cpqData.breakdown.forEach(item => {
            if (isDisplayOnlyLine(item)) return;   // headers, discount/net rows AND size/projection echoes
            cpqSpecs[item.name] = `Qty: ${item.qty}`;
        });
    }
    const jobFacts = (isOePair && originalJob) ? jobFabFactsOf(originalJob) : null;
    return {
        // A pole with riders (a French return, a fee) is named for its POLE, as the CPQ split names its shop document
        // (Shared/splitPlan shopLeadCodeOf, 2026-09-28) — a multi-line row pair carries no rootItem of its own.
        partNum: hqOrder.rootItem || hqOrder.variantErpId || shopLeadCodeOf(hqOrder.cutList) || '',
        outsourcePrice: outsourcePrice || 0,
        item: (isOePair && hqOrder.itemName) || (originalJob && (originalJob.itemName || originalJob.name)) || hqOrder.variantErpId || hqOrder.rootItem || hqOrder.hqJobId || 'Custom App Order',
        qty: Number(hqOrder.totalParts) || 1,
        customerId: (originalJob && originalJob.customer && originalJob.customer.id) || hqOrder.customerId || null,
        clientName: (originalJob && originalJob.customer && originalJob.customer.name) || hqOrder.customer || 'Internal Stock',
        note: hqOrder.memo || (originalJob && originalJob.sidemark) || '',
        cpqSpecs,
        imageUrl: jobDrawingOf(originalJob, svgUri),
        ...(jobFacts ? {
            fabNotes: jobFacts.fabNotes, fabMethod: jobFacts.fabMethod, visionNotes: jobFacts.visionNotes, bracketNotes: jobFacts.bracketNotes,
            cutSheetMissing: cutSheetMissingOf(originalJob, hqOrder.cutList || []), visionUsed: jobFacts.visionUsed,
        } : {}),
        // A ROW PAIR'S SHOP HALF (Shared/rowPair, 2026-09-23) carries its cut list, its pole pull lines and the
        // pole counts the plater bills on — they ride the parked record onto the shop document as the split writes them.
        ...(Array.isArray(hqOrder.cutList) && hqOrder.cutList.length ? { cutList: hqOrder.cutList } : {}),
        ...(Array.isArray(hqOrder.pullLines) && hqOrder.pullLines.length ? { pullLines: hqOrder.pullLines } : {}),
        ...(hqOrder.poles != null && typeof hqOrder.poles === 'number' ? { poles: hqOrder.poles, feet: hqOrder.feet || 0, billableFeet: hqOrder.billableFeet || 0, riderLines: hqOrder.riderLines || 0 } : {}),
        ...(hqOrder.rowLabel ? { rowLabel: hqOrder.rowLabel, rowKey: hqOrder.rowKey || '', finishGroup: hqOrder.finishGroup || '' } : {}),
    };
};
