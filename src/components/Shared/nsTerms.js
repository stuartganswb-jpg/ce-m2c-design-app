// ── A PAYMENT TERM BY ITS NAME (Eric's App Imp card 2026-10-16 · Stuart 2026-10-17 "go ahead and continue on") ─────────
// The 11.1 customer import stores NetSuite's term as its internal id ("3"), and the documents printed it: "TERMS 3" on a
// Net 60 invoice. These are NetSuite's names for its ids, read from NetSuite on 2026-10-17. A name typed by hand
// ("Net 30") prints as it is; an id not listed here prints as "Term <id>" — never a bare number. Pure.
// (Which terms must be paid before shipping is Shared/shipClearance's rule; this is only the words.)
export const NS_TERM_NAMES = Object.freeze({
    1: 'Net 15', 2: 'Net 30', 3: 'Net 60', 6: '2% 10 Net 30', 12: 'Net 45', 13: 'Credit Card', 14: 'Net 120',
    15: 'Net 30 Pay by CC', 16: 'Net 90', 17: 'Prepayment', 18: 'Proforma Invoice', 19: 'No Terms', 20: 'Due upon Receipt',
    21: 'Net 60+60', 22: 'Pay Before Shipping', 23: '1% 10 Net 30', 24: '30% Deposit, 70% To Ship', 25: 'Net 10',
    26: '50% Deposit, Balance to Ship', 27: '.5% 10 Net 30',
});

export const termNameOf = (term) => {
    const t = String(term == null ? '' : term).trim();
    if (!t) return '';
    if (/^\d+$/.test(t)) return NS_TERM_NAMES[t] || `Term ${t}`;
    return t;
};

// ── WHEN A TERM FALLS DUE (Stuart 2026-10-20: "we need to show due date based on the terms code" · "60+60 is due in
// 120days") — days from the invoice (the ship date) to due, as NetSuite's own invoices carry them: read 2026-10-20 from
// this year's invoices (duedate − trandate, every term that had one: 15/30/60/30/45/0/120/30/0/0/0/0/30); the terms with
// no invoice yet follow their names. 0 = due on receipt.
export const NS_TERM_DAYS = Object.freeze({
    1: 15, 2: 30, 3: 60, 6: 30, 12: 45, 13: 0, 14: 120, 15: 30, 16: 90, 17: 0, 18: 0, 19: 0, 20: 0,
    21: 120, 22: 0, 23: 30, 24: 0, 25: 10, 26: 0, 27: 30,
});
/** Days to due for a term id, or a name we know ("Net 30" → its id's days); null when the term is not known. */
export const termDaysOf = (term) => {
    const t = String(term == null ? '' : term).trim();
    if (!t) return null;
    if (/^\d+$/.test(t)) return Object.prototype.hasOwnProperty.call(NS_TERM_DAYS, t) ? NS_TERM_DAYS[t] : null;
    const id = Object.keys(NS_TERM_NAMES).find(k => NS_TERM_NAMES[k].toUpperCase() === t.toUpperCase());
    return id ? NS_TERM_DAYS[id] : null;
};
