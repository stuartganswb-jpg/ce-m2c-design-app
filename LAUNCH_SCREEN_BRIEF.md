# 12.7 LAUNCH — the day's orders, decided line by line (S7, 2026-10-20)

Stuart 2026-10-20: "RTG is really now more of a snapshot of all details happening everywhere and we need a more
focused screen for all the brands that just address launching the orders … list the daily orders and click each one
open it and look at it and decide what to do, release partial lines … orders that are entirely in stock can go
straight to auto release just like Classical. only difference the throws for uniquity never hit the floor they can go
straight to be picked, packed, shipped as long as they are paid. the orders that have some pillows with throws we need
to look at to decide whether to ship the throws ahead or wait for the pillows … we could use this screen even for
Classical when we want to release partial orders as well … once we get this we need to look at the pick/pack/fulfilment
for uniquity." Decisions: **own tab 12.7 · HOLD as the default for a mixed order · build the warehouse side here with
the WMS session's clearance · a second shipment / fulfilment per order is fine and how it is done now.**

## The rule (Shared/launchBoard, pure, harness 13)
Every line of a stocked order is one KIND — SHELF · SEW · FINISH · FLOOR · PLACEHOLDER · FEE — and every SHELF line one
STATE — AUTO (no decision needed) · HELD · RELEASED. A MIXED order = a SEW line beside a SHELF line; its shelf lines are
HELD by default until the office decides (Ship ahead = every shelf line RELEASED; Hold = HELD until the made lines are
ready). An order with FINISH + SHELF but no SEW line is NOT held by default — Classical keeps picking stock while the
floor works, exactly as today; a Classical partial is a hand HOLD on a line here. The decision lives on the record:
`hq_sales_orders.launch = { mode: HOLD | SHIP_AHEAD | PARTIAL, lines: { [idx]: { state, by, at, note } }, decidedAt, decidedBy }`.
No marker = today's behaviour for every order with no SEW line. `lineIsLaunchHeld(so, line, idx)` is the pick side's
one question.

## Phase 1 — LIVE (this push): the board and the decisions
HQ tab **12.7 Launch** (HQ/LaunchTab): the brand's stocked orders (Order Entry + the counter), 7 / 14 / 30 days / all
open, newest first, each with its kinds counted, a suggestion (AUTO · DECIDE · START · HELD · IDENTIFY · WAIT_NS), the
backorders; open one → the terms and what is paid (Shared/shipClearance, the same read the ✓ Packed gate uses), every
line with its kind, state and whether a made line is STARTED (RTG's oeCoverageOf over the order's hq_work_orders),
per-line Release / Hold, **Ship the shelf lines ahead** / **Hold until the pillows are sewn**, **Start the made lines →
review** (hands the order to 12.5 Order Entry Needs as RTG's card does). Nothing in the warehouse moves yet.

## Phase 2 — LIVE (2026-10-20, built here with the App Improvement session's clearance): the warehouse honours a held line
Stuart: "build it here with clearance, pay first order, as long as the remaining funds from deposit are over 50% the
amount of the balance order it is fine to ship first part."
1. **A HELD line is out of the warehouse's hands until released** — through the one reader every WMS screen already asks
   (Shared/pickLines): `pickableLinesOf` leaves it out, `soCodeNeedOf` does not need it in the bin (so the gather stage
   offers no ⤓ pick for it, the "to-be-finished not gathered" warning does not count it), `soLineReleasedOf` reads it as
   not in motion, `packLinesOf` keeps it off the bench. `heldLinesOf(so)` names them; `orderStatus.nothingToPick` and
   PickPackApp's `noPickNeeded` require held === 0 (trap 1 closed in the same change); the gather stage never reads
   SHIPPED while a line is held (`held: [codes]` on the result). The WMS line shows "⏸ HELD on 12.7 Launch".
2. **A decided order packs what is in its bin** — `Shared/launchBoard.shipmentPlanOf(so)`: pack (in the bin) · held ·
   waiting (not in the bin yet — a pillow still at Stitch & Sew, a released line not picked yet) · shipped (gone in an
   earlier shipment, by `shippedQty` in line order). No decision (`launch` absent) = no plan: the order packs whole as it
   always has. `packLinesOf` follows the plan.
3. **A pack that leaves something behind is a SHIPMENT of its own** — `launchShipmentOf`: a child record on the
   sales-order route (`QS-SHP-<SO>-01`, orderClass QUICKSHIP, `packMode: 'SHIPMENT'`, `shipmentOf`, `shipmentNo`), born
   PACKED with the plan's lines, this pack's boxes and photos, pointing at the SAME NetSuite sales order under ITS OWN
   field (`shipmentOfNsId`, read by `nsSoIdOfRecord` — never `nsInternalId`: the Payments callable finds an order by that
   field with limit(1), and a child there would hide the parent's card money — App Improvement 2026-10-20), `fulfilFromBin` = the parent's bin — the display shipment's model (Shared/displayShipment) less the
   $0 order. The parent gives up the pieces (committedQty −, shippedQty +, nsBinQty − when counted), records
   `shipments.<n>` (a map, so the outbox can stamp into one), clears its ticks and photos and goes back to Pending for
   the rest. The child ships from the Fulfilment tab like any packed order (packing list, label, invoice = its lines).
   The parent's LAST pack (nothing held, nothing waiting) is the ordinary ✓ Packed — its whole-order fulfilment takes
   exactly what is still open in NetSuite.
4. **The shipment's fulfilment is scoped to its lines** — PickPackApp `queueShipmentFulfilment`: the SO's open lines
   (Shared/fulfilmentLines) narrowed by `shipmentFulfilItemsOf` to the child's codes at the child's quantity (never more
   than open), from the parent's bin; dedupeKey `if:<nsSoId>:s<n>`; write-back `nsIfId` / `nsIfTran` on the child.
   Never `queueSoFulfilment` (every open line). The parent card lists its shipments with their state (queued · IF # ·
   shipped · ⏸ waiting for payment with Check again / Release · ⚠ not queued with Send).
5. **The part-payment rule** — `Shared/shipClearance.partialShipClearanceOf(facts, { shippingNow })`, read by the same
   gate (`gateShipment` / `fetchShipClearance` take `shippingNow` = the child's `shipmentAmount`, the lines' totals
   before any order discount — the stricter side): a pay-first order ships a part when **paid ≥ shippingNow AND
   paid − shippingNow > ½ × (total − shippingNow)**. Credit terms ship as always; paid in full is clear; a part worth
   the whole order is the ordinary rule. Harness rows pin it (scripts/shipClearance.test.mjs).
6. Not touched: Shared/fulfilmentQueue, fulfilment.js, fulfilmentPanel.js (Payments' — the panel's send reads
   `nsInternalId`, which a child does not carry, so it never sends a whole-order fulfilment for one; a `packMode !==
   'SHIPMENT'` guard in `needsNsFulfilment` is still welcome as the belt); SO Pack's `orderPackBlockerOf` (CPQ documents — CPQ orders are not on Launch).
   Named, not fixed: the WMS does not read a making line's `noPack` (a pillow's fabric line sits on the pick / pack
   bench of an undecided order today; a decided order's plan leaves it off).

## Phase 3 — the Uniquity pick channel (2026-10-20): /uniquity-pickpack
Stuart, before the first Ship ahead was pressed: "we need a separate pick/pack for uniquity, it is a totally different
team that pulls and ships these from the classical team. it is simple as we just need a pick channel for these orders
above that are clicked ok to ship, it appears in order for them, by order/customer and they click the block need to
mark each one packed and eventually marked each one shipped." Decisions: **own page (/uniquity-pickpack, the counter's
PIN, hub tile 06.5) · UPS exactly as Classical with a different UPS account per brand (Payments' per-brand accounts on
the 9.5 UPS page — asked) · a pillow is in hand once Stitch & Sew says Complete · keep every step clean and simple.**

- Rules: `Shared/uniquityPickPack` (pure, harness 12). One block per Uniquity stocked order, oldest first: **TO PACK**
  when every OK-to-ship line is in hand (shelf lines not held on 12.7; pillows whose sewing document — fin_workorders
  division SEW, `soLineIdxs` — is Complete); **WAITING** with the reason (at Stitch & Sew · held on 12.7 · waiting for
  12.7 to decide a mixed order · a quick-add to identify · NetSuite not yet accepted); **SHIP** once packed (the panel's
  side). No order bin, no bin scans, no photos: "in hand" is the block's word; the fulfilment takes from the item's bin.
- The PACKED press: a whole order writes the WMS's own packed stamp (`channelPackedPatchOf` — status Picked, packStatus
  Packed, every line ticked, `packedFrom: 'UNIQ_PICKPACK'`) then the terms gate and the ONE fulfilment queue
  (Shared/fulfilmentQueue.queueSoFulfilment, bins asked when NetSuite holds an item in several). A partial (released
  lines while pillows are still sewn, or a line held by hand) is the SAME shipment child the WMS makes —
  `Shared/launchShipment` (writeShipment · queueShipmentFulfilment · gateShipmentWith), lifted out of PickPackApp so
  both screens run one code path.
- The SHIP side mounts the Payments session's FulfilmentPanel with brand uniquity (UPS rate, label, tracking, void,
  NetSuite shipped) over the packed Uniquity orders and shipment children; a held one shows Check again / Release
  (manager) above it, with the WMS's stamps.
- Named: the per-brand UPS account is Payments' (asked 2026-10-20); until it lands the page ships on today's account.
  The live walk-through (a real mixed order through 12.7 → this page → shipment 1 → sewing → the last pack) is still to
  run; nothing has moved live yet.

## A refused order (2026-10-20, Stuart's rule via the App Improvement session: "hold at shipping")
An order NetSuite refused (Shared/nsRefusal.soRefusalOf — the outbox marks `nsRefused.salesorder`, cleared when it posts)
is launched, picked, packed and made as usual, and held at shipping by Shared/shipClearance's NO_SO rule until NetSuite
accepts it: 12.7 lists it with "NetSuite refused" and the reason beside it and lets the office decide it; the Uniquity
channel lists it TO PACK with the same note; PACKED stamps it and the fulfilment holds as "Waiting for NetSuite" (Check
again only — no Release, nothing can post without the order); a shipment child made before acceptance learns the
NetSuite id from its parent at Check again (nsSoIdOfRecord(child, parent)). An order merely in flight to NetSuite still
waits. The "NetSuite: n to fix" chip (Shared/NsFixPanel) is on the Uniquity page header.

## Open decisions (Stuart)
- (decided 2026-10-20) S7 built phase 2 with the App Improvement clearance; the part-payment rule is the 50% rule above —
  confirm the reading: "remaining funds from deposit" = paid − the part shipping now; "the balance order" = total − that part.
- A shipment child (QS-SHP-<SO>-nn) is a QUICKSHIP record on hq_sales_orders, so RTG lists it as a stocked order of its
  own ("Shipment n of SO…"). App Improvement (2026-10-20): RTG is the spine — do not hide it; show it under its parent or
  fold it into the parent's card. RTGDispatchTab is the RTG session's; Stuart decides, that session applies.
- CPQ orders on Launch (partsList, not lines[]) — phase 4 if wanted; today Launch lists Order Entry / counter orders.
