// ── A STOCK RUN IS PUT AWAY BY SCANNING IT INTO ITS BIN (Stuart 2026-10-08) ───────────────────────────────────────────
// "stock orders should operate pretty much like it does now, no picture required, just pack into each products set
//  packaging … and then the user commits that they finished packing the products then they need to scan the items into
//  their shelf bin to confirm they put it in the correct places."
//
// Packaging Prep, a STOCK run (orderType 'stock', a paint run included), in this order:
//   PACKAGE   the product goes into its own packaging and the packer says so (the line's tick — who and when);
//   ITEM      the ITEM label is scanned: it must be this run's item;
//   BIN       the BIN label is scanned: a real bin (the bin lock, in the WMS), and when it is not a bin the item is
//             known to live in, the packer is ASKED — his words: "are you sure you want to put it in this bin?";
//   READY     ✓ Put Away — the press that has always posted the NetSuite build into the scanned bin. Unchanged.
// The bin box used to arrive FILLED from the Library, so a run could be put away with nothing scanned at all; it now
// starts empty and the expected bin is shown beside it as text.
//
// The rules are here; PickPack/StockPutAwayPanel draws them and PickPackApp.completePacking enforces them. Pure — no
// Firestore, no NetSuite, no React. Harness: scripts/putAwayScan.test.mjs.
import { parseScan } from './labelScan.js';

const U = (v) => String(v == null ? '' : v).trim().toUpperCase();
// A bin as the WMS tidies one before comparing (PickPackApp.normalizeBin): upper case, no space round a dash.
export const tidyBin = (v) => U(v).replace(/\s*-\s*/g, '-').replace(/\s+/g, ' ');

export const PUT_AWAY_STEP = Object.freeze({ PACKAGE: 'PACKAGE', ITEM: 'ITEM', BIN: 'BIN', READY: 'READY' });

/** The item a stock run puts away — a paint run's is the item it adjusts in. */
export const runItemCodeOf = (job) => U(job && (job.jfpItemCode || job.stockErpId || job.type));
/** Every code the run's product answers to: what an item label of it may barcode. */
export const runItemCodesOf = (job) => [...new Set([job && job.jfpItemCode, job && job.stockErpId, job && job.type].map(U).filter(Boolean))];

/**
 * Read the ITEM scan of a put-away.
 * @param raw      what the scanner (or a hand) put in the box — a plain item code, or a pack label (CODE*UNIT*PCS)
 * @param job      the stock run
 * @param runKeys  the run's OWN labels (its work-order reference, its staging key): scanning one of those is a
 *                 different mistake from scanning another item, and says so
 * @returns {{ ok, empty, code, msg }}
 */
export const itemScanOf = (raw, job, { runKeys = [] } = {}) => {
    const p = parseScan(raw);
    if (!p.code) return { ok: false, empty: true, code: '', msg: '' };
    const codes = runItemCodesOf(job), mine = runItemCodeOf(job);
    if (!codes.length) return { ok: false, empty: false, code: p.code, msg: 'This run names no item, so its label cannot be checked — tell a manager. Nothing was put away.' };
    if (codes.includes(p.code)) return { ok: true, empty: false, code: p.code, msg: '' };
    if ((runKeys || []).map(U).filter(Boolean).includes(U(raw))) {
        return { ok: false, empty: false, code: p.code, msg: `That is this run's work-order label. Scan the ITEM label of ${mine} — the one on the packaged product.` };
    }
    return { ok: false, empty: false, code: p.code, msg: `That is ${p.code} — this run is ${mine}. Scan the item label of what you are putting away.` };
};

/**
 * Where the item is expected: the bins NetSuite holds it in today; failing that, the bins the Library names for it.
 * @param live  the WMS live-bin read for the item ({ bins: [{ bin, name, qty }] }) or null
 * @param part  the library record, or null
 * @returns {{ source: 'NETSUITE' | 'LIBRARY' | '', bins: [{ bin, name, qty }] }}   qty is null for a Library bin
 */
export const expectedBinsOf = ({ live = null, part = null } = {}) => {
    const held = ((live && live.bins) || []).filter(b => b && b.bin && (Number(b.qty) || 0) > 0)
        .map(b => ({ bin: tidyBin(b.bin), name: String(b.name || b.bin), qty: Number(b.qty) || 0 }));
    if (held.length) return { source: 'NETSUITE', bins: held };
    const named = String((part && (part.binLocation || (part.manufacturingSpecs && part.manufacturingSpecs.binLocation))) || '')
        .split(',').map(s => s.trim()).filter(s => s && U(s) !== 'UNASSIGNED');
    const seen = new Set();
    const lib = named.map(n => ({ bin: tidyBin(n), name: n, qty: null })).filter(b => (seen.has(b.bin) ? false : (seen.add(b.bin), true)));
    return lib.length ? { source: 'LIBRARY', bins: lib } : { source: '', bins: [] };
};
/** The expected bins in words, for beside the bin box. */
export const expectedBinsText = (expected, max = 3) => {
    const e = expected || { source: '', bins: [] };
    if (!e.bins.length) return 'No bin on record for this item yet.';
    const list = e.bins.slice(0, max).map(b => (b.qty != null ? `${b.name} ×${b.qty}` : b.name)).join(' · ');
    const more = e.bins.length > max ? ` · +${e.bins.length - max} more` : '';
    return e.source === 'NETSUITE' ? `NetSuite holds it in: ${list}${more}` : `The Library names: ${list}${more} (NetSuite holds none today)`;
};

/**
 * The question to ask before putting the run in this bin — '' when it is a bin the item is expected in, or when
 * nothing is known to compare against (an item with no bin yet is not a wrong bin).
 */
export const binQuestionOf = ({ bin, code = '', expected = null } = {}) => {
    const b = tidyBin(bin), e = expected || { source: '', bins: [] };
    if (!b || !e.bins.length || e.bins.some(x => x.bin === b)) return '';
    const where = e.bins.slice(0, 3).map(x => x.name).join(', ');
    const known = e.source === 'NETSUITE' ? `NetSuite holds ${code || 'this item'} in ${where} today` : `the Library names ${where} for ${code || 'this item'}`;
    return `Are you sure you want to put it in this bin?\n\n${String(bin).trim()} — ${known}.\n\nOK = put it away in ${String(bin).trim()} (NetSuite receives the pieces into that bin).\nCancel = scan another bin.`;
};

/** Where the put-away stands. */
export const putAwayStepOf = ({ packaged = false, itemOk = false, bin = '' } = {}) =>
    (!packaged ? PUT_AWAY_STEP.PACKAGE : (!itemOk ? PUT_AWAY_STEP.ITEM : (!tidyBin(bin) ? PUT_AWAY_STEP.BIN : PUT_AWAY_STEP.READY)));
/** What ✓ Put Away is still waiting for, in the packer's words — '' when it can be pressed. */
export const putAwayBlockerOf = (step, itemCode = '') => ({
    [PUT_AWAY_STEP.PACKAGE]: 'confirm the packaging is finished (✓ Packaging finished on the line)',
    [PUT_AWAY_STEP.ITEM]: `scan the item label${itemCode ? ` of ${itemCode}` : ''}`,
    [PUT_AWAY_STEP.BIN]: 'scan the bin label of the shelf bin it went into',
}[step] || '');
