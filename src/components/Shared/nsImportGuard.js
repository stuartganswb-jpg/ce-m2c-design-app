// 🔒 NETSUITE NEVER OVERWRITES THE SALES SIDE (Stuart 2026-09-30: "set 11.1 so that the import from Netsuite can no
// longer touch any fields that will affect Fees, CPQ, Sales order Entry — these need to be blocked from and overwrite
// and prepare a warning so they can be set on 4.5 no more steps backwards" · "lock 12.5 … that work should only be
// done at 11.1 · the three netsuite flags you can leave open on 11.1").
//
// The app curates what sells: the price a quote starts from, the unit a line is counted in, the category and the
// routing a door reads, the collections a checkout scopes by. A NetSuite import that re-wrote them on an item the
// app already had undid that curation silently — 12.5's stock pull did it on every press, with no switch at all.
// Now, on an EXISTING item:
//   • an APP-OWNED field keeps the app's value; the import only FILLS it when the app has none;
//   • where NetSuite holds a real value for it that differs (base price custitem9, the stock unit, the product
//     type), the difference is RECORDED — never written — and 4.5 lists it for a person to take or keep;
//   • part handling and outsource action are the sync's own guesses from the item code, not NetSuite values, so
//     they are kept without a report;
//   • everything NetSuite owns (ids, cost, weight, bins, vendors, BOM revision, the mirror fields) and the three
//     flags (stocked · in-house/sourcing · old) still come in as they always have.
// A first import has nothing to protect and takes everything. Pure.

export const APP_OWNED_SPECS = Object.freeze(['basePrice', 'uom', 'partHandling', 'outsourceAction']);
// Of those (and the category, which 11.1 has kept app-first since August), the ones NetSuite truly holds — so a
// difference is news somebody should see in 4.5.
export const NS_REPORTED_FIELDS = Object.freeze({
    basePrice: 'Base price (custitem9)',
    uom: 'Unit (NetSuite stock unit)',
    productType: 'Category (product type)',
});

const blankFor = (field, v) => {
    if (v === undefined || v === null) return true;
    const s = String(v).trim();
    if (!s) return true;
    if (field === 'productType' && s.toUpperCase() === 'UNCATEGORIZED') return true;
    return false;
};
/** Do two values say the same thing? Prices compare as money, words ignore case and spacing. */
export function sameValue(field, a, b) {
    if (field === 'basePrice') {
        const x = Number(a), y = Number(b);
        return Number.isFinite(x) && Number.isFinite(y) ? Math.abs(x - y) < 0.005 : String(a ?? '') === String(b ?? '');
    }
    const n = (v) => String(v ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
    return n(a) === n(b);
}

/**
 * Guard one EXISTING item's incoming specs. → { specs, differences }
 * `specs` is what the import may write (merge it over the existing specs as before): app-owned fields are dropped
 * unless the app has no value. `differences` = [{ field, label, app, ns }] for the reported fields.
 * `nsProductType` is NetSuite's category (the caller keeps its own app-first rule for writing it).
 */
export function guardImportSpecs(existingSpecs, incomingSpecs, { nsProductType } = {}) {
    const ex = existingSpecs || {}, inc = incomingSpecs || {};
    const specs = { ...inc };
    APP_OWNED_SPECS.forEach(k => { if (k in specs && !blankFor(k, ex[k])) delete specs[k]; });
    const differences = [];
    const report = (field, app, ns) => {
        if (blankFor(field, app) || blankFor(field, ns) || sameValue(field, app, ns)) return;
        differences.push({ field, label: NS_REPORTED_FIELDS[field], app, ns });
    };
    report('basePrice', ex.basePrice, inc.basePrice);
    report('uom', ex.uom, inc.uom);
    report('productType', ex.productType, nsProductType !== undefined ? nsProductType : inc.productType);
    return { specs, differences };
}

/**
 * The record 4.5 reads for one item — or null when there is nothing to show. A difference somebody chose to KEEP
 * (dismissed at that NetSuite value) is not raised again until NetSuite's value changes.
 * → { docId, code, name, fields: { [field]: { label, app, ns, seenAt } }, dismissed, updatedAt, source } | null
 */
export function diffRecordOf({ docId, code = '', name = '', differences = [], prior = null, now = Date.now(), source = '11.1 item sync' }) {
    const dismissed = (prior && prior.dismissed && typeof prior.dismissed === 'object') ? prior.dismissed : {};
    const fields = {};
    (differences || []).forEach(d => {
        if (Object.prototype.hasOwnProperty.call(dismissed, d.field) && sameValue(d.field, dismissed[d.field], d.ns)) return;
        const was = prior && prior.fields && prior.fields[d.field];
        fields[d.field] = { label: d.label, app: d.app, ns: d.ns, seenAt: was && sameValue(d.field, was.ns, d.ns) ? (was.seenAt || now) : now };
    });
    if (!Object.keys(fields).length && !Object.keys(dismissed).length) return null;
    return { docId, code, name, fields, dismissed, updatedAt: now, source };
}

/** The Master Library write for "use NetSuite's" on one field, in the shape 4.5 writes it. */
export function takeNetSuitePatch(field, nsValue) {
    if (field === 'basePrice') { const n = Number(nsValue); return { 'manufacturingSpecs.basePrice': Number.isFinite(n) ? n : nsValue }; }
    if (field === 'productType') return { productType: nsValue, 'manufacturingSpecs.productType': nsValue };
    return { [`manufacturingSpecs.${field}`]: nsValue };
}
