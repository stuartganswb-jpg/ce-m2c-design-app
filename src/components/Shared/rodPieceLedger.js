// ─────────────────────────────────────────────────────────────────────────────────────────────
// ROD PIECE LEDGER — THE WRITES (Stuart 2026-08-27, ROD_PIECE_INVENTORY_BRIEF.md)
// ─────────────────────────────────────────────────────────────────────────────────────────────
// The policy lives in Shared/rodPieces.js (pure, tested offline); this file is the Firestore
// half every mount shares — the shop cut panel, the HQ 6.5 inventory, the sweep. One write path
// so a cut logged on a tablet and a scrap posted from HQ leave identical records.
//
// `rod_pieces` doc (id = the printable piece # on the label):
//   { id, codeKey, itemCode, brand, lengthIn,
//     status: OFFCUT | CONSUMED | SCRAP,
//     bornOf: { fromPieceId|'FULL', orderRef, cutIn, by, at },      — how the piece came to be
//     history: [{ orderRef, cutIn, outcome, by, at }],              — every cut it served
//     scrapIn?, scrapFt?, nsOutboxId?, nsStatus? }                  — the scrap posting trail
//
// Full uncut shelf stock is NOT here — it is an unlabelled count (NS feet ÷ piece length). A doc
// is born the first time a rod is cut with a usable remainder. NetSuite stays feet-based: only
// SCRAP moves NS (negative acct-254 adjustment through the staged ns_outbox, feet rounded UP).

import { db } from '../../firebase';
import { collection, doc, getDoc, getDocs, query, setDoc, updateDoc, where, arrayUnion } from 'firebase/firestore';
import { BRAND_NETSUITE_MAP } from './brandNetsuite';
import { enqueueNsWrite } from './nsOutbox';
import {
    PIECE_STATUS, rodCodeKey, evaluateCut, scrapFeet, newPieceId, scrapAdjustmentPayload,
} from './rodPieces';

const now = () => Date.now();

// The stock rod on the shelf is the BASE item (no finish suffix) — that is what scrap adjusts.
// Exact code first; then the base spelling of a suffixed code (H1-138R/P scraps as H1-138R).
async function resolveNsInternalId(itemCode) {
    const tries = [...new Set([String(itemCode || '').trim(), String(itemCode || '').split('/')[0].trim()])].filter(Boolean);
    for (const code of tries) {
        try {
            const snap = await getDocs(query(collection(db, 'Approved_Designs'), where('legacyErpId', '==', code)));
            const hit = snap.docs.map(d => d.data()).find(p => p.netSuiteInternalId);
            if (hit) return String(hit.netSuiteInternalId);
        } catch (e) { console.warn('rod piece: internal-id lookup failed for', code, e); }
    }
    return null;
}

// Stage the NS scrap adjustment and stamp the trail onto the piece doc. Never throws — a scrap
// that cannot post stays visible as UNRESOLVED in the inventory (retryable), the ledger is
// already true either way.
async function stageScrapAdjustment({ pieceId, itemCode, brand, scrapIn, orderRef, by, homeBin }) {
    const feet = scrapFeet(scrapIn);
    const patch = { scrapIn: Number(scrapIn) || 0, scrapFt: feet, updatedAt: now() };
    try {
        const nsConfig = BRAND_NETSUITE_MAP[String(brand || '').toLowerCase()];
        const internalId = feet > 0 && nsConfig ? await resolveNsInternalId(itemCode) : null;
        const p = scrapAdjustmentPayload({
            internalId, nsConfig, feet, bin: homeBin || null,
            memo: `Rod offcut scrap by ${by || 'Shop'}: ${scrapIn}" ${itemCode} (piece ${pieceId}${orderRef ? ` · ${orderRef}` : ''})`,
        });
        if (p) {
            patch.nsOutboxId = await enqueueNsWrite({
                kind: 'rod-scrap', label: `Scrap ${feet} ft ${itemCode} (${pieceId})`,
                targetUrl: p.targetUrl, method: p.method, payload: p.payload,
                sourceApp: 'ROD-PIECES', createdBy: by || '',
            });
            patch.nsStatus = 'QUEUED';
        } else if (feet > 0) {
            patch.nsStatus = 'UNRESOLVED';   // no internal id / no brand map — retry from the HQ view
        }
    } catch (e) {
        console.warn('rod piece: scrap staging failed for', pieceId, e);
        patch.nsStatus = 'UNRESOLVED';
    }
    await updateDoc(doc(db, 'rod_pieces', pieceId), patch);
    return patch;
}

/** A piece created by hand (bootstrapping today's shelf) or born of a cut. Returns the doc. */
export async function createPiece({ itemCode, brand, lengthIn, bornOf, by }) {
    const id = newPieceId();
    const piece = {
        id, codeKey: rodCodeKey(itemCode), itemCode: String(itemCode || '').trim(),
        brand: String(brand || '').toLowerCase() || null,
        lengthIn: Number(lengthIn) || 0, status: PIECE_STATUS.OFFCUT,
        bornOf: { fromPieceId: 'FULL', orderRef: null, cutIn: null, ...(bornOf || {}), by: bornOf?.by || by || '', at: now() },
        history: [], createdAt: now(), updatedAt: now(),
    };
    await setDoc(doc(db, 'rod_pieces', id), piece);
    return piece;
}

/**
 * Log one cut against a chosen source — THE ledger write behind the cut-station panel.
 *   source: 'NEW' | a live piece doc.  The rule is re-evaluated here against the doc as it
 *   stands (never the panel's possibly-stale render): a piece another tablet consumed a second
 *   ago is refused, not double-cut.
 * Returns { outcome: 'KEEP'|'SCRAP', newPiece?, scrapIn, scrapFt } — the caller prints the new
 * piece's label / tells the operator what to bin.
 */
export async function logCut({ source, cutIn, itemCode, brand, pieceLengthIn, orderRef, by, homeBin, allowDeadZone = false }) {
    const cut = Number(cutIn) || 0;
    if (!(cut > 0)) throw new Error('No cut length.');
    const fromNew = source === 'NEW' || !source || !source.id;
    const srcLen = fromNew ? Number(pieceLengthIn) : Number(source.lengthIn);
    if (!(srcLen >= cut)) throw new Error(`The source (${srcLen || '?'}") is shorter than the cut (${cut}").`);

    let ev = evaluateCut(srcLen, cut);
    // A dead-zone pick from an OFFCUT needs the operator's explicit override; from a NEW rod the
    // remainder is unavoidable. Either way the standing sweep applies: under 36" is scrap.
    if (ev.action === 'DEAD') {
        if (!fromNew && !allowDeadZone) throw new Error(`Dead zone: cutting ${cut}" from ${srcLen}" leaves ${ev.remainderIn}" — unusable, and over the 18" waste cap. Pick another source (or override).`);
        ev = { action: 'SCRAP', remainderIn: 0, scrapIn: ev.remainderIn };
    }

    if (!fromNew) {
        // Consume the source piece — guarded so two tablets can't spend it twice.
        const fresh = await getDoc(doc(db, 'rod_pieces', source.id));
        const cur = fresh.exists() ? fresh.data() : null;
        if (!cur || cur.status !== PIECE_STATUS.OFFCUT) throw new Error(`Piece ${source.id} is no longer available (${cur?.status || 'missing'}) — re-check the recommendation.`);
        if (Number(cur.lengthIn) !== srcLen) throw new Error(`Piece ${source.id} is now ${cur.lengthIn}" (was ${srcLen}") — re-check the recommendation.`);
        await updateDoc(doc(db, 'rod_pieces', source.id), {
            status: PIECE_STATUS.CONSUMED, updatedAt: now(),
            history: arrayUnion({ orderRef: orderRef || null, cutIn: cut, outcome: ev.action === 'KEEP' ? `kept ${ev.remainderIn}"` : `scrapped ${ev.scrapIn}"`, by: by || '', at: now() }),
        });
    }

    const born = { fromPieceId: fromNew ? 'FULL' : source.id, orderRef: orderRef || null, cutIn: cut, by };
    if (ev.action === 'KEEP') {
        const newPiece = await createPiece({ itemCode, brand, lengthIn: ev.remainderIn, bornOf: born, by });
        return { outcome: 'KEEP', newPiece, scrapIn: 0, scrapFt: 0 };
    }

    // SCRAP remainder. From an existing piece the consumed doc carries the trail; from a full
    // rod there is no doc yet, so the scrap gets one — the ledger never loses an inch silently.
    let scrapDocId;
    if (fromNew) {
        const id = newPieceId();
        await setDoc(doc(db, 'rod_pieces', id), {
            id, codeKey: rodCodeKey(itemCode), itemCode: String(itemCode || '').trim(),
            brand: String(brand || '').toLowerCase() || null,
            lengthIn: Number(ev.scrapIn) || 0, status: PIECE_STATUS.SCRAP,
            bornOf: { ...born, by: by || '', at: now() }, history: [], createdAt: now(), updatedAt: now(),
        });
        scrapDocId = id;
    } else scrapDocId = source.id;
    const staged = (Number(ev.scrapIn) > 0)
        ? await stageScrapAdjustment({ pieceId: scrapDocId, itemCode, brand, scrapIn: ev.scrapIn, orderRef, by, homeBin })
        : { scrapFt: 0 };
    return { outcome: 'SCRAP', scrapIn: ev.scrapIn, scrapFt: staged.scrapFt || 0, nsStatus: staged.nsStatus || null };
}

/** Scrap a standing piece (the sweep, or a damaged/unusable offcut). */
export async function scrapPiece({ piece, by, orderRef = null, homeBin = null }) {
    await updateDoc(doc(db, 'rod_pieces', piece.id), {
        status: PIECE_STATUS.SCRAP, updatedAt: now(),
        history: arrayUnion({ orderRef, cutIn: null, outcome: `swept to scrap at ${piece.lengthIn}"`, by: by || '', at: now() }),
    });
    return stageScrapAdjustment({ pieceId: piece.id, itemCode: piece.itemCode, brand: piece.brand, scrapIn: piece.lengthIn, orderRef, by, homeBin });
}

/** Re-stage an UNRESOLVED scrap posting (from the HQ inventory view). */
export const retryScrapPost = ({ piece, by, homeBin = null }) =>
    stageScrapAdjustment({ pieceId: piece.id, itemCode: piece.itemCode, brand: piece.brand, scrapIn: piece.scrapIn ?? piece.lengthIn, orderRef: null, by, homeBin });
