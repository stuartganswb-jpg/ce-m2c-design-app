# Brief B — RTG Dispatch + Finishing Floor: one release, one gate list, no buttons

*Cut from `SYSTEM_FLOW_AUDIT.md` (read it first — §1, §4, §5, §7, §8, §10, §13 are yours) and
`BRIEF_A_WO_PO_CREATION.md` (its standing rules and its §7 hand-offs to you). Written 2026-09-02.
This session's job: the six hand-copied ways an order reaches a floor become two shared builders;
the three hand-written gate lists become one; the RTG board stops being a place a person presses
buttons and becomes the record and control it is meant to be; and the finishing floor says why an
order is stuck instead of grouping it under a label.*

## ⛔ WORKING AGREEMENT (Stuart, 2026-08-31) — binds this session

1. **Plan first, always** — state the plan and WAIT for approval before editing code, shipping, or
   changing production data. Reading and measuring need no permission; changing does.
2. **Requested scope only** — exactly what was asked. Adjacent problems get NAMED, not fixed.
3. **No temporary fixes** — fix the cause, or say it cannot be done properly and stop.
4. **Look downstream — RTG is the single source of truth.** Before any change, trace it through
   work orders, the finishing floor, the shop floor, WMS and NetSuite, and say so in the plan.

Full text: `CLAUDE.md`. And the two lessons of this fortnight: **ask, don't derive**, and **a sweep
covers every place that decides the thing** — you own the file (`RTGDispatchTab.js`) that four
sessions have each touched this month; assume nothing about it that you have not just read.

## ⚙ STANDING RULES (Stuart, 2026-09-02) — verbatim from Brief A; S3 is *this* brief's centre

**S1 · Tags before code.** A behaviour change is a tag on the item (4.5 Mass Update + the Library
card) and one read site — not a routing rewrite. (Q7 stays closed: the pole rule is the suffix.)
**S2 · The guide moves with the code.** `UserGuideTab.js` + the repo guide, before the handoff.
**S3 · Everything auto-routes; RTG records everything.** Shop WO, finishing WO, purchase order —
no manual push anywhere. RTG holds the master record and is where a person sees status and closes.
**S4 · BOTH always asks, on every screen.** Work order or purchase order — never defaulted.
**S5 · Purchase orders open, accumulate, then send.** One open PO per vendor; a person sends once.

---

## 0. Operating the session

**Login.** Stuart pins you in — **Claude-in-Chrome**, his session, `find`→ref not coordinates. HQ:
Factory Portal (email+password) then the Enterprise PLM PIN on every `/hq` load. **The finishing
floor is its own front-end** with chip PINs (`fin_users`, see memory `user-directory-model`) —
ask Stuart to pin you into a floor tablet view when you need to see the Setup Queue or Active
Floor as Grace does. Never enter credentials.

**Vercel.** `curl -s https://www.4cosworkcenter.com/version.json` → stamp after commit time = live.
Whether `RTGDispatchTab` is in `main.*.js` or a lazy chunk: **check `/asset-manifest.json`**, do
not assume — the 2026-07-26 false alarm was exactly this. Markers must be string literals.

**Cloud Shell.** Rules are deployed (Stuart, 09-02). `onStockBuildDone` and the outbox worker are
D's; if your work needs a functions change, it is a hand-off to D, not a deploy you make.

**Git.** Never switch branches in the shared checkout; stage only your files; `pull --rebase
--autostash` before push; fix-forward on main; `npx --no-install eslint <path>` → 0 errors.
**`RTGDispatchTab.js` is the most-changed file in the repo (36 commits since 08-25).** Before
every edit session: `ListAgents`, message every live peer, wait for "not mine". The pole session
did exactly this on 09-01 and it was the reason nothing was lost.

**Diagnosis.** App Check blocks scripts. Bulk checks are in-app dry-run buttons (the 🪝 model).
NetSuite: the RTG Transmit Log, 11.1 → Sync Queue, or a screenshot.

---

## 1. Territory

**You own:** `src/components/HQ/RTGDispatchTab.js` · everything in `src/components/FinishingFloor/`
(`SetupQueue.js` 1024, `ActiveFloor.js` 1692, `Recipes.js`, `Management.js`, `ProductionTimes.js`,
`SchedulePlanner.js`, `Modals.js`, `Summary.js`, `FinishingFloor.js`, the rest) ·
`Shared/workOrderContract.js` · `Shared/orderLifecycle.js` · `Shared/orderStatus.js` ·
`Shared/finishingTime.js` · `Shared/orderHold.js` · `Shared/woRef.js` · `Shared/floorActivity.js` ·
`Shared/OrderStatusChips.js` · `Shared/WhereIsIt.js` · `Shared/PullLinesLive.js` · and the new
`Shared/floorRelease.js` this brief creates.

**Read-only to you:** A's (`StockViewTab`, `LibraryTab`, `finishedRunPrecheck`,
`finishedGoodsRun`, `stockRun`, `poleCut`, `finishRouting`, `sourcing`); C's (`ShopFloor/*`); D's
(`PickPack/*`, `nsOutbox`, `nsWorkOrder`, `functions/`); E's (`CPQTab`, `QuickShipTab`,
`nsTransmit`, `lineClassification`, `hardwareHandoff`).

**Must not touch:** the writers (A parks; you release). `releaseFinWoToFloor` and
`executeMakeupActions`' direct shop write live in A's `finishedRunPrecheck.js` — you *replace
what they call* (your builders), A swaps the call. The shop floor's own status flow
(`handleStartProcess`, `handleCompleteWithLabel`) is C's; you define the contract it calls.

---

## 2. What this brief inherits

| ref | item | this brief's part |
|---|---|---|
| P1 #5 | **six release implementations** (four finishing, two shop) | one `buildFinDoc`, one `buildShopDoc` |
| P1 #10 | the gate list hand-written in three places | one `gatesOf(wo)` |
| P1 #8 | recipe resolved in four places, PENDING-RECIPE still reachable | read the stamped recipe first (Q10); make the fallback explain itself |
| P0 #1 (writer 10) | RTG re-issue parks route-open | A's patch spec: one `parkWorkOrder` call |
| P0 #3, fin side | shop mirrors Complete before the plater; pack gate opens | the `customFabStatus` contract gains `'Sent to Plating'`; Setup Queue shows it |
| Q2 | the plating process is the wanted design — prove it works | the fin-side states and the RTG view of a plated order |
| Q5 | Snapshot model | your builders assume a complete `finPayload`; the enrich branch becomes a legacy fallback, then goes |
| Q6, Q11 → **S3** | no manual push; RTG records everything | retire the Push buttons into status; auto-release covers every parked order; the PO panel becomes review-and-send |
| Q10 | recipe stamped at save (E) | release reads it; stop re-deriving |
| Q1 (§13 c) | the app builds every NetSuite WO it opens | D owns the trigger; you own that the fin doc carries `nsWoId` and `orderType` correctly for it |
| A §7 hand-offs | writer 8 (Setup Queue re-make), writer 10 (re-issue), PO memo `:268`, the PO review/send surface | §4 B6 |
| S1–S5 | standing rules | S3 is yours to make true |

---

## 3. The rules you build on — settled, not to be re-derived

**The contract** (`Shared/workOrderContract.js`, `WORK_ORDER_CONTRACT.md` — the 06-10 doc is the
*origin*; the module is the truth): `fin_workorders` carries `orderKey / quoteId / salesOrderId /
estimateId`, `orderType 'sales' | 'stock'`, `recipe` (a **code**, e.g. `RF1`; `finishLabel` is the
human string), `totalParts`, `partsList[]`, `paintSize/paintSizes` **or** `poles/totalPoles`
(never both: `00b26f3`), `finishStream`, `tasks: makeFullTasks()` (spin/pole/hand, `poleHand`),
`sentToPickPack / pickStatus`, `shopSiblingId / hasCustomSibling / customFabStatus`, `itemCode`
(`withItemCode`). `shop_custom_orders` carries `finSiblingId / hasSmallSibling`, `category`,
`routeTo MILLING | CUSTOM_FAB`, `cutList`, `needsPhosphating`, `isOutsourced`.

**§A1 / §5 of the contract:** the shop operator's **START** releases the sibling pick
(`releaseSiblingToPickPack`); shop progress mirrors onto the fin doc (`mirrorCustomStatusToSibling`).
A small-only order (no custom sibling) is released to pick at split. Both key entirely on
`finSiblingId`.

**The gates** (audit §5): `awaitingRodCut` · `awaitingConvert` · `awaitingComponents &&
!componentsDone` · `awaitingSoAccept` · `awaitingNsWo && !nsWoId` · `pushedToFinishing`. Their
clearers are A's and D's; the *evaluation* is yours, in three places today (`RTGDispatchTab.js:350`
auto-release effect, `:1350` `pushToFinishing` auto branch, and A's `clearConvertGate` `:341`).

**Route A** (`queueNsStockWorkOrder` `:1275`): a **stock** finishing release queues the NetSuite
assembly WO with writeBack to both docs; resolves the assembly id from four sources; one WO per
app WO, ever. Sales-typed payloads never queue one here — their anchor is opened at creation (A).

**The one closer** (`orderLifecycle.closeOrderEverywhere`) and `propagateFloorState` (the floor
tells RTG what it did — `tellRtg` in the Setup Queue, and ActiveFloor `:181`). `auditOrphans`
exists; make sure the board surfaces it.

**Recipe resolution today:** sales → `fetchEnrichedJobData` (`:696`, five sources against
`master_finishes`); stock → `woRecipeCode` off five code fields; finPayload writers stamp their
own. `PENDING_RECIPE` is a constant in `finishingTime.js`; `finishRouteOf` reads suffixes off
`partsList` as a last resort.

**Pick release on the floor** (`SetupQueue.releasePickPatch` `:133`): Start Setup releases the pick;
an order with no `partsList` but a `stockErpId` gets a **synthesized raw-base pull**; an order with
neither is "not sent to WMS." The outsourced group is segregated by `finishRouteOf` (`:50`).

**Pole vs sled:** `poles/totalPoles` decides the stream on the doc; `finishStream: 'POLES'` decides
the recipe variant (`-P`). `isPoleCategory` is the one test. Never a local copy.

**Force-complete's NetSuite fork** (`ActiveFloor.js:376`): stays exactly as it is — it is the
supervisor exception path, and it already coordinates with `onStockBuildDone`.

---

## 4. The work, in order

### B1 — two builders: `buildFinDoc`, `buildShopDoc`

New module `src/components/Shared/floorRelease.js`. Everything that writes a floor document calls
one of these; nothing else assembles the field list.

```js
buildFinDoc({ hqOrder, finPayload, by, now, urgent, nsWoId, nsWoTran, holds })
→ the exact fin_workorders doc to write (id = finPayload.id ?? hqOrder.id)
buildShopDoc({ hqOrder, orderType, lines, finishRecipe, by, now, finSiblingId, isOutsourced, needsPhosphating })
→ the exact shop_custom_orders doc (id = `SHOP-${hqOrder.id}`)
```

`buildFinDoc` is the union of what the four copiers do today, once:
- verbatim `...finPayload` (the Snapshot model — after A, every parked order has one);
- **`urgent` merge** — the board's later statement wins (`pushToFinishing` `:1389` has it; `releaseFinWoToFloor` does not);
- **`nsWoId / nsWoTran` stamp** from the hq doc (`releaseFinWoToFloor` `:318` has it; `pushToFinishing` waits for the writeBack);
- `dispatchedAt / dispatchedBy`, `withItemCode`, the hold state (`orderHold`) carried, never dropped;
- the **pole/sled exclusivity** asserted (throws in dev, logs in prod, if both `poles` and `paintSizes` are present);
- `sentToPickPack: !hasCustomSibling` for a sales split (the §A1 rule from `autoSplitSalesOrder` `:1103`), `false` for anything that waits on a shop start or a gate.

`buildShopDoc` is `pushToShop`'s payload (`:1595-1640`) and `autoSplitSalesOrder`'s shop half
(`:1145`) and `executeMakeupActions`' direct write (`finishedRunPrecheck.js:259`) reconciled:
`category` and `routeTo` from `orderType`; `finSiblingId / hasSmallSibling` from the source;
`needsPhosphating` by the one rule (`:1127`); `cutList` when lines carry `cutLength`;
`isOutsourced` from the recipe via `isOutsourcedFinishCode` — **not** the `hq_outsource_finishes`
name-includes match at `:1584`/`:1121` (two different tests for the same fact today; pick the
shared one and say so in the plan).

Then the six call sites become one call each:

| # | path | file:line | after |
|---|---|---|---|
| 1 | `pushToFinishing` verbatim branch | `RTGDispatchTab.js:1381` | `setDoc(buildFinDoc(...))` |
| 2 | `pushToFinishing` enrich branch | `:1408-1539` | **legacy fallback only** for docs parked before A ships; logs "enriched at release — legacy writer" so the board can count them; deleted when the count is zero for a week |
| 3 | `autoSplitSalesOrder` fin half | `:1080` | `buildFinDoc` with the split's computed payload |
| 4 | `autoSplitSalesOrder` shop half | `:1145` | `buildShopDoc` |
| 5 | `pushToShop` | `:1567` | `buildShopDoc` |
| 6 | `releaseFinWoToFloor` (A's file) | `finishedRunPrecheck.js:316` | **hand-off to A**: replace the inline `setDoc` with `buildFinDoc`; A swaps it the commit after yours lands |
| 7 | `executeMakeupActions` direct shop write (A's file) | `:259` | hand-off to A: `buildShopDoc` |
| 8 | Library `releaseRunToFloor` (A's writer 7) | `LibraryTab.js:1122` | A converts it to `parkWorkOrder` + auto-release **once your builders exist** — tell A the day B1 lands |

**Downstream trace (rule 4):** *work orders* — same ids, same anchors; *finishing* — every
released doc now carries the union (urgent, nsWoId, holds, stream, poles), so the Setup Queue and
ActiveFloor see one shape; *shop* — one payload shape, `finSiblingId` always carried; *WMS* — the
pick release rule (`sentToPickPack`) applied identically for every source; *NetSuite* — Route A
unchanged, called from the same place; **no new push.**

### B2 — one gate list: `gatesOf(wo)`

In `Shared/orderStatus.js` (it already owns `pickGateOf` and `orderStatusOf`):

```js
gatesOf(wo) → [{ key:'rodCut'|'convert'|'components'|'soAccept'|'nsWo'|'dispatched', open:boolean, note:string }]
isReleasable(wo) → gatesOf(wo).every(g => !g.open)
```

Used by: the auto-release effect (`:350`), `pushToFinishing`'s auto branch (`:1350`), the board's
status text (`:2597-2618`), `WhereIsIt`, and — hand-off to A — `clearConvertGate` (`:341`). One
list, one wording. When A adds a gate (they may, for the plating triple), it is added here and
every reader sees it.

### B3 — S3: the buttons retire; RTG is the record

Today the board offers **Push to Finishing / Push to Shop** on every parked order that is not
auto-flow (`:2619-2628`), and auto-release only takes orders with `finPayload || routeTo`. After A,
every parked order has `routeTo`, `finPayload` (finishing) and `autoFlow: true`. So:

- the auto-release effect (`:345`) takes **every** `Approved` order whose `gatesOf` are all closed — the `finPayload || routeTo` test stays as a guard, never as a reason to wait for a human;
- the Push buttons are replaced by the **AUTO-FLOW status chip** pattern already at `:2615` — what it is waiting on, in `gatesOf` words, or "released → Finishing 10:42";
- a single **supervisor override** (behind the existing scary confirm at `:1376`) stays available from the order's detail view, not the row — a person can still force a release, they are never *required* to press anything. **Ask Stuart (§8 Q1) whether to keep it at all.**
- the **PO panel** (`:2660-2700`) becomes review-and-send (S5, from A's hand-off): the open PO shows its lines with their `from` sources, the running total, the vendor minimum if the record has one; **Send** is the existing push at `:244`; the memo at `:268` reads `po.note || po.source`.
- the board shows every document — WO, SO (Quick Ship included, it already does — audit §6 correction), PO, and the floor docs' live stamps — with `source` on each. A parked order with no `source` is a bug, listed in red.

### B4 — the recipe is read, not re-derived (Q10)

When E ships the stamped recipe on the sales order (`hq_sales_orders.recipe` as a **code**, both
doors), `autoSplitSalesOrder` and `pushToFinishing` read it first. `fetchEnrichedJobData`'s
five-source scan (`:739-776`) becomes the fallback for orders saved before E's change, and it
**says which source it found the recipe in** (or that it found none) on the doc as
`recipeSource`. Coordinate the date with E; do not remove the scan before then. `woRecipeCode` stays
for legacy stock docs. Target: no doc reaches the Setup Queue as `PENDING-RECIPE` without a
`recipeSource: 'none'` stamp that names the SO — so the PENDING group explains itself (B8).

### B5 — the `customFabStatus` contract grows one state (P0 #3, Q2)

Today: `Pending → In Process → Complete`, mirrored by the shop (`ShopFloor.js:1138, 1231, 1256`).
The shop's COMPLETE mirrors `'Complete'` **before** its `toPlating` branch, so a plated custom
order reads complete on the pack gate (`PickPackApp.js:2658`) while its parts are at the plater.

You define the contract, in `workOrderContract.js`:
`customFabStatus ∈ 'Pending' | 'In Process' | 'Sent to Plating' | 'Complete'`, with
`mirrorCustomStatusToSibling` accepting the new value and stamping `customFabAt`. Then:
- **C** calls `'Sent to Plating'` at shop complete when `toPlating` (their file);
- **D** calls `'Complete'` at the plating **receipt** (their file);
- **you** make the Setup Queue chip (`:791`) and `OrderStatusChips` show the state, and
  `orderStatusOf` treat `'Sent to Plating'` as *not ready to pack*.

This is the seam Q2 asks you to prove: receipts are just starting; watch one live with D.

### B6 — the hand-offs from A, landed here

- **writer 8** — Setup Queue scrap re-make (`SetupQueue.js:508`): replace the inline
  `hq_work_orders` write with `parkWorkOrder({intent:'REMAKE', source:'SETUP_QUEUE_REMAKE'})`
  the day A's builder lands; the floor-side finPayload construction (`:441-507`) goes with it;
- **writer 10** — RTG balance re-issue (`RTGDispatchTab.js:1958`): `parkWorkOrder({intent:'REISSUE',
  replaces:{woId, reason}})` — it stops parking route-open;
- **PO memo** `:268` and the **PO review/send panel** — B3 above;
- **the shop-doc contract** — `buildShopDoc`'s shape is what A's `executeMakeupActions` writes;
  publish it in `WORK_ORDER_CONTRACT.md` (update that doc — it is dated 06-10 and cited as current).

### B7 — the floor reports every event back (orderLifecycle)

`propagateFloorState` is called at ActiveFloor completion (`:181`) and from the Setup Queue's
`tellRtg`. Verify coverage: `startSetup` (`:178`), `stageToFloor` (`:194`), hold/release
(`orderHold`), force-complete (`:376`), pole/sled task completions that finish the order. Any
event RTG's status line cannot show is a gap; close it. Surface `auditOrphans` on the board with a
count, not only in a panel.

### B8 — the floor says why

The Setup Queue's PENDING-RECIPE group shows, per order, `recipeSource` (B4) and the SO/WO it came
from. "Not sent to WMS" (`:166`) says *why* (no pull lines and no stock code) and links to RTG's
order. The outsourced group says "at the plater since <date>" once B5's state exists. The
`pendingReasonOf` idea in the WMS (`PickPackApp.js:787`) is the model — a queue that explains
itself instead of listing ids.

### B9 — the guide (S2)

`UserGuideTab.js` sections **"⚡ Auto-Release"** (`:128`), **"Stock checks & prerequisite orders —
the honest matrix"** (`:109`), **"Edges to know"** (`:131`), the Work Orders section, and the
finishing-floor explainer: no more Push buttons; what the status chip words mean; the four
`customFabStatus` states; where a stuck order says why. Plus the repo guide. Listed in the handoff.

---

## 5. What you do NOT do

- **No writer changes** — A parks. If a parked doc is missing a field, you tell A; you do not
  patch it at release (that is how the enrich branch was born).
- **No shop status flow** — C's; you define `'Sent to Plating'`, C calls it.
- **No WMS, no functions** — D's. The pack gate reading your new state is D's one-line change.
- **No CPQ / Order Entry** — E's; you consume the stamped recipe.
- **No plating redesign** (Q2). **No pole tag** (Q7).
- **No fixing in passing.** Name it in the handoff.

---

## 6. Acceptance — live runs, Stuart pinned in

| run | expect |
|---|---|
| Snapshot stock order (A-parked) auto-releases | fin doc from `buildFinDoc`; board row shows the status chip, **no Push buttons**; Route A queued once; Setup Queue shows recipe group + pulls |
| Same order, marked urgent on the board after parking | released doc carries `urgent`, `needBy`, `urgentBy` — the board's later statement wins |
| Order Entry to-be-finished line (A-parked, `autoFlow`) with a convert gate | parked with the gate; WMS convert completes → `clearConvertGate` → `releaseFinWoToFloor` → `buildFinDoc`; the doc carries `nsWoId` |
| CPQ sales order with a custom line | `autoSplitSalesOrder` writes both docs via the builders; siblings cross-linked; fin `sentToPickPack:false`; shop START releases the pick |
| Shop completes a plated custom order | fin `customFabStatus:'Sent to Plating'`; Setup Queue chip says so; pack refuses; D's receipt flips to `'Complete'`; pack allows |
| A legacy parked doc (no finPayload, created before A) | the enrich fallback releases it and stamps `legacyEnriched: true`; the board's legacy count shows 1 |
| Library run (A's writer 7, after both land) | reaches the floor with the same fields as a Snapshot release — diff the two docs |
| Balance close short + re-issue | the re-issued WO parks with `routeTo`, `source:'RTG_REISSUE'`, `replacesWo`, and auto-releases |
| A parked order with two open gates | the chip names both, in `gatesOf` words, identical to what `pushToFinishing`'s override confirm says |
| PO panel | open PO shows lines with sources and running total; Send pushes once; memo reads the PO's own note/source |
| Force complete on the floor | unchanged: the NetSuite question appears only for a stock build with `nsWoId` not yet handled |
| `auditOrphans` | the board shows the count; closing an order from the floor leaves none |
| Setup Queue PENDING-RECIPE group | every order in it shows `recipeSource` and its SO; none is unexplained |

---

## 7. Sequencing and hand-offs

1. **Plan B1 + B2 now** (they need only what exists); build after A's `parkWorkOrder` signature
   is approved so the builders read A's stamps, not the old field soup. B5's contract change is
   small and independent — **do it first**, C and D are waiting on the state name.
2. B3 after B1 (the buttons can only go when the auto path covers everything).
3. B4 on E's date. B6 the day A's builder lands. B7, B8 any time. B9 last, before the handoff.
4. **Hand-offs out:** to A — swap `releaseFinWoToFloor`'s and `executeMakeupActions`' inline writes
   for your builders; `clearConvertGate` uses `gatesOf`. To C — call `'Sent to Plating'`. To D —
   call `'Complete'` at receipt; the pack gate treats `'Sent to Plating'` as not ready. To E — the
   date the stamped recipe lands.
5. **Hand-offs in:** A's three (§4 B6). E's recipe date.

---

## 8. Open questions for Stuart (ask before the plan)

1. **The supervisor override.** Keep one "release now" behind a scary confirm in the order's detail
   view, or remove the ability entirely so RTG is purely a record? (S3 says no *required* press; it
   does not say no *possible* press.)
2. **`'Sent to Plating'`** as a visible finishing-floor state — confirm the wording Grace and Sandra
   should read.
3. **The Setup Queue's scrap re-make** stays the one floor-originated writer (through
   `parkWorkOrder`)? Or should re-makes also be raised from the Snapshot only?
4. **The legacy enrich branch** — delete after a week of zero legacy releases, or keep as a
   permanent fallback?

---

## 9. Handoff

`BRIEF_B_HANDOFF.md`: what shipped (commit, run, proof), the state of each of the eight call sites
in §4 B1's table, what is waiting on A / C / D / E, anything named and not fixed. Update
`SYSTEM_FLOW_AUDIT.md` §4 and §5 to the new state, and `WORK_ORDER_CONTRACT.md` to the contract
as it now is (the 06-10 text is the origin story, not the spec). **The guide (S2):** the sections
in B9, listed.
