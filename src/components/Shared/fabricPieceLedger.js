// ── FABRIC CUT LEDGER — THE WRITES (Uniquity · S7, 2026-09-24) ─────────────────────────────────
// The policy lives in Shared/fabricPieces.js (pure, tested offline); this file is the Firestore
// half every mount shares — the 6.5 Fabric Cut Stock view today, the sewing floor's declare-the-
// remainder prompt in step 5. One write path so a cut declared on a tablet and a scrap posted from
// HQ leave identical records. Mirrors Shared/rodPieceLedger.
//
// `fabric_pieces` doc (id = the printable piece # on the label):
//   { id, codeKey, itemCode, brand, lengthIn, widthIn,
//     status: CUT | CONSUMED | SCRAP,
//     bornOf: { from: 'ROLL' | 'THROW' | <pieceId>, orderRef, by, at },
//     history: [{ orderRef, outcome, by, at }],
//     scrapIn?, scrapYd?, nsOutboxId?, nsStatus? }                 — the scrap posting trail
//
// `fabric_converts` doc: one per throw → yardage build { id, fabricCode, throwCode, throws,
//   yardsPerThrow, yards, brand, by, at, nsBuildId?, nsStatus }.
//
// Full uncut roll stock is NOT here — it is NetSuite's yards minus the ledger's pieces. Only
// SCRAP moves NetSuite (negative yards, account 254, through the staged ns_outbox); a CONVERT is a
// synchronous RESTlet build (the same vehicle the ring packs use), recorded here with its id.

import { db } from '../../firebase';
import { collection, doc, getDocs, query, setDoc, updateDoc, where, arrayUnion } from 'firebase/firestore';
import { BRAND_NETSUITE_MAP } from './brandNetsuite';
import { enqueueNsWrite } from './nsOutbox';
import { nsProxyFetch } from './nsProxy';
import { postNsAssemblyBuild } from './nsWorkOrder';
import { FABRIC_PIECE_STATUS, fabricCodeKey, newFabricPieceId, yardsUp, scrapAdjustmentPayload, convertPlanOf } from './fabricPieces';

const now = () => Date.now();
const COL = 'fabric_pieces';
const CONVERTS = 'fabric_converts';

async function resolveNsInternalId(itemCode) {
    const tries = [...new Set([String(itemCode || '').trim(), String(itemCode || '').split('/')[0].trim()])].filter(Boolean);
    for (const code of tries) {
        try {
            const snap = await getDocs(query(collection(db, 'Approved_Designs'), where('legacyErpId', '==', code)));
            const hit = snap.docs.map(d => d.data()).find(p => p.netSuiteInternalId);
            if (hit) return String(hit.netSuiteInternalId);
        } catch (e) { console.warn('fabric piece: internal-id lookup failed for', code, e); }
    }
    return null;
}

// Stage the NetSuite scrap adjustment and stamp the trail. Never throws — a scrap that cannot post
// stays visible as UNRESOLVED (retryable); the ledger is already true either way.
async function stageScrap({ pieceId, itemCode, brand, scrapIn, orderRef, by, homeBin }) {
    const yards = yardsUp(scrapIn);
    const patch = { scrapIn: Number(scrapIn) || 0, scrapYd: yards, updatedAt: now() };
    try {
        const nsConfig = BRAND_NETSUITE_MAP[String(brand || '').toLowerCase()];
        const internalId = yards > 0 && nsConfig ? await resolveNsInternalId(itemCode) : null;
        const p = scrapAdjustmentPayload({ internalId, nsConfig, yards, bin: homeBin || null, memo: `Fabric cut scrap by ${by || 'Sew'}: ${scrapIn}" ${itemCode} (piece ${pieceId}${orderRef ? ` · ${orderRef}` : ''})` });
        if (p) {
            patch.nsOutboxId = await enqueueNsWrite({ kind: 'fabric-scrap', label: `Scrap ${yards} yd ${itemCode} (${pieceId})`, targetUrl: p.targetUrl, method: p.method, payload: p.payload, sourceApp: 'FABRIC-PIECES', createdBy: by || '' });
            patch.nsStatus = 'QUEUED';
        } else if (yards > 0) patch.nsStatus = 'UNRESOLVED';
    } catch (e) {
        console.warn('fabric piece: scrap staging failed for', pieceId, e);
        patch.nsStatus = 'UNRESOLVED';
    }
    await updateDoc(doc(db, COL, pieceId), patch);
    return patch;
}

/** A piece added by hand (today's shelf) or declared by the floor. Returns the doc. */
export async function createFabricPiece({ itemCode, brand = 'uniquity', lengthIn, widthIn, bornOf, by }) {
    const id = newFabricPieceId();
    const piece = {
        id, codeKey: fabricCodeKey(itemCode), itemCode: String(itemCode || '').trim().toUpperCase(),
        brand: String(brand || 'uniquity').toLowerCase(),
        lengthIn: Number(lengthIn) || 0, widthIn: Number(widthIn) || 0, status: FABRIC_PIECE_STATUS.CUT,
        bornOf: { from: 'ROLL', orderRef: null, ...(bornOf || {}), by: (bornOf && bornOf.by) || by || '', at: now() },
        history: [], createdAt: now(), updatedAt: now(),
    };
    if (!(piece.lengthIn > 0) || !(piece.widthIn > 0)) throw new Error('A cut needs a length and a width in inches.');
    await setDoc(doc(db, COL, id), piece);
    return piece;
}

/** Consume a piece for an order (step 3 / step 5 call this; guarded so two tablets cannot spend it twice). */
export async function consumeFabricPiece({ piece, orderRef, by }) {
    const { getDoc } = await import('firebase/firestore');
    const fresh = await getDoc(doc(db, COL, piece.id));
    const cur = fresh.exists() ? fresh.data() : null;
    if (!cur || cur.status !== FABRIC_PIECE_STATUS.CUT) throw new Error(`Piece ${piece.id} is no longer available (${(cur && cur.status) || 'missing'}).`);
    await updateDoc(doc(db, COL, piece.id), {
        status: FABRIC_PIECE_STATUS.CONSUMED, updatedAt: now(),
        history: arrayUnion({ orderRef: orderRef || null, outcome: `consumed ${cur.lengthIn}" × ${cur.widthIn}"`, by: by || '', at: now() }),
    });
}

/** Scrap a standing piece (damaged / unusable); posts negative yards through the outbox. */
export async function scrapFabricPiece({ piece, by, orderRef = null, homeBin = null }) {
    await updateDoc(doc(db, COL, piece.id), {
        status: FABRIC_PIECE_STATUS.SCRAP, updatedAt: now(),
        history: arrayUnion({ orderRef, outcome: `scrapped at ${piece.lengthIn}" × ${piece.widthIn}"`, by: by || '', at: now() }),
    });
    return stageScrap({ pieceId: piece.id, itemCode: piece.itemCode, brand: piece.brand, scrapIn: piece.lengthIn, orderRef, by, homeBin });
}

/** Re-stage an UNRESOLVED scrap posting. */
export const retryFabricScrap = ({ piece, by, homeBin = null }) =>
    stageScrap({ pieceId: piece.id, itemCode: piece.itemCode, brand: piece.brand, scrapIn: piece.scrapIn ?? piece.lengthIn, orderRef: null, by, homeBin });

/**
 * THE CONVERT: N throws → yards of the fabric-yardage item, as a NetSuite assembly build through
 * the CE Convert RESTlet (the yardage item must be a NetSuite assembly whose BOM is the throw —
 * the RESTlet sources the components itself). Synchronous, like the ring packs: the operator sees
 * NetSuite's answer. Recorded in `fabric_converts` whatever the answer.
 */
export async function convertThrowsToYardage({ fabric, throwItem, throws, yardsPerThrow, brand = 'uniquity', by = '', bin = '', toBin = '', memo = '' }) {
    const plan = convertPlanOf({ throws, yardsPerThrow, fabric, throwItem });
    if (!plan.ok) throw new Error(plan.errors.join('; '));
    const id = `CVT-${now()}`;
    const rec = {
        id, brand: String(brand || 'uniquity').toLowerCase(),
        fabricCode: String(fabric.legacyErpId || fabric.itemId || '').toUpperCase(), fabricInternalId: String(fabric.netSuiteInternalId),
        throwCode: String((throwItem && (throwItem.legacyErpId || throwItem.itemId)) || (fabric.manufacturingSpecs && fabric.manufacturingSpecs.customData && fabric.manufacturingSpecs.customData.convertedFrom) || '').toUpperCase(),
        throws: plan.throws, yardsPerThrow: plan.yardsPerThrow, yards: plan.yards,
        by, at: now(), nsStatus: 'POSTING',
    };
    await setDoc(doc(db, CONVERTS, id), rec);
    try {
        const b = await postNsAssemblyBuild({ nsProxyFetch, brandId: rec.brand, internalId: rec.fabricInternalId, qty: plan.yards, bin, toBin, memo: memo || `Throw → yardage ${rec.throwCode} ×${plan.throws} = ${plan.yards} yd ${rec.fabricCode} (${by || 'HQ'})` });
        const nsBuildId = (b && (b.id || b.buildId || b.tranId)) ? String(b.id || b.buildId || b.tranId) : '';
        await updateDoc(doc(db, CONVERTS, id), { nsStatus: 'POSTED', nsBuildId, nsResponse: b && typeof b === 'object' ? JSON.stringify(b).slice(0, 2000) : String(b || '') });
        return { ...rec, nsStatus: 'POSTED', nsBuildId };
    } catch (e) {
        await updateDoc(doc(db, CONVERTS, id), { nsStatus: 'FAILED', nsError: String((e && e.message) || e).slice(0, 2000) });
        throw e;
    }
}
