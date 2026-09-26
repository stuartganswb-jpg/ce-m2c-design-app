// ── ONE ITEM, READ LIVE FROM NETSUITE (Stuart 2026-09-26) ────────────────────────────────────
// "it would be better if this process can work without having to sync items into and out of the
//  app and just keep them in netsuite, how jfp works."
//
// A rod cut moves real NetSuite stock, so it needs three things about each stick: the item's
// internal id, that it is an inventory item, and that it is categorised POLE or ROD. All three
// live on the NetSuite item — the id, the item type, and the Product Type droplist the sync has
// always read (custitem_bit_product_type). Read here by name, ACTIVE items only, so a stick the
// library never synced cuts exactly like one it did. The library, when it knows the item, is
// consulted first (it is faster and already in memory); it is never required.
// Pure: builds the query and shapes the row. scripts/nsItemLookup.test.mjs asserts it.

const esc = (v) => String(v == null ? '' : v).trim().toUpperCase().replace(/'/g, "''");

/** id + type + product type, active items only, one row. Oldest id first — the original item. */
export const activeItemByNameQuery = (code) =>
    `SELECT item.id AS id, item.itemtype AS itemtype, BUILTIN.DF(item.custitem_bit_product_type) AS product_type ` +
    `FROM item WHERE UPPER(item.itemid) = '${esc(code)}' AND NVL(item.isinactive, 'F') = 'F' ORDER BY item.id`;

/** The same without the product-type column — for an account where that field is not queryable. */
export const activeItemByNameQueryLite = (code) =>
    `SELECT item.id AS id, item.itemtype AS itemtype FROM item WHERE UPPER(item.itemid) = '${esc(code)}' AND NVL(item.isinactive, 'F') = 'F' ORDER BY item.id`;

/** The shape both cut benches plan with: { code, internalId, type, productType, live }. */
export const cutRecordOf = (row, code) => {
    if (!row || row.id == null || String(row.id) === '') return null;
    return {
        code: String(code || '').trim().toUpperCase(),
        internalId: String(row.id),
        type: String(row.itemtype || ''),
        productType: String(row.product_type || ''),
        live: true,
    };
};

/** A NetSuite item type that can hold stock — a service, fee or description item cannot be cut. */
export const isStockItemType = (type) => /invt|inventory|assembly/i.test(String(type || ''));
