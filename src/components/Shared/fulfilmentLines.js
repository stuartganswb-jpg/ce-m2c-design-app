// THE LINES OF A NETSUITE ITEM FULFILLMENT — one location per line, read from the sales order.
//
// Every packed order's fulfillment failed in NetSuite with "Items list: Location" (S4 close-out 1):
// the WMS transformed the sales order with a header only, and on a multi-location account each
// fulfilled line must say where it ships from. Eric (2026-09): each SO line carries ONE location.
// So the location is COPIED from the order's own line — never a brand default, never a guess. A
// line that must ship and has no location refuses the whole fulfillment with the lines named.
//
// Pure. The caller reads the rows (soLinesSql) and hands them here; the result is the `item`
// sublist of the `!transform/itemFulfillment` payload, keyed by orderLine (= transactionline.id).

// Inventory-bearing line types — a fulfillment of one of these REQUIRES a location.
export const LOCATION_REQUIRED_TYPES = ['InvtPart', 'Assembly', 'Kit'];
// Line types a fulfillment carries at all (non-inventory ships when it has a location).
export const FULFILLABLE_TYPES = [...LOCATION_REQUIRED_TYPES, 'NonInvtPart'];

export const soLinesSql = (nsSoId) => {
  const id = String(nsSoId || '').trim();
  if (!/^\d+$/.test(id)) throw new Error(`Not a NetSuite sales order id: "${nsSoId}"`);
  return `SELECT tl.id AS line, BUILTIN.DF(tl.item) AS item, tl.itemtype AS itemtype, tl.location AS location, `
    + `BUILTIN.DF(tl.location) AS locationname, ABS(NVL(tl.quantity, 0)) AS qty, NVL(tl.quantityshiprecv, 0) AS shipped, `
    + `NVL(tl.isclosed, 'F') AS isclosed `
    + `FROM transactionline tl WHERE tl.transaction = ${id} AND tl.mainline = 'F' AND NVL(tl.taxline, 'F') = 'F' `
    + `ORDER BY tl.id`;
};

const truthyFlag = (v) => v === true || v === 'T' || v === 't';

// rows: SuiteQL items from soLinesSql. Returns
//   { ok: true,  items: [{ orderLine, location: { id }, itemReceive: true }], lines: [...] }
//   { ok: false, reason, missing: [{ line, item }] }
export function fulfilmentItemsOf(rows) {
  const all = Array.isArray(rows) ? rows : [];
  const open = all.filter((r) => {
    if (!FULFILLABLE_TYPES.includes(String(r.itemtype || ''))) return false;
    if (truthyFlag(r.isclosed)) return false;
    return Number(r.qty || 0) > Number(r.shipped || 0);
  });
  const missing = open
    .filter((r) => LOCATION_REQUIRED_TYPES.includes(String(r.itemtype)) && !String(r.location || '').trim())
    .map((r) => ({ line: String(r.line), item: r.item || '' }));
  if (missing.length) {
    return { ok: false, reason: 'LINE_WITHOUT_LOCATION', missing };
  }
  const shipping = open.filter((r) => String(r.location || '').trim());
  if (!shipping.length) {
    return { ok: false, reason: all.length ? 'NOTHING_OPEN_TO_FULFIL' : 'NO_LINES_READ', missing: [] };
  }
  return {
    ok: true,
    items: shipping.map((r) => ({ orderLine: Number(r.line), location: { id: String(r.location).trim() }, itemReceive: true })),
    lines: shipping.map((r) => ({ line: String(r.line), item: r.item || '', location: String(r.location).trim(), locationName: r.locationname || '' })),
  };
}

// The words a packer reads when the fulfillment cannot be queued.
export function refusalText(result) {
  if (!result || result.ok) return '';
  if (result.reason === 'LINE_WITHOUT_LOCATION') {
    return `These sales order lines have no location in NetSuite, so the fulfillment was NOT queued:\n`
      + result.missing.map((m) => `  • line ${m.line}${m.item ? ` — ${m.item}` : ''}`).join('\n')
      + `\n\nSet a location on each line of the sales order in NetSuite, then queue the fulfillment again.`;
  }
  if (result.reason === 'NOTHING_OPEN_TO_FULFIL') {
    return 'NetSuite shows nothing left to fulfil on this sales order (every shippable line is closed or already fulfilled), so no fulfillment was queued.';
  }
  return 'No lines came back from NetSuite for this sales order, so no fulfillment was queued.';
}
