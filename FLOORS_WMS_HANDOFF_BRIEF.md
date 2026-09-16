# Shop Floor · Finishing Floor · WMS — bug-chase brief (Session B), 2026-08-07

A session for hunting bugs across the three production apps. Everything below is verified fact or a
labelled hypothesis. **Read `CROSS_SESSION_CONTRACT.md` first** — it holds the three-session
territory map, the mirror pairs, the deploy matrix, and the git rules.

---

## ⛔ 0. TWO OTHER SESSIONS ARE LIVE — stay in your lane

**Session C (traverse/Vision)** owns and is actively editing:

```
src/components/Shared/traverseTags.js        ← the traverse model
src/components/HQ/AssemblyBuilderTab.js      ← tab 1.6, the tagging grids
src/components/HQ/AdminTab.js                ← the CPQ flow generator
src/components/HQ/CPQTab.js                  ← the CPQ runtime
src/components/Shared/assemblyTags.js        ← shared tag vocabulary that feature reads
TRAVERSE_HANDOFF_BRIEF.md                    ← their brief
```

Also leave alone: `Shared/plateRules.js`, `Shared/sizeMatrix*`, `Shared/finishLabel.js`,
`Shared/configQty.js` — all read by CPQ.

**Session A (portal/CPQ integration)** owns:

```
portal/                                       ← the whole Vite app
functions/index.js portal* exports            ← the BFF (portalMyOrders, portalResolve, …)
functions/portalEngine.js · functions/portalRequestLines.js
src/components/HQ/ExternalCoopTab.js          ← CRM card, pipeline, DOCS
src/components/Shared/FormPreview.js          ← the branded document (RTG renders through it —
src/components/Shared/portalRequestLines.js      if an RTG doc bug traces INTO FormPreview, report)
```

`functions/index.js` is SHARED GROUND: `onStockBuildDone` + `netsuiteProxy` are yours,
the `portal*` exports are Session A's. Coordinate via Stuart on anything else in that file.

If a floor/WMS bug genuinely traces into another session's files, **stop and say so** rather than
editing. Report it and let Stuart route it.

**Your territory** is everything below in §3.

---

## 1. The environment

### Where it lives

| | |
|---|---|
| Repo | `github.com/stuartganswb-jpg/ce-m2c-design-app` |
| Working checkout | `/Users/stuartgansmba/Projects/ce-m2c-design-app` |
| **Branch** | **`main`** — in sync with `origin/main` at `528571c` (2026-08-05 12:18) |
| App | **www.4cosworkcenter.com** (CRA) |
| Portal | portal.classicalelements.com (Vite, `portal/`) |
| Firebase project | `ce-m2c-design-collab` |
| NetSuite account | `3728153` |
| Vercel dashboard | vercel.com/m2-c-ce-design-app |

**Routes:** `/hq` (HQ tabs) · `/finishing-floor` · `/pick-pack` (WMS) · shop floor via the hub.

### Deploy — THREE things, only one is automatic

**1. Frontend → automatic.** Every push to `main` builds two Vercel projects: `ce-m2c-design-app`
(CRA, ~2 min) and `ce-client-portal` (Vite, ~10 s). Stuart must hard-refresh ⌘⇧R after.

**2. Firebase Functions → MANUAL, Cloud Shell only.** Local `firebase login` fails on this Mac.
Vercel does **not** deploy functions. This matters here: `functions/index.js` holds
`onStockBuildDone` (the assembly build that posts at the bin scan) and `netsuiteProxy`. **If you
change `functions/index.js`, the change is NOT live until someone runs this** at
[shell.cloud.google.com](https://shell.cloud.google.com) — it drops you in `~`, so the `cd` is not
optional:

```bash
cd ~/ce-m2c-design-app && git pull origin main && firebase deploy --only functions:onStockBuildDone,firestore:rules --project ce-m2c-design-collab
```

Fresh Cloud Shell (home is wiped after ~120 days idle):
```bash
git clone https://github.com/stuartganswb-jpg/ce-m2c-design-app.git ~/ce-m2c-design-app
```

**Read the `git pull` output before trusting the deploy** — it must show the commit you care about
arriving. A stale checkout reports "Successful update operation" while shipping old code.
Deployed to date: `portalMyOrders`, `portalDeleteQuote`, `portalBranding`, `onStockBuildDone`.

**3. NetSuite RESTlet → manual, inside NetSuite.** `netsuite/ce_convert_build_restlet.js` is shipped
by no deploy — File Cabinet → SuiteScripts → replace the file. Used by the WMS raw→/P convert.

### Ship workflow

```bash
rm -f .git/index.lock
git add <specific files>          # NEVER git add -A — another session is editing this repo
git commit -q -m "..."
git pull --rebase --autostash origin main
git push origin main
```

**Multi-session git safety (live right now):** never `git checkout <branch>` in the shared checkout —
it races the other session's in-flight files and once landed a commit on main unintentionally. Stage
only the files you changed. Always `--rebase --autostash` before push.

### Verify / build

```bash
npx --no-install eslint <path>                  # 0 errors required; pre-existing warnings are fine
CI=false npx --no-install react-scripts build   # ~1–2 min
node --test <scratchpad>/<name>.test.mjs        # pure-module tests
```

### ⚠ Verifying what prod actually serves

A "Ready" deploy with a fresh `version.json` can still serve old code.

```bash
curl -sL https://www.4cosworkcenter.com/ | grep -o 'static/js/main\.[a-z0-9]*\.js'
```

**The app is CODE-SPLIT** — lazy tab code never appears in `main.*.js`, so a marker grep there reads
as "stale build" when prod is current. Extract every chunk map from main and sweep them all:

```bash
LC_ALL=C grep -oE '\{[0-9]+:"[a-f0-9]{8}"(,[0-9]+:"[a-f0-9]{8}")*\}' main.js \
  | tr ',' '\n' | grep -oE '[0-9]+:"[a-f0-9]{8}"' | tr -d '"' | sort -u
```
…then download each `static/js/<id>.<hash>.chunk.js` and grep those. **Sweep EVERY match, not
`head -1`** — main carries several maps (~33 entries).

- **Pick a marker that survives minification**: string/JSX literals, property names, Firestore field
  names. Local variables and imported function names are renamed. Plain ASCII only.
- If a shipped change genuinely does nothing: Vercel → Deployments → ⋯ →
  **Redeploy with "Use existing Build Cache" UNCHECKED**.
- **Do this BEFORE debugging a feature that "does nothing".** A previous session burned three
  attempts on a bug because it assumed a deploy hadn't landed when it had.

### Hard constraints — read these before planning any verification

- **Firestore enforces App Check.** No local/Node script can read or write production data
  (permission-denied). Bulk data changes must be an **in-app admin button**, never a script.
- **The apps are behind a PIN gate**, so they cannot be driven from a browser test harness either.
- **Therefore: the only verification available is pure modules + `node --test`.** Extract logic into
  a Firestore-free `Shared/*.js` module and test it there. This is why so much of the floor logic
  already lives that way.
- **NetSuite reads for diagnosis:** the old unauthenticated SuiteQL curl is dead (App Check). Use the
  RTG NetSuite Transmit Log (click a row = full error + sent payload), HQ 11.1 → NetSuite Sync Queue,
  or ask Stuart for a screenshot.

---

## 2. Data model you will need

### Collections

| Collection | What |
|---|---|
| `fin_workorders` | the finishing work order — **the spine**; WMS and packing read the same doc |
| `shop_custom_orders` | the custom-shop half; linked by `finSiblingId` / `orderKey` |
| `hq_work_orders` / `hq_sales_orders` | the RTG ledger |
| `ns_outbox` | staged NetSuite writes (serial, retried, visible in 11.1 + transmit log) |
| `plating_demand`, `core_urgent_demand`, `rod_cut_orders` | WMS side-queues |
| `hq_users` | login/permissions (+ `superAdmin` FLAG) · `fin_users` = legacy finishing chips |
| `fin_config/settings`, `/permissions`, `/capacityMatrix`, `fin_recipes` | finishing config |

### The status fields (all still written; `Shared/orderStatus.js` derives from them)

```
currentPhase      Setup · Painting · Complete · Closed
pickStatus        Pending · Picked_Awaiting_Staging · Staged_Ready_For_Finishing
packStatus        Packed   (+ packMode PUTAWAY, putawayBin, packedAt/By)
customFabStatus   Pending · Complete      (only when hasCustomSibling)
sentToPickPack    boolean
tasks{}           spinSetup · spinSpray · spinBake · poleSpray · poleBake · hand
currentStepIndex / poleStepIndex   the coat pointer per stream
```

### Conventions that bite

- **Mainline assembly** = `routingType === 'MAIN'` OR `recordType === 'PRODUCT'`.
- **Brand → NetSuite map** (`BRAND_NETSUITE_MAP`, duplicated in PickPackApp / NetSuiteSync /
  ERPPushPull / AdminTab — keep in sync): `m2c`=sub3/loc19, `ce`=sub2/loc17, `uniquity`=sub6/loc20,
  `leyla`=sub5/loc18.
- **Super admin is a FLAG on the `hq_users` record, not a matrix role.** The login token alone can't
  always identify it — resolve the directory record. This has caused repeated "reaches the tab,
  refused the button inside it" bugs. `Shared/finishingRoles.js` does it correctly; copy that shape.
- **Bin transfer vs adjustment:** a count that moves stock between an item's bins is a **bin
  transfer**, not an adjustment (mixed +/- bins are rejected). Transfers must validate the source bin
  actually holds the qty (live `nsStock[].bins`, not the stored home bin).

---

## 3. Your territory — the files

```
src/components/FinishingFloor/ActiveFloor.js      the floor, manual control, step PINs
src/components/FinishingFloor/SetupQueue.js       staging in, notes pill
src/components/FinishingFloor/FinishingFloor.js   shell, tab gating, recipes/config subs
src/components/FinishingFloor/Recipes.js          finish recipes
src/components/ShopFloor/ShopFloor.js             custom fab + milling
src/components/PickPack/PickPackApp.js            WMS: pick, stage, pack, convert, plating, rod cuts
src/components/HQ/RTGDispatchTab.js               dispatch board → both floors
src/components/HQ/NetSuiteSyncTab.js              11.1 item/customer sync + outbox monitor
functions/index.js                                onStockBuildDone (⚠ Cloud Shell to deploy)

Shared/ modules that are YOURS:
  orderStatus.js · OrderStatusChips.js · WhereIsIt.js      the derived status
  floorActivity.js · finishingRoles.js · finishingTime.js  the floor
  pickOrder.js · labelPrint.js · workOrderContract.js      WMS
  stockRun.js · paintOnly.js · lineClassification.js       release + routing
  finishRouting.js · platingPackingList.js
```

---

## 4. Recently shipped here (2026-08-03/04) — context for regressions

All of this is live. If a bug looks new, one of these is the likely neighbourhood.

| Commit | What |
|---|---|
| `a5e5e5e` `b398ae8` | **Derived order status** (`orderStatus.js`, 11 stages) + `OrderStatusChips` + the 🧭 "Where is it?" lookup, wired into finishing nav, WMS header, packing tiles, RTG, shop floor |
| `9e3d786` | **Pick list merges + bin-sorts** (`pickOrder.js`) — same-code lines collapse, sorted by bin; `codeHealth()` distinguishes "not in library / not linked to NetSuite / no stock record / real zero" |
| `2da7c70` | **Assembly build posts at the BIN SCAN, not the bake** (`functions/index.js`) — deployed |
| `3d8d5ab` | **Packing proves both halves match** — a custom order can't close until the shop label scans to the same `orderKey`; Recently Packed expands to lines + label reprints |
| `3a41be7` | **A missing recipe was completing orders on first touch** — `recipeLen` 0 satisfied `next >= len`. Guard added; `resolveRecipe` made forgiving; completion always stamps who (`completedVia`) |
| `5d6f26b` | **"On the Floor" panel** + `finishingRoles.js` (Force Complete now honours any manager-ish role and directory super-admin) |
| `08b2939` `6efabb8` | One open step per operator (oven exempt); recipe-aware N/A steps; recipe Edit/Delete restored |
| `bc955c9` | **Release straight to the floor from Master Library** — RTG still gets the ledger entry (`releasedFrom: MASTER_LIBRARY`), rollback if the floor write fails |
| `e00c656` | **JFP "Just For Paint"** — legacy NetSuite item, no assembly; packing does a bin count then an inventory adjustment via `ns_outbox` |
| `efd0044` | **11.1 item sync counts first and verifies** — trusts NetSuite's `hasMore`, guards a non-advancing keyset |
| `c4415b9` | Form printing: the label stylesheet was leaking `@page{size:4in 2in}` into quotes/SOs |

---

## 4.5 Shipped 2026-08-06/07 — the phosphate-convert chase (this session's predecessor)

The floor hit *"You still need to reconfigure the inventory detail record after changing the
quantity. (at step: save)"* converting H1-138CP-V/P off the phosphate cart, while sibling lines in
the SAME cart converted fine.

| Commit | What |
|---|---|
| `406ca08` | **CHECK BOM on every open conversion-cart line** — runs the RESTlet's `diag:true` mode (posts NOTHING), reads the reply through `Shared/convertDiag.js` (node-tested), names which component line is unresolved and why; Raw reply + Copy so failures travel verbatim |
| `26dd4e5` | **The cause, confirmed by that diag:** a component line the loop could not detail (Phosphating — *"You cannot create an inventory detail for this item"*, a NON-defect) was left `selectLine`-open; **last in the BOM**, it was still open at `save()`, and NetSuite resolving it mid-save reads as a quantity change. Fix: `cancelLine` any uncommitted line, in the build AND the unbuild mirror. `convertDiag` reads the fixed script's `cancelled` stamp as NOT_TRACKED (healthy) so the readout stops accusing a fixed script |

**⚠ THE RESTLET FIX IS NOT LIVE.** `netsuite/ce_convert_build_restlet.js` @ `26dd4e5` must be
replaced by hand in NetSuite (File Cabinet → SuiteScripts). Until then the convert still fails on
any BOM whose non-detail component sits last. After the upload, CHECK BOM on the failing line
should flip from "LAST LINE — still open at save" to "this line should build" — that flip is the
verification.

Working knowledge from the chase: /P assembly BOMs carry a fractional `Phosphating` component
(0.15/unit, item type Stock) — sourced fine but takes no inventory detail. The BOMs are NOT
consistent about carrying it (flagged to Stuart, unresolved — an accounting decision, not a bug).

---

## 5. Known-open / unverified — good first targets

0. **Confirm the RESTlet upload** (see §4.5 — first thing, it's blocking the floor): after Stuart
   replaces the file, CHECK BOM the failing cart line, then Convert it for real.
1. **The bin-scan assembly build has never run for real.** Deployed 2026-08-03, no order has packed
   through it. First real stock pack is the test: the build must receive into the **scanned**
   `putawayBin`, not a guessed one. Watch HQ 11.1 → NetSuite Sync Queue.
2. **JFP end-to-end has never run.** Create a paint run in Master Library → RTG record → floor →
   pack → confirm the inventory adjustment lands in 11.1.
3. **Orders packed before `3d8d5ab`** never had the pole/small-parts match. Recently Packed now shows
   *"poles were NOT match-scanned at packing"* — worth auditing that list.
4. **Recipes with no matching `fin_recipes` doc.** `resolveRecipe` is forgiving now and the guard
   stops the silent self-completion, but any recipe code on the Pipeline Overview without a doc will
   refuse to advance. Check `GOP`, `SG`, `CP`, `G`, `N25`.
5. **`hasCustomSibling` linkage.** The packing match only fires when the halves are siblings. If both
   halves exist but aren't linked, nothing catches a mismatch — that's an RTG dispatch-time problem
   (`finSiblingId`), not a packing one.
6. **Quick Ship add-on picker** — built for CPQ, not wired into Quick Ship. Blocked on a decision:
   fees created in 4.6 are app-only with no NetSuite item id, so they can't push. Proposal was to
   show them greyed with "needs a NetSuite item".

---

## 6. Working style that has held up here

- **Extract the logic, then test it.** Every durable fix in §4 is a pure `Shared/*.js` module with a
  node test beside it. That is the only verification this stack allows.
- **Name the two states apart.** Several real bugs were one message serving two different problems
  ("stock has 0" for a shortage *and* an unknown item; "no PIN" for unattributed *and* never-started).
  When a message can mean two things, split it.
- **Fix the cause, not the symptom.** A previous session shipped three compensating patches for one
  duplicate-data problem before finding it. If the third fix in an area doesn't hold, stop and look
  for the shared cause.
- **Report honestly.** If something is deployed but unexercised, say so — several items in §5 are
  exactly that.

---

## ADDENDUM 2026-08-08 (Session A, Stuart-authorized while this session was idle)

`dcd2d63` touched YOUR RTGDispatchTab: `buildPartsList` now takes the shared clientPricing
key-set (`Shared/clientPricing.js customerKeys/findClientPriceRow`) instead of a strict
`customerId ===` match, and the SO-import handler resolves the CRM record once to build it. Why:
a name-keyed pricing row priced the CPQ quote but dropped the customer's SKU from your pick
ticket (and mis-rated the pushed SO — fixed in ERPPushPullTab the same commit). Behavior is
otherwise identical; if a pick-ticket SKU bug shows up, start at `buildPartsList` and the shared
matcher, not at a local matcher. Full map: CROSS_SESSION_CONTRACT.md §2026-08-08.
