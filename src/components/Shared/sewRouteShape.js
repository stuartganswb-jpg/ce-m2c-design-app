// ── THE STITCH & SEW ROUTE — THE SHAPE, PURE (Uniquity · S7, step 5a, 2026-10-11) ────────────────
//
// Stuart 2026-09-13: "the custom pillows need to flow to the floor exactly in the same fashion that
// small parts flow to the finishing floor for Classical … only difference they flow to the 'Stitch &
// Sew' division … same set up queue, etc. just rename the zones cut, sew, stuff, pack." And 10-11: no
// NetSuite work order (the sales order is the record — rule 3 of 09-23; the pillow is non-inventory),
// Stitch & Sew is its OWN app on the same documents, the remainder is declared at the CUT zone.
//
// So a pillow line on an Order Entry sales order (the holder written by tab 7: `pillow`, `madeToOrder:
// 'SEW'`, its $0 parts beneath it as inKit / kitOf) starts through the ONE Order Entry route
// (Shared/oeGenerate) as a group of division SEW and is written as ONE finishing document — the same
// collection (`fin_workorders`), the same RTG record (`hq_work_orders` + finPayload), the same gates,
// the same staging key, the same pick and SO Pack — carrying what a sewing document needs instead of a
// recipe: `division: 'SEW'`, `finishStream: 'SEW'`, the four ZONES, the pillows (design, panels, cuts
// per side, the board snapshot, the fabrics to be sourced) and the parts list in YARDS. No shop half.
// The finishing app skips `division === 'SEW'` (one line); the Stitch & Sew app reads it.
//
// Pure — proven by scripts/sewRoute.test.mjs.

import { PILLOW_DIVISION, dimsOf } from './pillowPricing.js';
import { minCutOf, allowanceOf, isRailroad, sizesFor } from './pillowCuts.js';
import { isLivePiece } from './fabricPieces.js';

export const SEW_DIVISION = PILLOW_DIVISION;   // 'SEW'
export const SEW_FINISH = 'SEW';               // the group's "finish" on the Order Entry route — one sewing document per row
export const SEW_ZONES = ['CUT', 'SEW', 'STUFF', 'PACK'];
export const SEW_ZONE_LABELS = { CUT: 'Cut', SEW: 'Sew', STUFF: 'Stuff', PACK: 'Pack' };

const U = (v) => String(v || '').trim().toUpperCase();
const N = (v) => Number(v) || 0;

/** A sales-order line that is a custom pillow holder (tab 7's `pillow` + `madeToOrder: 'SEW'`). */
export const isSewLine = (l) => !!l && (U(l.madeToOrder) === SEW_DIVISION || !!l.pillow);

/** The key tab 7 wrote on the holder's parts (`kitOf`): pillow-<requestId>-<line>. */
export const sewHolderKeyOf = (l) => {
    const p = l && l.pillow;
    if (!p || !p.requestId) return '';
    return `pillow-${p.requestId}-${Number.isInteger(p.line) ? p.line : 0}`;
};

/**
 * The parts beneath a pillow holder on the sales order: the $0 inKit lines whose kitOf is the holder's key.
 * Each → { soLineIdx, legacyErpId, partName, quantity (yards or each, for the WHOLE line), uom, perPillow }
 */
export const sewPartsOf = (so, holderLine, holderIdx) => {
    const key = sewHolderKeyOf(holderLine);
    if (!key) return [];
    return ((so && so.lines) || []).map((l, idx) => ({ l, idx }))
        .filter(({ l }) => l && l.inKit && U(l.kitOf) === U(key))
        .map(({ l, idx }) => {
            const yards = l.perFoot && U(l.unitWord) === 'YD';
            const qty = yards ? N(l.billedFeet) || N(l.qty) * N(l.feetPer) : N(l.qty);
            return { soLineIdx: idx, legacyErpId: U(l.erp), partName: l.name || U(l.erp), quantity: Math.round(qty * 1000) / 1000, uom: yards ? 'YARD' : 'EACH', note: l.note || '' };
        });
};

/** The group the Order Entry route made is a sewing group when every job is a pillow holder. */
export const isSewGroup = (group) => !!group && Array.isArray(group.jobs) && group.jobs.length > 0 && group.jobs.every(j => j && (j.sew || isSewLine(j.line)));

/** One pillow on the document, from the holder's line and its job. */
export const sewPillowOf = ({ job, config = null } = {}) => {
    const l = (job && job.line) || {};
    const p = l.pillow || {};
    const sizeKey = p.sizeKey || '';
    const mc = sizeKey ? minCutOf(sizeKey, config || {}) : null;
    return {
        soLineIdx: Number.isInteger(job && job.lineIdx) ? job.lineIdx : -1,
        qty: N(job && job.qty) || N(l.qty) || 1,
        requestId: p.requestId || '', summary: p.summary || '', sizeKey, group: p.group || '',
        design: p.design || null, panels: Array.isArray(p.panels) ? p.panels : [],
        // the one-side cut the size takes (the minimum cut table) — the cutter's number; a standard pillow takes two
        minCut: mc ? { lengthIn: mc.lengthIn, widthIn: mc.widthIn } : null,
        sourced: Array.isArray(p.sourced) ? p.sourced : [], capturedFabrics: Array.isArray(p.capturedFabrics) ? p.capturedFabrics : [],
        snapshot: p.snapshot || '',
        zoneStatus: Object.fromEntries(SEW_ZONES.map(z => [z, 'Pending'])),
    };
};

// ── A SHELF CUT BEFORE THE ROLL (Stuart 2026-10-11: "assign automatically when applicable") ─────────────
// Every pull line of a pillow is ONE panel's cut × the pillows ordered (the back is a cut of the pillow's size).
// Before the roll is pulled, the ledger's live cuts of that fabric are offered to each required cut: the
// smallest cut that fits wins (least waste), one cut per required piece, biggest requirement first. The pull
// line's yards shrink by what the cuts cover and each allocated cut becomes its own pull line — the picker
// pulls the labelled piece by its id. Pure; the writer consumes the pieces it allocated.

/** The rectangle one pull line's cut needs (before the seam allowance): the panel's, or the pillow's for the back. */
export const panelCutOf = (pillow, panelLabel) => {
    const label = U(panelLabel);
    if (!pillow) return null;
    if (label === 'BACK' || !label) { const d = dimsOf(pillow.sizeKey); return d ? { widthIn: d.w, heightIn: d.h } : null; }
    const p = (pillow.panels || []).find(x => U(x.label) === label);
    if (p && N(p.widthIn) > 0 && N(p.heightIn) > 0) return { widthIn: N(p.widthIn), heightIn: N(p.heightIn) };
    const d = dimsOf(pillow.sizeKey);
    return d ? { widthIn: d.w, heightIn: d.h } : null;
};

/** Does a live cut fit a needed rectangle (length along the roll × width), in the fabric's orientation? */
export const cutFits = (piece, need, { railroad = false, allowanceIn = 0.5 } = {}) => {
    if (!piece || !need) return false;
    const L = railroad ? need.widthIn + 2 * allowanceIn : need.heightIn + 2 * allowanceIn;
    const W = railroad ? need.heightIn + 2 * allowanceIn : need.widthIn + 2 * allowanceIn;
    return N(piece.lengthIn) + 1e-9 >= L && N(piece.widthIn) + 1e-9 >= W;
};

/**
 * pulls   the document's YARD pull lines [{ legacyErpId, quantity (yards for every pillow), panel, pillowLineIdx, … }]
 * pillows the pillows by their line index { [lineIdx]: pillow } (sizeKey, panels, qty)
 * pieces  live `fabric_pieces` [{ id, itemCode, lengthIn, widthIn, status }]
 * fabrics { [code]: item } (railroad flag)
 * → { pulls: the adjusted pull lines (+ one per allocated cut), allocations: [{ pieceId, itemCode, panel, pillowLineIdx, lengthIn, widthIn, yards }], notes }
 */
export const allocateCutsOf = ({ pulls = [], pillows = {}, pieces = [], fabrics = {}, config = null } = {}) => {
    const allow = allowanceOf(config || {});
    const live = (pieces || []).filter(isLivePiece).map(p => ({ ...p }));
    const used = new Set();
    const allocations = [], notes = [];
    const out = [];
    // biggest requirement first, so a large panel never loses its only fitting cut to a small one
    const reqs = (pulls || []).map((pl, i) => {
        const pillow = pillows[pl.pillowLineIdx] || null;
        const need = U(pl.uom) === 'YARD' ? panelCutOf(pillow, pl.panel) : null;
        return { i, pl, pillow, need, area: need ? need.widthIn * need.heightIn : 0 };
    });
    [...reqs].sort((a, b) => b.area - a.area).forEach(r => {
        const { pl, pillow, need } = r;
        if (!need || !pillow) { out[r.i] = pl; return; }
        const code = U(pl.legacyErpId);
        const fabric = fabrics[code] || null;
        const rr = isRailroad(fabric);
        const count = Math.max(1, Math.floor(N(pillow.qty) || 1));
        const perCutYards = N(pl.quantity) / count;
        let covered = 0;
        for (let k = 0; k < count; k++) {
            const fit = live.filter(p => !used.has(p.id) && U(p.itemCode) === code && cutFits(p, need, { railroad: rr, allowanceIn: allow }))
                .sort((a, b) => (N(a.lengthIn) * N(a.widthIn)) - (N(b.lengthIn) * N(b.widthIn)))[0];
            if (!fit) break;
            used.add(fit.id); covered++;
            const yards = Math.round((N(fit.lengthIn) / 36) * 1000) / 1000;
            allocations.push({ pieceId: fit.id, itemCode: code, panel: U(pl.panel) || '', pillowLineIdx: pl.pillowLineIdx, lengthIn: N(fit.lengthIn), widthIn: N(fit.widthIn), yards, makes: (sizesFor({ cut: fit, railroad: rr, config: config || {} })[0] || {}).key || '' });
        }
        if (!covered) { out[r.i] = pl; return; }
        const left = Math.round(Math.max(0, N(pl.quantity) - covered * perCutYards) * 1000) / 1000;
        notes.push(`${code} · panel ${U(pl.panel) || '?'}: ${covered} of ${count} cut(s) from the shelf${left > 0 ? `, ${left} yd off the roll` : ''}`);
        out[r.i] = left > 0 ? { ...pl, quantity: left, fromRollAfterCuts: true } : null;
    });
    const pulls2 = out.filter(Boolean);
    allocations.forEach(a => pulls2.push({
        legacyErpId: a.itemCode, partId: a.itemCode, partName: `CUT ${a.pieceId} — ${a.lengthIn}" × ${a.widthIn}"${a.makes ? ` (up to ${a.makes})` : ''}`,
        quantity: a.yards, uom: 'YARD', panel: a.panel, pillowLineIdx: a.pillowLineIdx, pieceId: a.pieceId, pickByPiece: true,
    }));
    return { pulls: pulls2, allocations, notes };
};

/**
 * The RTG record + the finishing payload for a sewing group — the pair shape (Shared/rowPairShape.pairShapeOf)
 * with no shop half and the sewing facts in place of the recipe. `partsList` = every job's pull lines (yards /
 * each), each carrying the uom stamp the caller computed (`uomOf(part, qty)`), the bin and the line number.
 */
export const sewDocShapeOf = ({ group, so, brand, createdBy = '', now = Date.now(), inventory = [], gate = {}, materialStamp = {}, woId, note = '', config = null, uomOf = () => ({}), factsOf = () => ({}), pieces = [] } = {}) => {
    const jobs = (group && group.jobs) || [];
    const rowLabel = (group && group.rowLabel) || '';
    const needBy = String((so && (so.needBy || so.reqDate)) || '');
    const cust = String((so && so.customer) || '');
    const soRef = String((so && (so.soId || so.id)) || '');
    const partByCode = (code) => (inventory || []).find(p => U(p.legacyErpId || p.itemId) === U(code)) || null;
    const partsList = [];
    jobs.forEach(job => {
        (job.__planLines || job.sewParts || []).forEach(pl => {
            const code = U(pl.legacyErpId || pl.partId);
            const part = partByCode(code);
            const specs = (part && part.manufacturingSpecs) || {};
            const qty = N(pl.quantity != null ? pl.quantity : pl.qty);
            partsList.push({
                ...pl, legacyErpId: code, partId: pl.partId || code,
                partName: pl.partName || (part && part.itemName) || code,
                quantity: qty, uom: pl.uom || (U(specs.uom) === 'RY' ? 'YARD' : 'EACH'),
                finishCode: SEW_FINISH, finishLabel: 'Sew',
                binLocation: specs.homeBin || specs.binLocation || pl.binLocation || 'UNASSIGNED',
                productType: U(specs.productType || (part && part.productType) || '') || null,
                soLineIdx: Number.isInteger(pl.soLineIdx) ? pl.soLineIdx : job.lineIdx,
                pillowLineIdx: job.lineIdx,
                ...uomOf(part || pl, qty),
            });
        });
    });
    const pillows0 = jobs.map(job => sewPillowOf({ job, config }));
    // a shelf cut before the roll — when the caller handed over the ledger's live cuts
    const alloc = allocateCutsOf({ pulls: partsList, pillows: Object.fromEntries(pillows0.map(p => [p.soLineIdx, p])), pieces: pieces || [], fabrics: Object.fromEntries((inventory || []).map(f => [U(f.legacyErpId || f.itemId), f])), config });
    const partsListFinal = alloc.allocations.length ? alloc.pulls.map(pl => (pl.pickByPiece ? { ...pl, finishCode: SEW_FINISH, finishLabel: 'Sew', binLocation: ((partByCode(pl.legacyErpId) || {}).manufacturingSpecs || {}).homeBin || 'UNASSIGNED', soLineIdx: pl.pillowLineIdx, ...uomOf(partByCode(pl.legacyErpId) || pl, pl.quantity) } : pl)) : partsList;
    const pillows = pillows0;
    const totalPillows = pillows.reduce((s, p) => s + p.qty, 0);
    const lineIdxs = jobs.map(j => j.lineIdx).filter(i => Number.isInteger(i) && i >= 0);
    const label = `${rowLabel ? `${rowLabel} · ` : ''}Stitch & Sew`;
    const itemName = `${rowLabel || `Order ${soRef}`} · Stitch & Sew · ${totalPillows} custom pillow${totalPillows === 1 ? '' : 's'}${pillows.some(p => p.sourced.length) ? ' · fabric to be sourced' : ''}`;
    const facts = factsOf({ partsList: partsListFinal, cutList: [], lineCount: ((so && so.lines) || []).length });
    const salesHeader = {
        orderClass: 'ORDER_ENTRY', soAppId: so && so.id, soId: soRef, customerId: (so && so.customerId) || null, customer: cust,
        soAccepted: !!(so && so.nsInternalId), soLineIdxs: lineIdxs,
        ...(so && so.hqJobId ? { hqJobId: so.hqJobId, quoteId: so.hqJobId } : {}),
        rowKey: (group && group.rowKey) || '', rowLabel, finishGroup: SEW_FINISH, floorGroupKey: (group && group.key) || '',
        division: SEW_DIVISION,
    };
    const finPayload = {
        id: woId, displayId: woId, woNum: woId,
        orderKey: so && so.id, quoteId: null, salesOrderId: so && so.id, estimateId: null,
        orderType: 'sales', soId: soRef, soNum: soRef,
        customerId: (so && so.customerId) || null, customerName: cust, customer: cust, clientName: cust,
        type: 'Pillow', itemName,
        rowKey: (group && group.rowKey) || '', rowLabel, finishGroup: SEW_FINISH,
        division: SEW_DIVISION, finishStream: SEW_DIVISION, zones: SEW_ZONES.slice(), zoneStatus: Object.fromEntries(SEW_ZONES.map(z => [z, 'Pending'])),
        recipe: SEW_FINISH, recipeLabel: 'Stitch & Sew', recipeSource: 'pillow',
        pillows, totalPillows,
        totalParts: totalPillows, paintSize: null, paintSizes: null,
        note, memo: note,
        reqDate: needBy, needBy,
        cpqSpecs: {}, imageUrl: pillows.find(p => p.snapshot) ? pillows.find(p => p.snapshot).snapshot : null,
        dimensions: { length: 10, width: 5, height: 2 },
        partsList: partsListFinal, bomExploded: false,
        ...(alloc.allocations.length ? { cutAllocations: alloc.allocations, cutAllocationNotes: alloc.notes } : {}),
        currentPhase: 'Setup', stepStatus: 'Pending', currentStepIndex: 0,
        tasks: {}, machineAssigned: null, redlineAlert: false,
        // no shop half: to the pick at once (rule 6 of 09-23)
        sentToPickPack: true, pickStatus: 'Pending',
        shopSiblingId: null, hasCustomSibling: false, customFabStatus: 'Pending',
        brand: brand || null, createdAt: now, updatedAt: now, createdBy,
        releasedDirect: false, soLineIdxs: lineIdxs,
        ...facts, ...(materialStamp || {}),
    };
    const hq = {
        id: woId, woId, woDisplayId: woId,
        brand, status: 'Approved', customer: cust,
        source: 'ORDER_ENTRY', intent: 'ORDER_ENTRY', routeTo: 'FINISHING', orderType: 'sales', autoFlow: true,
        type: 'Pillow', erpId: '', partErpId: '', variantErpId: '', rootItem: '',
        itemName, ...salesHeader,
        recipe: SEW_FINISH,
        qty: totalPillows, totalParts: totalPillows, reqDate: needBy, ...(needBy ? { needBy } : {}),
        note: note || label, memo: note || label,
        ...(partsListFinal.length ? { partsList: partsListFinal, bomExploded: false } : {}),
        ...gate, ...facts, ...(materialStamp || {}),
        finPayload, createdAt: now, createdBy,
    };
    return { hq, finPayload, partsList: partsListFinal, pillows, allocations: alloc.allocations, allocationNotes: alloc.notes };
};
