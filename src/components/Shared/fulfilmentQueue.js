// ── THE ONE QUEUER OF A SALES ORDER'S NETSUITE FULFILMENT (Stuart 2026-10-12) ───────────────────────────────────────
// The pack bench queued it inline; now it is queued here, from the pack bench AND from the Fulfilment tab's "send /
// resend", so the two can never build it differently:
//   1. the sales order's open lines, each with its own location (Shared/fulfilmentLines — unchanged);
//   2. NetSuite's bins for those items, read live; a line whose item sits in MORE THAN ONE bin is asked about
//      (Shared/fulfilmentBins + Shared/BinChoiceModal) and the choice rides the line as its inventory detail;
//   3. an entry that already FAILED for this order is cancelled — it carries no bin and can only fail again — and the
//      new one is queued under the same key (one fulfilment per sales order in flight, as before).
// A bin read that fails stops the send (the packer is told) — never a blind send that NetSuite will refuse.
import { db } from '../../firebase';
import { doc, getDocs, query, collection, where, updateDoc } from 'firebase/firestore';
import { nsProxyFetch } from './nsProxy';
import { enqueueNsWrite } from './nsOutbox';
import { soLinesSql, fulfilmentItemsOf, refusalText } from './fulfilmentLines';
import { binsSql, fulfilItemIdsOf, binChoicesOf, fulfilmentItemsWithBins, binPickText, fulfilmentTargetOf } from './fulfilmentBins';

const SUITEQL = 'https://3728153.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql';
const suiteql = async (q, what) => {
    const r = await nsProxyFetch({ targetUrl: SUITEQL, method: 'POST', payload: { q } });
    const j = await r.json();
    if (!r.ok) throw new Error(`could not read ${what} — ${JSON.stringify(j).slice(0, 200)}`);
    return j.items || [];
};

/**
 * @param nsSoId    the NetSuite sales order id
 * @param ref       what the packer calls the order (the window's title, the log)
 * @param label     the queue entry's label
 * @param memo      the fulfilment's memo
 * @param writeBack where NetSuite's fulfilment id is written when it posts
 * @param preferBin the order's own bin, pre-chosen when it covers a line
 * @param askBins   (title, choices) → Promise<picks | null> (Shared/BinChoiceModal.useBinAsk)
 * @returns { ok: true, binText, asked } | { ok: false, reason: 'REFUSED' | 'NOT_CHOSEN', text }
 */
export const queueSoFulfilment = async ({ nsSoId, ref = '', label = '', memo = '', writeBack = null, createdBy = '', sourceApp = 'WMS', preferBin = '', askBins }) => {
    const id = String(nsSoId || '').trim();
    const soRows = await suiteql(soLinesSql(id), 'the sales order lines');
    const ifItems = fulfilmentItemsOf(soRows);
    if (!ifItems.ok) return { ok: false, reason: 'REFUSED', code: ifItems.reason, missing: ifItems.missing || [], text: refusalText(ifItems) };
    const sql = binsSql(fulfilItemIdsOf(ifItems.items, soRows));
    const binRows = sql ? await suiteql(sql, 'the bins these items are in') : [];
    const choices = binChoicesOf({ items: ifItems.items, soRows, binRows, preferBin });
    let picks = {};
    if (choices.length) {
        picks = typeof askBins === 'function' ? await askBins(ref || `SO ${id}`, choices) : null;
        if (!picks) return { ok: false, reason: 'NOT_CHOSEN', choices, text: `No bin was chosen for ${choices.map(c => c.item).join(', ')} — NetSuite holds ${choices.length === 1 ? 'it' : 'them'} in more than one bin and cannot fulfil without it. The fulfilment was NOT sent.` };
    }
    const dedupeKey = `if:${id}`;
    // A FAILED entry for this order can only fail again as it is: it is cancelled, with the reason, before the new one.
    try {
        const prior = await getDocs(query(collection(db, 'ns_outbox'), where('dedupeKey', '==', dedupeKey)));
        for (const d of prior.docs) {
            if (String((d.data() || {}).status || '') !== 'FAILED') continue;
            await updateDoc(doc(db, 'ns_outbox', d.id), { status: 'CANCELLED', cancelledAt: Date.now(), cancelledBy: createdBy || '', cancelReason: 'superseded — the fulfilment was sent again from the WMS (bins confirmed)' });
        }
    } catch (e) { console.warn('could not cancel the failed fulfilment entry (the new one is still queued)', e); }
    const binText = binPickText(choices, picks);
    const items = fulfilmentItemsWithBins(ifItems.items, choices, picks);
    await enqueueNsWrite({
        kind: 'itemfulfillment', dedupeKey,
        label: `${label}${binText ? ` · ${binText}` : ''}`,
        sourceApp, createdBy,
        // A line that names its bin replaces the bin NetSuite fills in itself (the preferred one) — Shared/fulfilmentBins.
        targetUrl: fulfilmentTargetOf(id, items),
        method: 'POST',
        payload: { shipStatus: { id: 'B' }, memo, item: { items } },
        writeBack,
    });
    return { ok: true, binText, asked: choices.length };
};
