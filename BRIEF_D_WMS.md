# Brief D — WMS: every loop the warehouse closes, closed

*Cut from `SYSTEM_FLOW_AUDIT.md` (§1, §5, §7, §8, §10, §13 a/c/g) and the hand-offs in Briefs B
and C. Inherits `FLOORS_WMS_HANDOFF_BRIEF.md` (08-07) for the environment and the convert chase.
Written 2026-09-02. This session's job: the warehouse is where four loops end — the NetSuite work
order the app opened, the plated part that went out, the component gate a convert or a cut
clears, and the sales order that ships — and today two of the four end in nothing. D makes every
one of them close on its own, through the one write path, and say so on RTG.*

## ⛔ WORKING AGREEMENT (Stuart, 2026-08-31) — binds this session

1. **Plan first, always** — state the plan and WAIT for approval before editing code, shipping, or
   changing production data. Reading and measuring need no permission; changing does.
2. **Requested scope only.** Adjacent problems get NAMED, not fixed.
3. **No temporary fixes.**
4. **Look downstream — RTG is the single source of truth.** Every change traced through work
   orders, finishing, shop, WMS, NetSuite, and said in the plan.

**Two rules this brief lives or dies by.** Every NetSuite write here **moves real inventory**. A
double-tap is a double build. So: nothing is posted twice, nothing is posted from two places, and
nothing is guessed — *"DO NOT GUESS a payload"* (the multi-location fulfilment, §4 D4) is the
standing instruction from the pole session, and it holds for every line in this brief. And: **ask,
don't derive.**

## ⚙ STANDING RULES (Stuart, 2026-09-02) — verbatim from Brief A

**S1 · Tags before code.** **S2 · The guide moves with the code** — there is **no WMS section in
the guide today**; you write it (§4 D8). **S3 · Everything auto-routes; RTG records everything** —
the loops you close report to RTG. **S4 · BOTH always asks.** **S5 · POs open, accumulate, then
send** — the plater PO (Phase 3) is the one exception Stuart named: it is issued *by the shipment*,
weekly; it is not an accumulating PO. Keep it as it is.

**Decisions that bind this brief:** *Q1* — anchor WOs are closed by hand today; **the app must
build them; prevention is the goal.** *Q2* — the plating process on the WMS tab is the wanted
design; **prove it works without bugs, do not redesign it.** *B §8 answer 2* — outsourced finishes
never enter the finishing floor; the plated part's only two destinations are plating and WMS
pick/pack. *Q3* — rules are deployed.

---

## 0. Operating the session

**Login.** The WMS is its own PIN-gated front-end (chip PINs). Stuart pins you in via
**Claude-in-Chrome**, `find`→ref, never credentials. Sandra and Andrea are the users; the screens
are tablets in Spanish-first hands — wording matters (`i18n.js`).

**Vercel.** `curl -s https://www.4cosworkcenter.com/version.json` → stamp after commit time.
**PickPackApp compiles into `main.*.js`** (verified live by the D session 09-02 — not a lazy chunk; 5,813 lines, one file) — grep main for string-literal markers.

**Cloud Shell — yours, and not automatic.** `functions/index.js` (`nsOutboxWorker`,
`onStockBuildDone`, `netsuiteProxy`) deploys only from `shell.cloud.google.com`: `git pull` →
`firebase deploy --only functions:<name> --project ce-m2c-design-collab`. Local `firebase login`
fails on this Mac (memory `firebase-deploy-cloud-shell`). **Every functions change in this brief
ends with "Stuart, deploy X from Cloud Shell" and a verification that it is live** (the outbox
log shows the worker's version, or a marker in a memo). The RESTlet
(`netsuite/ce_convert_build_restlet.js`) deploys **in NetSuite** by Eric; its script/deploy ids
are constants (`PickPackApp.js:101`).

**Git.** Multi-session repo: never switch branches, stage only your files, `pull --rebase
--autostash`, fix-forward, lint to 0 errors. `ListAgents` before `Shared/`.

**Diagnosis.** App Check blocks scripts; the proxy rejects unauthenticated SuiteQL. Your windows
onto NetSuite: **11.1 → NetSuite Sync Queue** (every outbox entry, its attempts, its error), the
**RTG Transmit Log** (click a row: full error + sent payload), and Stuart/Eric screenshots. The
outbox worker runs **every minute**, leases for 5, retries with exponential backoff to 15 min, gives
up at **6 attempts** (`FAILED`), and on any retry first looks in NetSuite for an already-posted
copy by memo marker (`recoverByMarker`) — so ↻ Retry from 11.1 can never double-post *our* writes.

---

## 1. Territory

**You own:** `src/components/PickPack/PickPackApp.js` and everything in `PickPack/` ·
`functions/index.js` — `nsOutboxWorker`, `onStockBuildDone`, `netsuiteProxy` (the `portal*` and
user-directory exports are E's / not in scope) · `Shared/nsOutbox.js` · `Shared/nsWorkOrder.js` ·
`Shared/nsProxy.js` · `Shared/convertDiag.js` · `Shared/pickOrder.js`, `pickTabs.js`, `labelPrint.js`,
`platingPackingList.js`, `platingOrderPdf.js`, `quickShipUom.js`, `i18n.js` ·
`netsuite/ce_convert_build_restlet.js` (the file; Eric deploys it).

**Read-only:** A's (`StockViewTab`, `finishedRunPrecheck` — you *call* `clearConvertGate`),
B's (`RTGDispatchTab`, `workOrderContract` — you *call* `mirrorCustomStatusToSibling`,
`orderLifecycle` — you *call* `propagateFloorState`, `orderStatus` — you *read* `gatesOf`),
C's (`ShopFloor/*`, `rodPieceLedger` — it *calls* your outbox), E's (`nsTransmit`, `CPQTab`,
`QuickShipTab`).

**Must not touch:** how an order is created or routed (A), how it is released (B), what the shop
does before it reaches you (C). You are the end of every loop; if the loop was started wrong,
name it upstream.

---

## 2. What this brief inherits

| ref | item | this brief's part |
|---|---|---|
| **P0 #2 / Q1 / §13 c** | Order Entry FLOW1/FLOW2 anchor WOs are `orderType 'sales'`; `onStockBuildDone` returns on `orderType !== 'stock'` (`functions:567`); nothing posts their build — Stuart: closed by hand, **the app must build them** | D2 |
| **P0 #3, WMS side / Q2** | plating receipt (4a) and build-back (4b) **tell the order nothing** — no sibling, no mirror, no RTG (`PickPackApp.js:2313-2336`, `:2426-2468`); the pack gate reads `customFabStatus` | D1 |
| C §7 hand-offs | the plating demand gains `finSiblingId / orderKey / shopOrderId`; the hq WO gains `millGoodQty / millCompletedAt / floorPhase` at mill-complete | D1 reads the first; D3 reads the second |
| audit §8 anchors | the root build is RTG's manual ⛏ (`RTGDispatchTab.js:1862`), "automate at mill-complete once a live post is verified" | D3 |
| POLE_ROUTING_HANDOFF_BRIEF §4 | 11.1 fulfilment queue: 3 multi-location (Eric), 3 already-closed (approved-in-principle fix), 3 missing Class (the SO push, E's) | D4 |
| audit §1 | `ns_outbox` is the ONE NetSuite write path — **but the WMS posts plating pull, receive, WIP reversal and build-back directly through `nsProxyFetch`** (`:2113`, `:2323`, `:2388`, `:2462`), outside the outbox's idempotency, retry and log | D5 |
| audit §5 | the WMS clears three gates: rod cut (`:1848`), convert (`clearConvertGate`), demand-delete (`:2825`); B's `gatesOf` is the wording | D6 |
| audit §6 / P2 #14 | two pick-line dialects (`hq_sales_orders.lines[]` for Quick Ship, `fin_workorders.partsList[]`) | D7 — one reader |
| S2 | no WMS section in the User Guide | D8 |
| FLOORS_WMS brief §5 | known-open / unverified targets from the convert chase | fold what is still open into §6 |

---

## 3. The rules you build on — settled

**The outbox contract** (`Shared/nsOutbox.enqueueNsWrite` → `functions:429`): an entry carries
`kind, label, sourceApp, createdBy, targetUrl, method, payload, writeBack[]` (collection, docId,
patch, `idField`, `tranField`) and optionally a **deterministic id** (`obRef.create` refuses a
second — `onStockBuildDone`'s `wocmpl-<docId>`, the 2026-08-31 lesson) and a `dedupeKey`. Memo
markers `[app push … #xxxxxx]` are what recovery searches. **Any write that can be retried safely
belongs here.** A write whose *answer* the operator needs before continuing (the convert RESTlet's
BOM sourcing; a bin count) may stay synchronous — but it still logs to the transmit log.

**`onStockBuildDone`** (`functions:564`): fires on any `fin_workorders` write; posts the WO-linked
assembly build (`workorder/<id>/!transform/assemblyBuild`) **at pack putaway** (`packStatus
'Packed'`), into the **scanned** bin (`putawayBin`), qty = `completedParts || totalParts`; requires
`orderType 'stock'` **and** `nsWoId`; stamps `nsCompletionQueued` *after* creating the entry.
Non-WIP WOs complete via this build, never `workordercompletion` (400s).

**The fulfilment** (`:1286-1298`): pack → outbox `itemfulfillment` transform of the SO, `shipStatus
B`, writeBack `nsIfId/nsIfTran` to the fin doc (and the SO doc). Shipping executes in NetSuite;
**⤓ Tracking pull** (`pullFulfillment` `:1311`) reads `ItemShip WHERE createdfrom = <so>` and
stamps status + tracking back. That query is the one D4(a) reuses.

**The convert** (`postConvertBuild` `:106`, RESTlet `2848/1`): builds the `/P` assembly from
bin-tracked raw, server-side BOM sourcing, **against the demand's anchor WO** (`workOrderId`,
`:1718`); then `clearConvertGate` (A's) → an auto-flow WO releases itself. `diag:true` posts nothing
(`convertDiag`). `rawUnknown` rows are refused upstream.

**Rod cuts** (`:1836-1880`): completing a FINISHING cut clears `awaitingRodCut` on the hq WO and
**prints the finishing setup label at the saw** — that is what makes the order ordinary from then
on. The cut posts a 2-line adjustment (acct 254).

**Plating, the four phases** (Stuart's design, audit §13 a): **1** demand (`plating_demand`, from
A's triple or C's custom complete) → **2** pull: bin transfer Good→WIP-Plating into the plating bin
(`:2113`), a `plating_shipments` line `staged` → **3** ship: NetSuite PO to the plater + app PO
`kind:'plating'` (`:2280`) + packing list, lines `shipped` → **4a** receive: item receipt against
the PO (`:2313`), lines `received` → **4b** build-back: WIP reversal + assembly build of
`targetErpId` (`:2426`), line `built`. **The process is right; the loop back to the order is
missing.**

**JFP** (paint-only, no assembly, no WO): the pick posts a −qty adjustment (`:2607`), put-away posts
a +qty adjustment (`:1250`); the trigger ignores it (no `nsWoId`).

**Holds, urgency, where-is-it, `pendingReasonOf`** (`:787`): the WMS already explains "still
upstream" in three words. Extend that habit; do not invent a second vocabulary — B's `gatesOf`
supplies the words.

---

## 4. The work, in order

### D1 — the receipt closes the order (P0 #3 WMS side, Q2, C's hand-off)

1. **The shipment line carries the order.** When the pull (`:2071-2127`) fulfils a
   `plating_demand`, copy the demand's `finSiblingId / orderKey / salesOrderId / shopOrderId /
   custom` onto the `plating_shipments` line. C adds them to the demand; you carry them.
2. **Build-back tells the order** (`pushPlatingBuildBack` `:2426`), after the build posts:
   - custom order (`custom:true`): `mirrorCustomStatusToSibling({finSiblingId}, 'Complete')`
     (B's contract) → the pack gate opens; `propagateFloorState(finWo, 'Plated')` → RTG's chip
     changes from "At the plater since …" to "Plated, ready to pack";
   - stock plated item (A's triple): the built assembly is now on the shelf — `pullNetSuiteStock()`
     already refreshes; stamp the originating demand/PO `builtAt` so A's Stock Build Needs and the
     Snapshot read it as covered;
   - either: the app PO `kind:'plating'` gets `receivedAt / builtAt`, so External Co-Op's vendor
     card closes it.
3. **Receipt without build-back** is a state the board must see: a line `received` for > N days
   with no build is a red row on RTG (B shows it; you stamp `receivedAt`).

**Downstream trace:** *WMS* — pack gate opens only now; *RTG* — the plating state ends; *shop* —
nothing; *finishing* — nothing (never involved); *NetSuite* — unchanged posts, now on the outbox
(D5); *CRM* — the plater PO closes.

### D2 — the app builds every NetSuite WO it opens (Q1, §13 c)

The seam is one line: `if (after.orderType !== 'stock' || !after.nsWoId || after.nsCompletionQueued) return;`
(`functions:567`). Two flows open a WO on a **sales-typed** fin doc:

| flow | anchor on | opened by | must close by |
|---|---|---|---|
| **FLOW2** — the finished variant exists as a NetSuite assembly | the variant (`stockErpId`) | Order Entry review at creation; `nsWoId` stamped by writeBack, copied to the fin doc at release (`releaseFinWoToFloor` `:318`) | a WO-linked assembly build at **pack** of the finished order — the same entry `onStockBuildDone` makes for stock, into the scanned bin or, for a sales order that ships, no bin (it is fulfilled next) |
| **FLOW1** — raw + app-applied finish, no finished NS item | the **base assembly** (`nsWoOnErp`, `nsWoOnInternalId`) — "closes on the final assembly build (after mill + phosphate convert)" (`StockViewTab.js:2476-2484`) | Order Entry review at creation | a WO-linked build of the **base assembly** against the anchor at pack; the SO line was pushed as the base item (`finishFallbacks`) so fulfilment then ships it |

Do it in `onStockBuildDone`: drop the `orderType` guard, branch on `after.orderType`, and for a
sales-typed doc build `after.nsWoOnErp ? nsWoOnInternalId : stockInternalId` against `nsWoId`,
deterministic id `wocmpl-<docId>`, **before** the fulfilment entry is queued (a fulfilled SO line
needs the stock the build creates — order the two entries by `nextAttemptAt`). Sales docs with no
`nsWoId` (CPQ customs, whose NetSuite record is the SO) are untouched.

**Ask Eric first (§8 Q1):** confirm the FLOW1 close chain — that a build of the base assembly
against the anchor WO, after the /P convert has posted against its own WO, is what closes the
order in NetSuite. This is the one payload in the brief that has never been posted live; it
follows the pattern of the two that have (Route A's build, the convert's build), which is why it
is a question and not a guess. Then D deploys the function and watches the first one on 11.1 with
Stuart.

**Trace:** *NetSuite* — an open WO per Order Entry line stops accumulating; components commit and
release correctly; *RTG* — `nsWoCompletionTran` on the row; *WMS* — nothing visible; *finishing* —
nothing.

### D3 — the root build, automated (C's stamps, RTG's note)

C stamps `millCompletedAt / millGoodQty / floorPhase:'Complete'` on the hq work order of a milled
root that has `nsWoId`. Add `onMillComplete` in `functions/index.js` on `hq_work_orders/{id}`
writes: when those three are present and `nsRootBuildPosted` is not, queue the root's assembly
build against `nsWoId` (`postNsAssemblyBuild`'s payload, id `rootbuild-<woId>`, qty
`millGoodQty`, bin = the item's library bin), writeBack `nsRootBuildPosted / nsRootBuildId`. This
is exactly RTG's ⛏ (`:1862-1879`) made automatic. **Go-live is gated** (C §8 Q3): ship it behind a
per-brand flag in `system/wms_config`, watch ⛏ posts succeed live N times, then flip; B retires
the button when you say so.

### D4 — the fulfilment queue, three classes, three answers

**(a) Already fulfilled / SO closed — retries forever.** Before enqueueing the transform (`:1286`)
and inside 11.1's ↻ Retry for `kind:'itemfulfillment'`, run `pullFulfillment`'s query
(`ItemShip WHERE createdfrom = <so>`, `:1316`). If one exists: write back `nsIfId/nsIfTran`, stamp
`nsFulfillQueued: true`, **no entry**. The worker's marker recovery covers duplicates of *our*
posts; this covers fulfilments made in NetSuite by hand. Also classify the error text on a FAILED
entry ("already closed", "already fulfilled") into a plain-words `failureClass` the queue shows in
red, so a real failure is not buried under ones that can never succeed. *Approved in principle
(pole brief §4 B); build it.*

**(b) Multi-location — three failures.** *"Fulfillments can be shipped from only one location when
using Multi-Location Inventory."* Our transform sends no location; the SO carries it only on the
header. Two opposite fixes: state the location on the payload, or one fulfilment per location with
the other lines marked unfulfilled. **No code until Eric opens SO60104 and says whether its lines
carry one location or two** (§8 Q4). Write both payloads in the plan; post neither.

**(c) Missing Class** (Sinaya's SO) — `class: {id:'2'}` is sent only for `brand === 'ce'`
(`nsTransmit.js:596`), the **sales-order push**, E's file. Hand-off to E: a per-brand class map
beside `BRAND_NETSUITE_MAP`. Your fulfilment payload sends no class and needs none.

### D5 — the direct posts ride the outbox

Four WMS writes bypass the one write path: plating pull (`:2113`, bin transfer), receive
(`:2323`, item receipt), WIP reversal (`:2388`, adjustment), build-back (`:2462`, **assembly build
— a real inventory movement with no double-post guard**). Move all four to `enqueueNsWrite` with
deterministic ids (`platepull-<lineId>`, `platercv-<shipmentId>`, `platebuild-<lineId>`) and
writeBacks to the shipment line, so a double-tap cannot double-build and every one appears on the
transmit log. The operator loses the immediate NetSuite error in exchange for "queued — watch
11.1"; **ask Stuart** (§8 Q3) whether Sandra needs the synchronous answer on the pull. The convert
RESTlet stays synchronous (its BOM sourcing *is* the answer) but logs an entry.

### D6 — every gate the WMS clears, verified end to end

With B's `gatesOf` words: rod cut complete → `awaitingRodCut:false` + the setup label prints +
the order auto-releases (B) — verify the label is the one the Setup Queue expects; convert
complete → `clearConvertGate` → an auto-flow WO releases, a non-auto one shows "gate clear" on RTG;
convert to-do deleted → gate lifted with the note (`:2825`); plating build-back → D1. The WMS
**pending window** (`:777-791`) reads `gatesOf` for its reason text instead of its own three cases.

### D7 — one pick-line reader

Quick Ship orders carry `lines[] {erp, aliasErp, qty, eachQty, packs, packUom, toBeFinished,
finishCode, finishOutsourced}`; finishing orders carry `partsList[] {legacyErpId, partId, partName,
quantity, partHandling, binLocation, jfpSource}`. `c435d6d` taught the pull to read both. Put that
in one `Shared/pickLines.js` — `pickLinesOf(job) → [{code, qty, each, packs, packUom, name, bin,
source}]` — used by the queue, the pick screen, the pack screen, labels and `PullLinesLive`. When E
aligns the SO header (Q9), this is the one place the WMS changes.

### D8 — the WMS guide (S2) — from scratch

There is no WMS section in `UserGuideTab.js`. Write one, in the guide's voice, for Sandra and
Andrea: the queue and what "pending — still upstream" means; pick; pack vs put-away and what each
posts to NetSuite; convert ("Needs Phosphating"), why it waits on raw, what CHECK BOM does; rod
cuts and the label at the saw; plating — the four phases, what the PO is, what "received, awaiting
build-back" means and why the pack waits for it; counts and bin transfers; holds and where-is-it.
Plus the repo guide. Listed in the handoff.

---

## 5. What you do NOT do

- **No guessed payloads.** Multi-location waits on Eric. FLOW1's close chain is confirmed before
  it is posted. A wrong build moves real stock.
- **No second write path.** Nothing new calls `nsProxyFetch` for a POST that could ride the outbox.
- **No routing, no release, no shop.** You close loops; you do not open them.
- **No plating redesign** (Q2). The four phases stay; the loop back is added.
- **No E work** — the class map is a hand-off; the SO header is E's.
- **No fixing in passing.** Name it.

---

## 6. Acceptance — live runs, Stuart pinned in, 11.1 open beside you

| run | expect |
|---|---|
| Stock finishing order → put away | `wocmpl-<id>` entry once; build posts into the **scanned** bin; `nsWoCompletionTran` on the fin doc and RTG; a second put-away tap creates nothing |
| **Order Entry FLOW2 line** → pack | build against `nsWoId` queued **before** the fulfilment; both post; NetSuite WO closes; SO fulfilled |
| **Order Entry FLOW1 line** → pack (after Eric confirms) | build of the base assembly against the anchor; WO closes; SO line (base item) fulfils |
| CPQ custom order (no `nsWoId`) → pack | fulfilment only, exactly as today |
| Plated custom part: shop complete → pull → ship → receive → build-back | line carries `finSiblingId`; after build-back the sibling reads `'Complete'`, RTG says "Plated, ready to pack", pack allowed; the app PO closes; **every post is on the transmit log** |
| Plated stock item (A's triple) → build-back | on the shelf; Snapshot/Stock Build Needs read it covered |
| Build-back double-tap | one build (deterministic id) |
| Milled root, last op GOOD (C's stamps) with the flag on | `rootbuild-<woId>` posts once; `nsRootBuildPosted`; RTG's ⛏ no longer offered |
| Pack an SO already fulfilled by hand in NetSuite | no entry; `nsIfTran` written back from the query; 11.1 shows nothing new |
| 11.1 FAILED entry "already closed" | `failureClass` in red, plain words; ↻ Retry re-runs the pre-check and does not re-queue |
| Multi-location SO60104-class | **untouched** until Eric's answer; the plan holds both payloads |
| Rod cut for finishing complete | gate clears; the setup label the Setup Queue expects prints; the order auto-releases |
| Convert complete on an auto-flow WO | gate clears; the WO releases itself; the demand's anchor WO closed by the build |
| WMS pending window | reasons in `gatesOf` words, identical to RTG's chip |
| Quick Ship order and a finishing order in the same pick queue | both read through `pickLinesOf`; labels and pack read the same lines |
| Cloud Shell | every function change verified live (worker version / memo marker) before the run that depends on it |

---

## 7. Sequencing and hand-offs

1. **D1 the day C's demand fields land** (they are one commit on C's side; ask for them first).
   D5's build-back move can ship with it — same function.
2. **D2 after Eric's answer** (§8 Q1) — plan and payloads now, deploy after.
3. D4(a) and D7 any time. D4(b) never without Eric. D4(c) is a hand-off.
4. D3 behind the flag, after C's stamps; go-live when C/Stuart say.
5. D6 as each upstream piece lands. D8 last.
6. **Hand-offs out:** to **B** — retire ⛏ (D3 live); show "received, no build-back" rows; the
   pending-window wording. To **C** — the field names you read off the demand. To **E** — the
   per-brand class map. To **A** — the plating_demand shape is frozen by your reader.
7. **Hand-offs in:** C's demand fields + mill stamps; B's state and `gatesOf`; Eric's two answers.

   **From E, 2026-09-03 (landed):** the one `hq_sales_orders` header — every field the WMS reads
   today keeps its name and value (`orderClass 'QUICKSHIP'`, status/pickStatus, `lines[]`
   untouched). New on CPQ/CRM orders: `customerPo, shipTo[], productionNotes, needBy`, a real
   `recipe`. **Patch (D7, `Shared/pickLines.js`):** the Quick Ship order table reads
   `so.needBy || so.needByDate`; the pick-card "need by" chip reads the fin doc's `reqDate`,
   which B sources from `so.needBy` at split. `needByDate` / `reqDate` stop being written after
   the alias window — tell E if D7 lands after it closes. Class map for the SO push comes with
   E3 once Eric answers (your fulfilment payload needs none).

---

### Hand-offs from B — the names, verbatim (shipped 3133aba (B5) + 7182f2e (B2), 2026-09-02)

`Shared/workOrderContract.js`: `CUSTOM_FAB_STATUS = { PENDING:'Pending', IN_PROCESS:'In Process', SENT_TO_PLATING:'Sent to Plating', COMPLETE:'Complete' }`; `mirrorCustomStatusToSibling(shopOrderOrLink, status)` — unchanged signature, reads only `finSiblingId`, refuses an unknown status, stamps `customFabAt`.
`Shared/orderStatus.js`: `customPartsReady(wo)` (the one pack-gate test), `customFabLabel(wo)` ("At the plater since <date>"), stage `PLATING`; `GATES`, `gatesOf(wo)`, `openGatesOf(wo)`, `isReleasable(wo)`, `gateSummary(wo)`.
`Shared/orderLifecycle.js`: `propagateFloorState(ctx, { finWo, phase, by })` — phases `'Plating Received'` (receipt) and `'Plated'` (build-back) are B's vocabulary; `'Sent to Plating'` is only ever a `customFabStatus` value.
Contract text: `WORK_ORDER_CONTRACT.md` §5 / §5a.

### Hand-off from B — the JFP paint-run adjustment posts TWICE (Stuart, 2026-09-04: "it def. doubled the transaction")

**Evidence.** NetSuite IA26935 (8/25 2:39 PM, marker `#Td7hVh`) and IA26936 (2:40 PM, marker
`#kVbjg8`): same `WO-JFP-HSMCB1-04-983046`, same HSMCB1/04 ×30 into High Point-CE, both posted.
Two different outbox markers one minute apart = the APP enqueued two writes; the outbox's
per-marker idempotency never saw a retry. Stock on HSMCB1/04 is overstated by 30 — one of the two
needs reversing by hand in NetSuite (Stuart's call which).

**Cause (`PickPackApp.js`, verified 2026-09-04).** The JFP adjustment is enqueued from two places
and NEITHER passes the outbox's `dedupeKey` guard that every other NetSuite writer bitten this way
already uses (RTG `wo:hq_work_orders:<id>`, Library, `po:<id>`, `wocmpl:<id>`, `nsWorkOrder`):
1. the put-away scan (`isPaintOnlyOrder(job)` branch in the pack handler, ~:1622) — enqueues, THEN
   stamps `jfpAdjQueued`; it never checks `jfpAdjQueued`/`jfpAdjPosted` first, so a second scan or a
   second tablet on the same order queues again;
2. `redoPutaway` (~:1495, Eric 2026-08-24) — refuses only on `jfpAdjPosted`; it does NOT refuse while
   the first attempt is still PENDING/POSTING. The worker runs once a minute, so a re-post inside
   that minute (before the writeBack stamps `jfpAdjPosted`) queues a second copy — the 1-minute gap
   between the two records fits this exactly.

**Fix (yours, two places, no new mechanism):**
- both `enqueueNsWrite` calls pass `dedupeKey: \`jfp-adj:${job.id}\`` — the outbox then REFUSES a
  second entry while one is PENDING/POSTING, with its own message ("already queued … in the
  NetSuite Sync Queue"); a FAILED entry does not block, so Eric's genuine-rejection re-post still
  works;
- the put-away branch refuses up front when `job.jfpAdjQueued || job.jfpAdjPosted` (alert naming
  `jfpAdjTran` when present — same wording as `redoPutaway`'s guard), so the stamp is a guard, not
  just a record;
- `redoPutaway` additionally refuses while `job.jfpAdjQueued && !job.jfpAdjPosted` unless the
  outbox entry for that key is FAILED (the dedupeKey check covers the in-flight case; this is the
  honest message for the operator: "the first attempt is still in the queue — wait a minute or
  check 11.1").
Nothing changes for onStockBuildDone (it ignores JFP by design — no `nsWoId`). Acceptance: scan
put-away twice on a JFP order → ONE ns_outbox entry, second scan refused; press ↩ re-post within a
minute → refused; fail the entry (bad bin) → re-post allowed → ONE new entry.

**Named, not fixed (B):** the same "enqueue then stamp, never check the stamp" shape may exist on
the pack-scrap adjustment (same account 254, same payload shape) — worth a look while you are there.

### Hand-off from B — the rod-cut / convert completions RELEASE a stock order (Stuart, 2026-09-04: "imperative")

**Why.** Sandra's cut for WO-HCUMP615-N34-165016-1 posted, cleared `awaitingRodCut` and printed the
label — and the order sat parked, because the stock release (payload copy + Route A) lived only in
RTG's tab. `Shared/floorRelease.js` now carries it with no React: `releaseStockWoToFloor({ hqOrder,
brand, by, log })` → `{ released, nsNote, finId, why }` (verbatim finPayload, board's urgent wins,
dispatched stamps, then Route A with the once-ever STOP + dedupeKey + writeBack onto both docs;
refuses sales-typed / no payload / already dispatched). Callers decide the gates first with
`orderStatus.isReleasable`.

**Your two call sites (`PickPackApp.js`):**
1. **Rod cut complete** (the `isFinishingCut && o.finWoId` block, after the gate clears): re-read
   the hq doc, then
   ```js
   if (wo && wo.autoFlow && wo.status === 'Approved' && isReleasable(wo)) {
       const res = wo.orderType === 'sales' || wo.orderClass === 'ORDER_ENTRY'
           ? { released: await releaseFinWoToFloor(wo, operatorName) }            // A's sales door (unchanged)
           : await releaseStockWoToFloor({ hqOrder: wo, brand: activeBrand, by: operatorName, log: (m) => writeLog(m, 'wms') });
       writeLog(res.released ? `✂ ${o.id} released ${o.finWoId} to finishing${res.nsNote ? ' + NetSuite WO queued' : ''}` : `✂ ${o.id}: gate cleared, not released — ${res.why || 'a gate is still open'}`, 'wms');
   }
   ```
   The label already prints; keep it. If another gate is still open (convert, components) the
   order stays parked and RTG's effect takes it when that clears — say so in the log, never force.
2. **Convert complete** is A's `clearConvertGate` (their file) — A switches its stock branch to
   the same call; nothing for you there beyond the existing call.

**Downstream:** finishing — same doc it would have got from RTG; NetSuite — the same Route A
write, from the WMS instead of a tab; RTG — the record flips to Dispatched with `dispatchedBy`
= the operator; no duplicate possible (STOP + dedupeKey). Acceptance: complete a finishing cut
with NO RTG tab open → the Setup Queue shows the order within seconds and 11.1 shows its WO.

## 8. Open questions (ask before the plan)

1. **Eric — FLOW1's close.** After the /P convert posts against its WO, does a build of the base
   assembly against the top-level anchor close the order correctly? (D2)
2. **Stuart — the receipt.** When build-back completes for a *custom* order, "Plated, ready to
   pack" on RTG and the pack gate open — confirm that is the whole loop, nothing else waits.
3. **Stuart — synchronous vs queued.** Moving the plating pull to the outbox means Sandra sees
   "queued" instead of NetSuite's immediate error. Acceptable, or keep the pull synchronous and
   queue only receive + build-back?
4. **Eric — SO60104.** One location on every line, or two? (D4 b)

---

## 9. Handoff

`BRIEF_D_HANDOFF.md`: what shipped (commit, deploy, run, proof), the state of D1–D8, what waits on
Eric / C / B / E, anything named and not fixed. Update `SYSTEM_FLOW_AUDIT.md` §8 to the new state.
**The guide (S2):** the new WMS section, listed.

### Hand-off from B — Shop REOPEN of a plated order leaves its plating demand alive (sweep, 2026-09-04)

`ShopFloor.js` Reopen (complete → In Process, ~:1259) mirrors `'In Process'` back to the
finishing sibling (correct) but the `plating_demand` that Complete & Label raised
(`platingDemandCreated` / `platingDemandId` on the shop doc) stays OPEN on the WMS Plating tab —
a stale demand for parts that are back on the bench. Patch (C's handler, D's collection):
on Reopen, if `order.platingDemandId` and the demand is still `status:'open'` and not yet on a
`plating_shipments` line, set it `status:'CANCELLED', cancelReason:'shop reopened <woNum>'` and
clear `platingDemandCreated` so a second Complete raises a fresh one; if it HAS shipped, refuse
the reopen ("parts are at the plater — receive them first"). D: `cancelPlatingDemand(id, reason)`
exported from the plating module so C never writes the collection directly.

### From B — the receipt gate's covered-quantity rule is ACCEPTED (Stuart, 2026-09-04)
Stuart confirms D builds to the rule in the `awaitingReceipt` spec above: the gate clears only when
the RECEIVED quantity covers `qtyNeeded` (a PO for 12 arriving as 5 keeps it closed; the note says
"5 of 12 arrived"), never on "the PO was received". For the record, that refinement was **Brief
A's** (A named `receiptRefs[{poId,itemId,qtyNeeded}]`, the array shape and the covering arithmetic
when it named the fields); B relayed it. A exports `clearReceiptGate`, D calls it, B's GATES reads
`awaitingReceipt`. D can read but no longer send messages — the briefs are the channel.
