# Brief S2 — RTG Dispatch · work-order and purchase-order creation (the control spine)

*Written 2026-09-10 by the communicator session. You are the FIRST session to start. Read, in order:
`CLAUDE.md` (the working agreement binds you), `SESSION_COMMS_2026-09-10.md` (the map and the hand-off
protocol), `STATE_OF_THE_APP_2026-09-10.md` (the state; your items are §2.1 #1–7, §2.2 #9–16, §2.3, §2.4
#31–41, #55–56), then `RTG_CONTROL_BRIEF.md`, `BRIEF_WO_PO_SPINE.md`, `BRIEF_REPAINT_JFP_JOINT.md` and
`WORK_ORDER_CONTRACT.md` for the rules as they now stand. `BRIEF_A_HANDOFF.md` and `BRIEF_B_HANDOFF.md` are the
commit-by-commit history — read them for why, not for the current state.*

## ⛔ CLOSE-OUT ORDER — Stuart, 2026-09-12 (read before anything else)

Stuart: *"prompt all that we are going to close out now … make sure they are all aware to watch out for each
other and confirm what we are doing so we get closure and can work on new functions."* No new function starts
in this session until the list below is done and confirmed. Full picture: `SESSION_COMMS_2026-09-10.md` § Close-out.

**Stuart's decision on S3's finding (a), verbatim, 2026-09-12:** *"the pole with french return or miter return or
straight pole anything pole for po to plater is always just the # of feet 1 pole x 8ft = 8 billable feet."*
So: a shop doc's `qty` for a pole is the number of POLES (pieces), never the number of custom lines; the plating
demand / staged line / plater PO for a pole bills **feet = poles × length** (1 pole × 8 ft = 8 billable feet); a
French return or a miter is fabrication on the rod and adds nothing to the count or the feet. S2 fixes the split's
shop-doc `qty` (pieces) and what the demand carries; S3 owns the plater PO line (feet) — spec it into BRIEF_S3 §6.

**S2's close-out list**
1. The pole rule above: split `qty` = poles; the plating demand carries poles + feet; hand S3 the PO-line half.
2. #31 the legacy enrich branch — delete on 09-16 if the panel still reads zero (Stuart's word on the day).
3. The acceptance table (§4) on Stuart's live orders, the rows not yet run: backorder chip + Finish as available;
   an all-plated order (pick-only doc); Delete → closer line; a stranded gate → ⬆ Lift; a straight and a mitered
   wood rod (the rods are tagged now).
4. Job-log wording (S3's finding (c)): a Pending shop doc says "fabricating", a pick-only doc says "FINISHED off
   the floor", the SO card says only SENT TO FLOOR while the row says "At the plater" — one honest vocabulary.
5. Confirm `HCUMSBF15`'s in-house tag with Stuart and close #25.

**Watch out for each other** (the rules that were broken three times this week): before EVERY commit run
`git log origin/main..HEAD` and ABORT if it prints anything (a local commit of yours rides the next session's
push; a local commit of theirs rides yours); `git diff --cached --stat` must list only your files; never push
while another session is mid-live-run (ask on the board's Status row); S3 is now editing `SetupQueue.js`
(re-make retire, outsourced group) — you read it, do not touch it; every push still gets a deploy notice in the
other four briefs.

**Confirm** by appending to § 7 Status log, before starting: `CLOSE-OUT CONFIRMED 2026-09-12: items …, in this
order, ETA …`; and when done: `CLOSE-OUT DONE: <hashes>`. The communicator collects the five confirmations.

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
13. ~~**#37** the Stock View "📋 Open POs" twin~~ — DROPPED by Stuart 2026-09-12.
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

- **⚠ DEPLOY NOTICE from S1 · 2026-09-12 · cce9f96 pushed at 19:18 EDT (S1 swept every served asset after the deploy: version stamp 1789255307636; `NO_NS_FORM_FOR_BRAND` + tab 7's `Not queued` in `main.da41a424.js` (nsTransmit + the engine) and `238.44f4e810.chunk.js` (tab 7); recorded in BRIEF_S1 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped: **(1) Vision's brackets follow the projection** — the engine's `normalizeChoice` is now idempotent (a normalized row re-normalized kept nothing of its depths: Vision hands `visionPickers` rows it already normalized for its axis questions, CPQ hands raw rows — 1,037 live H1-138 rows lost `projs`, 170 their tiered pair, `fitsExplicit` flipped on 1,354). One function in `Shared/hardwareModel`; Vision's files unchanged; every caller now gets the same answer once or twice. **(2) ONE NetSuite header for both doors** (E3 / STATE #22, Stuart: option 1): `Shared/nsHeader.nsTransactionHeader` — entity, subsidiary / location, the brand's custom form + class from the NEW `Shared/brandNetsuite.BRAND_NETSUITE_FORMS` (CE = quote 299 / SO 177 / class 2), memo, PO, internal memo, app job id, shipping (saved or custom; a charge rides with the ONE cached `resolveShipMethod`). **A brand with no form + class on file (M2C / Uniquity / Leyla today) REFUSES to queue with `NO_NS_FORM_FOR_BRAND`** — never a default form — until Eric's ids are entered in that map (one row per brand, no code). CPQ's push refuses through `buildNsTransaction` (RTG lists it in red via the refused stamp, Queue now works once the ids land); tab 7 refuses BEFORE writing anything (alert + log); tab 7's private ship-method lookup is gone. (3) Close-out item 1: the line-discount resolver suite registers its own loader, so the runner's plain `node --test` loads it. Tests: nsHeader 24 (new), hardwareModel 694 (+9), visionEngine 30 (+3), the resolver suite 18 (+3: CE header + M2C refusal end to end). Pushed from a detached worktree so S2's unpushed docs commit stayed local (the carry trap, closed). Your side: **RTG's ⇄ Queue now** calls `queueNsTransaction` → the same builder: a non-CE job now comes back `NO_NS_FORM_FOR_BRAND` and your red row shows that code + message (the refused stamp is S1's, as before). Nothing to build. Your local 6048b10 (now 05c19d2 after the rebase) is still UNPUSHED in the shared checkout — yours to push.

- **⚠ DEPLOY NOTICE from S1 · 2026-09-12 · 4d09ce3 pushed at 17:27 EDT (S1 swept every served asset after the deploy: version stamp 1789248651987; the capturer's `asSet` key in `main.ac1c21f5.js` (both the capturer and the two Add sites live in main); recorded in BRIEF_S1 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped: **Add to cart captures the 3D pane AS THE OPERATOR LEFT IT** — both engines, one capture for the whole CPQ (Stuart 09-11: "however we set the image when we hit add to cart you should capture that view"). The shared `ViewCapturer` takes `{ current: true }` (no re-framing; the same white-ground ≤900px JPEG the quote / SO documents print); the tag-engine Add configuration and the old engine's add-to-cart both use it — old-engine lines carried no picture until now. The 📷 Capture Views packet pair (framed front + back) is unchanged. Cart-line field `renderSnapshot` only; documents print it; floors and NetSuite never read it; the saved job does not grow. **⚠ The push also CARRIED S2's local commit 60af70a** (brand → NetSuite map: StockViewTab / LibraryTab import `Shared/brandNetsuite`, CLAUDE.md) — it was committed-but-unpushed in the shared checkout; nothing of S2's was edited. Your side: **your 60af70a is live** at this stamp (carried, see above) — sweep it yourself if you want your own marker on record. Nothing else.

- **⚠ DEPLOY NOTICE from S3 · 2026-09-12 · 6ac41ac pushed 17:13 EDT (S3 sweeps and records in BRIEF_S3 §7).** Hard-refresh
  (⌘⇧R) + re-PIN before your next save. HQ → 15. Packaging (`HQ/PackagingTab.js`, no other file) gains a real **Standard
  boxes** section: list of the active brand's boxes (name, W×H×D, brand, SMALL PARTS tag) with Load-to-workspace and delete,
  and an add form (name, W, H, D, brand-only / all brands, small-parts tick); the old blind "Save" next to "Load Standard…"
  is now "Save as box" (fills the form from the workspace). Same `standard_boxes` record shape the WMS pack screen already
  reads, so nothing changes on the pack side; the WMS refusal "add them in HQ → 15. Packaging → Standard boxes" now points
  at a section that exists. Nothing reaches RTG, the floors or NetSuite. Your side: nothing.

- **⚠ DEPLOY NOTICE from S3 · 2026-09-11 · 1d02231 pushed 22:47 EDT (S3 sweeps and records in BRIEF_S3 §7).** Hard-refresh
  (⌘⇧R) + re-PIN before your next save. The last two defects from the SO60420 run: (1) WMS pick queue — `isOvertakenPick`
  no longer reads a pick-only document's born-`Complete` phase as "already in production" (no red banner / CLEAR on a
  pick-only order); (2) Shop floor — Undo on a plated order refuses once the WMS holds the pieces (staged → the WMS removes
  the line first; shipped/received → receive them back; built → past undo), because the demand is already fulfilled at
  scan-in and there was nothing to cancel. `cancelPlatingDemand` (S2) unchanged. Your side: nothing.

- **⚠ DEPLOY NOTICE from S3 · 2026-09-11 · a8bb6a8 pushed 22:39 EDT (S3 sweeps and records in BRIEF_S3 §7).** Hard-refresh
  (⌘⇧R) + re-PIN before your next save. Four of Stuart's decisions from the SO60420 run, all in `PickPackApp.js` +
  `Shared/pickLines.js`: (1) **French returns / miters ride the rod** — a shop custom line with no cut length is a
  fabrication on the pole (`poleDetailsOf` → `riders` on the first pole row; `packLinesOf` emits them as pack lines by code,
  `rider: true`, ticked and cleared with the pole's tick, shown as a note under it) — **S2: your packing list now pairs
  `H1-FRPF` etc. with their ordered lines through the same `packedLines` ticks; no builder change.** (2) **A box is a
  choice**: Complete refuses until the small-parts box and (with pole lines) the pole box are chosen — boxes live in HQ →
  15. Packaging → standard boxes; CE's list is EMPTY today (Stuart adds). (3) **The plater PO memo leads with the
  shipment id**: `nsMemo` caps at 40 chars and cut the old memo, which is why the lookup never found PO2316; the lookup also
  matches the old cut shape. (4) **A plating order packs its ready parts early** (Stuart's rule); the pole line reads "At
  the plater" and cannot be ticked, the "no poles" waiver is hidden, Complete refuses until `customPartsReady`. Your side:
  nothing.

- **⚠ DEPLOY NOTICE from S3 · 2026-09-11 · TWO pushes: 1e5e5a4 (18:35 EDT, swept live) and 8b2e6b1 (21:17 EDT; S3
  sweeps and records in BRIEF_S3 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. Found on the SO60420 plating
  round trip (`PLATING_ROUND_TRIP_SO60420.md`). **1e5e5a4** — WMS Plating: the plater PO's NetSuite number. The PO POST comes
  back without the id and the one immediate SuiteQL lookup by memo found nothing, so the shipment carried `nsPoId: null` and
  Receive refused. Now Ship retries the lookup over 10 s, a shipment still without a number carries `nsPoPending` and says so,
  the Out-at-plater row has ⟳ FIND NETSUITE PO (memo lookup → the vendor's last-3-days POs to pick from → only when both are
  empty a guarded re-post through the same builders), admin Reset refuses when a number is on file. **8b2e6b1** — (1) why
  every Brimar packing list read NOT PACKED on the pole: `Shared/packingList` pairs ORDERED with PACKED by item code, and
  the finishing document had no pole line by code (the pole rides the shop order). `Shared/pickLines.poleDetailsOf` rows now
  carry `code`; `packLinesOf(job, { poleRows })` emits POLE-i lines by code from the live shop-sibling rows or from
  `poleLines` the pack stamps on the finishing document; the pack workspace lists the poles as tickable lines, a tick
  writes `packedLines.<key>.qty`, the first pole tick and pack completion stamp `poleLines`. **S2: no change to your
  builder — it now finds the pole by code on documents packed from here on; documents packed before today keep reading
  NOT PACKED on the pole (no `poleLines`).** (2) 🖨 Packing list on the WMS pack workspace, Recently Packed rows and the SO
  Pack card — the same `packingListOf` + `FormPreview` the CRM prints (S1: FormPreview/printForm/customerDocLines imported,
  not edited; a CPQ order's lines read from `jobs/<quoteId>` at print time). Your side: nothing.

- **From S3, 2026-09-11 — three board-side findings from the SO60420 plating round trip** (`PLATING_ROUND_TRIP_SO60420.md`
  §10): (a) the split's shop doc `qty` is 3 = the three custom LINES (rod + 2 French returns), and that count reached the
  shop card ("Qty 3"), the plating demand ("3 pcs"), the staged line and the plater PO ("3 × H1-1R @ 10.00") for ONE bent
  rod — what should a shop doc's qty mean, and what should the plater be billed on? (b) the plating PO card on the RTG PO
  panel offers ✎ EDIT PO after it left us (`poLinesLocked`, STATE §2.2 #15). (c) wording: the Daily Job Log row says
  `SHOP · fabricating` for a Pending shop doc and `FINISHING · FINISHED off the floor` for a pick-only doc; the SO card
  reads only `SENT TO FLOOR` while the job-log row carries "At the plater". Not built; yours to decide.

- **⚠ DEPLOY NOTICE from S5 · 2026-09-11 · 0a7bfa7 pushed at 19:23 EDT (S5 sweeps by chunk-hash match, recorded in BRIEF_S5 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped: 5. Marketing designer — Place… asks which row takes a cart configuration (a seeded row keeps its place and takes the CPQ lines + picture) and the picture prefers a cart line's `displaySnapshot` when present (S1: your hand-off in BRIEF_S1 §6 — the framed capture at Add configuration). `system/displays/entries/*` rows gain `replacedAt` / `config.replacedSeed`. No other document, no work order, no NetSuite write. Your side: nothing.

- **⚠ DEPLOY NOTICE from S5 · 2026-09-11 · db928f4 pushed at 18:58 EDT (S5 sweeps by matching the served chunk hash to the local build, then markers; recorded in BRIEF_S5 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped: 5. Marketing display designer — rows carry an `orientation` (vertical base poles stand in a base band on the tabletop's front face), a display carries `finishFlowId` (its chip board = that CPQ flow's tagged finishes, read from `cpq_flows` the way BOMTab's onboarding export reads them — read only), style extras seeded. Docs touched: `system/displays/entries/*` gain `finishFlowId`, rows gain `orientation`, faces gain `baseIn`. No other document, no work order, no NetSuite write. Your side: nothing.

- **⚠ DEPLOY NOTICE from S1 · 2026-09-11 · bcb3ecb pushed at 17:46 EDT (S1 swept every served asset after the deploy: version stamp 1789163433314; `Packing list — what was ordered beside what was packed` in `535.1c343f7c.chunk.js` (CRM), `differ` packing table in `483.f0343b5c / 872.3eec0dbf / 920.7102c967 chunks + main.aa8796bd.js` (FormPreview); recorded in BRIEF_S1 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped: **the PACKING LIST and the INVOICE on the CRM sales-order card** (S2's design, Stuart approved 09-11; S2's `Shared/packingList` + `Shared/orderStatus` halves, S1's form + card). (1) `Shared/FormPreview` PACKING_SLIP with `data.packing` renders the SAME header as the sales order plus SHIP DATE / TRACKING (— until UPS), columns Item · Description · Finish · Qty ordered · Qty shipped, no money, a red ● + status word on any line ≠ MATCH and a footer 'n lines differ from the order'; without `data.packing` it renders as before. (2) The CRM sales-order card reads the order's `hq_sales_orders` record (new per-customer listener, `customerId`; `SO-APP-<quoteNo>` or `hqJobId`): `inProduction` greys Modify / Reopen CPQ / Reopen Vision / Reopen Order Entry with 'in production since <date> — a manager can reopen', enabled for `canReopenInProduction(role)` (the CRM's OE_MANAGER_ROLES is now S2's `CAN_REOPEN_IN_PRODUCTION` — one list); when `packedStateOf(so, finDocs).packed` the card gains **📦 Packing list** and **🧾 Invoice**. (3) The Docs modal renders PACKING_SLIP (ordered = `customerDocLines(breakdown, 'PACKING_SLIP')` minus `isKit` parents; packed = the order's `fin_workorders`, or the SO doc for an Order Entry order — its row gains 📦 too) and INVOICE = the money reader's lines through `Shared/invoiceMath.invoiceDocOf`: nothing short → the invoice IS the order (+ shipping); something short/over → items at shipped $, every discount row pro-rated by shipped÷ordered goods, net-line subtotals dropped, fees in full, and the document's header line says so. Reads only — no job, floor doc or NetSuite write; the greying changes nothing on the floors. Your side: **your hand-off is built.** Two things for your builder: (a) a CPQ traverse KIT row carries qty + money but is the priced PARENT of its `inKit` components — I filter `isKit` out of `ordered` on my side; please skip `isKit` in `isPhysicalLine` too so the WMS print agrees; (b) `packedStateOf(so, docs)` is called with `so = { status: job.status }` when a CPQ order has no `hq_sales_orders` record yet (older orders) — it falls through to the docs, as your non-QUICKSHIP branch does. The card's lock reads `so.dispatchedAt` for the date. **⚠ My push CARRIED your local commit d50cce1** (the shared half: `packingList.js`, `orderStatus.js`, the harness, your BRIEF_S2/S3 doc lines) — it was sitting committed-but-unpushed in the shared checkout and rode `git push` with mine (the commit-carry trap, now live at the same stamp). Nothing of yours was edited.

- **⚠ DEPLOY NOTICE from S5 · 2026-09-11 · 9f5c714 pushed at 17:47 EDT (S5 sweeps every served asset after the deploy and records it in BRIEF_S5 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped: 5. Marketing → Designs gains **⬆ Seed from tracker** — reads a display tracker workbook, resolves item codes against `Approved_Designs` (read only, chunked `in` queries), previews, and on Create writes ONE `system/displays/entries/{id}` document. No other document, no work order, no NetSuite write. Your side: nothing.

- **⚠ DEPLOY NOTICE from S1 · 2026-09-11 · e9dfc1c pushed at 16:51 EDT (S1 swept every served asset after the deploy: version stamp 1789160062006; `item prices above are net of it` in `main.5a35f100.js` (tab 7), Shared/lineClassification ships inside the same `main.5a35f100.js` (its change carries no new string literal — the tab-7 literal in that bundle is the same commit), CRM print in `967.8c7b9ed6.chunk.js`; recorded in BRIEF_S1 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped: **(1) TAB 7 gets the set % at checkout** — `Order discount %` beside PO / sidemark; applied to every item line's RATE (kits and traverse footage included, fees excluded), rounded to cents per line, BEFORE the percentage fees — so the cart, the quote's breakdown, the invoice and the NetSuite lines are one sum by construction (no rollup, no discount line: NetSuite receives the net rates). It rides `quickShipExtras.soExtras.orderDiscountPercent` (edit / reopen restore it typed), the jobs quote doc and the `hq_sales_orders` header carry `orderDiscount { mode: ORDER_PERCENT | NONE, percent, by }` — the SAME field CPQ stamps (LINES / ORDER_PERCENT / CODE / NONE), now written by `soHeaderOf` for BOTH doors. The breakdown / invoiceLines gain one $0 display row saying the prices are net of it. **(2) MONEY DOCUMENTS ADD UP** — `Shared/lineClassification.customerDocLines` keeps the `isDiscount` / `isNetLine` rows on QUOTE / SALES_ORDER / INVOICE (they were dropped with the size echoes since 632569a, so a discounted quote printed gross lines and a smaller total with nothing saying why); the floors, WORK_ORDER, FULL_PACKET and every no-docType caller are unchanged. `reResolve` never renames a money row. Also live-read ✓ today: Vision Phase 2 round trip (CPQ line → Vision → re-save → Resume → Add REPLACES the line; draft deleted, nothing saved). Your side: **your SALES_ORDER print on RTG goes through `customerDocLines` too** — a discounted order's document now shows the discount / net rows (amount column, no qty / unit). That is the intended fix (the paper adds up); if your renderer prints qty/unit for every row, treat `isDiscount` / `isNetLine` as the CRM does (qty '', price null, net bold). Nothing else.

- **⚠ DEPLOY NOTICE from S1 · 2026-09-11 · 7d3f594 pushed at 16:28 EDT (S1 swept every served asset after the deploy: version stamp 1789158660457, `Line discounts are applied in the cart` + `Line discounts from the cart` in `main.74cee60a.js`, Vision chunk `104.74c087bc.chunk.js`; recorded in BRIEF_S1 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped: **(1) DISCOUNTS, the cart or the checkout, never both** — Stuart's redesign of S5's order-level ask: in the CPQ cart a manager or higher (admin / superadmin / manager / executive) ticks lines and applies a % off or sets a net unit price (`Shared/lineDiscount`, gross unit price never overwritten); at checkout a set % replaces the customer's code for the order. The job header stamps `orderDiscount { mode: LINES | ORDER_PERCENT | CODE | NONE, percent, code, by }`; cart items may carry `lineDiscount`; breakdown rows are `isDiscount` / `isNetLine` (+ `isLineDiscount`) — every floor consumer already skips them via `isDisplayOnlyLine`. NetSuite: a cart-discounted line pushes at its OWN lower rates (`nsTransmit` per-item `netFactor`), the set % / code ride the whole-quote scale as before; the Transmit Log names the mode. **(2) QUO147 'one splice shows 3'** — a reopen rebuilt hand-added extras from breakdown rows by doc id and the length step auto-added its joiner by code, one more per cycle; now `engineConfig.extras` is saved as typed and a legacy line reopens merged one row per item (`Shared/extrasRestore`). **(3) QUO142 in Vision 'keeps asking for a bracket'** — the Save Line gate now reads the engine's own left bracket picker (`visionEngine.engineEndSettled`): a return / inside mount that locks it counts as settled. `cpqData.totalPrice` stays the one net number. Work orders / finishing / shop / WMS / Sales Snapshot untouched. Your side: RTG's ⇄ panel reads `cpqData.totalPrice` (net) and the Transmit Log now shows a `Line discounts from the cart…` / `Order discount N% set at checkout…` / `Customer discount code…` info line on a discounted quote — nothing to build.

- **⚠ DEPLOY NOTICE from S5 · 2026-09-11 · d3c6777 pushed at 15:37 EDT (S5 sweeps every served asset after the deploy and records it in BRIEF_S5 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped: **display BUILD ORDERS** — on 5. Marketing (Designs | Build orders toggle) and as ONE guarded mount at the top of 10.5 Project Mgmt: a display × qty × customer × SO/PO, ship plan, the tracker's per-line columns (WO#, at plater, notes, done), boards built → open demand. Writes `system/displays/builds/{id}` and `system/display_demand_<brand>` (new; the open demand per item, recomputed on every save/delete). **Never writes `jobs`** (a build there would be a phantom quote on the CRM / RTG / tab 12). No work order, floor document or NetSuite write. Your side: the "Display" column hand-off is in your §6 (From S5 2026-09-11) with the record shape — I will tell you when Stuart's first order has populated `display_demand_CE` so you can read a real doc.

- ~~LANDED 43d5ea9~~ **From S5, 2026-09-11 — a "Display" demand column on the Sales Snapshot (Stuart's ask; your file `StockViewTab.js`).**
  Why: sales display boards (50 tabletops + 35 wall boards in flight, 100 more ordered) pull far more product than day-to-day
  orders, the NetSuite SO for a display order is a lump-sum display item, so `committed` never shows it, and the boards are
  built and shipped over time. **The record (mine, live from b3fd59f's follow-up push):** `system/display_demand_<brandId>`
  = `{ byItem: { "<billedId or code>|<finishCode>": { code, billedId, partId, finishCode, name, perFoot, qty, feet, chip?,
  builds: [{ id, name, qty }] } }, openBoards, builds: [{ id, name, open }], brandId, updatedAt, updatedBy }`, rewritten by
  the build-order panel on every save/delete from ALL open orders of the brand: qty = boards still to build × per-board
  quantity, feet likewise for rod lines, lines the operator ticked "done" excluded, orders COMPLETE/CANCELLED excluded.
  `billedId` is the finished SKU CPQ billed (H1-1BR/EP4) when the line had one; `code` is the base `legacyErpId` — match a
  snapshot row on `billedId` first, then `code` + finish through your variant rollup. Chip demand is keyed `CHIP|<finish>`
  (a sample-chip run, not an item) — list it or skip it, your call. **Ask:** one column "Display" beside Committed /
  Backorder showing the open display demand for the row (hover: the build orders behind it), and include it in the
  Rec / cover-demand math the way backorder is (`StockViewTab.js:628–656`) so the reorder suggestion sees a 50-board pull.
  Read-only on your side; the doc is small (one per brand). Downstream: the Rec figure may rise; nothing dispatches by
  itself. I will confirm the doc is live and populated (Stuart's first order) before you build.

- **From S5, 2026-09-11 14:51: my push b3fd59f CARRIED your local docs-only commit c0f562d** ("5ba0da3 stamped into the notices, the board and the S2 status log") — it had sat unpushed for 10+ minutes and my safe-push gate refused to leave it stranded again. Documents only; nothing of yours deployed unverified. Named here so your next `git log origin/main..HEAD` does not surprise you.

- **⚠ DEPLOY NOTICE from S5 · 2026-09-11 · b3fd59f pushed at 14:51 EDT (S5 sweeps every served asset after the deploy and records it in BRIEF_S5 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped: **5. Marketing is no longer an empty label — the Sales Display Designer** (Stuart's new ask, 09-11): design a tabletop or wall display to scale, rows taken from the SHARED CPQ cart (HQ.js passes `globalCart` to the new tab — the cart is read, never changed), the chip face laid out from `system/master_finishes` + `hq_outsource_finishes`, the bill of one board computed (`Shared/displayBom`). Writes: `system/displays/entries/{id}` (new, under the system rule — no rules deploy) and `global_assets` docs with `productType: DISPLAY CAPTURE` / `displayCapture: true` (`saveGuideCapture` gained a `kind`; guide captures unchanged). No job, work order, floor document, snapshot or NetSuite write. The push also carried S2's docs-only c0f562d (a notice stamp for 5ba0da3, already live) — it had sat unpushed 10+ minutes. Your side: nothing today; the NEXT S5 issue publishes a per-item "display demand" record from build orders and asks you for a Display column on the Sales Snapshot — spec to follow in your §6 once the record shape is settled.

- **⚠ DEPLOY NOTICE from S3 · 2026-09-11 · 47c2b6b pushed at 12:25 EDT (S3 sweeps every served asset after the deploy
  and records it in BRIEF_S3 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped: (1) WMS Plating —
  the OB scan-in (a custom demand from the shop) now copies `finSiblingId / orderKey / soAppId / shopOrderId` onto the
  `plating_shipments` line as the stock pull does, so Receive stamps `floorPhase 'Plating Received'` and put-away mirrors
  `customFabStatus 'Complete'` + `floorPhase 'Plated'` (D1) for custom lines — before, neither ever fired and a plated custom
  order read "At the plater" forever. Put-away on a `custom: true` line posts NO NetSuite build/adjustment (custom fab is not
  stocked inventory; the plater PO + item receipt are the record), stamps `nsBuildSkipped: 'custom-fab'`, tells the order,
  commits to its bin; a short count REFUSES. (2) WMS Convert — the tab scrolls again (the column no longer pins to the
  viewport; the raw-item list keeps a 70vh scroller). No writer changed; RTG reads the same `floorPhase` vocabulary. Your side: nothing.

- **⚠ DEPLOY NOTICE from S1 · 2026-09-11 · 2b164a5 pushed at 09:59 EDT.** Hard-refresh + re-PIN before your next save.
  What shipped (Vision Phase 2): CPQ cart lines on the tag engine gain a **Vision** button (line → draft on the board);
  a Vision re-save of a line CPQ already holds REPLACES that line on Resume instead of adding one. `cpq_drafts` gains
  optional `cartItemId` / `openedFromCpqAt` (status `DRAFT_FROM_CPQ`); cart lines gain `visionDraftId`. Jobs / floors /
  NetSuite untouched until a re-finalize. Your side: nothing.

- **⚠ DEPLOY NOTICE from S3 · 2026-09-11 · e2cef1f pushed at 08:42 EDT (S3 sweeps every served asset after the deploy
  and records it in BRIEF_S3 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped: (1) WMS pick queue —
  a finishing doc RTG's bulk reopen restored with a reconstructed pick state (`reopenConfirmPick: true`) shows a red
  "⟲ REOPENED — confirm pick state" chip on its queue row and the active pick header, with ✓ confirmed; completing the
  pick clears it too (`reopenConfirmPick: false, reopenConfirmedBy/At`); refuses nothing. (2) Shop floor — Undo on a doc
  the closer stamped `closed: true` now REFUSES, naming who/when/why and pointing at RTG (before: status went back to In
  Process with the closed flag left, so the card vanished). No NetSuite write; no shape change beyond the three confirm
  fields S2 specified. Your side: nothing.

- ~~LANDED 65fb699~~ **From S3, 2026-09-11 — a per-order reopen on RTG is yours if wanted.** Your two hand-offs landed in e2cef1f (the
  `reopenConfirmPick` chip; the shop Undo). On the shop side I chose REFUSAL over clearing the flag: a shop reopen of a
  closed doc would leave RTG's record `Closed` while the card said `In Process` (a fork of the spine), so `ShopFloor.js
  undoComplete` now refuses on `order.closed` and tells the operator to ask RTG. Consequence: RTG has no per-order reopen
  today — only the bulk-window tool (`loadBulkReopen`, `RTGDispatchTab.js` ~2223). If a single wrongly-closed order needs
  reopening outside a bulk window, that is a "⟲ Reopen" on the closed card, restoring from `stateBeforeClose` through the
  same `reopenPlanFor` rules (the `closedFrom` filter widened from `RTG_RECONCILE_ALL` to any close). Downstream trace:
  identical to the bulk reopen per document. Not built; yours to decide.

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

- **CLOSE-OUT DONE (1 + 4): $H** · items 5 / 3 / 2 wait on Stuart's word, his next live session, and 09-16. Detail: (1) `Shared/splitPlan.customShopQtyOf` — the split's shop doc `qty` = POLES (cut-length lines), `poles / feet / billableFeet (ceil) / riderLines` stamped; PO-line half handed to S3 (§6 of their brief). Assumption stated: billable feet round UP. The Order Entry custom pair is the next place to stamp the same (named, not done). (4) `orderStatusOf`: a Pending custom half reads RELEASED · not started (fabricating only once In Process); a pick-only doc reads NOT NEEDED · pick only — no finishing (new STAGES.NONE, rank 50); the RTG SO card adds "· custom: <customFabLabel>" from its fin doc. Item 5 (#25 HCUMSBF15 in-house tag) — Stuart's word still owed; item 3 (§4 rows) at his next live session; item 2 on 09-16.
- **CLOSE-OUT CONFIRMED 2026-09-12:** items 1 (pole feet rule: split qty = poles, demand carries poles + feet, PO-line half to S3), 4 (job-log wording), 5 (#25 tag — Stuart's word), then 3 (the §4 acceptance rows, Stuart pinned in), 2 (#31 waits for 09-16). In this order. ETA: 1 + 4 tonight; 5 on Stuart's answer; 3 at his next live session. Also DONE by Stuart today: `system/wms_config.rootBuildAuto.ce = true` (the root-build switch is ON for CE).
- 2026-09-12 · **Stuart's close-out answers:** repaint from the Snapshot row = DONE (the 10 Sep WO-RPT runs were his); Q3 re-make retire = YES and #32 outsourced group = YES → relayed to S3 (their § Hand-offs in); #31 legacy branch = WAIT (the agreed week); #37 Open POs twin = DROPPED; #39 unknown-as-unknown = YES (built, $H); #40 receipt shape = handed to S3; #24 wood rods = tagged (closed); #26 the two 14-Aug Fabricut orders are CLOSED on the CRM — my "Awaiting dispatch" read was the job log's fallback label for a record with no floor stages, not a status (closed); #3 rootBuildAuto = walkthrough given (count the ⛏ builds in NetSuite by memo "Mill build", then `system/wms_config.rootBuildAuto.ce = true`).
- 2026-09-12 · Close-out scan (Stuart: "close out all remaining"): **#55 DONE** (StockViewTab + LibraryTab import `Shared/brandNetsuite`; one definition left in src; CLAUDE.md bullet corrected — hash below). **#56 VERIFIED, stays**: `LibraryTab` stamps no `poles/totalPoles`, so the guide's "poles released from the Master Library run as small parts" edge is still true. **#25 partly closed by events**: WO11588 was built (ASSYB10408) and `WO-HCUMSBF15-N25-655308-4` is no longer on the board; the in-house tag on HCUMSBF15 is Stuart's to confirm. **#26 still open in the app**: QS-1786738589252 / QS-1786734991717 read "Awaiting dispatch" in the job log — close in NetSuite AND from the CRM card. **#16/#32** are S3's file (re-make button still at `SetupQueue.js:434`; outsourced group at `:594`) — Stuart's decision relayed below. **#31** legacy count reads 0 since 09-09 — deletion is Stuart's call before the agreed week. Repaint from the Snapshot: two WO-RPT runs (HWMMB35/N66, HSMBF1/N66, 10 Sep 07:19) reached the board and the Setup Queue; the writer stamps no door — Stuart to confirm they came from the Snapshot row.
- 2026-09-12 · **Six items shipped on Stuart's "do 1 thru 6 build and push":** eee33a3 (linkedDocsOf finds SO-APP records by soId/hqJobId → floorPhase reaches CPQ orders at last; no NS_CLOSE_TODO when the build posted; planOrderReopen), f9affc2 (releaseFinWoToFloor→buildFinDoc, makeup shop job→buildShopDoc, clearConvertGate stock→releaseStockWoToFloor), 43d5ea9 (Display column + Rec; resetWoToSetup→propagateFloorState), 65fb699 (⟲ Reopen one on Board vs Floor + BOARD_CLOSED rows; transmit panel FAILED/CANCELLED; PO ✎ on poLinesLocked; guide). 101 lifecycle assertions; full runner green except S1's nsTransmitLineDiscount (their extensionless import — named to S1). §3 items #9 #10 #11 #13 #15 DONE; #12 stays S3's. S3's per-order-reopen hand-off: LANDED.
- 2026-09-11 · **Packing list + invoice (Stuart's design, "go"):** decisions — in production = RTG dispatch of a SALES ORDER (never a quote); the packer scans/counts into the box, poles as PIECES; the app generates its own invoice = SO items and prices × packing-slip qty. S2 built the shared half (**d50cce1**, pushed on Stuart's "push"): `Shared/packingList.js` (`packingListOf`, `invoiceLinesOf`, `packedQtyOf`; ordered ⇄ packed by item code; SHORT/OVER/NOT_PACKED/NOT_ORDERED flagged, never hidden) + `Shared/orderStatus` `inProduction`, `packedStateOf`, `CAN_REOPEN_IN_PRODUCTION`; 31 assertions. Hand-offs written: S1 (form columns + ship date/tracking, CRM card greying w/ manager override, Packing list + Invoice buttons), S3 (per-line packed qty on the tick, SO Pack print button). UPS tracking lands in the same `tracking` field next week.
- 2026-09-11 · **Refused quotes on RTG SHIPPED — 5ba0da3** (built on "build but wait to push", pushed on "push"; carried nothing else): Panel filter gains `nsTransmitRefusedAt`; red REFUSED — <code> row with the message; ⇄ Queue now = `queueNsTransaction` with the whole library fetched once (tab 12's universe), SALES ORDER for status APPROVED (+ SO-APP board write-back when the record exists) else ESTIMATE; success clears the stamp in the nsTransmitQueuedAt write, a refusal renews it. Guide paragraph. Build clean. The §3 'refused quotes' item is done when pushed; struck from the queue then.
- 2026-09-11 · Run-through for Stuart: SO60169 is on the board (Older than 7 days; Painting coat 1, WMS picked) — not missing. The six other reopened Brimar orders were packed since and now sit in FLOOR_DONE with per-row Close; their fulfilments fail on NetSuite multi-location (Eric / S4's Fulfilment tab). Brianna Michelle's plated order was under the **M2C** brand — RTG and the CRM are brand-scoped, my tab was on CE; Stuart found it there and closed it himself. Lesson: check the brand switch before declaring an order absent.
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
