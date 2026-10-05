import { committedQtyOf } from './committedBins.js';
import { isKitLine, isOffOrderLine } from './itemKit.js';
import { parseKitCode } from './kitCode.js';
import { finishedCodeOf } from './subFinish.js';
import { isReleaseByCount, releasedByKindOf, lineTargetOf } from './rowRelease.js';
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

// ── THE ONE TEST: IS THIS AN ORDER ENTRY ORDER? (Stuart 2026-09-23) ─────────────────────────
// "we need to close all these gaps not just for this order, but so they do not happen again."
// The question was asked in five places with five local copies (the WMS, the CRM, orderStatus
// twice, the closer's reopen plan) and answered by three Firestore queries on the raw field name.
// A CPQ order released by rows from 10.5 is Order Entry in behaviour but was not in class, and it
// fell through every one of them at once. Now: ONE field name (ORDER_ENTRY_CLASS — the writers
// stamp it, the queries filter on it) and ONE function (isQuickShip — every reader calls it). The
// richer sales-order identity test, Shared/reopenQuote.isOrderEntryOrder, builds on this one.
export const ORDER_ENTRY_CLASS = 'QUICKSHIP';
/** Which door did this order come through — does it pack off the order itself (lines[] are the truth)? */
export const isQuickShip = (job) => !!job && String(job.orderClass || '').trim().toUpperCase() === ORDER_ENTRY_CLASS;

/**
 * The lines to PICK: real parts off a shelf, in either dialect, fees removed.
 * A stock build has no pull lines of its own — the Setup Queue synthesises them — so it returns [].
 */
export function pickableLinesOf(job, { isFeeCode = null } = {}) {
    if (!job) return [];
    if (isQuickShip(job)) return (job.lines || []).filter((l, i) => !soLineIsFee(job, l, i, isFeeCode));
    return (job.partsList || []).filter(l => !lineIsFeeish(l) && !isOwnCustomPole(job, l) && !isKitHolderLine(l));
}

// ── A KIT IS SOLD, NEVER PICKED — whichever door wrote the document (Stuart 2026-09-30, SO60432: "this is the kit
// code from the sale, it should not be looking to pick this … make sure this is locked down so it works in future no
// matter if order comes from cpq or sales order entry") ──────────────────────────────────────────────────────────
// WO-SO60432 (CPQ split, 09-14) carried its traverse SYSTEM kit H1-2TRV-4M/P-45W as a pull line, so the WMS showed
// "SHORT 2 · H1-2TRV-4M/P-45W". The writers keep kits off now — the CPQ split since 09-18 (lineClassification.
// isDisplayOnlyLine), tab 7 / 10.5 / Order Entry since 09-28 (Shared/itemKit, oeGenerate) — and this is the belt
// for every document written before them and any writer that forgets: a line FLAGGED a kit (isKit / itemKit), or
// whose code IS a traverse system kit code (Shared/kitCode.parseKitCode), is never a pull line. Its parts are.
// The one reader — the WMS pick, the Setup Queue count, the pick gate and staging's nothing-to-pick all read it.
export const isKitHolderLine = (l) => !!l && (isKitLine(l) || !!parseKitCode(up(l.legacyErpId || l.partId || l.erp || '')));

// ── ON A CUSTOM PAIR THE POLE IS THE SHOP'S (Stuart 2026-09-23, SO60565 Base Front 1) ────────
// "poles route to the shop floor, but need to stay there until fabricated and completed and then
//  they are supposed to be scanned to a staging bin for the matching small parts to be picked and
//  reunited." The Order Entry writer had put the raw pole on the FINISHING document's parts list
// (the CPQ split never does — a custom line is the shop's cut list), so the WMS offered
// H1-75SR ×50 for picking and the Setup Queue counted it as a pickable line. The writer no longer
// writes it (Shared/stockRun.buildParkedWorkOrder); this reader rule is the belt for every
// document written before that, and for any writer that forgets. The pole is named by the pair
// itself: the document's raw item (rootItem / stockErpId) on a document that HAS a custom sibling.
export const ownPoleCodesOf = (job) => {
    if (!job || !(job.hasCustomSibling || job.shopSiblingId)) return [];
    return [...new Set([job.rootItem, job.stockErpId, job.partErpId, job.erpId].map(v => up(v)).filter(Boolean))];
};
export const isOwnCustomPole = (job, line) => {
    const codes = ownPoleCodesOf(job);
    if (!codes.length) return false;
    const c = up((line && (line.legacyErpId || line.partId || line.erp)) || '');
    if (!c) return false;
    // The raw pole itself, or the finished variant of it (H1-75SR/P24 pulls H1-75SR).
    return codes.includes(c) || codes.includes(c.split('/')[0]);
};

// ── THE CODE THE WAREHOUSE HANDLES FOR A SALES-ORDER LINE (Stuart 2026-09-27) ────────────────
// An Order Entry line carries the BASE item with its finish beside it (Shared/displayRelease.rowLineErpOf),
// but what reaches the order's box for a to-be-finished line is the FINISHED piece: H1-1R/EP2 back from the
// plater, H1-138CC/P06 off the finishing floor, H1-1BF/EP2 off the shelf. Every SO Pack reader — the line's
// stock, what is gathered for it, the arrival alert, the plating put-away — matches the line by this code.
// Matched by the base code, a row's plated pole never met its order at put-away, and a raw receipt of
// H1-75SR was offered to an order that wanted H1-75SR/P24.
const lineIsTbf = (l) => !!(l && (l.toBeFinished || /TO BE FINISHED/i.test(String(l.note || ''))));
const lineFinishOf = (l) => up((l && (l.finishCode || (String(l.note || '').match(/TO BE FINISHED\s*·\s*([A-Z0-9-]+)/i) || [])[1])) || '');
export const soLineCodeOf = (l) => {
    const erp = up(l && (l.erp || l.code));
    if (!erp || !lineIsTbf(l)) return erp;
    const fin = lineFinishOf(l);
    if (!fin) return erp;
    // One naming rule (Shared/subFinish.finishedCodeOf): <code>/<finish>, and a traverse sub finish names its stock
    // colour — the track made TCP leaves the floor as H1-2TRVTRK/C, an F-clip as H1-2TRVCLP/C (2026-09-27).
    return finishedCodeOf(erp, fin);
};
// A FEE ON AN ORDER IS NEVER PICKED OR PACKED (Stuart 2026-09-27). A fee cut into a pole (a French return, a
// miter) rides the pole's shop cut list — the start stamps it `rider`; a billing-only fee is just money. Tab 7
// stores a fee with no flag, so the library's word counts too: `isFeeCode(code)` → is the item a Fee record.
// A KIT LINE is sold and billed, never picked or gathered (Shared/itemKit, 2026-09-28): its PARTS, beneath it, are.
export const soLineIsFee = (so, l, idx, isFeeCode = null) => !!l && (lineIsFeeish(l) || !!l.isFee || isKitLine(l) || isOffOrderLine(l)
    || !!(so && so.oeGen && so.oeGen[idx] && so.oeGen[idx].rider)
    || (typeof isFeeCode === 'function' && !!isFeeCode(up(l.erp))));
// A line the warehouse PICKS OFF THE SHELF for the order: a stocked line, or a plated to-be-finished line the
// row start found in stock (the sales order's oeGen[idx] stamp, kind STOCK — Shared/oeGenerate). Every other
// to-be-finished line ARRIVES from a floor and is ready only once it is gathered into the order.
export const soLineIsShelfPick = (so, l, idx) => {
    const g = so && so.oeGen && so.oeGen[idx];
    if (g && g.kind === 'STOCK') return true;
    // MADE ON A FLOOR, THOUGH IT WEARS NOTHING (Stuart 2026-09-28, SO60551's clear acrylic rod): a line the start put
    // on a work order, or a piece cut to length, comes from the floor — it is never looked for on the shelf.
    if (g && g.kind === 'WO') return false;
    if (Number(l && l.cutLength) > 0) return false;
    return !lineIsTbf(l);
};

// ── ONE ORDER SHIPS ONCE (Stuart 2026-09-27) ───────────────────────────────────────────────
// A CPQ order split into several finishes (RTG's split, one pair per finish: WO-<key>-P24, WO-<key>-S03)
// has several finishing documents, and packing ANY of them queued a NetSuite fulfilment of EVERY open line
// of the sales order — the first pack shipped the whole order in NetSuite. The fulfilment waits for the LAST
// of them: these are the order's other documents still to pack. Pure; `docs` is a fresh read of the
// order's finishing documents (same orderKey). A closed, deleted or retired document is not waited for.
export const unpackedSiblingsOf = (job, docs = []) => {
    if (!job || !job.orderKey) return [];
    const closed = (d) => d.deleted === true || [d.currentPhase, d.stepStatus, d.status].some(v => String(v || '') === 'Closed') || String(d.closedFrom || '') === '10.5';
    return (docs || []).filter(d => d && d.id !== job.id && String(d.orderKey || '') === String(job.orderKey)
        && (d.orderType || 'sales') === 'sales' && !closed(d)
        && d.packStatus !== 'Packed' && d.packStatus !== 'Gathered');
};

// ── ONE SO PACK LINE: ITS NUMBERS AND ITS WORD (moved out of the WMS screen 2026-09-27 so the loop tests run the
// same code the card does). A fee is never picked; a line that ARRIVES from a floor is ready only when its pieces
// are gathered into the order; a shelf pick is ready when the order's own stock (free + what NetSuite holds for it,
// or what is already gathered — never both) covers it.
// @param stat { avail (free), held (NetSuite's hold for the order), prod } for the line's code, or null (unread)
// ── ONE ITEM, ONE NEED (Stuart 2026-09-29, SO60551: "H1-1CP-V/EP4 100 required") ────────────────────────────────────
// An item on several lines of an order (two full-pole rows → two cover-plate lines of 50) is ONE need: the sum of those
// lines. What is gathered for it is counted once, per code (committedQty) — so every line of the item compares that count
// with the WHOLE need, and every gather caps at it. Compared line by line, the first 50 read both lines GATHERED and the
// gather refused the second 50: the order packed short on every repeated item. Fees, kit lines and lines taken off the
// order need nothing.
// What has already SHIPPED of an item (a display order ships one display at a time — Shared/displayShipment) is no longer
// needed in the order's bin: the need is what is ordered less what has gone (so.shippedQty, per code).
export const soCodeNeedOf = (so, code, isFeeCode = null) => {
    const c = up(code);
    if (!c) return 0;
    const ordered = ((so && so.lines) || []).reduce((a, l, i) => a + ((soLineCodeOf(l) === c && !soLineIsFee(so, l, i, isFeeCode)) ? (Number(l.qty) || 0) : 0), 0);
    const shipped = Number(((so && so.shippedQty) || {})[c]) || 0;
    return Math.max(0, ordered - shipped);
};
// ── RELEASED BY COUNT: WHAT IS IN MOTION, NOT THE WHOLE ORDER (Stuart 2026-10-05, Shared/rowRelease) ──────────────────
// An order released by count puts only some displays of a row in motion at a time. The WMS then asks, per line, what has
// been RELEASED of it and where those pieces come from:
//   · a line a start raised — its releases: a shelf pick (STOCK) or a floor document (WO);
//   · a stocked line no start ever raises — its row's count ("1. release count"): displays released × pieces per display;
//   · a made line not yet started — nothing.
// An order NOT released by count (every order before 2026-10-05) is released whole: every line, all of it.
// @returns { shelf, floor, total }
export const soLineReleasedOf = (so, l, idx, isFeeCode = null) => {
    if (!l || !soLineCodeOf(l) || soLineIsFee(so, l, idx, isFeeCode)) return { shelf: 0, floor: 0, total: 0 };
    const q = Number(l.qty) || 0;
    const g = so && so.oeGen && so.oeGen[idx];
    if (!isReleaseByCount(so)) return soLineIsShelfPick(so, l, idx) ? { shelf: q, floor: 0, total: q } : { shelf: 0, floor: q, total: q };
    if (g) return releasedByKindOf(g, q);
    if (!soLineIsShelfPick(so, l, idx)) return { shelf: 0, floor: 0, total: 0 };
    const t = lineTargetOf(so, l);
    const n = t.ok ? t.qty : Math.floor(q * (Number(t.target) || 0) / (Number(t.of) || 1));
    return { shelf: n, floor: 0, total: n };
};
/** Everything released of an ITEM across its lines: { shelf, floor, total }. */
export const soCodeReleasedOf = (so, code, isFeeCode = null) => {
    const c = up(code);
    return ((so && so.lines) || []).reduce((a, l, i) => {
        if (!c || soLineCodeOf(l) !== c) return a;
        const r = soLineReleasedOf(so, l, i, isFeeCode);
        return { shelf: a.shelf + r.shelf, floor: a.floor + r.floor, total: a.total + r.total };
    }, { shelf: 0, floor: 0, total: 0 });
};
/** What the order's bin should hold of an item NOW: what is released less what has shipped (the whole need on an order released whole). */
export const soCodeReleasedNeedOf = (so, code, isFeeCode = null) => {
    if (!isReleaseByCount(so)) return soCodeNeedOf(so, code, isFeeCode);
    const shipped = Number(((so && so.shippedQty) || {})[up(code)]) || 0;
    return Math.max(0, soCodeReleasedOf(so, code, isFeeCode).total - shipped);
};
/**
 * Pieces of an item still to PICK FROM THE SHELF on an order released by count. An item that only ever comes off the shelf:
 * what is released less what has reached the bin (in it now, or shipped). An item that also comes off a floor (a stock
 * colour picked for one release and painted for the next): the shelf's share less what the shelf picks have already
 * moved (`shelfPicked`, counted by the pick), never more than is still missing in all.
 */
export const soShelfToPickOf = (so, code, isFeeCode = null) => {
    const c = up(code);
    const rel = soCodeReleasedOf(so, c, isFeeCode);
    const inEver = committedQtyOf(so, c) + (Number(((so && so.shippedQty) || {})[c]) || 0);
    if (!(rel.shelf > 0)) return 0;
    if (!(rel.floor > 0)) return Math.max(0, rel.shelf - inEver);
    const picked = Number(((so && so.shelfPicked) || {})[c]) || 0;
    return Math.max(0, Math.min(rel.shelf - picked, rel.total - inEver));
};
export const soPackLineStateOf = ({ so, line, idx, stat = null, isFeeCode = null }) => {
    const c = soLineCodeOf(line);
    const ordered = Number(line && line.qty) || 0;
    const committed = committedQtyOf(so, c);
    if (isOffOrderLine(line)) return { code: c, ordered: 0, need: 0, committed, avail: null, held: 0, prod: 0, covered: 0, state: 'OFF THE ORDER', fee: true };
    if (soLineIsFee(so, line, idx, isFeeCode)) return { code: c, ordered, committed, avail: null, held: 0, prod: 0, covered: 0, state: 'FEE', fee: true };
    if (isReleaseByCount(so)) {
        // The line against what is RELEASED of its item — nothing released reads NOT RELEASED, never short.
        const released = soLineReleasedOf(so, line, idx, isFeeCode).total;
        const rel = soCodeReleasedOf(so, c, isFeeCode);
        const need = soCodeReleasedNeedOf(so, c, isFeeCode);
        const base = { code: c, ordered, need, released, committed, byCount: true };
        if (!(rel.total > 0)) return { ...base, avail: null, held: 0, prod: 0, covered: committed, state: 'NOT RELEASED', fromFloor: !soLineIsShelfPick(so, line, idx) };
        if (!soLineIsShelfPick(so, line, idx)) return { ...base, avail: null, held: 0, prod: 0, covered: committed, state: committed >= need ? 'GATHERED' : 'FROM THE FLOOR', fromFloor: true };
        const free = stat && stat.avail != null ? stat.avail : null;
        const held = stat ? (Number(stat.held) || 0) : 0;
        const avail = free != null ? Math.max(0, free) + held : null;
        const prod = stat ? (Number(stat.prod) || 0) : 0;
        const covered = Math.max(committed, held) + (free != null ? Math.max(0, free) : 0);
        const state = committed >= need ? 'GATHERED'
            : covered >= need ? 'READY'
                : (covered + prod) >= need ? 'IN PRODUCTION'
                    : avail == null ? 'UNKNOWN' : 'SHORT';
        return { ...base, avail, held, prod, covered, state };
    }
    const need = Math.max(ordered, soCodeNeedOf(so, c, isFeeCode));
    if (!soLineIsShelfPick(so, line, idx)) {
        return { code: c, ordered, need, committed, avail: null, held: 0, prod: 0, covered: committed, state: committed >= need && need > 0 ? 'GATHERED' : 'FROM THE FLOOR', fromFloor: true };
    }
    const free = stat && stat.avail != null ? stat.avail : null;
    const held = stat ? (Number(stat.held) || 0) : 0;
    const avail = free != null ? Math.max(0, free) + held : null;     // the order's view: free + held for it
    const prod = stat ? (Number(stat.prod) || 0) : 0;
    const covered = Math.max(committed, held) + (free != null ? Math.max(0, free) : 0);
    const state = committed >= need && need > 0 ? 'GATHERED'
        : covered >= need && need > 0 ? 'READY'
            : (covered + prod) >= need && need > 0 ? 'IN PRODUCTION'
                : avail == null ? 'UNKNOWN' : 'SHORT';
    return { code: c, ordered, need, committed, avail, held, prod, covered, state };
};
/** The order is ready when every line that is not a fee is GATHERED or READY. */
export const soOrderReadyOf = ({ so, statOf = () => null, isFeeCode = null }) => {
    const lines = ((so && so.lines) || []).map((l, i) => ({ l, i })).filter(x => soLineCodeOf(x.l) && !soLineIsFee(so, x.l, x.i, isFeeCode));
    if (!lines.length) return false;
    return lines.every(x => { const st = soPackLineStateOf({ so, line: x.l, idx: x.i, stat: statOf(soLineCodeOf(x.l)), isFeeCode }); return st.state === 'GATHERED' || st.state === 'READY'; });
};
/**
 * What a finished floor document GATHERS into its Order Entry order at Packaging Prep: the order lines it carries
 * (its soLineIdxs / its parts' soLineIdx, or the ones given), each under the piece's code, only what is not
 * already gathered. A fee rides nothing into the box.
 */
export const gatherPlanOf = ({ job, order, lineIdxs = null, isFeeCode = null }) => {
    const idxs = (Array.isArray(lineIdxs) && lineIdxs.length) ? lineIdxs
        : [...new Set([...((job && Array.isArray(job.soLineIdxs)) ? job.soLineIdxs : []), ...((job && job.partsList) || []).map(l => l && l.soLineIdx)])];
    return idxs.filter(i => Number.isInteger(i) && i >= 0)
        .map(i => ({ i, l: ((order && order.lines) || [])[i] }))
        .filter(x => x.l && soLineCodeOf(x.l) && !soLineIsFee(order, x.l, x.i, isFeeCode))
        .reduce((acc, x) => {
            // Each line adds its own pieces, up to what the ORDER still needs of the item (two lines of one item on this
            // document add both; a line another document already filled adds nothing).
            // A DOCUMENT OF A RELEASE CARRIES ONLY ITS OWN PIECES (Shared/rowRelease, 2026-10-05): it says how many of
            // each line (`soLineQty`), and that — not the whole line — is what it brings into the order's bin.
            const carried = job && job.soLineQty && job.soLineQty[x.i] != null ? (Number(job.soLineQty[x.i]) || 0) : null;
            const code = soLineCodeOf(x.l), qty = carried != null ? carried : (Number(x.l.qty) || 0), need = soCodeNeedOf(order, code, isFeeCode) || qty;
            if (acc.have[code] == null) acc.have[code] = committedQtyOf(order, code);
            const add = Math.max(0, Math.min(qty, need - acc.have[code]));
            acc.have[code] += add;
            acc.out.push({ idx: x.i, code, qty, need, add });
            return acc;
        }, { have: {}, out: [] }).out;
};

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
export function packLinesOf(job, { poleRows = null, isFeeCode = null } = {}) {
    if (!job) return [];
    const out = [];
    if (isQuickShip(job)) {
        (job.lines || []).forEach((l, i) => {
            if (soLineIsFee(job, l, i, isFeeCode)) return;   // ← the defect this module closes
            out.push({
                // The piece in the box: the FINISHED code for a to-be-finished line (soLineCodeOf, 2026-09-27).
                key: `L${i}`, erp: soLineCodeOf(l) || l.erp || '', aliasErp: l.aliasErp || '',
                name: `${l.name || 'Item'}${l.kit ? ` · ${l.kit}` : ''}`, qty: Number(l.qty) || 1,
                // The unit rides to the pack bench (Stuart 2026-09-16) — these rows are rebuilt to a
                // fixed shape, so an unlisted field is silently dropped rather than passed through.
                uom: l.uom || 'EA', pcs: Number(l.pcs) || Number(l.qty) || 1,
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
            uom: l.uom || 'EA', pcs: Number(l.pcs) || Number(l.quantity ?? l.qty) || 1,
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
