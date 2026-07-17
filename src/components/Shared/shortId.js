import { db } from '../../firebase';
import { doc, runTransaction } from 'firebase/firestore';

// SHORT REFERENCE NUMBERS (Stuart 2026-07-17): staff and customers reference documents by a
// short number ("what's your work order #?") — the long Firestore doc ids stay as the real
// keys, but every user-facing document gets a simple sequential overlay: WO-1001, PO-1001, …
// One atomic counter per type in id_counters/{TYPE} (transaction-incremented, so two sessions
// can never mint the same number). Same idea as the portal's reserveQuoteNo for quotes.
export const reserveShortNo = async (type) => {
    const t = String(type || 'DOC').toUpperCase();
    const ref = doc(db, 'id_counters', t);
    const n = await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        const next = ((snap.exists() && Number(snap.data().n)) || 1000) + 1;
        tx.set(ref, { n: next, updatedAt: Date.now() }, { merge: true });
        return next;
    });
    return `${t}-${n}`;
};
