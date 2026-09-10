# State of the app — 2026-09-10

*Written by the orientation session after reading every document in `NEW_SESSION_ORIENTATION_BRIEF.md` §1 in
order (CLAUDE.md, the architecture brief, the flow audit, the cross-session contract, Briefs A–F and their
handoffs, Brief 16 and its handoff, the consolidation brief, the six 09-09 continuation briefs, the session
openers, the in-app User Guide, the memory index and 40 of its memories, and the 217 commits since 09-02),
then checking the claims that could be checked against the code, the test suites and the served site. Nothing
was edited, shipped or changed in production. This file is the only thing written.*

**Read §4 before trusting §1–§3.** Several documents say something the code does not. Where they disagree I say
which document is newer and which one I trust, and why.

---

## 0. The one-paragraph state

The consolidation held: one sales-order header on every door, one work-order writer for nine of ten intents,
one release engine on RTG with no push buttons, one gate list whose gates declare their own lifters, one
closer that also cancels queued NetSuite writes, one line reader for both dialects, one PO vocabulary with a
finality rule, one plated-demand writer, and every NetSuite write through the outbox except the plating
build-back. Every test suite is green (33 suites, 0 failures). Production is serving a build stamped four
minutes after the last push. **Almost none of it has been exercised by an operator on a real order.** That is
the risk, not the code, and every 09-09 brief says the same thing. Beyond the live pass, the open work is a
list of hand-offs between territories that were written into briefs and never landed (§2), two data sits with
Stuart and the designer, and three answers from Eric.

---

## 1. The territories

### A — Stock View · Sales Snapshot · Master Library (work orders and purchase orders)

**Shipped.** `Shared/workOrderCreate.parkWorkOrder` is the one stock writer; seven call sites use it (Stock
View ×4, Library card, RTG re-issue, the plated-demand writer). Route-open parking is gone. The plated triple is
`Shared/platingDemand.issuePlatedDemand` (demand + core-short milling WO, no PO). Purchase orders have a whole
life in `Shared/purchaseOrders` + `Shared/poLock`: draft per vendor, accumulate while draft, preview, approve
(NetSuite mints the number), send from the vendor's CRM card, acknowledge, receive, discard a draft; final once
it has left us. A5 Stock Build Needs, the `awaitingReceipt` gate (set by A, cleared by the WMS on covered
quantity, cancellable by hand), the pole choice panel (cut or wait, never mill), the True Backorders board,
♻ Repaint from both doors, the wood-rod material tag, the "in-house means made" sourcing fix, the delete-and-
strand sweep on A's side (gates declare their clearer; `strandedGatesOf`), writer 7 (the Library run) onto
`buildFinDoc`. The 11.1 "Plated items without a BOM core" report exists.

**Handoff says open.** Live runs for every converted writer; the `finishOf`/tier sweep leftovers (identity and
display sites, hygiene only); the Stock View "Open POs" cleanup twin; `Shared/stockAvailability.js` (the
superset reader, deferred — `oeReviewPlan.fetchAvailabilityUnits` is the one reader today); the receiving-tab
receipt shape (per-line `receivedAt/By`, a short/over field) that D asked for and A deliberately did not write
until the tab existed — the tab now exists (77ce385) and the shape question was never closed in any document.

**09-09 brief adds** (`BRIEF_WO_PO_SPINE.md`, `BRIEF_REPAINT_JFP_JOINT.md`): the five rules (every order lands in
RTG; one writer per document; a decision and a silence are different; the recoverable answer is the default; a
gate must be liftable); proven on a real order = the Master Library repaint and the rod-cut builder only;
everything else from 8–9 Sep unproven; repaint from the Snapshot row is the one to run first because the writer
moved files after the Library tool was tested. Repaint edges: stock moves down at the pick and up at the
put-away, so an abandoned run leaves the source deducted (their first question for a joint session).

**Contradictions.** None inside A's own documents. Three B→A hand-offs recorded as accepted in `BRIEF_A_HANDOFF`
are not in the code: `releaseFinWoToFloor` still writes `fin_workorders` inline instead of through
`buildFinDoc` (`finishedRunPrecheck.js:334`); `executeMakeupActions` still writes `shop_custom_orders` inline
(`:271`) instead of through `buildShopDoc`; `clearConvertGate`'s stock branch does not call
`releaseStockWoToFloor` (`:377` releases sales-typed only); `resetWoToSetup` does not call
`propagateFloorState`. The handoff is honest that they were hand-offs; the 09-09 RTG brief is not (see B).

### B — RTG Dispatch · Finishing Floor (release, gates, the record)

**Shipped.** B5 (the four `customFabStatus` states, `customPartsReady`), B2 (`GATES`/`isReleasable`), B1
(`buildFinDoc`/`buildShopDoc` in `Shared/floorRelease`), B3 (one release engine, ⚡ toggle = kill switch, no push
buttons — verified: the strings are gone from the file — one supervisor override, PO panel on `isOpenPo`), B4
(split reads the stamped recipe first and says which source answered), B5 part 2 (stock first at the split,
pick-only floor doc, true-backorder record on the sales order), B7 (`identityKeysOf` learns `SHOP-<id>`), B8
(Setup Queue says why), B9 (guide), the Order Entry rows on the board, `finishAsAvailable` both halves
(`wholeOrderWait`, the split's BACKORDER hold), Delete calls the closer, `cancelQueuedNsWrites` inside the
closer, `STRANDED_GATE` with ⬆ Lift, the wood-rod cut facts passed to `classifyLine` at both split callers
(`eng` hoisted at `RTGDispatchTab.js:1157`), rod cuts listed read-only on the board, the traverse cut list on
`fabNotes`.

**Handoff says open.** Delete the legacy enrich branch after a week of zero (the panel title counts "legacy
releases this week"; the week runs from 09-09); delete the Setup Queue's outsourced group once observed empty
(the group is still in the code, `SetupQueue.js:51` and `:594`); an optional staging-age flag.

**09-09 brief adds** (`RTG_CONTROL_BRIEF.md`): the full control table, the record vocabulary, where a stuck order
says why, seven acceptance runs still owed on live data, the open items by owner.

**Contradictions — two, and the newer document is the wrong one both times.**
1. `RTG_CONTROL_BRIEF.md` §1: *"Nothing releases from a browser tab alone any more: the WMS rod-cut / convert
   completions and A's clearConvertGate call the same shared release."* In the code `releaseStockWoToFloor` has
   exactly one caller, `RTGDispatchTab.js:1525`. `PickPackApp.js` never imports it; `clearConvertGate` releases
   sales-typed orders only. So a **stock** order whose last gate clears at the WMS still waits for an open RTG
   tab with ⚡ ON. `BRIEF_B_HANDOFF.md` §6 records these as hand-offs *written* (acec131), which is accurate. Trust
   the handoff and the code; the control brief overstates.
2. `BRIEF_B_HANDOFF.md` §2 and the RTG control table: *"no re-make from the floor for stock (the Snapshot
   addresses it)."* The Setup Queue still has the "⟲ Create Re-make WO" button (`SetupQueue.js:686`) writing
   `hq_work_orders` directly (`:525`), and the guide's "honest matrix" still lists "Setup Queue · scrap re-make".
   B6 was decided, never shipped. Trust the code.

Also: the 09-03 memories `every-order-via-rtg` / `rtg-every-order-rule` say auto-release stays OFF until no
order appears on a floor tab RTG never saw; `RTG_CONTROL_BRIEF.md` (09-09) says "Stuart: keep it ON". The newer
one is the current instruction, but see §3 Q2.

### C — Shop Floor

**Shipped.** C1 (the shop mirrors 'Sent to Plating' for an outsourced finish through the ONE shared test —
the acceptance grep for a local regex is empty), C2 (mill-complete / failed stamps through
`propagateFloorState`, zero-good = Failed), the Shop Instruction read side, START message only with a sibling,
the "NO CUT SHEET FROM VISION" banner narrowed to Vision evidence, the Traverse Cut Sheet, Reopen cancels its
plating demand via D's `cancelPlatingDemand` (refuses once shipped), the Shop Floor guide section.

**Handoff says open.** C1 §6 acceptance rows — the plating round trip has never run because no plated custom
order was on the floor on 09-09; C4 (the Order Entry pair, `HCUMP810 + /P01`, untested since 09-01); C5
(20 ft sticks, waits on Q4); C6 leftovers (`isShopEngineer` verify, Brimar bent-pole end to end, polish); C3
(read one shape now that `buildShopDoc` exists); Q3 root-build N and Q4 the stick family, unanswered.

**09-09 brief adds** (`SHOP_FLOOR_CONTINUATION_BRIEF.md`): the exact live script for the plating round trip
with screenshots at each step; the contracts table (who writes which state); the guide additions owed (shipped
dd3b8fe).

**Contradictions.** None. C's documents match the code everywhere I checked, including the correction that
ShopFloor compiles into `main.*.js`.

### D — WMS, functions, the NetSuite write path

**Shipped.** Claim gate; SO Pack (four numbers, both doors, Close order); committed bins; the arrival alert;
the plating receiving station (scan → cart → bin), receipt on the outbox, build-back through the convert
RESTlet with the component bin, D1 (receipt → 'Plating Received', build-back → 'Complete' + 'Plated', pack
gate = `customPartsReady`); `Shared/pickLines` (one line reader, the fee that reached the packer); the WMS
guide; `finishAsAvailable` on the SO Pack card; RECEIVING (PO) with `clearReceiptGate` called at receipt
(`PickPackApp.js:1050`); LABELS with the pack barcode grammar (`Shared/labelScan`); pole length/qty/sidemark on
pick and pack cards; D-1 (cancelling a rod cut lifts its gate via `liftPatchFor`); the plating demand's END
(`fulfil/cancelPlatingDemand`). Functions: `onStockBuildDone` accepts `stock` and `sales` (D2),
`onMillComplete` exists behind `system/wms_config.rootBuildAuto` (D3) — one functions commit since 09-03
(b6b616c), which the D handoff says was deployed from Cloud Shell; nothing in `functions/` or `netsuite/` has
changed since, so there is no undeployed function change.

**Handoff says open.** The live pass (everything above unexercised); the watched FLOW1 test order (D2's payload
has never posted live; Eric never answered); turn D3 on for CE after three clean ⛏ posts (Firestore console,
no UI, by design); the plating build-back's own post is still direct through `postConvertBuild` with no
double-post guard (D5's remainder, "the biggest thing left in my territory"); the fulfilment queue is parked as
Stuart's own Fulfilment tab project.

**09-09 brief adds** (`WMS_BRIEF.md`): the warehouse in one document — fourteen tabs, tab keys are permission
identity (LABELS still needs granting), the four rules, the data model, the four deploy-verify traps.

**Contradictions.** `WMS_BRIEF.md` §11 says the plating PO "must adopt `PO_STATUS` once A extends it, or it stays
invisible on the RTG board". A extended it: `PO_STATUS.SENT_TO_PLATER = 'Sent to Plater'` (`poLock.js:13`), the
WMS writes that exact literal (`PickPackApp.js:2946`), `isOpenPo` treats it as open, RTG's panel filters on
`isOpenPo`. Effectively closed; the WMS writes a bare literal instead of the constant (hygiene only).
The B→D hand-off on the JFP adjustment double-post (IA26935/IA26936, c682199) is **not applied**: the two
JFP `enqueueNsWrite` calls (`PickPackApp.js:1759`, `:1867`) carry no `dedupeKey`. `BRIEF_D_HANDOFF.md` was
written before that hand-off and does not list it; `RTG_CONTROL_BRIEF.md` §7 does.

### E — CPQ · Vision · Order Entry · CRM (the sales side)

**Shipped.** One header on every door via `soHeaderOf` (CPQ, Order Entry, CRM approve — three callers, verified),
recipe + `recipeSource` + per-line `finishOutsourced` stamped at save, need-by never invented, ready date by
finish class (PAINT 4/2, PLATED 6/4, STAIN 4/2), the retired tab-7 generator deleted, one owner per traverse
component (E6.1), documents re-resolve descriptions and part numbers at print time, customer finish names and
track stock colour on the paper, render snapshots at Add configuration, cart edit-in-place, the header quantity
asked once, and the whole 09-06 → 09-09 Vision-on-the-engine run (rod type, framing axes, projection list
narrowed, pin matching by cluster, traverse cut list into `engineeringNotes`, the bridge answering the framing
axes) — all live-proven per `CPQ_VISION_HANDOFF_BRIEF.md`.

**Handoff says open.** E3 (one NetSuite header builder with a per-brand class + form map) waits on Eric — both
inline copies are still in the code (`nsTransmit.js:598`, `QuickShipTab.js:1345`); the alias window
(`reqDate`/`needByDate` still written at `salesOrderHeader.js:286`) — B's split now writes `needBy`, the WMS
reads `needBy` first, so the last reader is `functions/index.js:1262` (`portalMyOrders` reads `so.reqDate`),
which is the portal hand-off and needs a Cloud Shell deploy; E8 the portal mirror field list; the
estimate→SO transform has still never posted through a real CRM Approve; the Kit-class push path is unproven on
tab 12; the E half of the F2 kit bill (every component at $0, one holder line, stable sort by `billGroup`) is
not confirmed shipped in any document I read; the Vision no-O2O guard at add-to-cart; the silent
end-treatment deletion when the rod is picked after the ends.

**09-09 brief adds** (`CPQ_VISION_HANDOFF_BRIEF.md`): the engine rules settled that week, the Vision gate and
bridge, the CPQ feature table with commits, the data items Stuart owns (`H1-DBLFR/DBLMR` on 3/4" missing
`setup: double`; rear `HSOM-04` pins; test lines under FABRICUT to clean; one real quote saved at qty 50 that
needs re-saving at 1), the open list (no CPQ → Vision write-back; Vision itself still renders the old flow
steps — only `CPQTab` imports `HardwareConfigurator`, verified).

**Contradictions.** `BRIEF_E_HANDOFF.md` §3 still lists the WMS date switch as outstanding; the consolidation
brief corrects it (829848f shipped). The consolidation brief is right. Order Entry lines through
`Shared/backorder.classifyLine` (E's part of the backorder work) is not in `QuickShipTab.js`.

### F — the tag engine · kits · spec sheets · 1.6 / 1.5 authoring

**Shipped.** Brief 16 in full (one `ChoiceTagControls` row on both 1.6 screens, load-order badges, `slotId/
slotLabel/slotOrder` on new clusters, the 1.5 SLOTS panel, `Shared/slotGroups`), the Traverse template
(4c76ad0, pushed), the slot-id chip, the "Unfinished" item tag with its one reader `takesNoFinish`, F2's F half
(`applyKitPricing` reshaped: `billGroup` 1–4, included at $0, motor folded), the test runner fix (one command,
33 suites), the H1-2TRV engine work (END-ARM semantics, the one-piece rule, riders on their tier, `frontLayer`),
STEP review on tab 1 (occt wasm vendored), the studio rig for STEP, the 1.6/1.5 guide section.

**No handoff file exists for F**; the record is in memory (`brief-f-decisions-2026-09-03`,
`h1-2trv-traverse-engine-session`, `unfinished-item-tag`, `step-review-tab1`) and in Brief 16's handoff.

**Open per those records.** F9 guide sections for the tag engine, kits, spec sheets and 4.6 KITS/CHECKOUT (the
guide has WO, Orders & Customers, Shop Floor, WMS, Rod Pieces, Working on the App, 1.6/1.5 Authoring — verified;
nothing on the engine/kits/sheets); F6 the data pass with the designer on H1-2TRV (the tag list in §2); F4 spec
sheet text/measurement refinement and the French Return / Passing Support Arm columns (Q4 answered: do not touch
the 4-row sheet); F1 H2 proof of the acceptance list (H2 already opens on the engine); F7 parked; Brief 16's §6
acceptance run with the designer has not been run; Stuart to confirm the Traverse template's slot list against
the live SLOTS panel; the 4-5/8" returns GLB + tags and `H1-75ILE` 3.625 → 4.625 (Fabricut order 3 is parked on
them).

**Contradictions.** `SPEC_SHEET_HANDOFF_BRIEF.md` is stale where it conflicts with the `spec-sheet-generator`
memory (Brief F says so; I did not re-read the older brief). `BRIEF_F_KITS_SPEC_SHEETS.md` §2 still lists F3 as
a bug; the F session corrected it the same day (38843e3 closed it in August; proof only).

---

## 2. Open items — deduplicated, with owner and source

Order inside each block is my suggested order. "Source" is the document that carries the fullest statement.

### 2.1 Proof on live data (blocks trusting the week's work)

| # | item | owner | source |
|---|---|---|---|
| 1 | **The live pass.** One real order through every screen: claim gate, SO Pack numbers, committed bins, arrival alert, RTG's one release engine, A's converted writers, receiving tab + material gate, pole panel, Stock Build Needs (the only new button with a NetSuite write behind it), Backorders board, draft-PO discard, in-house routing, repaint from the Snapshot row | all, Stuart pinned in | CONSOLIDATION §2–3, WMS_BRIEF §11, BRIEF_WO_PO_SPINE §6, RTG_CONTROL §8 |
| 2 | **The plating round trip** (C1 §6 rows): Stuart raises one CPQ custom order with an /EP finish; shop ▶ Start → Complete & Label → 'Sent to Plating' → Undo → Complete again → pull → ship → receive → build-back → 'Complete' → pack allowed; also the refusal after shipment. D watches the receipt side | C + D + Stuart | SHOP_FLOOR_CONTINUATION §5.1 |
| 3 | **The watched FLOW2/FLOW1 sales-typed build at pack** — a NetSuite write that has never posted live; Eric's answer was replaced by a watched test order | D + Stuart | BRIEF_D_HANDOFF §4.2 |
| 4 | C4 — the Order Entry pair (`HCUMP810 + /P01`) live; type a Shop Instruction on HCUMP810 first | C + Stuart | SHOP_FLOOR_CONTINUATION §5.3 |
| 5 | Repaint from each door (the writer moved files after the Library tool was tested) | A + Stuart | BRIEF_REPAINT_JFP_JOINT §4 |
| 6 | Turn D3 (`onMillComplete`) on for CE after three clean manual ⛏ posts — Firestore console, `system/wms_config.rootBuildAuto = { ce: true }` | Stuart | BRIEF_D_HANDOFF §4.3 |
| 7 | The Fabricut four-order run: order 1 saved as a quote only; orders 2 and 4 not confirmed entered; order 3 parked on the 4-5/8" returns (GLB + tag work, not a tag flip) | E + F + Stuart | CONSOLIDATION §2, fabricut-projection-tag-defects |
| 8 | Brief 16 acceptance with the designer on H1-2TRV; Stuart confirms the Traverse template's slot list | F + designer | BRIEF_16_HANDOFF |

### 2.2 Hand-offs written into briefs that never landed in code (verified absent)

| # | item | owner (file) | source |
|---|---|---|---|
| 9 | `releaseFinWoToFloor` → `buildFinDoc` (`finishedRunPrecheck.js:334` still inline) | A | BRIEF_A "Hand-off from B — releaseFinWoToFloor" |
| 10 | `executeMakeupActions` shop write → `buildShopDoc` (`:271` still inline) | A | BRIEF_B B1 table #7 |
| 11 | `clearConvertGate` stock branch → `releaseStockWoToFloor` (`:377` sales only) | A | BRIEF_A "Hand-off from B — clearConvertGate" |
| 12 | WMS rod-cut completion → `releaseStockWoToFloor` (never imported in `PickPackApp.js`) | D | BRIEF_D "Hand-off from B — the rod-cut / convert completions RELEASE" |
| 13 | `resetWoToSetup` → `propagateFloorState` | A | BRIEF_A "Reset → Setup must tell the RTG record", RTG_CONTROL §7 |
| 14 | JFP adjustment `dedupeKey: jfp-adj:<id>` + refuse on `jfpAdjQueued/Posted` (`:1759`, `:1867`) — and Stuart reverses one of IA26935/IA26936 by hand | D, Stuart | BRIEF_D "Hand-off from B — the JFP paint-run adjustment posts TWICE" |
| 15 | RTG PO line editor guarded by `poLinesLocked` + hide ✎ on a locked card (no reference in `RTGDispatchTab.js`) | B | BRIEF_A "the RTG PO line editor must honour the finality rule", BRIEF_WO_PO_SPINE §7 |
| 16 | Setup Queue scrap re-make writer retired for stock (button still at `SetupQueue.js:686`, direct write at `:525`); guide matrix row goes with it | B | BRIEF_B §B6, BRIEF_B_HANDOFF §2 |
| 17 | Order Entry lines classified through `Shared/backorder.classifyLine` at save | E | BRIEF_A/B "TRUE BACKORDERS", RTG_CONTROL §7 |
| 18 | Arrival stamp `backorderCovered` on the line at receipt/put-away + release the BACKORDER hold; SO Pack toggle releasing the same hold | D | BRIEF_D "the release half of finishAsAvailable", RTG_CONTROL §7 |
| 19 | WMS Rod Cuts empty state "0 for CE — n open under M2C" | D | BRIEF_A "a rod cut should leave a copy", RTG_CONTROL §7 |
| 20 | Portal `portalMyOrders` date read → `needBy`/`readyDate` (`functions/index.js:1262`), then E deletes the two alias lines; needs Cloud Shell | portal session, then E | BRIEF_E_HANDOFF §3/§5 |
| 21 | Portal request functions accept `needBy` + `productionNotes` (E8) | portal session | BRIEF_E_HANDOFF §5 |

### 2.3 Open by design decision, waiting on a person

| # | item | waits on | source |
|---|---|---|---|
| 22 | E3 — one NetSuite header builder; class internal id + custom form id per brand (M2C, Uniquity, Leyla); the two inline copies stay until then | Eric | BRIEF_E_HANDOFF §4 |
| 23 | Q3 root-build N (default 3) and Q4 the 20 ft stick family (default H1-1R only, 20 ft, offcuts kept, home bin = library bin) → then C5 | Stuart | SHOP_FLOOR_CONTINUATION §4 |
| 24 | Tag `manufacturingSpecs.material = WOOD` on the `H1-138WHTOAK-*` rods (4.5 Mass Update) — the wood rule is live and dormant until the rods carry it | Stuart | BRIEF_WO_PO_SPINE §7 |
| 25 | Fix `HCUMSBF15`'s in-house tag; clear `WO-HCUMSBF15-N25-655308-4`; close/re-issue WO11588 (unpickable pull 7674) | Stuart | BRIEF_WO_PO_SPINE §7, BRIEF_A "WO11588" |
| 26 | Close the two 14-Aug Order Entry orders in NetSuite (`QS-1786738589252`, `QS-1786734991717`) — they commit stock and depress `available` | Stuart | BRIEF_A §3i, CONSOLIDATION §5 |
| 27 | Grant LABELS in the WMS permission matrix | Stuart | WMS_BRIEF §1/§11 |
| 28 | F6 data pass in 1.6 with the designer: `trv: trv-only` on slots 5/6; `H12RCTAR4625RIGHT` NO PLATE; miters all SETUP SINGLE; `H1-DBLFR/DBLMR` on 3/4" `setup: double`; rear `HSOM-04` `setup: double` + stray proj; wood rod pins #10 vs #11 (never both the same); rear `H1-2TRVNUT` tagged TRACK; S72 `returnOnly`; FR/MTR double pins' proj as `FRONT:8.5, BACK:3.25`; the 40 PENDING stubs; 4.6 `frontRail` on the -4D/-4DC/-4MD/-4MDC and -4FRT/-4MFRT kits; prices for `H1-138AR`, `H1-138D`, `H1-DBLMR` | Stuart + designer, F drives | BRIEF_F §F6, h1-2trv memory, CPQ_VISION §4 |
| 29 | Clean the FABRICUT test lines ("TRV LINK TEST", "ROD TYPE LINK TEST", "DRIVE TYPE LINK TEST"); re-save QUOTE-1788999902223 at qty 1 | Stuart | CPQ_VISION §4 |
| 30 | Multi-location fulfilment: Eric confirmed one location per line → `location` on the payload, inside the Fulfilment tab project | Stuart's project | fulfilment-screen-project |

### 2.4 Open, owned, not blocked

| # | item | owner | source |
|---|---|---|---|
| 31 | Delete the legacy enrich branch after a week of zero (from 09-09; the Stock Builds panel title counts) | B | BRIEF_B_HANDOFF §3, RTG_CONTROL §7 |
| 32 | Delete the Setup Queue's outsourced group once observed empty (Library run converted cfc613d) | B | RTG_CONTROL §7 |
| 33 | Plating build-back's NetSuite post onto the outbox (the RESTlet reachable through it) — the last direct inventory write with no double-post guard | D | WMS_BRIEF §11, BRIEF_D_HANDOFF §2 D5 |
| 34 | WMS pre-pack confirm lists an Order Entry custom half `<woId>-C` "still in production" forever — needs a spec (read `customFabStatus`, not `floorPhase`) | D | BRIEF_C_HANDOFF §4, CONSOLIDATION §5b |
| 35 | Pack-scrap adjustment may share the JFP "enqueue then stamp, never check" shape | D | BRIEF_D (B's hand-off, named) |
| 36 | Two pull adjustments carry no writeBack (audit-invisible from an order) | D | CONSOLIDATION §5 |
| 37 | Stock View "📋 Open POs" cleanup twin beside Open WOs (not found in `StockViewTab.js`) | A | BRIEF_A §3j |
| 38 | `Shared/stockAvailability.js` superset reader (additive; not needed until someone needs on-hand + committed beside available) | A | BRIEF_A §3i |
| 39 | `finishedGoodsRun.stockCheckReport` treats an unknown stock row as zero — proposal, gated path | A → Stuart | BRIEF_A §3i |
| 40 | Receiving-tab receipt shape: per-line `receivedAt/By`; a short/over field that is not `scrapQty` | A + D | BRIEF_A §3f |
| 41 | A6 leftovers: five identity + two display suffix reads (hygiene) | A | SYSTEM_FLOW_AUDIT Q13 |
| 42 | C3 read one shape (sweep the shop's fallback chains now that `buildShopDoc` exists); read `cutSheetMissing`/`visionUsed` off the doc and delete the shop's derivation | C | SHOP_FLOOR_CONTINUATION §5.6–5.7 |
| 43 | C6 leftovers: `isShopEngineer` verify, Brimar bent-pole end to end, polish | C | SHOP_FLOOR_CONTINUATION §5.5 |
| 44 | Vision no-O2O guard at add-to-cart / finalize (SO60147 class); "Reopen-in-Vision does nothing" | E | BRIEF_C_HANDOFF §7 |
| 45 | The silent CPQ end-treatment deletion when the rod is picked after the ends | E/F | fabricut-projection-tag-defects |
| 46 | Kit-class push path (`H1-2RCTCB` → 59101 + 64805 etc.) proven on tab 12; F2's E half (all $0 + one holder `CE-TRV-SYSTEM`, stable sort by `billGroup`) confirmed shipped or not | E | BRIEF_E §2, brief-f-decisions |
| 47 | First real CRM Approve through `queueEstimateToSalesOrder` is a watched run | E + Stuart | BRIEF_E_HANDOFF §0 Q2 |
| 48 | Vision onto the new engine (Vision renders the old flow steps, gated by the engine) — named, not started | E + F | CPQ_VISION §5, h1-2trv memory |
| 49 | F9 guide sections: the tag engine, kits, spec sheets, 4.6 KITS/CHECKOUT | F | BRIEF_F §F9 |
| 50 | F4 spec sheets: text/measurement pass; French Return + Passing Support Arm columns | F | BRIEF_F §F4, spec-sheet memory |
| 51 | F1 H2 acceptance proof on the engine (not a gate flip) | F | brief-f-decisions Q2 |
| 52 | Repaint edges: abandonment after the pick; RTG treatment of `type: 'Repaint'`; `repaintAvailAtIssue` unread | A + D | BRIEF_REPAINT_JFP_JOINT §6 |
| 53 | Render snapshots on old quotes need the line re-added; big carts approach the 1 MB doc limit (move to Storage if it bites) | E | CPQ_VISION §5 |
| 54 | The Fulfilment tab (weight, dims, UPS rate, ship, tracking back) — Stuart's own next project; the nine stuck fulfilment entries belong to it | Stuart | fulfilment-screen-project |
| 55 | `BRAND_NETSUITE_MAP` still has three identical definitions (`brandNetsuite.js`, `StockViewTab.js:33`, `LibraryTab.js:42`); CLAUDE.md's list of four is stale | A (hygiene) | SYSTEM_FLOW_AUDIT P2 #13 |
| 56 | The guide's "Poles released from the Master Library run as small parts" edge — writer 7 now goes through `buildFinDoc`, which asserts poles XOR sled; whether the Library run stamps `poles/totalPoles` is not verified | A + B | UserGuideTab "Edges to know" |

### 2.5 Closed since the handoffs were written (so nobody re-does them)

D-1 cancel rod cut lifts its gate (2869196) · rod cuts on the RTG board (96b4983) · split-time
`cutSheetMissing` stamp (a12c804) · Shop REOPEN cancels its demand (b313082) · C2 through `propagateFloorState`
(b313082) · the WMS date keys (829848f) · `NS_POSTED_AFTER_CLOSE` reads every flagged entry (3be3ae9) · the PO
vocabulary including 'Sent to Plater' + RTG's panel on `isOpenPo` · F3 (was closed in August) · the
"Snapshot dismisses itself" defect and the repaint `undefined` write (7677b73, this morning).

---

## 3. Questions only Stuart can answer

1. **Which issue is first?** *Recommendation:* the plating round trip (item 2), because it is the longest chain
   that shipped untested (B5 + C1 + D1 across three files), it gates every plated custom order today, and it
   needs only one small /EP order from him. Second: the sales-typed build at pack (item 3), because it is a
   NetSuite inventory write that has never posted.
2. **⚡ Auto-release — ON or OFF today?** The 09-03 memories say OFF until no order appears on a floor tab RTG
   never saw; the 09-09 RTG brief says keep it ON. *Recommendation:* ON, and say so once in CLAUDE.md — the Order
   Entry orders are on the board (b9fe48c) and every parked record names its source. But note the engine still
   runs only while an RTG tab is open, because items 11 and 12 never landed.
3. **The Setup Queue re-make button (item 16):** delete it now, or leave it until B's queue reaches it? It is a
   floor-side writer of `hq_work_orders` that bypasses the Snapshot model you chose. *Recommendation:* delete
   now — one small commit in B's file, the guide row goes with it.
4. **Q3 / Q4 (item 23):** one line each. *Recommendation:* accept the defaults (N = 3; H1-1R only, 20 ft,
   offcuts kept, home bin = library bin) unless there are other 20 ft items.
5. **JFP double (item 14):** which of IA26935 / IA26936 to reverse, and approve the dedupe fix in D's file.
   *Recommendation:* reverse the later one (IA26936), approve the fix — it is the same `dedupeKey` shape every
   other writer already uses.
6. **Plating build-back onto the outbox (item 33):** you kept the pull synchronous so Sandra sees NetSuite's
   answer at the bin. Does the build-back need the same, or may it read "queued — watch 11.1"? *Recommendation:*
   queue it; it is the one remaining write that can double-build.
7. **The four hand-offs into A's file (items 9–11, 13):** approve them as one issue each, or as one issue "A's
   side of B's release" (four small commits, all in `finishedRunPrecheck.js` / `StockViewTab.js`)?
   *Recommendation:* one issue, four commits, because they are the same shape and the same trace (finishing doc
   identical; RTG record stamped; no NetSuite change).
8. **The alias window (item 20):** approve the portal function change + a Cloud Shell deploy so E can delete
   the two alias lines? *Recommendation:* yes; until then nothing breaks, the aliases just keep being written.
9. **Eric (item 22):** keep waiting for the class + form map, or ship E3 for CE only with the non-CE brands
   refusing to queue with a named error (the cc85d66 rule)? *Recommendation:* ship the refusal now — a named
   refusal is better than Sinaya's "Class" error — and fill the map when Eric answers.
10. **The Stock View "Open POs" twin (item 37):** still wanted, given RTG's PO panel now shows every open PO with
    lines, sources, received and total? *Recommendation:* defer; RTG covers "seen and controlled".
11. **The Fabricut orders (item 7):** enter 2 and 4 now, and through which door? Is order 3 blocked until the
    4-5/8" returns exist in the GLB? *Recommendation:* enter 2 and 4 as the live pass's real orders (they are
    the run the week was built for); order 3 waits for the GLB.
12. **Repaint abandonment (item 52):** reverse the pick adjustment automatically when a run is closed unstarted,
    or manual correction? *Recommendation:* manual for now, with the closer logging "source already deducted";
    decide after one repaint from each door has run.
13. **When does the designer sit** for F6 / Brief 16 acceptance (items 8, 28)? Half the open tag defects are
    hers to tick.
14. **Enrich-branch and outsourced-group deletions (items 31–32):** they wait on your reading of the panel count
    (zero legacy releases in the week from 09-09) and the group observed empty. Say when.

---

## 4. What I verified in the code versus what I took on the documents' word

### Verified against the code, the tests and the served site

- **Git:** working tree clean of tracked changes; local `main` equals `origin/main` (HEAD b062519). No branch
  switching happened.
- **Tests:** `sh scripts/run-traverse-tests.sh` — every suite passes, 0 failures (hardwareModel 664, tagSheetImport
  99, kitSeed 68, splitPlan/orderStatus 67, hardwarePricing 54, visionBridge 53, pickLines 48, committedBins 46,
  hardwareHandoff 45, partLookup 42, labelScan 36, and the rest).
- **Production:** `version.json` stamp 1789043420146 (08:30:20 EDT today) is after HEAD's push (08:26:51);
  `asset-manifest.json` lists 38 JS assets. This is the stamp, not a marker sweep; it is consistent with prod
  serving HEAD, not proof.
- **The one writer:** `parkWorkOrder` has seven callers (RTG re-issue via `INTENT.REISSUE`, `StockViewTab` ×4,
  `LibraryTab`, `platingDemand`). Remaining direct `hq_work_orders` writers: `finishedRunPrecheck.js:263`
  (component shop WO on the shared shape), `SetupQueue.js:525` (the re-make — item 16), `repaintRun.js:54` (the
  paint run, by design).
- **The builders:** `buildFinDoc` called from the RTG split and `repaintRun` (writer 7 converted); `buildShopDoc`
  from RTG's split and `pushToShop`. `releaseStockWoToFloor` called only from RTG (item 11–12).
- **Gates:** `orderStatus.GATES` = soAccept · nsWo · receipt · components · convert · rodCut (+ dispatched);
  `isReleasable`, `strandedGatesOf`, `liftPatchFor`, `wholeOrderWait` exported and used by RTG.
- **RTG:** no "Push to Shop" / "Push to Finishing" strings remain; the PO query filters on `isOpenPo`; the legacy
  enrich branch still stamps `legacyEnriched` and the panel counts it; `classifyLine(line, part, eng)` at both
  split callers with `eng` hoisted; rod cuts listed read-only; no `poLinesLocked` (item 15).
- **Closer:** `cancelQueuedNsWrites` runs inside `closeOrderEverywhere`; `STRANDED_GATE` and
  `NS_POSTED_AFTER_CLOSE` in `auditOrphans`; `identityKeysOf` exported.
- **PO vocabulary:** ten statuses in `poLock.js`; `isOpenPo` = not deleted and not terminal; the WMS writes
  'Sent to Plater' as the literal the vocabulary carries.
- **Shop:** `SENT_TO_PLATING` mirrored at Complete & Label; `cancelPlatingDemand` on Reopen; the Traverse Cut
  Sheet reads `fabNotes.traverseCuts`; the outsourced-regex acceptance grep is empty.
- **WMS:** `cancelRodCut` lifts the gate through `liftPatchFor`; `clearReceiptGate` called at receipt;
  `customPartsReady` is the pack gate and the refusal names the plater; build-back still via `postConvertBuild`
  directly; no JFP `dedupeKey`; no `backorderCovered`, no BACKORDER hold release, no brand-aware empty state.
- **Functions:** `onStockBuildDone` guard is `orderType !== 'stock' && !== 'sales'`; FLOW1 branch on `nsWoOnErp`;
  `onMillComplete` reads `rootBuildAuto` per brand and stamps `nsRootBuildSkipped`; `portalMyOrders` still reads
  `so.reqDate`. One commit in `functions/` since 09-03 (b6b616c, reported deployed); none in `netsuite/`.
- **Sales header:** `soHeaderOf` called from CPQ, Order Entry and CRM approve; `LEAD_WEEKS` PAINT/PLATED/STAIN;
  aliases still written at `:286`; two NetSuite header builders remain (`nsTransmit.js:598`,
  `QuickShipTab.js:1345`).
- **Rules:** every collection referenced by `collection(db, '…')` in `src/` and `functions/` has a match block in
  `firestore.rules` (my sweep found none missing). Deploy state is Stuart's word (09-02).
- **Tabs:** `HQ.js` registers the numbered tabs the brief's table names (1, 1.5, 1.6, 2, 3, 4, 4.5, 4.6, 5, 6, 6.5,
  7, 8, 9, 9.5, 10, 10.5, 10.7, 11, 11.1, 12, 12.5, 13, 14, 14.5, 14.6, 15, App Imp., User Guide).
- **Guide:** seven sections (WO, Orders & Customers, Shop Floor, WMS, Rod Pieces, Working on the App, 1.6/1.5
  Authoring); no engine/kits/spec-sheet section.
- **Engine:** only `CPQTab.js` imports `HardwareConfigurator` (Vision on the old steps); `flowNeedsOldEngine`
  gate present; the Traverse template exists in 1.6; `Shared/stockAvailability.js` does not exist;
  `fetchAvailabilityUnits` lives in `oeReviewPlan`.
- **Brand map:** three identical definitions.

### Taken on the documents' word (not checkable from here, or not checked)

- Everything described as **live-proven on Stuart's tab** in `CPQ_VISION_HANDOFF_BRIEF.md`, the Brief B/C/D
  handoffs' "verified in the served bundle" claims, and the D handoff's "deployed from Cloud Shell" — I checked
  that the code exists, not that a marker sweep or a deploy log exists.
- That `firestore.rules` and the two functions are **deployed** (Stuart's 09-02 and D's 09-03 word).
- Every claim about **production data**: item tags (the wood rods, `H1-DBLFR` setup, HSOM-04 pins), the two
  stale 14-Aug orders, WO11588, IA26935/26936, the 40 PENDING stubs, the state of the four Fabricut orders.
  App Check makes these unreadable from here.
- That the **Master Library repaint** and the **rod-cut builder** worked on a real order (`BRIEF_WO_PO_SPINE.md`
  §5).
- Whether the pre-pack confirm defect (item 34) still reproduces — the code now reads `customPartsReady`; the
  named case is about `floorPhase` on the `<woId>-C` half and I did not trace it.
- Whether F2's E half shipped (item 46) — no document says, and I did not read `nsTransmit`'s TAGS branch for it.
- Whether the Library run stamps pole counts through `buildStockFinPayload` (item 56).
- The older briefs the orientation brief marks as history (TRAVERSE_HANDOFF, ENGINE_CHECKOUT, KIT_CPQ_ALIGNMENT,
  SPEC_SHEET_*, ORDER_ENTRY_FLOW, SHOPFLOOR_CATCHUP, ROD_PIECE_INVENTORY, FABRICUT_MIGRATION, PORTAL_*) — not
  read this session, per the brief.

---

## 5. Two document corrections worth making when a session is next in each file

- `CLAUDE.md` "Brand → NetSuite map" bullet: says four copies in PickPack/NetSuiteSync/ERPPushPull/AdminTab;
  the copies are `Shared/brandNetsuite.js` (canonical), `StockViewTab.js:33`, `LibraryTab.js:42`.
- `RTG_CONTROL_BRIEF.md` §1: the sentence about the WMS completions and `clearConvertGate` calling the shared
  release describes the intended state, not the code (items 11–12).

*Stopping here, per the brief. Nothing edited, shipped or changed in production; this file is uncommitted.*

---

## 6. Changes since this report (each session appends; newest first)

- **2026-09-10 · S2 · 6c72e80 (live).** The Close-all incident (BRIEF_S2 §1): cause confirmed in code — the
  FLOOR_DONE finding reads ONE floor document's `Complete` as the order being done, `isDoneState(parent)` never
  reads the propagated `floorPhase`, pick-only docs are born Complete, and `reconcileAll` was offered on that
  finding. Recovery shipped: `Shared/orderLifecycle.reopenPlanFor / planBulkReopen / applyBulkReopen` (pure, 66
  assertions) + RTG Board vs Floor **⟲ Reopen a bulk close** (dry run, confirm, ledgered write; every restore
  from the document's own stamps — shipped / put away stay closed). Live read before the fix: the close ran
  ≈08:31, cancelled one queued write (NS Fulfillment WO-SO60152), raised 148 NS_CLOSE_TODO rows. Named, not
  fixed: the closer raises NS_CLOSE_TODO off the hq record's `nsWoId` without reading `nsWoCompletionPosted`.
  Next: the reopen run against Stuart's hand list, then Issue 2 (FLOOR_DONE never bulk-closable; parent reads
  `floorPhase`; whole-order test; pick-only never done until packed; closer snapshots the pre-close state).
  Adds to §2.2 as a hand-off: S3 shows the `reopenConfirmPick` chip in the WMS (BRIEF_S3 §6).
