# Brief C — Shop Floor: the plating hand-off, the milling record, the rod at the saw

*Cut from `SYSTEM_FLOW_AUDIT.md` (§7, §8, §10, §13 g) and `BRIEF_B_RTG_FINISHING.md` (B5 — you
call the state it defines). Inherits `SHOPFLOOR_CATCHUP_BRIEF.md` (08-26) — read its §1 for what
the shop app is; its §2/§3 are mostly closed, its §4.5 leftovers are yours. Written 2026-09-02.
This session's job is small and precise: the shop stops telling the finishing floor a plated part
is finished; the milling pipeline tells RTG what it made; the custom card handles the Order Entry
pair and the rod at the saw; and nothing in the shop decides a route — it receives one.*

## ⛔ WORKING AGREEMENT (Stuart, 2026-08-31) — binds this session

1. **Plan first, always** — state the plan and WAIT for approval before editing code, shipping, or
   changing production data. Reading and measuring need no permission; changing does.
2. **Requested scope only.** Adjacent problems get NAMED, not fixed.
3. **No temporary fixes.**
4. **Look downstream — RTG is the single source of truth.** Trace every change through work
   orders, finishing, shop, WMS, NetSuite, and say so in the plan.

Full text: `CLAUDE.md`. Plus: **ask, don't derive**; **a sweep covers every place that decides the
thing** — the shop carries its own copy of the outsourced-finish grammar twice (§4 C1).

## ⚙ STANDING RULES (Stuart, 2026-09-02) — verbatim from Brief A

**S1 · Tags before code.** A behaviour change is a tag on the item (4.5 + the Library card) and one
read site. **S2 · The guide moves with the code.** **S3 · Everything auto-routes; RTG records
everything** — the shop *receives* work, it never routes it. **S4 · BOTH always asks.** **S5 ·
POs open, accumulate, then send.** (S4/S5 are A's screens; the shop raises no PO.)

**Decisions that bind this brief (audit §10, B §8):** *"Anything outsourced finish should not
ever be sent to finishing — only to either plating and/or WMS pick pack when available."* — the
shop's completion of a plated part goes to OB PLATING and tells the WMS/RTG, **never the finishing
floor**. The plating process on the WMS tab is the wanted design (Q2) — you prove your half of it
works, you do not redesign it. The pole handling rule is the suffix (Q7, second pass); no tag.

---

## 0. Operating the session

**Login.** The shop is its own PIN-gated front-end (`authenticatePin`; permissions in
`shop_config/permissions`, edited in HQ AdminTab; `superadmin`→`admin` collapse; role gates are
client-side, rules are flat `isAuth()`). Stuart pins you in via **Claude-in-Chrome** — his
session, `find`→ref, never credentials. To see the HQ side (RTG, the Library) you need the HQ
gates too; ask.

**Vercel.** `curl -s https://www.4cosworkcenter.com/version.json` → stamp after commit time.
**ShopFloor is a lazy chunk** — sweep `/asset-manifest.json`, string-literal markers only.

**Cloud Shell.** Rules are deployed (Stuart, 09-02) — including the `isShopEngineer` gate the
catch-up brief parked; **verify it works** (§4 C6). Nothing in this brief needs a rules change.

**Git.** Multi-session repo: never switch branches, stage only your files, `pull --rebase
--autostash`, fix-forward on main, `npx --no-install eslint <path>` → 0 errors. `ListAgents` and
ask before touching `Shared/`.

**Shop plumbing you will hit:** `shopDb` prefixes bare names with `shop_` (`shopShared.js`);
`writeLog` goes to **`hq_logs`**, not `shop_logs`; the `milling` / `schedule` / `routings` /
`programs` / `tooling` / `materials` / `failures` / `livio` collections all live under that prefix.
`shop_custom_orders` is the only collection the shop shares with the rest of the app, and it is
the order's **spine** — see §3.

---

## 1. Territory

**You own:** `src/components/ShopFloor/ShopFloor.js` (1683) · `ShopEngineering.js` (1095) ·
`shopShared.js` · `Shared/programPrints.js` · `Shared/RodPieceInventory.js` (the custom-card
mount; HQ 6.5's mount of the same component is read-only to you) · `Shared/rodPieces.js` (the
offline-tested policy — extend with tests, never bend) · `Shared/rodPieceLedger.js` (the shop is
its only writer; its NetSuite scrap post rides D's outbox — call it, don't change it).

**Read-only:** B's (`RTGDispatchTab`, `FinishingFloor/*`, `workOrderContract`, `orderLifecycle`,
`orderStatus`, `orderHold`, the new `floorRelease`); A's (`StockViewTab`, `LibraryTab`,
`finishedRunPrecheck`, `finishRouting`, `poleCut`); D's (`PickPack/*`, `nsOutbox`, `nsWorkOrder`,
`functions/`); E's (`CPQTab`, `QuickShipTab`, `nsTransmit`).

**Must not touch:** anything that *decides* where an order goes. The shop is downstream of RTG.
If a doc arrives in the wrong queue, the bug is upstream — name it to A or B, do not filter it
here. (`isMillingRouted` at `:1118` and the Custom tab's exclusion of `MILLING`/`isStock` are
*reading* a stated route; that is fine. A new test that infers a route from an item code is not.)

---

## 2. What this brief inherits

| ref | item | this brief's part |
|---|---|---|
| P0 #3, shop side | `handleCompleteWithLabel` mirrors `customFabStatus:'Complete'` **before** the `toPlating` branch (`ShopFloor.js:1256`), so a plated custom order reads complete on the WMS pack gate while its parts are at the plater | mirror **`'Sent to Plating'`** (B5's state) when `toPlating`; `'Complete'` only when the part is finished here |
| B §8 answer 2 | outsourced finishes never enter the finishing floor | the shop's plated completion talks to WMS/RTG only; the START message to `FINISHING` (`:1235`) follows the sibling, not a habit |
| Q2 | prove the plating round trip works | your half: shop complete → OB PLATING → the demand carries what D's receipt needs to close the loop |
| audit §8 anchors | the root NetSuite WO opened at creation for a milled item is closed by RTG's **manual ⛏** (`RTGDispatchTab.js:1862`); the code says "automate at mill-complete once a live post is verified" | the milling pipeline stamps what D needs to automate it (§4 C2); D posts; B retires the button |
| audit §5 gates | `awaitingComponents` clears when every component shop doc reads `COMPLETED` (`RTGDispatchTab.js:394`) — **verified 09-02: the scheduler's last-op completion stamps the spine `Completed` (`:593`)**, so the gate does clear | keep it; add the hq-record stamp so RTG's board shows it too, not only the gate |
| B1 | `buildShopDoc` becomes the one shape of a `shop_custom_orders` doc (`category`, `routeTo`, `finSiblingId`, `cutList`, `needsPhosphating`, `isOutsourced`) | the intake, the custom card and the labels read that shape; `finSiblingId` now always arrives (3f6a953) — sibling chips work for Order Entry pairs |
| b531f53 | the Order Entry Custom pair — untested on a live order | you run it (§6) |
| Q7 first pass (context) | raw poles like `H1-1R` are made from **20 ft sticks** — "where we will set up stock usage on shop floor" | rod pieces config for that family (S1: config, not code) |
| catch-up brief §4.5 | Phase 4 polish parked; Brimar e2e test; `isShopEngineer` rules | Brimar e2e folds into §6; the gate is verified; polish is last and optional |
| S1–S5 | standing rules | S3: the shop never routes |

---

## 3. The rules you build on — settled

**The spine stamp.** `shop_custom_orders` is the order's spine — its `orderKey / finSiblingId /
quoteId` are what `closeOrderEverywhere`, the orphan audit and RTG's job log walk. The milling
intake **stamps it `In Milling` and never deletes it** (`:367-372`, the 08-26 fix); the milling
doc carries the linkage along (`:358-363`). Keep this exactly.

**§A1 / §5 of the contract** (`workOrderContract`): **START** → `mirrorCustomStatusToSibling(order,
'In Process')` + `releaseSiblingToPickPack(order)` — the *only* thing that opens the WMS pick for a
split order (`:1229-1234`). **COMPLETE** → `mirrorCustomStatusToSibling(order, 'Complete')`
(`:1256`) — the signal the Setup Queue, WMS and Where-is-it all read. Both no-op without
`finSiblingId`.

**Category and route** come from RTG (`pushToShop`, fixed 3f6a953): `orderType 'sales'` →
`CUSTOM_FAB` / "Custom Fabrication"; `'stock'` → `MILLING` / "Stock Milling". The Custom tab
shows the first, the Milling intake the second (`:942`, `:1118`).

**Plating hand-off** (`:1258-1281`): a completed custom part whose recipe is outsourced goes to
the **OB PLATING** bin; one `plating_demand` (`PLD-CUSTOM-<id>`, once — `platingDemandCreated`)
queues it on WMS → Plating for the weekly plater shipment. The label prints either way.

**Holds** (`orderHold`): a held order cannot start or complete (`:1228`, `:1242`). **Urgent**
rides the doc and is acknowledged on the card.

**The outsourced grammar** lives in `Shared/finishRouting` (`isOutsourcedFinishCode`,
`finishSuffixOf`): `EP*`, `MEP*`, `P25`. The shop has **two local regex copies** (`:1245`,
`:1266`); §4 C1 removes them.

**Rod pieces** (`Shared/rodPieces`, offline-tested): `MIN_USABLE_IN`, `MAX_WASTE_IN`, the waste
rule, `planCuts`, `honestAvailability`. The config entry per rod item (piece length, "how it is
stocked", home bin) is declared in HQ 6.5 Tool 2; the `RodCutPanel` on the custom card recommends
the piece, logs the cut (`rodPieceLedger.logCut`), labels the remainder, scraps to NetSuite through
the ledger.

**Phosphate reminder** (`needsPhosphating`, `phosChecks`): advisory checkboxes before Complete —
in-house finish parts are phosphated at the adjacent station. Not a gate; keep it advisory.

---

## 4. The work, in order

### C1 — the plating hand-off says the true state (P0 #3, B5, answer 2)

`handleCompleteWithLabel` (`:1241-1285`), after B's contract lands:

1. `const toPlating = order.isOutsourced || isOutsourcedFinishCode(finishSuffixOf(...))` — **one
   test, Shared**; delete the regex at `:1245` and the second at `:1266` (`finishCode` for the
   demand comes from `finishSuffixOf(order.itemCode || order.partNum)` or the recipe's resolved
   code, not a regex over free text).
2. `await mirrorCustomStatusToSibling(order, toPlating ? 'Sent to Plating' : 'Complete')` — the
   status the shop doc itself gets stays `'Sent to Plating'` / `'Completed'` as today.
3. The `plating_demand` gains what D's receipt needs to close the loop: `finSiblingId`,
   `orderKey`, `salesOrderId`, `shopOrderId`. Same doc shape otherwise — **no reader change** for
   the plating tab. Tell D the field names the day it lands.
4. Messages follow the sibling: the START message to `FINISHING` (`:1235`) is sent only when
   `finSiblingId` exists (an all-plated order has none after B5); the completion message goes to
   `PICK_PACK` as today.

**Downstream trace (rule 4):** *finishing* — no longer told a plated part is complete; for an
all-plated order it is never told anything (correct); *WMS* — the pack gate reads `'Sent to
Plating'` as not-ready (B's `orderStatusOf`), D's receipt flips it; *RTG* — the board chip reads
"At the plater since …"; *NetSuite* — unchanged (the plater PO is A's/D's); *shop* — nothing
visible changes on the card except the chip wording.

### C2 — the milling pipeline tells the record what it made (audit §8 anchors)

Today the last op stamps the spine `Completed` (`:593`) — enough for RTG's gate. Add, in the same
write path:

- `propagateFloorState` (B's `orderLifecycle`) on the **hq work order** behind the spine
  (`sourceCustomOrderId` → its `orderKey`/hq id): `floorPhase:'Complete'`, `millCompletedAt`,
  `millCompletedBy`, `millGoodQty` (the run's good count), `millScrapQty`. RTG's board then shows
  *built 18 / 20* instead of only "gate clear".
- **Hand-off to D:** with `millGoodQty` and `nsWoId` both on the hq doc, the root assembly build
  (`postNsAssemblyBuild` against the WO — today RTG's ⛏, `RTGDispatchTab.js:1862`) can be
  automated at mill-complete, per the note in that code. **You do not post it** — it moves real
  inventory and D owns every NetSuite post. You write the stamps D's trigger will read, and D
  decides the go-live after a live manual post is verified (§8 Q3). B retires ⛏ when D says so.
- A **Failed** last op (`statusType !== 'GOOD'`) stamps `floorPhase:'Failed'` with the reason from
  `shop_failures`, so an order stuck in the shop says why on RTG and Where-is-it.

**Trace:** *RTG* — sees built/scrap counts and failures; *NetSuite* — nothing until D automates;
*WMS/finishing* — nothing.

### C3 — read one shape (B1's `buildShopDoc`)

Once B ships `buildShopDoc`, every `shop_custom_orders` doc has the same fields. Sweep the shop's
readers for fallback chains that exist only because writers disagreed — `partNum || item ||
'CUSTOM'` (`:1268`), `soNumOf`'s chain, `woItemCodeOf` fallbacks — and read the canonical field
first, keeping the chain for docs written before B. Same for the intake form (`millForm`,
`:325-375`): it should pre-fill from the doc, not from three candidates.

### C4 — the Order Entry pair, live (b531f53)

Run it with Stuart pinned in: Order Entry → `HCUMP810` + `/P01` (a Custom line by the suffix
rule) → Generate from Order Entry Needs → the shop card must appear in **Custom Fabrication**
(not Stock Milling — 3f6a953), with `finSiblingId` set, sibling chips live; **START** releases the
finishing sibling's pick; **COMPLETE** mirrors `'Complete'` (in-house paint). The card's cut list is
**empty** — an Order Entry line has no geometry. Ask Stuart what the card should say for that case
(§8 Q1); S1 suggests the answer is a tag on the item (e.g. "pull-and-phosphate, no cut") that the
card reads, not a code branch.

### C5 — the rod at the saw: 20 ft sticks (S1)

Stuart: raw poles like `H1-1R` are made from 20 ft sticks, "where we will set up stock usage on
shop floor." The mechanism exists: the rod pieces config entry (HQ 6.5 Tool 2 — `pieceLengthFt`,
how it is stocked, home bin) + the `RodCutPanel` on the custom card + the ledger. The work is
**configuration and validation, not code**: with Stuart, declare the `H1-1R` family entries
(§8 Q4 — which items, 20 ft, which bin), then run a custom pole order through the card: the panel
recommends the piece by the waste rule, the cut is logged, the remainder labelled, scrap posts to
NetSuite via the ledger (D's outbox — watch 11.1). Any policy change goes into `rodPieces.js`
**with a test**; the module is offline-tested for a reason.

### C6 — the catch-up leftovers

- `isShopEngineer` gate — rules are deployed; verify an engineer role reaches the four engineering
  tabs and an operator does not.
- Brimar e2e — folds into §6 (a CPQ custom order with a bent pole, end to end through the shop).
- Phase 4 polish (card hoisting, `BufferedInput`, style extraction, `alert`→modal, listener
  scoping) — **last, optional, only after everything above is proven**, and only what a commit
  already touches.

### C7 — the shop says why

With B's `'Sent to Plating'` and gate wording in place, verify the custom card's chips (sibling
status, hold, urgent, "at the plater since") and the milling tracker's failure reason read
correctly from the shop tablet. A stuck order on the shop must be explainable from the shop.

### C8 — the guide (S2)

`UserGuideTab.js` has **"At the saw"** (`:234`); add a **Shop Floor** section: the custom card's
lifecycle (Start → checklists → Complete & Label), what "Sent to Plating" means and where the parts
go, the milling intake and why the spine is stamped not deleted, what the tracker's failure reason
tells RTG. Plus the repo guide. Listed in the handoff.

---

## 5. What you do NOT do

- **No routing.** No test in the shop that infers where an order should have gone.
- **No finishing documents, ever.** The shop writes `shop_custom_orders`, `milling`, `schedule`,
  the plating demand, and the rod ledger. Nothing in `fin_workorders` except through B's contract
  calls.
- **No NetSuite posts** except the rod-scrap ledger that already exists. The root build is D's.
- **No local copies** of the outsourced grammar, the pole test, or the item-code resolver.
- **No pole tag.** No plating redesign. No RTG or WMS edits. No fixing in passing.

---

## 6. Acceptance — live runs, Stuart pinned in

| run | expect |
|---|---|
| Custom order, in-house finish, Complete & Label | shop `Completed`; sibling `customFabStatus:'Complete'`; label prints; WMS pack allowed; **no** plating demand |
| Custom order, `/EP3` finish, Complete & Label | shop `Sent to Plating`; sibling `'Sent to Plating'`; ONE `plating_demand` with `finSiblingId`/`orderKey`; OB PLATING message to WMS; **no message to finishing**; pack refused until D's receipt |
| All-plated CPQ order (after B5) | no finishing sibling exists; START sends no FINISHING message; the flow above holds |
| Undo → re-complete a plated order | still one demand (`platingDemandCreated`) |
| Milling: component WO through backlog → tracker → last op GOOD | spine `Completed`; hq WO `floorPhase:'Complete'`, `millGoodQty` stamped; RTG's `awaitingComponents` clears; the parent order releases; RTG board shows built/scrap |
| Milling: last op FAILED | spine unchanged; hq `floorPhase:'Failed'` with the reason; RTG and Where-is-it show it |
| Order Entry `HCUMP810` + `/P01` (the pair) | shop card in **Custom Fabrication**, `finSiblingId` set; START releases the sibling pick; COMPLETE mirrors; the empty-cut-list case reads as Stuart decided (§8 Q1) |
| Custom pole from `H1-1R` (20 ft stick) | RodCutPanel recommends by the waste rule; cut logged; remainder labelled; scrap adjustment reaches 11.1 |
| Brimar custom order with a bent pole, end to end | shop card carries the fab notes (bend/miter/hanger positions); Complete & Label; sibling and pack behave |
| Hold on a custom order | Start and Complete refuse with the reason |
| `isShopEngineer` | engineer sees the four engineering tabs; operator does not |
| `grep -nE "MEP\\\\d\\*\\|EP\\[1-6\\]" src/components/ShopFloor/` | no local outsourced-finish regex remains |

---

## 7. Sequencing and hand-offs

1. **C1 first, the day B's `'Sent to Plating'` lands** (B does that contract change first; you
   are the reason). Until then, plan it and run the §6 in-house rows.
2. C2 any time (it depends on nothing). C3 after B1. C4 now — it needs only what exists. C5 with
   Stuart's list. C6, C7, C8 last.
3. **Hand-offs out:** to **D** — the plating demand's new linkage fields, and the mill-complete
   stamps its build trigger reads; to **B** — retire ⛏ when D's automation is verified; nothing
   to A or E.
4. **Hand-offs in:** from **B** — the `'Sent to Plating'` state, `buildShopDoc`'s shape, the gate
   wording; from **D** — the receipt's mirror to `'Complete'` (you verify it on the card).

---

## 8. Open questions for Stuart (ask before the plan)

1. **The Order Entry custom pole card** (`HCUMP810` + `/P01`) has no cut list. What should the
   shop see and do — "pull from stock, phosphate, hand to finishing"? Tag on the item (S1) or
   text on the card?
2. **The START message to finishing** — keep it only when a finishing sibling exists, or drop the
   message entirely now that the Setup Queue reads the mirrored status?
3. **Automating the root build at mill-complete** — D owns the post; who says go-live, and after
   how many verified manual posts?
4. **The 20 ft stick family** — which items (`H1-1R` and…?), piece length, home bin, "how it is
   stocked" — the config entries you will declare in 6.5 Tool 2.

---

## 9. Handoff

`BRIEF_C_HANDOFF.md`: what shipped (commit, run, proof), the state of C1–C8, what waits on B/D,
anything named and not fixed. Update `SYSTEM_FLOW_AUDIT.md` §7 (shop) and §8 (the anchor row) to
the new state. **The guide (S2):** the sections in C8, listed.
