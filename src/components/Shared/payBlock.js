// THE PAY BLOCK ON A DOCUMENT — the one rule for "does this printed page carry a pay link?".
//
// Stuart 2026-09-23: a link is printed only "when decided to add it", so a document shows the block
// only while an OPEN link exists for it. Nothing here creates or changes a link; it reads what
// Shared/PayLinkPanel made, draws the QR locally (never through an outside service — the link
// itself would be the thing leaking), and hands FormPreview a `pay` object.
import { useEffect, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../firebase';
import QRCode from 'qrcode';

// The link a document should advertise: the newest one still payable. A paid or cancelled link is
// never printed — a customer must not be invited to pay something twice.
export const payableLinkOf = (links = []) => (links || [])
    .filter((l) => l && (l.status === 'OPEN' || l.status === 'CHARGING'))
    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))[0] || null;

// THE ONE READ, as a plain function — because not every document is printed from a render. RTG
// builds its page inside an async printDoc(), where a hook cannot go, and a second copy of this
// logic there would be a second answer to "what has been paid" (Stuart 2026-10-16).
export async function fetchPayBlock({ collection, docId, reference, label }) {
    if (!docId && !reference) return null;
    try {
        const res = await httpsCallable(functions, 'payLinksFor')({ collection, docId, reference });
        const link = payableLinkOf(res.data.links);
        // WHAT HAS BEEN PAID IS PART OF THE DOCUMENT, not only what is still wanted
        // (Stuart 2026-10-15). This used to return nothing the moment an order was paid — the link
        // went PAID, the block vanished, and the printed sales order said nothing about the deposit
        // the customer had just handed over. A block is returned when there is EITHER something
        // still payable OR something already paid.
        const paidTotal = Number(res.data.paidTotal || 0);
        if (!link && !(paidTotal > 0)) return null;
        const qrSvg = link
            ? await QRCode.toString(link.url, { type: 'svg', margin: 1, width: 104, errorCorrectionLevel: 'M' }).catch(() => '')
            : '';
        return { url: link ? link.url : '', qrSvg, amountDue: link ? link.amountDue : 0, paidTotal, label: label || '' };
    } catch (e) {
        return null;   // a document must still print when payments are unreachable
    }
}

export function usePayBlock({ collection, docId, reference, label, enabled = true }) {
    const [pay, setPay] = useState(null);

    useEffect(() => {
        let alive = true;
        if (!enabled || (!docId && !reference)) { setPay(null); return undefined; }
        (async () => {
            const block = await fetchPayBlock({ collection, docId, reference, label });
            if (alive) setPay(block);
        })();
        return () => { alive = false; };
    }, [collection, docId, reference, label, enabled]);

    return pay;
}
