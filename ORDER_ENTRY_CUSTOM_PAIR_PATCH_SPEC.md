# Order Entry → custom pair — full plan & patch spec

**Author:** pole-routing session, 2026-09-01 · **For:** Stuart + whoever owns `RTGDispatchTab.js`
**Status:** spec only, nothing built. Half of it lands in RTG's file, which this session does not edit.

---

## 0. Where this sits

The pole **tagging** bug is fixed and verified — `0615687` (the suffix rule + Master Library sync)
and `25a25d9` (Stock View's second NetSuite pull). Stocked finished-assembly poles now import and
stay as Small Parts on the finishing floor. Stuart ran the force fix; poles look good.

This document is the remaining **Custom** half: Order Entry can also raise *made-to-order* lines
(a mill code plus an applied `/P01`, `/EP3`), and today it routes them to the finishing floor with
no custom step at all. Read §7 before building — there is one question that may shrink this whole
plan to nothing.

---

## 1. What "the pair" already is

`RTGDispatchTab.autoSplitSalesOrder` (~`:1000-1160`) is the reference implementation. For a CPQ
sales order it classifies every line with `classifyLine`, then writes **two floor documents**:

| | collection | id | key fields |
|---|---|---|---|
| small | `fin_workorders` | `WO-<orderKey>` | `shopSiblingId`, `hasCustomSibling`, `customFabStatus: 'Pending'`, `sentToPickPack: !hasCustom` |
| custom | `shop_custom_orders` | `SHOP-<orderKey>` | `finSiblingId`, `hasSmallSibling`, `category: 'Custom Fabrication'`, `cutList`, `needsPhosphating` |

**The good news: the pairing machinery is generic.** `Shared/workOrderContract.js` keys entirely
off `finSiblingId` — §5 `mirrorCustomStatusToSibling` mirrors shop progress onto the fin WO, and
§A1 `releaseSiblingToPickPack` releases the small-parts pick when the shop operator **starts** the
custom job. Neither knows or cares where the pair came from. An Order Entry pair inherits
shop-start release, the `customFabStatus` chip and PickPack's pack gate
(`PickPackApp.js:2658`) **for free**, provided the two ids are cross-linked correctly.

Nothing new has to be invented. This is wiring, not mechanism.

## 2. The architecture decision

**Order Entry writes two staged `hq_work_orders` docs; RTG releases each to its own floor.**

It must NOT write `fin_workorders` / `shop_custom_orders` directly the way `autoSplitSalesOrder`
does. Order Entry lines carry gates that a CPQ order does not — `awaitingNsWo` (FLOW2 waits for the
NetSuite WO number), `awaitingConvert`, `awaitingComponents`, `awaitingRodCut`, `soAccepted` — and
RTG is the one place those gates are evaluated and released. Writing floor docs directly would fork
the spine and put work on a floor before its gate cleared.

So: two parked orders, each releasing independently through RTG's existing `pushToFinishing` /
`pushToShop`. That is also why §3 has to land first — those paths are not currently fit to release
the custom half.

### The ids, all computable up front

```
fin  half   hq_work_orders/<woId>                   → fin_workorders/<woId>
                                                       (pushToFinishing: finWorkOrderId = hqOrder.id, :1415)
shop half   hq_work_orders/<woId>-C                 → shop_custom_orders/SHOP-<woId>-C
                                                       (pushToShop: shopJobId = `SHOP-${hqOrder.id}`, :1583)
```

Cross-links, stamped at creation:
- fin `finPayload`: `shopSiblingId: 'SHOP-<woId>-C'`, `hasCustomSibling: true`, `sentToPickPack: false`
- shop hq doc: `finSiblingId: '<woId>'`

## 3. The RTG patch — `RTGDispatchTab.js` (not this session's file)

### 3.1 Release a sales-anchored WO as sales, not stock

`pushToShop(wo, 'stock', { auto: true })` at `:364` (auto-release) and `pushToShop(wo, 'stock')` at
`:2613` (board button) both pass the literal `'stock'`. Inside `pushToShop`, `isStock` decides:

```js
routeTo: isStock ? 'MILLING' : 'CUSTOM_FAB',
category: isStock ? 'Stock Milling' : 'Custom Fabrication',
```

An Order Entry work order is a **customer** job — it carries `orderClass: 'ORDER_ENTRY'`,
`soAppId`, `customerId`, and `finPayload.orderType === 'sales'`. Released as `'stock'` it lands in
the milling backlog, which is the wrong queue and the wrong card. `:3211` already passes
`activeViewOrder.orderType` and is the model to follow.

> **Open question for the RTG owner — please name the authority, do not let Stock View guess.**
> Which field says "this is a sales job"? `orderClass === 'ORDER_ENTRY'`, a new explicit
> `orderType: 'sales'` on the WO doc, or the presence of `soAppId`? Stock View is not stamping any
> of them today and will stamp whichever you name.

### 3.2 Carry the finishing sibling through

`pushToShop`'s `shopPayload` hard-codes:

```js
finSiblingId: null,
hasSmallSibling: false,
```

so every shop order it creates is an orphan. It should pass through what the source WO names:

```js
finSiblingId: hqOrder.finSiblingId || null,
hasSmallSibling: !!hqOrder.finSiblingId,
```

Without this, `mirrorCustomStatusToSibling` and `releaseSiblingToPickPack` both no-op (they return
early on a missing `finSiblingId`), the shop card cannot render the finishing side's chips
(`ShopFloor.js:1159`, `:1410`), and `orderLifecycle`'s closer and orphan audit see two unrelated
jobs.

### 3.3 Nothing else

No change to `autoSplitSalesOrder`, the CPQ path, the auto-release gate conditions, or
`pushToFinishing`. §3.1 and §3.2 are both harmless on their own — they only correct the queue and
the link for orders that already route `SHOP`.

## 4. The Stock View patch — `StockViewTab.js` (this session's file, on go-ahead)

In the Order Entry Needs generator (~`:2320-2400`), after `ptype` / `isPole` are resolved:

```js
const handling = isPole ? handlingForErp(finishedErp) : 'Small Parts';
const custom   = handling === 'Custom';
const shopWoId = `${woId}-C`;
```

**4.1 Small Parts (`custom === false`) — unchanged.** One finishing WO, exactly as today. This is
the path every stocked `/BS` / `/N90` / `/CP` pole takes, and it is already correct.

**4.2 Custom (`custom === true`) — write the pair.**

*Finishing half* — the existing doc, with three fields changed:
```js
shopSiblingId: `SHOP-${shopWoId}`,
hasCustomSibling: true,
sentToPickPack: false,          // §A1: the shop's START releases the pick, not us
```
`finishStream: POLES`, the pole counts, `recipe`, `partsList` and every gate stay as they are.

*Shop half* — a second `hq_work_orders` doc:
```js
id: shopWoId, woId: shopWoId, brand: activeBrand,
type: finishedErp, status: 'Approved',
source: 'ORDER_ENTRY', routeTo: 'SHOP', autoFlow: true,
orderClass: 'ORDER_ENTRY', soAppId: so.id,
finSiblingId: woId,                       // §3.2 carries this into shop_custom_orders
<the order-type field §3.1 settles on>,
customerId: so.customerId || null, customer: so.customer || '',
recipe: finish, erpId: finishedErp, partErpId: finishedErp, rootItem: erp,
qty, totalParts: qty, reqDate: needBy, ...(needBy ? { needBy } : {}),
soAccepted: !!so.nsInternalId,
...(flow2 ? { awaitingNsWo: true } : {}),
...gate,                                   // the same component/convert gates as the fin half
```

Both halves keep `autoFlow: true`, so RTG's auto-release picks up each and sends it to its own
floor as its gates clear.

**4.3 Gates apply to both halves.** `gate` (from `executeMakeupActions`) and `awaitingNsWo` are
per-line, not per-floor: if the components are short, neither half should be on a floor. Stamp the
same gate object on both.

## 5. Sequencing — not negotiable

**§3 lands first. §4 second.** Reversed, §4 alone sends customer poles to the Stock Milling backlog
with `finSiblingId: null`, so the finishing half never gets released by the shop's start and never
gets its `customFabStatus` mirrored: the pole is fabricated and **never finished**. That is worse
than the current mis-route, which at least finishes the part.

## 6. Acceptance

| case | expected |
|---|---|
| OE `HCUMP810` + `/N90` (assembly code) | ONE finishing WO, Small Parts, POLES recipe — unchanged |
| OE `HCUMP810` + `/P01` (in-house applied) | shop job in **Custom Fabrication** (not Stock Milling) + linked finishing job, POLES recipe |
| OE `HCUMP810` + `/EP3` (outsourced) | as above; `finishRouteOf` still segregates it in the Setup Queue |
| shop operator presses START on the pair | small-parts pick appears in WMS (`releaseSiblingToPickPack`) |
| shop marks custom Complete | fin WO's `customFabStatus` flips to Complete; PickPack's pack gate opens |
| any non-pole line | unchanged |
| RTG board | both halves visible, cross-linked, one SO anchor |
| `orderLifecycle` orphan audit | the pair closes as a pair, no orphan |

## 7. ⚠ The question that may delete this whole document

**What does the shop floor actually DO with an Order Entry custom line?**

A CPQ custom pole has real fabrication: a cut length, Vision bend/splice/miter geometry, a
`cutList`, wall angles, hanger locations. `autoSplitSalesOrder` carries all of it onto the shop
card because the shop needs it to make the part.

An Order Entry line has **none of that**. `HCUMP810` + `/P01` is a stocked 8 ft pole being painted.
There is no length input, no geometry, no `cutLength`. The shop card would render an empty cut
list. And the raw → `/P` step that *is* real for these lines is already handled elsewhere: the
component pre-check plans it as a **WMS convert** and parks the WO behind `awaitingConvert`
(`oeReviewPlan.js` FLOW1 — "the /P-assembly work order (the raw-consuming vehicle)").

So there are two readings of "in house custom", and they lead to different builds:

- **(a) It means the shop floor.** Build §3 + §4 as written. The shop's role is the pull and the
  phosphate hand-off, and the empty cut list is honest — there is nothing to cut.
- **(b) It means "not a stocked part" — gate on the convert, then finish.** Then the pair is the
  wrong shape entirely. The correct change is much smaller: stamp `partHandling` from the suffix
  rule onto the OE work order so RTG, packaging and pick/pack all classify it correctly, and leave
  the routing to the existing convert gate. No RTG patch needed at all.

**Stuart chose the shop floor when asked, before this detail surfaced.** It is worth putting the
question again now that it is concrete, because (b) is a tenth of the work and touches nobody
else's file.

## 8. Deliberately not touched

- `RTGDispatchTab.js` — another session owns it; §3 is written as a patch for them.
- `autoSplitSalesOrder` and the CPQ path — Stuart: "cpq was always working with the custom route".
- Non-pole items — routing every plated bracket (`H1-1CP-V/EP4`) to the shop is the bug
  `lineClassification` §1 exists to prevent.
- Tab 7's dead generator (`OE_SAVE_AUTOFIRE_RETIRED`) — if the pair ships, that block should be
  deleted rather than kept in sync, but that is its own decision.
