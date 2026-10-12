// ── A NEW CUSTOMER, IN NETSUITE FIRST (the show counter · Stuart 2026-10-12: "go on the new customer creator") ──
//
// The app's customer id IS the NetSuite id (crm_records/CUST-<nsid>; Shared/nsHeader.nsCustomerIdOf strips the
// prefix for the sales order's entity), so a customer met at the show must exist in NetSuite BEFORE the record
// is made, or the sales order refuses at the entity. One synchronous POST through the proxy (which asks
// NetSuite for the created record back — `Prefer: return=representation` — so the id is in the answer), then
// the CRM record in the SAME shape the 11.1 customer sync writes, plus the app-owned fields the CRM's own
// + New sets. Pure parts proven by scripts/nsCustomer.test.mjs; the write is createNsCustomer.
import { BRAND_NETSUITE_MAP } from './brandNetsuite.js';

const str = (v) => String(v == null ? '' : v).trim();

/** The NetSuite customer body. A company record (isPerson false) — a designer / a store, as the catalogue sells to. */
export function customerPayloadOf({ name, email = '', phone = '', brand = 'uniquity', salesRep = '', at = 0 } = {}) {
    const errors = [];
    const n = str(name);
    if (!n) errors.push({ code: 'NO_NAME', message: 'A new customer needs a name.' });
    const map = BRAND_NETSUITE_MAP[String(brand || '').toLowerCase()];
    if (!map || !map.subsidiary) errors.push({ code: 'NO_SUBSIDIARY', message: `No NetSuite subsidiary on file for brand "${brand}".` });
    if (errors.length) return { ok: false, errors, payload: null };
    const e = str(email), p = str(phone);
    return {
        ok: true, errors: [],
        payload: {
            companyName: n.slice(0, 83), isPerson: false,
            subsidiary: { id: String(map.subsidiary) },
            ...(e ? { email: e } : {}), ...(p ? { phone: p.slice(0, 21) } : {}),
            externalId: `APP-${String(brand).toUpperCase()}-${at || Date.now()}`,
            comments: `Created at the ${String(brand)} show counter${salesRep ? ` by ${salesRep}` : ''}`.slice(0, 4000),
        },
    };
}

/** The NetSuite id in a create answer (the record itself with return=representation; a Location link otherwise). */
export const nsIdOfCreateAnswer = (data, location = '') => {
    const d = data || {};
    const direct = d.id || d.internalId || (d.result && d.result.id);
    if (direct) return String(direct);
    const self = Array.isArray(d.links) ? d.links.find(l => l && /self/i.test(String(l.rel || ''))) : null;
    const m = String((self && self.href) || location || '').match(/\/(\d+)\s*$/);
    return m ? m[1] : '';
};

/** NetSuite's own words when it refuses. */
export const nsErrorOf = (data, status) => {
    const d = data || {};
    const det = Array.isArray(d['o:errorDetails']) && d['o:errorDetails'][0];
    return (det && det.detail) || d.title || d.error || d.message || (status ? `NetSuite HTTP ${status}` : 'NetSuite did not answer');
};

/** The CRM record — the 11.1 customer sync's shape + the CRM's app-owned fields. */
export function crmRecordOf({ nsId, name, email = '', phone = '', brand = 'uniquity', by = '', at = 0 } = {}) {
    const id = `CUST-${str(nsId)}`;
    return {
        id, type: 'CUSTOMER', stage: 'CUSTOMER',
        name: str(name), email: str(email), phone: str(phone), creditLimit: 0, terms: '',
        brandId: brand, sharedBrands: [brand],
        contact: str(name), salesRep: str(by), discountCode: '', billingAddress: '', shippingAddresses: [],
        ytd: 0, mtd: 0, openOrders: 0,
        createdAt: new Date(at || Date.now()).toISOString(), createdVia: 'SHOW_COUNTER', createdBy: str(by), nsInternalId: str(nsId),
    };
}

/** The app-only record when NetSuite could not be reached — said on the record so the push refusal is understood. */
export const crmRecordAppOnlyOf = ({ name, email = '', phone = '', brand = 'uniquity', by = '', at = 0, reason = '' } = {}) => {
    const id = `CUST-${Math.floor(1000 + Math.random() * 9000)}`;
    return { ...crmRecordOf({ nsId: id.slice(5), name, email, phone, brand, by, at }), id, nsInternalId: '', nsPending: true, nsPendingReason: str(reason).slice(0, 300) };
};

/** POST the customer; returns { ok, nsId, error }. */
export async function createNsCustomer({ nsProxyFetch, payload }) {
    const r = await nsProxyFetch({ targetUrl: 'https://3728153.suitetalk.api.netsuite.com/services/rest/record/v1/customer', method: 'POST', payload });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, nsId: '', error: nsErrorOf(data, r.status) };
    const nsId = nsIdOfCreateAnswer(data, (r.headers && r.headers.get && r.headers.get('location')) || '');
    if (!nsId) return { ok: false, nsId: '', error: 'NetSuite took the customer but did not say its id — sync customers on 11.1 and pick them from the list.' };
    return { ok: true, nsId, error: '' };
}
