// ── FABRIC CUT STOCK — THE RULES, PURE (Uniquity · S7, Stuart 2026-09-24) ──────────────────────
//
// Mirrors Shared/rodPieces for textiles. Fabric yardage is stocked ON THE ROLL; NetSuite keeps
// YARDS — the honest aggregate for money — but yards cannot answer the sewing floor's question:
// "is there a piece that makes a 23x23 today?" (10 yards made of 8" strips cannot.) So the app
// keeps a PIECE ledger (`fabric_pieces`): every cut that is not on the roll gets a piece # and a
// label; every piece is labelled with the LARGEST standard pillow size it can make (computed live
// from the minimum-cut table, Shared/pillowCuts — never stored, so a table change re-labels all).
//
// Stuart's rules (2026-09-24):
//   · fabric on the roll: a cut is just a clean cut (length off the roll × the fabric's width)
//   · NO computed waste rule — the sewing floor declares any remaining fabric and its usable size
//     when a pillow is finished (that prompt is the sewing work order's, step 5)
//   · a THROW converts into usable yards of its fabric-yardage item: typically 2 yards long × the
//     same width as the fabric; XL throws are longer. The convert is a NetSuite build of the
//     yardage item from the throw (the same RESTlet the ring packs and the /P convert use).
//   · scrap → NetSuite as negative YARDS, rounded UP to ⅛ yd (conservative — never show yards we
//     do not have), one line, account 254, through the staged ns_outbox.
//
// Pure — proven by scripts/fabricPieces.test.mjs.

import { largestSizeFor, sizesFor, isRailroad, fabricWidthOf } from './pillowCuts.js';

export const FABRIC_PIECE_STATUS = { CUT: 'CUT', CONSUMED: 'CONSUMED', SCRAP: 'SCRAP' };
export const YARD_STEP = 0.125;
export const DEFAULT_YARDS_PER_THROW = 2;

const num = (v) => (v === null || v === undefined || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
const r3 = (n) => Math.round(n * 1000) / 1000;

/** Same normalisation the rod ledger uses: case and punctuation ignored, any /suffix dropped. */
export const fabricCodeKey = (v) => String(v || '').trim().toUpperCase().split('/')[0].replace(/[^A-Z0-9]/g, '');

/** Short, printable, Code-128-able; time-ordered so the ledger sorts by birth. */
export const newFabricPieceId = () =>
    `F-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 4).toUpperCase()}`;

/** Inches → yards rounded UP to ⅛ (16" → 0.5; 20" → 0.625; 0 stays 0). */
export const yardsUp = (inches) => {
    const n = Number(inches) || 0;
    if (n <= 0) return 0;
    return r3(Math.ceil((n / 36 - 1e-9) / YARD_STEP) * YARD_STEP);
};

/** A live piece = still on the shelf. */
export const isLivePiece = (p) => !!p && (!p.status || p.status === FABRIC_PIECE_STATUS.CUT);

/** The label text for a piece: the largest standard size it makes, in its fabric's orientation. */
export const pieceLabelOf = (piece, { fabric = null, config = null } = {}) => {
    const rr = fabric ? isRailroad(fabric) : !!(piece && piece.railroad);
    const best = largestSizeFor({ cut: { lengthIn: piece && piece.lengthIn, widthIn: piece && piece.widthIn }, railroad: rr, config: config || {} });
    return best ? { key: best.key, text: `up to ${best.key}`, sizes: sizesFor({ cut: { lengthIn: piece.lengthIn, widthIn: piece.widthIn }, railroad: rr, config: config || {} }).map(s => s.key) } : { key: '', text: 'no standard size', sizes: [] };
};

/**
 * What the shelf really holds for one fabric: the live pieces, their yards, and the roll yards
 * left once the pieces are carved out of NetSuite's aggregate (NetSuite's yards INCLUDE the pieces
 * — they are still inventory; only scrap is adjusted out).
 */
export function honestYards({ nsYards = null, pieces = [] } = {}) {
    const live = (pieces || []).filter(isLivePiece);
    const pieceIn = live.reduce((s, p) => s + (Number(p.lengthIn) || 0), 0);
    const pieceYards = r3(pieceIn / 36);
    const longestIn = live.reduce((m, p) => Math.max(m, Number(p.lengthIn) || 0), 0);
    const rollYards = nsYards === null || nsYards === undefined ? null : r3(Math.max(0, Number(nsYards) - pieceYards));
    return { pieceCount: live.length, pieceYards, longestIn, rollYards };
}

/** Yards one throw yields: the throw's stored length (inches) ÷ 36, else its customData.yardsPerThrow, else 2. */
export const yardsPerThrowOf = (throwItem) => {
    const specs = (throwItem && throwItem.manufacturingSpecs) || {};
    const cd = specs.customData || {};
    const y = num(cd.yardsPerThrow);
    if (y !== null && y > 0) return y;
    const L = num(specs.length);
    if (L !== null && L > 0) return r3(L / 36);
    return DEFAULT_YARDS_PER_THROW;
};

/**
 * The convert: N throws → yards of the fabric-yardage item.
 * { ok, errors[], throws, yardsPerThrow, yards, widthIn } — the build quantity is `yards`.
 */
export function convertPlanOf({ throws, yardsPerThrow, fabric = null, throwItem = null } = {}) {
    const errors = [];
    const n = num(throws);
    if (n === null || n <= 0 || Math.floor(n) !== n) errors.push('throws must be a whole number of 1 or more');
    const ypt = num(yardsPerThrow) !== null ? num(yardsPerThrow) : (throwItem ? yardsPerThrowOf(throwItem) : null);
    if (ypt === null || ypt <= 0) errors.push('yards per throw is required (typically 2; XL throws are longer)');
    if (fabric && !fabric.netSuiteInternalId) errors.push(`${fabric.legacyErpId || 'the fabric'} has no NetSuite internal id — sync it (11.1) before converting`);
    if (fabric && throwItem && fabricWidthOf(fabric) && fabricWidthOf(throwItem) && fabricWidthOf(fabric) !== fabricWidthOf(throwItem)) errors.push(`width mismatch: fabric ${fabricWidthOf(fabric)}" vs throw ${fabricWidthOf(throwItem)}"`);
    const yards = errors.length ? 0 : r3(n * ypt);
    return { ok: errors.length === 0, errors, throws: n || 0, yardsPerThrow: ypt || 0, yards, widthIn: fabricWidthOf(fabric) || null };
}

/** The NetSuite scrap adjustment — the rod ledger's shape, in yards. */
export function scrapAdjustmentPayload({ internalId, nsConfig, yards, memo, bin = null }) {
    const qty = -Math.abs(Number(yards) || 0);
    if (!internalId || !nsConfig || !qty) return null;
    return {
        targetUrl: 'https://3728153.suitetalk.api.netsuite.com/services/rest/record/v1/inventoryadjustment',
        method: 'POST',
        payload: {
            account: { id: '254' }, subsidiary: { id: nsConfig.subsidiary }, memo: memo || '',
            inventory: {
                items: [{
                    item: { id: String(internalId) }, location: { id: nsConfig.location }, adjustQtyBy: qty,
                    ...(bin ? { inventoryDetail: { quantity: qty, inventoryAssignment: { items: [{ binNumber: { refName: String(bin) }, quantity: qty }] } } } : {}),
                }],
            },
        },
    };
}

/**
 * The drill-down: fabrics (library items) × pieces → one row per fabric, its live pieces labelled,
 * its throw (by customData.convertedFrom), sorted by code. A piece whose fabric is not in the
 * library still lists under its own code so nothing on the shelf is invisible.
 */
export function fabricRowsOf({ fabrics = [], throwsByCode = {}, pieces = [], config = null, nsYardsByCode = {} } = {}) {
    const byKey = new Map();
    (fabrics || []).forEach(f => { const k = fabricCodeKey(f.legacyErpId || f.itemId); if (k && !byKey.has(k)) byKey.set(k, { fabric: f, pieces: [] }); });
    (pieces || []).forEach(p => {
        const k = p.codeKey || fabricCodeKey(p.itemCode);
        if (!byKey.has(k)) byKey.set(k, { fabric: null, pieces: [] });
        byKey.get(k).pieces.push(p);
    });
    return [...byKey.entries()].map(([key, { fabric, pieces: ps }]) => {
        const code = (fabric && (fabric.legacyErpId || fabric.itemId)) || (ps[0] && ps[0].itemCode) || key;
        const live = ps.filter(isLivePiece).sort((a, b) => (Number(b.lengthIn) || 0) - (Number(a.lengthIn) || 0));
        const throwCode = fabric && fabric.manufacturingSpecs && fabric.manufacturingSpecs.customData && fabric.manufacturingSpecs.customData.convertedFrom;
        const nsYards = nsYardsByCode && Object.prototype.hasOwnProperty.call(nsYardsByCode, String(code).toUpperCase()) ? nsYardsByCode[String(code).toUpperCase()] : null;
        return {
            key, code, fabric, throwCode: throwCode || '', throwItem: throwCode ? (throwsByCode[String(throwCode).toUpperCase()] || null) : null,
            widthIn: fabricWidthOf(fabric), railroad: isRailroad(fabric),
            pieces: live.map(p => ({ ...p, label: pieceLabelOf(p, { fabric, config }) })),
            history: ps.filter(p => !isLivePiece(p)),
            avail: honestYards({ nsYards, pieces: ps }),
        };
    }).sort((a, b) => String(a.code).localeCompare(String(b.code)));
}
