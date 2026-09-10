# Shop Floor — continuation brief for the next joint session

*Written 2026-09-09 by the Brief C session, at Stuart's request: "a brief for all that we have
done on shop floor, all key points … a detailed brief to continue with handoff for a new joint
session." Supersedes `SESSION_OPENERS.md §C` as the opener. `BRIEF_C_SHOP_FLOOR.md` stays the
original scope; `BRIEF_C_HANDOFF.md` stays the day-by-day log (§1–§8). This document is the
state, the rules now live, and the work in order.*

## ⛔ WORKING AGREEMENT (Stuart, 2026-08-31) — binds this session

1. **Plan first, always** — state the plan and WAIT for approval before editing code, shipping, or
   changing production data. Reading and measuring need no permission; changing does. Stuart
   answers approvals in his own session or through an integration session — **relayed approvals
   count** (Stuart, 2026-09-02).
2. **Requested scope only.** Adjacent problems get NAMED, not fixed.
3. **No temporary fixes.**
4. **Look downstream — RTG is the single source of truth.** Trace every change through work
   orders, finishing, shop, WMS, NetSuite, and say so in the plan.

**Standing rules S1–S5** (top of `BRIEF_A_WO_PO_CREATION.md`) bind every session. For the shop:
**S1** a behaviour change is a tag on the item + one read site; **S2** the User Guide moves with
the code (`src/components/HQ/UserGuideTab.js`, `ShopFloorGuide`); **S3** the shop *receives*
work, it never routes it. **Hard rule restated 2026-09-03:** every order from every door lands in
RTG as the master record; the shop writes no order of its own, ever.

---

## 0. Operating the session

**Login (pin-in).** The shop is its own PIN-gated front-end at `/shop-floor` (`authenticatePin`;
permissions in `shop_config/permissions`, edited in HQ AdminTab; `superadmin`→`admin` collapse).
Drive Stuart's real Chrome with the Claude-in-Chrome tools: `navigate` to the URL (a new tab
group), then `find`→ref, never coordinates for controls. Two gates: the Factory Portal email
gate ("Verifying session…" — if it hangs, Stuart reloads it; it never calls Firebase when stuck)
then the **Shop Command PIN**. Stuart types both — NEVER enter credentials; bring the gate up
and say so. Auth survives SPA tab-switching, not reloads; **every deploy you verify by reload
costs Stuart a re-PIN** — batch your pushes.

**Vercel (auto-deploys on push to main).** `curl -s https://www.4cosworkcenter.com/version.json`
→ `{v: <ms epoch>}`. **A stamp proves nothing** with six sessions pushing: the first stamp after
your push is usually the build of the commit before yours. Verify by marker: **ShopFloor compiles
into `main.*.js`** (not a lazy chunk — the original brief was wrong); the User Guide is in a
numbered chunk (sweep `asset-manifest.json`). Use plain-ASCII string literals from YOUR commit,
and one that proves the OLD code is gone. The loop that works:
```bash
m=$(curl -sL https://www.4cosworkcenter.com/ | grep -o 'static/js/main\.[a-z0-9]*\.js' | head -1)
curl -sL "https://www.4cosworkcenter.com/$m" -o /tmp/main.js
LC_ALL=C grep -c '<marker from your commit>' /tmp/main.js
```
A "push freeze" is declared by whichever session is running a live entry test (save-is-send
refuses on a new bundle mid-run). Commit locally, hold the push, push when released.

**Cloud Shell** (functions + rules do NOT auto-deploy): nothing in this brief needs either.

**Git.** Shared checkout, many sessions: never switch branches, stage only your files, `rm -f
.git/index.lock`, `git pull --rebase --autostash origin main` before every push, fix-forward,
`npx --no-install eslint <path>` → 0 errors. **Before editing a file another brief also writes
(the User Guide above all): `git status --short <file>` — if it shows `M`, someone has uncommitted
edits in it; you cannot stage yours without staging theirs. Wait.**

**Peers.** The session-to-session `SendMessage` tool was retired on 2026-09-08. Cross-brief
hand-offs go the durable way: **a patch spec written into the hand-offs section of THEIR brief**
(and yours arrive at the end of `BRIEF_C_SHOP_FLOOR.md` — read it on every start; three landed
there unannounced this week). Identify as "Brief C session" in every commit message.

**Diagnosis.** Firestore enforces App Check — no script reads production. Read the shop's docs
through the app (the card, 🔍 View Item, the RTG board, Where-is-it); read the code with git.
A marker grep of the live bundle beats any dashboard.

---

## 1. What the shop app is, and what you own

`src/components/ShopFloor/ShopFloor.js` (custom cards, milling intake, scheduler, tracker, logs,
export), `ShopEngineering.js` (routings / programs / tooling / machine config),
`shopShared.js` (`shopDb` prefixes bare names with `shop_`, `SHOP_TABS`), `Shared/programPrints.js`,
`Shared/RodPieceInventory.js` (the custom card's rod panel; HQ 6.5's mount is read-only to you),
`Shared/rodPieces.js` (offline-tested policy — extend with tests, never bend),
`Shared/rodPieceLedger.js` (the shop is its only writer; its NetSuite scrap post rides D's outbox).

**Read-only:** B's (`RTGDispatchTab`, `FinishingFloor/*`, `workOrderContract`, `orderLifecycle`,
`orderStatus`, `orderHold`, `floorRelease`), A's (`StockViewTab`, `LibraryTab`, `finishRouting`,
`workOrderCreate`), D's (`PickPack/*`, `platingDemand`, `nsOutbox`, `functions/`), E's (`CPQTab`,
`VisionHardware`, `salesOrderHeader`), F's (the tag engine, `traverseTags`).

**Must not touch:** anything that *decides* where an order goes. `isMillingRouted` and the Custom
tab's exclusion of `MILLING`/`isStock` *read* a stated route — fine. A test that infers a route
from an item code is not.

**Data.** `shop_custom_orders` is the order's **spine** — written by RTG's `autoSplitSalesOrder`
(CPQ sales orders, id `SHOP-<orderKey>`) and `pushToShop` (stock milling and the Order Entry
custom half, id `SHOP-<hq_work_orders id>`). The milling intake stamps it `In Milling`, never
deletes it. `shop_milling` / `shop_schedule` / `shop_routings` / `shop_programs` / `shop_tooling`
/ `shop_materials` / `shop_failures` / `shop_livio` are the shop's own. `writeLog` goes to
`hq_logs`.

---

## 2. The contracts now LIVE — what the shop writes, what it reads

**2.1 The custom half has four states** (`Shared/workOrderContract.CUSTOM_FAB_STATUS`, B5
`3133aba`): `Pending → In Process → Sent to Plating | Complete`. `mirrorCustomStatusToSibling`
refuses any other string and stamps `customFabAt`. **Who writes which:**

| moment | shop writes on its doc | mirrors onto the finishing sibling | who else |
|---|---|---|---|
| ▶ Start (staged row or card) | `status 'In Process'`, `startedAt/By` | `IN_PROCESS` + `releaseSiblingToPickPack` (the ONLY thing that opens the WMS pick for a split order) | message to FINISHING **only if `finSiblingId`** (Q2) |
| Complete & Label, in-house finish | `status 'Completed'` | `COMPLETE` | message STAGING ALERT → PICK_PACK |
| Complete & Label, outsourced finish | `status 'Sent to Plating'`, `platingDemandCreated/Id` | `SENT_TO_PLATING` — the pack gate (`customPartsReady`) waits; RTG/WMS chip reads **"At the plater since <date>"** | ONE `plating_demand` `PLD-CUSTOM-<shopDocId>`; message OB PLATING → PICK_PACK; the finishing floor is never told |
| D's receiving station, build-back (D1, live) | — | `COMPLETE` + `propagateFloorState 'Plated'` — the only route to Complete for a plated part | receipt propagates `'Plating Received'` first |
| ↩ Undo (Recently Completed) | `status 'In Process'`, `completedAt null`; if `platingDemandId`: `platingDemandCreated:false, platingDemandId:null` | `IN_PROCESS` | `cancelPlatingDemand` (D's, ledgered delete) — **the reopen is REFUSED if the parts have shipped** ("receive them back first") |

**The outsourced test is ONE shared test:** `toPlating = order.isOutsourced === true ||
finishRouteOf({ finishRecipe, partsList: cutList, stockErpId }).outsourced`
(`Shared/finishRouting`). Both local regex copies are gone; the acceptance grep
`grep -nE "MEP\\d\*\|EP\[1-6\]" src/components/ShopFloor/` must stay empty.

**2.2 The plating demand the shop raises** (D1 reads it): existing shape + `finSiblingId`,
`orderKey`, `salesOrderId`, `shopOrderId` (the shop doc id), `custom: true`; `finishCode` from
the shared route's code (else the item's own suffix), `baseErpId` = `millBaseOf(itemCode)`.

**2.3 The milling pipeline tells RTG's record** (C2 `334c9c3`, now through B's resolver
`b313082`): the tracker's last GOOD op → `propagateFloorState(ctx, { finWo: spine, phase:
'Complete', extra: { millGoodQty, millScrapQty, millCompletedAt, millCompletedBy } })`; any
FAILED op, or an op with zero good → `phase 'Failed'`, `extra: { millFailReason, millFailedOp,
millFailedAt, millFailedBy }`, and **the spine is NOT marked Completed on zero good** (before, it
cleared RTG's component gate for parts that did not exist). D3's root-build trigger reads
`floorPhase === 'Complete' && millGoodQty > 0 && nsWoId && !nsRootBuildPosted`. **The shop never
posts a NetSuite build.** The resolver finds the hq record from the spine's `SHOP-<id>` key (B7
`62ad937`); the spine's `orderKey` is the LIBRARY PART id for stock milling, so never key on it.

**2.4 What the card shows, and the rules behind it**
- **Cut list** (`cutList`, from the CPQ breakdown) and **Cut To** (`cutLength`). A straight
  cut-to-length pole needs nothing else — **Stuart 2026-09-03: "fabricut cost no need for vision
  as it is straight cuts."**
- **Pole Cut Sheet** from `fabNotes` (RTG copies the job's Vision `engineeringNotes`): method
  (bend / splice / miter), O2O, Left/Center/Right finished + raw cut, saw angles, bend radius,
  Ø, system O2O, hidden hanger locations, Vision notes.
- **Traverse Cut Sheet** (`b313082`) when `fabNotes.traverseCuts` is present: header
  `drive · setup · <frontLayer> front`; rows Fascia / Track / F-clip · `Cut n.nn"` · `× qty`,
  numbers **as Vision computed them (`Shared/traverseTags TRAVERSE_DEDUCTIONS`), never
  recomputed on the floor**. Replaces the Pole Cut Sheet for a traverse job; null on solid poles.
- **"NO CUT SHEET FROM VISION"** (red, active card + staged row; `4f17eb7` narrowed by
  `827562b`): fires only when the doc carries Vision evidence (`bracketNotes` / `visionNotes` /
  `fabNotes.hangerLocations`) AND every engineered field is empty — the draft-saved-before-
  engineered case. A straight cut with empty `fabNotes` is ordinary work. A bend configured in
  CPQ **without** Vision is E's guard at add-to-cart / finalize, never inferred here from codes.
- **Shop Instruction** (`42aa3a7`) when the order has no cut list (an Order Entry custom line
  has no geometry): read live from the item's `manufacturingSpecs.shopInstruction` (doc's own
  `shopInstruction` first, exact code, then mill base). Editors: Library card + 4.5 Mass Update
  (A's `4ae891e`). **The strings still have to be typed on the items (Stuart/Eric).**
- **Multi-config orders** show the FIRST configuration's cut sheet only (`mergedNotesObj` = first
  cart item); the others are reachable per row via 🔍 View Item. Stuart has not asked for that
  to change.
- **Holds / urgent / Where-is-it / the sibling chips** — unchanged from the 08-26 catch-up.

---

## 3. What shipped (Brief C, 2026-09-02 → 09-08), with proof

| commit | what | proof |
|---|---|---|
| `334c9c3` | C2 — mill-complete / failed stamps on the RTG record; zero-good = Failed | marker in main |
| `42aa3a7` | Q1 Shop Instruction on the card (read side) · Q2 START message only with a sibling | marker in main |
| `96d6768` `9b73208` | User Guide **Shop Floor** section (S2) · handoff | chunk 514 |
| `4f17eb7` → `827562b` | "No cut sheet from Vision" notice, then narrowed to Vision-evidence-only on Stuart's ruling | main |
| `9ef3331` | **C1** — `'Sent to Plating'` mirrored at send, `'Complete'` only in-house; one shared outsourced test; demand gains the linkage fields | `main.697682a3.js`: demand carries `shopOrderId`, `SENT_TO_PLATING`, old regex gone |
| `c99d334` | Guide: the plating paragraph says "At the plater" | chunk 514 |
| `b313082` | Traverse Cut Sheet · reopen cancels its plating demand (refuses if shipped) · C2 via `propagateFloorState`, `hqWorkOrderIdOf` retired | `main.1d989844.js`: `Traverse Cut Sheet`=1, `cannot be reopened`=1, old direct-write string=0 |

Peers' commits the shop depends on: B5 `3133aba` (the four states), B2 `7182f2e` (gates), B7
`62ad937` (resolver), A `4ae891e` (instruction editors), D `5571d77` (`cancelPlatingDemand`),
D1 (receiving station build-back mirrors `Complete`, propagates `'Plated'` — live in
`PickPackApp.js`), B/E `b6c5921` (traverse fields on `fabNotes`).

---

## 4. Stuart's decisions this cycle (verbatim in intent)

- **Q1** the shop instruction lives ON THE ITEM (Library card + 4.5); the card shows it when there
  is no cut list.
- **Q2** START message to finishing only when a finishing sibling exists.
- **SO60147** (Brimar, empty cut sheet, 08-31): "not worried about this one order, it is ok to go
  thru as is, just want to fix for the future." → the notice (shop), E's source guard, B's
  split-time stamp.
- **"fabricut cost no need for vision as it is straight cuts"** → the notice fires only with
  Vision evidence.
- **Every order via RTG, always** (hard rule); auto-release stays off until no floor tab shows an
  order RTG never saw. The shop satisfies it: every card is RTG-written.
- **Q3 (root-build N) and Q4 (the 20 ft stick family) — still unanswered.** Ask one line each
  with a default: "N = 3 verified manual ⛏ posts before D flips the flag"; "H1-1R only, 20 ft,
  offcuts kept, home bin = library bin — confirm or list others".

---

## 5. The work, in order (what the new session does)

1. **Prove the plating round trip live (C1 §6 rows)** — the one thing shipped and NOT yet run.
   Needs **a custom order with an outsourced finish** on the Custom tab; on 2026-09-09 there was
   none (SO60239 staged = GOP in-house; the eight in-process Brimar = GL5/BL). Stuart raises one
   (CPQ, an /EP finish, saved as a sales order, split by RTG — small qty). Then, pinned in, with
   a screenshot at each step: the card as found → ▶ Start (sibling chip In Process, pick open on
   WMS) → **Complete & Label** (shop chip `Sent to Plating`; "Rest of this order" reads "At the
   plater since <today>"; OB PLATING prompt; ONE demand on WMS → Plating with `finSiblingId` /
   `orderKey` / `shopOrderId`) → **↩ Undo** (prompt names the demand cancellation; demand gone
   from the Plating tab; chip back to In Process) → **Complete again** (one fresh demand, not
   two) → hand to D's receiving station: pull → ship → receive → build-back → the sibling reads
   `Complete`, RTG "Plated, ready to pack", pack allowed. Also the refusal: undo AFTER the pull
   has shipped must say "receive them back first". D wants to watch the receipt side.
2. **The in-house row** on the same day, on an order the bench is actually finishing: Complete &
   Label → sibling `Complete`, label prints, pack allowed, **no** demand.
3. **C4 — the Order Entry pair, live** (b531f53, still untested): Order Entry → `HCUMP810` +
   `/P01` → Generate → the shop card in **Custom Fabrication** (not Stock Milling), `finSiblingId`
   set, sibling chips live, START releases the sibling pick, COMPLETE mirrors; the card shows the
   item's Shop Instruction (type one on HCUMP810 first).
4. **C5 — the rod at the saw (20 ft sticks)** once Q4 is answered: declare the family in HQ 6.5
   Tool 2 (piece length, home bin), run a custom pole through the card: RodCutPanel recommends by
   the waste rule, cut logged, remainder labelled, scrap reaches 11.1 via D's outbox. Any policy
   change goes into `rodPieces.js` **with a test**.
5. **C6 leftovers**: verify `isShopEngineer` (engineer role reaches the four engineering tabs, an
   operator does not); the Brimar bent-pole end-to-end (fab notes, hangers, Complete, sibling,
   pack); Phase-4 polish last and only what a commit already touches.
6. **C3 — read one shape** after B1's `buildShopDoc` lands: sweep the shop's fallback chains
   (`partNum || item || 'CUSTOM'`, `soNumOf`, `shopItemCodeOf`, the intake form's three
   candidates) to read the canonical field first; keep the chain for pre-B1 docs.
7. **Read `cutSheetMissing` / `visionUsed` off the doc** the day B1 stamps them (B agreed to
   stamp both on both floor docs) and delete the shop's own derivation.
8. **Audit §7/§8** — updated 2026-09-09 to the live state (this commit); keep them true.

---

## 6. Named, not fixed (hand these on, do not fix in passing)

- **WMS pre-pack confirm** lists an Order Entry custom half (`<woId>-C`) as "still in
  production" forever — nothing stamps `floorPhase` on it, and stamping it from a custom spine
  would land on the finishing half's record or the SO. Honest fix: the confirm reads
  `customFabStatus` (D's screen; spec not yet written).
- `millScrapQty` is the finalizing shift's scrap only (earlier shifts log good counts only).
- A manual milling intake with no RTG source stamps nothing — by design; D3 never fires on it.
- Multi-config cut sheet = first configuration only (above).
- "Shop drawings" = the 📄 Drawing / 📋 SOP buttons, shown only when the library item carries
  `staticShopDrawing` / SOP pages — none of the HBR1-1INPOLE cards show one (a library-data
  question, not the shop).
- Stuart's two sales-side asks relayed to E (2026-09-03): **Reopen-in-Vision does nothing**
  ("nothing pushes, loses its link?"); **the sales forms print the designer's GLB node names
  instead of descriptions + customer part #s** ("once again reverted"). Check E's handoff for
  their state before raising them again.

---

## 7. Hand-offs

**In (already landed in `BRIEF_C_SHOP_FLOOR.md`'s tail):** B5 names · B7 resolver · the traverse
field shape · the reopen-cancels-demand spec. **Read the tail of that file first, every session.**

**Out, open:** to **D** — the pre-pack-confirm wording (above); the §6 run date. To **B** — when
`buildShopDoc` stamps `cutSheetMissing` + `visionUsed`, tell C (it reads them and deletes its
derivation). To **A/E** — nothing open.

---

## 8. The User Guide (S2)

`UserGuideTab.js → ShopFloorGuide` is live and covers: the one-minute idea, the card lifecycle
(Staged → Start = the pick release → checklists → Complete & Label / Send to Plating with "At the
plater"), the Shop Instruction, the milling pipeline and what RTG sees, holds/urgency, edges.

**Added 2026-09-09 (same day, once the file was clean) — verify in the live guide chunk:**
- **Traverse cut sheet** — a traverse job's card lists Fascia / Track / F-clip cuts by drive;
  cut exactly what the row says, never re-derive from the fascia length.
- **"No cut sheet from Vision"** — what the red banner means (the drawing was saved before it was
  engineered), and that a plain straight cut never shows it.
- **Undo on a plated order** — cancels its plating demand; refused once the parts have shipped
  ("receive them back first"); a second Complete raises a fresh demand.
- **Multi-configuration orders** — the sheet shown is the first configuration's; open each row's
  🔍 View Item for the others.

---

## 9. Acceptance — the live runs still owed (Stuart pinned in)

| run | expect | state |
|---|---|---|
| Custom order, in-house finish, Complete & Label | shop `Completed`; sibling `Complete`; label prints; WMS pack allowed; **no** plating demand | not run |
| Custom order, `/EP` finish, Complete & Label | shop `Sent to Plating`; sibling `Sent to Plating`; ONE demand with `finSiblingId`/`orderKey`/`shopOrderId`; OB PLATING message; **no message to finishing**; pack refused until D's build-back | **not run — no plated order on the floor 09-09** |
| Undo → re-complete a plated order | demand cancelled on undo, one fresh demand on re-complete; undo refused once shipped | not run |
| Milling: last op GOOD | spine `Completed`; RTG record `floorPhase 'Complete'`, `millGoodQty`; component gate clears; parent releases; board shows built/scrap | not run live (code path verified in bundle) |
| Milling: last op FAILED / zero good | spine unchanged; RTG `floorPhase 'Failed'` with the reason | not run |
| Order Entry `HCUMP810` + `/P01` | card in **Custom Fabrication**, `finSiblingId` set; START releases the pick; COMPLETE mirrors; Shop Instruction shown | not run |
| Custom pole from `H1-1R` (20 ft) | RodCutPanel recommends; cut logged; remainder labelled; scrap in 11.1 | waits on Q4 |
| Brimar bent pole end to end | card carries the fab notes; Complete; sibling and pack behave | not run |
| Hold on a custom order | Start and Complete refuse with the reason | not run |
| `isShopEngineer` | engineer sees the four engineering tabs; operator does not | not run |
| `grep -nE "MEP\\d\*\|EP\[1-6\]" src/components/ShopFloor/` | empty | **passes** |

---

## 10. Opener for the new joint session (paste)

```
You are the SHOP FLOOR session (Brief C, continued). Read, in this order: CLAUDE.md (the working
agreement binds you), SHOP_FLOOR_CONTINUATION_BRIEF.md (the state, the live contracts, the work
in order), then the TAIL of BRIEF_C_SHOP_FLOOR.md (hand-offs from other briefs land there) and
BRIEF_C_HANDOFF.md §7–§8 (the last two days). Standing rules S1–S5 (top of BRIEF_A) bind you.
Territory: ShopFloor/*, shopShared.js, ShopEngineering.js, Shared/programPrints.js,
RodPieceInventory.js, rodPieces.js, rodPieceLedger.js. The shop RECEIVES work; it never routes
it. Every order lands in RTG — the shop writes no order of its own. Peer messaging is gone:
hand-offs are patch specs written into the other brief's hand-offs section; check `git status`
on any shared file before editing it. Git: never switch branches, stage only your files, pull
--rebase --autostash before every push, eslint → 0 errors, verify every ship by a marker grep of
the LIVE main bundle. Plan first and wait — every time. Requested scope only. No temporary
fixes. Trace every change downstream.
First: with Stuart pinned in, run §9 rows 1–3 (he raises one /EP custom order first), screenshot
each step, and hand D the run so it watches the receipt. Then C4. Ask Q3/Q4 one line each with
the defaults in §4. When you stop: BRIEF_C_HANDOFF.md §9 + the guide additions owed in §8.
```
