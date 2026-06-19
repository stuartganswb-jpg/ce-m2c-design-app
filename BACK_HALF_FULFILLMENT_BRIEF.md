# Back-Half Fulfillment — Code Brief

Everything after the CPQ quote goes out to External Coop → NetSuite → confirmed **Sales Order on RTG Dispatch**. That front part is tested and working. This brief covers the three workflows that finish the app: (A) the standard in-house order lifecycle, (B) outsourced **stock & replenishment**, (C) outsourced **finishing logistics** for daily orders.

**Read first:** `WORK_ORDER_CONTRACT.md` (the shared `orderKey` model — already partly implemented).

---

## 0. What already exists (extend, don't rebuild)

From the current code (`feat/program-prints`):
- **Auto-split exists.** `RTGDispatchTab.autoSplitSalesOrder` (`RTGDispatchTab.js:302-512`) reads the confirmed SO's CPQ lines, classifies each via `Shared/lineClassification.js` (`partHandling` → `'Small Parts'` | `'Custom'`), and writes three docs that share one **`orderKey`**: `fin_workorders/WO-<key>`, `shop_custom_orders/SHOP-<key>`, `packaging_orders/PKG-<key>`, with `finSiblingId`/`shopSiblingId`/`hasCustomSibling`/`hasSmallSibling`.
- **Status mirror exists.** Shop start/complete mirrors `customFabStatus` (Pending/In Process/Complete) onto the sibling fin WO (`Shared/workOrderContract.js:mirrorCustomStatusToSibling`; `ShopFloor.js:811-836`); SetupQueue already shows that badge (`SetupQueue.js:239-248`).
- **Labels are stubs.** `printZebraLabel` only `console.log`s (`PickPackApp.js:275-277`); shop "complete with label" prints a ZPL string whose barcode is `orderKey` (`ShopFloor.js:794-808`).
- **Outsourcing is currently derived from the recipe** matching `hq_outsource_finishes` (`RTGDispatchTab.js:393-395`), **not** from the part. The real part flag is `manufacturingSpecs.isInHouse === false`; `outsourceAction` (e.g. "PLATING") is the secondary classifier.
- **Stock is not persisted.** NetSuite on-hand is session-only (`StockViewTab.js:177-178`); POs/WOs write to `hq_purchase_orders`/`hq_work_orders` but **dead-end at the RTG board** — only `estimate` is ever pushed to NetSuite (`ERPPushPullTab.js:229`).

So the foundation is real; the work is closing gaps + adding the outsourced lanes.

---

## 1. Line classification — make it three-way

Today a line is **Small Parts** or **Custom** (`partHandling`), and "outsourced" is inferred from the recipe. **Decision needed:** make outsourced a first-class routing dimension so the split can send it down the right lane.

Recommended: classify each line into a **routing lane**:
- **CUSTOM** — fabricated to size → Shop Floor.
- **SMALL_INHOUSE** — finish-to-order in our finishing dept → Finishing Floor.
- **SMALL_OUTSOURCED** — finished by an outside vendor; **stocked** (see §3). Detected by `part.manufacturingSpecs.isInHouse === false` (anchor) and/or `/EP#` finish suffix.

Put this in `Shared/lineClassification.js` (extend `classifyLine`) so RTG's split and every downstream queue agree on the lane.

---

## 2. Workflow A — Standard in-house lifecycle (close the gaps)

**The intended flow (confirm this is right):** SO splits → small parts populate the Finishing **Work Order Queue** and wait; custom parts go to Shop **Custom** tab; when the shop operator **starts** the custom job the WO-queue window flips Pending → In Process, **which triggers pushing the order to Pick/Pack for picking**; shop finishes the custom part, labels it, brings it to **staging**; picked small parts also go to staging; at staging both labels are **scanned and verified** (the "staging handshake"); on a verified match the order is pushed into the **Setup Queue** with a **green window + "Ready to push to Active Floor"** button; the **Active Floor** only ever holds about a day's work.

The gaps to implement, in order:

### A1. The missing Pick/Pack trigger
`PickPackApp` filters jobs on `sentToPickPack === true` (`PickPackApp.js:106`), but **nothing ever sets it true** (confirmed repo-wide). Per the workflow, the trigger is the **shop operator starting the custom job**. So in `ShopFloor.handleStartProcess` (`:811-819`), when status → `In Process` and `customFabStatus` mirrors to the sibling, **also set the sibling fin WO `sentToPickPack: true`**. That single change lights up the pick queue at the right moment. (For small-only orders with no custom sibling, set `sentToPickPack: true` at split or via a manual "release to pick" action.)

### A2. The staging handshake (two-label scan + verify)
Replace the current one-label fuzzy match (`handleStagingMatch`, `PickPackApp.js:260-273`) with a true two-scan verify:
1. Scan the **small-parts** staging label (its `orderKey`) — the small-parts WO must be `pickStatus === 'Picked_Awaiting_Staging'`.
2. Scan the **custom** label (barcode is `orderKey`, printed at `ShopFloor.js:794`) — the shop order must be `Completed`.
3. **Verify the two scans resolve to the SAME `orderKey`** (exact, not `includes`) and that both halves are present and ready. Reject mismatches loudly ("different orders — do not mix").
4. On success, advance the order (A3).

> Edge: small-only orders (no custom sibling) skip the custom scan; custom-only skip the small scan. Use `hasCustomSibling`/`hasSmallSibling`.

### A3. Push to Setup Queue as "Set Up" + green window
On a verified handshake, write the fin WO so it re-enters the Finishing **Setup Queue** as ready: set a clear ready state (e.g. `stagingStatus: 'MATCHED'`, keep `currentPhase: 'Setup'`), and in `SetupQueue.js` render that job window **green** with a **"Push to Active Floor"** button (today the only control is the Pending→Staged button swap, `SetupQueue.js:253-257`; add the green/ready state). Pushing it runs the existing `stageToFloor` (`currentPhase → 'Painting'`).

### A4. Active Floor — a day's worth of work
`ActiveFloor` has **no load cap** today (`ActiveFloor.js:87` just shows everything `currentPhase==='Painting'`). Add a daily WIP limit: only admit up to a configurable capacity (by piece count, recipe minutes, or station-hours) per day; the rest stay "ready" in the Setup Queue. Make the capacity a `fin_config` setting.

### A5. State machine (define once, use everywhere)
```
SO confirmed → autoSplit
  small:  fin_workorders.stepStatus=Pending, sentToPickPack=false, customFabStatus=Pending
  custom: shop_custom_orders.status=Pending
Shop START custom → shop.status=In Process; sibling customFabStatus=In Process; sibling sentToPickPack=TRUE   (A1)
PickPack pick small → pickStatus=Picked_Awaiting_Staging
Shop COMPLETE custom → shop.status=Completed; label printed; customFabStatus=Complete
Staging handshake (both scanned + verified) → stagingStatus=MATCHED                                            (A2)
Setup Queue green → "Push to Active Floor" → currentPhase=Painting (respect daily cap)                          (A3/A4)
Finishing done → back to Pick/Pack → pack → ship → NetSuite item fulfillment
```

---

## 3. Workflow B — Outsourced parts: stock & replenishment

Outsourced small parts are **stocked**, not finished-to-order. Two sub-cases the system must distinguish per finished SKU:
- **STOCK_FINISHED** — we keep the finished part on the shelf (e.g. `H1-138BF/EP1`). On an order, **pick the finished part from the bin**. Done.
- **BUILD_FROM_RAW** — we stock the raw/base (e.g. `H1-138BF/P`) and finish it to the ordered SKU (e.g. `H1-138BF/P27`). On an order, **pull the raw from the bin and route to finishing**.

**Decision needed:** today this is only *inferred* from the suffix (`/P` vs `/EP#`, `StockViewTab.js:419-466`) and never stored. Add an explicit **stock policy** on the finished part: `stockPolicy: 'STOCK_FINISHED' | 'BUILD_FROM_RAW'` + `rawPartId` (the base SKU), defaulting from the suffix rule but overridable.

### B1. Smart replenishment watch
Build a standing watch (extend `StockViewTab`'s reorder math, `:342-357`) over sales velocity + `reorderPoint`/`moq`/`leadTime` to flag low stock and propose replenishment. **Prerequisite:** persist NetSuite on-hand to Firestore (it's session-only today, `:177-178`) so the watch can run unattended / on a schedule, not just when someone opens the tab.

### B2. Replenishment = build + outsource
When replenishing a STOCK_FINISHED outsourced part:
1. **Consume raw → produce finished** in inventory. In NetSuite this is an **Assembly Build** (raw component out, finished assembly in). *(Decision: Assembly Build vs Work Order — Assembly Build is simplest for a raw→finished stock conversion with no internal labor routing; use a Work Order only if you need to track internal ops. Recommend Assembly Build.)*
2. **Ship the raw to the finisher** with app-generated **labels + packing list** (reuse `PackagingTab` + `standard_boxes`).
3. **Receive back + bill** — associate a **Purchase Order** to the finisher for the finishing service (the build covers the inventory move; the PO covers the vendor's labor/billing).

### B3. NetSuite mechanics
The proxy is generic (`functions/index.js:119`), and only `estimate` is pushed today — so an Assembly Build and a PO are **additive client calls** mirroring `ERPPushPullTab.js:229-240` (new `targetUrl` = `/record/v1/assemblybuild` and `/record/v1/purchaseorder`). You'll need the item **internal id** (already available from SuiteQL `item.id`, `StockViewTab.js:198`) since current records only carry `itemid`/`legacyErpId` strings.

---

## 4. Workflow C — Outsourced finishing logistics (daily orders)

For a daily order that has **outsourced finished small parts (picked from stock)** *plus* **custom poles**: the poles still go to the Shop, get fabricated, then go out to the **outside finisher** — batched weekly.

**The intended flow (confirm):** app generates an **outsourced finishing work order per Sales Order**; as the shop completes fabrication, poles go into **"Outsourced Staging"** and wait; once a week we **scan all the ready orders' labels**, the app **gathers them into one weekly batch and pushes it to NetSuite as a single weekly PO**; we track an order by **weekly PO # → the SO's work order #**; when poles come back from the finisher we **scan the custom labels back in**, and Pick/Pack **re-aligns** each with its matching (already-packed) small parts, scanning to confirm the match.

Implementation:

### C1. Per-SO outsourced work order
At split (or on shop completion of an outsourced custom order — note shop already sets `status: 'Sent to Plating'` for `isOutsourced`, `ShopFloor.js:826`), create an **outsourced finishing work order** record carrying `orderKey`, `salesOrderId`, finisher/vendor, and the items going out.

### C2. Outsourced Staging bucket
A new staging state/queue (`outsource_staging`) where completed-but-not-yet-shipped poles wait. Shop "complete" on an outsourced order routes here instead of the normal staging.

### C3. Weekly batch → one PO
A "Ship This Week" action: scan/select all `outsource_staging` orders ready → app gathers them into a **weekly batch** (`outsource_po_batches/{weekId}`) → push **one Purchase Order** to NetSuite for the batch → store the returned **NetSuite PO number** on the batch and on each member work order. Tracking key = `weeklyPO#` + per-SO `woNum`.

### C4. Return scan + re-align
When poles return: scan each custom label (`orderKey`) back in → mark the work order received → Pick/Pack **re-pairs** it with the matching small-parts package (already packed) via `orderKey`, with a confirm scan. Then the order proceeds to final pack/ship/fulfill.

---

## 5. Data model additions

| Where | Add | Why |
|---|---|---|
| `Approved_Designs.manufacturingSpecs` | `stockPolicy` ('STOCK_FINISHED'\|'BUILD_FROM_RAW'), `rawPartId` | distinguish pick-finished vs pull-raw-and-finish (§3) |
| `Shared/lineClassification.js` | third lane `SMALL_OUTSOURCED` | route outsourced lines correctly (§1) |
| `fin_workorders` | `sentToPickPack=true` trigger; `stagingStatus` ('AWAITING'\|'MATCHED') | A1/A2/A3 |
| `fin_config` | `activeFloorDailyCapacity` | A4 |
| new `outsource_workorders` (or flag on shop order) | per-SO outsourced WO: orderKey, salesOrderId, finisherId, items, status | C1 |
| new `outsource_po_batches/{weekId}` | weekId, status, netsuitePoNumber, members:[{soId, woNum, orderKey, items}] | C3 |
| persist NetSuite on-hand to Firestore (e.g. `Approved_Designs.stock` or `inventory_levels`) | onHand/available/committed | B1 standing watch |

Statuses to standardize (reuse existing where possible): shop `Pending → In Process → Completed/'Sent to Plating'`; fin `Pending → Picked_Awaiting_Staging → MATCHED → Painting`; outsource `Staged → Batched(PO#) → AtFinisher → Returned → ReAligned`.

---

## 6. Cross-cutting prerequisites

- **Real label printing.** `printZebraLabel` is a stub (`PickPackApp.js:275`). All the scanning depends on real labels (small-parts, custom pole, outsourced shipment) encoding the `orderKey` (+ line/PO where relevant). Pick a method (ZPL to a networked Zebra, or browser-print label stock). This is foundational — do it before the scan-heavy steps.
- **Persisted stock** (B1) — required for the unattended replenishment watch.
- **Vendor/finisher resolution** — join the free-text `manufacturingSpecs.vendorName` to `crm_records` (type VENDOR) so POs carry a real vendor id (today they don't, `StockViewTab.js:517`).

---

## 7. Open decisions (resolve before/while building)

1. **Outsourced as a line lane** vs recipe-derived — recommend first-class lane keyed on `isInHouse===false` (§1).
2. **NetSuite raw→finished record:** Assembly Build (recommended) vs Work Order (§3/B3).
3. **Stock policy** explicit field vs inferred from `/P` vs `/EP#` suffix — recommend explicit, default inferred (§3).
4. **Weekly batch trigger:** manual "Ship This Week" button vs scheduled job (§C3).
5. **Label hardware/format** (§6) — the dependency that gates the scan workflows.
6. **Active Floor capacity unit** — pieces, recipe-minutes, or station-hours (§A4).

---

## 8. Suggested build phases

1. **Phase 1 — close Workflow A:** the `sentToPickPack` trigger (A1), the two-label staging handshake (A2), Setup-Queue green/ready + push (A3), Active-Floor daily cap (A4). This makes the tested-but-incomplete in-house loop run end to end.
2. **Phase 2 — real labels + persisted stock** (§6) — the foundation for everything scan- and replenishment-based.
3. **Phase 3 — outsourced stock model + smart replenishment + Assembly Build + finisher PO** (Workflow B).
4. **Phase 4 — outsourced finishing logistics:** per-SO WO, Outsourced Staging, weekly batch → one PO, return scan + re-align (Workflow C).

Each phase is independently testable on a branch; Phase 1 unblocks your floor testing immediately.
