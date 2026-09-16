# Payments + UPS API Integration — Session Brief (2026-08-12)

You are a NEW session whose job is to **explore and then build two integrations: the credit-card
processor API and the UPS shipping API**, wiring both into the HQ app AND the customer portal.
Read `CROSS_SESSION_CONTRACT.md` first (territory map, deploy matrix, git rules) — several other
sessions run this repo in parallel. Stuart routes anything cross-territory.

---

## 1. Platform in one page

**One Firebase project — `ce-m2c-design-collab` — three front ends, one functions codebase.**

| Surface | Stack & location | Deploys | URL |
|---|---|---|---|
| HQ / floors / WMS app | React CRA, `src/` | **auto** — Vercel on push to `main` (~2 min) | 4cosworkcenter.com (`/hq`, `/shop-floor`, `/finishing-floor`, `/pick-pack`) |
| Customer portal | Vite + React, `portal/` | **auto** — its own Vercel project (~10 s) | portal.classicalelements.com |
| Cloud Functions | `functions/index.js` (v2 `onCall`/`onRequest`, CJS) | **MANUAL — Cloud Shell only** | n/a |

- **Firestore**: App Check ENFORCED → **no local/Node script can read or write prod data** (permission-denied). Bulk/data work happens inside the authenticated app (admin buttons) — never scripts. Rules are per-collection default-deny (`firestore.rules`); new top-level collections need a rules entry + `firebase deploy --only firestore:rules` from Cloud Shell (workaround used by App Imp: subcollections under an allowed doc, e.g. `system/app_feedback/entries`).
- **Auth**: staff log in with a PIN → `authenticatePin` callable mints a custom token (role claims: admin/superadmin/operator). An outer email login (OuterGate) wraps the day. Portal customers are separate: `portal_users` docs + Firebase Auth accounts carrying a **`customer` claim** — that claim is DENIED by every Firestore rule, so customers can only reach data through the BFF functions.
- **Storage**: staff-only bucket rule; assets served via `getDownloadURL` token URLs (bypass rules by design).
- **Cloud Shell** (shell.cloud.google.com): local `firebase login` fails on Stuart's Mac, so ALL functions/rules deploys go: `cd ~/ce-m2c-design-app && git pull origin main && firebase deploy --only functions:<names> --project ce-m2c-design-collab`. **You write the command, Stuart pastes it.** Frontends need no manual deploy.
- **Secrets**: functions use **`defineSecret` (Google Secret Manager)** — see `NS_CONSUMER_KEY` etc. at the top of `functions/index.js`. **This is the pattern for processor + UPS credentials.** Never put keys in the React bundles or `.env` (CRA env is public config: Firebase client keys only).
- **Vercel gotchas** (memory `vercel-deploy-pipeline`): a "Ready" deploy can serve stale code — verify prod by grepping the live bundle for a marker string; the app is CODE-SPLIT, so tab code lives in chunks, not `main.*.js`. Hard-refresh (⌘⇧R) after every deploy.

**NetSuite** (the ERP, everything financial ends there): `netsuiteProxy` function OAuth1-signs
requests (SuiteQL reads + record writes); account-wide ~5-concurrency limit → **`ns_outbox`**
staged writes (Shared/nsOutbox `enqueueNsWrite`: serial worker, retried, idempotent, `writeBack`
stamps ids onto app docs; monitor at HQ 11.1 → NetSuite Sync Queue). `BRAND_NETSUITE_MAP`
(m2c=sub3/loc19, ce=sub2/loc17, uniquity=sub6/loc20, leyla=sub5/loc18) is duplicated across
several files — keep copies in sync. **The proxy pattern (App-Check-gated callable + secrets +
allowlisted target) is the template for any third-party API you add.**

## 2. App structure (what talks to what)

- `src/components/HQ/` — the PLM: CPQ Configurator (tab 8, `CPQTab.js` — quotes are built here,
  finalize writes a `jobs` doc), Client Vision (9), CRM (`ExternalCoopTab.js`, tab 10 — customer
  cards, pipeline Quotes→Sales Orders, PortalAccessPanel = portal entitlement), ERP Push/Pull
  (12, `ERPPushPullTab.js` — pushes NetSuite estimates), Quick Ship (7 — stocked-goods orders +
  invoices), Stock View (12.5), RTG Dispatch (13), Master Library (4), Mass Update (4.5),
  Assembly Builder (1.6), System Admin (11 — CPQ flow builder).
- `src/components/PickPack/PickPackApp.js` — WMS: pick → stage → pack → ship; plating; converts.
- `src/components/FinishingFloor/`, `src/components/ShopFloor/` — the production floors.
- `src/components/Shared/` — the one-rule-one-place modules (labelPrint, orderStatus, feeRules,
  finishRouting, finishedGoodsRun, nsOutbox, nsProxy, quoteDisplay, reopenQuote…).
- `portal/src/` — Configurator, QuickShip, Showroom, VisionIntake, App (orders/quotes cards);
  `portal/src/shared/` = verbatim copies of a few Shared modules (sizeMatrix, priceLevels,
  bayMath, aliasIdentity, quickShipUom) — **edit the app copy, re-copy, same commit**.
- Key collections: `jobs` (quotes; `cpqData.totalPrice`, `cpqData.cartItems`, `shippingAmount`,
  `poNumber`, `createdBy`), `hq_sales_orders` (SOs; QUICKSHIP class carries `invoiceTotal`,
  `nsInvoiceNo`), `crm_records` (customers; `shippingAddresses[]`, `billingAddress`, portal
  entitlement fields incl. `portalTeam`), `fin_workorders` / `shop_custom_orders` (floor docs,
  shared `orderKey`), `Approved_Designs` (item master), `cpq_flows`.

## 3. The portal (BFF) — where customer-facing payment/shipping lands

Everything the customer's browser does goes through `exports.portal*` callables in
`functions/index.js` (13 of them: portalFlow/portalCatalog/portalCheckoutCatalog/
portalQuoteRequest/portalStockQuoteRequest/portalMyOrders/portalResolve/…). Each one
`assertPortalCustomer(request)` → customerId from the auth claim, then **whitelist-shapes** every
payload server-side (customers never receive cost tiers, vendor data, internal fields). Pricing
runs server-side in `functions/portalEngine.js` (a hand-maintained CJS port of CPQ pricing).

**Portal request lifecycle** (where a payment step would slot): Configurator/Quick Ship →
`portalQuoteRequest` / `portalStockQuoteRequest` → `jobs` doc (`status: PORTAL_REQUEST`,
multi-line `portalRequest.lines[]` + checkout `addOns[]`) → CRM pipeline card → staff price in
CPQ → SO → production → WMS pack → NetSuite fulfillment/invoice.

## 4. Integration #1 — credit-card processor

**Where money is decided today** (no card processing exists anywhere yet):
- HQ: CPQ quote total (`jobs.cpqData.totalPrice`) + shipping (`shippingAmount`) → NetSuite
  estimate; Quick Ship invoices (`QuickShipInvoiceModal`, `hq_sales_orders` w/ `invoiceTotal`,
  matched to NetSuite invoice #); trade discounts/fees all resolve before this point.
- Portal: checkout submits a quote REQUEST (unpriced or engine-priced) — no payment step.

**Guidance for the exploration:**
- All processor calls = **new Cloud Functions** using `defineSecret` creds, modeled on
  `netsuiteProxy`/the `portal*` shape (App Check for staff surfaces; `assertPortalCustomer` for
  portal surfaces). Nothing card-shaped in React bundles.
- **PCI scope**: strongly prefer the processor's hosted checkout / hosted fields / payment links
  so raw PANs never touch our servers or bundles. The portal card-entry UI should be the
  processor's iframe/redirect; our function creates the payment intent/session server-side and
  records the result.
- Likely first deliverables: (a) portal checkout "pay deposit / pay in full" on an approved
  quote (customer claim → jobs doc → amount server-computed, never client-supplied), (b) CRM/
  Quick Ship "collect payment / send payment link" button for staff, (c) webhook receiver
  (`onRequest`, signature-verified) → stamps payment status on the `jobs`/`hq_sales_orders` doc
  via Admin SDK + queues the NetSuite customer-payment/deposit record through `ns_outbox`.
- Reconciliation ends in NetSuite — decide with Stuart whether payments post there as customer
  deposits (against SO) or payments (against invoice).

## 5. Integration #2 — UPS shipping API

**What exists today:**
- HQ tab 9.5 `UPSShippingCalculator.js` + `Shared/upsIntlRates.js` = **hardcoded rate tables**
  (domestic + intl data baked into the file — no API). This is the thing the real UPS Rating API
  replaces or backs.
- CPQ checkout: staff type a manual `shippingAmount` → pushed to the NetSuite estimate HEADER
  (`shippingcost` + auto-resolved `shipMethod` — required or NetSuite 400s; see
  `ERPPushPullTab.resolveShipMethod`).
- Addresses: `crm_records.shippingAddresses[]` (+ `billingAddress`), per-quote
  `jobs.customShippingAddress` ({attention, addressee, addr1, addr2, city, state, zip, country}).
- WMS pack flow: boxes chosen per order (`standard_boxes` w/ dimensions), pack photos, weights on
  items (`manufacturingSpecs.weight`), completion → NetSuite item fulfillment (`nsIfTran`). No
  label purchase/tracking anywhere yet.

**Guidance:** UPS OAuth (client credentials) token flow + Rating/Shipping/Tracking APIs — again
server-side functions w/ `defineSecret`. Natural deliverables: (a) live rate quote in CPQ
checkout + portal checkout (replace/back the static calculator; box+weight heuristics from
`standard_boxes` + item weights), (b) WMS pack → buy label, store tracking # on the order +
NetSuite fulfillment, print via `Shared/labelPrint` (`printHtmlDocument` handles 4×6 fine),
(c) tracking status on CRM card + portal order card (`portalMyOrders` whitelist — add fields
deliberately).

## 6. Working rules (hard-won — follow exactly)

- **Git, multi-session**: NEVER switch branches in the shared checkout. Commit small changes
  directly on main; stage ONLY files you changed (never `git add -A`); always
  `rm -f .git/index.lock` then `git pull --rebase --autostash origin main` before push.
  Commit trailer: `Co-Authored-By: Claude <model> <noreply@anthropic.com>`.
- **Verify**: `npx --no-install eslint <files>` (0 errors required), full
  `CI=false npx --no-install react-scripts build`; pure modules get `node --test` files in the
  scratchpad (App Check blocks any test that touches prod data). Portal: `cd portal && npm run build`.
- **Functions changes ship only via Stuart + Cloud Shell** — every functions edit ends with you
  handing him the exact deploy command listing the changed function names.
- **Fenced files** (other live sessions): `SpecSheet/*`, `BOMTab.js`, `CollectionReadinessBoard`,
  `AssemblyBuilderTab.js` (Brimar rebuild is ACTIVE in it), `ERPPushPullTab.js`, `RTGDispatchTab.js`,
  and the H1 shared modules list in `CROSS_SESSION_CONTRACT.md` §0. Stuart can override per-ask;
  flag every touch in the commit message.
- **Reading prod / user feedback**: the **App Imp** tab (visible in every section, all roles) is
  the feedback queue with a resolve→test→verify loop; you can read it live via Claude-in-Chrome
  (Stuart connects his Chrome ("MacAir") + PINs once; allowed domain: 4cosworkcenter.com only —
  ask him to allow portal.classicalelements.com in the extension if you need portal screens).
- **New fields on `jobs`/`hq_sales_orders`** ripple: CRM cards, FormPreview documents,
  `portalMyOrders` whitelist, ERP push — check each surface; memory `portal-cpq-contract` is the
  mirror checklist.

## 7. Open items you may collide with (as of 2026-08-12)

- Portal checkout blank-screen (Christie) — believed fixed by the 2026-08-12 full portal
  functions deploy; awaiting her retest.
- CE estimate mapping just changed (`customForm` 299, `class` 2, `otherRefNum` PO#,
  `custbody_bit_internalmemo`, line `custcol3`) — your NetSuite payment records should follow the
  same exact-field-id discipline (get ids from Eric via App Imp; his reports include them).
- Pending manual deploy ledger lives in `CROSS_SESSION_CONTRACT.md` — check it before diagnosing
  "prod doesn't match the code".
