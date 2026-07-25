// PER-CUSTOMER PRICING — the ONE place a `clientPricing` row is matched to a customer.
//
// Why shared: CPQ and Quick Ship each grew their own matcher and they disagreed. CPQ resolved the
// customer through the CRM record and compared case/whitespace-insensitively; Quick Ship did a
// strict `row.customerId === customerId`. Rows are hand-entered (BOM Engine part editor, the kit
// $ editor, the Fabricut bulk import) so `customerId` sometimes holds the CRM doc id and sometimes
// the typed customer NAME — which meant the SAME customer could price differently depending on
// which tab the operator was standing in. Both surfaces now call these helpers.
//
// Rule (CPQ's, long-standing): a row only counts when its price parses to a real number > 0.
// Blank / 0 means "no special price" → the caller falls back to base price.

// Every identity a clientPricing row might have been keyed by, normalized for comparison.
export const customerKeys = (customerId, custRec) => new Set(
    [customerId, custRec?.name, custRec?.companyName]
        .filter(Boolean)
        .map(s => String(s).trim().toUpperCase())
);

const norm = (v) => String(v || '').trim().toUpperCase();

// The matching row (or null). Use when you need the row itself — e.g. a "this customer has custom
// pricing" badge — rather than the price.
export const findClientPriceRow = (rows, keys) => {
    if (!Array.isArray(rows) || !keys || !keys.size) return null;
    return rows.find(r => keys.has(norm(r?.customerId))) || null;
};

// The customer's price, or null when there is no usable row.
export const clientPriceFor = (rows, keys) => {
    const row = findClientPriceRow(rows, keys);
    const v = row ? parseFloat(row.price) : NaN;
    return Number.isFinite(v) && v > 0 ? v : null;
};
