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
