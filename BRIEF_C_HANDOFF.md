# Brief C handoff — Shop Floor

*Brief C session, 2026-09-02. Brief: `BRIEF_C_SHOP_FLOOR.md`. Working agreement and standing
rules S1–S5 bind the next session exactly as they bound this one. Line numbers in the brief are
stale — locate by symbol.*

## 1. Shipped

| commit | what | proof |
|---|---|---|
| `334c9c3` | **C2** — the milling tracker's finalize stamps the `hq_work_orders` doc behind the spine: last op GOOD → `floorPhase 'Complete'`, `floorCompletedAt/By`, `millGoodQty`, `millScrapQty`, `millCompletedAt/By`; any FAILED op → `floorPhase 'Failed'`, `floorUpdatedAt`, `millFailReason` (QC reason — notes), `millFailedOp`, `millFailedAt/By`. A **zero-good** op takes the Failed stamp and the spine is **no longer marked Completed** (before, a zero-good last op cleared RTG's component gate and released a parent with no components). | live bundle grep `mill record stamp` = 1 (`main.9731bab9.js`) |
| `42aa3a7` | **§8 Q1 read side** — the Custom card shows a **Shop Instruction** panel when the order has no cut list, read live from `Approved_Designs.manufacturingSpecs.shopInstruction` (doc's own `shopInstruction` first, then exact code, then mill base). **§8 Q2** — the "Custom Fab Started" message to FINISHING is sent only when `finSiblingId` exists (both Start paths). | live bundle grep `Shop Instruction` = 1 |

**How the hq record is found (C2):** `hqWorkOrderIdOf` in `ShopFloor/shopShared.js` — the spine doc id minus `SHOP-`, which is `pushToShop`'s own naming and what RTG's component gate reads back. Not B's `propagateFloorState`: every stock writer sets `hqJobId` = the **library part's** id, `pushToShop` copies that into the spine's `orderKey`/`quoteId`, so `identityKeysOf(spine)` never holds the hq work order id and the resolver returns null for every stock milling job. Named to B (B7 item, accepted); when B's resolver learns the `SHOP-` key, C2 switches to `propagateFloorState` and the direct write retires.

**Note for the brief:** ShopFloor is compiled into `main.*.js`, not a lazy chunk. Marker-grep main.

## 2. Stuart's decisions this session (relayed through the integration session — he said relayed approvals count)

- **Q1** — the shop instruction lives **on the item** (Library card + 4.5 Mass Update); the card shows it when there is no cut list. Field: `manufacturingSpecs.shopInstruction`, plain string. **Editors shipped by A as `4ae891e`** (Library card text box under Manufacturing Specs + a 4.5 Mass Update "Overwrite Shop Instruction" panel). The strings still have to be typed on the items (Stuart/Eric) — until then the card is silent for a no-cut-list order.
- **Q2** — START message only when a finishing sibling exists. Shipped.
- **Q3** (root-build N) and **Q4** (20 ft stick family) — he could not answer from the batch. One-liners with defaults sent: "N = 3 unless you say otherwise"; "H1-1R only, 20 ft, offcuts kept, home bin = library bin — confirm or list others". **Unanswered at handoff.**
- **C2** approved as put; fold-in (b) zero-good = Failed included; fold-in (a) custom-card COMPLETE stamping `floorPhase` **declined by me** — from a custom-fab spine the resolver lands on the finishing half's record or the sales order, so the stamp would lie. The honest fix is on the WMS pre-pack confirm (D's screen) reading `customFabStatus`; spec not yet written.
- **C4** — after this round; Stuart pins in.

## 3. State of C1–C8

| item | state |
|---|---|
| C1 plating hand-off | **Planned, waiting on B's hash.** B's proposed contract: `CUSTOM_FAB_STATUS {PENDING, IN_PROCESS, SENT_TO_PLATING:'Sent to Plating', COMPLETE}`, mirror keeps its signature, refuses unknown, stamps `customFabAt`. My change: `toPlating = order.isOutsourced === true || isOutsourcedFinishCode(finishSuffixOf(shopItemCodeOf(order)))` (both local regexes deleted), `mirrorCustomStatusToSibling(order, toPlating ? 'Sent to Plating' : 'Complete')`, demand gains `finSiblingId / orderKey / salesOrderId / shopOrderId` (D has these names as its contract). Chip wording from B: "At the plater since <date>" (`customFabAt`). |
| C2 | shipped `334c9c3` |
| C3 one shape | waits on B1 `buildShopDoc` |
| C4 OE pair live | waits on Stuart's pin-in; run script in the brief §4 C4 + §6 |
| C5 20 ft sticks | waits on Q4 |
| C6 leftovers | not started (`isShopEngineer` verify, Brimar e2e, polish) |
| C7 the shop says why | after C1 |
| C8 guide | Shop Floor section — see §5 |

## 4. Named, not fixed

- `Shared/orderLifecycle` cannot find a milling spine's hq parent (above) — B's.
- WMS pre-pack confirm lists an Order Entry custom half (`<woId>-C`) as "still in production" forever, since nothing stamps `floorPhase` on it — D's screen; needs a spec.
- `millScrapQty` is the finalizing shift's scrap only; earlier shifts log good counts only (`partialGoodQty`).
- A manual milling intake with no RTG source (`sourceCustomOrderId` null, or a spine not named `SHOP-…`) stamps nothing — by design; D3 never fires on it.

## 5. Guide (S2)

In-app: `UserGuideTab.js` — **Shop Floor section added** (`ShopFloorGuide`: the one-minute idea, the custom card lifecycle incl. the Shop Instruction and Send to Plating, milling intake → tracker → what RTG sees, edges). The plating paragraph says honestly that the "at the plater" status is still landing with B — **rewrite that paragraph when C1 ships.** No repo-side guide doc exists for the app guide today; the in-app tab is the only copy (all four sections were written straight into the JSX).

## 6. Session map (2026-09-02 only)

A = ce-m2c-design-app-29 · B = -4a · D = -85 · integration = -89 · C (this) = -b5.

## 7. 2026-09-03 — the SO60147 cut-sheet incident (live, Stuart pinned in)

**Symptom.** Stuart: "new Brimar work orders no longer have the shop drawings, O2O and C2C."
**Read on the floor.** Eight Brimar orders in process (SO60147/51/52/58/66/68/69/70, all
HBR1-1INPOLE); seven carry full cut sheets. **Only SO60147** (quote 25234, job
`QUOTE-1788187683465`, created 08-31 10:48) is bare: `fabNotes` present with every field null,
viewer says "No engineering specs recorded", yet the 3D render shows the bend and a bracket note
exists → the Vision draft was loaded but `draft.specs.engineeringNotes` was empty (E's trace).
Not a code regression: RTG's split unchanged since 09-01; E/A/D proved by diff nothing touched
the job's notes. Stuart: **leave SO60147 as is; fix for the future.**

**Shipped:** `4f17eb7` — the card says "NO CUT SHEET FROM VISION" (active card + staged row);
**narrowed the same evening** on Stuart's ruling ("fabricut cost no need for vision as it is
straight cuts"): fires only when the doc carries Vision evidence (`bracketNotes` / `visionNotes` /
`fabNotes.hangerLocations`) AND every engineered field is empty. A straight cut-to-length pole
with no Vision renders as ordinary work; orders with no `fabNotes` at all (Order Entry /
pushToShop) untouched. `cutSheetMissing` in ShopFloor.js.
**Correction to the SO60147 reading:** the viewer's "Splice 1 · 48\"" is CPQ's auto-centred splice
(half of 96"), not a Vision placement, and the shop doc has no Vision notes — so SO60147 was most
likely a **bent pole configured in CPQ with no Vision draft at all**. That case is E's guard
(bend/return/splice in the configuration + no Vision O2O → stop at add-to-cart / finalize); the
shop does not infer it from item codes.
**Handed off:** E — refuse a Vision pole line with no O2O at add-to-cart / finalize (source
prevention); **also from Stuart, via me:** Reopen-in-Vision does nothing ("nothing pushes, loses
its link?"), and the sales forms have regressed to GLB node names instead of descriptions +
customer part #s. B — split-time warn + `cutSheetMissing` stamp (spec at the end of BRIEF_B).
**Note:** "shop drawings" on the card = the 📄 Drawing / 📋 SOP buttons, shown only when the
library item carries `staticShopDrawing` / SOP pages; none of the HBR1-1INPOLE cards show one.
Multi-config cards show the FIRST configuration's cut sheet only (`mergedNotesObj` = first item);
the other configurations are reachable via their row's 🔍 View Item. Stuart did not ask for that
to change.
