# UPS + NMI Onboarding — What We Need & What To Tell Them (2026-08-12)

Companion to `PAYMENTS_UPS_INTEGRATION_BRIEF.md`. Research sources: UPS official OpenAPI specs
(github.com/UPS-API/api-documentation — the same specs developer.ups.com renders), UPS Postman
workspace; NMI docs at docs.nmi.com / support.nmi.com. Items marked ⚠ are unverified — confirm
with the vendor's support line.

---

## A. UPS — what we need before coding

### A1. Account + portal setup (Stuart does this, ~15 min)
1. **UPS.com profile tied to the shipper account(s)** — log in at developer.ups.com with the
   ups.com login that owns/administers the shipping account.
2. **Create an app**: profile menu → Apps → **Add Apps** → "I want to integrate UPS technology
   into my business" → **associate the 6-digit shipper account number** → select API products.
   Products to select: **OAuth Client Credentials, Rating, Shipping, Tracking (Track API),
   Address Validation**, (optional: Time in Transit, Paperless Documents).
3. Out comes a **Client ID + Client Secret** → these go into Google Secret Manager
   (`defineSecret`, same as the NetSuite creds). Never in the React bundle.

### A2. Questions for the UPS rep / API support line (800-247-9035 → 3 → 2)
- **Negotiated rates**: confirm the account has **negotiated rates activated for API use (ABR)**.
  Without it the Rating API returns published/retail only. With it, one call returns BOTH
  published and negotiated (that's how we'll offer the retail-vs-negotiated display choice).
- **Track API production access** ⚠: reportedly needs a separate access-request/justification
  step before production tracking works. Ask; budget lead time.
- **Production activation** ⚠: most APIs get test+prod immediately; historically Shipping,
  Address Validation (street level), and Pickup needed a second production request. Confirm the
  current per-app flow.
- **Rate limit** for our app (429/error 10429 threshold — not published; ~250-300/min cited by
  integrators ⚠).

### A3. Decisions Stuart owns
- **One shipper account or per-brand?** CE / M2C / Uniquity / Leyla map to separate NetSuite
  subsidiaries. If they ship (and get billed) on different UPS account numbers, we need each
  number associated in the portal app, and the WMS ship step must pick the right `ShipperNumber`
  per brand (extend `BRAND_NETSUITE_MAP`-style mapping).
- **Label format**: current WMS prints 4×6 via browser HTML (`Shared/labelPrint`) → **GIF/PNG**
  works today, zero new hardware. If the pack station gets a thermal printer later, **ZPL** is
  supported. (PDF ⚠ unverified in current spec.)
- **Which rates staff/customers see**: negotiated vs published vs marked-up — this becomes an HQ
  UPS-tab setting that gates the WMS + checkout displays.

### A4. Technical facts locked in (for the build)
- Auth: OAuth2 **client credentials** — `POST /security/v1/oauth/token`, Basic auth
  (ClientID:Secret), optional `x-merchant-id` = account number. Token ~4 h ⚠ — cache + refresh
  in the function.
- Hosts: test **wwwcie.ups.com/api**, prod **onlinetools.ups.com/api**.
- Rating: `POST /api/rating/v2409/Shop` (all services) or `/Rate`;
  `ShipmentRatingOptions.NegotiatedRatesIndicator` + `Shipper.ShipperNumber` → response carries
  `TotalCharges` (published) + `NegotiatedRateCharges`. Shipper `StateProvinceCode` required.
- Shipping: `POST /api/shipments/v2409/ship` — `BillShipper.AccountNumber`, `Service.Code`,
  `Package[]` (dims/weight from `standard_boxes` + item weights), `LabelSpecification` →
  base64 label back. Void: `DELETE /api/shipments/v2409/void/cancel/{shipmentId}`
  (+ `trackingnumber` param for one package of several).
- Tracking: `GET /api/track/v1/details/{inquiryNumber}`, headers `transId` + `transactionSrc`.
- Address Validation: `POST /api/addressvalidation/v2/3` (validate + residential/commercial
  classification — feeds the residential surcharge on rates). US+PR only; CIE only returns NY/CA.
- Legacy Access Keys are DEAD (retired 2024) — OAuth/REST is the only path.

---

## B. NMI — what to request from the merchant services provider

NMI is white-label: **the reseller provisions everything and feature flags vary by reseller** —
hand them the list below verbatim.

### B1. Provisioning checklist (give this to the rep)
- Gateway account(s) — see B3 brand/MID question first.
- **Private API Security Key** (server-side; ideally separate keys for prod vs dev).
- **Public Tokenization Key** (for Collect.js hosted fields).
- Features enabled: **Customer Vault** (card-on-file), **Electronic Invoicing** (hosted pay
  pages / emailed payment links), **Webhooks**, Collect.js/tokenization (usually standard).
- **Tap to Pay**: partner-portal-side feature flag + confirmation that **our processor supports
  NMI Tap to Pay** + the Application Identifier for the mobile SDK.
- A **sandbox/test account** (sandbox.nmi.com) or Test Mode toggle.
- Ask: does their portal run on a white-label domain? (If so our API endpoint is
  `https://<their-domain>/api/transact.php` instead of secure.nmi.com.)
- Ask: monthly add-on pricing for Vault / invoicing / TTP (typically $5–10/mo items).

### B2. Questions for NMI/reseller support
- Does `invoicing=add_invoice` return a **pay-page URL we can embed ourselves** (in our PDFs /
  portal), or does the gateway only email the link itself? ⚠ (Docs describe gateway-sent email;
  we want the raw URL for the PDF-footer use case.)
- Is the newer **Payment Component** preferred over classic Collect.js for new integrations? ⚠
- Tap to Pay processor/device matrix and per-transaction pricing. ⚠

### B3. Decisions Stuart owns
- **One MID or per-brand MIDs?** Same subsidiary question as UPS — money must reconcile into the
  right NetSuite subsidiary. Ask the reseller how multiple MIDs are handled (NMI supports
  multi-merchant under one login).
- **NetSuite posting**: payments land as **customer deposits** (against SO, pre-invoice) or
  **customer payments** (against invoice)? Likely deposits for portal/quote payments, payments
  for Quick Ship invoices. Get exact record fields from Eric.
- **Tap to Pay requires a native app** — our platform is web. Options: a tiny React Native /
  Swift wrapper app for trade shows (NMI TTP SDK: iOS 18.5+ / Android 11+, Apple entitlements
  needed on our Apple Developer account listing NMI as PSP), OR a physical BLE reader via NMI's
  Payment Device SDK, OR fall back to Electronic Invoicing links at the booth. Decide before the
  trade-show build.

### B4. Technical facts locked in (for the build)
- API: form-encoded POST to `https://secure.nmi.com/api/transact.php` (NOT JSON/REST);
  querystring-style responses (`response=1`, `response_code=100`).
- PCI scope: **Collect.js hosted-field iframes** in the browser → single-use `payment_token`
  (24 h, one submission) → our Cloud Function POSTs token + security key. Raw PAN never touches
  our servers or bundles → SAQ A/A-EP. This is the ONLY card-entry path we'll use.
- Card-on-file: `customer_vault=add_customer` + `payment_token` → vault id → later
  `type=sale&customer_vault_id=...&amount=...`. `type=validate` for $0 verify at save.
- Payment links: `invoicing=add_invoice` + amount + email (+ line items) → hosted pay page,
  `invoice_id` returned (store on the `jobs`/SO doc to resend/close).
- Webhooks: Merchant Portal → Settings → Webhooks → our `onRequest` function URL; deliveries
  signed `Webhook-Signature: t=<nonce>, s=<sig>` = HMAC-SHA256(nonce+body, signing key).
- **We can start TODAY without the reseller**: NMI's public demo security key
  (`6457Thfj624V5r7WUwc5v6a68Zsd6YEm`) + demo tokenization key are published in their docs —
  enough to build and test the whole vault/sale/invoice flow before our real account exists.

---

## C. Platform description to send both vendors

> We run a custom manufacturing ERP/CRM web application for Classical Elements / M2C Studio.
> Front end: React single-page apps hosted on Vercel — staff app at 4cosworkcenter.com, customer
> portal at portal.classicalelements.com. Back end: Google Firebase (Cloud Functions for
> Firebase, Node.js) — **all third-party API calls are made server-side from Cloud Functions**;
> credentials live in Google Secret Manager and are never exposed to the browser. Webhooks can be
> received at HTTPS Cloud Function endpoints. Our ERP of record is Oracle NetSuite; payments,
> shipments, and fulfillments are recorded there through our existing server-side integration.
>
> **UPS scope**: OAuth 2.0 client-credentials, REST JSON APIs from Node.js — Rating (Shop, with
> negotiated rates on our shipper account), Shipping (label creation billed to our account, GIF/
> PNG labels printed at 4×6 from warehouse browser stations; ZPL possible later), Void, Tracking,
> and Address Validation. Test in CIE first, then production.
>
> **NMI scope**: server-to-server Payment API from Node.js with Collect.js hosted fields for all
> card entry (no cardholder data touches our systems — SAQ A/A-EP), Customer Vault for
> card-on-file on pre-registered trade accounts, Electronic Invoicing hosted pay pages for
> payment links on emailed quotes/orders, transaction webhooks to our HTTPS endpoint, and Tap to
> Pay mobile SDK for in-person trade-show sales.

(They'll also ask for business/underwriting info — legal entity names, volume, average ticket —
Stuart provides those.)

---

## D. Merchant services brief (sent 2026-09) — platform, security, sandbox request

Their "Website requirements checklist WP.pdf" = the standard Visa/Mastercard ecommerce
underwriting checklist (goods description, business address/phone/email, currency, customer
service #, delivery standards, country of origin, card logos, T&Cs in the checkout sequence,
privacy policy, refund policy w/ click-to-accept, security method statement, review-before-
complete + cancel option, web-host contact). Underwriting PENDS the application until the
payment-facing pages display all of it, and Visa re-reviews annually.

### D1. Paste-able brief to the merchant services team

> **Platform.** We are a US-based B2B ("to the trade") manufacturer of custom window hardware
> and lighting. Our platform is a custom in-house application — no shopping-cart plugin or
> third-party ecommerce platform. Front end: React single-page applications hosted on Vercel —
> staff/ERP app at 4cosworkcenter.com and a login-gated trade-customer portal at
> portal.classicalelements.com. Back end: Google Firebase (Cloud Functions, Node.js). Our
> financial system of record is Oracle NetSuite, integrated server-side. Web hosting: Vercel
> Inc. (frontends) and Google Cloud (backend). All transactions are in USD; delivery is via UPS.
>
> **Payment flows (three).** (1) Payment links on emailed quotes/invoices, using the gateway's
> hosted Electronic Invoicing pay pages. (2) Portal checkout for pre-registered, logged-in trade
> customers, with card-on-file via the gateway Customer Vault. (3) Card-present Tap to Pay at
> trade shows via the gateway's mobile SDK.
>
> **Security / PCI scope.** All card entry uses NMI-hosted capture exclusively — Collect.js
> hosted iframe fields in the portal and NMI-hosted pay pages for invoice links. Cardholder data
> is never transmitted to, processed by, or stored on our servers or in our application code; we
> handle single-use tokens and Customer Vault IDs only (SAQ A / A-EP scope). All gateway API
> calls are server-side from Google Cloud Functions over TLS; gateway credentials are stored in
> Google Secret Manager and never exposed to the browser. All sites are HTTPS-only (TLS 1.2+).
> Transaction webhooks will be received at an HTTPS endpoint with HMAC signature verification.
>
> **Website requirements checklist.** Reviewed. The payment-facing pages will display every
> listed item before go-live: full goods/services description, business physical address and
> phone, email contact, customer service number, USD currency statement, delivery method (UPS)
> and time standards, US country of origin, card association logos, terms & conditions within
> the checkout sequence, privacy policy, refund/return policy with click-to-accept, the security
> method statement, order review with cancel option before completion, and hosting-provider
> contact. One question: our checkout sits behind trade-account login (customers are
> credit-approved and registered before they can buy) — please confirm whether the checklist
> items must additionally appear on our public marketing site, and we will mirror them there.

### D2. Sandbox setup request (give them this list)

1. **Sandbox gateway account** (sandbox.nmi.com, or a live account with Test Mode — sandbox
   preferred so it can't touch real money).
2. Sandbox **Merchant Portal login** for our admin (Stuart Gans, stuart@classicalelements.com).
3. Sandbox **private API Security Key** (server-side) and **public Tokenization Key**
   (Collect.js).
4. Features enabled on the sandbox: **Customer Vault, Electronic Invoicing, Webhooks,
   Collect.js/tokenization** (same set we'll want in production).
5. Confirmation of our **API endpoint domain** (secure.nmi.com or their white-label domain).
6. Their **integration support contact** for questions during the build.
7. (Not needed for sandbox, flag for later: Tap to Pay partner-portal enablement + Application
   Identifier, and production keys at go-live.)

We provide our **webhook receiver URL** once the Cloud Function exists (it's created in
minutes; the URL is stable). Nothing else is needed from us for sandbox provisioning.

### D3. Compliance gap list — content Stuart must supply, app work we build

The portal/public site currently displays essentially NONE of the checklist. Before underwriting
review of the live checkout:

**Content from Stuart (text, one-time):** refund/return policy (full detail), terms &
conditions of sale, privacy policy (what's collected, how tracked, who it's shared with),
customer service phone #, business physical address + email for the footer, delivery time
standards ("ships in X weeks" custom vs stocked, UPS), country-of-origin line.

**App work (ours, part of the checkout build):** portal footer + policy pages; checkout screen
with T&Cs + refund-policy **click-to-accept checkbox**, card logos, USD statement, "SSL/TLS
secured" line, order-review step with cancel; same items on the hosted-invoice landing flow
where applicable; mirror on the public site if they answer yes to the E1 question.

---

## E. Build sequence once credentials arrive (proposed)

1. **UPS scratch function**: OAuth token + one CIE `Shop` rate call + one label + void → proves
   the pipe. **NMI scratch function**: demo-key sale + vault add + charge-by-vault + add_invoice
   → can start immediately.
2. **HQ UPS tab rebuild (9.5)**: live Rating behind the existing calculator UI + the settings
   panel (which services shown, negotiated/retail/markup display policy, default box mappings,
   per-brand shipper config) — this config gates what WMS sees.
3. **WMS Shipping tab**: prepopulated from pack (`packBoxes` → `standard_boxes` dims, item
   weights, `crm_records`/`customShippingAddress` address) → confirm address (XAV) → pick
   service → confirm weight → buy label → print → tracking # stamped on the order doc + queued
   to the NetSuite fulfillment via `ns_outbox` (reversing today's pull-from-NS direction).
4. **NMI**: payment-link on quote/SO documents → portal pay-on-account (vault) → webhook →
   NetSuite deposit/payment records → trade-show tap-to-pay app last.
