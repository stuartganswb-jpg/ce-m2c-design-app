# Stock View (HQ 12.5) — Three-Scenario Redesign

**Spec'd:** 2026-07-28 from Stuart's description · **Updated:** 2026-07-28 (scenario 3 shipped)
**Status:** Scenarios 2 + 3 SHIPPED · scenario 1 auto-release is the next build · two smaller items queued behind it
**Files:** `src/components/HQ/StockViewTab.js` (~2600 ln), `src/components/HQ/RTGDispatchTab.js` (1579 ln), `src/components/PickPack/PickPackApp.js` (CONVERT tab ~2800), `firestore.rules`

---

# PART 1 — SETUP & GROUND RULES (read before touching anything)

## Build / verify

```bash
npx --no-install eslint <path>
```
**0 errors required.** Pre-existing warnings are fine — `StockViewTab.js` sits at 2 (`successCount`, `base`); if you see more than that, they're yours.

```bash
CI=false npx --no-install react-scripts build
```
Slow (~1–2 min) but it's the real gate. Run it before every push.

**You cannot verify in a browser preview.** HQ is PIN-gated and Firestore enforces App Check, so a local dev server can neither authenticate nor read production data. Verification = lint + build + Stuart testing on prod. Don't burn turns trying to launch a preview for this app.

## Ship workflow (frontend auto-deploys)

Every push to `main` builds **two** Vercel projects: `ce-m2c-design-app` (CRA app, ~2.5 min) and `ce-client-portal` (Vite portal, ~10s). Dashboard: vercel.com/m2-c-ce-design-app.

```bash
rm -f .git/index.lock
git add <only your files> && git commit -q -m "…

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git pull --rebase --autostash origin main
git push origin main
```

**MULTI-SESSION GIT SAFETY — other Claude sessions work this repo at the same time:**
- **Never** `git checkout <branch>` in the shared checkout — it races the other session's in-flight files (this once landed a commit on main unintentionally). Fix forward on main; use a `git worktree` for big multi-commit work.
- **Never** `git add -A` — stage only files you touched.
- Always `git pull --rebase --autostash` before pushing.
- Re-grep an exact anchor before an Edit; another session may have changed the line since you read it.

After deploy the in-app **UpdateBanner** (polls `version.json` every 4 min and on tab focus) offers a one-tap reload — the ⌘⇧R ritual is mostly retired.

**⚠ Stale-build trap (2026-07-22 incident):** a deploy can read "Ready" with the right commit hash and a fresh `version.json` and still serve OLD code (Vercel compiled a stale checkout; prod cycled 4 stale bundles in one evening). **Pushing more commits does not fix it.** Fix: Vercel dashboard → ce-m2c-design-app → Deployments → top row ⋯ → **Redeploy with "Use existing Build Cache" UNCHECKED**. Before debugging any "my change did nothing" report, grep the live bundle:
```bash
curl -sL https://www.4cosworkcenter.com/ | grep -o 'static/js/main\.[a-z0-9]*\.js'
```
Download that file, then `LC_ALL=C grep -c '<a unique NEW STRING from your commit>'`. **Grep string literals only** — identifiers minify away and produce false "not deployed" alarms. Curl to a FILE first; huge minified JS breaks zsh variables. Note the app is **code-split**: lazy-loaded tab code (Stock View included) never appears in `main.*.js` — extract the chunk maps and grep `static/js/<id>.<hash>.chunk.js` instead.

## Firebase Functions — Google Cloud Shell ONLY

Vercel does **not** deploy functions. Local `firebase login` fails on this Mac (localhost callback). Deploy from **shell.cloud.google.com**:

```bash
cd ~/ce-m2c-design-app && git pull && firebase deploy --only functions --project ce-m2c-design-collab
```
Rules: `--only firestore:rules`. Scope functions with `--only functions:name1,functions:name2`.

**⚠ Cloud Shell credentials expire mid-deploy (learned 2026-07-28).** A full-codebase deploy runs past the ~1 hour token life; the functions deployed after expiry fail with **"Failed to authenticate, have you run firebase login?"** — which looks like a quota or code error and is neither. The failure is positional: everything after the token dies fails. A failed *update* leaves the previous version running, so nothing breaks — it's just stale.
```bash
firebase login --reauth --no-localhost      # then deploy in batches of 4–5
```
`gcloud` does NOT share the Firebase CLI's credential — `gcloud functions list` will error with "no active account" even when deploys work fine. Use `firebase functions:list` instead.

**As of 2026-07-28 the functions backlog is CLEAR** — netsuiteProxy, the portal BFF set, reserveQuoteNo, the staff-login callables and the WO-completion fixes are all deployed.

## Hard constraints

- **Firestore enforces App Check** → no local/Node script can read or write production data. Bulk data changes must be made **inside the authenticated app** (build an admin button), never via a script.
- **All NetSuite calls go through `Shared/nsProxy.js` `nsProxyFetch(body)`** — never raw fetch. The old unauthenticated curl-to-proxy diagnosis path is dead (App Check).
- **NetSuite concurrency is ~5 account-wide.** The proxy gates at 4 + FIFO queue; the `ns_outbox` worker takes 1. **Everything Stock View creates must stage through RTG** so the outbox serializes the NetSuite writes — do not add a new synchronous push path.
- **Diagnosis paths** (no curl): RTG "NetSuite Transmit Log" (click a row = full error + sent payload), HQ 11.1 → NetSuite Sync Queue, or ask Stuart for a screenshot.
- **`BRAND_NETSUITE_MAP`** is duplicated in PickPackApp / NetSuiteSync / ERPPushPull / AdminTab / QuickShipTab — keep copies in sync: `m2c`=sub3/loc19, `ce`=sub2/loc17, `uniquity`=sub6/loc20, `leyla`=sub5/loc18.
- **Super admin** must be included in inner `['admin','programmer']` gates (historically excluded). Role normalizer pattern: `String(role).toLowerCase().replace(/[^a-z]/g,'')` + honor `user.superAdmin === true`.

## Working style that has held up

- Don't trust a theory over what Stuart sees on screen. When he says the data isn't there, it isn't.
- Derive routing from item data; never ask the operator a question the data can answer.
- Prefer moving work PO → WO when a rule is ambiguous: a WO parks in RTG for review, a wrong PO is a real purchase.

---

# PART 2 — THE THREE SCENARIOS

## The principle

The Sales Snapshot popup is the model — Stuart likes how it reads and wants **all** replenishment to run through that shape. The main 12.5 grid's push path (`pushPOsToDispatch`, `pushWOsToDispatch`) is the "old and clunky" one: it makes the operator choose Finishing-vs-Shop by hand. **Routing is derived from what the item IS, not asked.**

## Scenario 1 — Finished assemblies (`HAFICBR1S/CP`) — ✅ mostly built

Stocked *complete* in bins, pulled and shipped.

**Today:** Snapshot FINISHED view → Order qty → `⚙ Generate Orders` → `createStockFinWOs` writes `hq_work_orders` with `source:'SALES_SNAPSHOT'`, `routeTo:'FINISHING'` and a complete pre-built `finPayload` parked for RTG.

**Remaining:** RTG **auto-releases** these to the Finishing Floor instead of waiting for a manual "Push to Finishing" click, and logs it.
**Stuart's decision (2026-07-28):** scope auto-release to **stock replenishment only** — `source === 'SALES_SNAPSHOT'` + `type === 'Stock'`. Customer/custom work keeps its manual review gate (that gate was added deliberately on 2026-07-16). Note auto-release does not itself reduce NetSuite concurrency — `ns_outbox` is what serializes writes; the win is one less click and a centralized log.

## Scenario 2 — Raw cores / BOM bases (`HAFICBR1S`) — ✅ CORE SHIPPED

**Shipped 2026-07-28** (`82f2150`, `19cf51c`, `c343095`):
- `rawCoreGroups` / `rawInfoOf` / `rawOrderRows` hoisted to component scope — the table and the generator read one source of truth (they used to live inside the render, which is exactly why ordering was impossible from this view).
- **Order column** in the Raw Cores view; `⚙ Generate Core Orders (PO + WO)` replaces the disabled button.
- **Routing:** an **assembly is BUILT here** (`partClass` Assembly / Master Assembly / `netSuiteRecordType === 'assemblyitem'`) → shop WO, whatever `isInHouse` says. Otherwise outsourced-or-vendored → PO candidate; everything else → shop WO. This mirrors the file's own `isOutsourced` rule (`isInHouse === false && vendor && !isAssembly`) — **do not diverge from it again**, that was the H2-138LBE bug.
- **`createStockShopWOs`** writes `hq_work_orders` with `routeTo:'SHOP'`. No payload is pre-baked: RTG's `pushToShop` builds the shop doc itself (`routeTo: MILLING` for stock) — unlike the finishing path, which parks a verbatim `finPayload`.
- **Vendor confirmation modal**: stored vendor is a DEFAULT only; picker of NetSuite-synced vendors; per-row "⚒ Make in-house instead" → shop floor; `UNRESOLVED` flag on any name that can't become a PO; live count of how many POs the batch collapses to. `createStockPOs` groups on the CONFIRMED name (`x.vendorOverride`).
- **Routing chips** on every raw row so the destination is visible before generating: `ASM → WO` (green), `VENDOR → PO` (blue), `NO VENDOR` (red — flagged outsourced but unbuyable), plain `WO`.
- **Snapshot filters**: category + collection added; one `snapRowOk` predicate now feeds the Finished table AND the raw rollup (the rollup previously read unfiltered rows, so watchlist silently did nothing in RAW). `rawCoreGroups(filtered)` is opt-in: the table passes `true`, the generator passes `false` so a qty typed under one filter isn't lost when the filter changes.

**Remaining for scenario 2:**
1. **"Open POs by vendor"** button on Stock View.
2. PO → RTG → NetSuite returns a real PO# → **email it to the vendor** and **log it on the vendor's CRM card** (External Coop).

## Scenario 3 — Fabricut H1 (three-tier) — ✅ SHIPPED 2026-07-28

`H1-75DS` (raw) · `H1-75DS/P` (phosphated in-house base feeding ALL in-house paint finishes P01, P02…) · `H1-75DS/EP1` (outsourced plated).

**⚠ ONE DEPLOY STEP OUTSTANDING:** `convert_demand` is a new collection. Its rule is in `firestore.rules` but rules do NOT auto-deploy — until Cloud Shell runs `firebase deploy --only firestore:rules --project ce-m2c-design-collab`, ordering a `/P` row fails permission-denied (the generator says so explicitly when it does).

- **`3-Tier (raw · /P · plated)`** — third snapshot view button beside Finished / Raw Cores. One block per FAMILY: the raw core row (bold, its demand = the combined demand of every tier below it, since one core is consumed per finished unit), then its tiers indented — `/P` first, then plated, then any other finished variant. A family qualifies by HAVING a `/P`; plain raw cores stay on the RAW view.
- **The filter applies to the FAMILY, not the row.** A family shows when ANY tier matches the search/watchlist/category/collection, and then shows all of its tiers — the `/P` routinely carries a different category than the plated SKU, and half a family defeats a view whose whole point is reading the levels against each other.
- **Tier is DERIVED from the suffix**, never asked: `P` → phosphate · a suffix matching a configured `hq_outsource_finishes` code (EP1, EP2…) → plated · anything else → finished goods. Same rule the main grid's plated-line split already uses.
- **Every tier has its own Order box, and each routes by what it is** (chip in the "Routes to" column, visible before generating): raw → shop-floor WO via `createStockShopWOs` (or the vendor-confirm modal → PO if it's genuinely bought — the assembly-is-built-here rule from scenario 2 is reused verbatim) · `/P` → `convert_demand` doc → **WMS Convert tab** · plated → `plating_demand` doc (the main grid's exact shape, so PickPack needed no new reader) → **WMS Plating tab** · finished → `createStockFinWOs` → Finishing.
- **Raw-shortfall warning, not a silent second WO.** Convert and plating both eat the raw core, so the confirm dialog names any family where (convert + plating qty) exceeds (raw avail + on order + whatever was typed on the raw row right there). No auto-WO: the raw row is on the same screen, and an invisible extra WO would double-order it.
- **WMS side (`PickPackApp.js`)**: a **"Needs Phosphating"** panel at the top of the CONVERT tab lists the open to-dos (with the raw's live on-hand); "Pull & Convert →" opens the convert modal already filled in (raw, `/P` target, qty). The to-do is marked `on_cart` when the raw reaches the phosphate cart and is **deleted only when the assembly build actually posts** — cart hop or straight-through convert, both close it. Item lookup is filter-independent (`enrichedByErp`), so a typed search can't hide the item a to-do points at.
- All of it stages: nothing here writes to NetSuite. WOs/POs land in RTG (so `ns_outbox` serializes), and the convert/plating to-dos are work requests — the operator's own move is the NetSuite write.

**Remaining for scenario 3:** none blocking. Optional polish once Stuart uses it: a badge/count of open `convert_demand` on the HQ side, and closing a to-do that was satisfied by hand.

## Cross-cutting

- **The routing rule, encoded once:** finished assembly → Finishing · in-house base → Shop · outsourced base → PO · phosphate tier → Convert · plated tier → plating demand.
- Everything stages through RTG so `ns_outbox` serializes NetSuite writes and RTG stays the single audit log.
- The main-grid legacy push path should eventually retire or become a thin wrapper over the new routing — one code path, not two.

## Build order (Stuart picked this)

1. ~~Scenario 2 ordering unlock + vendor confirm + auto-route~~ ✅ done
2. ~~Scenario 3 — Fabricut H1 paired view + Convert demand~~ ✅ done (deploy the firestore rule)
3. **Scenario 1 auto-release** (small, scoped to `SALES_SNAPSHOT` + `Stock`) ← **start here**
4. Open POs by vendor + CRM/vendor logging + PO email

---

## Adjacent work this session (context, not scope)

The Finishing Floor got three fixes the same evening — they touch `FinishingFloor/ActiveFloor.js` only, but explain WOs you may see in odd states:
- `a797493` **Force Complete → Packing** on the WO popup (supervisor-gated). Stamps `nsCompletionQueued` in the SAME write as the completion when a stock WO was already built in NetSuite by hand, so the `onStockBuildDone` trigger sees it and can't double-post an assembly build.
- `f2be9eb` **Per-step manual Start/Stop** — every task in the coat has its own PIN'd control. The old single "next action" button stranded jobs whose real state disagreed with it, and its Stop wrote status back to `Pending`, which is what made jobs hang. Stop now means the step is DONE.
- `fcbe150` **▶ Open in Manual Control** from the WO popup — picks the job without a scanner (they're short on scanners).
