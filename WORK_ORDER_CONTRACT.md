# Work-Order Contract & SO#/Quote# Shared Key — Implementation Spec

**Purpose:** Reconnect HQ → Finishing → Pick/Pack into one flow by (1) giving every order a single shared identity carried end-to-end, and (2) standardizing the `fin_workorders` document so every app reads and writes the same shape.

**Read first:** `DATA_FLOW_AUDIT.md` and `INTENT_ALIGNMENT.md` (same folder) for the why and the current breakages this fixes.

**Implement in Claude Code.** Test on the `test/floor-login-fix`-style preview branch before merging to `main`. Firestore rules are already strict (auth required) — no rules change is needed for these collections; they're all covered.

---

## 1. The core principle

Today `RTGDispatchTab` creates a finishing work order and a shop custom order as **two unrelated documents**. Nothing links them, so the Setup Queue can't show custom-part status, Pick/Pack's staging scan can't re-pair the halves, and "push to Pick/Pack" has nothing to flag. The fix is one shared identifier plus one agreed document shape.

**Shared key = the NetSuite Sales Order number**, reconciled back to the originating CPQ quote. Both the small-parts (finishing) and custom-parts (shop) work orders carry it, so they are always two halves of the same customer order.

---

## 2. The shared key

Add to **both** `fin_workorders` and `shop_custom_orders`:

| Field | Meaning |
|---|---|
| `orderKey` | The shared identity. `= salesOrderId` once the SO is imported; falls back to `quoteId` for stock/manual orders that have no SO. **This is what staging scans and status mirroring match on.** |
| `quoteId` | The originating CPQ quote/job document id (`jobs/{id}`). |
| `salesOrderId` | NetSuite Sales Order number; `null` until the SO is imported. |
| `estimateId` | NetSuite Estimate id (the existing `netsuiteEstimateId` written by `ERPPushPullTab`). |

Cross-links so each side can find its sibling directly:
- On `fin_workorders`: `shopSiblingId` (id of the `shop_custom_orders` doc, or `null`), `hasCustomSibling: boolean`.
- On `shop_custom_orders`: `finSiblingId` (id of the `fin_workorders` doc, or `null`), `hasSmallSibling: boolean`.

---

## 3. Canonical `fin_workorders` schema (the contract)

Every producer writes this shape; every consumer reads it. `RTGDispatchTab`, the SO-import handler, and `SetupQueue`'s manual create must all conform.

```js
{
  // Identity & shared key
  id, woNum, displayId,
  orderKey, quoteId, salesOrderId, estimateId,
  brand,

  // Customer / private-label
  customerId,            // crm_records id
  customerName,
  clientName,            // display name used on the floor

  // Order content
  orderType,             // 'sales' | 'stock'
  type,                  // product/finish category
  recipe,                // finish recipe code (matches fin_recipes doc id)
  totalParts,
  dimensions: { length, width, height },
  cpqSpecs,              // carried straight from job.cpqData
  imageUrl, note, reqDate,

  // Small-parts pick list (consumed by Pick/Pack)
  partsList: [
    { partId, name, clientSku, qty, binLocation, assetUrl }
  ],

  // Finishing execution (consumed by ActiveFloor) — REQUIRED task shape
  currentPhase,          // 'Setup' | 'Painting' | ...
  stepStatus,            // 'Pending' | 'Running' | 'Staged' | ...
  currentStepIndex,
  tasks: {
    spinSetup: { status: 'Pending', assignedTo: null },
    spinSpray: { status: 'Pending', assignedTo: null },
    spinBake:  { status: 'Pending', assignedTo: null },
    poleSpray: { status: 'Pending', assignedTo: null },
    poleBake:  { status: 'Pending', assignedTo: null },
    hand:      { status: 'Pending', assignedTo: null }
  },
  machineAssigned,       // 'RED' | 'BLUE' | null
  redlineAlert,

  // Pick/Pack flow
  sentToPickPack: false,
  pickStatus: 'Pending', // Pending -> Picked_Awaiting_Staging -> Staged_Ready_For_Finishing

  // Cross-floor status mirror (see §5)
  shopSiblingId, hasCustomSibling,
  customFabStatus: 'Pending', // mirror of sibling shop order: Pending -> In Process -> Complete

  // Audit
  createdAt, updatedAt, createdBy
}
```

**Why this exact `tasks` shape:** `ActiveFloor.js` only renders `spinSetup / spinSpray / spinBake / poleSpray / poleBake / hand` (see `ActiveFloor.js:109-132, 227-285`). The current `RTGDispatchTab.js:268` writes `tasks: { setup }`, which renders no task cards. This is audit finding P0-#7.

---

## 4. Canonical `shop_custom_orders` schema (sibling)

Keep the existing fields `ShopFloor.js` reads (`woNum, item, partNum, qty, cutLength, clientName, isOutsourced, finishRecipe, outsourcePrice, priority, phosphate, completedAt, completedBy, category`) and add:

```js
{
  // ...existing shop fields...
  orderKey, quoteId, salesOrderId,
  finSiblingId, hasSmallSibling,
  status,   // 'Pending' -> 'In Process' (set when operator hits Begin) -> 'Completed'
}
```

---

## 5. Cross-floor status mirror — the custom half (`customFabStatus`)

**As of 2026-09-02 (Brief B5).** The shop's progress on a split order is mirrored onto the
sibling `fin_workorders` doc by ONE helper, `mirrorCustomStatusToSibling(shopOrderOrLink, status)`
in `Shared/workOrderContract.js`. It reads only `finSiblingId` off its first argument (a bare
`{ finSiblingId }` link is enough), refuses and logs an unknown status without writing, and stamps
`customFabAt` beside `customFabStatus` on every write. The states, exported as `CUSTOM_FAB_STATUS`:

| value | set by | meaning | pack? |
|---|---|---|---|
| `'Pending'` | the writer (split / park) | nothing started | no |
| `'In Process'` | Shop **START** (`ShopFloor.js handleStartProcess`) — this also releases the small-parts pick (`releaseSiblingToPickPack`) | fabricating | no |
| `'Sent to Plating'` | Shop **Complete & Label** when the finish is outsourced (`toPlating`) | parts are **out at the plater** | **no** |
| `'Complete'` | Shop Complete & Label (in-house finish); the **WMS plating receipt / build-back** (plated) | parts here and finished | yes |

**`'Sent to Plating'` is a pack-gate state read by the WMS and RTG — never a finishing state.**
An outsourced finish never enters the finishing floor (Stuart, 2026-09-02); the Setup Queue shows
this chip only on a MIXED order whose in-house small parts are on the floor while its custom pole
is away.

**One test for "may this be packed?"**: `customPartsReady(wo)` in `Shared/orderStatus.js` =
`!wo.hasCustomSibling || wo.customFabStatus === 'Complete'`. The WMS pack gate, its pending
window and its pack list all ask this; nothing compares the string itself.

**One wording**: `customFabLabel(wo)` → `'Pending' | 'In Process' | 'At the plater since <date>' |
'Complete'`. `orderStatusOf` reports the custom stream as stage `PLATING` ("At the plater") while
the parts are away; RTG's red-row rule for a receipt with no build-back reads the hq record's
`floorPhase === 'Plating Received'` (D stamps it via `propagateFloorState`, then `'Plated'` at
build-back).

**Why the third state exists (audit P0 #3):** the shop used to mirror `'Complete'` the moment
fabrication finished, before the `toPlating` branch, so a plated order's small parts could be
packed while its poles were at the plater.

<details><summary>Origin (2026-06-10 text, superseded above)</summary>

Requirement: the small-parts job window in the Setup Queue shows the matching custom-parts status (Pending → In Process when the shop operator starts).

**Approach — denormalized mirror (simplest, works with existing `onSnapshot`):**
- When the shop operator hits **Begin** on a `shop_custom_orders` doc (`ShopFloor.js` custom tab), in the same handler also `updateDoc` the sibling `fin_workorders` doc (via `finSiblingId`) setting `customFabStatus: 'In Process'`. On completion set `customFabStatus: 'Complete'`.
- `SetupQueue.js` simply displays `wo.customFabStatus` in each job window. No cross-collection query needed.
- Centralize the dual-write in one helper, e.g. `mirrorCustomStatusToSibling(shopOrder, status)`, so it can't drift.

**Remove the dead banner:** `SetupQueue.js:34` reads `shop_finishing_alerts`, which nothing writes (audit P0-#1). Delete that banner and its query — the `customFabStatus` mirror replaces its intent.

---

</details>

## 5a. The gates — `gatesOf(wo)` (Brief B2)

What parks an `hq_work_orders` record in RTG is ONE ordered list in `Shared/orderStatus.js`:
`soAccept → nsWo → components → convert → rodCut → dispatched`. Exports: `GATES`, `gatesOf(wo)`
(every gate with `key / kind / icon / open / note / help / clearedBy` resolved for this order),
`openGatesOf(wo)`, `isReleasable(wo)` (the one question every auto path asks — false for a missing
record), `gateSummary(wo)` (`"awaiting SO accept · SO-9 · awaiting rod cut"`). The gates are
evaluated here and nowhere else; they are SET by the writers and CLEARED by the WMS, the outbox
writeBack and RTG's component effect (SYSTEM_FLOW_AUDIT §5). A gate added to `GATES` is seen and
worded identically by RTG's two auto effects, the release confirms, the board's gate lines and
AUTO-FLOW chip, Where-Is-It, and A's `clearConvertGate`.

---

## 6. SO-import + auto-split flow (the new feature)

This is the handler that turns a confirmed NetSuite Sales Order into the two linked work orders.

**Trigger:** an action in `RTGDispatchTab` ("Import Confirmed Sales Orders") to start; can graduate to a scheduled Cloud Function later. Uses the existing `netsuiteProxy` Cloud Function for the SuiteQL/REST call.

**Steps:**
1. Query NetSuite for Sales Orders created from our Estimates that are **confirmed** and **not yet imported**. The Estimate→Job link already exists: `ERPPushPullTab.js:176` sets `custbody50 = job.jobId`, so the SO inherits/carries the originating `jobId`. Match on that (or on `estimateId`/`netsuiteEstimateId` stored on `jobs/{id}`).
2. For each new SO: load `jobs/{jobId}`, set `salesOrderId`, `status: 'SO_CONFIRMED'`, `dateImported`.
3. Read `job.cpqData.lines` (the breakdown built at `CPQTab.js:695-708`). **Classify each line** small vs custom (see §7).
4. Build **one** `fin_workorders` doc from the small lines and **one** `shop_custom_orders` doc from the custom lines (omit a side if it has no lines).
5. Set `orderKey = <SO number>` on both; cross-link `finSiblingId`/`shopSiblingId` and the `hasX` booleans.
6. Populate the fin `partsList` from the small lines — resolve `binLocation`, `assetUrl`, and `clientSku` per line from `Approved_Designs.manufacturingSpecs` and the part's `clientPricing` entry for this customer (see §9).
7. Initialize the full `tasks` object and `pickStatus: 'Pending'`, `sentToPickPack: false`, `customFabStatus: 'Pending'`.

**Keep the manual `pushToFinishing` / `pushToShop` buttons** for stock work orders and manual cases — but update them to write the same unified contract and a shared `orderKey` (use `quoteId`/the WO id as the key when there's no SO).

---

## 7. Line classification: small vs custom — ⚠️ CONFIRM IN CODE

The audit could not definitively identify the field the CPQ uses to tag a line as small-part vs custom. **Before implementing §6, open `CPQTab.js` and confirm how lines/steps are marked.** Candidate signals, in likely order:
- An explicit per-step/per-line division flag set in the CPQ flow builder (look for `division`, `route`, `target`, `isCustom`, `small` in the step/flow config and in the `breakdown`/`lines` objects).
- The part's `manufacturingSpecs.partHandling`.
- `routingType` (`MAIN`/custom fab → custom; `STANDARD`/inventory → small) and/or `partClass` (`Inventory` → small; `Assembly`/`Master Assembly` made-to-order → custom).
- `parametric.isCutToSize === true` → custom (made to measure).

Implement as a single pure function `classifyLine(line, part) => 'small' | 'custom'` so the rule lives in one place and is easy to correct once the real flag is confirmed. Default to the explicit flag if present; otherwise fall back to the heuristics above.

---

## 8. Pick/Pack feeding + staging handshake

Fixes audit P0-#3 and #8.

- **Feed the queue:** a "Push to Pick/Pack" action (finishing manager, on the fin WO) sets `sentToPickPack: true`. `PickPackApp.js:123` already filters on this; it just was never set.
- **Pick list:** `partsList[]` is now populated (§6) with real `binLocation` and `assetUrl`, so `PickPackApp.js:249-251,360-362` validate bins and show reference photos instead of `UNASSIGNED`/`#`.
- **Staging handshake on the shared key:** change `PickPackApp.handleStagingMatch` (`:275-285`) to match the scanned shop label against `orderKey` (and/or `salesOrderId`) instead of the current `j.id.includes(scan) || j.soNum.includes(scan)` guess. The shop custom label should encode `orderKey`. On match, set `pickStatus: 'Staged_Ready_For_Finishing'` (already the value used).

---

## 9. Customer / private-label propagation

Fixes audit P1-#5. Carry customer identity from the library all the way to packing.

- The CPQ job already has the customer (`job.customer.{id,name}`).
- For each small-parts line, look up the part's `clientPricing` entry where `customerId === job.customer.id` (`LibraryTab.js:57` shape: `{ customerId, clientSku, price, clientSalesPrice }`) and copy `clientSku` onto the `partsList` entry.
- Set `customerId`, `customerName`, `clientName` on the fin WO (and shop order).
- Pick/Pack and the (future) packing/label step then display the customer's own SKU — required for the private-label business.

---

## 10. File-by-file change plan

| File | Change |
|---|---|
| `src/components/HQ/RTGDispatchTab.js` | Add SO-import + auto-split (§6). Rewrite `pushToFinishing`/`pushToShop` to emit the unified contract (§3/§4) with `orderKey` and cross-links. Replace `tasks:{setup}` with the full `tasks` object. |
| `src/components/HQ/CPQTab.js` | (Read-only confirm) verify/expose the small-vs-custom line flag (§7); add it to `cpqData.lines` if not already present. |
| `src/components/HQ/ERPPushPullTab.js` | Ensure `jobId`/`estimateId` linkage is stored on `jobs/{id}` for the import to match on. |
| `src/components/FinishingFloor/SetupQueue.js` | Remove dead `shop_finishing_alerts` banner. Display `wo.customFabStatus`. Make manual WO create conform to the contract. |
| `src/components/FinishingFloor/ActiveFloor.js` | No shape change needed (already expects spin/pole/hand) — verify it reads cleanly given guaranteed `tasks`. |
| `src/components/FinishingFloor/Modals.js` / `Summary.js` | Align field names QC writes vs Summary reads (audit P1-#9: `completedParts`/`scrapParts` vs `scrapReported`/`completedAt`). |
| `src/components/ShopFloor/ShopFloor.js` | On custom-order **Begin**/complete, mirror status to the sibling fin WO via `finSiblingId` (§5). Write `orderKey` + sibling links on shop orders. Encode `orderKey` in the staging label. |
| `src/components/PickPack/PickPackApp.js` | Match staging on `orderKey` (§8). Consume the populated `partsList`. |

---

## 11. Rollout & safety

- **Backward compatibility:** existing `fin_workorders` won't have the new fields. Consumers already use optional chaining (`wo.tasks?.spinSetup`); keep defaults (`customFabStatus ?? 'Pending'`, `partsList ?? []`). No destructive migration required — new orders flow through the new contract; old ones age out.
- **Branch + preview:** build on a branch, test the full path on the Vercel preview (create a quote → push Estimate → import SO → confirm both WOs appear linked → shop Begin flips Setup Queue status → push to Pick/Pack → pick → staging scan re-pairs).
- **No rules change** needed (all collections already covered by the strict rules), and no App Check change.
- **One commit per section** is a good granularity for review/rollback.

---

## 12. Open questions to resolve in Code (before/while building)

1. **§7 — the small-vs-custom line flag.** Confirm the real field in `CPQTab.js`. Everything in §6 depends on it.
2. **SO query shape.** Confirm the SuiteQL/REST query that returns confirmed SOs with the originating `jobId`/Estimate link (via `custbody50` or a saved search).
3. **Stock WOs into milling.** Audit P1-#9 noted stock replenishment WOs currently route to `shop_custom_orders` as "Custom Fabrication" rather than into `shop_milling` → scheduler. Decide whether the unified contract should route stock WOs to milling instead. (Can be a fast-follow after the SO-split lands.)
4. **Where the SO-import runs.** Start as an `RTGDispatchTab` button; consider moving to a scheduled Cloud Function once stable so SOs import automatically.
