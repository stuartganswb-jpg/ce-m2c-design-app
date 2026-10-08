// ─────────────────────────────────────────────────────────────────────────────────────────────
// THE BLIND PACKING LIST — a drop shipment goes out in the CUSTOMER'S name (Stuart 2026-10-08)
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// "whenever a custom drop to shipping address is selected, we need to make sure the packing list becomes
//  'Blind' — it removes our logo, replaces with our customer's, shows as if it is shipping from our customer
//  to the final ship to." · the from address: their default saved address — "ok" · their item numbers where we
//  have them — "yes" · "we can have an override flag available on crm if we want to print standard packing list"
//  · "add the flag option to print standard or blind on crm" (same day — the choice goes BOTH ways, on any order).
//
// THE RULE, ONCE, FOR EVERY DOOR AND EVERY PRINTER. An order ships blind when its ship-to is a CUSTOM drop
// address — the header keys Shared/salesOrderHeader writes the same way from CPQ's checkout, the CRM's header
// edit, Order Entry (tab 7) and the per-display shipment in the WMS:
//
//      shippingMethod === 'CUSTOM'  and  customShippingAddress.addr1          (salesOrderHeader.shipToLinesOf's own test)
//
// unless the order itself says which list to print — the CRM's choice, on any order's packing list, kept on the
// job AND the sales order so the pack station and RTG print what the CRM shows:
//
//      packingListBlind === true        always blind      (a saved address that is really the end client's)
//      packingListStandard === true     always standard   (a custom address that is the customer's own showroom)
//      neither                          by the address    (the rule above)
//
// A CPQ order's header lives on its `jobs` document and is copied to `hq_sales_orders`; an Order Entry order has
// only the sales order. A screen holds one or both, so every question here takes whichever documents the screen
// has. CUSTOM on ANY of them is a drop shipment: the two can only disagree while a copy is stale, and a list that
// is blind when it need not be costs nothing — one that names us to our customer's customer cannot be taken back.
//
// WHAT THE PAPER SHOWS is FormPreview's (data.blind): the customer's logo (or their name in type), "Ship From"
// with their name and default saved address in place of "Bill To", their item numbers where the line has one,
// and none of our name, address, site, phone, terms or form wording. Quantities, PO, sidemark, ship date,
// tracking and the order number with its barcode are unchanged.
//
// Print only: nothing here writes, and no order, work order, floor, pick or NetSuite record reads it.
// Pure. Harness: scripts/blindShip.test.mjs.

const str = (v) => String(v == null ? '' : v).trim();
const up = (v) => str(v).toUpperCase();
const docsOf = (docs) => (docs || []).filter(d => d && typeof d === 'object');

/** A custom drop-ship address on any of the order's documents (the job, the sales order). */
export const isCustomDrop = (...docs) => docsOf(docs).some(d =>
    up(d.shippingMethod) === 'CUSTOM' && !!d.customShippingAddress && !!str(d.customShippingAddress.addr1));

/** The order was told to print the standard packing list (the CRM's choice). */
export const wantsStandardList = (...docs) => docsOf(docs).some(d => d.packingListStandard === true);

/** The order was told to print the blind packing list, whatever its address (the CRM's choice). */
export const wantsBlindList = (...docs) => docsOf(docs).some(d => d.packingListBlind === true);

/**
 * What the order was told: 'BLIND' | 'STANDARD' | 'AUTO' (nothing chosen — the address decides).
 * The CRM writes both flags on every document together, so they can only disagree while a copy is stale; then
 * BLIND wins, for the reason given above.
 */
export const PACKING_MODES = Object.freeze(['AUTO', 'BLIND', 'STANDARD']);
export const packingModeOf = (...docs) => (wantsBlindList(...docs) ? 'BLIND' : (wantsStandardList(...docs) ? 'STANDARD' : 'AUTO'));

/** Does this order's packing list print blind? */
export const isBlindShipment = (...docs) => {
    const mode = packingModeOf(...docs);
    return mode === 'BLIND' || (mode === 'AUTO' && isCustomDrop(...docs));
};

/** The fields the CRM's choice writes — the same on the job and on the sales order. An unknown mode is AUTO. */
export const packingListPatch = (mode, by = '', now = Date.now()) => ({
    packingListBlind: up(mode) === 'BLIND', packingListStandard: up(mode) === 'STANDARD',
    packingListSetAt: now, packingListSetBy: str(by),
});

// The customer's own address: their default saved (NetSuite) address, else the first one. Street and town only —
// the attention / addressee of a receiving dock is not who the goods are FROM.
const fromAddressOf = (customer) => {
    const list = (customer && Array.isArray(customer.shippingAddresses)) ? customer.shippingAddresses.filter(Boolean) : [];
    const a = list.find(x => x.isDefault) || list[0] || null;
    if (!a || !str(a.addr1)) return [];
    const town = [[str(a.city), up(a.state)].filter(Boolean).join(', '), str(a.zip)].filter(Boolean).join(' ');
    return [str(a.addr1), str(a.addr2), town].filter(Boolean);
};

/**
 * Who the list is from: the customer.
 * @param customer  the CRM record ({ name, portalLogoUrl, shippingAddresses[] }) — may be null (not read, not found)
 * @param name      the customer's name as the order carries it, for when the record is not to hand
 * @returns { name, logoUrl, from: [lines] }   — from always starts with the name; never our own details
 */
export function blindPartyOf(customer, name = '') {
    const who = str(customer && customer.name) || str(name) || '';
    return {
        name: who,
        logoUrl: str(customer && customer.portalLogoUrl),
        from: [who, ...fromAddressOf(customer)].filter(Boolean),
    };
}

/**
 * The form data for a packing list that prints blind — or the data untouched when it does not.
 * @param data      FormPreview's data for the PACKING_SLIP ({ billTo, shipTo, packing: { lines … } … })
 * @param docs      the order's documents the screen holds (job, sales order) — see isBlindShipment
 * @param customer  the CRM record, or null
 * @param name      the customer's name on the order
 */
export function withBlindPacking(data, { docs = [], customer = null, name = '' } = {}) {
    if (!data || !isBlindShipment(...docs)) return data;
    return { ...data, blind: blindPartyOf(customer, name) };
}

/** The item number a blind list prints for a packing line: theirs when the line has one, else ours. */
export const blindItemNoOf = (line) => str(line && line.custCode) || str(line && line.code);
