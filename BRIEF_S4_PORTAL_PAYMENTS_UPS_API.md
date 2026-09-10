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
