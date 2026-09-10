# Brief S3 — WMS · Finishing Floor · Shop Floor · the outbox and the NetSuite functions

*Written 2026-09-10 by the communicator session. You start THIRD. Read, in order: `CLAUDE.md`,
`SESSION_COMMS_2026-09-10.md`, `STATE_OF_THE_APP_2026-09-10.md` (your items: §1 C and D, §2.1 #2–4, §2.2 #12, #14,
#16, #18–19, §2.3 #23, #27, §2.4 #33–36, #42–43), then `WMS_BRIEF.md` (the warehouse in one document),
`SHOP_FLOOR_CONTINUATION_BRIEF.md` (the shop as it now is, with the exact live script for the plating round
trip), the finishing-floor parts of `RTG_CONTROL_BRIEF.md` (§2 controls, §5 where a stuck order says why),
`WORK_ORDER_CONTRACT.md` §5–5c, and the memories `brief-c-shop-floor-session`, `pickpack-in-main-bundle`,
`deploy-verify-asset-manifest`, `wms-assembly-build-component-bin`, `rod-cuts-wms`, `finishing-order-release-flow`.
`BRIEF_C_HANDOFF.md` and `BRIEF_D_HANDOFF.md` are history.*

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

1. STATE §3 Q5 — which of IA26935 / IA26936 to reverse; approve the dedupe fix.
2. STATE §3 Q6 — may the build-back be queued (no immediate NetSuite answer)?
3. STATE §3 Q4 — Q3 / Q4 one line each.
4. STATE §3 Q3 — delete the Setup Queue re-make now?

## 6. Hand-offs in

- **From S2:** #16 (retire the Setup Queue re-make for stock); #12 (rod-cut completion → `releaseStockWoToFloor`);
  #32 (delete the outsourced group once S2 says empty). Specs referenced above.
- **From S4 (when they start):** ONE guarded mount for the Fulfilment tab in `PickPackApp.js` + a row in
  `Shared/pickTabs.PICK_TABS` (a new tab key is permission identity — an admin ticks it per role).

## 7. Status log

*(newest first)*

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
