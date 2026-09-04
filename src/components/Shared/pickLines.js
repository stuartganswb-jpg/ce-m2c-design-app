// ══ ONE READER FOR AN ORDER'S LINES ═══════════════════════════════════════════════════════════
//
// Brief D · D7. The warehouse takes work from two doors and they speak different dialects:
//
//   Order Entry (orderClass QUICKSHIP)  hq_sales_orders.lines[]  → { erp, aliasErp, name, qty, kit,
//                                        eachQty, packs, packUom, toBeFinished, finishCode, bin }
//   Finishing / CPQ                     fin_workorders.partsList[] → { legacyErpId | partId,
//                                        partName | name, quantity | qty, binLocation }
//
// partsList itself has TWO spellings — the Order Entry planner writes `quantity`, the CPQ split
// writes `qty` — which is what made WO-SO59752 show every pull ×0 until c435d6d taught one reader
// to accept both. That fix lived in PullLinesLive; the pick screen, the pack screen and the labels
// each kept their own copy. This is the one place, so the next dialect is one edit.
//
// ── THE DEFECT THIS CLOSES ────────────────────────────────────────────────────────────────────
// A FEE is not a thing you can pick up. A finishing order's lines were already filtered for them,
// but a QUICKSHIP order's were not — packLinesOf read job.lines straight through — so a fee riding
// an Order Entry sale (FEE-H1-MRPF, the mitered-return fee) was presented to the packer as a
// physical item, and the pack could not be completed until they ticked it. Found by reading, never
// exercised: on the 2026-09-03 live run the order carrying that fee went through the CPQ door.
// Recorded as UNEXERCISED rather than untested, and proved here instead of on a real order —
// raising a live NetSuite order to demonstrate a known defect is a bad trade.
//
// Pure: no Firestore, no NetSuite, no browser, no React.

const up = (v) => String(v || '').trim().toUpperCase();

// A french/miter/bent return is pole FABRICATION and rides the custom order's fab notes; a splice
// happens on the shop floor; a fee has no physical item at all (Stuart 2026-07-14).
// PLURAL MATTERS: the copy of this pattern elsewhere requires \bRETURN\b, which does NOT match
// "Mitered RETURNS" — and the plural is how the line is actually written (Fabricut, 2026-09-03).
// Caught by the test below, not in the wild.
const FEEISH_NAME_RE = /\b(FRENCH|MITERED|MITER|BENT)\s+RETURNS?\b|\bSPLICE\b|\bFEE\b/i;
// An explicit FEE-/HIDDEN- code IS a fee, whatever it is called. The older test only used this
// prefix to decide the line had "no real item number" and then still needed the NAME to agree —
// so FEE-H1-MRPF called "Mitered Returns" fell through both. Identity beats wording.
const FEE_CODE_RE = /(^|-)(FEE|HIDDEN)-/i;

/**
 * Is this line something nobody can pick up?
 *
 * THE NAME TEST ONLY APPLIES TO A LINE WITH NO REAL ITEM NUMBER (the 2026-07-17 precision fix).
 * Option names echo into real part lines — "Backplate (Mounting Base for 1\" French Return)" is a
 * pickable backplate, not a fee — and the old any-name match routed those to Custom and starved the
 * pick list. A line with a real code routes by its flags, never by its wording.
 *
 * Note what is NOT tested: PRICE. A £0.00 line can be a real stocked part — a plated collar comes
 * through at zero because the money sits on the finial it belongs to (Brief E, 2026-09-03) — and
 * filtering on price would silently drop it from the pick.
 */
export const lineIsFeeish = (l) => {
    if (l && (l.isFee || l.lineIsFee)) return true;
    const pid = String((l && (l.legacyErpId || l.partId || l.erp)) || '');
    // A CONFIGURATOR OPTION IS NOT A PART (Eric 2026-08-20). OPT-FLUSH-LEFT told the warehouse to
    // find a "flush cut left" on a shelf; it is an instruction to the shop about what to do to the
    // pole. No part record will ever carry an OPT- code.
    if (/(^|-)OPT-/i.test(pid)) return true;
    if (FEE_CODE_RE.test(pid)) return true;
    const hasRealId = pid && !['PENDING', 'N/A', 'UNASSIGNED'].includes(up(pid));
    return !hasRealId && FEEISH_NAME_RE.test(String((l && l.name) || (l && l.partName) || ''));
};

/** Which door did this order come through? */
export const isQuickShip = (job) => !!job && job.orderClass === 'QUICKSHIP';

/**
 * The lines to PICK: real parts off a shelf, in either dialect, fees removed.
 * A stock build has no pull lines of its own — the Setup Queue synthesises them — so it returns [].
 */
export function pickableLinesOf(job) {
    if (!job) return [];
    if (isQuickShip(job)) return (job.lines || []).filter(l => !lineIsFeeish(l));
    return (job.partsList || []).filter(l => !lineIsFeeish(l));
}

/**
 * The lines to PACK, normalised to one shape: { key, erp, aliasErp, name, qty, isPole }.
 *
 * Three sources, deliberately different:
 *   QUICK SHIP   the sold lines, kit label kept so the packer sees the set. aliasErp is display
 *                only — `erp` stays the real code that gets scanned and labelled.
 *   STOCK BUILD  ONE row: the FINISHED item going back to the shelf, not the raw the pick pulled.
 *                Quantity is the GOOD count — completedParts already nets packing scrap, while
 *                totalParts never changes (Sandra 2026-08-10: 1 of 120 rings scrapped and the card
 *                still said 120).
 *   FINISHING    the exploded parts list, plus the poles, which are not on it — they came off the
 *                shop order and are counted separately.
 */
export function packLinesOf(job) {
    if (!job) return [];
    const out = [];
    if (isQuickShip(job)) {
        (job.lines || []).forEach((l, i) => {
            if (lineIsFeeish(l)) return;   // ← the defect this module closes
            out.push({
                key: `L${i}`, erp: l.erp || '', aliasErp: l.aliasErp || '',
                name: `${l.name || 'Item'}${l.kit ? ` · ${l.kit}` : ''}`, qty: Number(l.qty) || 1,
            });
        });
        return out;
    }
    if (job.orderType === 'stock') {
        const goodQty = (job.completedParts !== undefined && job.completedParts !== null)
            ? Math.max(0, Number(job.completedParts) || 0)
            : (Number(job.totalParts) || 1);
        const code = job.stockErpId || job.type || '';
        const scrap = Number(job.packScrap) || 0;
        out.push({
            key: 'STOCK', erp: code, aliasErp: '',
            name: `${code || 'Stock'} — finished stock, bin & shelve${scrap > 0 ? ` (${scrap} scrapped)` : ''}`,
            qty: goodQty,
        });
        return out;
    }
    (job.partsList || []).forEach((l, i) => {
        if (lineIsFeeish(l)) return;
        out.push({
            key: `L${i}`, erp: l.legacyErpId || l.partId || '', aliasErp: '',
            name: l.partName || l.name || 'Part',
            // BOTH partsList SPELLINGS (c435d6d): the OE planner says `quantity`, the CPQ split
            // says `qty`. Reading one gave every pull ×0 on WO-SO59752.
            qty: Number(l.quantity ?? l.qty) || 1,
        });
    });
    const poleQty = Number(job.totalPoles || (job.poles && job.poles.qty)) || 0;
    if (poleQty > 0) {
        const ptype = (job.poles && job.poles.type) || job.type || '';
        out.push({ key: 'POLES', erp: ptype || 'POLE', aliasErp: '', name: `Pole${poleQty === 1 ? '' : 's'} · ${ptype}`, qty: poleQty, isPole: true });
    }
    return out;
}

/** Item code off a line in either dialect — the one question every screen asks first. */
export const lineCode = (l) => up((l && (l.erp || l.legacyErpId || l.partId || l.code)) || '');

/** Quantity off a line in either dialect, including the partsList double spelling. */
export const lineQty = (l) => Number((l && (l.quantity ?? l.qty)) ) || 0;
