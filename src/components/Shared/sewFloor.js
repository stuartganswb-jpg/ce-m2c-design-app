// ── THE STITCH & SEW FLOOR — THE RULES, PURE (Uniquity · S7, step 5b, 2026-10-11) ────────────────
//
// The sewing floor runs a SEW document (Shared/sewRouteShape) through four zones — CUT · SEW · STUFF ·
// PACK — the way the finishing floor runs coats: one zone at a time, Start then Complete, each stamped
// by whom and when. What the spine reads is what every floor writes: `stepStatus` (Pending · Running ·
// Staged · Complete), `currentPhase` (the word RTG shows), and at the end `currentPhase: 'Complete'` +
// `completedAt`, which SO Pack and the closer already understand. The CUT zone's Complete asks the
// cutter what fabric is left and its usable size (Stuart 2026-09-24, answer 3; 10-11, answer 3) — the
// remainder goes into the fabric cut ledger (Shared/fabricPieceLedger) with its label.
//
// Pure — proven by scripts/sewFloor.test.mjs.

import { SEW_ZONES, SEW_ZONE_LABELS } from './sewRouteShape.js';
export { SEW_ZONES, SEW_ZONE_LABELS };

const U = (v) => String(v || '').trim().toUpperCase();
const N = (v) => Number(v) || 0;
export const SEW_PHASE_OF_ZONE = { CUT: 'Cutting', SEW: 'Sewing', STUFF: 'Stuffing', PACK: 'Packing' };

export const isSewDoc = (wo) => !!wo && U(wo.division) === 'SEW';
export const isClosedDoc = (wo) => !!wo && (U(wo.currentPhase) === 'CLOSED' || wo.closed === true || wo.deleted === true);
export const isCompleteDoc = (wo) => !!wo && U(wo.currentPhase) === 'COMPLETE';

/** The zone statuses, every zone present. */
export const zoneStateOf = (wo) => Object.fromEntries(SEW_ZONES.map(z => [z, (wo && wo.zoneStatus && wo.zoneStatus[z]) || 'Pending']));

/** The zone the floor is on: the first not Complete; null when every zone is Complete. */
export const currentZoneOf = (wo) => {
    const zs = zoneStateOf(wo);
    return SEW_ZONES.find(z => zs[z] !== 'Complete') || null;
};

/** The floor's word for the document (RTG's floorPhase). */
export const sewPhaseOf = (wo) => {
    if (!wo) return '';
    if (isClosedDoc(wo)) return 'Closed';
    if (isCompleteDoc(wo)) return 'Complete';
    if (U(wo.stepStatus) !== 'STAGED' && !SEW_ZONES.some(z => zoneStateOf(wo)[z] !== 'Pending')) return 'Setup';
    const z = currentZoneOf(wo);
    return z ? SEW_PHASE_OF_ZONE[z] : 'Complete';
};

/** May this zone start? Only the current zone, only when it is Pending, only on a staged document. */
export const zoneStartCheck = (wo, zone) => {
    if (!isSewDoc(wo)) return 'not a sewing document';
    if (isClosedDoc(wo) || isCompleteDoc(wo)) return 'the document is finished';
    if (U(wo.stepStatus) !== 'STAGED') return 'stage it to the floor first (the WMS staging handshake)';
    const z = U(zone);
    const cur = currentZoneOf(wo);
    if (cur !== z) return cur ? `${SEW_ZONE_LABELS[cur]} comes first` : 'every zone is complete';
    if (zoneStateOf(wo)[z] !== 'Pending') return `${SEW_ZONE_LABELS[z]} is already ${zoneStateOf(wo)[z].toLowerCase()}`;
    return '';
};

/** May this zone complete? Only the current zone, only when Running. */
export const zoneCompleteCheck = (wo, zone) => {
    if (!isSewDoc(wo)) return 'not a sewing document';
    if (isClosedDoc(wo) || isCompleteDoc(wo)) return 'the document is finished';
    const z = U(zone);
    if (currentZoneOf(wo) !== z) return `${SEW_ZONE_LABELS[z] || z} is not the zone in progress`;
    if (zoneStateOf(wo)[z] !== 'Running') return `start ${SEW_ZONE_LABELS[z]} first`;
    return '';
};

/** The patch that starts a zone. */
export const zoneStartPatchOf = (wo, zone, { by = '', now = Date.now() } = {}) => {
    const z = U(zone);
    return {
        [`zoneStatus.${z}`]: 'Running', [`zoneLog.${z}.startedAt`]: now, [`zoneLog.${z}.startedBy`]: by,
        currentPhase: SEW_PHASE_OF_ZONE[z], currentStepIndex: SEW_ZONES.indexOf(z), updatedAt: now,
        ...(z === 'CUT' ? { startedAt: wo && wo.startedAt ? wo.startedAt : now } : {}),
    };
};

/**
 * The patch that completes a zone. Completing PACK completes the document (what SO Pack and the closer read:
 * currentPhase 'Complete' + completedAt; stepStatus 'Complete'); any other zone moves the phase on.
 */
export const zoneCompletePatchOf = (wo, zone, { by = '', now = Date.now() } = {}) => {
    const z = U(zone);
    const idx = SEW_ZONES.indexOf(z);
    const next = SEW_ZONES[idx + 1] || null;
    const base = { [`zoneStatus.${z}`]: 'Complete', [`zoneLog.${z}.completedAt`]: now, [`zoneLog.${z}.completedBy`]: by, updatedAt: now };
    if (!next) return { ...base, currentPhase: 'Complete', stepStatus: 'Complete', completedAt: now, completedBy: by, currentStepIndex: SEW_ZONES.length, machineAssigned: null };
    return { ...base, currentPhase: SEW_PHASE_OF_ZONE[next], currentStepIndex: idx + 1 };
};

/**
 * The CUT zone's question: one row per fabric pulled for this document (YARD parts), with the bolt width from the
 * library so the remainder's width defaults to it. A remainder of 'none' writes nothing; a length × width writes a
 * cut into the ledger labelled with the largest pillow it makes (Shared/fabricPieces).
 */
export const remainderRowsOf = (wo, findPart = () => null) => (((wo && wo.partsList) || []))
    .filter(p => U(p.uom) === 'YARD' || U(p.uom) === 'RY')
    .map(p => {
        const part = findPart(p.legacyErpId) || null;
        const widthIn = N(part && part.manufacturingSpecs && part.manufacturingSpecs.width) || null;
        return { code: U(p.legacyErpId), name: p.partName || U(p.legacyErpId), pulledYards: N(p.quantity), widthIn, bin: p.binLocation || '', lengthIn: '', remWidthIn: widthIn ? String(widthIn) : '', none: false };
    });

/** The typed remainders → the pieces to create ({ itemCode, lengthIn, widthIn }) and the refusals. */
export const remainderPiecesOf = (rows = []) => {
    const errors = [], pieces = [];
    (rows || []).forEach(r => {
        if (r.none) return;
        const blank = r.lengthIn === '' || r.lengthIn === null || r.lengthIn === undefined;
        if (blank) { errors.push(`${r.code}: say what is left — a length in inches, or tick none`); return; }
        const L = Number(r.lengthIn), W = Number(r.remWidthIn);
        if (!(L > 0)) { errors.push(`${r.code}: "${r.lengthIn}" is not a length in inches`); return; }
        if (!(W > 0)) { errors.push(`${r.code}: a width in inches is required`); return; }
        if (r.pulledYards > 0 && L > r.pulledYards * 36 + 0.001) { errors.push(`${r.code}: ${L}" left is more than the ${r.pulledYards} yd pulled (${Math.round(r.pulledYards * 36)}")`); return; }
        pieces.push({ itemCode: r.code, lengthIn: Math.round(L * 100) / 100, widthIn: Math.round(W * 100) / 100 });
    });
    return { ok: errors.length === 0, errors, pieces };
};

const stagedMs = (d) => { const v = d && d.stagedAt; return v && v.seconds ? N(v.seconds) * 1000 : N(v); };
/** The three lists the app shows. */
export const sewQueueOf = (docs = []) => (docs || []).filter(d => isSewDoc(d) && !isClosedDoc(d) && !isCompleteDoc(d) && U(d.stepStatus) !== 'STAGED')
    .sort((a, b) => String(a.needBy || '9').localeCompare(String(b.needBy || '9')) || (N(a.createdAt) - N(b.createdAt)));
export const sewFloorOf = (docs = []) => (docs || []).filter(d => isSewDoc(d) && !isClosedDoc(d) && !isCompleteDoc(d) && U(d.stepStatus) === 'STAGED')
    .sort((a, b) => stagedMs(a) - stagedMs(b));
export const sewDoneOf = (docs = [], now = Date.now(), days = 7) => (docs || []).filter(d => isSewDoc(d) && isCompleteDoc(d) && !isClosedDoc(d) && (N(d.completedAt) > (now - (days * 86400000))))
    .sort((a, b) => N(b.completedAt) - N(a.completedAt));

/** The staging label's words (Shared/labelPrint.printSetupLabel takes these). */
export const sewLabelOf = (wo) => ({
    kind: 'STITCH & SEW · PILLOWS', woRef: wo && (wo.woNum || wo.displayId || wo.id), orderKey: wo && wo.id,
    item: wo && wo.itemName, qtyLabel: `${N(wo && wo.totalPillows) || N(wo && wo.totalParts)} pillow(s)`, customer: wo && wo.customer,
    facts: (wo && wo.pillows || []).map(p => `${p.qty} × ${p.sizeKey}${p.group ? ` ${p.group}` : ''}`).join(' · '),
});
