# SESSION BRIEF — CPQ ⇄ Vision ⇄ Quick Ship (tab 7) Integration

**Written:** 2026-07-24 (night), for a FRESH session · **Repo:** github.com/stuartganswb-jpg/ce-m2c-design-app · **Branch:** main
**Mission:** tighten the integration between the three quoting/ordering surfaces inside the app. The customer portal gets tied back in AFTER this (see §8).

---

## 1. The three surfaces as they stand today

| Surface | File | Tab | What it is |
|---|---|---|---|
| **Quick Ship** | `src/components/HQ/QuickShipTab.js` | HQ 7 | Stocked/pre-finished items → flat NetSuite **Sales Order** lines. No BOM, no flow. Pattern KITS (finish-code variants, kit-level pricing distributed across lines). Pushes direct, mirrors to `hq_sales_orders` (`orderClass:'QUICKSHIP'`). |
| **CPQ Configurator** | `src/components/HQ/CPQTab.js` | HQ 8 | Custom made-to-order: runs a `cpq_flows` doc, builds a cart with BOM/rollup, finalizes to **`jobs/{id}`**. NetSuite *Estimate* push happens later in ERPPushPull. |
| **Client Vision** | `ClientVisionTab.js` → `VisionHardware.js` / `VisionPillow.js` / `VisionLighting.js` | HQ 9 | Field/takeoff + engineering board (measure, bay math, bracket placement, cut sheet). Saves "lines" as **`cpq_drafts`** for CPQ to configure. |

### What already connects
- **Vision → CPQ (the only real seam):** all three Vision modules `setDoc(cpq_drafts/{draftId})` keyed by `masterQuoteId = activeSession.quoteId` (`VisionHardware.js:1146-1176`, `VisionPillow.js:232-246`, `VisionLighting.js:118-133`). CPQ listens (`CPQTab.js:626`) and lists them as **"Lines Awaiting Configuration"** (`CPQTab.js:2668-2690`). Operator clicks **Configure** → `handleResumeDraft` (`CPQTab.js:929-1049`) translates the Vision picks into `dynamicConfigParams`, then the operator still walks the flow and clicks Add to Cart. Draft is stamped `CONFIGURED` (`:1919`), deleted at finalize (`:2076-2081`).
- **Reopen paths:** `Shared/reopenQuote.js:20-54` → event `REOPEN_QUOTE_IN_CPQ` handled in `HQ.js:174-181` (localStorage `hq_global_cart` / `hq_active_quote_session` / `hq_reopen_quote` / `hq_vision_reopen`); CPQ restores at `CPQTab.js:596-618`. Fired from the CRM card (`ExternalCoopTab.js:1106-1107`).
- **One CRM card already shows both worlds:** ExternalCoopTab customer detail = "Active Pipeline" (`jobs`), **"Quick Ship Invoices"** (`hq_sales_orders` QUICKSHIP, `:1120-1125`), "Historical & Archived". So the *reporting* side is already unified; the *building* side is not.

### What does NOT connect (the actual work list)
1. **Quick Ship is an island.** `QuickShipTab` receives only `{currentUser, activeBrand}` (`HQ.js:420`) — no session, no `masterQuoteId`, no localStorage/event participation, no "Reopen in Quick Ship". A customer with a custom quote AND a stock cart has two unmergeable carts.
2. **Three independent customer pickers / three `crm_records` listeners** — `ClientVisionTab.js:12-45` (own combobox + own `activeSession` minted client-side at `:151-155,188`), `CPQTab.js:2639-2647` (native select), `QuickShipTab.js:436-453` (search box). No shared session in the HQ header (`HQ.js:331-363` is brand + operator only).
3. **`clientPricing` matching is forked:** QuickShip does a strict `===` on customerId (`:145`); CPQ normalizes case/whitespace via a Set (`CPQTab.js:1487-1488, 2309-2313`). **Same customer can price differently in the two tools** — treat as a real bug, not just duplication.
4. **CPQ has zero awareness of `isStocked`** (grep: no matches). Nothing offers stocked accessories inside a CPQ quote and nothing prevents double-selling a shelf SKU through both channels.
5. **LIGHTING drafts can never be resumed** — `handleResumeDraft` branches only on `PILLOW` and `HARDWARE`/no-category (`CPQTab.js:934-940`), so lighting drafts always hit the "Cannot resume draft" alert. Small, real bug.
6. **`cpqActiveItems` is a dead prop** on ClientVisionTab (`:54`, never passed, never read) — Vision cannot see the live CPQ cart.
7. **Duplicated NetSuite plumbing:** `BRAND_NETSUITE_MAP` verbatim in `QuickShipTab.js:8-13` and `ERPPushPullTab.js:9-13` (CLAUDE.md says keep all copies in sync); QuickShip pushes **synchronously** via `nsProxyFetch` (`:355`) while RTG/StockView/PickPack go through the **`ns_outbox`** staged-write worker. Under the ~5-call NetSuite concurrency ceiling the direct push is the odd one out.
8. Vision drafts carry rich `engineeringNotes` (cut lengths, saw angles, hanger locations, SVG) that ride to the shop — but nothing flows *back* from CPQ pricing/selection into Vision.

**Suggested framing for the work:** (a) one shared session/customer context in the HQ header that all three read; (b) one shared pricing/customer module so `clientPricing` can't fork; (c) let Quick Ship attach its lines to an existing `jobs`/quote instead of only standalone SOs; (d) let CPQ offer stocked accessories (`isStocked`) as add-on lines. Confirm priority order with Stuart before building — several of these are architectural.

---

## 2. Build / verify (no shortcuts here)

```bash
npx --no-install eslint <path>
```
**0 errors required** (pre-existing warnings are fine). Full sanity check, ~1-2 min:
```bash
CI=false npx --no-install react-scripts build
```

**You cannot verify in a browser preview.** HQ is PIN-gated and Firestore enforces App Check — a local preview cannot authenticate or read prod data. Verification = lint + build + Stuart testing on production. Do not burn turns trying to launch a dev server for this app.

---

## 3. Ship workflow (frontend auto-deploys)

Vercel builds **two projects** from every push to `main`: `ce-m2c-design-app` (CRA app, ~2.5 min) and `ce-client-portal` (Vite portal, ~10s).

```bash
rm -f .git/index.lock
git add <only your files> && git commit -q -m "…

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git pull --rebase --autostash origin main
git push origin main
```

**MULTI-SESSION GIT SAFETY — other Claude sessions work this repo simultaneously:**
- **Never** `git checkout <branch>` in the shared checkout (it races the other session's in-flight files; this once landed a commit on main unintentionally). Fix forward on main; use `git worktree` for big multi-commit work.
- **Never** `git add -A` — stage only files you touched.
- Always `git pull --rebase --autostash` before push.

After deploy: the in-app **UpdateBanner** (polls `version.json` every 4 min + on tab focus, commit `7d9054b`) offers a one-tap reload, so the ⌘⇧R ritual is mostly retired — but ⌘⇧R still works if Stuart is impatient.

---

## 4. Firebase Functions — Google Cloud Shell ONLY

Vercel does **not** deploy functions. Local `firebase login` fails on this Mac (localhost callback). Deploy from **shell.cloud.google.com**:

```bash
cd ~/ce-m2c-design-app && git pull && firebase deploy --only functions --project ce-m2c-design-collab
```
(or scope it: `--only functions:netsuiteProxy,functions:portalEngine…`; rules: `--only firestore:rules`.)

### ⚠️ PENDING DEPLOY BACKLOG — several function commits are believed NOT deployed
Verify and then just run one full `--only functions` deploy. Known pending (newest first):
- `130fe72` portalEngine numeric projection table (H2-RND `.75"` etc.)
- `9bf37c5` **portalEngine H2-RND family registration** (was missing entirely)
- `537d45f` **`custVisible`** — customer-restricted options dropped server-side (leak-safe gate; portal shows restricted options to everyone until deployed)
- `0de5c1a` anti-duplicate worker recovery (retry no longer reposts accepted NetSuite transactions)
- `8176ea5` / `a9c4994` / `4ed2dad` WO completion fixes (assemblyBuild target, single-bin, humanized memo marker)
- Portal BFF set from the portal session (`portalCatalog`, `portalFlow`, `portalResolve`, `portalQuoteRequest`, `portalMyOrders`, `reserveQuoteNo`) — confirm status with Stuart.

---

## 4b. APP-WIDE RULE — alias display (Stuart 2026-07-25)

> **Customer-facing forms ALWAYS show the alias, never the item it refers back to.
> Internal / ERP / shop-floor surfaces show the REAL item, with the alias in minor form.**

An Alias doc (`partClass: 'Alias'`, `aliasOf` → the real item, created in Visual Assembly) renders as its own node but IS the real item in the BOM. `H2-1BE` / `H2-1BS` alias back to `H1-1BE`: one physical part, two codes, sold under different product lines **at different prices**. The rule lives in `src/components/Shared/aliasIdentity.js` — put new alias logic there, don't re-derive it.

| Surface | Shows | Note |
|---|---|---|
| CPQ quote / configurator | alias | free — options point at the alias doc, nothing dereferences |
| Portal (`portalEngine`) | alias | free, same reason — no functions change was needed |
| Quick Ship cart / SO description / invoice | alias + alias **price** | which alias = the one carrying the scoped collection; captured at add time |
| NetSuite estimate line | alias in the **description** | item id stays the real part (ERPPushPull swaps for stock/BOM) |
| WMS pick table / pack rows | real code, `alias …` in 9px | `printItemLabels` barcodes the REAL code — never the alias |
| `hq_sales_orders.lines[].erp` | real code | `aliasErp` rides alongside for display |

Pricing guard: an alias supplies the rate only when it actually has one (> 0); otherwise the line falls back to the real item, so an unpriced alias can never silently zero a line.

## 5. Hard constraints

- **Firestore enforces App Check** → no local/Node script can read or write production data (permission-denied). Bulk data changes must be done **inside the authenticated app** — build an admin button, never a script.
- **NetSuite diagnosis:** the old unauthenticated SuiteQL curl to the proxy is DEAD (App Check). Use the RTG "NetSuite Transmit Log" (click a row = full error + sent payload), HQ 11.1 → NetSuite Sync Queue, or ask Stuart for a screenshot.
- **All NetSuite calls go through `Shared/nsProxy.js` `nsProxyFetch(body)`** — never raw fetch.
- **NetSuite concurrency ~5 account-wide.** Proxy gates at 4 concurrent + FIFO queue; the `ns_outbox` worker takes 1. Adding a new synchronous push path can starve the account.
- **Super admin:** normalize roles so `superadmin` reaches inner `['admin','programmer']` gates (historically excluded).
- **Brand → NetSuite map** duplicated in PickPackApp / NetSuiteSync / ERPPushPull / AdminTab / QuickShipTab — keep every copy in sync: `m2c`=sub3/loc19, `ce`=sub2/loc17, `uniquity`=sub6/loc20, `leyla`=sub5/loc18.

---

## 6. ⚠️ Watch-outs that have burned us

1. **The Vercel stale-build trap (2026-07-22 incident).** A deploy can read "Ready" with the correct commit hash and a fresh `version.json` and still serve OLD code — Vercel compiled a stale checkout; prod cycled through 4 stale bundles in one evening. **Pushing more commits does not fix it.** Fix: Vercel dashboard → ce-m2c-design-app → Deployments → top row ⋯ → **Redeploy with "Use existing Build Cache" UNCHECKED**. Before debugging any "my change did nothing" report, grep the live bundle:
   ```bash
   curl -sL https://www.4cosworkcenter.com/ | grep -o 'static/js/main\.[a-z0-9]*\.js'
   ```
   then download that file and `LC_ALL=C grep -c '<a unique NEW STRING from your commit>'`.
2. **Grep for STRING LITERALS only when verifying a deploy.** Identifiers minify away — grepping a function name produced a false "not deployed" alarm and wasted a cycle.
3. **Don't trust a theory over the user's screen.** A "junk library item" theory cost a cycle when Stuart had already proven the library search was empty (they were stale pins). When he says the data isn't there, it isn't there.
4. **Curl a big bundle to a FILE** — huge minified JS breaks zsh variables.
5. **Two sessions, one repo:** re-grep exact anchor text before an Edit; another session may have changed `const`→`let` or moved the block since you read it.
6. **Fee/qty/push rules are subtle** — qty-0 steps skip push except `hideQty`+selected; discounted quotes scale item rates so the estimate equals the quoted total (rollup absorbs rounding). Read `cpq-netsuite-push-model` memory before touching `resolveJobLines`.

---

## 7. Recent context you must not break (the last 48h of work)

**H2 Simple Elegance pivoted to per-assembly flows** (2026-07-24). Instead of one combined flow with a size matrix, there are now **four single-assembly flows** (H2-05/75/1/138) that combine only at a **CPQ landing** ("pick rod diameter first"), stamped `singleAssembly` + `sizeGroupLabel/Choice/Sort`. Projections come from `proj:` tags on pins: a `PROJ_SELECT` step when 2+ distinct tags exist, `flow.impliedProjInches` when exactly 1. Brackets match their tag exactly; return-type fee options treat the tag as a **minimum**.

**Vision was taught this model tonight** (commit `0fcc583`): grouped flow picker (optgroup per collection, one entry per diameter), `PROJ_SELECT` rendered beside the SIZE steps, `flowProjSel`/`projTagOk` copied verbatim from CPQTab gating all three option pools, a stale-pick sweep, and flow stamps seeding Pole Dia + Projection. **Every one of those changes is gated on stamps that only 🎯 single-assembly flows carry — Fabricut/legacy behavior is identical.** Keep it that way.

**Fabricut H1 still runs the combined size-matrix flow and is LIVE with the pricing/customer-part# machinery.** Migration plan (not started): `FABRICUT_MIGRATION_BRIEF.md`, task #9. **Hard rule: never add a `codeRx` to the H1 family while the combined flow is live** — it would activate sizeKey grammar/union/review-gate on a working flow.

Also live and adjacent: spec sheets (`SpecSheet/SpecSheetModal.js`, unit auto-normalize + per-assembly opened cell, commit `0cbc60f`).

---

## 8. The customer portal (the thing we tie back in next)

> **Bringing Vision / Quick Ship INTO the portal? → `PORTAL_VISION_QUICKSHIP_BRIEF.md`** — written 2026-07-25 for a dedicated portal session: the six Quick Ship predicates, the pack invariant, entitlement via `portalCollections`, what rides free vs what must be mirrored, and the scope questions to settle before building.

**portal.classicalelements.com** — a separate Vite app in `portal/`, its own Vercel project (root = `portal/`), auth + functions SDK only. It **never imports CPQTab**; it reads the same Firestore through BFF functions and runs **hand-ported** logic. Full contract: `PORTAL_CPQ_CONTRACT_BRIEF.md`.

**The rule of thumb:** DATA rides free (flows, options, prices, finishes, items, GLBs, clientPricing, portalFlowIds). **LOGIC/SCHEMA must be mirrored** in five places:
- `functions/portalEngine.js` (pricing memo + sizeMatrix + priceLevels port)
- `functions/index.js sanitizeStep()` (step-field whitelist — this whitelist is the ONLY reason new internal fields don't leak)
- `portal/src/cpqRender.jsx` (DynamicModel + studioScene port)
- `portal/src/Configurator.jsx` (override builders + return/bracket rules)
- `portal/src/shared/{sizeMatrix,priceLevels}.js` (verbatim copies — `cp` them in the same commit and diff them)

**Entitlement model:** `crm_records.portalFlowIds` (checkboxes in the CRM Portal Access panel) controls everything a customer can see. Customer tokens are denied on ALL Firestore + Storage by rules (`isAuth()` excludes `customer` claims) — the portal only ever sees BFF output. Price level per customer via `crm_records.portalPriceLevel` (FAB_COST is excluded server-side and must never be exposed).

**Portal-side standing gaps to carry into the integration work:**
- H2 is **held from the portal** until `partAllowedAtSize`/`PROJ_SELECT`/the landing are mirrored client-side.
- Wall-mount auto-lines (`11ebeed`) are not in portalEngine → portal quotes omit those BOM lines.
- Phase B two-part finials will need a full mirror (new mechanism).
- `custVisible` needs the Cloud Shell deploy to actually gate customer-restricted options.
- Portal has no deploy-refresh banner (the stamp is CRA-only).

**If the CPQ/Vision/QuickShip integration adds a new step type, field, pricing rule, or shared-module change → say "portal mirror needed" and note it here.** That is exactly how divergence has been avoided so far.

### ⚠️ PORTAL MIRROR OWED — Quick Ship collections + pack units (2026-07-25, app side shipped)
The app now carries three things the portal does not. **All are data-only on the app side today; the portal ignores them until mirrored, so nothing leaks and nothing breaks — the portal simply won't honor them.**

1. ~~**`crm_records.portalCollections`**~~ — **MIRRORED 2026-07-25**, needs the Cloud Shell deploy to take effect. `functions/index.js` gained `collectionsOfAsm` / `collectionGateOf` / `assertCollectionAllowed` and enforces the gate at all four portal entry points: `portalCatalog` (drops non-allowed items, returns `reason:'NO_COLLECTIONS'` when the filter empties an otherwise-populated showroom), `portalFlow`, `portalQuoteRequest`, `portalResolve` (all deny with the same message as the flow-id check, so the error can't be used to probe which flows exist). Empty array = no restriction *and zero extra Firestore reads*. The gate is STRICT for restricted customers: an assembly with no collection tag is not visible. `sanitizeStep()` needed no change — `portalCollections` is a CRM field, not a step field — and `portal/src/` needed no change, because the BFF simply stops returning the items.
2. **Pack selling units** — `crm_records.{qsRingPack,qsFinialPack,qsInsideMountPack}` + `manufacturingSpecs.quickShipUom` + master list `quickShipUom`. Logic lives in `src/components/Shared/quickShipUom.js` (`packSizeOf` / `packUnitFor` / `isRealPack`). If the portal ever gets a stock counter, that file is a **verbatim copy** candidate alongside `sizeMatrix`/`priceLevels`. Invariant to preserve everywhere: **qty means PACKS, `rate` is per EACH, and NetSuite + pick/pack always receive the each count** (`qty × packSize`).
3. **Rush fees** — master list `rushFeeTypes`, amount parsed from the entry (`"RUSH 3 DAY - 75"`) by `rushFeeAmountOf`. Quick Ship only; no portal exposure yet.

`Shared/clientPricing.js` (the unified per-customer price matcher) needs **no** mirror — the portal prices off `portalPriceLevel`, and `clientPricing` appears nowhere in `functions/` or `portal/`.

---

## 9. Suggested first moves for the new session

1. Ask Stuart which integration he actually wants first — the likely candidates are (a) shared customer/session across all three tabs, (b) Quick Ship lines attachable to a CPQ quote/job, (c) stocked accessories offered inside CPQ, (d) unify `clientPricing` matching. These have very different blast radii.
2. Cheap wins available immediately regardless: the LIGHTING resume branch (`CPQTab.js:934-940`) and the forked `clientPricing` match (`QuickShipTab.js:145`).
3. Before any shared-module refactor, remember the portal mirror list in §8 — a shared pricing helper on the app side may need a matching change in `functions/portalEngine.js`.
4. Confirm the Cloud Shell backlog (§4) is cleared; several *already-shipped* behaviors are dormant until it is.

**Memory files worth reading first:** `quick-ship-stocked-items`, `cpq-netsuite-push-model`, `crm-quote-features`, `portal-cpq-contract`, `cpq-bay-fab-linkage`, `h2-simple-elegance-flow`, `vercel-deploy-pipeline`.
