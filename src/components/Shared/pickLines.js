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
export function packLinesOf(job, { poleRows = null } = {}) {
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
    // THE POLES, BY CODE (2026-09-11, the Brimar packing lists read NOT PACKED on every pole):
    // a custom order's poles come off the SHOP order, so this document never listed them and the
    // one synthetic row it could make carried a TYPE word, not the pole's code — the packing list
    // pairs by code and found nothing. Now: the caller passes the shop sibling's rows live
    // (Shared/pickLines.poleDetailsOf, the same rows the pick and pack cards show), the pack
    // STAMPS them on the document (`poleLines`) the moment a pole is ticked, and from then on the
    // document alone rebuilds the same rows — so the packing list, built from the documents with
    // no shop sibling in the room, sees the pole by its code. The legacy type-word row survives
    // for documents with a pole count and neither.
    const stamped = Array.isArray(job.poleLines) ? job.poleLines : null;
    const rows = (Array.isArray(poleRows) && poleRows.length) ? poleRows : (stamped && stamped.length ? stamped : null);
    if (rows) {
        rows.forEach((r, i) => {
            const code = String((r && r.code) || '').toUpperCase();
            const name = String((r && r.name) || code || 'Pole');
            const len = r && r.length != null && String(r.length) !== '' ? ` · ${r.display || formatPoleLength(r.length, r.unit || 'in')}` : '';
            out.push({ key: `POLE-${i}`, erp: code || name, aliasErp: '', name: `Pole · ${name}${len}`, qty: Number(r && r.qty) || 1, isPole: true, length: r ? r.length : null, unit: (r && r.unit) || 'in' });
            // The riders — fabrication on that rod (French return, miter). A pack line each, so the
            // packing list pairs them with their ordered lines by code, but they are ticked WITH the
            // pole (the WMS ticks a pole's riders when the pole is ticked) and never shown as rows.
            (Array.isArray(r && r.riders) ? r.riders : []).forEach((x, j) => {
                const rc = String((x && x.code) || '').toUpperCase();
                if (!rc) return;
                out.push({ key: `POLE-${i}-R${j}`, erp: rc, aliasErp: '', name: `On the rod · ${String((x && x.name) || rc)}`, qty: Number(x && x.qty) || 1, isPole: true, rider: true, riderOf: `POLE-${i}` });
            });
        });
        return out;
    }
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

// ══ WHICH POLE IS THIS? ═══════════════════════════════════════════════════════════════════════
//
// Stuart 2026-09-09: "we need to add the pole length/details to the card, currently only shows the
// description and qty, but not the actual length, if the labels fall of the pole there is no way
// for packaging to be sure they are packing the correct pole with the correct small parts."
//
// WHY THE SCREEN COULD NOT SAY IT. The packer works from the FINISHING document, which holds the
// small parts. The pole is fabricated on the SHOP order, and that is where its length lives —
// `cutLength`, plus a structured `cutList` of one entry per cut. The warehouse loaded neither, so
// there was nothing to show. The link already existed: the finishing doc carries `shopSiblingId`.
//
// ⚠ TWO LENGTHS, TWO UNITS, AND THEY MUST NEVER RENDER ALIKE.
//   • a CUT length off the shop order is in INCHES  (96, "96 1/2")  → shown 96"
//   • a length parsed out of a STOCKED code is in FEET (…-4 → 4)    → shown 4 ft
// Printing a bare "4" beside a bare "96" on a packing bench is how the wrong pole goes in the box,
// which is the exact failure this is meant to prevent. The unit rides every row.
//
// AND IT NEVER GUESSES. A shop order with no cut list yields no length and the caller says so —
// a blank reads as "not recorded", while an inferred number reads as verified.

const asQty = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };

/** One length, formatted with its unit. Numbers get the mark; free text is trusted as typed. */
export function formatPoleLength(value, unit) {
    if (value == null || value === '') return '';
    const raw = String(value).trim();
    if (!raw) return '';
    const n = Number(raw);
    if (unit === 'ft') return Number.isFinite(n) ? `${n} ft` : `${raw} ft`;
    // inches: a bare number gets the inch mark; "96 1/2" or '96"' is already legible
    if (Number.isFinite(n)) return `${n}"`;
    return /["']|\bIN\b/i.test(raw) ? raw : `${raw}"`;
}

/**
 * The pole rows for a pack/pick card: what it is, how many, how long.
 *
 * @param {object} job        the fin_workorders doc the card is showing
 * @param {object} shopDoc    its shop sibling (by `job.shopSiblingId`), or null
 * @param {object} salesOrder the joined hq_sales_orders doc, or null — sidemark only
 * @returns {{ rows: Array, sidemark: string, source: 'shop'|'code'|'none' }}
 *          rows: [{ name, qty, length, unit, display }]
 */
export function poleDetailsOf({ job, shopDoc = null, salesOrder = null } = {}) {
    const sidemark = String(
        (job && job.sidemark) || (salesOrder && (salesOrder.sidemark || salesOrder.memo)) ||
        (shopDoc && shopDoc.note) || (job && job.note) || ''
    ).trim();

    // 1. THE SHOP ORDER'S CUT LIST — the real answer for a made-to-order pole.
    const allCuts = (shopDoc && Array.isArray(shopDoc.cutList) ? shopDoc.cutList : []).filter(Boolean);
    const cuts = allCuts.filter(c => c.cutLength != null && String(c.cutLength) !== '');
    // THE RIDERS (Stuart 2026-09-11: "you combine with the rod, they are a fabricating fee, once the
    // shop confirms complete they are complete along with the pole"): a shop custom line with NO cut
    // length — a French return, a miter — is a fabrication ON the rod, not a piece of its own. It
    // rides the first pole row: packed when the pole is packed, listed under it, never ticked alone.
    const riders = allCuts.filter(c => !(c.cutLength != null && String(c.cutLength) !== '')).map(c => ({
        code: String(c.legacyErpId || c.partId || c.itemCode || c.code || '').toUpperCase(),
        name: String(c.name || c.legacyErpId || 'Fabrication'),
        qty: asQty(c.qty) || 1,
    })).filter(r => r.code);
    if (cuts.length) {
        return {
            source: 'shop', sidemark, riders,
            rows: cuts.map((c, i) => {
                const qty = asQty(c.qty) || 1;
                return {
                    // THE CODE, for the packing list (2026-09-11): the list pairs ORDERED with PACKED by
                    // item code, and a pole row that carried only a name never matched its ordered line.
                    code: String(c.legacyErpId || c.partId || c.itemCode || c.code || '').toUpperCase(),
                    name: String(c.name || c.legacyErpId || 'Pole'),
                    qty, length: c.cutLength, unit: 'in',
                    display: formatPoleLength(c.cutLength, 'in'),
                    ...(i === 0 && riders.length ? { riders } : {}),
                };
            }),
        };
    }
    // 2. A single cutLength on the shop order, when there is no per-line list.
    if (shopDoc && shopDoc.cutLength != null && String(shopDoc.cutLength) !== '') {
        return {
            source: 'shop', sidemark,
            rows: [{
                code: String(shopDoc.itemCode || shopDoc.legacyErpId || shopDoc.stockErpId || shopDoc.item || shopDoc.partNum || '').toUpperCase(),
                name: String(shopDoc.item || shopDoc.partNum || 'Pole'),
                qty: asQty(shopDoc.qty) || 1, length: shopDoc.cutLength, unit: 'in',
                display: formatPoleLength(shopDoc.cutLength, 'in'),
            }],
        };
    }
    // 3. A STOCKED pole carries its length in its own code, in FEET. `poleLengthOf` is the shared
    //    grammar (Shared/poleCut) — the caller passes it in rather than this module importing the
    //    pole vocabulary, so the one reader stays free of routing knowledge.
    return { source: 'none', sidemark, rows: [] };
}

/**
 * The stocked-pole case, kept separate because its unit is FEET and its source is the item code.
 * @param {string} code       the pole's item code
 * @param {number} qty        pieces
 * @param {function} lengthOf `poleLengthOf` from Shared/poleCut, passed in by the caller
 */
export function stockedPoleDetail(code, qty, lengthOf) {
    const ft = typeof lengthOf === 'function' ? lengthOf(code) : null;
    if (!ft) return null;
    return { code: String(code || '').toUpperCase(), name: String(code || 'Pole'), qty: asQty(qty) || 1, length: ft, unit: 'ft', display: formatPoleLength(ft, 'ft') };
}
