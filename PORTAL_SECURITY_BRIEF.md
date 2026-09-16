# BRIEF — App Security Hardening + Customer Portal

> Paste this whole file as the first message of a NEW Claude session in
> `/Users/stuartgansmba/Projects/ce-m2c-design-app`. It is self-contained. The main session stays
> on CPQ/flow/spec work — do not pull it into this scope.

## Mission (two tracks, in order)

1. **SECURITY HARDENING** of the existing app — verified findings below; audit, then fix.
2. **CUSTOMER PORTAL** — expose selected app capabilities to CE/M2C/Uniquity customers, hosted so
   Stuart can link to it from the brand websites (classicalelements.com / m2cstudio.com /
   uniquitystyle.com). Design first, confirm scope with Stuart, then build.

## Architecture map (verified)

- React CRA at **4cosworkcenter.com** (Vercel, auto-deploys on push to `main`). Firebase project
  **ce-m2c-design-collab**: Firestore (+ **App Check/reCAPTCHA enforced** — no local scripts can
  touch prod data; bulk ops must be in-app admin buttons), Storage, Cloud Functions.
- Routes (`src/App.js`): `/` landing hub, `/hq` (the big HQ app, ~20 tabs), `/shop-floor`,
  `/finishing-floor`, `/pick-pack`. All PIN-gated per app.
- **Auth model**: `authenticatePin` callable (functions/index.js) — `enforceAppCheck: true`,
  rate-limited via hashed-PIN docs in `security_logs`, mints a custom token with a `role` claim;
  client `signInWithCustomToken`. Users live in `hq_users` (role, superAdmin flag, PIN). Per-app
  tab permissions in `fin_config/permissions` and similar. Session marker in localStorage
  (`hq_session`).
- **Firestore rules** (`firestore.rules`, in-repo): a `superadmin_vault` (role claim gated), a
  server-only `security_logs`, and then essentially **`allow read, write: if isAuth()` on every
  collection** — any authenticated PIN user can read/write everything, including `hq_users`
  (PINs) and all pricing.
- **NetSuite**: all ERP traffic goes through the `netsuiteProxy` Cloud Function
  (`https://netsuiteproxy-f3h3jadzaq-uc.a.run.app`) which OAuth-signs requests with server-held
  secrets. NetSuite account 3728153.
- **Functions deploys are NOT automatic**: deploy from Google Cloud Shell
  (`git pull && firebase deploy --only functions:<name> --project ce-m2c-design-collab`).
  Local `firebase login` fails on this Mac. Rules deploys: `firebase deploy --only firestore:rules`
  same way (or console).

## Verified security findings (start here — re-verify, then fix)

1. **CRITICAL — `netsuiteProxy` is an open relay.** `onRequest({ cors: true })`, no App Check, no
   auth token verification, no allow-list: anyone with the URL can send arbitrary
   `{targetUrl, method, payload}` and it will OAuth-sign and execute against NetSuite (reads AND
   writes: estimates, POs, inventory adjustments). Fix candidates: `enforceAppCheck` on an onCall
   version, or verify a Firebase ID token + App Check header on the onRequest, plus a targetUrl
   allow-list (only `3728153.suitetalk.api.netsuite.com`). NOTE: ~15 call sites across the app all
   use plain `fetch(FIREBASE_FUNCTION_URL, ...)` — migrating them is part of the fix; coordinate
   the constant in one shared helper. Functions deploy = Cloud Shell.
2. **HIGH — flat `isAuth()` rules.** Every authenticated user (any floor operator PIN) can read
   costs, Fabricut pricing, all customers, all quotes, and can write any collection. Move toward
   role-claim-based rules (claims already exist on the token) with deny-by-default for new
   surfaces. Be careful: the apps genuinely share many collections — audit usage before
   tightening each one (breaking the floor apps is worse than the status quo; stage collection by
   collection).
3. **HIGH — `hq_users` (with PINs) readable/writable by all authed users.** Several apps join it
   client-side (name/role lookups). Consider a sanitized `directory` projection for client joins
   and locking `hq_users` to admin-role claims.
4. **MEDIUM — hardcoded super PIN** in `src/components/FinishingFloor/FinishingFloor.js`
   (`if (pinInput === "1032")` grants all tabs client-side). Remove; rely on the role claim.
5. **MEDIUM — Storage rules unknown**: `global_assets` (hi-res product photography is deliberately
   watermarked — implies public exposure is a known concern), `spec_glbs/`, prints, CAD files.
   Audit read rules; spec GLBs and prints are IP.
6. Review CORS/App Check on any other callable; review Vercel headers (CSP is likely absent).

## Customer portal — scope candidates & constraints

**What Stuart wants**: take "certain aspects of the app" customer-facing, hosted off the brand
websites with links back. Confirm exact scope with him before building; the natural candidates,
in rough priority order, from what already exists:

- **Customer-facing CPQ/quote builder** — the groundwork exists on purpose: the Fabricut PRICE
  LEVELS (`src/components/Shared/priceLevels.js`, quote-DISPLAY only) were built for exactly this
  ("customer facing will only generate quotes in app; when we push into NetSuite it is always at
  our selling price"). Flows live in `cpq_flows`; size matrix in `Shared/sizeMatrix.js`; 3D GLBs
  render via three.js. A portal configurator should be a SLIM new build consuming that data — do
  not fork the 4000-line internal CPQTab.
- **Order/quote status tracking** — `jobs` (quotes), `hq_sales_orders` → shop/finishing stage
  rollup (RTG Dispatch's `dailyJobs` merge shows the shape).
- **Spec sheets** — the SpecSheet module already prints a "Fabricut codes" edition; per-customer
  code/pricing surfaces exist (`clientPricing` rows per item with client SKUs).
- **Asset gallery** — `global_assets` are watermarked with hi-res + thumbs.
- **Sample chip requests** — `sample_chip_orders` intake could take customer submissions.

**Hard data-safety rules for anything customer-visible (non-negotiable):**
- NEVER expose: `manufacturingSpecs.cost` (vendor cost), `fabricut.cost` (CE→Fabricut price),
  other customers' `clientPricing` rows or identities, vendor names/POs, margins, NetSuite ids,
  internal notes, or the NetSuite proxy.
- A customer sees ONLY their own records: identity anchored to `crm_records` (`CUST-<netsuite id>`,
  synced; carries shippingAddresses, billingAddress, discountCode) and quotes whose
  `customer.id` matches.
- Pricing shown = their level: `clientPricing` rows (STANDARD) or the Fabricut retail/wholesale
  levels — never cost tiers.

**Architecture recommendation to evaluate first** (given finding #2, the flat rules): do NOT put
customer accounts in the same auth realm as staff PINs against today's rules — any authed user
can read everything. Two viable shapes:
- **BFF pattern (recommended)**: portal is a separate lightweight frontend (subdomain, e.g.
  portal.classicalelements.com — Vercel handles multi-domain); customers authenticate with
  Firebase email auth carrying a `customerId` custom claim; ALL data access goes through new
  Cloud Functions that shape sanitized payloads (catalog, own-quotes, own-orders). Firestore rules
  simply deny `role == 'customer'` everywhere. Sensitive shaping lives server-side.
- Direct-Firestore portal with a full deny-by-default rules rewrite — bigger blast radius on the
  internal apps; only choose with a staged migration plan.
- Brand theming for the portal exists: `hq_config/brand_logos`, form templates + per-brand footer
  contact blocks (see `Shared/FormPreview.js` COMPANY_ADDRESS/BRAND_CONTACT).

## Ground rules (multi-session repo — non-negotiable)

- **Never `git checkout`/switch branches** in this checkout. Small fixes = fix-forward on `main`;
  bigger portal work = a **`git worktree`** (safe) or new directories on main. Stage ONLY files
  you changed; always `rm -f .git/index.lock` then `git pull --rebase --autostash origin main`
  before push. Lint each touched file: `npx --no-install eslint <path>` → 0 errors.
- **Do not modify** the main session's active surfaces except surgically for security fixes:
  `HQ/CPQTab.js`, `HQ/AdminTab.js`, `SpecSheet/*`, `Shared/sizeMatrix.js`,
  `Shared/fabricutImport.js`, `Shared/priceLevels.js`, `HQ/StockViewTab.js`,
  `PickPack/PickPackApp.js`, floors. The proxy-auth migration WILL touch many files (the fetch
  helper) — keep that change mechanical and isolated in its own commit.
- Portal code goes in its own area (`src/portal/...` + new routes, or a separate app folder —
  propose to Stuart). Functions/rules changes deploy via Cloud Shell — tell Stuart exactly what
  to run there each time.
- Firestore has App Check: any data backfill must be an in-app admin action, not a script.

## Suggested phasing (present to Stuart before coding)

1. Security audit report (verify findings above + storage rules + anything new) with a ranked fix
   list — cheap fixes first (proxy auth, hardcoded PIN, hq_users projection).
2. Proxy lockdown + shared authenticated fetch helper (one mechanical migration commit).
3. Rules migration plan, staged per collection, with floor-app regression checks after each.
4. Portal scope confirmation with Stuart (which of the candidates, which brands first, auth UX),
   then BFF endpoints + slim portal frontend, brand-themed, linked from the websites.

Start by reading: `functions/index.js`, `firestore.rules`, `src/App.js`, `src/firebase.js`,
`Shared/priceLevels.js`, and one floor app's PIN flow — then deliver the audit + portal proposal
before writing feature code.
