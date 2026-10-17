// ── MATCH AN APP-ONLY CUSTOMER TO ITS NETSUITE RECORD, PURE (S7, 2026-10-17) ─────────────────────
//
// An app-only customer (CUST-APP-<time>, nsPending — filed at the counter when NetSuite could not be reached) never
// gets a NetSuite id in place: 11.1 syncs the NetSuite customer in as a NEW record, and the app-only one's orders,
// quotes and any deposit keep pointing at it — a deposit would wait for ever (the Payments session, 2026-10-17: the
// posting re-reads the customer from the DOCUMENT on every retry, so re-stamping the order and the quote is enough;
// the payments ledger is never written here).
//
//   matchPatchesOf({ appOnly, target, orders, quotes, by, at })
//     → { crm: [{ id, patch }], orders: [{ id, patch }], quotes: [{ id, patch }], count }
//   The app-only record is marked matchedTo (kept, never deleted — it is the audit of what the counter did); every
//   order / quote carrying its id is re-stamped to the target's id and name.

const str = (v) => String(v == null ? '' : v).trim();

export const isMatchedAway = (rec) => !!(rec && str(rec.matchedTo));

export function matchPatchesOf({ appOnly, target, orders = [], quotes = [], by = '', at = 0 } = {}) {
    const errors = [];
    const fromId = str(appOnly && appOnly.id);
    const toId = str(target && target.id);
    if (!fromId) errors.push({ code: 'NO_SOURCE', message: 'No app-only customer to match.' });
    if (!toId) errors.push({ code: 'NO_TARGET', message: 'Pick the NetSuite customer record it is.' });
    if (toId && target.nsPending) errors.push({ code: 'TARGET_APP_ONLY', message: `${target.name || toId} is itself app-only — pick a record that is in NetSuite.` });
    if (toId && fromId === toId) errors.push({ code: 'SAME', message: 'That is the same record.' });
    if (errors.length) return { ok: false, errors, crm: [], orders: [], quotes: [], count: 0 };
    const now = at || Date.now();
    const toName = str(target.name);
    const orderPatches = (orders || []).filter(o => o && str(o.customerId) === fromId).map(o => ({ id: o.id, patch: { customerId: toId, customer: toName || o.customer || '', customerMatchedFrom: fromId, customerMatchedAt: now, customerMatchedBy: str(by) } }));
    const quotePatches = (quotes || []).filter(j => j && j.customer && str(j.customer.id) === fromId).map(j => ({ id: j.id, patch: { customer: { ...(j.customer || {}), id: toId, name: toName || (j.customer && j.customer.name) || '' }, customerMatchedFrom: fromId, customerMatchedAt: now, customerMatchedBy: str(by) } }));
    const crm = [{ id: fromId, patch: { matchedTo: toId, matchedAt: now, matchedBy: str(by), nsPending: true } }];
    return { ok: true, errors: [], crm, orders: orderPatches, quotes: quotePatches, count: orderPatches.length + quotePatches.length };
}
