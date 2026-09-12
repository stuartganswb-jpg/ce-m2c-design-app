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
| S5 | Display program: Designer b3fd59f · Build orders d3c6777 · Seed from tracker 9f5c714 · vertical poles + flow chips db928f4 · row chooser 0a7bfa7 (all live); S1 owes `displaySnapshot` (framed capture at Add); S2 owes the snapshot Display column | 0a7bfa7 | Stuart: re-seed the tabletop, pick the H1 flow, Place the CPQ rows INTO Top Row 1 / 2; wall board; build orders |
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
| S1 | started 09-10. **Live:** a58d126 … 2b164a5 (Vision 2 ✓); 7d3f594 (discounts · QUO147 · Vision gate); e9dfc1c (tab 7 set % · money docs add up); bcb3ecb (packing list + invoice on the SO card). **Next:** Stuart's screen proof (QUO147 / QUO142 / a discounted quote / a packed order's 📦🧾); BRIEF_S1 §3 leftovers (#22, #20, #17, #47, #46, #53). | bcb3ecb | screen proof; §3 leftovers |
| S2 | started 09-10. Issue 1 DONE: reopen tool shipped (6c72e80 → 553272b), run REOPEN-1789057501646 = 52 restored / 0 failed on Stuart's list. Issue 2 (prevention) built + tested, push pending. Hand-offs out: S3 `reopenConfirmPick` chip; S1 refused-estimate stamp. Named: refused quotes invisible on RTG (S2 row queued). | 553272b | push Issue 2; then the refused-quotes row; then §3 #1 live pass |
| S3 | started 09-10. Live: f5a6c19 · e2cef1f · 47c2b6b · 1e5e5a4 · 8b2e6b1 · a8bb6a8 · 1d02231 · 6ac41ac (HQ 15 Standard boxes tool — the add-box path was a hidden prompt-driven Save; now a real section). **SO60420 plating round trip COMPLETE end to end 09-11** (`PLATING_ROUND_TRIP_SO60420.md`); every defect it found is fixed. Stuart: add CE's boxes on HQ 15 (packs cannot close without one). Pairs wait on Eric. Next: BRIEF_S3 §3 items 2–5 (the sales-typed build at pack, the rest of the live pass, C4, the ⛏ posts) as Stuart picks. | 6ac41ac | §3 #2 when Stuart picks |
| S4 | brief written, not started | — | when Stuart opens it |
| S5 | Issue 1 COMPLETE + live both halves (S5 09104cf / 105b29c, S1 38b1ba6); Stuart applied the import, tagged the flow, set the finish matrix (09-11 morning); acceptance run parked at Stuart's word | 884faba | Stuart's new ask 09-11: a management tool for the production of sales DISPLAY BOARDS — survey + requirements first, plan, wait |

## Deploys (every session appends a row when it pushes; newest first)

| when | session | hash | what changed in production | who must re-PIN |
|---|---|---|---|---|
| 2026-09-12 | S2 | eee33a3 f9affc2 43d5ea9 65fb699 | Six items: ⟲ Reopen one order; Snapshot Display column; transmit panel FAILED; no close to-do when built; `linkedDocsOf` finds SO-APP records (floorPhase now reaches CPQ orders); three writers onto the shared builders + convert hook releases stock (Route A) + Reset tells the record + PO ✎ lock. | everyone |
| 2026-09-11 | S2 | d50cce1 | Packing list / invoice SHARED HALF: `Shared/packingList` builder + `orderStatus` inProduction / packedStateOf / reopen roles. No screen change until S1 + S3 wire it. | everyone |
| 2026-09-12 17:13 | S3 | 6ac41ac | HQ 15. Packaging: a real Standard boxes section (list / add / load / delete the box sizes the WMS pack screen offers; old blind Save → Save as box). `HQ/PackagingTab.js` only; `standard_boxes` shape unchanged. | everyone — save-is-send refuses on a stale bundle |
| 2026-09-11 22:47 | S3 | 1d02231 | WMS: a pick-only order never shows the "overtaken pick" banner. Shop: Undo on a plated order refuses once the WMS holds the pieces (staged / at the plater / built). | everyone — save-is-send refuses on a stale bundle |
| 2026-09-11 22:39 | S3 | a8bb6a8 | WMS pack: French returns/miters ride the rod (pack lines by code, ticked with the pole — the packing list pairs them); a box must be chosen to complete; the plater PO memo leads with the shipment id (the 40-char cap hid PO2316); a plating order packs its ready parts early but the pole line and the close wait for the plater. | everyone — save-is-send refuses on a stale bundle |
| 2026-09-11 21:17 | S3 | 8b2e6b1 | The pole is packed by its code (pickLines pole rows carry `code`; pack workspace ticks poles; `poleLines` stamped on the finishing doc so S2's packing list finds the pole) · 🖨 Packing list on the WMS pack workspace / Recently Packed / SO Pack (same builder + form as the CRM). | everyone — save-is-send refuses on a stale bundle |
| 2026-09-11 18:35 | S3 | 1e5e5a4 | WMS Plating: the plater PO's NetSuite number — retry at Ship, honest alert + `nsPoPending`, ⟳ FIND NETSUITE PO on the Out-at-plater row (lookup → vendor's recent POs → guarded re-post), Reset never doubles a PO. Found on the SO60420 round trip (Receive was blocked). | everyone |
| 2026-09-11 19:23 | S5 | 0a7bfa7 | Display designer: Place… asks which row takes the configuration (seeded rows keep their place); prefers `displaySnapshot` (S1 hand-off pending). `system/displays/entries/*` rows gain `replacedAt`. No other write. | everyone — save-is-send refuses on a stale bundle |
| 2026-09-11 18:58 | S5 | db928f4 | Display designer: base poles stand vertical in a base band, style extras seeded, chip board = the picked CPQ flow's tagged finishes (`display.finishFlowId`; `cpq_flows` read only). `system/displays/entries/*` fields added. No other write. | everyone — save-is-send refuses on a stale bundle |
| 2026-09-11 17:46 | S1 | bcb3ecb | **Packing list + invoice on the CRM sales-order card** (S2's design): FormPreview PACKING_SLIP (ordered · shipped, ship date, tracking, red marks), card greys the four edit doors in production (manager may), 📦 / 🧾 once packed; invoice = SO prices × shipped qty with discounts pro-rated (`Shared/invoiceMath`). Reads only. | everyone — save-is-send refuses on a stale bundle |
| 2026-09-11 17:47 | S5 | 9f5c714 | 5. Marketing → **Seed from tracker**: a display created from the tracker xlsx (codes resolved against the library, preview, one `system/displays/entries` doc on Create). No other write. | everyone — save-is-send refuses on a stale bundle |
| 2026-09-11 16:51 | S1 | e9dfc1c | **Tab 7 set % at checkout** (item rates net, fees excluded; `orderDiscount` on the SO header — one field both doors via `soHeaderOf`) · **money documents keep the discount / net rows** (QUOTE / SALES_ORDER / INVOICE add up; floors unchanged) · Vision Phase 2 live-read ✓. | everyone — save-is-send refuses on a stale bundle |
| 2026-09-11 16:28 | S1 | 7d3f594 | **Discounts — the cart or the checkout, never both** (manager+ line % / net price in the CPQ cart; a set % at checkout replaces the customer's code; `orderDiscount` on the job; cart-discounted lines push at their own NetSuite rates) · QUO147 reopened splice 1→3 loop closed (`engineConfig.extras` saved; legacy rows merge) · Vision Save Line gate reads the engine (miter-return line saves). | everyone — save-is-send refuses on a stale bundle |
| 2026-09-11 15:37 | S5 | d3c6777 | **Display build orders** (5. Marketing → Build orders; one guarded mount on 10.5): display × qty × customer × SO/PO, ship plan, tracker columns, boards built → open demand. New docs `system/displays/builds/*`, `system/display_demand_<brand>`. Never writes `jobs`; no WO/floor/NetSuite write. S2 owes the snapshot "Display" column (BRIEF_S2 §6). | everyone — save-is-send refuses on a stale bundle |
| 2026-09-11 14:51 | S5 | b3fd59f (+ S2's docs-only c0f562d carried) | **Sales Display Designer on 5. Marketing** (was an empty label): tabletop / wall boards to scale, rows from the shared CPQ cart, chip face from the finish lists, computed bill × N, CSV. New docs `system/displays/entries/*`; `global_assets` gains DISPLAY CAPTURE assets; HQ.js +2 lines (lazy import + mount, cart passed). No job/WO/floor/snapshot/NetSuite write. | everyone — save-is-send refuses on a stale bundle |
| 2026-09-11 | S2 | 5ba0da3 | RTG ⇄ Quotes & Sales Orders lists REFUSED quotes (S1's stamp) with ⇄ Queue now; guide paragraph. Jobs doc only. | everyone, once pushed |
| 2026-09-11 12:25 | S3 | 47c2b6b | WMS Plating: a custom (shop-raised) plating line now carries its order links, so Receive → 'Plating Received' and put-away → sibling 'Complete' + RTG 'Plated' fire for custom orders; custom put-away posts NO NetSuite build (custom fab is not stocked inventory), short count refuses. WMS Convert: the tab scrolls again (manual add-to-cart reachable). | everyone — save-is-send refuses on a stale bundle |
| 2026-09-11 09:59 | S1 | 2b164a5 | Vision Phase 2: CPQ line → Vision board ("Vision" button on tag-engine cart lines); a Vision re-save replaces its CPQ line on Resume. `cpq_drafts` +`cartItemId`; cart lines +`visionDraftId`. | everyone — save-is-send refuses on a stale bundle |
| 2026-09-11 08:42 | S3 | e2cef1f | WMS pick queue: red "⟲ REOPENED — confirm pick state" chip (+ ✓ confirmed; cleared at pick complete) on docs RTG's bulk reopen restored with a reconstructed pick state. Shop: Undo REFUSES on a doc the closer stamped `closed: true` (names who/when/why, points at RTG). No NetSuite write. | everyone — save-is-send refuses on a stale bundle |
| 2026-09-11 08:33 | S1 | 3c0e101 | Vision Phase 1b: hardware pickers from the engine's slots on pinned flows (locks + reasons, rear ends on a double, removals strip, `specs.enginePicks` on saved lines). Old path for unpinned flows untouched. | everyone — save-is-send refuses on a stale bundle |
| 2026-09-10 23:40 | S1 | 21bea0f | Vision Phase 1a (pure): `Shared/visionEngine.js` + bridge `enginePicks` read + `endTreatment` on the choice. No screen change. | everyone — save-is-send refuses on a stale bundle |
| 2026-09-10 23:32 | S1 | b180339 | Vision Phase 0: CPQ save keeps a quote's Vision drawings (`cpq_drafts` FINALIZED, not deleted); Reopen Vision has lines to load. | everyone — save-is-send refuses on a stale bundle |
| 2026-09-10 23:04 | S1 | 26f45de | CPQ: a selection removed by a later choice is listed with its reason; Add / Checkout refuse until acknowledged (#45). `Shared/pickDrops.js`. No document/field shape change. | everyone — save-is-send refuses on a stale bundle |
| 2026-09-10 22:34 | S1 | 2c61b3e | CPQ save: a refused NetSuite queue is stamped on the job (`nsTransmitRefusedAt/Code/Message`), cleared on a later success (CPQ save or tab 12). S2's hand-off; S2's RTG row + Queue now is next on S2. Jobs doc only. | everyone — save-is-send refuses on a stale bundle |
| 2026-09-10 22:08 | S1 | 38b1ba6 | H1-138TRV kit explosion re-keyed to S5's correction: arm by depth + backplate by orientation per bracket; no combo code consumed; guard test green again. | everyone — save-is-send refuses on a stale bundle |
| 2026-09-10 20:29 | S5 | 105b29c | H1-138TRV kit import CORRECTED: Fabricut bracket codes = arm (by depth) + backplate (by orientation), read from the live pins; derived rules rows keyed to SBA/EBA/6BA/DBA + BP-H/BP-V; combo prices on the arms (/P + every /EPn, /P25), $0 plate rows; `H1_138TRV_PARTS` re-shaped (S1 guard test red until they re-key + add the plate line, spec in BRIEF_S1 §6). Re-applying the sheet verified identical for every H1-2TRV record. Nothing written until Stuart applies. | everyone — save-is-send refuses on a stale bundle |
| 2026-09-10 19:48 | S1 | bb5b5e1 | Tag engine: a backplate follows its arm (un-pick the return → its plate drops; bracket change keeps it). Portal mirror owed by S4 (fourth line). | everyone — save-is-send refuses on a stale bundle |
| 2026-09-10 19:23 | S1 | 9415338 | Kit explosion knows H1-138TRV (rod per ft, brackets by style, joiner splice, returns = fees on the end steps); CPQ + tab 7 read `traverse_rules_<family>` by kitFamily. S5's half (parser / seeder / 4.6 import) still to push; Stuart tags Kit Family on the H1-138 flow + runs the 4.6 import. | everyone — save-is-send refuses on a stale bundle |
| 2026-09-10 18:17 | S1 | 6572b6f | Tag engine: parked geometry (no item number / HIDDEN- id) never rides — no more $0 `HIDDEN-…` placeholder lines on new quotes. Portal mirror owed by S4 (third line). | everyone — save-is-send refuses on a stale bundle |
| 2026-09-10 17:46 | S5 | 09104cf | The H1-138TRV kits: `Shared/kitCode` second grammar `H1-138TRV-4(H|V)D?/(P|EP)` (`rodKind`, `bracketStyle`; `axesKeyOf` sixth field, blank on H1-2TRV); `Shared/kitSeed` answers `rodKind` as an axis when carried, reports the bracket style; 4.6 kit-sheet import reads tab H1-138TRV — on Apply writes 8 Kit records (`kitFamily: H1-138TRV`), 19 `clientPricing` rows on existing items, `system/traverse_rules_H1-138TRV` (derived from H1-2TRV usage). No existing document/field shape change; nothing written until Stuart applies. S1 owes the explosion entry + per-family rules reads (BRIEF_S1 §6) — until then an H1-138TRV kit explodes nothing. | everyone — save-is-send refuses on a stale bundle |
| 2026-09-10 17:30 | S1 | e4ab15a | Tag engine: new pin tag `ridesWith: RETURN` — a hidden rider reaches the BOM only when a return is on the order; H1-138 / H1-1 return standoffs stop riding plain doubles once tagged. `assembly_pins` gains the optional field. Portal mirror owed by S4 (with the rank change). | everyone — save-is-send refuses on a stale bundle |
| 2026-09-10 15:14 | S3 | f5a6c19 | WMS Rod Cuts & Ring Packs → RING PACKS gains **⇄ REPACK**: break N packs and build another size from the eaches in one flow (unbuild then build through the convert RESTlet already deployed; honest partial state if the build fails). `PickPackApp.js` only; no RESTlet / functions / outbox / document shape change. Pairs (2 pc → 1 pair) wait on Eric's pair item ids. | everyone — save-is-send refuses on a stale bundle |
| 2026-09-10 15:07 | S1 | bd5907e (+ ce91681 notice, which carried two of S2's doc lines) | Tag engine: ONE step order for every flow (rod → rod length → ends → bracket → backplate → rings → accessories); quote/BOM lines follow it for new quotes. No document/field shape change. Portal mirror owed by S4. | everyone — save-is-send refuses on a stale bundle |
| 2026-09-10 11:24 | S1 | 16a74bb | CRM pipeline card prints JOB · SIDEMARK · PO (display only). | everyone — save-is-send refuses on a stale bundle |
| 2026-09-10 10:56 | S1 | 1259391 | CRM tab 10 **Modify Quote / Job** edits the whole checkout header (ship-to, sidemark, PO, memo, need-by, notes, charge); `Shared/salesOrderHeader.jobHeaderPatchOf`; SO header rebuilt through `soHeaderOf` when the job is on the board. Docs: `jobs`, `hq_sales_orders` (header fields + `headerEditedAt/By`). NetSuite not updated by the edit. | everyone — save-is-send refuses on a stale bundle |
| 2026-09-10 10:07 | S1 | a58d126 (same deploy as 6c72e80 — S2's push carried it) | `Shared/nsTransmit` TAGS branch skips parked `HIDDEN-` geometry lines instead of refusing the estimate; `Shared/lineClassification.isParkedGeometryLine`; test `scripts/parkedGeometryLine.test.mjs`. No document/field shape change; `ns_outbox` gains the H1-138 estimates that were silently never queued. | covered by S2's row (one bundle) |
| 2026-09-10 | S2 | d62b682 (+ cd0902d docs) | PREVENTION of the Close-all incident: Complete ≠ done (packed is), FLOOR_DONE = whole order vs what the record knows (`floorPhase`), closer keeps `stateBeforeClose`, no Close all on FLOOR_DONE; guide updated. No writer / floor / NetSuite change. | everyone |
| 2026-09-10 | S2 | 9ddef72 + 553272b (carried S1 1259391) | Reopen rules corrected from the first dry run: fulfilment queued/posted = shipped (kept); hand-reopened shop halves lose the closed flag; failed NetSuite writes go back to FAILED not PENDING; per-row operator override (reopen anyway / keep closed). Row facts (packed/picked dates, last error) on the dry-run list. | everyone |
| 2026-09-10 ≈11:25 | S2 | 6c72e80 (+ S1's a58d126 carried) | RTG Board vs Floor: **⟲ Reopen a bulk close** (dry run → confirm → write); `Shared/orderLifecycle` reopen rules; guide paragraph; S3 hand-off (`reopenConfirmPick` chip). Data touched only when the reopen is confirmed: `fin_workorders`, `shop_custom_orders`, `hq_work_orders`, `hq_sales_orders`, `rod_cut_orders`, `ns_outbox`. | everyone — save-is-send refuses on a stale bundle |
