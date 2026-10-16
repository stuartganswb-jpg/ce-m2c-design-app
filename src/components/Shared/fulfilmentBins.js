// ── WHICH BIN A FULFILMENT TAKES FROM — ASKED WHEN NETSUITE CANNOT KNOW (Stuart 2026-10-12) ─────────────────────────
// "when the item exists in more than one bin we get a hang up … we have to tell NS to take it from the bin we want it
//  taken from or it will error."  Six Fabricut fulfilments had failed with "Please configure the inventory detail in
// line N": the display pieces now sit in ORDERS-COM1 in NetSuite as well as on the shelf (SO60991 line 2 — H1-75R: 380
// in Production Stock, 50 in ORDERS-COM1), neither bin is preferred, and the app transformed the sales order with a
// location and no bin. A preferred bin would answer for NetSuite — and always answer the same, which is the thing to
// worry about forever. So the PACKER answers, once, at the moment the fulfilment is sent:
//   · an item in ONE bin — nothing changes: no bin is sent, NetSuite takes the only one, as it always has;
//   · an item in MORE THAN ONE — each bin and what it holds is shown, the packer picks (or splits the line across bins
//     when no single one covers it), and that choice rides the line as NetSuite's inventory detail, by BIN ID.
// Read live from NetSuite at that moment (InventoryBalance — the join the cycle count uses), Good stock only.
// Pure: the SQL, the choice list, the check on a pick, and the payload lines. scripts/fulfilmentBins.test.mjs.
const S = (v) => String(v == null ? '' : v).trim();
const N = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const r3 = (n) => Math.round(N(n) * 1000) / 1000;
// The account's sellable stock status. A row with no status (an account without the feature) counts too.
export const GOOD_STATUS_ID = '1';

/** Bin by bin, what NetSuite holds of these items. */
export const binsSql = (itemIds = []) => {
  const ids = [...new Set((itemIds || []).map(S).filter(id => /^\d+$/.test(id)))];
  if (!ids.length) return '';
  return `SELECT ib.item AS item, ib.location AS location, b.id AS binid, b.binnumber AS bin, ib.inventorystatus AS status, `
    + `SUM(ib.quantityonhand) AS onhand FROM InventoryBalance ib LEFT JOIN Bin b ON ib.binnumber = b.id `
    + `WHERE ib.item IN (${ids.join(',')}) GROUP BY ib.item, ib.location, b.id, b.binnumber, ib.inventorystatus `
    + `HAVING SUM(ib.quantityonhand) > 0`;
};

/** The NetSuite item ids of the lines a fulfilment is about to ship (rows from fulfilmentLines.soLinesSql). */
export const fulfilItemIdsOf = (items = [], soRows = []) => {
  const lines = new Set((items || []).map(i => S(i.orderLine)));
  return [...new Set((soRows || []).filter(r => lines.has(S(r.line))).map(r => S(r.itemid)).filter(Boolean))];
};

/**
 * WHAT TO ASK. One row per fulfilled line whose item sits in MORE THAN ONE bin at the line's location.
 * @param items     fulfilmentItemsOf(...).items — the lines being fulfilled
 * @param soRows    the sales order's lines (soLinesSql): line, itemid, item, location, qty, shipped
 * @param binRows   binsSql rows
 * @param preferBin the order's own bin (an order gathered into ORDERS-COM1) — pre-chosen when it covers the line
 * @returns Array<{ orderLine, itemId, item, qty, location, bins: [{ id, bin, onhand }], pick: [{ binId, qty }] }>
 */
export function binChoicesOf({ items = [], soRows = [], binRows = [], preferBin = '' } = {}) {
  const byLine = new Map((soRows || []).map(r => [S(r.line), r]));
  const want = S(preferBin).toUpperCase();
  return (items || []).map(it => {
    const row = byLine.get(S(it.orderLine));
    if (!row || !S(row.itemid)) return null;
    const location = S((it.location && it.location.id) || row.location);
    const qty = r3(N(row.qty) - N(row.shipped));
    const bins = (binRows || [])
      .filter(b => S(b.item) === S(row.itemid) && S(b.location) === location && S(b.binid) && (!S(b.status) || S(b.status) === GOOD_STATUS_ID) && N(b.onhand) > 0)
      .map(b => ({ id: S(b.binid), bin: S(b.bin), onhand: r3(b.onhand) }))
      .sort((a, b) => b.onhand - a.onhand || a.bin.localeCompare(b.bin));
    if (bins.length < 2 || !(qty > 0)) return null;
    const own = want ? bins.find(b => b.bin.toUpperCase() === want && b.onhand >= qty) : null;
    return { orderLine: Number(it.orderLine), itemId: S(row.itemid), item: S(row.item), qty, location, bins, pick: own ? [{ binId: own.id, qty }] : [] };
  }).filter(Boolean);
}

/** Why a pick cannot be sent — '' when it can: the bins are this line's, none is over-drawn, and they add up to the line. */
export function binPickRefusal(choice, pick = []) {
  if (!choice) return 'no line';
  const rows = (pick || []).filter(p => p && N(p.qty) > 0);
  if (!rows.length) return `choose the bin ${choice.item} was taken from`;
  for (const p of rows) {
    const bin = choice.bins.find(b => b.id === S(p.binId));
    if (!bin) return `${choice.item}: that bin does not hold it`;
    if (N(p.qty) > bin.onhand + 1e-6) return `${choice.item}: ${bin.bin} holds ${bin.onhand}, not ${r3(p.qty)}`;
  }
  const total = r3(rows.reduce((t, p) => t + N(p.qty), 0));
  if (Math.abs(total - choice.qty) > 1e-6) return `${choice.item}: the bins add up to ${total} — the line ships ${choice.qty}`;
  return '';
}

/**
 * The fulfilment's lines with each choice written on its line — NetSuite's inventory detail, bin by ID. A line that
 * was not asked about is sent exactly as it was.
 * @param picks  { [orderLine]: [{ binId, qty }] }
 */
export function fulfilmentItemsWithBins(items = [], choices = [], picks = {}) {
  const byLine = new Map((choices || []).map(c => [Number(c.orderLine), c]));
  return (items || []).map(it => {
    const c = byLine.get(Number(it.orderLine));
    const rows = c ? (picks[c.orderLine] || []).filter(p => p && N(p.qty) > 0) : [];
    if (!c || !rows.length) return it;
    return {
      ...it, quantity: c.qty,
      inventoryDetail: { quantity: c.qty, inventoryAssignment: { items: rows.map(p => ({ binNumber: { id: S(p.binId) }, quantity: r3(p.qty) })) } },
    };
  });
}

// ── THE PREFERRED BIN NETSUITE FILLS IN BY ITSELF (Stuart 2026-10-16, SO61091 — Eric's App Imp card) ──────────────────
// The first fulfilment the app ever sent naming a bin failed: "The total inventory detail quantity must be 1." HCUMB410
// has a PREFERRED bin in NetSuite (U S19-E5L-R1). Creating the fulfilment from the sales order, NetSuite fills the line's
// inventory detail with that bin itself — and the app's "1 from ORDER-001" was ADDED to it, not put in its place: two
// against a line of one. A fulfilment that names a bin therefore asks NetSuite to REPLACE its own item lines with the
// app's (the REST `replace` option): the lines are exactly the ones the app sends, each with only the bin it chose. A
// fulfilment that names no bin is sent exactly as before — NetSuite still picks the only bin, or the preferred one.
/** Does this fulfilment carry a bin on any line? */
export const namesBins = (items = []) => (items || []).some(it => !!(it && it.inventoryDetail));
/** Where the fulfilment is sent — with `replace=item` only when it names a bin. */
export const fulfilmentTargetOf = (nsSoId, items = []) => {
  const id = S(nsSoId);
  if (!/^\d+$/.test(id)) throw new Error(`Not a NetSuite sales order id: "${nsSoId}"`);
  return `https://3728153.suitetalk.api.netsuite.com/services/rest/record/v1/salesOrder/${id}/!transform/itemFulfillment${namesBins(items) ? '?replace=item' : ''}`;
};

/** "H1-75R × 12 from Production Stock" — for the log and the record on the document. */
export const binPickText = (choices = [], picks = {}) => (choices || []).map(c => {
  const rows = (picks[c.orderLine] || []).filter(p => p && N(p.qty) > 0);
  return rows.length ? `${c.item} × ${c.qty} from ${rows.map(p => { const b = c.bins.find(x => x.id === S(p.binId)); return `${b ? b.bin : p.binId}${rows.length > 1 ? ` (${r3(p.qty)})` : ''}`; }).join(' + ')}` : '';
}).filter(Boolean).join(' · ');
