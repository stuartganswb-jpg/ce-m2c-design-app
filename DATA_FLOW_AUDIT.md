# Data Flow Audit — CE M2C Design Suite

**Scope:** HQ, Shop Floor, Finishing Floor, Pick/Pack, and the NetSuite sync, traced against the central library (`Approved_Designs`) and the master data dictionary (`system/master_lists`).
**Date:** 2026-06-09
**Method:** Static trace of every Firestore read/write across ~25k lines of source. Findings marked **[confirmed]** were re-verified directly against `file:line`; **[reported]** come from the cluster trace and are high-confidence but worth a 1-minute spot check before you act.

---

## The model as it actually exists

There are two intended sources of truth:

- **`Approved_Designs`** — the central parts/assemblies library. This is healthy and consistent: HQ Library, Inception, Shop, Pick/Pack, and the NetSuite sync all read it, and it's keyed the same way everywhere.
- **`system/master_lists`** — the data dictionary (one doc, top-level keys like `prodTypes`, `assemblyTypes`, `flangeStyles`, etc.).

The headline structural problem: **the master dictionary is only consumed inside HQ.** Shop Floor and Finishing Floor read **zero** `master_lists` keys — they build their dropdowns/filters by scraping values off whatever happens to be on the part objects (`ShopEngineering.js:168-183`) or out of `fin_recipes` (`Recipes.js:18`). So the guarantee you asked for — "what you see on the shop floor aligns with finishing and matches the master dictionary" — is **not enforced by anything today.** It works only as long as the data happens to agree.

---

## P0 — Broken handoffs (jobs silently fall through the cracks)

These are the "dead ends" and "ghost links." In each case one app writes to one place and the next app reads from another, so work disappears between stages with no error.

### 1. Shop → Finishing alert banner is dead **[confirmed]**
`SetupQueue.js:34` subscribes to `shop_finishing_alerts where read==false` and renders the "Incoming Parts from Shop Floor" banner. **Nothing in the entire repo writes `shop_finishing_alerts`** — the only two references are the read (`:34`) and the flag-as-read (`:93`). The actual Shop→Finishing signal goes through `global_messages` as a free-text string (`ShopFloor.js:800-803`, shape `{sender, sourceApp, target:'FINISHING', msg}`), which has no `read` field and would never match the query. **Result: the banner is permanently empty.**

### 2. HQ → Finishing work-order task shape mismatch **[confirmed]**
HQ dispatch writes finishing jobs at `RTGDispatchTab.js:275` with `tasks: { setup: {...} }`. But the Finishing floor view (`ActiveFloor.js:109-132, 227-285`) only understands `tasks.spinSetup / spinSpray / spinBake / poleSpray / poleBake / hand`. **An HQ-dispatched WO therefore lands on the floor with no task cards to action.** The only code that produces the spin/pole/hand shape is demo seeding in the orphaned `Management.js` — i.e. the floor only "works" with fake data.

### 3. Finishing → Pick/Pack queue is never fed **[confirmed]**
`PickPackApp.js:123` filters jobs on `sentToPickPack`, and `:424` on `pickStatus==='Pending'`. **No file anywhere sets either field** (`RTGDispatchTab` does not write `sentToPickPack`, `pickStatus`, or `partsList`). Additionally PickPack reads `partsList[].binLocation` and `partsList[].assetUrl` (`:249, :360-362`), which only the demo seeder produces — and even that only writes `{name, qty}`. **Result: the Pick Queue is empty in production, and bin validation always falls through to `UNASSIGNED`.**

### 4. NetSuite Estimate pushes at rate $0 **[confirmed]**
`ERPPushPullTab.js:111` sets the NetSuite line `rate` from `manufacturingSpecs.basePrice`. The master item sync (`NetSuiteSyncTab.js`) **never writes `basePrice`** — it only writes `cost`. `basePrice` is populated only by `StockViewTab.js:310` or manual entry. **Any part brought in by the main sync, but not separately touched, pushes to NetSuite at rate 0**, silently distorting the quote/"silent fee" total (`ERPPushPullTab.js:139-140`).

---

## P1 — Split sources of truth & ghost collections

### 5. `Design_Library` ghost write **[confirmed]**
`EngineeringTab.js:20` does `addDoc(collection(db,"Design_Library"), …)`. Nothing reads `Design_Library`; the entire rest of the app uses `Approved_Designs`. EngineeringTab also maintains its own approvals state that writes here instead of onto `Approved_Designs.approvals`, so Engineering sign-offs never reach the real part record. This whole file looks like disconnected legacy code.

### 6. The master dictionary isn't authoritative on the floors **[confirmed]**
As above — Shop and Finishing consume no `master_lists` keys. Compounding it, **finishes have parallel truths with no reconciliation**: `fin_recipes` + `fin_paint_profiles` (Finishing's local truth) vs `system/master_finishes` + `hq_outsource/inhouse/global_finishes` (HQ's). HQ actually *pulls from* the finishing DB (`LibraryMassUpdateTab.js:614`) rather than pushing a canonical list down.

### 7. Vendors/customers live in three uncoordinated stores **[reported]**
(a) `crm_records` with `type: VENDOR/CUSTOMER` (what the NetSuite CRM sync writes); (b) `master_lists.vendors` / `master_lists.customers` (legacy lists still read by `LibraryMassUpdateTab`/`CPQTab`); (c) free-text `manufacturingSpecs.vendorName` on the part. `StockViewTab`'s PO builder keys on the free-text name (`:517`), so it can't resolve a `crm_records` vendor id for an actual NetSuite PO.

### 8. HQ reads the wrong log collection **[reported]**
Live finishing logs are written to `hq_logs` (`FinishingFloor.js:81`), but HQ Admin reads `fin_logs` (`AdminTab.js:139`) — so the HQ activity view misses all current finishing activity.

### 9. Work-order field divergence inside Finishing **[reported]**
Two producers write `fin_workorders` with different schemas. QC writes `completedParts`/`scrapParts` (`Modals.js:129-130`) but `Summary.js` reads `scrapReported`/`completedAt` (`:43-56`) — so the Summary table is effectively always empty. Order type is written as `type` (`SetupQueue.js:66`) but read as `orderType` (`Modals.js:111`).

---

## P2 — Naming/casing inconsistencies (silent, low-grade ghosts)

10. `watchList` vs `watchlist`, and `collection` (scalar) vs `collections` (array) vs `customData.collection` are all read in different branches across Shop/HQ/sync (`ShopEngineering.js:172-217`). Whichever the data actually uses, the other branches are dead — and a data change flips which one works. **[reported]**
11. Stock quantities (`onHand/available/committed/...`) are pulled from NetSuite but kept only in React state/`sessionStorage` (`StockViewTab.js:159-178`, `PickPackApp.js:169-174`) — never persisted. `reorderPoint/moq/leadTime` are read for PO/WO math but never synced from NetSuite, so unedited parts compute ROP = 0. **[reported]**
12. Orphaned components not routed anywhere: `FinishingFloor/Management.js`, `Messaging.js`, `Migrator.js` (`FinishingFloor.js:16-17` removed them from TABS). They're the only writers of some `fin_*` collections — dead code that makes the data model look more connected than it is. **[confirmed]**

---

## Security issues found along the way (out of scope, but material)

- **NetSuite OAuth consumer/token secrets are hardcoded** in `functions/index.js:93-97`.
- **A legacy Firebase project API key/project is hardcoded** in `ShopEngineering.js:147`.
- **Master PIN `1032` is hardcoded** (`FinishingFloor.js:89`); `authenticatePin` has AppCheck disabled and the token check bypassed (`functions/index.js:13,17`), and PickPack does its own client-side PIN lookup against `hq_users` (`:89`), bypassing the secure function.

These belong in a private rotation/refactor, not in any commit that goes to a public repo.

---

## Recommended fix order

The P0 items are what's actually losing work between stations, so they pay back first.

1. **Unify the work-order contract (fixes #2 and most of #3).** Pick one `fin_workorders` schema — the spin/pole/hand `tasks` shape the floor already renders — and make `RTGDispatchTab` write exactly that, including `sentToPickPack`/`pickStatus`/`partsList[{name,qty,binLocation,assetUrl}]`. This single change reconnects HQ→Finishing→Pick/Pack.
2. **Kill or wire the dead handoff (#1).** Either delete the `shop_finishing_alerts` banner, or have Shop Floor write real alert docs `{read:false, msg, …}` to that collection.
3. **Fix the price push (#4).** Either sync `basePrice` in `NetSuiteSyncTab`, or push `rate` from `cost` with a guard that refuses to transmit a line at rate 0.
4. **Retire `Design_Library` and the orphaned Finishing components (#5, #12)** so the codebase matches the live data model.
5. **Make `master_lists` authoritative on the floors (#6, #10).** Have Shop and Finishing read their dropdown options from `master_lists` instead of scraping part data, and standardize on one casing (`watchList`, `collections[]`). This is what structurally guarantees Shop ↔ Finishing ↔ dictionary alignment going forward.
6. **Consolidate vendors/customers to `crm_records` (#7)** and point PO/Estimate builders at the id, not the name string.
7. **Align the logging and Summary field names (#8, #9).**

Items 1–3 are each a contained change to one or two files and would stop the silent job loss immediately. I can take any of these into a branch and implement + diff it whenever you want.
