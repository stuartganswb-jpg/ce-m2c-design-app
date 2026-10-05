// ── RETIRING AN ITEM NETSUITE HAS NEVER HEARD OF (Stuart 2026-10-05: "can you retire the 9" · "go with retired") ──────
// Nine app-made records — the 1-3/8" traverse arm-and-plate holders — had to leave every picker once their numbers and
// prices moved onto the arms. Retirement has always come FROM NetSuite: the OLD checkbox (custitem28 →
// manufacturingSpecs.isRetired, written by the 11.1 item sync) or the locked list of internal ids (system/retired_items,
// Shared/retiredItems). A record made in the app has no NetSuite item, so it has neither, and there was no switch to throw.
//
// The flag every browse and pick screen already hides by is that same one — manufacturingSpecs.isRetired (the Master
// Library, Stock View, 4.6, the order-entry pools, the checkout search). So an APP-ONLY item is retired by setting it, in
// the Master Library, and brought back by clearing it there (the Library's "Retired" view lists them). A NetSuite-linked
// item is never offered the tick: NetSuite owns its flag and the next sync would write it straight back.
//
// Nothing is deleted and nothing else on the record changes. Pure — scripts/appRetire.test.mjs.

/** No NetSuite item behind this record — it exists only in the app. */
export const isAppOnlyItem = (part) => !!part && !String(part.netSuiteInternalId == null ? '' : part.netSuiteInternalId).trim();

/** May this record be retired (or brought back) from the Master Library? Saved app-only records only. */
export const canRetireInApp = (part) => isAppOnlyItem(part) && part.isNew !== true;

/** Retired here, in the app — what the Library's "Retired" view lists. */
export const isAppRetired = (part) => isAppOnlyItem(part) && !!part.manufacturingSpecs && part.manufacturingSpecs.isRetired === true;
