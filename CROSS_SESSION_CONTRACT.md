# Cross-session contract — three Claude sessions, one repo, 2026-08-07

Three sessions work this repo in parallel. This file is the shared truth they all read; each
session also has its own brief. **If a fact here conflicts with a session brief, this file wins —
update it, not around it.**

| Session | Brief | Territory |
|---|---|---|
| **A — Portal / CPQ integration** | `PORTAL_CPQ_SESSION_BRIEF.md` | `portal/`, portal Cloud Functions (`portal*` exports in `functions/index.js`, `functions/portalEngine.js`, `functions/portalRequestLines.js`), `ExternalCoopTab.js`, `FormPreview.js`, Quick Ship tab 7, CRM quote/SO surfaces |
| **B — Floors / WMS** | `FLOORS_WMS_HANDOFF_BRIEF.md` | FinishingFloor, ShopFloor, PickPack, RTGDispatchTab, NetSuiteSyncTab, `onStockBuildDone`, the floor/WMS `Shared/*` modules, `netsuite/ce_convert_build_restlet.js` |
| **C — Traverse / Vision** | `TRAVERSE_HANDOFF_BRIEF.md` | `traverseTags.js`, `traverseFlow.js`, `AssemblyBuilderTab.js` (1.6), `AdminTab.js` (flow generator), `CPQTab.js`, `assemblyTags.js`, Vision Hardware |

**If your bug traces into another session's territory: stop, report, let Stuart route it.**
Shared modules read by CPQ (`plateRules`, `sizeMatrix*`, `finishLabel`, `configQty`) are Session C's
to change; everyone else treats them as read-only.

## The one product rule (Stuart, 2026-08-07)

> The Fabricut H1 flow will still get **small changes**, as will the others — but the
> **fundamental flows will not change**. Data must flow **seamlessly** from CPQ / Vision / Portal
> back to HQ, and quotes / sales orders / Quick Ship must stay **true to each other**.

Practical consequences:
- **Don't hardcode against flow details** (step ids, option lists, specific codes) — flows will
  shift under you. Resolve through the flow doc / library / finishes list at read time.
- **A number shown in two places must come from ONE place.** The `jobs` doc
  (`cpqData.cartItems` + `cpqData.breakdown` + `totalPrice`) is the spine a quote lives on;
  portal cards, CRM docs, SO push, and Quick Ship all derive from it. Never re-derive a price in
  a second engine "close enough" to the first.
- **An unpriced PORTAL_REQUEST has no breakdown BY DESIGN** (staff price it in CPQ). Every
  renderer must handle that shape honestly — never invent lines or totals for it
  (see the 2026-08-07 FormPreview sample-data incident, commit `c007153`).
- **A screen shared by several flows is extended by ADDING, never by editing.** Stuart,
  2026-08-08, on Vision Hardware: *"it is imperative we do not alter how it works, we create a
  separate flow or tool add on but this screen is tied into several cpq flows that all function and
  i do not want to break any existing connections or logic."* The pattern: put the new grammar in
  its own module and give the shared screen **one guarded mount** (`{isXFlow && <XPanel/>}`), then
  **prove** the rest is untouched with `git diff -w` — one addition, nothing else. Same proof that
  showed the pole generator was byte-identical after the traverse fork (`6fce5af`). A new tab is the
  fallback, not the default: one screen, auditable footprint.

## Mirror pairs — change BOTH or change NEITHER

Two runtimes can't import each other (CRA only reads `src/`, Functions deploy only ships
`functions/`, the portal Vite app only reads `portal/`). These are deliberate copies:

| One side | Other side | Parity check |
|---|---|---|
| `src/components/Shared/portalRequestLines.js` | `functions/portalRequestLines.js` | node parity test (scratchpad) asserts identical output |
| `Shared/sizeMatrix.js` + `Shared/priceLevels.js` + CPQTab pricing memo | `functions/portalEngine.js` (CJS port) | keep in sync by hand — comment headers say so |
| CPQ logic/schema surfaces | `portal/src/shared/*` (5-file mirror) | see memory `portal-cpq-contract` |
| `BRAND_NETSUITE_MAP` | duplicated in PickPackApp / NetSuiteSync / ERPPushPull / AdminTab | keep all copies in sync |

## Deploy matrix — what ships when you push

| Surface | How | Notes |
|---|---|---|
| Frontend (`src/`) | **auto** — Vercel on push to main (~2 min) | hard-refresh ⌘⇧R after |
| Portal (`portal/`) | **auto** — second Vercel project (~10 s) | |
| Cloud Functions | **manual** — Cloud Shell only | `cd ~/ce-m2c-design-app && git pull origin main && firebase deploy --only functions:<names> --project ce-m2c-design-collab` — read the pull output |
| NetSuite RESTlet | **manual** — File Cabinet → SuiteScripts, replace the file | no deploy ships it |

**⚠ PENDING MANUAL DEPLOYS (as of 2026-08-09):**
1. `netsuite/ce_convert_build_restlet.js` @ `26dd4e5` — the cancelLine fix. WMS phosphate convert
   still fails on Phosphating-last BOMs until Stuart replaces the file in NetSuite.
2. `firebase deploy --only functions:portalMyOrders,functions:portalResolve,functions:portalQuoteRequest,functions:portalVisionDraft,functions:portalStockQuoteRequest`
   — ONE deploy covers both pending changesets: `c007153` (portal card finish names + checkout fee
   part#; raw FIN-ids until it runs) AND the 2026-08-09 quote-author stamp (`createdBy`/`author` on
   portal-created jobs docs; `by` in the portalMyOrders quote payload — "Requested by" on portal
   cards stays blank on new requests until deployed; CRM falls back to `portalRequest.byEmail`).

## 2026-08-08 weekend sprint — cross-territory changes, Stuart-authorized

Sessions B and C were idle; Stuart had Session A implement the H1 playbook
(`H1_COLLECTION_LOAD_PLAYBOOK.md`) across territories. **If you are Session B or C, read your
brief's addendum before touching these areas** — the following changed under you:

| Commit | Change | Territory touched |
|---|---|---|
| `dcd2d63` | ONE clientPricing matcher everywhere (ERP push / RTG pick / onboarding export now use `Shared/clientPricing.js` like CPQ; ERP push inherits the price-0-falls-to-base rule) | B (RTG), shared |
| `7e26cc6` | Spec sheets: geometry-vs-cell warnings (`SpecSheet/specCellCheck.js`), cell coverage chips, `fabCodeFor` unified with `priceLevels.fabricutCodeOf`, registry pins load by doc id AND itemId | spec module |
| `c36db6f` | Collection Readiness Board (`Shared/collectionReadiness.js` + `HQ/CollectionReadinessBoard.js`, 🧭 button in BOM Engine) — read-only | BOM Engine |
| `6715b03` | 1.6 hardening: Fusion match-rate gate, export flavor seeds from slot, fork guard on new build, `pinIdFor` on the build path, duplicate-slot warning on Extend — gates and seeds only, no write shapes changed | **C (1.6)** |

## Git — multi-session safety (live, not theoretical)

- **NEVER `git checkout <branch>`** in the shared checkout. Fix-forward on main; use a
  `git worktree` for multi-commit work.
- **NEVER `git stash`** the shared tree — it sweeps every session's uncommitted edits at once
  (a Session A slip on 2026-08-07 briefly stashed live work; recovered, don't repeat it).
- Stage ONLY files you changed (never `git add -A`). Always `git pull --rebase --autostash`
  before push. `rm -f .git/index.lock` first.

## Verification constraints (all sessions)

- Firestore enforces **App Check**; the apps are behind a **PIN gate** → no scripts against prod
  data, no browser harness. **Pure `Shared/*` modules + `node --test` is the verification path.**
- Prod bundle checks: the app is CODE-SPLIT — sweep every chunk map, plain-ASCII markers
  (see FLOORS brief §"Verifying what prod actually serves").
