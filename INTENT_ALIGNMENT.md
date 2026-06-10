# Intent vs. Implementation — Alignment Review

This maps your described intended workflow onto what the code actually does, stage by stage. **[confirmed]** = verified at file:line. **[likely]** = strong evidence, worth a quick confirm.

---

## What IS aligned (working as you described)

- **Design pipeline tabs exist and are wired in order**: Inception (1) → Node Grouping (1.5) → Visual Assembly (2) → BOM Engine (3), all routed in `HQ.js:312-315`; Visual Assembly has an explicit "proceed to BOM" handoff.
- **Central library** = `Approved_Designs`, consistent everywhere. Tab 4.5 (`LibraryMassUpdateTab`) edits the `system/master_lists` dictionary as intended.
- **Multi-customer pricing structure exists and is correct**: `clientPricing` is an array on each part, each entry `{ customerId, clientSku, price, clientSalesPrice }` (`LibraryTab.js:57, 310-320, 383`). One item → many customers, each with their own SKU + cost + sales price. The data model fully supports your private-label requirement.
- **Four brands ↔ subsidiaries**: `m2c / uniquity / ce / leyla` mapped to NetSuite subsidiaries; sync settings per page. Confirmed and consistent.
- **CPQ → NetSuite currently writes Quotes/Estimates** (`ERPPushPullTab` creates an Estimate), matching "currently pushes to quotes, will switch to sales orders later."
- **RTG writes to the correct floor collections**: custom → `shop_custom_orders` (which Shop Floor reads), small → `fin_workorders` (which Finishing reads).
- **Inventory reorder scaffolding exists**: `StockViewTab` has watchlist filters, low-stock detection, suggested PO/WO quantities, and pushes WOs to `hq_work_orders` for RTG.
- **Asset gallery is shared app-wide**, and Finishing's `FloorAssetViewer` links `global_assets.finishId` → `fin_recipes.code` so finishers see the recipe + reference image.

---

## Where it is NOT aligned

### The linchpin: there is no shared "order key" tying the two streams together **[confirmed]**
Your whole model depends on a small-parts work order (Finishing) and its sibling custom-parts order (Shop) being **two halves of the same customer order** that stay in sync and get re-matched at staging. In the code they are created as **independent documents with no shared identifier**: RTG makes a `fin_workorders` doc and a separate `shop_custom_orders` doc with id `SHOP-${id}`, and nothing links them. Every cross-floor behavior you described (status mirroring, the staging handshake) is blocked by this one missing piece. **This is the first thing to design.**

### 1. CPQ does not auto-split lines into small vs. custom **[likely]**
You described the CPQ flow builder dividing each order's lines into two divisions (small → finishing, custom → shop) and routing automatically through RTG. In the code, RTG has **manual** `pushToFinishing()` and `pushToShop()` buttons that push a **whole order** to one floor (`RTGDispatchTab.js:223, 295`). There's a `dispatchStatus: {fabrication, finishing, sewing, packing}` object on CPQ jobs (`CPQTab.js:743`) but no logic that reads line-level small/custom tags and fans them out. So the automated line-level split isn't implemented — it's currently an operator decision per order.

### 2. The "engineering" review step is named "machinist" and the gate is advisory **[confirmed]**
Inception's approval gate has three checkboxes — `designer`, `technical`, `machinist` — not "engineering" (`InceptionTab.js:901, 911`). When all three are checked it shows *"Proceed to Visual Assembly"* but **does not lock or move anything** — downstream tabs (`NodeCluster.js:61`) load every assembly regardless of approval, so unapproved designs can be worked. Separately, there's an `EngineeringTab.js` that looks like the intended engineering review, but it's **not routed anywhere** (not imported in `HQ.js`) and writes to the dead `Design_Library`. So the "engineering takes a look" step you described is effectively the `machinist` checkbox, and the real EngineeringTab is orphaned.

### 3. "Main Assembly" tier is read everywhere but never assigned **[confirmed]**
Your Main-vs-standard distinction maps to `partClass: "Master Assembly"` vs `"Assembly"`. CPQ, BOM, NodeCluster, StockView, VisionLighting all **filter on** "Master Assembly" — but **no code path ever sets it**. Inception hardcodes `partClass: "Assembly"` (`InceptionTab.js:271`); LibraryTab creates `Inventory`/`Assembly`. So the tier that's supposed to drive CPQ exists only as a consumer — there's no UI step that promotes a standard assembly to a Main/Master Assembly. (Unless you've been setting it by hand in Firestore — worth confirming.)

### 4. Sales price is never synced, so NetSuite pushes can go out at $0 **[confirmed]** — highest priority given your "price + cost is imperative"
The main item sync (`NetSuiteSyncTab`) writes `cost` but **never writes `basePrice` (sales price)**. The push back to NetSuite sets the line `rate` from `basePrice` (`ERPPushPullTab.js:111`). So any item brought in by the main sync, but not separately touched in StockView or edited by hand, **pushes back at rate $0**. There are also two parallel sync paths writing `cost` from different NetSuite columns (`averagecost` vs `purchaseprice`), so costs can disagree. This directly threatens the one thing you said must be correct.

### 5. Customer/private-label info is captured but doesn't flow downstream **[confirmed]**
`clientPricing` (customer SKU, customer price, customer sales price) lives on the part, but it is **not carried onto work orders or into Pick/Pack**. The RTG `fin_workorders` payload doesn't include client SKU, and PickPack reads only `legacyErpId/itemId/itemName/productType/binLocation` — not `clientPricing`. So the customer info you need on packing/shipping forms isn't propagated yet; the plumbing from library → WO → packing label has to be added.

### 6. Setup Queue doesn't show the custom-parts status **[confirmed]**
You want the small-parts job window in the Setup Queue to display the matching custom-parts status (Pending → In Process when the shop operator hits Begin). The Setup Queue reads only `fin_workorders` and has **no awareness of the shop side** — no read of `shop_custom_orders`, no linked status. The "Incoming Parts from Shop Floor" banner is wired to the dead `shop_finishing_alerts` collection (nothing writes it). So the status mirroring doesn't exist yet, and depends on the shared order key (linchpin above).

### 7. HQ-dispatched finishing jobs arrive with no task cards **[confirmed]**
RTG writes `tasks: { setup }` (`RTGDispatchTab.js:268`) but the Active Floor only renders `spinSetup/spinSpray/spinBake/poleSpray/poleBake/hand` (`ActiveFloor.js:127-132`). Real dispatched jobs therefore show up actionless — the floor only "works" with the demo seeder's data shape.

### 8. "Finishing manager pushes to Pick/Pack" isn't wired **[confirmed]**
PickPack's queue filters on `sentToPickPack` and `pickStatus`, which **no producer ever sets**, and on `partsList[].binLocation/assetUrl`, which nothing populates. So the pick queue is unfed in production, and the staging handshake (`handleStagingMatch`) matches on `soNum`, which isn't a shared key between the two streams (linchpin again).

### 9. Stock replenishment WOs route as "Custom Fabrication," not into milling **[likely]**
StockView pushes WOs to `hq_work_orders` (good), but RTG's `pushToShop` writes them to `shop_custom_orders` tagged `category: 'Custom Fabrication'` (`RTGDispatchTab.js:328-342`). Stock-replenishment WOs are supposed to enter the **milling** tab → set queue → scheduler, which is a different pipeline than custom fab. There's no distinct routing for stock WOs into `shop_milling`.

### 10. The closing loop (finish → pack → ship → fulfilled) is largely unbuilt **[confirmed]**
There's no path that pushes a **completed** finishing job back to Pick/Pack (Finishing's Summary/ActiveFloor don't set a "ready to pack" status PickPack reads). PickPack has a `PACKING` tab but it's a stub, and there's **no NetSuite fulfillment call** — only an inventory adjustment. So packing/labeling/shipping and "mark fulfilled in NetSuite" are net-new work.

---

## Things you named that are net-new (not yet started)
- **Fusion integration** for machines/tooling (tool library, ATM features) — no integration exists; the tooling/machine tabs are basic CRUD.
- **"Smart" inventory watch** that guarantees you never run out — the low-stock + suggested-qty scaffolding exists, but it's blind wherever `reorderPoint` wasn't entered (ROP isn't synced from NetSuite), and on-hand quantities aren't persisted (held in session state only), so it can't run as a standing/automated watch yet.

---

## The one-sentence summary
The design/library half of the app is built correctly and matches your vision; the manufacturing-flow half is a set of well-built **islands** (Shop, Finishing, Pick/Pack each work internally) that aren't yet connected — and the missing connection is a shared order identity plus a single agreed work-order contract carried end to end.
