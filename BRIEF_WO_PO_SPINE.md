# WORK ORDERS & PURCHASE ORDERS — the spine as it now stands

*Brief A, 2026-09-04 → 09-09. Written for anyone picking this up cold: what the rules ARE, where
they live, and what has and has not been proven on a real order.*

---

## 0 · The five rules everything else follows from

1. **Every order lands in RTG.** Auto-send onward is fine; no floor tab may show an order RTG
   never saw.
2. **One writer per document.** Ten screens used to write `hq_work_orders` their own way. They now
   call `Shared/workOrderCreate.parkWorkOrder`, and the floor document is built by
   `Shared/floorRelease.buildFinDoc`. A second copy is how they drift.
3. **A decision and a silence are different things.** Passing `null` ("I checked, no cut") must
   never be spelled the same as passing nothing ("I did not ask"). Every gate, every route, every
   chooser respects this — most of the day's defects were one collapsed into the other.
4. **The recoverable answer is the default.** An unwanted work order parks in RTG for review; an
   unwanted PO is money. Every ask opens on the work order.
5. **A gate must be liftable.** Anything that parks an order declares what would clear it, and the
   audit checks that thing still exists.

---

## 1 · The modules, and what each owns

| Module | Owns |
|---|---|
| `Shared/workOrderCreate` | `parkWorkOrder` — the ONE stock/finishing work-order writer; `receiptGateFields` / `clearReceiptGate` / `cancelReceiptGate` |
| `Shared/floorRelease` | `buildFinDoc` — the floor document, built once for every release path (B's) |
| `Shared/repaintRun` | `releaseRunToFloor`, `raisePaintRun` — JFP and Repaint, one writer, both doors |
| `Shared/repaintSource` | which colours qualify for a repaint, and the stock refusal |
| `Shared/purchaseOrders` | the PO lifecycle: create → **accumulate** → approve → send → ack → receive; `addToOpenPurchaseOrder`, `discardDraftPurchaseOrder`, `fetchOpenPoLines` |
| `Shared/poLock` | the PO vocabulary + **the finality rule** (pure, so it is testable) |
| `Shared/sourcing` | `orderRouteFor` — make / buy / ask, one answer for every view |
| `Shared/poleCut` | what the saw can do, and which sticks yield a length |
| `Shared/backorderBoard` | the True Backorders board's rows, cover and state |
| `Shared/orderStatus` | the GATES, `isReleasable`, `strandedGatesOf`, `liftPatchFor` (B's) |
| `Shared/orderLifecycle` | the ONE closer, the deletion ledger, `auditOrphans` |

---

## 2 · Settled rules — do not re-derive these

**A pole is CUT or WAITED FOR, never milled.** Short of a stocked length, the operator decides:
cut a longer stick down (**only the shortfall** is cut) or wait. Enough on the shelf → straight to
the pick, no cut. Both doors — Order Entry and the Sales Snapshot — ask the same question with the
same panel, which shows **what is already on order, with the PO number and due date**, because a
quantity alone cannot answer "should I wait?".

**A wood rod is routed by its CUT, not its tag.** `material` = WOOD on a pole + no miters/bends/
splices → finishing; any fab work → shop. The rods are correctly tagged Custom (they *can* be
mitered) — retagging them Small Parts breaks the miter half. The rule is dormant until the caller
passes the cut facts, so silence cannot route a mitered pole to the paint line.

**IN-HOUSE means made.** A vendor on the record says who *could* supply it. "We make it and we buy
it" is **BOTH**, and BOTH is the only way to say it.

**A purchase order is FINAL once it has left us** — the first of: queued/pushed to NetSuite, has a
number, sent, acknowledged. Lines only; receiving and acknowledgement still work. Anything further
is a new PO: *"the vendor needs to see a new document, not a quietly different one."*

**POs accumulate while DRAFT**, so a vendor minimum is reachable. The brief said accumulate onto
`Approved`; that predates the ten-status lifecycle, and Approve is now the act that mints the
NetSuite number — appending after it would silently amend a document that exists over there.

**A repaint beats teaching the app a BOM.** Pull another colour, paint it, adjust one down and the
other up. Offered whatever the sourcing tag says.

---

## 3 · The gates, and what lifts each

| Gate | Set by | Lifted by |
|---|---|---|
| `awaitingSoAccept` | the SO not yet accepted | NetSuite accepting it |
| `awaitingNsWo` | Route A | the outbox writeBack |
| `awaitingReceipt` | Order Entry raising a PO for a line's material | **enough received** at WMS → RECEIVING (PO), or `cancelReceiptGate` by hand |
| `awaitingComponents` | a component shop WO still milling | the shop completing |
| `awaitingConvert` | a /P core short | the WMS Convert tab |
| `awaitingRodCut` | a 4/6 ft pole short of its length | the saw, or cancelling the cut (which now lifts it) |

Every one declares its clearer in `orderStatus.GATES`, and `auditOrphans` reports a
**`STRANDED_GATE`** when that clearer no longer exists. A gate whose pool the audit was not handed
is **skipped, never guessed at**.

---

## 4 · What was wrong, and is not any more

- The Sales Snapshot **rebuilt 12 months of sales on every open** — the cache was working and had
  never once been read, because the button passed its click event as `forceRebuild`.
- Chunk sizes **sized for a 12-month fetch** stayed after the cache made it a one-month fetch —
  ~90 sequential NetSuite calls where ~20 would do.
- A **pole cut was raised regardless of stock** — 20 × 6 ft ordered with 6 ft rods on the shelf.
- The **pole panel never rendered at all** at the Snapshot door: the decisions were filed by item
  code and looked up by a field that did not exist on those rows (`erpId`, undefined since the gate
  shipped). A silent default then answered the question in the operator's absence.
- A short pole **parked on a receipt gate with no PO behind it** — invisible even to the
  stranded-gate audit, which reads a ref with no `poId` as "any receipt clears it".
- **RTG's Delete did not cancel the rod cut** (Close did — Delete re-implemented the closer inline).
- **Cancelling a rod cut did not lift its gate.**
- **A queued NetSuite write survived its order's deletion.**
- **Straight wood rods went to the shop** with the mitered ones.
- **An in-house item with a vendor opened pre-selected to PO.**
- A **bought shortage was one line in a log** — the run was created, nothing was ordered, and the
  pick failed weeks later.
- A **draft PO could not be discarded**, and since drafts accumulate, a stale one was a live target.

---

## 5 · Proven on a real order

- **♻ Repaint from the Master Library** — Stuart, 2026-09-08: *"tested and worked great."*
- The rod-cut builder (a Snapshot cut for HCUAR815/AC → HCUAR615/AC reached the WMS correctly; the
  "missing" cut was a brand-selector difference, not a defect).

## 6 · NOT proven — everything else from 8–9 Sep

The receiving tab and the material gate · the pole panel · Stock Build Needs (**the only new button
with a NetSuite write behind it**) · the Backorders board and the BO column · the repaint from the
**Snapshot** row · the draft-PO discard · the in-house routing fix.

**The repaint from both doors is the one to run first**, because that writer moved between files
after the Master Library tool was tested.

---

## 7 · Open, and whose

| Item | Owner |
|---|---|
| Hoist `engineeringNotes` above the split so the wood rule fires | **B** |
| Guard the RTG PO line editor with `poLinesLocked` — an approved, sent, acknowledged PO can still be edited today | **B** |
| Tag the wood rods (`material` = WOOD) · fix HCUMSBF15's in-house tag · clear `WO-HCUMSBF15-N25-655308-4` · the two 14-Aug sales orders | **Stuart** |
| Per-brand class + form map (E3) | **Eric** |
| H1-2TRV data pass | **the designer** |

The `NS_POSTED_AFTER_CLOSE` audit reads only the 12 most recent outbox entries — a best-effort
finding, and the panel should say so.
