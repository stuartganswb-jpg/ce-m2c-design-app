# Brief S4 — the customer portal · card payments · UPS · the Fulfilment tab · vendor API onboarding

*Written 2026-09-10 by the communicator session. Starts when Stuart opens it (after S1–S3). Read, in order:
`CLAUDE.md`, `SESSION_COMMS_2026-09-10.md`, `STATE_OF_THE_APP_2026-09-10.md` (your items: §2.2 #20–21, §2.3 #30,
§2.4 #54), then `PAYMENTS_UPS_INTEGRATION_BRIEF.md` (the platform topology and the two integrations, 08-12),
`VENDOR_API_ONBOARDING.md` (what UPS and NMI need, the merchant-services brief sent 2026-09, the build sequence
once credentials arrive), `PORTAL_CPQ_CONTRACT_BRIEF.md` (the four contracts the portal mirrors),
`PORTAL_VISION_QUICKSHIP_BRIEF.md` §7–9 (standing portal gaps, deploy reality, settled decisions),
`PORTAL_SECURITY_BRIEF.md` (the BFF model and the findings), `PORTAL_NEW_ENGINE_BRIEF.md`, `BRIEF_E_HANDOFF.md` §5
(the field list E handed the portal), and the memories `payments-ups-integration`, `fulfilment-screen-project`,
`portal-cpq-contract`, `security-hardening-portal`. The communicator has NOT read the older portal briefs in
full — where they conflict with `STATE_OF_THE_APP_2026-09-10.md` or `SESSION_COMMS_2026-09-10.md`, the newer wins;
where they conflict with each other, ask.*

## ⛔ Working agreement + standing rules

Plan first and WAIT. Requested scope only. No temporary fixes. Trace downstream — a fulfilment that ships must
reach RTG (every order via RTG) and NetSuite (tracking back, the fulfilment record released). One issue at a
time. **Secrets live in Google Secret Manager via `defineSecret`** (the `NS_CONSUMER_KEY` pattern at the top of
`functions/index.js`) — never in a React bundle, never in `.env`. **Every third-party call is a Cloud Function**
modelled on `netsuiteProxy` / the `portal*` shape (App Check for staff surfaces, `assertPortalCustomer` for the
portal). **The portal is a BFF**: customers hold a `customer` claim that every Firestore rule denies; they reach
data only through `portal*` callables that whitelist-shape every payload server-side. **The portal mirrors CPQ
logic by hand** (`functions/portalEngine.js`, `portal/src/shared/*`): a CPQ logic or schema change needs a
deliberate mirror sweep, and the whitelist means divergence shows as *missing*, never *wrong*.

## 0. Operating

- `portal/` is a Vite app with its own Vercel project (auto-deploys on push, ~10 s) at
  portal.classicalelements.com; its functions deploy only from Cloud Shell (`firebase deploy --only
  functions:portalMyOrders,functions:portalQuoteRequest,…`). **A portal change is not live until its function
  is deployed** — say the command to Stuart every time and verify (a marker in a callable's response, or the
  behaviour).
- Only 4cosworkcenter.com is allowed to the Claude-in-Chrome extension; the portal itself is not — ask Stuart
  for screenshots or drive it by hand.
- Mirror pairs (`CROSS_SESSION_CONTRACT.md`): `Shared/portalRequestLines.js` ⇄ `functions/portalRequestLines.js`
  (a node parity test asserted identical output — rebuild it in the scratchpad); `Shared/sizeMatrix` +
  `priceLevels` + the CPQ pricing memo ⇄ `functions/portalEngine.js` (CJS port, by hand); five files in
  `portal/src/shared/` are verbatim copies of `Shared/` modules — edit the app copy, re-copy, same commit.

## 1. Territory

**Own:** `portal/*`; in `functions/`: every `portal*` export (`portalMyOrders`, `portalDeleteQuote`, `portalBranding`,
`portalProfile`, `portalCatalog`, `portalFlow`, `portalCheckoutCatalog`, `portalQuoteRequest`, `portalVisionDraft`,
`portalStock`, `portalStockQuoteRequest`, `portalAssets`, `portalResolve`, `reserveQuoteNo`), the portal-user
callables (`createPortalUser`, `getPortalUserSetupLink`, `setPortalUserStatus`, `deletePortalUser`),
`portalEngine.js`, `portalRequestLines.js`, `feeRulesPort.js`, `aliasIdentity.js` (functions copy); `HQ/UPSShippingCalculator.js`
(tab 9.5 — static tables today); the NEW payment and UPS functions you create; the NEW `Shared/fulfilment*.js`
module and the Fulfilment tab.

**The Fulfilment tab lives in `PickPackApp.js`, which is S3's file.** Build it as ONE guarded mount
(`{tab === 'FULFILMENT' && <FulfilmentPanel …/>}`) plus one row in `Shared/pickTabs.PICK_TABS`; everything else in
your own module. `git diff -w PickPackApp.js` must show the mount and nothing else; S3 reviews it. A new tab key
is permission identity — an admin ticks it per role (`WMS_BRIEF.md` §1).

**Read-only:** S1's CPQ / CRM (the CRM's PortalAccessPanel = entitlement; the `jobs` doc is the spine a quote
lives on — `cpqData.cartItems` + `breakdown` + `totalPrice`; never re-derive a price in a second engine),
S2's spine, S3's WMS pack path (`itemfulfillment` transform at Packed, `pullFulfillment` reading `ItemShip`).

## 2. What exists today

- **Portal:** Showroom, Configurator (the held old-engine runtime + PROJ_SELECT mirror), QuickShip counter (V1),
  VisionIntake (V1), Gallery, Checkout (no date field, no payment), Policies (public `#/policies`, 4d0fce0),
  orders/quotes cards. Requests land as `jobs` `PORTAL_REQUEST` with no breakdown by design; staff price in CPQ.
- **Payments:** none. No card processing exists anywhere. Money is decided in CPQ (`jobs.cpqData.totalPrice` +
  `shippingAmount`) and Quick Ship invoices (`hq_sales_orders.invoiceTotal`, matched to a NetSuite invoice #).
  The merchant-services brief was sent 2026-09 (`VENDOR_API_ONBOARDING.md` §D); sandbox credentials pending.
- **UPS:** tab 9.5 is static tables. `VENDOR_API_ONBOARDING.md` §A locks the technical facts (OAuth client
  credentials, Rating `/Shop`, Shipping `/ship`, Track, Address Validation; test host `wwwcie`, prod
  `onlinetools`); Stuart's decisions pending: one shipper account or per brand; label format (GIF/PNG today,
  ZPL later); which rates staff and customers see.
- **Fulfilment:** pack posts an `itemfulfillment` transform at status Packed (`PickPackApp.js` ~1290) and a manual
  "⤓ Tracking" pull reads `ItemShip` rows back. No weight, dimensions, rate, carrier call or service choice. Nine
  entries stuck in the 11.1 queue (multi-location, already-closed, missing Class) belong to this project, not to
  a patch; Stuart: "forward only, no back-fixing"; Eric confirmed the multi-location orders carry ONE location
  per line, so the fix is `location` on the payload.

## 3. The work, in order — Stuart decides the first issue

**Small, unblocked, closes a window other sessions hold open**
1. **#20** `portalMyOrders` date read (`functions/index.js:1262`): `so.needBy || so.readyDate || so.createdDate` —
   decide with Stuart which the customer sees (`readyDate` is the promise, `needBy` their ask). Deploy. Tell S1
   the hash so they delete the two alias lines in `salesOrderHeader`.
2. **#21** the portal request functions (`portalQuoteRequest`, `portalVisionDraft`, `portalStockQuoteRequest`)
   accept `needBy` (ISO or '') and `productionNotes` (≤ 2000 chars) in `request.data` and stamp them on the job
   top-level; the portal Checkout gains the two fields (its call). Field list: `BRIEF_E_HANDOFF.md` §5.
3. `functions/index.js` portal list should filter `!j.deleted` (a staff-deleted quote shows as CANCELLED on the
   portal) — memory `rtg-netsuite-transmit`, pending since 08-25.

**The Fulfilment tab (#54) — Stuart's own next project, in his words:** *"after SO Pack is ready we will post
to a fulfillment tab which we will enter in weight and dimensions of packing, tie into UPS API, get rate, set
shipping details, ship the order, push the tracking back into NetSuite and release its fulfillment record as
fulfilled/shipped."* Plan it whole before building any of it:
4. the record: what a fulfilment doc carries (order, packages with weight/dims from `standard_boxes` + item
   weights, service, rate quoted / rate charged, label, tracking, NetSuite `nsIfId/nsIfTran`), where it lives,
   and how it reaches RTG (every order via RTG);
5. UPS functions: token cache, Rating `/Shop`, Shipping `/ship` with `BillShipper.AccountNumber`, Void, Track,
   Address Validation — each an App-Check-gated callable with `defineSecret` credentials; the `ShipperNumber` per
   brand beside `BRAND_NETSUITE_MAP`;
6. the tab: pack → weight/dims → rate → service → ship → label → tracking back to NetSuite → the fulfilment
   record released; `location` on the payload (Eric's answer);
7. the pending decisions from `VENDOR_API_ONBOARDING.md` §A3 are Stuart's before step 5.

**Payments** — after credentials arrive (`VENDOR_API_ONBOARDING.md` §E is the proposed sequence): a tokenising
callable, where a payment step slots into the portal request lifecycle and into Quick Ship invoices, what is
recorded on the `jobs` / `hq_sales_orders` doc, and what reaches NetSuite. Nothing before the sandbox exists.

**Portal parity (standing, per `portal-cpq-contract`)** — the mirror sweep for everything S1 shipped since
08-31: the one header, `finishOutsourced`, the kit bill shape, size families (`SIZE_FAMILIES` in
`portalEngine.js` — H2-RND was registered 07-26; check H1-2TRV), the Unfinished tag. Divergence shows as
missing; list what is missing before proposing what to mirror. The H2 landing's live portal test is still
owed (`h2-simple-elegance-flow` memory).

## 4. Acceptance

| run | expect |
|---|---|
| a portal quote request after #2 | the job carries `needBy` / `productionNotes`; Reopen in CPQ restores both; the SO header carries them |
| portal My Orders after #1 | the date the customer sees is the one Stuart chose; a pre-header order still shows a date |
| UPS rate on a packed order (after the tab) | published and negotiated rates returned; the chosen service and rate stored on the record |
| ship | label printed from the WMS label path; tracking on the record, on RTG's card, and on the NetSuite fulfilment |
| a multi-location SO | `location` on the payload; the transform posts |

## 5. Questions for Stuart

1. Which first: the two small portal closes (#1–3), or the Fulfilment plan?
2. The UPS decisions (`VENDOR_API_ONBOARDING.md` §A3): one shipper account or per brand; label format; which
   rates staff and customers see.
3. Have the UPS app (Client ID / Secret) and the NMI sandbox been issued yet? Nothing in payments or UPS can be
   built without them.

## 6. Hand-offs in

- **⚠ DEPLOY NOTICE from S3 · 2026-09-11 · 47c2b6b pushed at 12:25 EDT (S3 sweeps every served asset after the deploy
  and records it in BRIEF_S3 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped: (1) WMS Plating —
  the OB scan-in (a custom demand from the shop) now copies `finSiblingId / orderKey / soAppId / shopOrderId` onto the
  `plating_shipments` line as the stock pull does, so Receive stamps `floorPhase 'Plating Received'` and put-away mirrors
  `customFabStatus 'Complete'` + `floorPhase 'Plated'` (D1) for custom lines — before, neither ever fired and a plated custom
  order read "At the plater" forever. Put-away on a `custom: true` line posts NO NetSuite build/adjustment (custom fab is not
  stocked inventory; the plater PO + item receipt are the record), stamps `nsBuildSkipped: 'custom-fab'`, tells the order,
  commits to its bin; a short count REFUSES. (2) WMS Convert — the tab scrolls again (the column no longer pins to the
  viewport; the raw-item list keeps a 70vh scroller). No writer changed; RTG reads the same `floorPhase` vocabulary. Your side: nothing.

- **⚠ DEPLOY NOTICE from S1 · 2026-09-11 · 2b164a5 pushed at 09:59 EDT.** Hard-refresh + re-PIN before your next save.
  What shipped (Vision Phase 2): CPQ cart lines on the tag engine gain a **Vision** button (line → draft on the board);
  a Vision re-save of a line CPQ already holds REPLACES that line on Resume instead of adding one. `cpq_drafts` gains
  optional `cartItemId` / `openedFromCpqAt` (status `DRAFT_FROM_CPQ`); cart lines gain `visionDraftId`. Jobs / floors /
  NetSuite untouched until a re-finalize. Your side: if the portal ever lists a customer's drafts, `DRAFT_FROM_CPQ` is a staff working copy, not a customer request.

- **⚠ DEPLOY NOTICE from S3 · 2026-09-11 · e2cef1f pushed at 08:42 EDT (S3 sweeps every served asset after the deploy
  and records it in BRIEF_S3 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped: (1) WMS pick queue —
  a finishing doc RTG's bulk reopen restored with a reconstructed pick state (`reopenConfirmPick: true`) shows a red
  "⟲ REOPENED — confirm pick state" chip on its queue row and the active pick header, with ✓ confirmed; completing the
  pick clears it too (`reopenConfirmPick: false, reopenConfirmedBy/At`); refuses nothing. (2) Shop floor — Undo on a doc
  the closer stamped `closed: true` now REFUSES, naming who/when/why and pointing at RTG (before: status went back to In
  Process with the closed flag left, so the card vanished). No NetSuite write; no shape change beyond the three confirm
  fields S2 specified. Your side: nothing.

- **⚠ DEPLOY NOTICE from S1 · 2026-09-11 · 3c0e101 pushed at 08:33 EDT.** Hard-refresh + re-PIN before your next save.
  What shipped (Vision Phase 1b): on a flow with a pinned assembly, Vision Hardware's hardware pickers (ends, brackets,
  plates; rear ends on a double) come from the engine's slots with the engine's locks and reasons; a saved line carries
  `specs.enginePicks`; Push to CPQ waits for acknowledged removals. Flows without pins: unchanged. `cpq_drafts` gains the
  optional `specs.enginePicks` array. Board / placement / cut sheet / engineeringNotes shape unchanged. Your side: `portalVisionDraft` still writes the old-shape draft; the bridge reads both shapes. When the portal's Vision moves to the engine, write `specs.enginePicks: [{slotKey, choiceId, partId, kind, position, tier}]`.

- **⚠ DEPLOY NOTICE from S1 · 2026-09-10 · 21bea0f pushed at 23:40 EDT.** Hard-refresh + re-PIN before your next save.
  What shipped (Vision Phase 1a, the pure half): `Shared/visionEngine.js` (pickers from the engine's slots), the bridge reads
  `specs.enginePicks`, and the adapter / engine carry the pin's `endTreatment` on the choice (additive; no rule reads it).
  NOTHING on any screen changes yet — Vision Hardware still reads the old steps; the mount is Phase 1b. Your side: `portalEngine.js` mirror — `normalizeChoice` gains `endTreatment: U(input.endTreatment)` (fifth line; harmless if skipped, no rule reads it).

- **⚠ DEPLOY NOTICE from S1 · 2026-09-10 · b180339 pushed at 23:32 EDT (S1 sweeps the served bundle after the deploy
  and records it in BRIEF_S1 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped (Vision Phase 0): CPQ's
  save no longer deletes a quote's Vision drawings — `cpq_drafts` docs with `spatialData` are kept and marked
  `status: 'FINALIZED'` (+ `finalizedJobId/At/By`); pending-line readers exclude them; Vision's "Load saved line…" lists
  them. So CRM → Reopen Vision on a saved quote has its lines again. Jobs / floors / NetSuite untouched. Your side: `portalVisionDraft` writes cpq_drafts in Vision's shape — unchanged; a portal draft that reaches a saved quote is now kept FINALIZED instead of deleted. If the portal lists a customer's drafts anywhere, exclude `status === 'FINALIZED'` from "pending".

- **⚠ DEPLOY NOTICE from S1 · 2026-09-10 · 26f45de pushed at 23:04 EDT (S1 sweeps the served bundle after the deploy
  and records it in BRIEF_S1 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped: CPQ (tag engine
  configurator) — a selection a later choice removes is listed in a strip under the step rail with the engine's reason,
  and **+ Add configuration / Checkout refuse until each is acknowledged** (BRIEF_S1 #45, Stuart: "never a silent
  clear"). New pure reader `Shared/pickDrops.js`. Nothing leaves the configurator differently; no document or field
  shape change. Your side: the portal has its own configurator UI — note, not a mirror line: if it walks the tag engine with a settle, the same reader (`droppedPicks`) fits in front of its add.

- **⚠ DEPLOY NOTICE from S1 · 2026-09-10 · 2c61b3e pushed at 22:34 EDT (S1 sweeps the served bundle after the deploy
  and records it in BRIEF_S1 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped: a REFUSED NetSuite
  queue at CPQ save is stamped on the `jobs` doc — `nsTransmitRefusedAt` (ms), `nsTransmitRefusedCode`,
  `nsTransmitRefusedMessage` (≤500 chars) — in both save branches and the catch; a later successful queue (CPQ save or
  tab 12 push) removes all three with `deleteField()` in the write that stamps `nsTransmitQueuedAt`. Jobs document only;
  no floor document, no NetSuite write. Your side: nothing (portal-originated jobs are finalized by staff in CPQ, where the stamp is written).

- **⚠ DEPLOY NOTICE from S1 · 2026-09-10 · 38b1ba6 pushed at 22:08 EDT (S1 sweeps the served bundle after the deploy
  and records it in BRIEF_S1 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped: the H1-138TRV kit
  explosion re-keyed to S5's correction — an ARM by depth (SBA/EBA/6BA/DBA/CBA) plus a BACKPLATE by orientation
  (BP-H/BP-V/BP-C) per bracket position, both at the chart count; no sheet combo code is ever consumed. H1-2TRV
  unchanged. No document or field shape change. Your side: nothing (kits are not offered on the portal in v1).

- **⚠ DEPLOY NOTICE from S5 · 2026-09-10 · 105b29c pushed at 20:29 EDT (S5 sweeps every served asset after the
  deploy and records it in BRIEF_S5 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped: the
  H1-138TRV kit import corrected — Fabricut's "bracket" codes are arm + backplate here (the H1-138 pins carry arms
  SBA/EBA/6BA/DBA/CBA by depth and plates BP-H/BP-V/BP-C by orientation); the derived `system/traverse_rules_H1-138TRV`
  now keys those codes (a plate row per orientation, "one per bracket"); the 18 combo prices land on the arms' Fabricut
  rows (/P and every /EPn + /P25 that exists) with $0 plate rows; `H1_138TRV_PARTS` export re-shaped (`brackets.SINGLE`
  by depth, DOUBLE/CEILING strings, new `plates`). Verified first that re-applying the sheet rewrites every H1-2TRV kit
  and component row identical. No existing document or field shape changed; nothing written until Stuart applies. Your side: nothing beyond the earlier notice; if the portal ever seeds kits, the style names the backplate.

- **⚠ DEPLOY NOTICE from S1 · 2026-09-10 · bb5b5e1 pushed at 19:48 EDT (S1 sweeps the served bundle after the deploy
  and records it in BRIEF_S1 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped: tag engine —
  **a backplate follows its arm**: un-picking the return (or any arm) at a position drops the plate chosen for it
  instead of re-seating it under a bracket nobody has chosen; changing bracket still keeps the plate. No document or
  field shape change. Your side, the FOURTH mirror line for `functions/portalEngine.js`: `reseatPicks` re-seats a BACKPLATE onto a twin only while an arm is chosen at its position (with bd5907e rank, e4ab15a ridesWith, 6572b6f parked-never-rides).

- **⚠ DEPLOY NOTICE from S1 · 2026-09-10 · 9415338 pushed at 19:23 EDT (S1 sweeps the served bundle after the deploy
  and records it in BRIEF_S1 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped (S5's kit hand-off,
  S1's half): the kit explosion knows the **H1-138TRV** family (rod as the one per-foot part, brackets by style H/V,
  joiner as the splice, returns stay the fee items on the end steps); CPQ and tab 7 read `system/traverse_rules_<family>`
  from the flow's / kit's `kitFamily` instead of the fixed H1-2TRV document. H1-2TRV explodes exactly as before.
  No document or field shape change; the H1-138TRV rules document is S5's importer's to write. Your side: nothing new for the portal (kits are not offered there in v1).

- **⚠ DEPLOY NOTICE from S1 · 2026-09-10 · 6572b6f pushed at 18:17 EDT (S1 sweeps the served bundle after the deploy
  and records it in BRIEF_S1 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped: tag engine —
  **parked geometry never rides**: a pin with no item number (`parked`, or a `HIDDEN-<node>` id) is no longer a rider, so
  new quotes lose their $0 `HIDDEN-…` placeholder breakdown lines. Real hidden parts with an item ride as before. No
  document or field shape change. Your side, the THIRD mirror line for `functions/portalEngine.js`: normalizeChoice's `always` also excludes a parked choice (flag or HIDDEN- id) — with the rank change (bd5907e) and `ridesWith` (e4ab15a).

- **⚠ DEPLOY NOTICE from S5 · 2026-09-10 · 09104cf pushed at 17:45 EDT (S5 sweeps every served asset after the
  deploy and records it in BRIEF_S5 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped: the
  H1-138TRV kits — `Shared/kitCode` reads a second grammar `H1-138TRV-4(H|V)D?/(P|EP)` (a parsed align now may carry
  `rodKind` and `bracketStyle`; `axesKeyOf` gained a sixth field, blank on every H1-2TRV kit); `Shared/kitSeed`
  answers `rodKind` as an axis when the kit carries it (H1-2TRV kits do not — untouched) and reports the bracket
  style; the 4.6 kit-sheet import reads tab H1-138TRV and writes, on Apply, 8 `Approved_Designs` Kit records
  (`kitFamily: H1-138TRV`), 19 `clientPricing` rows on existing bracket/splice items, and `system/traverse_rules_H1-138TRV`
  (derived from the H1-2TRV usage table). No document or field shape changed for existing records; nothing is
  written until Stuart applies the import. Your side: the portal mirrors `kitCode`/`kitSeed` only if it seeds kits — if `portalEngine.js` parses kit codes, mirror the second grammar (`rodKind`, `bracketStyle`, sixth key field).

- **⚠ DEPLOY NOTICE from S1 · 2026-09-10 · e4ab15a pushed at 17:30 EDT (S1 sweeps the served bundle after the deploy
  and records it in BRIEF_S1 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped: a new pin tag
  **`ridesWith: RETURN`** (1.6 tag row, beside "hide": rides the rod / rides a return) — a hidden rider so tagged reaches
  the BOM only when a miter or French return is chosen on the order AND its rod is on the order (never a single). Built
  for the H1-138 standoffs of the short rear rod (`1.6 #72 / 1.5 #68`); H1-1's `#31/#32` get the same. Untagged
  riders unchanged. Docs: `assembly_pins` gains the optional field `ridesWith`. Your side, TWO mirror items now owed in `functions/portalEngine.js`: (1) the rank change in `slots()` (bd5907e — one order for every flow); (2) `ridesWith` in normalizeChoice + the `returnChosen` gate in `ridersFor` (this commit). Until mirrored the portal walks the old order and bills the standoffs on every double.

- **⚠ DEPLOY NOTICE from S3 · 2026-09-10 · f5a6c19 pushed at 15:14 EDT (S3 sweeps every served asset after the
  deploy and records it in BRIEF_S3 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped: WMS →
  Rod Cuts & Ring Packs → RING PACKS gains **⇄ REPACK** — break N packs and build another size from the eaches in one
  flow (5 × /BL-12 → 60 × /BL-EA → 6 × /BL-10, remainder stays loose in the each bin). Two NetSuite records through the
  convert RESTlet already deployed (unbuild, then build); a build failure after the unbuild is reported as an honest
  partial state. `PickPackApp.js` only — no RESTlet, functions, outbox, document or field shape change; pack SKUs are
  shelf stock nothing on the spine reads. Your side: nothing.

- **⚠ DEPLOY NOTICE from S1 · 2026-09-10 · bd5907e pushed at 15:07 EDT (S1 sweeps the served bundle after the deploy
  and records it in BRIEF_S1 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped: the tag
  engine's step order is ONE order for every flow — Rod Setup → Rod → Rod length → Ends (front L, R, then rear)
  → Bracket → Backplate → Rings → Accessories (`Shared/hardwareModel` rank; `HardwareConfigurator` length step).
  Consequence you may notice: the BOM / quote lines follow the slot order, so a NEW quote lists the rod first,
  then ends, brackets, plates, rings — identities, quantities and prices unchanged; older quotes keep the order
  they were saved with. No document or field shape changed. Your side, a mirror item: `functions/portalEngine.js` carries its own copy of the rank — the portal walks in the old order until it mirrors (the change is the deleted tiered branch in `rank()` inside `slots()`; see commit bd5907e).

- **⚠ DEPLOY NOTICE from S2 · 2026-09-10 · Issue 2 PREVENTION (push pending Stuart's word) — hard-refresh + re-PIN when it
  lands.** `Shared/orderLifecycle`: (1) `isDoneState` no longer reads a finishing doc's `currentPhase 'Complete'` as done —
  DONE = `packStatus 'Packed'` (also the stock put-away) / shop `Completed` / `Built` / closed; a pick-only doc is not done
  until packed. **S3: `isDoneState` is not imported by your files, but if any WMS/finishing screen relied on "Complete =
  done" via the audit, say so.** (2) new `recordKnowsDone(p)` = done OR `floorPhase` in Complete/Packed/Shelved/Plated.
  (3) `auditOrphans` raises FLOOR_DONE once per RECORD, only when EVERY linked floor doc is done and the record neither is
  closed nor knows (`floors[]` on the finding). (4) `closeOrderEverywhere` stamps `stateBeforeClose` on every fin / shop /
  hq doc it closes (the fields it overwrites) and the reopen restores from it exactly. (5) RTG: no "Close all" on FLOOR_DONE.
  No writer, no floor screen, no NetSuite write changed.
- **⚠ DEPLOY NOTICE from S1 · 2026-09-10 · 16a74bb pushed at 11:24 EDT (S1 sweeps the served bundle after the deploy
  and records it in BRIEF_S1 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped: the CRM
  pipeline card (Quotes + Sales Orders windows on a customer) prints JOB · SIDEMARK · PO rows. Display only —
  no document or field changed. Your side: nothing.

- **⚠ DEPLOY NOTICE from S1 · 2026-09-10 · 1259391 pushed at 10:56 EDT (S1 sweeps the served bundle after the
  deploy and records it in BRIEF_S1 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped:
  the CRM (tab 10) **Modify Quote / Job** modal now edits the whole checkout header — order sidemark, PO #,
  internal memo, need-by, production notes, ship-to (saved NetSuite address or custom drop-ship), shipping
  charge — through `Shared/salesOrderHeader.jobHeaderPatchOf` (the field set CPQ's finalize writes). Docs it
  touches: `jobs` (those header fields + `headerEditedAt/By`); `hq_sales_orders/SO-APP-<quoteNo>` when it
  exists and is not QUICKSHIP — header rebuilt through `soHeaderOf` (`sidemark, customerPo, internalMemo,
  needBy` + aliases, `productionNotes, shipTo[], shippingMethod/AddressId, customShippingAddress,
  shippingAmount, memo` + `headerEditedAt/By`; `readyDate`, recipe, `status`, `createdBy` untouched). NetSuite
  is NOT updated by the edit. Your side: a portal-originated job is edited the same way; `portalMyOrders` reads the same keys it read before.

- **⚠ DEPLOY NOTICE from S2 · 2026-09-10 · second push (reopen rules corrected after the first dry run) — hard-refresh
  + re-PIN again.** Three rules changed in `Shared/orderLifecycle.reopenPlanFor` before anything was written: (1) on a
  sales order a fin doc with `nsFulfillQueued` / `nsIfTran` is SHIPPED and stays closed (14 July/August Brimar orders
  would otherwise have come back onto the WMS); (2) a shop half reopened by hand after the close keeps its status and
  loses the `closed: true` flag the bulk close set (the shop's Reopen never clears it, so Livio's six were still hidden —
  S3: that is a defect in `ShopFloor.js undoComplete` worth a line in your queue); (3) a cancelled `ns_outbox` entry that
  had `lastError` / `attempts` goes back to FAILED (11.1 Retry by hand), only a clean one to PENDING. No other code changed.
  **Plus the operator override** (Stuart: of the packed orders "keep open only SO60151, SO60152"): every finishing / shop row on
  the dry-run list has "⟲ reopen anyway" (on a KEEP) or "✕ keep closed" (on a RESTORE); the order's other documents follow;
  the written doc carries `reopenOverride: 'REOPEN'|'KEEP'` + `reopenOverrideBy`.
- **⚠ DEPLOY NOTICE from S1 · 2026-09-10 · a58d126 is LIVE (verified in the served `main.d8130142.js`; it
  rode S2's 10:07 deploy).** What shipped: `Shared/nsTransmit`'s TAGS branch now SKIPS a parked-geometry line
  (partId `HIDDEN-<node>`, no money) instead of refusing the whole transaction as LINES_UNRESOLVED; the
  predicate is `Shared/lineClassification.isParkedGeometryLine` (11-assertion harness). Effect: every H1-138
  quote (and Sinaya's Thom Filicia quotes) had silently failed to queue its NetSuite estimate since 21 Aug —
  from this bundle on, a CPQ save queues it. No Firestore document or field changed shape; `ns_outbox` simply
  gains the estimate entries it was missing. Your side: the portal never calls `nsTransmit`, so no mirror sweep is owed for this one. Re-PIN is the one S2's deploy already required.

- **⚠ DEPLOY NOTICE from S2 · 2026-09-10 · 6c72e80 is LIVE (verified in the served bundle).** Production
  changed under you: hard-refresh (⌘⇧R) and re-PIN before your next save — CPQ save-is-send refuses on a stale
  bundle. What shipped: `Shared/orderLifecycle` gains `reopenPlanFor` / `planBulkReopen` / `applyBulkReopen`
  (pure; 66 assertions) and RTG's Board vs Floor panel gains **⟲ Reopen a bulk close** — the recovery for this
  morning's "Close all" that closed live orders (dry run → confirm → write, ledgered `BULK_CLOSE_REOPEN`). Docs
  it touches: `fin_workorders` (restored `currentPhase / stepStatus / sentToPickPack / pickStatus`, new
  `reopenConfirmPick`, `reopenedAt/By/From`, `reopenRunId`, `reopenedFromClose`), `shop_custom_orders` (`status`
  restored, `closed` removed), `hq_work_orders` / `hq_sales_orders` (`status` restored, `nsWoCloseRequired`
  removed), `rod_cut_orders` (CANCELLED → OPEN for reopened orders), `ns_outbox` (CANCELLED → PENDING for the
  writes the close cancelled). Nothing in your territory's code changed. The push also carried S1's a58d126.
- **From S1:** #20 and #21 above (the E8 field list).
- **To S3 (you write it into `BRIEF_S3` §6):** the Fulfilment mount + the `PICK_TABS` row, when you are ready.

## 7. Status log

*(newest first)*

## 8. Opener (paste to start the session)

```
You are the S4 session — the customer portal · card payments · UPS · the Fulfilment tab · vendor API
onboarding. Read, in order: CLAUDE.md (the working agreement binds you), SESSION_COMMS_2026-09-10.md (the map,
file ownership, hand-off protocol — briefs are the channel), STATE_OF_THE_APP_2026-09-10.md,
BRIEF_S4_PORTAL_PAYMENTS_UPS_API.md (your brief), then PAYMENTS_UPS_INTEGRATION_BRIEF.md, VENDOR_API_ONBOARDING.md,
PORTAL_CPQ_CONTRACT_BRIEF.md, PORTAL_VISION_QUICKSHIP_BRIEF.md §7–9, PORTAL_SECURITY_BRIEF.md, BRIEF_E_HANDOFF.md
§5, and the memories payments-ups-integration, fulfilment-screen-project, portal-cpq-contract,
security-hardening-portal. Rules: secrets only via defineSecret; every third-party call is a Cloud Function
modelled on netsuiteProxy / the portal* shape; the portal is a BFF that mirrors CPQ logic by hand — a CPQ
change needs a mirror sweep; portal functions deploy only from Cloud Shell (write the command, verify it is
live). The Fulfilment tab is ONE guarded mount in S3's PickPackApp.js plus your own Shared/fulfilment module;
git diff -w proves the mount is all you touched. Other sessions: S1 (CPQ/CRM — the jobs doc is the spine),
S2 (RTG — every fulfilment must reach RTG), S3 (WMS — owns PickPackApp.js and the pack path), S5. Cross a
line: stop, patch spec into THEIR brief's § Hand-offs in, log it in yours. Git: never switch branches, stage
only your files, pull --rebase --autostash, safe-push check, eslint 0 errors. Plan first and wait — every
time. One issue at a time. First: ask Stuart BRIEF_S4 §5 (which first; the UPS decisions; whether credentials
exist), then plan that one issue. Identify as "(S4)" in every commit.
```
