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

export function usePayBlock({ collection, docId, reference, label, enabled = true }) {
    const [pay, setPay] = useState(null);

    useEffect(() => {
        let alive = true;
        if (!enabled || (!docId && !reference)) { setPay(null); return undefined; }
        (async () => {
            try {
                const res = await httpsCallable(functions, 'payLinksFor')({ collection, docId, reference });
                const link = payableLinkOf(res.data.links);
                if (!alive || !link) { if (alive) setPay(null); return; }
                const qrSvg = await QRCode.toString(link.url, { type: 'svg', margin: 1, width: 104, errorCorrectionLevel: 'M' }).catch(() => '');
                if (alive) setPay({ url: link.url, qrSvg, amountDue: link.amountDue, label: label || '' });
            } catch (e) {
                if (alive) setPay(null);   // a document must still print when payments are unreachable
            }
        })();
        return () => { alive = false; };
    }, [collection, docId, reference, label, enabled]);

    return pay;
}
