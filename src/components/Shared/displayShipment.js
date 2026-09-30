// ── ONE DISPLAY, ONE SHOWROOM (Stuart 2026-09-30) ──────────────────────────────────────────────────────────────────────
// "what we typically do on these orders is invoice the bulk SO60551 and bill it 100% to the customer in this case
//  fabricut, then we fulfill one at a time (1/50 logic works) at $0.00 on new sales orders to the showrooms with custom
//  shipping addresses." — "fabricut with custom ship to" · "one per shipment" · "once all 50 are shipped there should be 0
//  of anything on hand in the orders-com1 bin".
//
// A display shipment is its OWN small order on the app's one sales-order route (hq_sales_orders, Quick Ship class): the
// customer of the display order, a custom ship-to, and 1/boards of every piece line — each as the NetSuite item the order's
// bin holds it as (Shared/orderBinPick.displayShareOf) — at $0. It is born PACKED (the box was confirmed at the SO Pack), so
// NetSuite creates the sales order, the WMS fulfils it FROM THE ORDER'S BIN, and the Fulfilment tab ships it. The display
// order gives up those pieces: its bin count (committedQty) and its NetSuite bin record (nsBinQty) drop by one display.
// Pure. scripts/displayShipment.test.mjs.
import { nsTransactionHeader, withLineLocations } from './nsHeader.js';

const S = (v) => String(v == null ? '' : v).trim();
const U = (v) => S(v).toUpperCase();
const N = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const r3 = (v) => Math.round(N(v) * 1000) / 1000;

/** What a ship-to still needs before a label can be made — '' when it is complete. */
export const shipToError = (a) => {
    const need = [['addressee', 'the showroom name'], ['addr1', 'the street'], ['city', 'the city'], ['state', 'the state'], ['zip', 'the zip']]
        .filter(([k]) => !S(a && a[k])).map(([, w]) => w);
    return need.length ? `add ${need.join(', ')}` : '';
};
/** The ship-to as the lines a label and the order show. */
export const shipToLines = (a) => [S(a && a.addressee), S(a && a.attention) ? `Attn: ${S(a.attention)}` : '', S(a && a.addr1), S(a && a.addr2), `${S(a && a.city)}, ${U(a && a.state)} ${S(a && a.zip)}`.trim(), S(a && a.phone)].filter(Boolean);

/**
 * The display shipment: its order record, its NetSuite sales order body, and what the display order gives up.
 * @param parent      the display order (hq_sales_orders doc: id, soId, customer, customerId, brand)
 * @param n / boards  this display's number, and how many the order is
 * @param share       Shared/orderBinPick.displayShareOf(...).lines
 * @param shipTo      { addressee, attention, addr1, addr2, city, state, zip, country, phone }
 * @param findByCode  NetSuite item code → library record (its netSuiteInternalId)
 * @returns { ok, why, id, doc, payload, give: { committed: {code: pieces}, nsBin: {code: qty} }, row }
 */
export const displayShipmentOf = ({ parent = {}, n, boards, share = [], shipTo = {}, brand = 'ce', by = '', now = Date.now(), findByCode = () => null, boxes = {}, photos = [] } = {}) => {
    const soRef = S(parent.soId || parent.id);
    const num = Math.floor(N(n)), of = Math.floor(N(boards));
    if (!(num > 0 && of > 0 && num <= of)) return { ok: false, why: `display ${num} of ${of} is not a display of this order` };
    const addrErr = shipToError(shipTo);
    if (addrErr) return { ok: false, why: `the ship-to is not complete — ${addrErr}` };
    if (!share.length) return { ok: false, why: 'the display has no pieces' };
    // The showroom's sales order carries each NetSuite item once — two lines of one item (the two cover plates) add up.
    const byNs = new Map();
    share.forEach(l => { const c = U(l.nsCode); byNs.set(c, r3((byNs.get(c) || 0) + N(l.nsQty))); });
    const noId = [...byNs.keys()].filter(c => !(findByCode(c) || {}).netSuiteInternalId);
    if (noId.length) return { ok: false, why: `no NetSuite id for ${noId.join(', ')} — sync the item first` };
    const head = nsTransactionHeader({
        brand, asType: 'salesorder', customerId: parent.customerId,
        memo: `Display ${num} of ${of} ${soRef}`.slice(0, 40), poNumber: soRef,
        internalMemo: `Display ${num} of ${of} of ${soRef} (${S(parent.customer)}) — shipped to ${S(shipTo.addressee)} at $0; ${soRef} is invoiced in full. [app ${S(by)}]`,
        shipping: { method: 'CUSTOM', custom: { ...shipTo, country: S(shipTo.country) || 'US' } },
    });
    if (!head.ok) return { ok: false, why: head.error.message };
    const payload = withLineLocations({
        ...head.header,
        item: { items: [...byNs.entries()].map(([c, q]) => ({ item: { id: String(findByCode(c).netSuiteInternalId) }, quantity: q, rate: 0, price: { id: '-1' }, description: `Display ${num}/${of} — ${soRef}` })) },
    }, 'salesorder');
    const id = `QS-DSP-${soRef}-${String(num).padStart(3, '0')}`;
    const give = { committed: {}, nsBin: {} };
    share.forEach(l => {
        give.committed[U(l.code)] = r3((give.committed[U(l.code)] || 0) + N(l.pieces));
        give.nsBin[U(l.nsCode)] = r3((give.nsBin[U(l.nsCode)] || 0) + N(l.nsQty));
    });
    const doc = {
        id, brand, orderClass: 'QUICKSHIP', source: 'DISPLAY_SHIP', status: 'NS_QUEUED',
        customer: S(parent.customer), customerId: S(parent.customerId),
        displayOf: S(parent.id), displayOfSoId: soRef, displayNo: num, displayBoards: of,
        jobName: `Display ${num} of ${of} — ${soRef}`,
        lines: [...byNs.entries()].map(([c, q]) => ({ erp: c, name: (findByCode(c) || {}).itemName || c, qty: q, price: 0 })),
        displayPieces: share.map(l => ({ code: U(l.code), nsCode: U(l.nsCode), pieces: N(l.pieces), nsQty: N(l.nsQty), name: S(l.name), row: S(l.row) })),
        totalParts: share.reduce((a, l) => a + N(l.pieces), 0),
        shippingMethod: 'CUSTOM', customShippingAddress: { ...shipTo, country: S(shipTo.country) || 'US' }, shipTo: shipToLines(shipTo),
        packStatus: 'Packed', packMode: 'DISPLAY', packedAt: now, packedBy: S(by), packBoxes: boxes || {}, packPhotos: photos || [],
        fulfilFromBin: S(parent.committedBin), createdAt: now, createdBy: S(by),
    };
    const row = { date: new Date(now).toISOString().slice(0, 10), qty: 1, shipped: 1, note: `#${num} → ${S(shipTo.addressee)}, ${S(shipTo.city)} ${U(shipTo.state)} (${id})` };
    return { ok: true, why: '', id, doc, payload, give, row };
};

/**
 * THE FULFILMENT OF A DISPLAY SHIPMENT, FROM THE ORDER'S BIN: every open line of the showroom's sales order (Shared/
 * fulfilmentLines.fulfilmentItemsOf) taken out of `bin` — so the bin drains to 0 as the displays go.
 * @param items  fulfilmentItemsOf(...).items ({ orderLine, location, itemReceive })
 * @param rows   the SuiteQL rows those came from (qty, shipped per line)
 */
export const fulfilFromBinItems = (items = [], rows = [], bin = '') => items.map(it => {
    const r = (rows || []).find(x => Number(x.line) === Number(it.orderLine)) || {};
    const q = r3(N(r.qty) - N(r.shipped));
    return S(bin) && q > 0 ? { ...it, quantity: q, inventoryDetail: { inventoryAssignment: { items: [{ binNumber: { refName: S(bin) }, quantity: q }] } } } : it;
});
