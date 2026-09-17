# Outstanding — 2026-09-17 (one session from here on)

Stuart retired S1–S7 on 2026-09-17: "we will work here and fix what is broken." Every brief carries a RETIRED banner and
stays in the repo as the record. This file is the ONE live list. All seven sessions were idle when retired; none was
mid-turn. Item numbers like #12 are `STATE_OF_THE_APP_2026-09-10.md` §2.

Repo at retirement: main = origin · 56 harnesses green · 6 red, all the same old cause (they import generated
`scripts/*.mjs` copies that do not exist — kitCode, priceLevels, traverse ×4; a harness packaging fault, not product).

## A. FIX FIRST — what Stuart reports broken
*(Stuart names these; nothing below B is touched until A is empty.)*

1. …

## B. Uncommitted / half-landed — decide before anything else
1. **`PickPack/PickPackApp.js`, +26 −3, uncommitted (S3, 09-16).** The vendor-receipt duplicate guard S2 asked for: a cart
   id on the PO, Put Away re-reads the PO and refuses a cart already put away or changed on another tablet, and the
   NetSuite receipt's `dedupeKey` becomes `porcv-<po>-<cartId>` instead of a clock stamp. It closes a real hole opened by
   the 10% over-receipt rule (f0f77ce, live): today a second tablet can receive the same cart twice. NOT linted, NOT
   built, NOT reviewed here. **Decide: finish + ship, or revert the file.**
2. **Functions not deployed (S4, abbe0f3):** `upsRate`, `upsShip`, `upsVoid`. The WMS Fulfilment tab is live in the
   bundle in TEST mode and calls them. Cloud Shell: `firebase deploy --only functions:upsRate,functions:upsShip,functions:upsVoid --project ce-m2c-design-collab`.
3. **What S5's display detour left in the ORDER spine (live, 0690922):** a `cutLength` carry — tab 7 SO line → Order
   Entry Needs → `stockRun` WO + shop sibling → `floorRelease.buildShopDoc` → shop card; plus the cut written into the
   plated-demand note. 14 lines in `QuickShipTab` / `StockViewTab` / `floorRelease` / `stockRun`. Stuart asked to keep
   it ("leave the cut length carry through"). Small and additive, but it was written by S5 in S1's and S2's files and has
   never run on a real order. **Review it once, then keep or pull.** Everything else of the two removed doors (Raise work
   orders, Send to Order Entry) is gone from the code; nothing was ever raised by either.
4. **Left open in CPQ by S5:** an unfinished H1-75 configuration at the projection step, customer FABRICUT selected.
   Never save it. The two display sales orders (tabletop ×50, wall ×35) are still NOT entered.

## C. Shipped but never proven on a live order (acceptance owed)
1. UOM on every floor line and label — "3 PR = 6 pcs" (e5ff62c + e104691). One PR item + one EA item on one order.
2. Backorder hold at the split (0edddb0), honoured on every floor (3658a0d), lifted at receipt (3c2e004). WO-SO60430's
   short line is the named test.
3. Fulfilment `location` per line (39e6387) — the next real multi-location pack must post in 11.1.
4. WMS Fulfilment tab (abbe0f3) — TEST label right way up on 4×6, then LIVE on 9.5; NetSuite package sublist name
   unconfirmed.
5. 10% over-receipt (f0f77ce) — see B1, the duplicate hole beside it.
6. Species item on the BOM (6fa627c) — Stuart's next wood order. NetSuite for SO60429 is Stuart's by hand.
7. Cart staleness / engine stamp + Approve pre-check (f56bb7d). Rule: any edit to the five engine files →
   `node scripts/stamp-engine-version.mjs` and commit `Shared/engineVersion.js` in the same commit.
8. Bulk-reopen chip, shop Undo refusal, JFP dedupe, REPACK, custom plating put-away, "Where is it?" open-only,
   Complete Packing says why, one shop label per cut length, hand bench by coat — all live, none operator-confirmed.

## D. Known defects, never built
1. **Unresolved-BOM refusal (WO11588 class)** — `finishedGoodsRun.pinErpOf` still returns a NetSuite INTERNAL ID as a
   pull code on a miss. Spec: BRIEF_S2 close-out item 6.
2. **S3 close-out list, untouched:** #16 re-make retire · #32 outsourced group in Setup Queue · #12 rod-cut completion
   → `releaseStockWoToFloor` · #33 build-back onto the outbox · #19 empty state · #40 receipt field names ·
   #34 #36 #42 #43.
3. **Order Entry cannot make a custom plated per-foot pole** — it has no shop cut WO route; only CPQ → RTG split does
   (S5's finding 09-17, S2 brief 1bf6e2c). The reason the displays must go in through CPQ.
4. **S2:** #31 legacy enrich branch delete (was due 09-16, on Stuart's word) · §4 acceptance rows.
5. **Portal (S4):** #20 `portalMyOrders` date · #21 needBy/notes + `!deleted` · S1's four engine mirror lines
   (step order, ridesWith, HIDDEN- skip, backplate follows arm) — the portal configurator is behind CPQ until mirrored.
6. **App Imp:** Sandra's five cards need the pasted notes (given 09-15); 36 cards await ✓ Tested by their reporters.

## E. Can wait — new function, not repair
- S1: Vision Phase 3 generator + #47 watched Approve · screen proofs · E3 class map (Eric) · non-CE brands refuse the
  NetSuite header until Eric's form ids land.
- S5: the whole display program (designer, builds, seed, CPQ Display mode, entry sheet, SO link). Live, isolated in
  `DisplayDesignerTab` / `DisplayBuildsPanel` / `Shared/displayBom` + one guarded block in the CPQ 3D pane. Not on the
  spine except B3. H1-138TRV kit end-to-end · F9 guide · lump-sum SO (Eric). **Parked.**
- S6: spec sheets — never started. S7: Uniquity pillows — price rule live and imported by nothing; **parked.**
- S3: ring PAIRS (Eric's NetSuite pair ids) · pick-in-progress polish. S4: per-brand UPS accounts · address validation
  · payments (nothing built).

## Rules that stay
CLAUDE.md working agreement (plan first and wait · requested scope only · no temporary fixes · trace downstream, RTG is
the spine). One issue at a time. Save-is-send refuses on a stale bundle: every push = hard-refresh + re-PIN; never push
while Stuart is mid-order. Functions deploy from Cloud Shell only. Deploy-verify by sweeping `asset-manifest.json`.
