// ⛔ WHAT NETSUITE REFUSED, ON THE RECORD ITSELF (Stuart 2026-10-20: "we do not need to stop the floor immediately so things
// can keep moving when it is only a netsuite acceptance issue"). When NetSuite refuses a queued write, the queue marks every
// record that write was for — `nsRefused.<kind>` = { at, outboxId, kind, label, error } — and drops the mark the moment that
// kind posts for it (functions/nsFix.js). This reads it. The floor uses it to keep moving: an Order Entry or CPQ sales order
// NetSuite refused is picked, packed and made as usual (RTG starts it, the WMS lists it), and held at shipping
// (Shared/shipClearance NO_SO_RULE) until NetSuite accepts it. Both doors write their sales order to the same record
// (hq_sales_orders — QS-… and SO-APP-…), so both are read the same way. Pure.

/** The field-safe kind (the twin of functions/nsFix.refusedKeyOf). */
export const refusedKeyOf = (kind) => String(kind == null || kind === '' ? 'write' : kind).replace(/[^A-Za-z0-9_]/g, '_');

/** The refusal mark for one kind of write on a record, or null. */
export const refusalOf = (d, kind) => (d && d.nsRefused && typeof d.nsRefused === 'object' && d.nsRefused[refusedKeyOf(kind)]) || null;

/** A sales order NetSuite refused and has not accepted since (an accepted order carries its NetSuite id). */
export const soRefusalOf = (so) => (so && !so.nsInternalId ? refusalOf(so, 'salesorder') : null);

export const SO_REFUSED_WORDS = 'NetSuite has not accepted this order — it is picked, packed and made as usual, and ships once NetSuite accepts it';
