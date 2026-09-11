# Brief S2 — RTG Dispatch · work-order and purchase-order creation (the control spine)

*Written 2026-09-10 by the communicator session. You are the FIRST session to start. Read, in order:
`CLAUDE.md` (the working agreement binds you), `SESSION_COMMS_2026-09-10.md` (the map and the hand-off
protocol), `STATE_OF_THE_APP_2026-09-10.md` (the state; your items are §2.1 #1–7, §2.2 #9–16, §2.3, §2.4
#31–41, #55–56), then `RTG_CONTROL_BRIEF.md`, `BRIEF_WO_PO_SPINE.md`, `BRIEF_REPAINT_JFP_JOINT.md` and
`WORK_ORDER_CONTRACT.md` for the rules as they now stand. `BRIEF_A_HANDOFF.md` and `BRIEF_B_HANDOFF.md` are the
commit-by-commit history — read them for why, not for the current state.*

## ⛔ Working agreement + standing rules

Plan first and WAIT, every time. Requested scope only — adjacent problems get NAMED in this brief, never
fixed in passing. No temporary fixes. Trace every change through work orders → finishing → shop → WMS →
NetSuite and say so in the plan. **One issue at a time.** S1–S5 from the top of `BRIEF_A_WO_PO_CREATION.md`
(tags before code · the guide moves with the code · everything auto-routes and RTG records everything · BOTH
always asks · POs open, accumulate, then send). Plus: **every order via RTG, always**; **a decision and a
silence are different things**; **a gate must be liftable**; **the recoverable answer is the default**.

## 0. Operating

- **⚡ Auto-release is ON** (Stuart, 2026-09-10). The engine runs only while an RTG tab is open — that
  limitation is one of your items (§3 #11–12).
- **Stuart's live orders are the test vehicles.** He is entering quotes for one customer today and turning
  them into sales orders. Every acceptance run below uses those orders. Do not raise a test order of your
  own; ask him which order to watch.
- Pin-in: Stuart drives Claude-in-Chrome on his tab (`tabs_context_mcp` first, `find` → ref, never
  credentials; Factory Portal + PLM PIN are his to type). Get-page-text beats screenshots on the heavy HQ tab.
- Deploy-verify: RTG's board JSX is a lazy chunk; `orderStatus` / `workOrderContract` strings sit in main via
  PickPack. Sweep the whole `asset-manifest.json`. StockViewTab and LibraryTab are lazy chunks.
- Node suites for your modules: `orderStatus`, `orderLifecycle`, `stockRun`, `splitPlan`, `backorder`,
  `backorderBoard`, `poLock`, `repaintSource`, `woodRouting`, `stockReviewRows`, `orderRoute` — run bare
  (never `| tail` inside `set -e`), or `sh scripts/run-traverse-tests.sh` for everything.

## 1. THE IMMEDIATE PROBLEM — "Close all" on Board vs Floor closed live orders

**Stuart, 2026-09-10, verbatim:** *"the RTG this morning i hit the button to close All on the board vs. floor
as there were a lot of orders that it stated were closed on the floor but open on the board. when i did that
it worked, but it also closed a lot of orders that were still open on the floor, either still in packing,
still in finishing, etc. so one i need to reopen some of these orders to see them thru, but more importantly
we need to understand why it did this, clearly our sync where RTG is in control and see's everything was
off."*

Two deliverables, in this order: **(a) understand why** and stop it recurring; **(b) reopen the orders** that
were still live, without guessing their state. Nothing else in this brief comes before these.

### 1a. The cause, as read in the code this morning (communicator; verify before you act on it)

The button is `reconcileAll` (`RTGDispatchTab.js` ~2195–2225), offered on every finding type except
`NS_CLOSE_TODO / DEMAND_ORPHAN / RODCUT_ORPHAN / STRANDED_GATE / NS_POSTED_AFTER_CLOSE` — so it is offered on
**`FLOOR_DONE`** ("Finished on the floor, still live here"). For each finding it calls
`closeOrderEverywhere` on the parent record with `from: 'RTG_RECONCILE_ALL'`, `reason: <finding type>`.

`FLOOR_DONE` is raised by `Shared/orderLifecycle.auditOrphans` (`:304`) whenever ONE floor doc reads
`isDoneState` and its parent record does not. `isDoneState(d)` (`:47`) is true for a fin doc at
`currentPhase === 'Complete'`, a doc with `packStatus === 'Packed'`, or a shop doc with `status === 'Completed'`.
Three ways that catches an order still being worked:

1. **"Still in packing."** A finishing doc goes `currentPhase 'Complete'` when it leaves the paint line
   (`ActiveFloor.js:402`), *before* the WMS packs and puts it away. "Complete" on the fin doc means "off the
   finishing floor", not "order done" — but the audit reads it as done. Likewise `packStatus 'Packed'` is set
   at pack (`PickPackApp.js:1833`), before put-away / shipment.
2. **Pick-only orders are born "Complete".** Since B5 part 2 (aacf078, 09-08) the split writes a pick-only
   floor doc with `currentPhase: "Complete", pickOnly: true` (`RTGDispatchTab.js:1306`) for every all-plated or
   custom-only sales order — so every such order reads `FLOOR_DONE` from the moment it is created, while the
   WMS is still picking it.
3. **"Still in finishing."** The audit runs over shop docs too. A CPQ order whose custom half finished
   (`shop_custom_orders.status === 'Completed'`) while its small parts are still in Painting raises
   `FLOOR_DONE` on the SHOP doc; "Close all" then closes the whole order — the finishing sibling in Painting
   included — because the closer walks every linked doc.

**Why the sync looked "off" when it was not.** The floor DOES tell the record: `propagateFloorState` stamps
`floorPhase` on the hq record at every completion. But `isDoneState(parent)` never reads `floorPhase` — it
reads `currentPhase / status / packStatus / closed`, fields the hq record does not carry in those forms. So the
audit cannot see the propagation the record already holds, and flags the order as "board doesn't know" even
when the board knows exactly. The record was right; the audit's test was wrong, and the bulk button trusted
the audit.

### 1b. What "Close all" did to each order (the blast radius — `closeOrderEverywhere`, `orderLifecycle.js:154`)

- every linked `fin_workorders` doc → `currentPhase 'Closed', stepStatus 'Closed', status 'Closed',
  sentToPickPack: false, pickStatus 'Closed'` — **it vanished from the WMS pick/pack queues and the finishing
  floor**; the previous `currentPhase` / `pickStatus` values are OVERWRITTEN (not kept);
- every linked `shop_custom_orders` doc → `status 'Completed', closed: true`;
- the hq record → `status 'Closed'`;
- **every OPEN `rod_cut_orders` for the order → `CANCELLED`** ("the cut was still open; no inventory moved");
- **every PENDING/FAILED `ns_outbox` entry whose writeBack names the order's docs → `CANCELLED`** (a queued
  assembly build for a packed order, a Route A work order, a fulfilment); in-flight ones flagged
  `postedForClosedOrder`;
- where a NetSuite WO was open: `nsWoCloseRequired: true` on the record → the panel now shows an
  `NS_CLOSE_TODO` for each ("close it in NetSuite by hand").
- Every touched doc carries the fingerprint: `closedFrom: 'RTG_RECONCILE_ALL'`, `closeReason: 'FLOOR_DONE'`
  (or `'FLOOR_CLOSED'`), `closedAt` = this morning, `closedBy` = Stuart. **That fingerprint is the recovery
  list.** The Daily Job Log holds "⇄ Bulk close: n/N…" lines but not per-order ids.

### 1c. What to tell Stuart NOW (before any code)

- **Do not press "✓ Closed in NetSuite" on the new `NS_CLOSE_TODO` rows and do not close those work orders in
  NetSuite** — they belong to live orders.
- **Do not Retry or Cancel anything in 11.1 → NetSuite Sync Queue yet.** The CANCELLED entries stamped this
  morning are part of the recovery (11.1 offers ↻ Retry on CANCELLED, `NetSuiteSyncTab.js:1644`; use it only
  after the order is reopened, or a build posts for a closed record).
- The rod cuts cancelled this morning are still physically wanted; the saw must not treat the tab as truth
  until they are reopened.

### 1d. The plan to propose (two issues, in this order — plan, then WAIT)

**Issue 1 — Reopen (an in-app admin tool; App Check forbids scripts).** On the Board vs Floor panel, a
"⟲ Reopen the 2026-09-10 bulk close" action that: lists every `fin_workorders` / `shop_custom_orders` /
`hq_work_orders` / `hq_sales_orders` doc with `closedFrom === 'RTG_RECONCILE_ALL'` in this morning's window,
**dry run first** (the list, per doc: what is still on it — `completedAt`, `packStatus/packedAt`, `putawayBin`,
`tasks.*` statuses, `pickedAt/stagedAt`, `shopSiblingId/hasCustomSibling`, `customFabStatus`); then, on
approval, restores each from what is still on the doc — never a guess: a fin doc with `putawayBin` / shipped →
leave closed (it WAS done); with `packStatus 'Packed'` → `currentPhase 'Complete'`, pack state as stamped;
with `completedAt` and no pack → `currentPhase 'Complete'`, `sentToPickPack: true`, `pickStatus` back to
the pre-close value if it can be read from `hq_logs`, else `'Pending'` with a red "REOPENED — confirm pick
state" chip the WMS shows; with `tasks.*` partly done and no `completedAt` → `currentPhase 'Painting'` at the
recorded step; the shop doc → `status` from `startedAt/completedAt` (`'In Process'` or `'Completed'`),
`closed` removed; the hq record → `status 'Dispatched'`, `nsWoCloseRequired` removed; cancelled rod cuts with
this order's reason → `OPEN`; `ns_outbox` entries cancelled with this order's reason → `PENDING` (the worker
picks up PENDING; marker recovery prevents a double post). Every reopened doc stamped `reopenedAt/By/From`
and the ledger written. Downstream trace: finishing sees its jobs back in the Setup Queue / Active Floor at
the recorded step; the shop sees Completed customs stay Completed and in-process ones return; the WMS sees
the picks and packs return with a chip that says they were reopened; NetSuite gets the queued writes it was
owed and no close tasks. Ask Stuart which orders he already reopened by hand so the tool skips them.

**Issue 2 — Prevention.** (i) `FLOOR_DONE` is never bulk-closable — remove it from the "Close all" set (a
finished-on-the-floor order is closed by PUT-AWAY / SHIPMENT, or by a person one at a time); (ii) the audit
compares the floor to what the record already knows: `isDoneState(parent)` reads `floorPhase` (`Complete /
Packed / Shelved / Plated`) as done, so a propagated completion is not an orphan; (iii) `FLOOR_DONE` requires
the WHOLE order done (every linked doc), not one doc — a Completed shop half beside a Painting fin doc is
normal work, not a finding; (iv) pick-only docs (`pickOnly: true`) are never "done" until packed and put
away; (v) the closer keeps the previous `currentPhase / pickStatus / sentToPickPack` in a `closedFrom*`
snapshot so a reopen never has to infer again. Node-test every rule in `scripts/orderLifecycle.test.mjs`
(the fixtures: a Complete fin doc unpacked; a pick-only doc; a Completed shop half with a Painting sibling;
a propagated `floorPhase 'Complete'` parent). Then the guide's "Close and Delete mean the same everywhere"
paragraph says what Close all does and does not touch.

**Hand-off to S3 after Issue 1:** the WMS should show the "REOPENED" chip and refuse nothing; the finishing
floor's Setup Queue reads the restored phase. S3 verifies both on their tablets.

## 2. Territory

**Own:** `HQ/RTGDispatchTab.js`, `StockViewTab.js`, `LibraryTab.js` (WO/PO/repaint paths only), `LibraryMassUpdateTab.js`
(4.5); `Shared/workOrderCreate`, `floorRelease`, `orderStatus`, `orderLifecycle`, `workOrderContract`, `orderHold`,
`purchaseOrders`, `poLock`, `platingDemand`, `finishedRunPrecheck`, `finishedGoodsRun`, `stockRun`, `oeReviewPlan`,
`poleCut`, `finishRouting`, `sourcing`, `backorder`, `backorderBoard`, `splitPlan`, `repaintRun`, `repaintSource`,
`paintOnly`, `woRef`, `shortId`, `scrapClose`, `stockReviewRows`.

**Read-only:** S1's (`CPQTab`, `QuickShipTab`, `ExternalCoopTab`, `nsTransmit`, `salesOrderHeader`,
`lineClassification`, `hardwareHandoff`); S3's (`PickPack/*`, `FinishingFloor/*` — **including `SetupQueue.js`**,
`ShopFloor/*`, `functions/`, `nsOutbox`, `nsWorkOrder`); S4's, S5's. The Setup Queue re-make (§3 #16) is
therefore a patch spec to S3, not your edit.

## 3. The work, in order (after §1)

Numbers are `STATE_OF_THE_APP_2026-09-10.md` §2 item numbers.

**Proof first**
1. **#1 the live pass on Stuart's orders** — for each of his sales orders: the record on the board from
   creation, the split (stock first for plated lines, pick-only doc when nothing needs spraying, BACKORDER
   chip when short, the floor doc ON HOLD when the flag is off), the chip words, the release through the
   right door, the Route A anchor on a stock WO, the closer on one you delete. Screenshot each state; note
   anything the chip does not explain.
2. **#5 repaint from each door** (Master Library, then the Snapshot row) — the writer moved files after the
   Library tool was tested.
3. **#6** hand Stuart the Firestore console step for `rootBuildAuto` when three clean ⛏ posts are in.

**Hand-offs that never landed — all in your files, all small**
4. **#9** `releaseFinWoToFloor` writes through `buildFinDoc` (`finishedRunPrecheck.js:334`). Behaviour identical
   for what it stamps today; the sales release gains urgent / holds / needBy; never both streams.
5. **#10** `executeMakeupActions` shop write through `buildShopDoc` (`:271`).
6. **#11** `clearConvertGate` stock branch → `releaseStockWoToFloor` (`:377`); the spec is in
   `BRIEF_A_WO_PO_CREATION.md` "Hand-off from B — clearConvertGate's STOCK branch".
7. **#13** `resetWoToSetup` → `propagateFloorState` (`StockViewTab.js:1762`); spec in the same file.
8. **#15** the RTG PO line editor: `if (poLinesLocked(e.po)) return alert(poLockMessage(e.po));` and hide ✎ on a
   locked card (`RTGDispatchTab.js` ~:163–190). `Shared/poLock` has 13 assertions already.
9. **#16** → patch spec to S3: retire the Setup Queue "⟲ Create Re-make WO" for stock (`SetupQueue.js:686`,
   writer at `:525`); the guide's honest-matrix row goes with it. Custom re-issue stays RTG's (`INTENT.REISSUE`).
10. **#12** → patch spec to S3: the WMS rod-cut completion calls `releaseStockWoToFloor` (spec already in
    `BRIEF_D_WMS.md` "the rod-cut / convert completions RELEASE a stock order"). After #6 and #12 land, the RTG
    tab is the safety net, not the mechanism — say so in `RTG_CONTROL_BRIEF.md` §1, which currently claims it.

**Owned, not blocked**
- **NEW 2026-09-10 · refused quotes on RTG.** Every order via RTG includes a quote whose NetSuite estimate was REFUSED at save (ST091026-01 today): list it in the ⇄ Quotes & Sales Orders panel in red with the refusal code/message and a "⇄ Queue now" button (calls S1's `queueNsTransaction`; the job filter at `RTGDispatchTab.js:148` gains `|| j.nsTransmitRefusedAt`). Depends on S1 stamping the refusal (their § Hand-offs in). Also named for S1: tab 12 never lists a CONFIGURED quote although the save alert points there.
11. **#31** delete the legacy enrich branch after a week of zero (from 09-09; the Stock Builds panel title counts).
12. **#32** delete the Setup Queue outsourced group once observed empty — S3's file; you confirm "empty", S3 deletes.
13. **#37** the Stock View "📋 Open POs" twin — ask Stuart first (STATE §3 Q10 recommends deferring).
14. **#39** `stockCheckReport` unknown-as-zero — a proposal to Stuart, never a silent change.
15. **#40** the receiving-tab receipt shape (per-line `receivedAt/By`, a short/over field that is not
    `scrapQty`) — settle with S3, who owns the tab that reads it; you own the writer.
16. **#41** A6 leftovers (identity/display suffix reads) — only when a commit already touches the line.
17. **#55** the three `BRAND_NETSUITE_MAP` copies → import `Shared/brandNetsuite` in `StockViewTab` and `LibraryTab`
    (S1 owns that module; the import is yours). Then correct the CLAUDE.md bullet.
18. **#56** verify the Library run stamps `poles/totalPoles` through `buildStockFinPayload`; if not, the guide's
    "poles released from the Master Library run as small parts" edge is still true and stays.

**Waiting on Stuart (relay through the communicator)**
- #24 tag `material = WOOD` on `H1-138WHTOAK-*` (4.5) — the wood rule is live and dormant until then.
- #25 `HCUMSBF15` in-house tag; clear `WO-HCUMSBF15-N25-655308-4`; close / re-issue WO11588 (pull 7674).
- #26 close the two 14-Aug Order Entry orders in NetSuite.

## 4. Acceptance — on Stuart's orders, pinned in

| run | expect |
|---|---|
| a CPQ order with a plated small line, short | BACKORDER chip; row on Stock View 📋 Backorders; floor doc on hold; flag Finish as available → hold releases, engine takes the siblings |
| an all-plated CPQ order | pick-only doc; nothing in the Setup Queue; WMS picks and packs |
| a custom-only CPQ order | pack document exists; shop Complete & Label plated → 'Sent to Plating' → pack refuses → WMS receipt → 'Complete' → pack allows (S3 watches the receipt) |
| a stock order deleted on RTG | closer line names the rod cut cancelled and any queued NetSuite write |
| a cancelled PO behind a receipt gate | Board vs Floor shows the stranded gate → ⬆ Lift → parked, not released → override from View |
| a straight wood rod / a mitered one | finishing / shop (once #24 is tagged) |
| a WMS rod-cut completion with NO RTG tab open (after #12) | Setup Queue shows the order within seconds; 11.1 shows its WO |

## 5. Questions for Stuart (ask through the communicator or in-session; both count)

1. §1 — the problem, in the shape above.
2. STATE §3 Q3 — delete the Setup Queue re-make now (S3's file, one commit)? Recommended yes.
3. STATE §3 Q7 — the four A-side hand-offs as one issue, four commits? Recommended yes.
4. STATE §3 Q10 — the Open POs twin: still wanted? Recommended defer.
5. STATE §3 Q14 — when does he read the legacy-release count and the outsourced group as empty?

## 6. Hand-offs in

- **⚠ DEPLOY NOTICE from S1 · 2026-09-11 · 3c0e101 pushed at 08:33 EDT.** Hard-refresh + re-PIN before your next save.
  What shipped (Vision Phase 1b): on a flow with a pinned assembly, Vision Hardware's hardware pickers (ends, brackets,
  plates; rear ends on a double) come from the engine's slots with the engine's locks and reasons; a saved line carries
  `specs.enginePicks`; Push to CPQ waits for acknowledged removals. Flows without pins: unchanged. `cpq_drafts` gains the
  optional `specs.enginePicks` array. Board / placement / cut sheet / engineeringNotes shape unchanged. Your side: nothing — `engineeringNotes` and the split's inputs are unchanged.

- **⚠ DEPLOY NOTICE from S1 · 2026-09-10 · 21bea0f pushed at 23:40 EDT.** Hard-refresh + re-PIN before your next save.
  What shipped (Vision Phase 1a, the pure half): `Shared/visionEngine.js` (pickers from the engine's slots), the bridge reads
  `specs.enginePicks`, and the adapter / engine carry the pin's `endTreatment` on the choice (additive; no rule reads it).
  NOTHING on any screen changes yet — Vision Hardware still reads the old steps; the mount is Phase 1b. Your side: nothing.

- **⚠ DEPLOY NOTICE from S1 · 2026-09-10 · b180339 pushed at 23:32 EDT (S1 sweeps the served bundle after the deploy
  and records it in BRIEF_S1 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped (Vision Phase 0): CPQ's
  save no longer deletes a quote's Vision drawings — `cpq_drafts` docs with `spatialData` are kept and marked
  `status: 'FINALIZED'` (+ `finalizedJobId/At/By`); pending-line readers exclude them; Vision's "Load saved line…" lists
  them. So CRM → Reopen Vision on a saved quote has its lines again. Jobs / floors / NetSuite untouched. Your side: nothing.

- **⚠ DEPLOY NOTICE from S1 · 2026-09-10 · 26f45de pushed at 23:04 EDT (S1 sweeps the served bundle after the deploy
  and records it in BRIEF_S1 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped: CPQ (tag engine
  configurator) — a selection a later choice removes is listed in a strip under the step rail with the engine's reason,
  and **+ Add configuration / Checkout refuse until each is acknowledged** (BRIEF_S1 #45, Stuart: "never a silent
  clear"). New pure reader `Shared/pickDrops.js`. Nothing leaves the configurator differently; no document or field
  shape change. Your side: nothing.

- **⚠ DEPLOY NOTICE from S1 · 2026-09-10 · 2c61b3e pushed at 22:34 EDT (S1 sweeps the served bundle after the deploy
  and records it in BRIEF_S1 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped: a REFUSED NetSuite
  queue at CPQ save is stamped on the `jobs` doc — `nsTransmitRefusedAt` (ms), `nsTransmitRefusedCode`,
  `nsTransmitRefusedMessage` (≤500 chars) — in both save branches and the catch; a later successful queue (CPQ save or
  tab 12 push) removes all three with `deleteField()` in the write that stamps `nsTransmitQueuedAt`. Jobs document only;
  no floor document, no NetSuite write. Your side: this is your hand-off, landed with your field names verbatim — list `nsTransmitRefusedAt` jobs in the ⇄ Quotes & Sales Orders panel with the code / message and a "Queue now" that calls `Shared/nsTransmit.queueNsTransaction` (same args CPQ's save uses: `{ job, asType, brand, data, ctx, by, writeBacks }`) and, on `res.ok`, writes `{ nsTransmitQueuedAt, nsTransmitOutboxId, nsTransmitRefusedAt: deleteField(), …Code: deleteField(), …Message: deleteField() }`. `data` = `{ libraryParts, cpqFlows, outsourceFinishes, globalFinishes }` — the same parts universe CPQ prices from (libraryParts + liveAssemblies, deduped by id), else the joiner-rollup class of miss returns.

- **⚠ DEPLOY NOTICE from S1 · 2026-09-10 · 38b1ba6 pushed at 22:08 EDT (S1 sweeps the served bundle after the deploy
  and records it in BRIEF_S1 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped: the H1-138TRV kit
  explosion re-keyed to S5's correction — an ARM by depth (SBA/EBA/6BA/DBA/CBA) plus a BACKPLATE by orientation
  (BP-H/BP-V/BP-C) per bracket position, both at the chart count; no sheet combo code is ever consumed. H1-2TRV
  unchanged. No document or field shape change. Your side: nothing.

- **⚠ DEPLOY NOTICE from S5 · 2026-09-10 · 105b29c pushed at 20:29 EDT (S5 sweeps every served asset after the
  deploy and records it in BRIEF_S5 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped: the
  H1-138TRV kit import corrected — Fabricut's "bracket" codes are arm + backplate here (the H1-138 pins carry arms
  SBA/EBA/6BA/DBA/CBA by depth and plates BP-H/BP-V/BP-C by orientation); the derived `system/traverse_rules_H1-138TRV`
  now keys those codes (a plate row per orientation, "one per bracket"); the 18 combo prices land on the arms' Fabricut
  rows (/P and every /EPn + /P25 that exists) with $0 plate rows; `H1_138TRV_PARTS` export re-shaped (`brackets.SINGLE`
  by depth, DOUBLE/CEILING strings, new `plates`). Verified first that re-applying the sheet rewrites every H1-2TRV kit
  and component row identical. No existing document or field shape changed; nothing written until Stuart applies. Your side: nothing — no spine field changes.

- **⚠ DEPLOY NOTICE from S1 · 2026-09-10 · bb5b5e1 pushed at 19:48 EDT (S1 sweeps the served bundle after the deploy
  and records it in BRIEF_S1 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped: tag engine —
  **a backplate follows its arm**: un-picking the return (or any arm) at a position drops the plate chosen for it
  instead of re-seating it under a bracket nobody has chosen; changing bracket still keeps the plate. No document or
  field shape change. Your side: nothing — a plate with no arm never reached the BOM.

- **⚠ DEPLOY NOTICE from S1 · 2026-09-10 · 9415338 pushed at 19:23 EDT (S1 sweeps the served bundle after the deploy
  and records it in BRIEF_S1 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped (S5's kit hand-off,
  S1's half): the kit explosion knows the **H1-138TRV** family (rod as the one per-foot part, brackets by style H/V,
  joiner as the splice, returns stay the fee items on the end steps); CPQ and tab 7 read `system/traverse_rules_<family>`
  from the flow's / kit's `kitFamily` instead of the fixed H1-2TRV document. H1-2TRV explodes exactly as before.
  No document or field shape change; the H1-138TRV rules document is S5's importer's to write. Your side: nothing until an H1-138TRV kit is ordered — then its exploded components reach the board like H1-2TRV's.

- **⚠ DEPLOY NOTICE from S1 · 2026-09-10 · 6572b6f pushed at 18:17 EDT (S1 sweeps the served bundle after the deploy
  and records it in BRIEF_S1 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped: tag engine —
  **parked geometry never rides**: a pin with no item number (`parked`, or a `HIDDEN-<node>` id) is no longer a rider, so
  new quotes lose their $0 `HIDDEN-…` placeholder breakdown lines. Real hidden parts with an item ride as before. No
  document or field shape change. Your side: nothing — the split never picked those lines.

- **⚠ DEPLOY NOTICE from S5 · 2026-09-10 · 09104cf pushed at 17:45 EDT (S5 sweeps every served asset after the
  deploy and records it in BRIEF_S5 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped: the
  H1-138TRV kits — `Shared/kitCode` reads a second grammar `H1-138TRV-4(H|V)D?/(P|EP)` (a parsed align now may carry
  `rodKind` and `bracketStyle`; `axesKeyOf` gained a sixth field, blank on every H1-2TRV kit); `Shared/kitSeed`
  answers `rodKind` as an axis when the kit carries it (H1-2TRV kits do not — untouched) and reports the bracket
  style; the 4.6 kit-sheet import reads tab H1-138TRV and writes, on Apply, 8 `Approved_Designs` Kit records
  (`kitFamily: H1-138TRV`), 19 `clientPricing` rows on existing bracket/splice items, and `system/traverse_rules_H1-138TRV`
  (derived from the H1-2TRV usage table). No document or field shape changed for existing records; nothing is
  written until Stuart applies the import. Your side: nothing — no work order, gate or spine field changes; a tab-7 H1-138TRV order will reach the board as any QUICKSHIP order does.

- **⚠ DEPLOY NOTICE from S1 · 2026-09-10 · e4ab15a pushed at 17:30 EDT (S1 sweeps the served bundle after the deploy
  and records it in BRIEF_S1 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped: a new pin tag
  **`ridesWith: RETURN`** (1.6 tag row, beside "hide": rides the rod / rides a return) — a hidden rider so tagged reaches
  the BOM only when a miter or French return is chosen on the order AND its rod is on the order (never a single). Built
  for the H1-138 standoffs of the short rear rod (`1.6 #72 / 1.5 #68`); H1-1's `#31/#32` get the same. Untagged
  riders unchanged. Docs: `assembly_pins` gains the optional field `ridesWith`. Your side: nothing — the BOM simply no longer lists those standoffs on a plain double.

- **⚠ DEPLOY NOTICE from S3 · 2026-09-10 · f5a6c19 pushed at 15:14 EDT (S3 sweeps every served asset after the
  deploy and records it in BRIEF_S3 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped: WMS →
  Rod Cuts & Ring Packs → RING PACKS gains **⇄ REPACK** — break N packs and build another size from the eaches in one
  flow (5 × /BL-12 → 60 × /BL-EA → 6 × /BL-10, remainder stays loose in the each bin). Two NetSuite records through the
  convert RESTlet already deployed (unbuild, then build); a build failure after the unbuild is reported as an honest
  partial state. `PickPackApp.js` only — no RESTlet, functions, outbox, document or field shape change; pack SKUs are
  shelf stock nothing on the spine reads. Your side: nothing.

- **⚠ DEPLOY NOTICE from S1 · 2026-09-10 · bd5907e pushed at 15:07 EDT (S1 sweeps the served bundle after the deploy
  and records it in BRIEF_S1 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped: the tag
  engine's step order is ONE order for every flow — Rod Setup → Rod → Rod length → Ends (front L, R, then rear)
  → Bracket → Backplate → Rings → Accessories (`Shared/hardwareModel` rank; `HardwareConfigurator` length step).
  Consequence you may notice: the BOM / quote lines follow the slot order, so a NEW quote lists the rod first,
  then ends, brackets, plates, rings — identities, quantities and prices unchanged; older quotes keep the order
  they were saved with. No document or field shape changed. Your side: the split reads the same lines in a different order; nothing to do. ⚠ Also from S1: my notice commit ce91681 (15:07) staged two of YOUR uncommitted doc lines (BRIEF_S2 §7 and your board row for d62b682) because they were in the tree — they are on main under my message, unchanged in content. Sorry; stage-only-mine was the rule and I broke it.

- **⚠ DEPLOY NOTICE from S1 · 2026-09-10 · 16a74bb pushed at 11:24 EDT (S1 sweeps the served bundle after the deploy
  and records it in BRIEF_S1 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped: the CRM
  pipeline card (Quotes + Sales Orders windows on a customer) prints JOB · SIDEMARK · PO rows. Display only —
  no document or field changed. Your side: nothing.

- **⚠ DEPLOY NOTICE from S1 · 2026-09-10 · 1259391 pushed at 10:56 EDT (S1 sweeps the served bundle after the
  deploy and records it in BRIEF_S1 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped:
  the CRM (tab 10) **Modify Quote / Job** modal now edits the whole checkout header — order sidemark, PO #,
  internal memo, need-by, production notes, ship-to (saved NetSuite address or custom drop-ship), shipping
  charge — through `Shared/salesOrderHeader.jobHeaderPatchOf` (the field set CPQ's finalize writes). Docs it
  touches: `jobs` (those header fields + `headerEditedAt/By`); `hq_sales_orders/SO-APP-<quoteNo>` when it
  exists and is not QUICKSHIP — header rebuilt through `soHeaderOf` (`sidemark, customerPo, internalMemo,
  needBy` + aliases, `productionNotes, shipTo[], shippingMethod/AddressId, customShippingAddress,
  shippingAmount, memo` + `headerEditedAt/By`; `readyDate`, recipe, `status`, `createdBy` untouched). NetSuite
  is NOT updated by the edit. Your side: the board reads the edited header live; a fin/shop doc already split keeps the sidemark / need-by it was split with — no re-stamp built, named for you.

- **⚠ DEPLOY NOTICE from S1 · 2026-09-10 · a58d126 is LIVE (verified in the served `main.d8130142.js`; it
  rode S2's 10:07 deploy).** What shipped: `Shared/nsTransmit`'s TAGS branch now SKIPS a parked-geometry line
  (partId `HIDDEN-<node>`, no money) instead of refusing the whole transaction as LINES_UNRESOLVED; the
  predicate is `Shared/lineClassification.isParkedGeometryLine` (11-assertion harness). Effect: every H1-138
  quote (and Sinaya's Thom Filicia quotes) had silently failed to queue its NetSuite estimate since 21 Aug —
  from this bundle on, a CPQ save queues it. No Firestore document or field changed shape; `ns_outbox` simply
  gains the estimate entries it was missing. Your side: nothing in RTG / the split changes; a quote's `jobs` doc still stamps `nsTransmitQueuedAt` only when the queue succeeds, so an older H1-138 quote stays unqueued until it is re-saved. Re-PIN is the one S2's deploy already required.

*(other sessions append patch specs here; strike when landed)*

## 7. Status log

*(newest first; one line per commit or decision, with the hash)*

- 2026-09-10 · **Issue 2 SHIPPED — d62b682** (pushed on Stuart's "push", carried only S2's cd0902d): `isDoneState` — Complete is off the paint line, not done (packed / put away / Completed / Built / closed are); `recordKnowsDone` reads `floorPhase`; `auditOrphans` FLOOR_DONE = once per record, every floor doc done, record does not know (`floors[]`); `closeOrderEverywhere` stamps `stateBeforeClose`; `reopenPlanFor` restores from it exactly; RTG: FLOOR_DONE never bulk-closable, copy + guide say so. 91 assertions; full runner green; build clean. Expect Board vs Floor's "Finished on the floor · 14" to vanish on deploy.
- 2026-09-10 · **REOPEN RUN DONE — REOPEN-1789057501646, 52 restored, 0 failed** (Stuart pressed it on the armed tab). Verified on the board: SO60147/60158/60168/60169 back at Setup Queue + WMS picked; SO60166/60239 Painting; SO60170 finished/off the floor + WMS picked; SO60151/60152 (his override) Complete + packed, fulfilment entries back to FAILED; WO11596/11599 Complete + WMS picked. Kept closed by his word: the twelve July/August packed orders, SO59288, WO11473. Board vs Floor now 164: **"Finished on the floor · 14" is the reopened docs being flagged AGAIN by the same wrong test — nobody presses Close all until Issue 2 lands.** NS_CLOSE_TODO 148 → 146.
- 2026-09-10 · ST091026-01 investigated, nothing pushed: refused at save as LINES_UNRESOLVED (S1's HIDDEN- parked-geometry finding, fixed a58d126, live 10:07); -02/-03/-04 saved after the fix posted (QUO142–144). Fix for -01 = Reopen CPQ → save again. **Gap named:** a refused quote is invisible on RTG (In/Out panel filters on queued/estimate/SO) and on tab 12 (CONFIGURED never listed). Handed the job stamp to S1; the RTG "refused quotes · Queue now" row is mine, queued behind Issue 2.
- 2026-09-10 · **Stuart's decision on the packed orders:** SO59051, SO59176, SO59592, SO59618, SO59619, SO59620, SO59727, SO59728, SO59754, SO59789, SO60104, SO60105 stay CLOSED ("run during the troubled period in the app"); **SO60151 and SO60152 reopen.** Built as a per-row operator override on the dry-run list (`planBulkReopen({ overrides })`, `reopenOverride` stamped on the doc; 76 assertions); pushed as **553272b** with 9ddef72 on his "you can push" (carried S1's 1259391).
- 2026-09-10 · First live dry run (88 restore · 286 keep · 6 skip) caught three rule gaps BEFORE any write: packed sales orders with the fulfilment queued/posted (= shipped) were listed to restore; Livio's six hand-reopened shop halves were skipped although the bulk close's `closed: true` still hides them (the shop's Reopen never clears that flag — named to S3); failed NetSuite writes were going back to PENDING (a retry) instead of FAILED. Fixed in `reopenPlanFor` (71 assertions), panel + guide copy updated; second push pending Stuart's go.
- 2026-09-10 · **6c72e80** (pushed on Stuart's "push", carried S1's a58d126 with it) · Issue 1: `Shared/orderLifecycle` gains `reopenPlanFor` / `planBulkReopen` / `applyBulkReopen` (pure rules, 66 assertions green); RTG Board vs Floor gains **⟲ Reopen a bulk close** (dry run → confirm → write, ledgered as `BULK_CLOSE_REOPEN`). Handed the WMS `reopenConfirmPick` chip to S3 (their § Hand-offs in). Issue 2 (prevention: FLOOR_DONE never bulk-closable, parent reads `floorPhase`, whole-order test, pick-only never done until packed, closer snapshots the pre-close state) is next; until it lands "Close all" on FLOOR_DONE stays a trap — the panel copy says so.
- 2026-09-10 · Stuart: none of this morning's closed orders were reopened by hand; **go on Issue 1** (the reopen tool, dry run first, restore from stamps only). He holds a hand list of statuses to check the result against. Live read before the plan: bulk close ran ≈08:31 (the one outbox entry it cancelled: NS Fulfillment WO-SO60152, 08:31:06); 148 NS_CLOSE_TODO rows raised, 0 FLOOR_DONE left, 4 FLOOR_CLOSED (SO59732/SO59752) untouched by this issue. Named, not fixed: the closer raises NS_CLOSE_TODO off the hq record's nsWoId without reading nsWoCompletionPosted (WO11529/11588/11593/11594 already built).

## 8. Opener (paste to start the session)

```
You are the S2 session — RTG Dispatch · work-order and purchase-order creation (the control spine). Read,
in order: CLAUDE.md (the working agreement binds you), SESSION_COMMS_2026-09-10.md (the map, the file
ownership, the hand-off protocol — briefs are the channel, SendMessage is gone), STATE_OF_THE_APP_2026-09-10.md
(the state; your items are named in BRIEF_S2 §3), BRIEF_S2_RTG_WO_PO.md (your brief), then
RTG_CONTROL_BRIEF.md, BRIEF_WO_PO_SPINE.md, BRIEF_REPAINT_JFP_JOINT.md and WORK_ORDER_CONTRACT.md for the rules
as they stand. Standing rules S1–S5 (top of BRIEF_A_WO_PO_CREATION.md) bind you. ⚡ Auto-release is ON.
Stuart's live customer orders are the round-trip tests — never raise your own. Four other sessions work this
repo: S1 (CPQ/Vision/CRM — owns the sales doors and the engine), S3 (WMS/Finishing/Shop — owns SetupQueue.js
and every NetSuite inventory write), S4 (portal/payments/UPS), S5 (spec sheets/kits/marketing). When your
work crosses a line: stop, write a patch spec into THEIR brief's § Hand-offs in, log it in your § Status log.
Git: never switch branches, stage only your files, pull --rebase --autostash, safe-push check, eslint 0
errors, verify by marker sweep of asset-manifest.json. Plan first and wait — every time. One issue at a time.
First: ask Stuart to state the immediate problem in the shape of BRIEF_S2 §1, read the record on the board
and the Transmit Log, then plan. Identify as "(S2)" in every commit.
```
