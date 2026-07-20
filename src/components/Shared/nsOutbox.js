import { db } from '../../firebase';
import { collection, doc, setDoc } from 'firebase/firestore';

// ============================================================================
// LAYER 2 — STAGED NETSUITE WRITES (Stuart 2026-07-16)
// ============================================================================
// Instead of posting live, a flow enqueues the EXACT proxy call (targetUrl /
// method / payload) into Firestore `ns_outbox`; the nsOutboxWorker cloud
// function drains the queue about once a minute — strictly serial, with
// backoff retries on 429/5xx — so write bursts smear out over the day instead
// of fighting for the account's ~5 concurrency slots.
//
// Idempotency: a marker is stamped into the payload memo — human-readable
// push date/time plus a short unique ref: `[app push 07/20/26, 2:32 PM #aVNdVI]`
// (Stuart 2026-07-20 — replaced the raw `[ob:<id>]` blob NetSuite users saw).
// If the worker crashes after NetSuite accepted the write, the retry FIRST
// looks the `#<ref>]` token up in NetSuite and recovers the posted transaction
// instead of double-posting. The worker's recovery search matches BOTH the old
// and new formats (functions/index.js — keep in sync).
//
// Optional writeBack: { collection, docId, patch, idField, tranField } — once
// posted, the worker merges patch onto that app doc and stamps the NetSuite
// internal id / tran number into the named fields (e.g. hq_purchase_orders
// gets status + nsPoId + nsPoTran, and the card updates via its listener).
//
// Monitor / retry / cancel UI: HQ 11.1 → "NetSuite Sync Queue".
export const enqueueNsWrite = async ({ kind, label, targetUrl, method, payload, sourceApp, createdBy, writeBack }) => {
    const ref = doc(collection(db, 'ns_outbox'));
    const p = payload ? JSON.parse(JSON.stringify(payload)) : {};
    // Shop time (High Point NC) regardless of the device's zone, so the memo reads true on the floor.
    const stamp = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', month: '2-digit', day: '2-digit', year: '2-digit', hour: 'numeric', minute: '2-digit' });
    const marker = `[app push ${stamp} #${ref.id.slice(0, 6)}]`;
    if (typeof p.memo === 'string') p.memo = `${p.memo} ${marker}`;
    else if (method === 'POST' && /\/record\/v1\//.test(String(targetUrl))) p.memo = marker;
    await setDoc(ref, {
        id: ref.id, kind: kind || 'write', label: label || '', sourceApp: sourceApp || '', createdBy: createdBy || '',
        targetUrl, method, payload: p, writeBack: writeBack || null,
        status: 'PENDING', attempts: 0, lastError: null, nsId: null, nsTran: null,
        createdAt: Date.now(), nextAttemptAt: Date.now(), leasedAt: null, postedAt: null
    });
    return ref.id;
};
