// ── ONE NETSUITE TRANSACTION HEADER, BOTH DOORS (E3 / STATE #22; Stuart 2026-09-12: option 1) ──
//
// Two inline copies wrote the header (CPQ's nsTransmit and tab 7's push), both hard-coding the
// Classical Elements form + class and sending NOTHING for the other brands — so an M2C, Uniquity
// or Leyla quote landed on whatever default form the account applies. Now: one builder, the
// per-brand ids in Shared/brandNetsuite.BRAND_NETSUITE_FORMS, and a brand with no ids on file
// REFUSES TO QUEUE with a named error (the cc85d66 rule: never a silent default) until Eric's
// ids are entered there. Pure — no Firestore, no proxy: the ship-method id is resolved by the
// caller (nsTransmit.resolveShipMethod, one cache) and passed in.
import { BRAND_NETSUITE_MAP, BRAND_NETSUITE_FORMS } from './brandNetsuite.js';

const str = (v) => String(v == null ? '' : v).trim();

/** The NetSuite customer id off the app's CUST-<id> convention. '' when there is none. */
export const nsCustomerIdOf = (id) => { const s = str(id); return s.startsWith('CUST-') ? s.slice(5) : s; };

/**
 * Build the header block of an estimate / salesorder body.
 *   brand         'ce' | 'm2c' | 'uniquity' | 'leyla'
 *   asType        'estimate' | 'salesorder'
 *   customerId    the app customer id (CUST-123) or the NetSuite id
 *   memo          the mainline memo (each door keeps its own fallback chain and its own cut)
 *   poNumber / internalMemo / appJobId   optional
 *   shipping      { method: 'SAVED'|'CUSTOM', addressId, custom: {attention, addressee, addr1, addr2, city, state, zip, country},
 *                   amount, shipMethod: { id, name } | null }   — shipMethod resolved by the caller
 * Returns { ok: true, header, warnings[] } or { ok: false, error: { code, message } }.
 */
export function nsTransactionHeader({ brand, asType = 'estimate', customerId, memo = '', poNumber = '', internalMemo = '', appJobId = '', shipping = null } = {}) {
    const b = str(brand).toLowerCase();
    const type = asType === 'salesorder' ? 'salesorder' : 'estimate';
    const nsCustomerId = nsCustomerIdOf(customerId);
    if (!nsCustomerId) return { ok: false, error: { code: 'NO_CUSTOMER', message: 'This order has no NetSuite customer id — pick the customer first.' } };
    const map = BRAND_NETSUITE_MAP[b];
    if (!map) return { ok: false, error: { code: 'NO_NS_SUBSIDIARY_FOR_BRAND', message: `No NetSuite subsidiary / location on file for brand "${b || '(none)'}" — add it to Shared/brandNetsuite.` } };
    const forms = BRAND_NETSUITE_FORMS[b];
    if (!forms || !forms[type] || !forms.class) {
        return { ok: false, error: { code: 'NO_NS_FORM_FOR_BRAND', message: `No NetSuite ${type === 'salesorder' ? 'sales order' : 'quote'} form and class on file for brand "${b}" — nothing was queued (a default form would be wrong). Eric supplies the per-brand form + class ids; they go in Shared/brandNetsuite.BRAND_NETSUITE_FORMS.` } };
    }
    const warnings = [];
    const header = {
        entity: { id: nsCustomerId },
        subsidiary: { id: map.subsidiary },
        location: { id: map.location },
        customForm: { id: String(forms[type]) },
        class: { id: String(forms.class) },
        memo: str(memo),   // each door cuts its own memo (tab 7 to 40; CPQ sends the sidemark / job name whole, as it always has)
        ...(str(poNumber) ? { otherRefNum: str(poNumber).slice(0, 40) } : {}),
        ...(str(internalMemo) ? { custbody_bit_internalmemo: str(internalMemo).slice(0, 999) } : {}),
        ...(str(appJobId) ? { custbody50: str(appJobId) } : {}),
    };
    const s = shipping || {};
    const custom = s.custom || {};
    if (str(s.method).toUpperCase() === 'SAVED' && str(s.addressId)) {
        header.shipaddresslist = { id: str(s.addressId) };
    } else if (str(s.method).toUpperCase() === 'CUSTOM' && str(custom.addr1)) {
        header.shippingaddress = {
            attention: str(custom.attention), addressee: str(custom.addressee),
            addr1: str(custom.addr1), addr2: str(custom.addr2), city: str(custom.city),
            state: str(custom.state).toUpperCase().replace(/\./g, ''), zip: str(custom.zip),
            country: { id: str(custom.country) || 'US' },
        };
    }
    const amount = parseFloat(s.amount) || 0;
    if (amount > 0) {
        if (s.shipMethod && s.shipMethod.id) {
            header.shippingcost = parseFloat(amount.toFixed(2));
            header.shipMethod = { id: String(s.shipMethod.id) };
        } else {
            warnings.push(`No active Ship Item in NetSuite — pushing WITHOUT the $${amount.toFixed(2)} shipping charge; add it on the transaction manually.`);
        }
    }
    return { ok: true, header, warnings };
}
