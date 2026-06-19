---
name: work-order-contract-impl
description: "Status of the Work-Order Contract / shared-orderKey implementation (branch, what's done, what's left)"
metadata: 
  node_type: memory
  type: project
  originSessionId: 030aee85-078f-43db-b9dd-2f6e27fc2944
---

Implementing WORK_ORDER_CONTRACT.md (reconnect HQ → Finishing → Pick/Pack via a shared `orderKey` + one canonical fin_workorders shape). **MERGED TO `main` / PRODUCTION on 2026-06-11 via PR #1** (branch `feat/work-order-contract`, now merged). Team is reviewing in prod. Future work continues from `main` on a new branch.

Done (all on branch, builds clean, NOT yet tested on preview or merged):
- §7 (a4fcbb5): CPQ lines carry `partHandling`/`partId`/`cutLength`/`dimensions`. Pure `classifyLine` in `Shared/lineClassification.js`. AdminTab `handleAutoSyncBOM` defaults step.partHandling from the linked part. See [[cpq-line-division-flow]].
- §6 (a333ab1): `autoSplitSalesOrder` in RTGDispatchTab — confirmed SO → one fin_workorders + one shop_custom_orders, shared orderKey, cross-linked, full tasks, partsList (bin/clientSku/assetUrl), customFabStatus/pickStatus/sentToPickPack. Manual pushToFinishing/pushToShop rewritten to same contract. (§9 customer propagation folded in here.)
- §5 + §8 (f914910): `Shared/workOrderContract.js` (makeFullTasks, mirrorCustomStatusToSibling, stagingScanMatches). SetupQueue: dead shop_finishing_alerts banner removed, shows wo.customFabStatus, manual create conforms. ShopFloor: Start/Complete mirror to sibling, orderKey in Zebra label. PickPack: staging match on orderKey.
- §10 (ca3ed73): Modals writes scrapReported (was scrapParts); Summary branches on orderType.

§3 ERPPushPullTab linkage needs no change (already writes custbody50=jobId + netsuiteEstimateId).

- §12.3 (cc97d69): stock WOs (orderType 'stock') now get category 'Stock Milling' + routeTo 'MILLING' + partNum in RTG pushToShop, so they leave the Custom-fab tab and flow through the Shop Floor Milling intake (backlog → tracker → scheduler) instead. Sales/custom unchanged. Note: still a two-step (lands in shop_custom_orders → operator "Accept HQ Order to Machine Backlog" deletes it and creates the shop_milling doc) because routing/machine/est-hrs are computed shop-side.

Also on this branch (ERP push fixes, surfaced during preview testing):
- CPQ now writes cpqData.configuration/quantities/dimensions (ERPPushPullTab.getJobLineItems reads these to map physical NS inventory; they were missing, so fresh quotes pushed nothing). Pre-existing main bug.
- ERP push failure now reports the specific reason (no config / steps not linked to parts / unresolved part ids / parts have no NS id).
- Per-flow NetSuite rollup item: CPQ Flow Builder "Create Rollup Item in NetSuite" button creates a 1:1 nonInventorySaleItem (named after the flow, subsidiary = brand, incomeaccount id 249 = 4001 SALES-HOUSE) via netsuiteProxy and stores nsRollupItemId on the flow. ERP push bundles labor+fees into flow.nsRollupItemId (falls back to hardcoded 61502). STATIC_FEE steps no longer require partHandling/linked item — they roll into the rollup. NS item-create payload (subsidiary {items:[{id}]}) still to be confirmed against live account.
- App Check debug token (firebase.js) lets PIN auth work on Vercel preview/localhost; production untouched. Token to register in Firebase console: d3b8f1a2-7c4e-4b9a-9f2d-1e6a5c8b0f33.

Open §12 items NOT done: SO-import stays a manual button not a scheduled Cloud Function (§12.4). Closing loop (finish→pack→ship→NS fulfillment) still net-new.

Next: test full path on Vercel preview (quote → push Estimate → Import & Auto-Split → both WOs appear linked → shop Start flips Setup Queue → push to Pick/Pack → pick → staging scan re-pairs), then merge to main.

Verify in prod data: part-level `manufacturingSpecs.partHandling` actually holds 'Small Parts'/'Custom' (classifyLine fallback + auto-gen default depend on it).
