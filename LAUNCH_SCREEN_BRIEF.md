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

## Phase 2 — NEXT (needs the clearances below): the warehouse honours a held line
1. Shared/pickLines.pickableLinesOf: a SHELF line that is HELD is not picked until released; a `heldLinesOf(doc)` beside
   it, and orderStatus.nothingToPick / setupWaitsOnShop and PickPackApp's noPickNeeded require held === 0 — a held
   line must never read as "nothing to pick" (App Improvement session, 2026-10-20, trap 1). The launch map lives on
   hq_sales_orders; a sewing document never carries shelf lines, so a fin doc never reads it.
2. The fulfilment is whole-order today (Shared/fulfilmentQueue.queueSoFulfilment takes the SO's open lines): packing
   the released throws would fulfil the held pillows too. Partial release needs the fulfilment scoped to the PACKED
   lines, the order left open for the second one, and SO Pack's orderPackBlockerOf / packReadinessOf not waiting on
   held lines (trap 2). Shared/fulfilment.js + fulfilmentPanel.js are the Payments session's; pack & ship, SO Pack and
   the terms gate were built by the App Improvement session, which offers to take that contract.
3. The ship-clearance gate is per ORDER: a pay-first order (Uniquity's Pay Before Shipping) holds at ✓ Packed until paid
   IN FULL, whatever is released. Whether a partial shipment of a pay-first order may go on a part payment is Stuart's
   call (trap 3). Invoices bill what shipped (packingList.invoiceLinesOf) — check the first-shipment invoice.

## Phase 3 — the Uniquity pick / pack / fulfilment walk-through
After phase 2: one real mixed order (throw + pillow) run through Launch → ship ahead → pick → pack → fulfilment #1 →
sewing → second pick → fulfilment #2, watched on 11.1 and in NetSuite.

## Open decisions (Stuart)
- Who builds the pack / fulfilment side of phase 2: S7 with the Payments + App Improvement clearances, or the App
  Improvement session (it built pack & ship, SO Pack, the terms gate).
- A pay-first order shipped in two parts: ship the first part on a part payment, or hold both until paid in full.
- CPQ orders on Launch (partsList, not lines[]) — phase 4 if wanted; today Launch lists Order Entry / counter orders.
