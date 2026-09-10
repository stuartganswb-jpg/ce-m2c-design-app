# Session communications board — 2026-09-10

*Kept by the COMMUNICATOR session (the orientation session that wrote `STATE_OF_THE_APP_2026-09-10.md`).
Five working sessions run from these briefs. This file is the map: who owns what, how a hand-off travels,
and what Stuart has decided. Every session reads it at start and whenever a hand-off arrives.*

## Stuart's decisions, 2026-09-10

- **⚡ Auto-release is ON.** The 09-03 memories saying "OFF until no orphans" are superseded.
- **Stuart is entering quotes for one customer now; they become sales orders.** Those orders ARE the
  round-trip tests for every session. Do not raise separate test orders; read his orders on the board
  and follow them through your screens.
- **The communicator session routes.** Approvals and answers come from Stuart in the working session or
  through the communicator ("relayed approvals count", 09-03). Cross-territory asks go through briefs, not
  edits in another session's file.
- **Stuart answers each session directly, in that session.** Do not route your questions through the
  communicator. Keep the communicator informed by appending to your brief's **§ Status log** (hash + one
  line) after every commit and every decision Stuart gives you.
- **Anything that falls under none of S1–S5 goes to the communicator session**, which handles it directly
  with Stuart.
- **Every push is announced (Stuart, 2026-09-10, to S2).** The session that pushes writes a DEPLOY NOTICE into
  every other session's brief under **§ 6 Hand-offs in** (hash, what shipped, which documents/fields changed,
  "hard-refresh + re-PIN") and a row in the **Deploys** table below — before it asks Stuart for anything else.
  Then it updates this board (its own Status row) so the communicator's orientation stays current.
- **Order of starts:** S2 (RTG / WO / PO) first — it has an immediate problem — then S1 (CPQ / Vision /
  CRM), then S3, S4, S5 as Stuart opens them.
- **One issue at a time per session** (09-03 rule, unchanged). Plan → wait → edit → lint → commit →
  pull-rebase → safe-push check → push.

## The five sessions

| key | brief | territory in one line |
|---|---|---|
| **S1** | `BRIEF_S1_CPQ_VISION_CRM.md` | the sales doors and the engine that feeds them: CPQ, Vision, Order Entry, CRM, documents, the tag engine, 1.6/1.5 authoring, the NetSuite transaction |
| **S2** | `BRIEF_S2_RTG_WO_PO.md` | the control spine: RTG Dispatch, work-order and purchase-order creation, Stock View, Snapshot, Library WO/PO paths, the closer, the gates, the split |
| **S3** | `BRIEF_S3_WMS_FINISHING_SHOP.md` | the three floors: WMS, Finishing, Shop; the outbox and the NetSuite functions; every NetSuite inventory write |
| **S4** | `BRIEF_S4_PORTAL_PAYMENTS_UPS_API.md` | the customer portal, card payments, UPS rate/ship/track, the Fulfilment tab, vendor API onboarding |
| **S5** | `BRIEF_S5_CUSTOMER_FACING.md` | what the customer holds: spec sheets, 4.6 collections and kits, marketing, guide books, asset gallery |

## File ownership (the line that keeps five sessions safe)

Own = edit freely (after a plan). Read-only = never edit; write a patch spec into the owner's brief.

| session | owns |
|---|---|
| S1 | `HQ/CPQTab.js`, `VisionHardware.js`, `ClientVisionTab.js`, `QuickShipTab.js`, `ExternalCoopTab.js`, `ERPPushPullTab.js`, `AssemblyBuilderTab.js` (1.6), `NodeClusterTab.js` (1.5), the flow generator in `AdminTab.js`; `Shared/`: `hardwareModel`, `hardwareAdapter`, `hardwarePricing`, `HardwareConfigurator`, `hardwareHandoff`, `assemblyTags`, `traverse*`, `sizeMatrix`, `plateRules`, `platePool`, `partLookup*`, `finishLabel`, `configQty`, `tagPhrase`, `tagSheetImport`, `visionBridge`, `nsTransmit`, `salesOrderHeader`, `lineClassification`, `reopenQuote`, `quoteDisplay`, `printForm`, `FormPreview`, `QuickShipInvoiceModal`, `ConfiguredItemViewer`, `aliasIdentity` (app copy), `brandNetsuite`, `studioScene`, `fusionImport`, `itemCodeMatch`, `nodeList`, `stepImport`, `slotGroups` |
| S2 | `HQ/RTGDispatchTab.js`, `StockViewTab.js`, `LibraryTab.js` (the WO/PO/repaint paths), `LibraryMassUpdateTab.js` (4.5); `Shared/`: `workOrderCreate`, `floorRelease`, `orderStatus`, `orderLifecycle`, `workOrderContract`, `orderHold`, `purchaseOrders`, `poLock`, `platingDemand`, `finishedRunPrecheck`, `finishedGoodsRun`, `stockRun`, `oeReviewPlan`, `poleCut`, `finishRouting`, `sourcing`, `backorder`, `backorderBoard`, `splitPlan`, `repaintRun`, `repaintSource`, `paintOnly`, `woRef`, `shortId`, `scrapClose`, `stockReviewRows` |
| S3 | `PickPack/*`, `FinishingFloor/*`, `ShopFloor/*`; `functions/index.js` (`netsuiteProxy`, `nsOutboxWorker`, `onStockBuildDone`, `onMillComplete`, `authenticatePin`, the user-directory callables); `netsuite/ce_convert_build_restlet.js`; `Shared/`: `nsOutbox`, `nsWorkOrder`, `nsProxy`, `convertDiag`, `pickOrder`, `pickTabs`, `pickLines`, `committedBins`, `labelScan`, `labelPrint`, `platingPackingList`, `platingOrderPdf`, `quickShipUom`, `i18n`, `rodPieces`, `rodPieceLedger`, `RodPieceInventory`, `programPrints`, `PullLinesLive`, `WhereIsIt`, `OrderStatusChips`, `finishingTime`, `floorActivity` |
| S4 | `portal/*`; `functions/` `portal*` exports, `portalEngine.js`, `portalRequestLines.js`, `feeRulesPort.js`, `aliasIdentity.js` (functions copy); `HQ/UPSShippingCalculator.js` (9.5); the new payment and UPS functions; the new Fulfilment tab (built as ONE guarded mount inside `PickPackApp.js` — S3's file — with the module in `Shared/fulfilment*.js`, S4's) |
| S5 | `SpecSheet/*`, `system/spec_sheet_config`; `HQ/CustomerCollectionsTab.js` (4.6); `Shared/kitSeed`, `kitCode`, `customerControlFile`, `clientPricing`, `priceLevels`, `feeRules`, `itemStarterXlsx`, the onboarding xlsx export; `system/quick_ship_kits`; `HQ/GuideBuilder`, `guideCapture`; `Shared/AssetGalleryTab`, `BatchImageProcessor`, `BatchTextureProcessor` (14.x); tab 5 Marketing surfaces |
| shared, ask first | `HQ/UserGuideTab.js` (every session appends its own section; `git status --short` it before editing), `NetSuiteSyncTab.js` (11.1 — announce), `HQ.js`, `firestore.rules` (name the collection in the commit and tell the communicator it needs Cloud Shell), `CLAUDE.md` |

Where a read crosses a line (S2's split reads S1's `classifyLine`; S3 reads S2's `orderStatus.GATES`;
S5's kits feed S1's engine), the reader never edits the module. It writes what it needs into the owner's
brief under **§ Hand-offs in** and tells the communicator.

## How a hand-off travels

1. You find something in another session's file. **Stop.** Do not edit it.
2. Write a patch spec into the OWNER's brief under **§ Hand-offs in**: file:line as of today, the evidence,
   the change, the downstream trace (work orders → finishing → shop → WMS → NetSuite).
3. Append one line to your own brief's **§ Status log** ("handed X to S3, <date>").
4. The communicator reads all five briefs and `git log` every session and routes; Stuart decides order.
5. The owner lands it, announces the hash in its **§ Status log**, and strikes the entry in **§ Hand-offs in**.

`SendMessage` between sessions was retired 09-08; the briefs are the channel. Identify your session key in
every commit message: `(S2)`.

## Git and deploy, restated once

Never switch branches in the shared checkout. Stage only your files (never `git add -A`). `rm -f
.git/index.lock` → commit → `git pull --rebase --autostash origin main` → **safe-push check**
(`git log origin/main..HEAD` names every commit the push carries; `git status --short | grep -v '^??'` shows
only your files) → push. `npx --no-install eslint <file>` → 0 errors. Frontend auto-deploys on push;
functions and rules only from Cloud Shell (write the command for Stuart). Verify a deploy by sweeping
`asset-manifest.json` with `curl -sf` for an emitted plain-ASCII literal; a version stamp proves nothing with
five sessions pushing. Save-is-send in CPQ refuses on a stale bundle: every deploy costs Stuart a re-PIN —
batch pushes when he is mid-entry, and ask before pushing during a live run.

## Status (communicator updates this)

| session | state | last hash | next |
|---|---|---|---|
| S1 | started 09-10. Live pass done (BRIEF_S1 §7). **Issue 1 live** (a58d126: parked `HIDDEN-` pins no longer block the NetSuite estimate). **Issue 2 pushed** (1259391: CRM edits the checkout header without re-walking CPQ; NetSuite not updated by the edit; already-split floor docs keep their copy — named for S2/S3). Data for Stuart: H1-138JNR lacks the Unfinished tag; Brimar BL/GOP get no lead class; F2's E half NOT shipped. Next: Issue 3, one step order across the H1 flows (Rod Setup → Rod → Rod length → Ends → Bracket → Backplate → …), awaiting Stuart's confirmation of the order. | 1259391 | Issue 3 after Stuart confirms the step order |
| S2 | started 09-10. Cause of the Close-all incident confirmed in code (BRIEF_S2 §1a). **Issue 1 SHIPPED and live:** ⟲ Reopen a bulk close on Board vs Floor (dry run → confirm → write). Dry run with Stuart's hand list is next, then Issue 2 (prevention). Hand-off to S3: the WMS `reopenConfirmPick` chip. | 6c72e80 | run the reopen on the live board; then Issue 2 |
| S3 | brief written, not started | — | after S1 |
| S4 | brief written, not started | — | when Stuart opens it |
| S5 | brief written, not started | — | when Stuart opens it |

## Deploys (every session appends a row when it pushes; newest first)

| when | session | hash | what changed in production | who must re-PIN |
|---|---|---|---|---|
| 2026-09-10 10:56 | S1 | 1259391 | CRM tab 10 **Modify Quote / Job** edits the whole checkout header (ship-to, sidemark, PO, memo, need-by, notes, charge); `Shared/salesOrderHeader.jobHeaderPatchOf`; SO header rebuilt through `soHeaderOf` when the job is on the board. Docs: `jobs`, `hq_sales_orders` (header fields + `headerEditedAt/By`). NetSuite not updated by the edit. | everyone — save-is-send refuses on a stale bundle |
| 2026-09-10 10:07 | S1 | a58d126 (same deploy as 6c72e80 — S2's push carried it) | `Shared/nsTransmit` TAGS branch skips parked `HIDDEN-` geometry lines instead of refusing the estimate; `Shared/lineClassification.isParkedGeometryLine`; test `scripts/parkedGeometryLine.test.mjs`. No document/field shape change; `ns_outbox` gains the H1-138 estimates that were silently never queued. | covered by S2's row (one bundle) |
| 2026-09-10 | S2 | 9ddef72 + 553272b (carried S1 1259391) | Reopen rules corrected from the first dry run: fulfilment queued/posted = shipped (kept); hand-reopened shop halves lose the closed flag; failed NetSuite writes go back to FAILED not PENDING; per-row operator override (reopen anyway / keep closed). Row facts (packed/picked dates, last error) on the dry-run list. | everyone |
| 2026-09-10 ≈11:25 | S2 | 6c72e80 (+ S1's a58d126 carried) | RTG Board vs Floor: **⟲ Reopen a bulk close** (dry run → confirm → write); `Shared/orderLifecycle` reopen rules; guide paragraph; S3 hand-off (`reopenConfirmPick` chip). Data touched only when the reopen is confirmed: `fin_workorders`, `shop_custom_orders`, `hq_work_orders`, `hq_sales_orders`, `rod_cut_orders`, `ns_outbox`. | everyone — save-is-send refuses on a stale bundle |
