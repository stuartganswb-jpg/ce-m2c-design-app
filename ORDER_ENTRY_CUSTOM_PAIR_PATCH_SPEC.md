# Order Entry → custom pair — patch spec

**Author:** pole-routing session, 2026-09-01 · **For:** whoever owns `RTGDispatchTab.js`
**Status:** spec only. Nothing built. Half of it is in RTG's file, which this session does not edit.

---

## 0. Read this first if you are short on time

This is the **Custom** half of Order Entry. It is **not** the bug Stuart has been chasing —
that one was stocked/finished-assembly poles being tagged Custom, fixed in `0615687` +
`25a25d9`. This spec exists because Order Entry can also raise *made-to-order* lines, and today
it routes those to the finishing floor with no custom step at all.

**Do not build the Stock View half before the RTG half lands.** On its own it makes the problem
worse — see §3.

---

## 1. What Order Entry does today

Live generation is **Stock View → 🧾 Order Entry Needs**, `StockViewTab.js` ~2320-2400.
(Tab 7's own block is dead: `OE_SAVE_AUTOFIRE_RETIRED = true`, `QuickShipTab.js:1541`.)

For every to-be-finished line it writes ONE `hq_work_orders` doc:

```js
source: 'ORDER_ENTRY', routeTo: 'FINISHING', finPayload, autoFlow: true,
```

`routeTo` is hard-coded. It never calls `classifyLine`, never reads `partHandling`, never makes a
sibling. So a mill pole with an applied finish (`HCUMP810` + `/P01`) — custom fabrication by the
rule in `Shared/finishRouting.handlingForErp` — goes to the finishing floor as if it were a
stocked part.

## 2. What it should do

A line whose handling resolves **Custom** should produce the same shape RTG's
`autoSplitSalesOrder` produces for a sales order: a **shop** job for the fabrication and a
**finishing** job for the finish, cross-linked, both anchored to the SO.
A line resolving **Small Parts** keeps today's single finishing WO exactly as it is.

Handling comes from `handlingForErp(finishedErp)`, scoped to the pole/rod category
(`isPoleCategory`). Non-pole lines are out of scope — routing every plated bracket to the shop is
the bug `lineClassification` §1 exists to prevent.

## 3. Why the Stock View half cannot ship first

Flipping `routeTo` to `'SHOP'` alone sends the order to the **wrong queue, unfinished**:

1. `RTGDispatchTab.js:364` — `pushToShop(wo, 'stock', { auto: true })`. The type is hard-coded.
   `isStock: true` → `routeTo: 'MILLING'`, `category: 'Stock Milling'`. A customer's pole lands in
   the stock-milling backlog. The board button at `:2613` does the same.
2. `pushToShop` writes `finSiblingId: null, hasSmallSibling: false` and creates no finishing job.
   The shop floor only *renders* a sibling's chips (`ShopFloor.js:1159`, `:1410`) — it never
   creates one. Siblings exist only because `autoSplitSalesOrder` makes both.

Net effect: the pole gets fabricated and **never finished**. Worse than today's mis-route.

## 4. The RTG patch (your file)

**4.1 Release a sales-anchored WO as sales, not stock.** `:364` and `:2613` both pass the literal
`'stock'`. An Order Entry WO is a customer job — it carries `orderClass: 'ORDER_ENTRY'`,
`soAppId`, `customerId`, and `finPayload.orderType === 'sales'`. Resolve the type from the order
instead of assuming, so `pushToShop` sets `routeTo: 'CUSTOM_FAB'` and `category: 'Custom
Fabrication'`. `:3211` already passes `activeViewOrder.orderType` and is the model.

*Please confirm the field you want as the authority — `orderClass`, a new explicit `orderType` on
the WO, or `soAppId` presence. Stock View will stamp whichever you name; it is not stamping one
today.*

**4.2 Carry the finishing sibling through.** `pushToShop`'s `shopPayload` hard-codes
`finSiblingId: null, hasSmallSibling: false`. When the source WO names a sibling, pass it:

```js
finSiblingId: hqOrder.finSiblingId || null,
hasSmallSibling: !!hqOrder.finSiblingId,
```

Without this the shop card cannot show the finishing side's status and the two jobs are
unlinked for `orderLifecycle`'s closer and orphan audit.

**4.3 Nothing else.** No change to `autoSplitSalesOrder`, the CPQ path, or the auto-release gate
conditions.

## 5. The Stock View patch (this session's file, on your go-ahead)

In the Order Entry Needs generator, for a pole/rod line where
`handlingForErp(finishedErp) === 'Custom'`:

- write the finishing WO as today, plus `shopSiblingId`, `hasCustomSibling: true`
- write a second `hq_work_orders` doc `routeTo: 'SHOP'`, `finSiblingId: <fin id>`, same
  `orderKey`/`soAppId`/`customerId`/`reqDate`, and whichever order-type field §4.1 settles on
- both keep `autoFlow: true` so RTG releases each to its own floor
- `finishStream: POLES` on the finishing half, unchanged

## 6. Acceptance

| case | expected |
|---|---|
| OE `HCUMP810` + `/N90` (assembly code) | ONE finishing WO, Small Parts, POLES recipe — as today |
| OE `HCUMP810` + `/P01` (applied) | shop job in **Custom Fabrication** (not Stock Milling) + linked finishing job, POLES recipe |
| OE `HCUMP810` + `/EP3` (outsourced) | as above; `finishRouteOf` still segregates it in Setup Queue |
| any non-pole line | unchanged |
| RTG board | both halves visible, cross-linked, one SO anchor |

## 7. Sequencing

§4 lands first and is harmless alone — it only corrects the queue and the link for orders that
already route SHOP. §5 goes second. Do not reverse them.
