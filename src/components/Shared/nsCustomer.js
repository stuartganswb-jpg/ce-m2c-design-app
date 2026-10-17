// ── A NEW CUSTOMER, IN NETSUITE FIRST (the show counter · Stuart 2026-10-12: "go on the new customer creator") ──
//
// The app's customer id IS the NetSuite id (crm_records/CUST-<nsid>; Shared/nsHeader.nsCustomerIdOf strips the
// prefix for the sales order's entity), so a customer met at the show must exist in NetSuite BEFORE the record
// is made, or the sales order refuses at the entity. One synchronous POST through the proxy, then the CRM record
// in the SAME shape the 11.1 customer sync writes, plus the app-owned fields the CRM's own + New sets. Pure parts
// proven by scripts/nsCustomer.test.mjs; the writes are createNsCustomer and the counter's own setDoc.
//
// WHERE THE NEW ID IS SAID (Stuart 2026-10-17, Baker Stone Studio made twice): NetSuite answers a create with NO
// body — it does not honour `Prefer: return=representation` — and names the new record only in its Location
// header. The proxy now hands that on as `location` in the answer; and if an accepted create still names no id,
// the customer is read back by the externalId this body gave it, so a made customer is never reported as not made.
//
// ONE CUSTOMER, ONCE (same day): Baker Stone Studio was already a customer — in NetSuite since 7/8 and on the
// counter's own list — and the counter made a second one. existingCustomersOf looks first: the same email or the
// same company name, on the brand's CRM list and in the brand's NetSuite subsidiary.
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

/** The NetSuite id in a create answer: the record itself, its self link, or the Location the proxy hands on (`location`). */
export const nsIdOfCreateAnswer = (data, location = '') => {
    const d = data || {};
    const direct = d.id || d.internalId || (d.result && d.result.id);
    if (direct) return String(direct);
    const self = Array.isArray(d.links) ? d.links.find(l => l && /self/i.test(String(l.rel || ''))) : null;
    const m = String((self && self.href) || d.location || location || '').match(/\/(\d+)\s*$/);
    return m ? m[1] : '';
};

const sqlText = (v) => str(v).replace(/'/g, "''");
const SUITEQL = 'https://3728153.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql';

/** The customer an accepted create made, read back by the externalId its body carried. '' without one. */
export const customerByExternalIdSql = (externalId) => (str(externalId)
    ? `SELECT c.id AS id, c.entityid AS entityid FROM customer c WHERE c.externalid = '${sqlText(externalId)}'`
    : '');

/** Customers in the brand's subsidiary with the same email or the same company name. '' when there is nothing to look for. */
export const customerLookupSql = ({ name = '', email = '', brand = 'uniquity' } = {}) => {
    const map = BRAND_NETSUITE_MAP[String(brand || '').toLowerCase()];
    const n = str(name), e = str(email);
    if (!map || !map.subsidiary || (!n && !e)) return '';
    const same = [e ? `LOWER(c.email) = '${sqlText(e.toLowerCase())}'` : '', n ? `UPPER(c.companyname) = '${sqlText(n.toUpperCase())}'` : ''].filter(Boolean).join(' OR ');
    return `SELECT c.id AS id, c.entityid AS entityid, c.companyname AS companyname, c.email AS email FROM customer c `
        + `WHERE c.isinactive = 'F' AND c.subsidiary = ${parseInt(map.subsidiary, 10)} AND (${same}) ORDER BY c.id`;
};

const nsIdOfCrmId = (id) => { const m = str(id).match(/^CUST-(\d+)$/); return m ? m[1] : ''; };
const nameKey = (v) => str(v).toLowerCase().replace(/[^a-z0-9]+/g, '');

/** The brand's CRM customers that are this one — same email, or same company name ignoring case and punctuation.
 *  An app-only record (nsPending) is not offered: it is not in NetSuite, so a sale on it cannot go through. */
export const sameCustomersOf = ({ name = '', email = '', customers = [] } = {}) => {
    const e = str(email).toLowerCase(), n = nameKey(name);
    if (!e && !n) return [];
    return (customers || []).filter(c => c && !c.nsPending && (
        (e && str(c.email).toLowerCase() === e) || (n && nameKey(c.name) === n)));
};

/**
 * Is this customer already ours? → { matches: [{ rec, nsId, entityId, name, email, inApp }], nsChecked, nsError }.
 * `rec` is the CRM record to pick when the app has one (`inApp`), else null — the customer is in NetSuite only and
 * is filed under CUST-<nsId> when chosen. NetSuite not answering is said (nsChecked false), never taken as "none".
 */
export async function existingCustomersOf({ nsProxyFetch, name = '', email = '', brand = 'uniquity', customers = [] } = {}) {
    const inCrm = sameCustomersOf({ name, email, customers });
    const byId = new Map((customers || []).filter(Boolean).map(c => [String(c.id), c]));
    const matches = inCrm.map(c => ({ rec: c, nsId: str(c.nsInternalId) || nsIdOfCrmId(c.id), entityId: '', name: str(c.name), email: str(c.email), inApp: true }));
    const q = customerLookupSql({ name, email, brand });
    if (!q || !nsProxyFetch) return { matches, nsChecked: false, nsError: '' };
    try {
        const r = await nsProxyFetch({ targetUrl: `${SUITEQL}?limit=20`, method: 'POST', payload: { q } });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) return { matches, nsChecked: false, nsError: nsErrorOf(data, r.status) };
        (data.items || []).forEach(row => {
            const nsId = str(row.id);
            if (!nsId) return;
            const hit = matches.find(m => m.nsId === nsId);
            if (hit) { hit.entityId = str(row.entityid); return; }
            const rec = byId.get(`CUST-${nsId}`) || null;
            matches.push({ rec, nsId, entityId: str(row.entityid), name: str(row.companyname), email: str(row.email), inApp: !!rec });
        });
        return { matches, nsChecked: true, nsError: '' };
    } catch (e) {
        return { matches, nsChecked: false, nsError: e.message || String(e) };
    }
}


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

/**
 * The app-only record when NetSuite could not be reached — said on the record so the push refusal is understood.
 * Its id can NEVER be a NetSuite number (Stuart 2026-10-17, after the App Improvement session measured it: the old
 * CUST-<random 1000–9999> collided with 1,755 live NetSuite customer ids, and the push derives the entity from the
 * id — an app-only sale could have posted against a stranger). CUST-APP-<time> keeps the CUST- prefix the counter's
 * lists key on; nsHeader.nsCustomerIdOf reads it as NO entity, and the save refuses by name.
 */
export const APP_ONLY_CUSTOMER_PREFIX = 'CUST-APP-';
export const isAppOnlyCustomerId = (id) => str(id).toUpperCase().startsWith(APP_ONLY_CUSTOMER_PREFIX);
export const crmRecordAppOnlyOf = ({ name, email = '', phone = '', brand = 'uniquity', by = '', at = 0, reason = '' } = {}) => {
    const id = `${APP_ONLY_CUSTOMER_PREFIX}${at || Date.now()}`;
    return { ...crmRecordOf({ nsId: '', name, email, phone, brand, by, at }), id, nsInternalId: '', nsPending: true, nsPendingReason: str(reason).slice(0, 300) };
};

/** POST the customer; returns { ok, nsId, error, made }. `made` true = NetSuite HAS the customer (never create it again). */
export async function createNsCustomer({ nsProxyFetch, payload }) {
    const r = await nsProxyFetch({ targetUrl: 'https://3728153.suitetalk.api.netsuite.com/services/rest/record/v1/customer', method: 'POST', payload });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, nsId: '', error: nsErrorOf(data, r.status), made: false };
    let nsId = nsIdOfCreateAnswer(data, (r.headers && r.headers.get && r.headers.get('location')) || '');
    const q = nsId ? '' : customerByExternalIdSql(payload && payload.externalId);
    if (q) {
        try {
            const back = await nsProxyFetch({ targetUrl: `${SUITEQL}?limit=5`, method: 'POST', payload: { q } });
            const rows = ((await back.json().catch(() => ({}))).items) || [];
            if (back.ok && rows.length === 1) nsId = str(rows[0].id);
        } catch (e) { /* said below */ }
    }
    if (!nsId) return { ok: false, nsId: '', made: true, error: 'NetSuite made the customer but its id could not be read back. Do NOT create it again: sync customers on 11.1, then pick them from the list.' };
    return { ok: true, nsId, error: '', made: true };
}
