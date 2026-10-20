// ONE PRICE FOR EVERY QUICK SHIP DOOR (Stuart 2026-08-22: "one pricing engine for whole site, portal, etc." · 2026-10-20: "add and align").
// Tab 7's pricing context and rate (HQ/QuickShipTab.js), moved word for word so the customer portal's Quick Ship quotes what Order Entry
// bills: the SAME resolver CPQ asks (Shared/hardwarePricing.priceChoice) — authored override → the customer's price level → their
// negotiated row → base price → the flow default; a part to be finished is priced in its finish (12ded331, 2026-10-19). Until today the
// portal's server priced "their row, else base price" — 1,092 of 2,807 stocked items read differently for Fabricut on the 10-13 snapshot.
//
// NOT here: the customer's NetSuite price-level ORDER discount. Tab 7 reads it live from NetSuite at entry and applies it only where
// Shared/nsPriceLevel.nsLevelAppliesAt says (never for a 4.6 customer); the portal cannot read NetSuite and applies none. Pure.
import { priceChoice } from './hardwarePricing.js';
import { customerPriceLevel } from './priceLevels.js';

/** The price context for one customer — the same object tab 7 hands the resolver. `outsourceCodes` are the outsourced finish records. */
export function quickShipPriceCtxOf({ customerId = '', customer = null, outsourceCodes = [], findByCode = () => null } = {}) {
    const lvl = customerPriceLevel(customer, 'STANDARD');
    return {
        customerId, customer: customer || null,
        priceLevel: lvl.level, levelIsDefault: lvl.isDefault,
        outsourceCodes,
        // Tier inheritance needs the BASE doc for a /EP variant that carries no box of its own.
        findByCode,
    };
}
/** What the resolver says of an item (price, source, alias …) — in the line's finish when one is given. */
export const quickShipPriceOf = (ctx, it, finishCode = '') => (it ? priceChoice({ partId: it.id }, it, finishCode ? { ...ctx, finishCode } : ctx) : null);
/** …and its rate, 0 where it has none. */
export const quickShipRateOf = (ctx, it, finishCode = '') => (it ? (quickShipPriceOf(ctx, it, finishCode).price || 0) : 0);
