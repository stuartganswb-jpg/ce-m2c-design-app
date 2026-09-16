# Brief S3 — WMS · Finishing Floor · Shop Floor · the outbox and the NetSuite functions

*Written 2026-09-10 by the communicator session. You start THIRD. Read, in order: `CLAUDE.md`,
`SESSION_COMMS_2026-09-10.md`, `STATE_OF_THE_APP_2026-09-10.md` (your items: §1 C and D, §2.1 #2–4, §2.2 #12, #14,
#16, #18–19, §2.3 #23, #27, §2.4 #33–36, #42–43), then `WMS_BRIEF.md` (the warehouse in one document),
`SHOP_FLOOR_CONTINUATION_BRIEF.md` (the shop as it now is, with the exact live script for the plating round
trip), the finishing-floor parts of `RTG_CONTROL_BRIEF.md` (§2 controls, §5 where a stuck order says why),
`WORK_ORDER_CONTRACT.md` §5–5c, and the memories `brief-c-shop-floor-session`, `pickpack-in-main-bundle`,
`deploy-verify-asset-manifest`, `wms-assembly-build-component-bin`, `rod-cuts-wms`, `finishing-order-release-flow`.
`BRIEF_C_HANDOFF.md` and `BRIEF_D_HANDOFF.md` are history.*

## ⛔ CLOSE-OUT ORDER — Stuart, 2026-09-12 (read before anything else)

Stuart: *"prompt all that we are going to close out now … make sure they are all aware to watch out for each
other and confirm what we are doing so we get closure and can work on new functions."* No new function starts
in this session until the list below is done and confirmed. Full picture: `SESSION_COMMS_2026-09-10.md` § Close-out.

**Stuart's rule for the plater PO, verbatim, 2026-09-12:** *"the pole with french return or miter return or
straight pole anything pole for po to plater is always just the # of feet 1 pole x 8ft = 8 billable feet."*
The plater PO line for a pole bills **feet = poles × length**; a French return or miter adds nothing. S2 fixes the
shop doc's `qty` (pieces, not lines) and what the plating demand carries; your half is the PO line in
`PickPackApp.js` (the weekly shipment's `buildPlatingPoPayload` / description) reading poles + feet, and the staged
line's count — S2 writes the field names into your § 6.

**S3's close-out list** (three are approved and waiting; the rest verified absent from the code this morning)
1. #16 retire the Setup Queue "⟲ Create Re-make WO" for stock (`SetupQueue.js:686`, writer `:525`) + the guide's
   honest-matrix row. Stuart: yes.
2. #32 delete the Setup Queue's outsourced group (`:51–53`, `:594–597`). Stuart: yes. Look once on the tablet first.
3. #12 the WMS rod-cut completion calls `releaseStockWoToFloor` for a stock WO — the LAST path that still needs an
   open RTG tab (spec: BRIEF_D "the rod-cut / convert completions RELEASE a stock order").
4. #14 the JFP adjustment `dedupeKey: jfp-adj:<id>` + refuse on `jfpAdjQueued/Posted` (`PickPackApp.js` ~1759, ~1867);
   #35 look at the pack-scrap adjustment for the same shape while there. Stuart reverses IA26936 by hand.
5. #33 the plating build-back onto the outbox (the last direct inventory write with no double-post guard).
6. #18 arrival stamp `backorderCovered` + release of the BACKORDER hold; SO Pack toggle releases the same hold.
7. #19 Rod Cuts empty state "0 for CE — n open under M2C".
8. #40 settle the receipt field names (`receivedAt/By` per line; `overQty` / `shortQty`) and tell S2.
9. #34 the pre-pack confirm on an Order Entry custom half; #36 writeBack on the two pull adjustments; #42 C3 read one
   shape; #43 C6 (`isShopEngineer`, Brimar bent pole).
10. Live runs: the sales-typed build at pack (never posted live); C4 the Order Entry pair; three clean ⛏ posts →
    Stuart flips `rootBuildAuto`; the first REPACK on real packs; the first reopened-doc chip and Undo refusal seen by
    an operator. Stuart owes CE's boxes on HQ 15; pairs wait on Eric.

**Watch out for each other:** before EVERY commit run `git log origin/main..HEAD` and ABORT if it prints anything;
`git diff --cached --stat` must list only your files; S2 reads `SetupQueue.js` and `PickPackApp.js` (never edits);
S4 will mount ONE Fulfilment panel in `PickPackApp.js` — coordinate before they start; never push while another
session is mid-live-run; every push gets a deploy notice in the other four briefs.

**Confirm** by appending to § 7 Status log, before starting: `CLOSE-OUT CONFIRMED 2026-09-12: items …, in this
order, ETA …`; and when done: `CLOSE-OUT DONE: <hashes>`. The communicator collects the five confirmations.

## ⛔ Working agreement + standing rules

Plan first and WAIT. Requested scope only. No temporary fixes. Trace downstream. One issue at a time.
**Two rules this territory lives by:** every NetSuite write here **moves real inventory** — nothing posted
twice, from two places, or guessed; and `functions/index.js` **does not auto-deploy** — every functions change
ends with the Cloud Shell command for Stuart and a verification it is live. **The floors receive work; they
never route it.** If a doc arrives in the wrong queue, the bug is upstream (S2) — name it, do not filter it.
**Outsourced finishes never enter the finishing floor.** A validator refuses only on complete knowledge.
Never guess a number a person would act on.

## 0. Operating

- Three PIN-gated front-ends: `/pick-pack` (Sandra, Andrea — Spanish-first, `Shared/i18n.js`),
  `/finishing-floor` (Grace, chip PINs from `fin_users`), `/shop-floor`. Stuart pins you in with
  Claude-in-Chrome; ask for a floor tablet view when you need the queue as the operator sees it.
- **PickPackApp, ShopFloor and the FinishingFloor compile into `main.*.js`** — sweep main (and every
  chunk) with `curl -sf`, report failures and bytes. The User Guide is a numbered chunk.
- Cloud Shell: `cd ~/ce-m2c-design-app && git pull origin main && firebase deploy --only functions:<name>
  --project ce-m2c-design-collab`. The RESTlet (`netsuite/ce_convert_build_restlet.js`) deploys in NetSuite by
  Eric / Stuart (File Cabinet replace; script 2848/1). Nothing in `functions/` or `netsuite/` has changed since
  the last reported deploy (b6b616c, 09-03).
- Windows onto NetSuite: 11.1 → NetSuite Sync Queue, the RTG Transmit Log, screenshots. The outbox worker runs
  every minute, 6 attempts, marker recovery on retry.
- Suites: `committedBins` (46), `pickLines` (48), `labelScan` (36), `rodPieces`, `orderLifecycle` (S2's, you
  read), `finishLabel`. Run bare.

## 1. Territory

**Own:** `PickPack/*`, `FinishingFloor/*` (SetupQueue, ActiveFloor, Recipes, Management, ProductionTimes,
SchedulePlanner, Modals, Summary, FinishingFloor), `ShopFloor/*` (ShopFloor, ShopEngineering, shopShared);
`functions/index.js` — `netsuiteProxy`, `nsOutboxWorker`, `onStockBuildDone`, `onMillComplete`, `authenticatePin`,
the user-directory callables (the `portal*` exports are S4's); `netsuite/ce_convert_build_restlet.js`;
`Shared/nsOutbox`, `nsWorkOrder`, `nsProxy`, `convertDiag`, `pickOrder`, `pickTabs`, `pickLines`, `committedBins`,
`labelScan`, `labelPrint`, `platingPackingList`, `platingOrderPdf`, `quickShipUom`, `i18n`, `rodPieces`,
`rodPieceLedger`, `RodPieceInventory`, `programPrints`, `PullLinesLive`, `WhereIsIt`, `OrderStatusChips`,
`finishingTime`, `floorActivity`.

**Read-only:** S2's (RTG, the writers, `orderStatus.GATES` — you *read* `gatesOf` / `isReleasable` /
`customPartsReady`, *call* `clearConvertGate` / `clearReceiptGate` / `releaseStockWoToFloor` /
`propagateFloorState` / `mirrorCustomStatusToSibling` / `fulfilPlatingDemand` / `cancelPlatingDemand`);
S1's (`salesOrderHeader`, `lineClassification`, `finishLabel.takesNoFinish` — you read); S4's Fulfilment
module (they mount ONE guarded panel in `PickPackApp.js` — your file; you review the mount, they own the
module); S5's `labelPrint` templates? — no: `labelPrint` is yours; S1 edited the UOM template on Stuart's ask
(5ec3acd) and left you a note in memory.

## 2. What is live (do not rebuild)

The claim gate; SO Pack (four numbers, both doors, Close order); committed bins; the arrival alert; the
plating receiving station (scan → cart → bin, receipt on the outbox, build-back through the convert RESTlet
with the component bin); D1 (receipt → 'Plating Received', build-back → 'Complete' + 'Plated', pack gate =
`customPartsReady`); `Shared/pickLines`; RECEIVING (PO) calling `clearReceiptGate`; LABELS with the pack barcode
grammar; pole length/qty/sidemark on pick and pack cards; cancelling a rod cut lifts its gate; the plating
demand's END (`fulfil` / `cancel`); the shop's four-state mirror through the ONE shared outsourced test; the
mill-complete stamps through `propagateFloorState`; the Traverse Cut Sheet; the "no cut sheet from Vision"
banner; Reopen cancels its demand; the Setup Queue saying why (PENDING-RECIPE names its source, "not sent to
WMS" says why, refuses Start while a cut is open, JFP View Item); functions D2 (`onStockBuildDone` builds
sales-typed anchors) and D3 (`onMillComplete`, OFF per brand).

## 3. The work, in order

Numbers are `STATE_OF_THE_APP_2026-09-10.md` §2 items.

**Proof first — on Stuart's live orders (he is turning his quotes into sales orders now)**
1. **#2 the plating round trip** — the script is `SHOP_FLOOR_CONTINUATION_BRIEF.md` §5.1, verbatim: an /EP
   custom order from Stuart → shop ▶ Start (sibling In Process, pick open) → Complete & Label ('Sent to
   Plating', ONE demand with `finSiblingId / orderKey / shopOrderId`, OB PLATING prompt, nothing to finishing)
   → ↩ Undo (demand gone, chip back) → Complete again (one fresh demand) → pull → ship → receive → build-back
   → sibling 'Complete', RTG "Plated", pack allowed; and the refusal: undo after the pull has shipped says
   "receive them back first". Screenshot each step. S2 watches the board side.
2. **#3 the watched sales-typed build at pack** — Order Entry, ONE to-be-finished line whose raw item exists in
   NetSuite and whose finished variant does not (FLOW1, anchored on the BASE); take it to pack; watch 11.1 for
   the entry labelled `… · SALES`. If it fails nothing moved and the error is Eric's answer. Then a FLOW2 line.
3. **#1 the rest of the live pass on the WMS**: claim gate (two tablets), SO Pack numbers and the green open,
   committed bins (refusal names the order in the bin), the arrival alert at both handlers, LABELS, the pole
   details on the pick card, the receiving dock.
4. **#4 C4 — the Order Entry pair** (`HCUMP810 + /P01`): card in Custom Fabrication, `finSiblingId` set, START
   releases the sibling pick, COMPLETE mirrors, the item's Shop Instruction shows (Stuart types one first).
5. **#6** three clean manual ⛏ posts → Stuart flips `rootBuildAuto` for CE (console, no UI) → ⛏ retires per brand.

**Hand-offs that never landed — your files**
6. **#14 the JFP double-post** (IA26935 / IA26936, Stuart 09-04: "it def. doubled the transaction"): both JFP
   `enqueueNsWrite` calls (`PickPackApp.js:1759`, `:1867`) get `dedupeKey: \`jfp-adj:${job.id}\``; the put-away
   branch refuses up front on `jfpAdjQueued || jfpAdjPosted`; `redoPutaway` refuses while the first is in
   flight unless its entry is FAILED. Spec verbatim in `BRIEF_D_WMS.md` "Hand-off from B — the JFP paint-run
   adjustment posts TWICE". Stuart reverses one adjustment by hand (recommend the later, IA26936). Then **#35**:
   the pack-scrap adjustment (same account 254) may share the shape — look while you are there.
7. **#12** the rod-cut completion calls `releaseStockWoToFloor` for a stock WO (spec verbatim in `BRIEF_D_WMS.md`
   "the rod-cut / convert completions RELEASE a stock order"); sales-typed keeps `releaseFinWoToFloor`. Until
   this and S2's #11 land, a stock order whose last gate clears at the WMS waits for an open RTG tab.
8. **#16** (from S2) retire the Setup Queue "⟲ Create Re-make WO" for stock (`SetupQueue.js:686`, writer `:525`);
   keep a "report scrap" that calls the one closer; the guide's honest-matrix row goes. Custom re-issue is RTG's.
9. **#18** arrival stamp: a receipt / put-away that makes a cover code available re-evaluates the backorder
   lines that name it (`Shared/backorder`, S2's — you call it), stamps `backorderCovered: true`, and releases
   the split's BACKORDER hold when every line of that doc is covered; the SO Pack "Finish as available" toggle
   releases the same hold when it turns ON (spec verbatim in `BRIEF_D_WMS.md` "the release half of
   finishAsAvailable is live"). Nothing auto-releases the pick; the board shows ARRIVED.
10. **#19** the Rod Cuts empty state: "0 for CE — n open under M2C" (the WMS keeps its own brand in `pp_brand`).
11. **#32** (from S2, after they observe it empty) delete the Setup Queue's outsourced group (`SetupQueue.js:51`,
    `:594`) — never keep it as a safety net.

**Owned, not blocked**
12. **#33 the plating build-back onto the outbox** — the last direct inventory write with no double-post guard
    (`PickPackApp.js` ~3926–3987 via `postConvertBuild`). Needs the convert RESTlet reachable through the
    outbox with a deterministic id (`platebuild-<lineId>`) and writeBack to the shipment line. The pull stays
    immediate by Stuart's instruction (Sandra needs NetSuite's answer at the bin); ask whether the build-back
    may read "queued — watch 11.1" (STATE §3 Q6 recommends yes).
13. **#34** the pre-pack confirm calling an Order Entry custom half `<woId>-C` "still in production" forever —
    read `customFabStatus` (the mirror) for that half, not `floorPhase`; write the spec first.
14. **#36** the two pull adjustments with no writeBack — add a writeBack naming the order so a future audit can
    reason outward from it.
15. **#42 C3** read one shape: sweep the shop's fallback chains (`partNum || item || 'CUSTOM'`, `soNumOf`,
    `shopItemCodeOf`, the intake form's three candidates) to read `buildShopDoc`'s canonical field first; read
    `cutSheetMissing` / `visionUsed` off the doc (B1 stamps both) and delete the shop's own derivation.
16. **#43 C6**: `isShopEngineer` verify (engineer reaches the four engineering tabs, an operator does not); the
    Brimar bent-pole end to end; polish last and only what a commit already touches.
17. **#40** with S2: the receiving-tab receipt shape (per-line `receivedAt/By`; a short/over field that is not
    `scrapQty`). S2 owns the writer; you own the tab.
18. LABELS needs granting in the WMS permission matrix (Stuart, admin).

**Waiting on Stuart:** #23 Q3 root-build N (default 3) and Q4 the 20 ft stick family (default H1-1R only, 20 ft,
offcuts kept, home bin = library bin) → then C5 (declare in 6.5 Tool 2, run a custom pole through the card).

## 4. Acceptance — live, Stuart pinned in, 11.1 open beside you

The tables in `SHOP_FLOOR_CONTINUATION_BRIEF.md` §9 and `BRIEF_D_WMS.md` §6 stand. Additions:

| run | expect |
|---|---|
| JFP put-away scanned twice (after #6) | ONE `ns_outbox` entry; the second scan refused naming the first |
| a stock WO's rod cut completed with NO RTG tab open (after #7) | Setup Queue shows it within seconds; 11.1 shows its WO |
| a vendor receipt covering a backordered line (after #9) | the line reads ARRIVED on the Backorders board; the floor doc's hold released only when every line is covered |
| plating build-back double-tap (after #12) | one build |

## 5. Questions for Stuart

**All answered 2026-09-12 ("yes to all three", after the close-out list was read back):**
1. STATE §3 Q5 — the JFP dedupe fix is approved as specified in §3 #6; Stuart reverses **IA26936** by hand. ✅
2. STATE §3 Q6 — the plating build-back MAY be queued ("queued — watch 11.1"); the pull stays immediate. ✅
3. STATE §3 Q4 — defaults stand: root-build N = 3; the 20 ft stick family = H1-1R only, 20 ft, offcuts kept, home
   bin = library bin. ✅
4. STATE §3 Q3 — delete the Setup Queue re-make now: yes (relayed by S2 this morning). ✅

## 6. Hand-offs in

- **⚠ DEPLOY NOTICE from S2 · 2026-09-16 · 3a3aca4 pushed, swept live in `main.9876b7f7.js`.** Hard-refresh (⌘⇧R) + re-PIN
  before your next save. **"Where is it?" now shows OPEN work only.** Stuart: "once a work order is completed or the item is
  no longer in production it should not still be there, should only be for current working production or currently on a
  purchase order, rod cut, etc." The cause: the search filtered nothing by status. It holds no data of its own — each screen
  hands it a list and it text-matches over that list — and THREE of the four screens hand it an entire collection (the
  finishing floor and the packing station both subscribe to all of `fin_workorders`, the shop tablet to all of
  `custom_orders`), so every job ever run answered the search, while the popup's own empty-state text already promised that a
  closed order would not appear. The rule now lives in `Shared/orderLifecycle` beside the closer, so there is ONE answer to
  "is this finished": `openForSearch` (not `isDoneState`, not `floorPhase` Packed/Shelved, not shipped) and
  `openExtraForSearch` (a PO while `isOpenPo` says so — `poLock` owns that rule; a rod cut until DONE/CANCELLED; a convert or
  plating demand while it exists, since the WMS DELETES it when the pull posts). **COMPLETE IS STILL VISIBLE, deliberately** —
  `isDoneState` already carries Stuart's 2026-09-10 ruling that a job off the paint line is not done, and a pick-only doc is
  BORN Complete. Hidden matches are COUNTED, not dropped: a grey footer says how many finished or closed matches were hidden,
  and when every match is finished the no-match text says so. No writes, no document shape changes, nothing reaches NetSuite —
  the screens keep their own lists for queues, cards and pick lists; only the search dropdown narrows. **Your side: this one is mostly ON YOUR SCREENS — read it.** Three of the four mounts are
  yours (Finishing Floor, the packing station, the shop tablet), and all three were handing the search whole collections.
  Nothing of yours changed: `finAll` stays deliberately UNfiltered for the packing station itself (an order can finish without
  ever being released to pick and still has to be packed), `workOrdersRaw` still feeds your queues, and `customOrdersRaw`
  still feeds your cards. ONLY the search dropdown narrows. The one thing to know at the bench: a job that is Complete but not
  yet packed is STILL FINDABLE by design — it is your work until it is packed or put away — and a packed or put-away order now
  drops out, with the footer saying how many were hidden.


- **⚠ DEPLOY NOTICE from S2 · 2026-09-15 · f56bb7d pushed, swept live in `main.ee8a193e.js`.** Hard-refresh (⌘⇧R) + re-PIN
  before your next save. **This is S1's cart-staleness / engine-version work, committed and pushed by S2 on Stuart's relay
  ("other sessions say its up to you to finish and push"), as ONE unit and with nothing of it changed.** Three things are
  now true in production. **(1) A saved quote line records what built it** — the engine's own source hash
  (`Shared/engineVersion`, regenerated by the build) and a fingerprint of the tags it read — and CRM's **Approve compares
  both against what runs today and names any line that no longer matches, BEFORE the sales order exists** (the way out is
  the one that always existed: reopen in CPQ, re-save, approve; going ahead anyway is stamped `approvedWithStaleLines` on
  the job). The cases were SO60429 / SO60430 / SO60431: quotes saved 09-10 and approved 09-14 carried the BOM from before
  that evening's engine fixes. **(2) APPROVED now means a sales order really exists** (QUO143 — the status used to flip
  before the confirm, so a cancelled dialog left a quote reading APPROVED with no order). **(3) ⚠ A BACKPLATE'S QUANTITY
  NOW FOLLOWS ITS ARM** (SO60429: "3 brackets on order and in the bom it only put 1 of the matching cover plates when it
  should be 3") — the typed count lands on the centre bracket and a plate is never asked for one, so it stayed at 1 while
  its arm went to 3. **Your side: point (3) changes what reaches your floors.** An order raised from now on
  will carry one cover plate PER ARM where it used to carry one in total, so a pick list, a BOM and a NetSuite line for the
  same configuration will legitimately differ from an order raised before today. That is the fix, not a fault — but if a
  picker asks why an identical-looking order has more plates than last week's, that is the reason. Nothing for you to build.


- **⚠ DEPLOY NOTICE from S2 · 2026-09-15 · 0edddb0 pushed, swept live in `10.fcd64a54.chunk.js`.** Hard-refresh (⌘⇧R)
  + re-PIN before your next save. **The backorder hold is real at the split now.** It was decided in one place and written
  to one document, so the RTG chip said HOLD while every other document went to work (Stuart, on the 09-14 Fabricut orders
  SO60427–SO60432: "showing as hold waiting on back orders yet they still hit the floor"). `Shared/backorder.backorderHoldOf`
  is the rule — short lines + no "Finish as available" = held, the reason naming every short line by code and qty — and the
  split stamps it, on ONE timestamp, on every document it writes: the finishing doc as before, the **PICK-ONLY** doc (that
  exemption is how SO60429 reached the WMS pick with seven short lines) and the **SHOP** sibling (so a rod is not cut for an
  order that cannot ship). The lift matches: "Finish as available" on the RTG card now clears the hold on the shop order as
  well as every finishing doc. New/changed fields: `held` / `heldAt` / `heldBy` / `heldStage` / `heldReasonKind: 'BACKORDER'`
  / `heldReason` on `fin_workorders` AND `shop_custom_orders`; nothing else changed; no NetSuite effect. **Your side:** `holdGateOf` already reads it, so your lane and refusals now fire on pick-only and shop documents too — nothing to build for the stamp. The RECEIPT-SIDE LIFT is the open half and it is specced to you in the hand-off above: nothing anywhere lifts a backorder hold when the material actually ARRIVES.


- **From S2, 2026-09-15 — the backorder hold is now REAL on every document, and the RECEIPT-SIDE LIFT is yours.**
  Shipped my half (0edddb0, committed, awaiting Stuart's push): `Shared/backorder.backorderHoldOf` decides the hold once at
  the split and stamps it on EVERY document the order owns — the finishing doc as before, the **PICK-ONLY** doc (the exemption
  that let SO60429 reach your pick queue with seven short lines), and the **SHOP** sibling (so a rod is not cut for an order
  that cannot ship). Your screens need nothing for the stamp: `holdGateOf` already reads it, and ShopFloor's `heldGuard`
  already refuses to start or complete a held order. **What is missing is the lift.** Nothing anywhere clears a backorder
  hold when the material actually ARRIVES — the only lift is the manual "Finish as available" flag on the RTG card, which I
  extended to reach every sibling. `backorder.js` has always said "the receipt (D) marks it covered", and that half was never
  built. **Yours, at the receipt / put-away (and the Snapshot's Backorders board when a line is covered):** when the material
  for a backordered line lands, mark that line covered on `hq_sales_orders.backorderLines[]`, and when NO short line remains
  on the order, lift the hold on every sibling — use `Shared/backorder.isBackorderHold(d)` as the test so a floor STOP is
  never lifted by a delivery, `linkedDocsOf` to gather the docs, and the same patch shape the RTG lift writes
  (`{ held: false, heldClearedAt, heldClearedBy, heldClearedNote }`) so the two lifts are one fact. While ANY line is still
  short the order keeps waiting — that is FINISH COMPLETE, and `finishAsAvailable` stays the only exception. Tell me if you
  would rather RTG own the lift off a receipt event and I will build it here instead; the rule module is shared either way.
- **From S2, 2026-09-15 — bent returns: the CUSTOM ones ALREADY follow the pole; only the STOCKED item waits.** Stuart
  confirmed today that bent returns must follow the poles, and that his "wait" covers the stocked ones only: "do not worry
  about stocked bent returns i think we can add a flag to master library when the time comes." Nothing is parked on the
  custom side and nothing needs building there — a bent or mitred return on a custom rod is a fee line with no cut length,
  so `classifyLine` routes it to the SHOP half, `poleDetailsOf` makes it a RIDER on that rod's row, the pack ticks it with
  the pole and never as a piece of its own, and `customShopQtyOf` bills it in feet. It is finished with the pole because it
  IS the pole. What waits is the STOCKED return ITEM: your `packLinesOf` stream skip and my split half both hold until
  Stuart flags those items in the Master Library. Your answer (a) — one document, both streams, the
  assertion relaxed to a warning — is recorded and stands for when it comes back. **One defect I found while checking it,
  worth knowing before anyone builds:** `poleRowsForPack` rebuilds the pole rows from the SHOP cut list and `poleLinesStamp`
  REPLACES `poleLines` at the first pole tick, so on an order carrying both a custom pole and stocked returns the returns
  would never appear on the pack list and would be erased from the document. Whoever builds it must UNION the split's stocked
  rows with the shop's cut rows, not replace. Custom returns need nothing — they ride the pole as riders and finish with it.

- **From S2, 2026-09-15 — bent returns on the POLE stream: the field names and the one question, before either side ships.**
  Stuart narrowed the ruling today: a CUSTOM bent return is the end of its pole, rides with it everywhere and finishes with it
  (nothing to build — the riders model stands). What is left is a STOCKED bent-return ITEM (Grace, Brimar 60170 / 60152): the
  library classes it Small Parts, the split puts it in `partsList` with a `paintSize`, and the sled sprays it; it must hang on
  the pole rack under the pole recipe. **S2's split half (not built yet):** a small line whose part carries
  `manufacturingSpecs.finishStream === "POLES"` (Stuart tags the return items in 4.5 — tags before code; fallback: a
  `productType` matching POLE|ROD|RETURN) goes to the pole stream: excluded from `paintSizes`, kept on `partsList` for the
  pick with `stream: "POLES"`, and written to `poleLines[{ code, name, qty, length: null, unit: null, source: "STOCK",
  isReturn: true }]` + `poles: { qty, type: <first code> }` + `totalPoles`. **The blocker is yours:** `buildFinDoc` asserts
  POLES XOR SLED (`floorRelease.js:113–130`, Sandra's WO11535 "could never complete"), and a Brimar order is brackets on the
  sled PLUS returns on the rack — both streams on ONE document. Two ways, your call: **(a)** the floor completes a document
  that carries both (Active Floor `currentStepIndex` + `poleStepIndex` already exist; you confirm completion, scrap and
  the pack tick work with both, then S2 relaxes the assertion to "warn" and writes both streams); **(b)** the split writes a
  SECOND finishing document for the pole stream (`WO-<SO>-P`, sibling-linked) — S2 recommends AGAINST (b): two pick / pack
  cards per order and a fork of the one-doc-per-order reading every WMS screen makes. Answer (a) or (b) in BRIEF_S2 §6 with
  the field names confirmed; S2 builds the split the same day; one deploy; verify on the next Brimar order with stocked
  returns. Downstream: WMS pick unchanged (same partsList), pack sees the returns as pole rows by code (your 8b2e6b1 reader
  already renders `poleLines`), RTG row shows a POLES stream, NetSuite untouched.
- **⚠ SPEC from S1 · 2026-09-15 · BACKORDER HOLD IS DECORATIVE (yours: the floors; S2 has the split half).** **Stuart, 2026-09-15, on the 09-14 Fabricut orders (SO60427–SO60432): "all the orders with wood poles have items on back order, if you look on RTG you can see these orders are showing as hold waiting on back orders yet they still hit the floor."** What S1 read in the code: the split writes the finishing doc with `held: true / heldReasonKind: 'BACKORDER'` only when the doc is NOT pick-only (`holdForBackorder = !pickOnly && plan.backorder.length > 0 && so.finishAsAvailable !== true`, RTGDispatchTab ~1403), and the doc is written to `fin_workorders` at the split, `currentPhase` Setup, so it is on the floor the moment it exists. Nobody downstream reads `held`: the finishing floor subscribes to the whole collection and lists by `currentPhase` (SetupQueue 50); the only use of `held` on the floor hides the STOP button (SetupQueue 739); `orderStatus.openGatesOf` has no hold gate; a pick-only (plated) doc with shorts goes to the WMS pick with no hold at all (SO60429: 7 short lines, `pickOnly: true`, on the pick). So the RTG chip says HOLD and the floor says GO. Your half: honour `held` on every floor screen — the finishing Setup Queue / Active Floor / Schedule Planner and the WMS pick queue show a held doc in a ⏸ WAITING ON BACKORDER lane with `heldReason`, and offer no start / advance / pick / schedule action on it until `held` is false (RTG's "Finish as available" or the material arriving lifts it). The doc stays visible (RTG is the master; the floor may see what is coming) — it just cannot be worked. Examples to test on: WO-SO60428 (3 shorts), WO-SO60430 (1), WO-SO60432 (11), WO-SO60429 (pick-only, 7).

- **⚠ SPEC from S1 · 2026-09-15 · ONE ORDER, TWO FINISHES (S2 splits per recipe; you verify).** SO60428 (QUO149) carries S04 on the wood rod / end caps / wood brackets and P14 on the metal; the split writes one fin doc at P14 and the floor runs one recipe per work order, so the wood would be sprayed P14. S2's spec writes one fin doc per recipe (`WO-<SO>` + `WO-<SO>-S04`, shared `salesOrderId / soAppId`, `siblingFinIds[]`). Your check: the floor needs nothing new if each doc carries one recipe; SO Pack must gather all fin docs of the SO (PickPackApp 850 already matches on `salesOrderId`) and the packing list must print the whole order once, not once per doc. Say if a fin doc id with a suffix breaks any lookup you own (`WO-<SO>` is assumed in orderLifecycle 72 `SHOP-${k}` / `WO-` patterns — S2 will keep `WO-<SO>` as the primary).

- **From the communicator, 2026-09-15 — FIVE App Imp cards routed to S3 (read live off the board with Stuart; take them
  after the close-out list, in this order).**
  1. **Andrea 9/14 10:10 · WMS Packing — "items are packed and the photos are taken but doesn't let me hit the complete
     button."** The same thing Stuart hit on WO-SO60169 — S2's hand-off directly below (a disabled ✓ Complete Packing
     must say why) IS the fix. Two halves: the button prints its first unmet reason, AND the box sizes must exist in
     HQ → 15 Standard boxes for the brand (data — Stuart/Andrea; until they do, `boxesChosen` can never be true).
  2. **Grace 9/14 1:35 PM · FINISHING Active Floor — WO11610 and WO11612: Anne pressed Start and Complete on the Hand
     Finishing tab on the tablet, but Manual Controls shows HF as pending "as if she never went through HF".** New,
     unverified. What the code says (`ActiveFloor.js`): the tablet's hand card completes `tasks.hand` (small parts) or
     `tasks.poleHand` (poles) — the off-ramp hides a card on `tasks.hand.status === 'Complete'` (~:1173), while the HAND
     station's manual list (`~:730`) pushes BOTH keys for an order that has both streams. If those two orders are pole
     orders that also carry a `hand` task (or the reverse), the two readers disagree. Read the two `fin_workorders` docs'
     `tasks.hand` / `tasks.poleHand` and `fin_logs` for Anne's taps before touching code; fix the cause, not the display.
  3. **Grace 9/9 3:55 PM · Brimar 60170 & 60152 — the bent returns rode the SMALL PARTS order and were sprayed; GL5 on
     poles is stirred.** STUART'S RULING 2026-09-15, verbatim: "bent return always finishes as poles, custom bent returns
     come from the floor then finish like poles, stocked bent returns can go straight to finishing." So on the finishing
     floor a bent return is in the POLES stream, never the sled — a custom (shop-fabricated) return arrives from the shop
     floor and then finishes as a pole; a stocked return item skips the shop and goes straight to finishing, as a pole.
     The STREAM ASSIGNMENT happens at the split (S2's territory — the same ruling is in BRIEF_S2 §6, they own the writer);
     your half: the floor doc's pole stream (`poles/totalPoles`, `poleRecipeOf`, the pole rack, the pole hand bench)
     must carry a return that has no cut length (it is fabrication ON a pole, per 6d9ad3d, but it FINISHES as a pole),
     and `buildFinDoc` (`floorRelease.js`) must not strip it or double it. Co-ordinate the field names with S2 before either
     side ships; one deploy, one verification on the next Brimar order with returns.
  4. **Sandra G 9/9 11:57 AM · Setup Queue — "some orders are asking to Start Setup but we did the setup side before the
     order came from production; they should show Stage to Floor."** By design today (`SetupQueue.js` ~:900: `stepStatus
     'Pending'` → Start Setup, and Start Setup is ALSO what releases the parts pick to the WMS — `releasePickPatch`). Ask
     Stuart before building: does a "setup already done" path exist that jumps to Stage to Floor and STILL releases the
     pick (one tap that does both), or is Start Setup → Stage to Floor two taps by design? Do not remove the pick release.
  5. **Livio 9/9 9:06 AM · SHOP Labels — "necesita imprimir un label para cada medida de tubo porque solo muestra el
     numero de orden y la primera medida."** Real defect: `ShopFloor.js printZebraLabel` (~:1306) prints ONE completion
     label carrying `order.cutLength` — the first length — and never one per `cutList` line. Build: one label per cut-list
     line (length × qty, "n of N"), the single-length order unchanged; reprint from the Recently Completed strip does the
     same. `Shared/labelPrint.printShopCompletionLabel` is the route — extend it, do not fork it.
  Resolution notes for the five cards that were already handled were given to Stuart to paste; these five stay NEW on
  the board until you ship — write your own note on each card when you do (paste-ready, hard-refresh + re-PIN line).

- **From S2, 2026-09-15 — a disabled "✓ Complete Packing" says nothing (Stuart on WO-SO60169, every line ticked, two
  photos, button grey).** `PickPackApp.js` ~:5127 `canComplete` needs five things and the button only greys: every line
  ticked · photo · the shop-label match (`packCustomMatchedAt` / waived / `packCustomScan` matching) · the custom half
  `customPartsReady` · BOTH boxes chosen (`packBoxSel.SMALL` + `.POLE`, impossible while the brand has no standard boxes).
  **Ask:** print the first unmet reason beside the button ("pick the pole box", "scan the shop label", "custom parts at the
  plater", "no boxes for this brand — add them in HQ → 15"), and say so where the box dropdowns are when the list is empty.
  Display only; no document change.
- **⚠ DEPLOY NOTICE from S7 · 2026-09-13 · c4bbc89 pushed at 17:44 EDT (S7 swept all 37 served assets after the deploy: version stamp 1789339814060, 0 download failures; the new module is imported by no screen, so its literals are ABSENT by design (`SIZE_GROUP_UNPRICED` → none); the hardware guard literals stand (`a return carries the rod at that end` in `main.1f049abe.js`, `Pick a Left bracket OR a return/arm end first` + `Push Config to CPQ` in the Vision chunk `104.74c087bc.chunk.js`); recorded in BRIEF_S7 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped: **`Shared/pillowPricing.js` (NEW, pure, imported by nothing yet) + `scripts/pillowPricing.test.mjs` (58)** — the Uniquity custom pillow price rule as Stuart stated it 09-13: the size's standard price at the HIGHEST fabric price group among the panels (matrix `prices[size][group]`, fallback base + upcharge), + labour per drawn seam, + a charge per custom detail (FLANGE / WELT each, OUTER_TRIM and FRINGE_SEAM per yard); every panel consumes its OWN fabric (running-yard goods by widths × cut ÷ 36 rounded up to ⅛ yd; a cut-down throw labelled as a fabric = one each); fill + zipper consumed at $0 when the size names them; a missing table row REFUSES by code, never a $0 line. Output = ONE priced holder line on the non-inventory `CUSTOM PILLOW` item (`isRollup`, partHandling Custom, division `SEW`) + $0 consumption rows, all in `hardwareHandoff`'s row shape. Tables live in `system/pillow_pricing` (shape `DEFAULT_PILLOW_PRICING`, EMPTY until Stuart's spreadsheet). **Nothing served changes; no document, work order, floor or NetSuite write.** Decisions logged in BRIEF_S7 §7: the pillow goes Vision → **Order Entry (tab 7)**, not CPQ; quote or sales order both; throws cut into panels labelled as fabrics; a non-inventory 'custom pillow' item; Stitch & Sew = the small-parts flow to a SEW division with a Uniquity-subsidiary NetSuite WO (2–3 wk). Your side: nothing now. Coming (step 5): a SEW division on the finishing floor (same Setup Queue, zones cut · sew · stuff · pack) for Uniquity custom pillows, and (step 6) a panel cutter on the convert RESTlet — a throw becomes fabric panels the way loose rings become packs. Patch specs land here when the shapes are final.

- **⚠ DEPLOY NOTICE from S1 · 2026-09-13 · f29c4db pushed at 17:22 EDT (S1 swept every served asset after the deploy: version stamp 1789338315036; `recorded for the Snapshot's Backorders board` in tab 7's `876.665697cc.chunk.js`; recorded in BRIEF_S1 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped (close-out item 4 / STATE #17): an **Order Entry (tab 7) order now carries `backorderLines[]` like a CPQ one**. At save, tab 7 hands its lines (stock lines as pieces, to-be-finished lines with their outsourced flag, the traverse components) to THE SAME planner RTG's split uses (`Shared/splitPlan.planSmallLines` over `Shared/backorder.classifyLine`) after one `fetchAvailabilityUnits` read of every cover code at the brand's location, and writes `backorderLines[]` + `backorderAt` on `hq_sales_orders` (`Shared/quickShipBackorder`, pure; 11 assertions incl. byte-identity with the split's own record). An unread shelf claims nothing; a failed read is logged, never a shortage. The Snapshot's Backorders board (S2's `backorderBoard`) reads the record as it is. Also: the tab 7 SO header is computed once (`soHeaderOf` → spread), no behaviour change. Your side: nothing — the pick list reads `lines[]` as before; a backordered tab 7 line still appears on the pick (short), exactly as a CPQ one does.

- **⚠ DEPLOY NOTICE from S1 · 2026-09-12 · 18ad75f pushed at 12:06 EDT (S1 swept every served asset after the deploy: version stamp 1789315750609; `components below at $0` + `No CE-TRV-SYSTEM holder item` in `main.4ef48df2.js` (nsTransmit); the warning also in tab 7's `238.44f4e810.chunk.js`; recorded in BRIEF_S1 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped (close-out item 2 / STATE #46, the E half of the kit bill): a CPQ **kit order pushes to NetSuite in tab 7's shape** — every component the kit paid for (`inKit`) at **$0**, and the kit's dollars on **ONE holder line, `CE-TRV-SYSTEM`** (found by code in the library; fallback = the flow's rollup / 61502 with a warning), the holder's description naming the kit code(s) `[traverse system — components below at $0]`. Until now an inKit component pushed at its library rate and the whole-quote scale squeezed every line to fit the total (QUO141). A $0 kit-paid line never merges with a paid twin of the same item (a 4th bracket above the kit bills on its own line). The saved breakdown now carries `billGroup` (KIT 1 · FEET 2 · ADDED 3 · INCLUDED 4) on every kit-order line and is stable-sorted by it including hand-added extras and the traverse components, so the documents print in that order; a no-kit order is byte-identical. Proven through the REAL resolver in node (`scripts/nsTransmitLineDiscount.test.mjs` 30, +11) and the handoff harness (49, +4). Reaches NetSuite on every kit order from CPQ; tab 12's pre-flight shows the same lines. Your side: nothing — the pick list reads `lines[]` / the breakdown's physical rows as before; `billGroup` is an extra field you may ignore or use to order a kit's pull (kit parts first).

- **⚠ DEPLOY NOTICE from S5 · 2026-09-13 · d35eedc pushed at 10:17 EDT (S5 sweeps by chunk-hash match of BOTH main and the designer chunk; recorded in BRIEF_S5 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped: **🖼 Display mode in the CPQ 3D pane** (S1's `HardwareConfigurator.js`, one guarded block, with Stuart's go-ahead — details in BRIEF_S1 §6): a board frame at true scale, the cart line gains `displaySnapshot` + `displayBoard` when the mode is on; `CPQTab.js` drops `displaySnapshot` from `cartItems` at save (one line). Off = the configurator as before. The 5. Marketing designer lays a board-framed line over the whole face. Docs: `jobs.cartItems[]` never carries the field; `system/displays/entries/*` rows gain `boardFramed` / `config.board`. No work order, floor or NetSuite write. Your side: nothing.
- **⚠ DEPLOY NOTICE from S5 · 2026-09-13 · 2d94c09 pushed at 11:50 EDT (swept by chunk-hash match + main markers; recorded in BRIEF_S5 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped: **Display mode, second cut — the board frame is PINNED to the pane and the hardware moves inside it** (Stuart's first test: zoom moved the frame with the model, true scale was locked). Same guarded block in S1's `HardwareConfigurator.js`, same `Shared/displayFrame.js` (mine): the frame is the largest W×H that fits the pane; the label reads what the drawn rod measures on the board (`rod reads 21.4" · true 16.75" · off scale`); a **⌖ True scale** button dollies the camera to the ordered inches; `displayBoard` on the cart line gains `readsInches` and the designer shows `rod at N" (off scale)` on a row. Nothing else changes — `CPQTab.js` untouched, no work order / floor / NetSuite write. Your side: none.
- **📣 NEW SESSION NOTICE from S5 · 2026-09-13 · S6 opens for SPEC SHEETS** (Stuart: "i need a new session to work specifically on the spec sheets"; S5 continues on the display tool). Brief: `BRIEF_S6_SPEC_SHEETS.md`. Territory moved from S5 to S6: `SpecSheet/*`, `scripts/specSheet*.test.mjs`, `system/spec_sheet_config`, `Approved_Designs.*.specSheetOverrides`, the 📐 button + lazy mount lines in `HQ/BOMTab.js`, the `SPEC_SHEET_*.md` docs. The board's six-session table, ownership and status rows are updated. Nothing in the code changed. **Your side:** none.

- **⚠ DEPLOY NOTICE from S5 · 2026-09-13 · edfb8e3 pushed at 10:00 EDT (S5 sweeps by chunk-hash match, recorded in BRIEF_S5 §7). The push carried S2's docs-only 2384cb7 (unpushed since 09-12 19:43).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped: 5. Marketing designer — a placed row's capture is cropped to the part (white ground knocked out) and the row box is drawn at the configuration's real length on the board. `system/displays/entries/*` rows gain `trueScale`; DISPLAY CAPTURE assets are now the cropped PNGs. No other document, no work order, no NetSuite write. Your side: nothing.

- **⚠ DEPLOY NOTICE from S1 · 2026-09-12 · bfac710 pushed at 19:38 EDT (S1 swept every served asset after the deploy: version stamp 1789256527160; the new `SIDEMARK` row literal in `main.e268c830.js` (FormPreview + quoteDisplay: `"SIDEMARK"`, `"SHIP DATE"`, `"No Sidemark"`) and `367.562a008b.chunk.js`; recorded in BRIEF_S1 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped (close-out item 6, the rest of it): the CRM quotation prints **its own number** (`quoteDisplayNo`: QUO147 / the short number, never the doc id) and the print title matches; the **P.O. slot carries the customer's PO** and the typed order sidemark has its own **SIDEMARK row** in Order Details (`Shared/FormPreview`, every document type; `Shared/quoteDisplay.orderSidemarkOf` = the card's rule); the **date is the day it was saved** as a local calendar day (`docDateOf` — `new Date('YYYY-MM-DD')` was UTC midnight and printed the evening before); **"No Sidemark" is never stamped on a cart line** by either engine any more (`hardwareHandoff`, the old add-to-cart) and lines saved before today read as blank on the way to NetSuite's line Tag (`nsTransmit` → `cleanSidemark`). Tests: quoteDisplayDoc 14 (new), the resolver suite 19 (Tag end to end), hardwareHandoff 45. Pushed from a detached worktree; S2's docs commit stays theirs. Your side: nothing — floor documents do not go through FormPreview's Order Details; the pick list reads `lines[]` as before.

- **⚠ DEPLOY NOTICE from S1 · 2026-09-12 · cce9f96 pushed at 19:18 EDT (S1 swept every served asset after the deploy: version stamp 1789255307636; `NO_NS_FORM_FOR_BRAND` + tab 7's `Not queued` in `main.da41a424.js` (nsTransmit + the engine) and `238.44f4e810.chunk.js` (tab 7); recorded in BRIEF_S1 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped: **(1) Vision's brackets follow the projection** — the engine's `normalizeChoice` is now idempotent (a normalized row re-normalized kept nothing of its depths: Vision hands `visionPickers` rows it already normalized for its axis questions, CPQ hands raw rows — 1,037 live H1-138 rows lost `projs`, 170 their tiered pair, `fitsExplicit` flipped on 1,354). One function in `Shared/hardwareModel`; Vision's files unchanged; every caller now gets the same answer once or twice. **(2) ONE NetSuite header for both doors** (E3 / STATE #22, Stuart: option 1): `Shared/nsHeader.nsTransactionHeader` — entity, subsidiary / location, the brand's custom form + class from the NEW `Shared/brandNetsuite.BRAND_NETSUITE_FORMS` (CE = quote 299 / SO 177 / class 2), memo, PO, internal memo, app job id, shipping (saved or custom; a charge rides with the ONE cached `resolveShipMethod`). **A brand with no form + class on file (M2C / Uniquity / Leyla today) REFUSES to queue with `NO_NS_FORM_FOR_BRAND`** — never a default form — until Eric's ids are entered in that map (one row per brand, no code). CPQ's push refuses through `buildNsTransaction` (RTG lists it in red via the refused stamp, Queue now works once the ids land); tab 7 refuses BEFORE writing anything (alert + log); tab 7's private ship-method lookup is gone. (3) Close-out item 1: the line-discount resolver suite registers its own loader, so the runner's plain `node --test` loads it. Tests: nsHeader 24 (new), hardwareModel 694 (+9), visionEngine 30 (+3), the resolver suite 18 (+3: CE header + M2C refusal end to end). Pushed from a detached worktree so S2's unpushed docs commit stayed local (the carry trap, closed). Your side: nothing (no floor document reads the header; the PickPack brand map import is untouched).

- **⚠ DEPLOY NOTICE from S2 · 2026-09-12 (evening) · $H — close-out items 1 + 4.** Hard-refresh + re-PIN before your next
  save. What ships: (1) the CPQ split's `shop_custom_orders.qty` = POLES (cut-length lines), never lines; new stamps
  `poles`, `feet`, `billableFeet` (rounded up), `riderLines` — S3: the custom plating demand + plater PO line bill feet
  (spec in your § 6); S1: nothing, the cart lines are unchanged. (2) `Shared/orderStatus.orderStatusOf`: a Pending custom half
  reads RELEASED · "not started"; a pick-only doc reads new stage NONE ("Not needed") · "pick only — no finishing"; the RTG
  sales-order card shows "· custom: <customFabLabel>". Readers of `orderStatusOf` / `STAGES` (WhereIsIt, OrderStatusChips,
  the CRM pipeline card) see the two new words; no document shape change beyond the four shop-doc stamps.
- **From S2, 2026-09-12 — the plater bills FEET (Stuart's rule, your half):** *"the pole with french return or miter return
  or straight pole anything pole for po to plater is always just the # of feet 1 pole x 8ft = 8 billable feet."* S2's split
  now writes the shop doc's `qty` as POLES (a custom line with a cut length is a pole; a return / miter / bend line is
  fabrication on it and adds nothing) and stamps `poles`, `feet` (poles × cut length ÷ 12, 2 dp), `billableFeet` (feet
  rounded UP to the whole foot — S2's assumption from "8 billable feet"; say if the plater bills exact feet) and
  `riderLines` on `shop_custom_orders` (`Shared/splitPlan.customShopQtyOf`, 4 assertions). **Ask:** (1) the custom plating
  demand the shop raises at Complete & Label (`ShopFloor.js` ~:1391, `qty: Number(order.qty) || 1`) carries
  `poles: order.qty`, `feet: order.feet`, `billableFeet: order.billableFeet` beside `qty`; (2) the plater PO line for a
  pole bills `billableFeet` at the per-foot rate (SO60420's "3 × H1-1R @ 10.00" becomes "8 ft × H1-1R @ <per-ft>"), the
  staged line shows "1 pole · 90" · 8 ft"; (3) the Order Entry custom pair (`<woId>-C`, written by S2's
  `oeReviewPlan` / `workOrderCreate`) will get the same stamps in S2's next pass — until then a missing `billableFeet`
  means "bill by qty as before". Downstream: shop card reads qty = poles (fewer pieces to count), demand + PO carry
  feet, RTG unchanged, NetSuite PO quantity becomes feet for pole lines.
- **⚠ DEPLOY NOTICE from S1 · 2026-09-12 · 4d09ce3 pushed at 17:27 EDT (S1 swept every served asset after the deploy: version stamp 1789248651987; the capturer's `asSet` key in `main.ac1c21f5.js` (both the capturer and the two Add sites live in main); recorded in BRIEF_S1 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped: **Add to cart captures the 3D pane AS THE OPERATOR LEFT IT** — both engines, one capture for the whole CPQ (Stuart 09-11: "however we set the image when we hit add to cart you should capture that view"). The shared `ViewCapturer` takes `{ current: true }` (no re-framing; the same white-ground ≤900px JPEG the quote / SO documents print); the tag-engine Add configuration and the old engine's add-to-cart both use it — old-engine lines carried no picture until now. The 📷 Capture Views packet pair (framed front + back) is unchanged. Cart-line field `renderSnapshot` only; documents print it; floors and NetSuite never read it; the saved job does not grow. **⚠ The push also CARRIED S2's local commit 60af70a** (brand → NetSuite map: StockViewTab / LibraryTab import `Shared/brandNetsuite`, CLAUDE.md) — it was committed-but-unpushed in the shared checkout; nothing of S2's was edited. Your side: nothing.

- **⚠ DEPLOY NOTICE from S2 · 2026-09-12 (afternoon) · 60af70a + $H.** Hard-refresh + re-PIN before your next save. What ships:
  (1) StockViewTab and LibraryTab import `Shared/brandNetsuite` — the last local copies of BRAND_NETSUITE_MAP are gone
  (CLAUDE.md corrected). (2) `finishedGoodsRun.stockCheckReport`: a component with NO NetSuite stock row is UNKNOWN
  (`have: null, short: 0, unknown: true`, listed in `unknownRows`, `warn: true`) — never a shortage; `ok` is about real
  shortages only. Readers: the Library card's two checks and the finished-run pre-check (S2's). S3: your Convert / make-up
  demand no longer receives a convert for an unknown row — expect fewer phantom converts. No document shape change.
- **From S2, 2026-09-12 — three decisions from Stuart for your file, relayed (his answers this morning: "2. yes, 3. yes,
  7. hand off"):** (1) **Retire the Setup Queue "⟲ Create Re-make WO" for STOCK** (`SetupQueue.js` `createRemake` ~:434, the
  direct `hq_work_orders` write behind it) — the Sales Snapshot is the re-make door for stock (a scrap shortfall is a
  reorder, not a floor re-issue); custom re-issue stays RTG's `INTENT.REISSUE`. Take the guide's "honest matrix" row
  ("Setup Queue · scrap re-make") with it. (2) **Delete the Setup Queue's outsourced group** (`:51–53`, `:594–597`) —
  outsourced finishes never enter the finishing floor since aacf078 / cfc613d; Stuart says delete. Confirm it renders
  empty on the tablet once, then delete. (3) **The receiving-tab receipt shape** (A's #40, you own the tab that reads it,
  S2 the writer `Shared/purchaseOrders`): per-line `receivedAt` / `receivedBy` on the PO line, and a separate
  `overQty` / `shortQty` on the line (never `scrapQty`, which means scrap); the PO-level `receivedAt` stays as the last
  receipt. Tell S2 the field names you settle on and the writer follows. Downstream: (1)(2) remove paths, nothing new
  reaches RTG / WMS / NetSuite; (3) fields only, no NetSuite change.
- **⚠ DEPLOY NOTICE from S2 · 2026-09-12 · eee33a3 · f9affc2 · 43d5ea9 · 65fb699 (six items, pushed together).** Hard-refresh + re-PIN
  before your next save. What ships: (1) RTG Board vs Floor **⟲ Reopen one** (any close, per order, from the closer's snapshot;
  also on "closed here, still live on the floor" rows). (2) Sales Snapshot **Display** column (S5's `system/display_demand_<brand>`)
  counted in Rec. (3) RTG transmit panel prints **FAILED** + NetSuite's error (or CANCELLED) for a queued job whose outbox entry
  failed. (4) No "close the balance in NetSuite" to-do when a fin doc says the build posted (closer + audit) — expect the 146 to
  drop. (5) `linkedDocsOf` finds a CPQ sales-order record by `soId` / `hqJobId` — **so `propagateFloorState` now stamps
  `floorPhase` on CPQ orders for the first time** (S3: your pack / put-away / plating calls start reaching SO-APP records; the
  board's "floor:" chip moves). (6) `releaseFinWoToFloor` → `buildFinDoc`; `executeMakeupActions` shop job → `buildShopDoc`
  (orderKey / note / phosphate flag unchanged); `clearConvertGate` STOCK branch → `releaseStockWoToFloor` (Route A, no RTG tab
  needed); `resetWoToSetup` → `propagateFloorState('Setup')`; RTG PO ✎ follows `poLock`. Document shapes: no new fields except
  `reopenedFrom` etc. already known. Your side: S3 — item 5 above; S5 — the Display column reads your doc as specified.
- **From S2, 2026-09-12 — the last RTG-tab dependency is yours:** `clearConvertGate`'s stock branch now releases through `releaseStockWoToFloor`; the WMS rod-cut completion (#12, spec in BRIEF_D "the rod-cut / convert completions RELEASE a stock order") is the remaining path that still waits for an open RTG tab. When it lands, RTG_CONTROL_BRIEF §1 becomes true in full.
- **⚠ DEPLOY NOTICE from S2 · 2026-09-11 · d50cce1 — the packing-list SHARED HALF (pushed now).** Hard-refresh +
  re-PIN before your next save. What ships: `Shared/packingList.js` (`packingListOf`, `invoiceLinesOf`, `packedQtyOf`)
  and `Shared/orderStatus` `inProduction` / `packedStateOf` / `CAN_REOPEN_IN_PRODUCTION`. Nothing on any screen changes
  until S1 (form + CRM card) and S3 (per-line count + SO Pack print) wire it — specs in their § Hand-offs in. No
  document or field shape changes in this push. Your side: nothing unless you are S1 or S3.
- **⚠ DEPLOY NOTICE from S5 · 2026-09-11 · 0a7bfa7 pushed at 19:23 EDT (S5 sweeps by chunk-hash match, recorded in BRIEF_S5 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped: 5. Marketing designer — Place… asks which row takes a cart configuration (a seeded row keeps its place and takes the CPQ lines + picture) and the picture prefers a cart line's `displaySnapshot` when present (S1: your hand-off in BRIEF_S1 §6 — the framed capture at Add configuration). `system/displays/entries/*` rows gain `replacedAt` / `config.replacedSeed`. No other document, no work order, no NetSuite write. Your side: nothing.

- **⚠ DEPLOY NOTICE from S5 · 2026-09-11 · db928f4 pushed at 18:58 EDT (S5 sweeps by matching the served chunk hash to the local build, then markers; recorded in BRIEF_S5 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped: 5. Marketing display designer — rows carry an `orientation` (vertical base poles stand in a base band on the tabletop's front face), a display carries `finishFlowId` (its chip board = that CPQ flow's tagged finishes, read from `cpq_flows` the way BOMTab's onboarding export reads them — read only), style extras seeded. Docs touched: `system/displays/entries/*` gain `finishFlowId`, rows gain `orientation`, faces gain `baseIn`. No other document, no work order, no NetSuite write. Your side: nothing.

- **⚠ DEPLOY NOTICE from S1 · 2026-09-11 · bcb3ecb pushed at 17:46 EDT (S1 swept every served asset after the deploy: version stamp 1789163433314; `Packing list — what was ordered beside what was packed` in `535.1c343f7c.chunk.js` (CRM), `differ` packing table in `483.f0343b5c / 872.3eec0dbf / 920.7102c967 chunks + main.aa8796bd.js` (FormPreview); recorded in BRIEF_S1 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped: **the PACKING LIST and the INVOICE on the CRM sales-order card** (S2's design, Stuart approved 09-11; S2's `Shared/packingList` + `Shared/orderStatus` halves, S1's form + card). (1) `Shared/FormPreview` PACKING_SLIP with `data.packing` renders the SAME header as the sales order plus SHIP DATE / TRACKING (— until UPS), columns Item · Description · Finish · Qty ordered · Qty shipped, no money, a red ● + status word on any line ≠ MATCH and a footer 'n lines differ from the order'; without `data.packing` it renders as before. (2) The CRM sales-order card reads the order's `hq_sales_orders` record (new per-customer listener, `customerId`; `SO-APP-<quoteNo>` or `hqJobId`): `inProduction` greys Modify / Reopen CPQ / Reopen Vision / Reopen Order Entry with 'in production since <date> — a manager can reopen', enabled for `canReopenInProduction(role)` (the CRM's OE_MANAGER_ROLES is now S2's `CAN_REOPEN_IN_PRODUCTION` — one list); when `packedStateOf(so, finDocs).packed` the card gains **📦 Packing list** and **🧾 Invoice**. (3) The Docs modal renders PACKING_SLIP (ordered = `customerDocLines(breakdown, 'PACKING_SLIP')` minus `isKit` parents; packed = the order's `fin_workorders`, or the SO doc for an Order Entry order — its row gains 📦 too) and INVOICE = the money reader's lines through `Shared/invoiceMath.invoiceDocOf`: nothing short → the invoice IS the order (+ shipping); something short/over → items at shipped $, every discount row pro-rated by shipped÷ordered goods, net-line subtotals dropped, fees in full, and the document's header line says so. Reads only — no job, floor doc or NetSuite write; the greying changes nothing on the floors. Your side: **the same builder prints the same list** — when your packer's per-line count (`packedLines.<key>.qty`) lands, the CRM's packing list reads it with no change here; until then a ticked line shows line-less-short (S2's fallback). The WMS print button is yours.

- **⚠ DEPLOY NOTICE from S5 · 2026-09-11 · 9f5c714 pushed at 17:47 EDT (S5 sweeps every served asset after the deploy and records it in BRIEF_S5 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped: 5. Marketing → Designs gains **⬆ Seed from tracker** — reads a display tracker workbook, resolves item codes against `Approved_Designs` (read only, chunked `in` queries), previews, and on Create writes ONE `system/displays/entries/{id}` document. No other document, no work order, no NetSuite write. Your side: nothing.

- **From S2, 2026-09-11 — the packer's COUNT on every pack tick, and a Packing List print on SO Pack (Stuart's
  design, approved):** the packing list must say what was PACKED. Today a pack tick is a yes (`packedLines.<key> =
  {at, by}`, `PickPackApp.js` ~:1560) and a pack completes only when every line is ticked. **Ask:** (1) at each tick
  the packer scans/counts into the box: write `packedLines.<key>.qty` (default = the line qty less any `pickShorts`
  short for that item, editable; refuse a negative; a count under the line qty asks "short — confirm?"); POLES are
  counted as PIECES (2 × 6 ft = qty 2), never length; the custom half's pieces must be pack lines too (a line per
  shop item on the pack document, or `packLinesOf` gains a CUSTOM line from the shop sibling — your call, tell S2 the
  key). Untick removes the qty with the tick. (2) On SO Pack, a **📦 Packing list** print button at the bottom of each
  PACKED order card, rendering S1's `FormPreview` type PACKING_SLIP through `printForm` with
  `Shared/packingList.packingListOf({ ordered, packDocs })` — `ordered` from the SO's job via
  `customerDocLines(job.cpqData.breakdown, 'PACKING_SLIP')` (S1's reader; a QUICKSHIP order passes its own SO doc as the
  pack doc and its `lines[]` as ordered) — so the floor prints the SAME list the CRM card shows. (3) `packedStateOf` /
  `inProduction` live in S2's `Shared/orderStatus` — read them, never re-derive. Downstream trace: `fin_workorders`
  (and QUICKSHIP `hq_sales_orders`) gain `packedLines.<key>.qty`; no NetSuite write; RTG and the CRM read the same
  documents. `Shared/packingList.packedQtyOf` already reads your qty first and falls back to line-less-short for
  ticks made before this lands, so nothing breaks in the gap.
- **⚠ DEPLOY NOTICE from S1 · 2026-09-11 · e9dfc1c pushed at 16:51 EDT (S1 swept every served asset after the deploy: version stamp 1789160062006; `item prices above are net of it` in `main.5a35f100.js` (tab 7), Shared/lineClassification ships inside the same `main.5a35f100.js` (its change carries no new string literal — the tab-7 literal in that bundle is the same commit), CRM print in `967.8c7b9ed6.chunk.js`; recorded in BRIEF_S1 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped: **(1) TAB 7 gets the set % at checkout** — `Order discount %` beside PO / sidemark; applied to every item line's RATE (kits and traverse footage included, fees excluded), rounded to cents per line, BEFORE the percentage fees — so the cart, the quote's breakdown, the invoice and the NetSuite lines are one sum by construction (no rollup, no discount line: NetSuite receives the net rates). It rides `quickShipExtras.soExtras.orderDiscountPercent` (edit / reopen restore it typed), the jobs quote doc and the `hq_sales_orders` header carry `orderDiscount { mode: ORDER_PERCENT | NONE, percent, by }` — the SAME field CPQ stamps (LINES / ORDER_PERCENT / CODE / NONE), now written by `soHeaderOf` for BOTH doors. The breakdown / invoiceLines gain one $0 display row saying the prices are net of it. **(2) MONEY DOCUMENTS ADD UP** — `Shared/lineClassification.customerDocLines` keeps the `isDiscount` / `isNetLine` rows on QUOTE / SALES_ORDER / INVOICE (they were dropped with the size echoes since 632569a, so a discounted quote printed gross lines and a smaller total with nothing saying why); the floors, WORK_ORDER, FULL_PACKET and every no-docType caller are unchanged. `reResolve` never renames a money row. Also live-read ✓ today: Vision Phase 2 round trip (CPQ line → Vision → re-save → Resume → Add REPLACES the line; draft deleted, nothing saved). Your side: nothing — no docType your screens pass is a money type; the pick list / router / finishing docs are unchanged (test: `scripts/customerDocLines.test.mjs`).

- **⚠ DEPLOY NOTICE from S1 · 2026-09-11 · 7d3f594 pushed at 16:28 EDT (S1 swept every served asset after the deploy: version stamp 1789158660457, `Line discounts are applied in the cart` + `Line discounts from the cart` in `main.74cee60a.js`, Vision chunk `104.74c087bc.chunk.js`; recorded in BRIEF_S1 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped: **(1) DISCOUNTS, the cart or the checkout, never both** — Stuart's redesign of S5's order-level ask: in the CPQ cart a manager or higher (admin / superadmin / manager / executive) ticks lines and applies a % off or sets a net unit price (`Shared/lineDiscount`, gross unit price never overwritten); at checkout a set % replaces the customer's code for the order. The job header stamps `orderDiscount { mode: LINES | ORDER_PERCENT | CODE | NONE, percent, code, by }`; cart items may carry `lineDiscount`; breakdown rows are `isDiscount` / `isNetLine` (+ `isLineDiscount`) — every floor consumer already skips them via `isDisplayOnlyLine`. NetSuite: a cart-discounted line pushes at its OWN lower rates (`nsTransmit` per-item `netFactor`), the set % / code ride the whole-quote scale as before; the Transmit Log names the mode. **(2) QUO147 'one splice shows 3'** — a reopen rebuilt hand-added extras from breakdown rows by doc id and the length step auto-added its joiner by code, one more per cycle; now `engineConfig.extras` is saved as typed and a legacy line reopens merged one row per item (`Shared/extrasRestore`). **(3) QUO142 in Vision 'keeps asking for a bracket'** — the Save Line gate now reads the engine's own left bracket picker (`visionEngine.engineEndSettled`): a return / inside mount that locks it counts as settled. `cpqData.totalPrice` stays the one net number. Work orders / finishing / shop / WMS / Sales Snapshot untouched. Your side: nothing — the new rows are display-only and never reach a pick, a router or a finishing doc.

- **⚠ DEPLOY NOTICE from S5 · 2026-09-11 · d3c6777 pushed at 15:37 EDT (S5 sweeps every served asset after the deploy and records it in BRIEF_S5 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped: **display BUILD ORDERS** — on 5. Marketing (Designs | Build orders toggle) and as ONE guarded mount at the top of 10.5 Project Mgmt: a display × qty × customer × SO/PO, ship plan, the tracker's per-line columns (WO#, at plater, notes, done), boards built → open demand. Writes `system/displays/builds/{id}` and `system/display_demand_<brand>` (new; the open demand per item, recomputed on every save/delete). **Never writes `jobs`** (a build there would be a phantom quote on the CRM / RTG / tab 12). No work order, floor document or NetSuite write. Your side: nothing — no floor document; the chip demand in the record is sized for a sample-chip run you already manage.

- **⚠ DEPLOY NOTICE from S5 · 2026-09-11 · b3fd59f pushed at 14:51 EDT (S5 sweeps every served asset after the deploy and records it in BRIEF_S5 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped: **5. Marketing is no longer an empty label — the Sales Display Designer** (Stuart's new ask, 09-11): design a tabletop or wall display to scale, rows taken from the SHARED CPQ cart (HQ.js passes `globalCart` to the new tab — the cart is read, never changed), the chip face laid out from `system/master_finishes` + `hq_outsource_finishes`, the bill of one board computed (`Shared/displayBom`). Writes: `system/displays/entries/{id}` (new, under the system rule — no rules deploy) and `global_assets` docs with `productType: DISPLAY CAPTURE` / `displayCapture: true` (`saveGuideCapture` gained a `kind`; guide captures unchanged). No job, work order, floor document, snapshot or NetSuite write. The push also carried S2's docs-only c0f562d (a notice stamp for 5ba0da3, already live) — it had sat unpushed 10+ minutes. Your side: nothing — chips stay on your Sample Chips screen; the designer only counts them.

- **⚠ DEPLOY NOTICE from S2 · 2026-09-11 · refused quotes on RTG — 5ba0da3 PUSHED.** Hard-refresh + re-PIN before your next save. What ships: RTG's ⇄ Quotes & Sales Orders panel lists any `jobs` doc carrying
  `nsTransmitRefusedAt` (S1's stamp, 2c61b3e) in red as REFUSED — <code> with the message, and a **⇄ Queue now** that calls
  `Shared/nsTransmit.queueNsTransaction` with the whole library (fetched once per session, as tab 12 reads it): a job with
  status APPROVED re-queues as a SALES ORDER with the `SO-APP-<quoteNo>` board write-back, anything else as an ESTIMATE;
  success writes `nsTransmitQueuedAt/OutboxId` + clears the three refused fields (S1's contract); a fresh refusal renews
  the stamp. Jobs document only; no floor doc; a NetSuite write only after the person presses. Guide paragraph added.
  RTGDispatchTab + UserGuideTab only. Your side: nothing.
- **⚠ DEPLOY NOTICE from S1 · 2026-09-11 · 2b164a5 pushed at 09:59 EDT.** Hard-refresh + re-PIN before your next save.
  What shipped (Vision Phase 2): CPQ cart lines on the tag engine gain a **Vision** button (line → draft on the board);
  a Vision re-save of a line CPQ already holds REPLACES that line on Resume instead of adding one. `cpq_drafts` gains
  optional `cartItemId` / `openedFromCpqAt` (status `DRAFT_FROM_CPQ`); cart lines gain `visionDraftId`. Jobs / floors /
  NetSuite untouched until a re-finalize. Your side: nothing.

- **⚠ DEPLOY NOTICE from S1 · 2026-09-11 · 3c0e101 pushed at 08:33 EDT.** Hard-refresh + re-PIN before your next save.
  What shipped (Vision Phase 1b): on a flow with a pinned assembly, Vision Hardware's hardware pickers (ends, brackets,
  plates; rear ends on a double) come from the engine's slots with the engine's locks and reasons; a saved line carries
  `specs.enginePicks`; Push to CPQ waits for acknowledged removals. Flows without pins: unchanged. `cpq_drafts` gains the
  optional `specs.enginePicks` array. Board / placement / cut sheet / engineeringNotes shape unchanged. Your side: nothing — the cut sheet the shop reads is produced by the same board.

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
  shape change. Your side: nothing — an order can no longer be added short of a part the operator chose.

- **⚠ DEPLOY NOTICE from S1 · 2026-09-10 · 2c61b3e pushed at 22:34 EDT (S1 sweeps the served bundle after the deploy
  and records it in BRIEF_S1 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped: a REFUSED NetSuite
  queue at CPQ save is stamped on the `jobs` doc — `nsTransmitRefusedAt` (ms), `nsTransmitRefusedCode`,
  `nsTransmitRefusedMessage` (≤500 chars) — in both save branches and the catch; a later successful queue (CPQ save or
  tab 12 push) removes all three with `deleteField()` in the write that stamps `nsTransmitQueuedAt`. Jobs document only;
  no floor document, no NetSuite write. Your side: nothing.

- **⚠ DEPLOY NOTICE from S1 · 2026-09-10 · 38b1ba6 pushed at 22:08 EDT (S1 sweeps the served bundle after the deploy
  and records it in BRIEF_S1 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped: the H1-138TRV kit
  explosion re-keyed to S5's correction — an ARM by depth (SBA/EBA/6BA/DBA/CBA) plus a BACKPLATE by orientation
  (BP-H/BP-V/BP-C) per bracket position, both at the chart count; no sheet combo code is ever consumed. H1-2TRV
  unchanged. No document or field shape change. Your side: an H1-138TRV kit's STOCK pick now carries the plate line beside the arm (one per bracket) — that line was silently missing before.

- **⚠ DEPLOY NOTICE from S5 · 2026-09-10 · 105b29c pushed at 20:29 EDT (S5 sweeps every served asset after the
  deploy and records it in BRIEF_S5 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped: the
  H1-138TRV kit import corrected — Fabricut's "bracket" codes are arm + backplate here (the H1-138 pins carry arms
  SBA/EBA/6BA/DBA/CBA by depth and plates BP-H/BP-V/BP-C by orientation); the derived `system/traverse_rules_H1-138TRV`
  now keys those codes (a plate row per orientation, "one per bracket"); the 18 combo prices land on the arms' Fabricut
  rows (/P and every /EPn + /P25 that exists) with $0 plate rows; `H1_138TRV_PARTS` export re-shaped (`brackets.SINGLE`
  by depth, DOUBLE/CEILING strings, new `plates`). Verified first that re-applying the sheet rewrites every H1-2TRV kit
  and component row identical. No existing document or field shape changed; nothing written until Stuart applies. Your side: when S1 lands the plate line, an H1-138TRV tab-7 order consumes one backplate per bracket (a pick line that was missing from the first entry); nothing until then.

- **⚠ DEPLOY NOTICE from S1 · 2026-09-10 · bb5b5e1 pushed at 19:48 EDT (S1 sweeps the served bundle after the deploy
  and records it in BRIEF_S1 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped: tag engine —
  **a backplate follows its arm**: un-picking the return (or any arm) at a position drops the plate chosen for it
  instead of re-seating it under a bracket nobody has chosen; changing bracket still keeps the plate. No document or
  field shape change. Your side: nothing.

- **⚠ DEPLOY NOTICE from S1 · 2026-09-10 · 9415338 pushed at 19:23 EDT (S1 sweeps the served bundle after the deploy
  and records it in BRIEF_S1 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped (S5's kit hand-off,
  S1's half): the kit explosion knows the **H1-138TRV** family (rod as the one per-foot part, brackets by style H/V,
  joiner as the splice, returns stay the fee items on the end steps); CPQ and tab 7 read `system/traverse_rules_<family>`
  from the flow's / kit's `kitFamily` instead of the fixed H1-2TRV document. H1-2TRV explodes exactly as before.
  No document or field shape change; the H1-138TRV rules document is S5's importer's to write. Your side: an H1-138TRV kit's components arrive on the STOCK pick like H1-2TRV's; the brackets carry the customer's finish code (no base colour) — the floor sheet will say so.

- **⚠ DEPLOY NOTICE from S1 · 2026-09-10 · 6572b6f pushed at 18:17 EDT (S1 sweeps the served bundle after the deploy
  and records it in BRIEF_S1 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped: tag engine —
  **parked geometry never rides**: a pin with no item number (`parked`, or a `HIDDEN-<node>` id) is no longer a rider, so
  new quotes lose their $0 `HIDDEN-…` placeholder breakdown lines. Real hidden parts with an item ride as before. No
  document or field shape change. Your side: nothing — pickLines already treated HIDDEN- as no real part; those lines simply stop arriving on new orders.

- **⚠ DEPLOY NOTICE from S5 · 2026-09-10 · 09104cf pushed at 17:45 EDT (S5 sweeps every served asset after the
  deploy and records it in BRIEF_S5 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped: the
  H1-138TRV kits — `Shared/kitCode` reads a second grammar `H1-138TRV-4(H|V)D?/(P|EP)` (a parsed align now may carry
  `rodKind` and `bracketStyle`; `axesKeyOf` gained a sixth field, blank on every H1-2TRV kit); `Shared/kitSeed`
  answers `rodKind` as an axis when the kit carries it (H1-2TRV kits do not — untouched) and reports the bracket
  style; the 4.6 kit-sheet import reads tab H1-138TRV and writes, on Apply, 8 `Approved_Designs` Kit records
  (`kitFamily: H1-138TRV`), 19 `clientPricing` rows on existing bracket/splice items, and `system/traverse_rules_H1-138TRV`
  (derived from the H1-2TRV usage table). No document or field shape changed for existing records; nothing is
  written until Stuart applies the import. Your side: nothing until S1 lands the explosion entry — until then a tab-7 H1-138TRV kit explodes NO components (no NetSuite consumption lines, nothing extra on the WMS STOCK pick).

- **⚠ DEPLOY NOTICE from S1 · 2026-09-10 · e4ab15a pushed at 17:30 EDT (S1 sweeps the served bundle after the deploy
  and records it in BRIEF_S1 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped: a new pin tag
  **`ridesWith: RETURN`** (1.6 tag row, beside "hide": rides the rod / rides a return) — a hidden rider so tagged reaches
  the BOM only when a miter or French return is chosen on the order AND its rod is on the order (never a single). Built
  for the H1-138 standoffs of the short rear rod (`1.6 #72 / 1.5 #68`); H1-1's `#31/#32` get the same. Untagged
  riders unchanged. Docs: `assembly_pins` gains the optional field `ridesWith`. Your side: pick lists / floor sheets lose the return standoffs on plain doubles once Stuart tags the pins — that is the intent ("it will confuse the floor").

- **⚠ DEPLOY NOTICE from S1 · 2026-09-10 · bd5907e pushed at 15:07 EDT (S1 sweeps the served bundle after the deploy
  and records it in BRIEF_S1 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped: the tag
  engine's step order is ONE order for every flow — Rod Setup → Rod → Rod length → Ends (front L, R, then rear)
  → Bracket → Backplate → Rings → Accessories (`Shared/hardwareModel` rank; `HardwareConfigurator` length step).
  Consequence you may notice: the BOM / quote lines follow the slot order, so a NEW quote lists the rod first,
  then ends, brackets, plates, rings — identities, quantities and prices unchanged; older quotes keep the order
  they were saved with. No document or field shape changed. Your side: pick lists and floor sheets from new quotes list rod → ends → brackets → plates → rings; nothing to do.

- **⚠ DEPLOY NOTICE from S2 · 2026-09-10 · Issue 2 PREVENTION (push pending Stuart's word) — hard-refresh + re-PIN when it
  lands.** `Shared/orderLifecycle`: (1) `isDoneState` no longer reads a finishing doc's `currentPhase 'Complete'` as done —
  DONE = `packStatus 'Packed'` (also the stock put-away) / shop `Completed` / `Built` / closed; a pick-only doc is not done
  until packed. **S3: `isDoneState` is not imported by your files, but if any WMS/finishing screen relied on "Complete =
  done" via the audit, say so.** (2) new `recordKnowsDone(p)` = done OR `floorPhase` in Complete/Packed/Shelved/Plated.
  (3) `auditOrphans` raises FLOOR_DONE once per RECORD, only when EVERY linked floor doc is done and the record neither is
  closed nor knows (`floors[]` on the finding). (4) `closeOrderEverywhere` stamps `stateBeforeClose` on every fin / shop /
  hq doc it closes (the fields it overwrites) and the reopen restores from it exactly. (5) RTG: no "Close all" on FLOOR_DONE.
  No writer, no floor screen, no NetSuite write changed.
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
  is NOT updated by the edit. Your side: the WMS pick reads `so.needBy` / `so.sidemark` live; floor docs already released keep their copy — named for S2/S3, not built.

- **⚠ DEPLOY NOTICE from S2 · 2026-09-10 · second push (reopen rules corrected after the first dry run) — hard-refresh
  + re-PIN again.** Three rules changed in `Shared/orderLifecycle.reopenPlanFor` before anything was written: (1) on a
  sales order a fin doc with `nsFulfillQueued` / `nsIfTran` is SHIPPED and stays closed (14 July/August Brimar orders
  would otherwise have come back onto the WMS); (2) a shop half reopened by hand after the close keeps its status and
  loses the `closed: true` flag the bulk close set (the shop's Reopen never clears it, so Livio's six were still hidden —
  S3: that is a defect in `ShopFloor.js undoComplete` worth a line in your queue); (3) a cancelled `ns_outbox` entry that
  had `lastError` / `attempts` goes back to FAILED (11.1 Retry by hand), only a clean one to PENDING. No other code changed.
  **Plus the operator override** (Stuart: of the packed orders "keep open only SO60151, SO60152"): every finishing / shop row on
  the dry-run list has "⟲ reopen anyway" (on a KEEP) or "✕ keep closed" (on a RESTORE); the order's other documents follow;
  the written doc carries `reopenOverride: 'REOPEN'|'KEEP'` + `reopenOverrideBy`.
- **⚠ DEPLOY NOTICE from S1 · 2026-09-10 · a58d126 is LIVE (verified in the served `main.d8130142.js`; it
  rode S2's 10:07 deploy).** What shipped: `Shared/nsTransmit`'s TAGS branch now SKIPS a parked-geometry line
  (partId `HIDDEN-<node>`, no money) instead of refusing the whole transaction as LINES_UNRESOLVED; the
  predicate is `Shared/lineClassification.isParkedGeometryLine` (11-assertion harness). Effect: every H1-138
  quote (and Sinaya's Thom Filicia quotes) had silently failed to queue its NetSuite estimate since 21 Aug —
  from this bundle on, a CPQ save queues it. No Firestore document or field changed shape; `ns_outbox` simply
  gains the estimate entries it was missing. Your side: nothing on the floors or in the WMS reads the outbox payload for these lines; `pickLines` already treated `HIDDEN-` as no real part. Re-PIN is the one S2's deploy already required.

- **⚠ DEPLOY NOTICE from S2 · 2026-09-10 · 6c72e80 is LIVE (verified in the served bundle).** Production
  changed under you: hard-refresh (⌘⇧R) and re-PIN before your next save — CPQ save-is-send refuses on a stale
  bundle. What shipped: `Shared/orderLifecycle` gains `reopenPlanFor` / `planBulkReopen` / `applyBulkReopen`
  (pure; 66 assertions) and RTG's Board vs Floor panel gains **⟲ Reopen a bulk close** — the recovery for this
  morning's "Close all" that closed live orders (dry run → confirm → write, ledgered `BULK_CLOSE_REOPEN`). Docs
  it touches: `fin_workorders` (restored `currentPhase / stepStatus / sentToPickPack / pickStatus`, new
  `reopenConfirmPick`, `reopenedAt/By/From`, `reopenRunId`, `reopenedFromClose`), `shop_custom_orders` (`status`
  restored, `closed` removed), `hq_work_orders` / `hq_sales_orders` (`status` restored, `nsWoCloseRequired`
  removed), `rod_cut_orders` (CANCELLED → OPEN for reopened orders), `ns_outbox` (CANCELLED → PENDING for the
  writes the close cancelled). Nothing in your territory's code changed. The push also carried S1's a58d126.
- **From S2:** #16 (retire the Setup Queue re-make for stock); #12 (rod-cut completion → `releaseStockWoToFloor`);
  #32 (delete the outsourced group once S2 says empty). Specs referenced above.
- **From S2, 2026-09-10 — the bulk-close REOPEN chip (`reopenConfirmPick`).** This morning's "Close all" on
  Board vs Floor closed live orders; S2's reopen tool (RTG → Board vs Floor → ⟲ Reopen a bulk close) restores
  each `fin_workorders` doc from its own stamps. The closer had overwritten `pickStatus`, so a reopened doc's
  pick state is RECONSTRUCTED from `stagedAt` / `pickedAt` (else `'Pending'`) and the doc is stamped
  `reopenConfirmPick: true`, `reopenedAt`, `reopenedBy`, `reopenedFrom: 'RTG_BULK_REOPEN'`, `reopenRunId`, with
  the close kept in `reopenedFromClose`. **Ask:** (1) WMS — on the pick queue row / pick detail
  (`PickPackApp.js` where `isOpenPick`, ~:1162, and the pick-list card) show a red chip "REOPENED — confirm pick
  state" while `reopenConfirmPick === true`, and clear it (`reopenConfirmPick: false`, `reopenConfirmedBy/At`)
  when the operator confirms or completes the pick; refuse nothing. (2) Setup Queue / Active Floor — a reopened
  doc carries its restored `currentPhase` (`Setup` / `Painting` at the recorded `currentStepIndex`, `stepStatus
  'Staged'`) and needs no new read; only verify on the tablet that a Painting doc reappears on the Active Floor
  and a Setup doc in the Setup Queue. Downstream trace: work orders unchanged (record back to Dispatched);
  finishing sees the doc at its recorded step; shop unchanged; WMS sees the pick/pack rows return with the
  chip; NetSuite: the queued writes the close cancelled return to PENDING (the worker posts them; dedupeKey
  guards the double post). Nothing else in the WMS needs to change for the chip to be safe to ignore.

- **From S4 (when they start):** ONE guarded mount for the Fulfilment tab in `PickPackApp.js` + a row in
  `Shared/pickTabs.PICK_TABS` (a new tab key is permission identity — an admin ticks it per role).

## 7. Status log

*(newest first)*

- **2026-09-15 — 8c0677e pushed 19:46 EDT (S3): App Imp card 2, the Hand bench knows which coat** (Stuart: "go ahead and
  build it, go ahead and do it for the small parts hand task as well"). Live read with Stuart pinned in (fiber props for
  the two docs; `fin_logs` by `woId` through the page's own Firestore module): WO11610 Anne poleHand 10:10–10:48 → ADVANCE
  coat 3 → Jhonaton sprayed/baked coat 4 → Complete 3:16 PM; WO11612 Anne 11:31–1:09 PM → ADVANCE → Rafa coat 4 next
  morning → Complete 9:19 AM. SG-P = DTM7 / Soft Gold / WB-RGWS-001 hand / 30 Sheen — coat 4 sprayed. Cause: the HAND
  station listed `poleHand` for every pole order regardless of coat and the advance resets the status (stamps kept, not
  shown). `ActiveFloor.js`: `currentPartsStep` / `currentPoleStep`, HAND station `pushNote` rows ("not this coat"),
  `lastDoneOf(t)` history line on the panel + station chips, `manualTask` COMPLETE stamps `completedCoat`, the off-ramp
  hand card gated on `woHasSmallParts` and its direct Complete stamps completedAt/By/Via 'tablet'/Coat. Lint 0, full build
  passed, safe-push = one commit. **Sweep 19:49 EDT:** stamp 1789516133901 after the push; 37 JS assets, all fetched with
  `curl -sf` (8,605,115 bytes, 0 failures); `no hand step this coat` ×1 and `this coat not yet` ×1 in `main.030b0dce.js`.
  **LIVE.** Admitted: a stray `onSnapshot` on `fin_logs` was started while identifying the SDK's exports (read-only,
  dropped by the reload). Card note given to Stuart to paste.

- **2026-09-15 — bb031e2 + 3cd1c68 pushed 17:53 EDT, 3658a0d pushed 17:58 EDT (S3): App Imp cards 1 + 5, then the backorder
  hold** (Stuart: "both, build and push"). Cards: `completeBlocker` under ✓ Complete Packing + the empty-box note;
  `shopLabelCuts` / `printShopCompletionLabel({ cuts })` one label per cut length. Hold: `holdGateOf` in
  `Shared/OrderStatusChips.js` (mine) — kind BACKORDER (`heldReasonKind`) vs STOP, `floorMayRelease` false for BACKORDER;
  Setup Queue lane + `heldRefusal` on startSetup / stageToFloor / resumeOrder; Active Floor `heldRefusal` on
  handleCompleteRecipeStep / handleCompletePoleStep / manual `run`, TaskCard folds the hold into `blockReason` and guards
  the direct mark-complete buttons; SchedulePlanner filters held docs out of `buildFinishingPlan`; WMS pick queue row band,
  START PICKING disabled + refused, `releasePendingNow` + `resumeOrderHere` refused for BACKORDER; both HeldOrdersBanners
  now list STOP holds only (S2's banner untouched). Lint 0 on all five files, full build passed, safe-push check ran as its
  own step both times (one commit each). **Sweeps:** cards — stamp 1789509368096 after the push, 37 assets, 8,597,328
  bytes, 0 failures, `waits for: ` ×1 + `no boxes for this brand` ×1 in `main.74700768.js` (+ the changelog copy in
  `514.a0d63850.chunk.js`); hold — stamp 1789509757984, 37 assets, 8,602,725 bytes, 0 failures, `WAITING ON BACKORDER`
  ×1 and `is held by RTG, not the` ×1 in `main.12a5d97b.js`. **LIVE.** Acceptance owed: WO-SO60428 / 60430 / 60432 in
  the Setup Queue lane with no Start; WO-SO60429 on the pick queue with the band and a dead START PICKING; a STOP raised
  mid-paint refusing the next coat. App Imp card notes given to Stuart to paste (cards 1, 4, 5).

- **2026-09-15 (S3) — answers out, two repairs built and held for Stuart's push.** (1) S2's bent-return question answered in
  BRIEF_S2 §6: **(a)**, one doc with both streams (the Active Floor already completes only when both are done); field names
  confirmed; my addition = `packLinesOf` skips `partsList` lines with `stream: "POLES"` so a stocked return packs once as a
  POLE row — ships the hour S2 pushes the split. (2) S1's two-finishes check answered (BRIEF_S2 §6 + S1 §6): suffixed ids
  break nothing of mine; `resolveByExactKey` breaks on a SHARED `orderKey` — recommended own key per sibling. (3) S1's
  backorder-hold spec: mine to build on the floors, plan to Stuart next. Built, lint 0, full build green, awaiting "push":
  App Imp card 1 (Complete Packing prints its first unmet reason + the empty-box note, `PickPackApp.js`) and card 5 (one
  shop completion label per cut length, ZPL + HTML, `ShopFloor.js` + `Shared/labelPrint.js`). Card 4 (Setup Queue stage
  path) SKIPPED by Stuart: "we like how it works". Card 2 (HF pending) waits for the live read with Stuart pinned in.

- **2026-09-13 — 6a8f1c1 pushed 17:24 EDT (S3): close-out #14, the JFP double-post** (Stuart 09-12 "yes to all three"; the
  go relayed 09-13 12:53 as "close-out item 4"). `PickPackApp.js`: `jfpOutboxEntry(job)` (newest `ns_outbox` entry whose
  `writeBack.docId` is the fin doc and `idField === 'jfpAdjId'` — covers entries queued before the key existed);
  `redoPutaway` refuses while that entry is PENDING/POSTING ("wait a minute or check 11.1") or POSTED ("nothing to redo");
  `completePacking` refuses up front for a paint-only order with `jfpAdjQueued || jfpAdjPosted` (names `jfpAdjTran`); both
  enqueues carry `dedupeKey: jfp-adj:${job.id}`. #35 pack scrap: a different shape (each report is a count the packer
  types; two reports are two events) — named, left. Named too: the JFP pull adjustment at pick confirm has no guard
  against re-confirming a line after a reopened pick (belongs with the reopen work). Lint 0, full build passed,
  safe-push = one commit. **Sweep 17:27 EDT:** first stamp 1789338315036 was S1's f29c4db build finishing 27 s after my
  push (0 hits — correctly ignored); stamp 1789338473163 is mine: 37 JS assets, all fetched with `curl -sf` (8,595,635
  bytes, 0 failures); `a second scan would double the stock` ×1 and `still in the NetSuite Sync Queue` ×1 in
  `main.b99de1bd.js`. **LIVE.** Acceptance owed on the floor: JFP put-away scanned twice → one outbox entry, second scan
  refused; ↩ inside a minute → refused; bad bin → FAILED → ↩ allowed → one new entry.

- **CLOSE-OUT CONFIRMED 2026-09-12 (S3):** items #14 (+#35 looked at) → #16 + #32 → #12 → #33 (queued, per Stuart) → #18,
  #19, #40 (names to S2) → #34, #36, #42, #43 → the plater-PO feet line once S2 writes the field names into § 6 → live runs
  with Stuart pinned in (sales-typed build at pack, C4, three ⛏ posts, first REPACK, first CE pack closing with a box).
  Stuart's three answers recorded in § 5. ETA: the code items through 09-13; the live runs as Stuart's orders come.

- **2026-09-12 — 6ac41ac pushed 17:13 EDT (S3): HQ 15 Standard boxes tool** (Stuart: "tab 15 needs a tool to add the size
  of the box and save … or i am missing it"). It existed but hidden: the "Save" beside "Load Standard…" wrote the foam W×H
  as a box through two `prompt()`s, brand-tagged to whatever HQ was switched to, with no list or delete. Now a **Standard
  boxes** section in the right panel: `visibleBoxes` (active brand + global), Load-to-workspace, ✕ delete (confirm; closed
  packs keep the name they recorded), add form with name / W / H / D / scope (`brandId` = active brand or `'global'`) /
  small-parts tick (`usage:'small_parts'`), duplicate-name and zero-size refusals; "Save as box" and "Use workspace" fill
  W×H from the sheet. The BOM panel's small-parts card now reads the brand's flagged box, then a global one, then the
  18×12×4 fallback (its old lookup could never match). `HQ/PackagingTab.js` only; `standard_boxes` shape unchanged;
  rules already `isAuth()` read/write. Lint 0, full build passed, safe-push = one commit. **Sweep 17:16 EDT:** stamp
  1789247750342 (after the push); 37 JS assets, all fetched with `curl -sf` (8,571,679 bytes, 0 failures);
  `Save as box` ×1 and `cannot close a pack until one exists` ×1 in `107.e475b1b6.chunk.js` (tab 15's chunk), the
  changelog copy ×1 in `main.7cb49573.js`. **LIVE.** Owed by Stuart: CE's boxes, then the first CE pack closing with one.

- **2026-09-11 — 1d02231 pushed 22:47 EDT (S3): the two remaining defects** (Stuart: "go ahead now and fix all the open
  defects"). `isOvertakenPick` returns false for `pickOnly` / `finishingRequired === false` documents; `ShopFloor.js
  undoComplete` refuses when any live `plating_shipments` line exists for the WO, worded by status (staged / at the plater /
  built) — the refusal is the shop's own so S2's `cancelPlatingDemand` stays as is. Lint 0, build passed, safe-push = one
  commit. **Sweep 22:51 EDT:** stamp 1789181450247 (after the push); 38 JS assets, all fetched with `curl -sf`
  (8,561,495 bytes, 0 failures); `the WMS removes that staged line first` ×1 in `main.9d943d3a.js`; the pick-only
  change is logic-only (no emitted string) — verified by the build, to be seen on the next pick-only order's row. **LIVE.**

- **2026-09-11 — a8bb6a8 pushed 22:39 EDT (S3): Stuart's four rulings** ("1. you combine with the rod, they are a
  fabricating fee, once the shop confirms complete they are complete along with the pole. 2. force box choice. 3. for
  you to figure out. 4. packaging prep can pick and pack ready parts on a plating order before the poles arrive."). Built:
  riders (`poleDetailsOf.riders`, `packLinesOf` POLE-i-Rj lines, ticked/cleared with the pole, note under it); box choice
  forced at Complete (+ button off); memo `<shipId> Weekly Plating Shipment` (the 40-char `nsMemo` cap was cutting the id —
  question 3 answered) + legacy-shape match in the lookup; pole line un-tickable "At the plater", waiver hidden, Complete
  refuses until `customPartsReady`. `pickLines.test.mjs` 58 → 63. Lint 0, build passed, safe-push = one commit. Run doc 9a
  corrected. **Sweep 22:44 EDT:** stamp 1789180967141 (after the push); 38 JS assets, all fetched with `curl -sf`
  (8,561,345 bytes, 0 failures); `on the rod, packed with it` ×1, `ticks when the pole is received` ×1 and `Pick the box`
  ×1 in `main.da8db0d3.js`. **LIVE.** Acceptance still owed on the floor: the first plating order packed early (small
  parts ticked while the pole reads "At the plater", Complete refused, then closed after put-away), the first pack with
  riders reading MATCH on the packing list, and CE's standard boxes added in HQ 15 so a box can be chosen at all.

- **2026-09-11 22:30 — THE PLATING ROUND TRIP IS COMPLETE END TO END on SO60420** (`PLATING_ROUND_TRIP_SO60420.md`).
  After 8b2e6b1 went live: ⟳ FIND NETSUITE PO found **PO2316** in the vendor's recent POs (the PO had been created at
  Ship; the memo SuiteQL lookup misses it — open question) → stamped, no re-post → Receive → item receipt **IR22105**
  POSTED via the outbox (11.1) → cart → custom put-away into `HP Plating` with NO NetSuite build → the finishing document
  read `customFabStatus 'Complete'` (WMS chip "fabrication done", RTG job log the same) → pack: 9 lines incl. **the pole
  H1-1R by code** (8b2e6b1), both halves matched, photo, COMPLETE → `packStatus 'Packed'`, fulfilment queued → 11.1
  FAILED "Items list: Location" (the known S4/Eric wall) → **CRM packing list reads `H1-1R · ordered 1 · shipped 1`**.
  Findings for the queue: the two French returns (`H1-FRPF`, shop custom lines with no cut length) read NOT PACKED —
  S3 (a) every shop custom line becomes a pack row, or S1 (b) fabrication-on-the-rod items leave the packing slip; the CE
  standard box list is empty so packs complete with no box; the memo lookup vs vendor-list discrepancy. Open defects
  (mine) unchanged: Packaging Prep packs while the pole is at the plater; false "overtaken pick" on pick-only docs; shop
  Undo between scan-in and Ship. **§3 item 1 is DONE.**

- **2026-09-11 — 8b2e6b1 pushed 21:17 EDT (S3): the pole packed by its code + 🖨 Packing list on the WMS.** Stuart's CRM
  question ("none of the poles are showing packed … i do not see this same packing slip on the wms") → cause read in
  `Shared/packingList` (S2) + `Shared/pickLines.packLinesOf`: the list pairs by code; the finishing doc had no pole line by
  code. Built: `poleDetailsOf` rows carry `code`; `packLinesOf(job, { poleRows })` → POLE-i lines by code (live rows or the
  `poleLines` stamp); WMS pack workspace lists the poles to tick, ticks write `qty`, first pole tick + pack completion stamp
  `poleLines`; 🖨 Packing list on the pack workspace / Recently Packed / SO Pack via `packingListOf` + `FormPreview` +
  `printForm` (S1's, imported). `scripts/pickLines.test.mjs` 48 → 58. Lint 0, build passed, safe-push = one commit. Stuart:
  "go ahead on all of them". **Sweep 21:48 EDT:** stamp 1789177611978 (after the push); 38 JS assets, all fetched with
  `curl -sf` (8,558,128 bytes, 0 failures); `The packing list needs the order` ×1, `poleLines` ×1 and `NUMBER NOT RECOVERED`
  ×1 in `main.38da7e40.js`. **LIVE** (both pushes in one bundle). Not yet run by an operator: the first pole tick and the
  first WMS packing-list print are the acceptance runs — SO60420 continues on this bundle.
- **2026-09-11 — 1e5e5a4 pushed 18:35 EDT (S3): the plater PO keeps its NetSuite number.** Found live on SO60420: Receive
  refused ("no NetSuite PO id on file") because the ship step's one immediate memo lookup found nothing and nothing retried;
  Stuart: no such PO in NetSuite. Built: retry ×5 over 10 s at Ship; `nsPoPending` + "NUMBER NOT RECOVERED" alert (never
  "pending sync"); ⟳ FIND NETSUITE PO on the Out-at-plater row (memo lookup → vendor's last-3-days POs → guarded re-post
  through the now-shared `buildPlatingPoDescription` / `buildPlatingPoPayload`); Reset refuses with a number on file.
  Sweep 18:38: stamp 1789167933768; 40 assets, 0 failures; `NUMBER NOT RECOVERED` ×1 and `Find NetSuite PO` ×1 in
  `main.74173426.js`. **LIVE.**
- **2026-09-11 — the SO60420 plating round trip, live, Stuart pinned in** — `PLATING_ROUND_TRIP_SO60420.md` (expected vs
  seen, screenshots per step). ✓ §0 split · §1 Start · §2 pick row · §2b pick · §3 Complete & Label · §4 Undo + Complete
  again · §5 scan-in · §6 Ship · §6a undo-after-ship refusal. ✗ §7 Receive blocked (PO number → 1e5e5a4). ✗ §9a Packaging
  Prep packs at the plater (defect, mine). Named: overtaken-pick banner on pick-only docs; Undo between scan-in and Ship;
  shop doc qty = lines (S2); ✎ EDIT PO on a sent plating PO (S2); standoffs picked bare while the quote says EP3 (S1).
  Driving note: native confirm/alert/print dialogs freeze the Chrome tools — override them in the tab and read the captured
  text (the run doc has every dialog's words).

- **2026-09-11 — 47c2b6b pushed 12:25 EDT (S3): the plating links + custom put-away, and the Convert scroll.** Stuart:
  "yes fix the plating links" (approval of the 09-10 plan); the NetSuite-at-return question answered by assumption (a)
  stated before the push and not contradicted: no build for a custom-fabricated pole. Built: OB scan-in carries the links;
  `putAwayFromCart` custom branch (no reversal / scrap / build; `nsBuildSkipped: 'custom-fab'`; mirror + propagate +
  commitToOrder; short = refusal; unlinked legacy line = put away + loud "order not told"). Convert: `height: 100%` off
  the tab column, list `maxHeight 70vh`. Lint 0, build passed, safe-push = one commit (autostash carried S5's uncommitted
  board row and put it back). Notices in S1/S2/S4/S5 §6, board, state doc §6. **Sweep 12:29 EDT:** stamp
  1789144119612 (after the push); 38 JS assets, all fetched with `curl -sf` (8,439,428 bytes, 0 failures); `nsBuildSkipped`
  ×1, `custom fab for WO` ×1 and `70vh` ×1 in `main.5994ffbe.js` (the baseline main had 0 of all three; the extra
  `nsBuildSkipped` hits in chunks 483/920 are this commit's own message in the in-app changelog chunk, the `70vh` hits in
  639/922 are other tabs' CSS). **LIVE.** Next: the plating round trip on Stuart's /EP order, pinned in.

- **2026-09-11 — e2cef1f pushed 08:42 EDT (S3): the two S2 hand-offs.** Stuart: "check if this is still needed, if yes go
  ahead and build but check with me before push" → re-checked (both still needed), built, committed, checked, pushed on
  his "push". (1) WMS `ReopenedChip` beside `isOpenPick` (`PickPackApp.js`): red chip + ✓ confirmed on the queue row and
  the active pick header; `completePick` merges the confirm patch when the flag is set. (2) `ShopFloor.js undoComplete`
  refuses on `order.closed` naming `closedBy / closedAt / closeReason` and RTG. Design call: refusal, not clearing —
  a floor reopen of a closed order forks the spine; a per-order RTG reopen handed to S2 (§6 of their brief). Lint 0,
  full build passed, safe-push = one commit. Notices in S1/S2/S4/S5 §6, board, state doc §6. **Sweep 08:46 EDT:** stamp
  1789130752152 (after the push); 38 JS assets, all fetched with `curl -sf` (8,432,401 bytes, 0 failures); `confirm pick
  state` ×1 and `cannot reopen a closed order` ×1 in `main.3168d841.js` (the chip phrase also sits in chunks 483/514/920 —
  S2's RTG reopen wording and the guide, pre-existing). **LIVE.** Not yet seen by an operator: the first reopened doc
  Sandra picks is the acceptance run for the chip; the first Undo on a closed shop card is the refusal's.

- **2026-09-10 — f5a6c19 pushed 15:14 EDT (S3): ⇄ REPACK on RING PACKS.** Plan A approved by Stuart in-session
  ("go ahead with Plan A for the ring break, the pairs needs to wait on information from eric"). Break N packs → eaches →
  build the sibling size, one flow, two NetSuite records via the convert RESTlet (unbuild, then build); the operator may
  build fewer and keep the rest loose; a build failure after the unbuild reports the bin the eaches are in and says to
  finish on BUILD PACKS, never repeat; double-tap guarded by a ref; labels for the new size and count. Lint 0 errors,
  full build passed, safe-push check = one commit. Deploy notice written into S1/S2/S4/S5 §6, the board's Deploys
  row, state doc §6. **Sweep 15:17 EDT:** stamp 1789067831208 (after the push); `asset-manifest.json` = 38 JS assets,
  all fetched with `curl -sf` (8,406,465 bytes, 0 failures); marker `never repeat the repack` ×1 in `main.49b6a398.js`
  (`Repack step 2 FAILED` ×1 there too); the retired BREAK footer string ×0 everywhere. **LIVE.** Not yet run by an
  operator on real packs — the first REPACK on the floor is the acceptance run (two NetSuite records, watch 11.1 is
  not involved: both post synchronously through the RESTlet).
- **2026-09-10 — decisions and the queue.** (1) **Pairs wait on Eric**: the pair item ids in NetSuite (assemblies whose
  BOM is 2 × the each, e.g. `HCUDEC1/CP-PR`?) — then the pack grammar learns the suffix and BUILD / BREAK / REPACK apply.
  (2) **Plating round trip — parked on two answers** (asked 15:0x, unanswered): fix the custom line's dropped links + the
  custom-aware put-away BEFORE the run; NetSuite at return = receipt only (recommended) or a build of `<base>/EPn`. The
  finding: `PickPackApp.js` OB scan-in (`:1621`) writes no `finSiblingId / orderKey / soAppId / shopOrderId`; receive
  (`:3017`) and put-away (`:3296`) act only on `finSiblingId`; put-away step 1 adjusts against a null item. (3) From S2,
  acknowledged and queued: the `reopenConfirmPick` chip on the pick queue/pick detail (spec in §6); `ShopFloor.js
  undoComplete` never clears `closed: true` (defect, mine); S2's question "did any WMS/finishing screen rely on
  'Complete = done' via the audit?" — **no**: the WMS gates on `customPartsReady` / `pickStatus` / `packStatus` and the
  finishing screens on `currentPhase`; nothing of mine reads `isDoneState` or a FLOOR_DONE finding. (4) Named, not
  fixed: the SO pick's pack-build queue (`:4455`) will not recognise a pair line.

## 8. Opener (paste to start the session)

```
You are the S3 session — WMS · Finishing Floor · Shop Floor · the outbox and the NetSuite functions. Read,
in order: CLAUDE.md (the working agreement binds you), SESSION_COMMS_2026-09-10.md (the map, file ownership,
hand-off protocol — briefs are the channel), STATE_OF_THE_APP_2026-09-10.md (your items are named in BRIEF_S3
§3), BRIEF_S3_WMS_FINISHING_SHOP.md (your brief), then WMS_BRIEF.md, SHOP_FLOOR_CONTINUATION_BRIEF.md,
RTG_CONTROL_BRIEF.md §2/§5, WORK_ORDER_CONTRACT.md §5–5c, and the memories brief-c-shop-floor-session,
pickpack-in-main-bundle, deploy-verify-asset-manifest, wms-assembly-build-component-bin, rod-cuts-wms. Two rules:
every NetSuite write here moves real inventory — never twice, never from two places, never guessed; and
functions/index.js does NOT auto-deploy — every functions change ends with the Cloud Shell command for Stuart
and a live verification. The floors receive work, they never route it. Outsourced finishes never enter the
finishing floor. Stuart's live customer orders are the round-trip tests — never raise your own. Other
sessions: S2 (RTG/WO/PO — owns orderStatus/orderLifecycle/workOrderCreate/floorRelease/platingDemand, which you
CALL), S1 (sales doors + engine), S4 (portal/payments/UPS — will mount ONE Fulfilment panel in PickPackApp.js),
S5 (spec sheets/kits). Cross a line: stop, patch spec into THEIR brief's § Hand-offs in, log it in yours.
Git: never switch branches, stage only your files, pull --rebase --autostash, safe-push check, eslint 0 errors;
PickPack/ShopFloor/FinishingFloor are in main.*.js — sweep every asset with curl -sf. Plan first and wait —
every time. One issue at a time. First: with Stuart pinned in, run the plating round trip
(SHOP_FLOOR_CONTINUATION_BRIEF.md §5.1) on the /EP custom order he raises, screenshot each step, and hand S2
the board-side observations. Identify as "(S3)" in every commit.
```
