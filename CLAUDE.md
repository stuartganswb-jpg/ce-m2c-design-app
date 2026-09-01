# CE / M2C Design-Collab — Project Guide

React + Firebase manufacturing PLM/WMS for Classical Elements & M2C Studio. Live at **4cosworkcenter.com** (Vercel). Firebase project: `ce-m2c-design-collab`. Repo: `github.com/stuartganswb-jpg/ce-m2c-design-app`.

## ⛔ WORKING AGREEMENT — read before touching anything (Stuart, 2026-08-31)

These four rules bind every session, every time. They are not style preferences; each one was
written after a change that cost real money or real trust.

1. **Plan first, always.** State the plan and WAIT for approval before editing code, shipping, or
   changing production data. Every time — no exceptions for "small", "obvious" or "while I'm in
   there". Diagnosis, reading and measuring need no permission; changing things does.

2. **Requested scope only.** Deliver exactly what was asked, and nothing beside it. If something
   adjacent looks wrong, NAME it and wait — never fix, remove, restructure or "improve" it in
   passing. Working, tested code is not yours to touch because you happened to be in the file.
   (2026-08-31: asked to ADD a Reopen Order Entry button, the session also made the working Reopen
   CPQ / Reopen Vision buttons conditional. Nobody asked for that.)

3. **No temporary fixes.** Fix the cause. If it cannot be done properly right now, say so and stop
   — a stopgap that hides the cause is worse than an open bug, because the next session inherits
   both.

4. **Look downstream before you change anything — RTG is the single source of truth.** CPQ and
   Order Entry are the kickoff point of the entire operation: what they write becomes work orders,
   the finishing floor's queue, the shop floor's queue, WMS pick/pack and the NetSuite transaction.
   Every one of those now hangs off RTG as the ONE spine, and it stays that way. So before any
   change to a quote, an order, a line, a part identity or a push payload, trace it forward:
   - what does this do to the WORK ORDERS this order fires (and their anchors back to the SO)?
   - what does the FINISHING FLOOR see — recipe, finish code, sub-finish routing, sequencing?
   - what does the SHOP FLOOR see — router, cut list, component pulls?
   - what does WMS see — pick lines, bins, packs, labels?
   - what reaches NETSUITE — item identity, quantities, rates, the rollup?
   State that trace in the plan. **No change may break the RTG linkage.** If a change would fork
   the spine or leave a screen reading its own copy of the truth, it is the wrong change.

## Build / verify
- Lint a file before committing: `npx --no-install eslint <path>` — **0 errors required** (pre-existing warnings are fine).
- Full build sanity check (slow, ~1–2 min): `CI=false npx --no-install react-scripts build`.

## Ship workflow (frontend)
Frontend **auto-deploys to production via Vercel on push to `main`**. Standard flow:
```
rm -f .git/index.lock           # always do this first
git add <files> && git commit -q -m "...
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git pull --rebase --autostash origin main
git push origin main
```
After deploy, the user must **hard-refresh** (⌘⇧R) to clear the cached bundle.

**Stale-build trap (2026-07-22 incident):** a deploy can show "Ready" with the right commit hash and a fresh `version.json` stamp yet serve OLD code — Vercel was compiling a STALE CHECKOUT (a cold build of a commit lacked code that commit contains; prod regressed across 4 different stale bundles in one evening). No push fixes it. Fix: Vercel dashboard → ce-m2c-design-app → Deployments → top row ⋯ → **Redeploy with "Use existing Build Cache" UNCHECKED** (fresh clone). If a shipped change "does nothing" on prod, grep the live bundle for a marker string BEFORE debugging the feature: `curl -sL https://www.4cosworkcenter.com/ | grep -o 'static/js/main\.[a-z0-9]*\.js'`, download that file, `LC_ALL=C grep -c '<unique new string>'`. (`"prebuild": "rm -rf node_modules/.cache"` stays as a determinism guard.) See memory `vercel-deploy-pipeline`.
  **⚠ The app is CODE-SPLIT (2026-07-26 false alarm):** lazy-loaded tab code (Library, Quick Ship, Admin, CRM, …) NEVER appears in `main.*.js` — a marker grep there reads as "stale build" when prod is actually current. For tab code: extract the chunk maps from the live main bundle (`LC_ALL=C grep -oE '\{[0-9]+:"[a-f0-9]{8}"(,[0-9]+:"[a-f0-9]{8}")*\}'` — **sweep EVERY match, not `head -1`**: main carries SEVERAL maps and a `head -1` sweep false-negatived on 2026-07-27, ~31 chunk entries total), download `static/js/<id>.<hash>.chunk.js` for each entry, and grep THOSE. Use plain-ASCII marker strings — non-ASCII (·, —, ’) may be unicode-escaped in the bundle and miss.

**MULTI-SESSION GIT SAFETY — multiple Claude sessions often work this repo at once:**
- **NEVER switch branches in the shared checkout** (`git checkout <branch>` races the other session's in-flight files — this once landed a commit on main unintentionally). Commit small changes directly on main (fix-forward, as above); use an isolated **`git worktree`** for bigger multi-commit work.
- Stage ONLY files you changed (never `git add -A` — the other session's work may be sitting in the tree).
- Always `git pull --rebase --autostash` before push — it preserves the other session's uncommitted worktree state.

## Firebase Functions (NOT auto-deployed)
`functions/index.js` (`netsuiteProxy` = NetSuite OAuth proxy; `authenticatePin` = PIN auth). **Vercel does NOT deploy functions.** Local `firebase login` fails on this Mac (localhost callback). **Deploy from Google Cloud Shell** (shell.cloud.google.com): `git pull` then `firebase deploy --only functions:netsuiteProxy --project ce-m2c-design-collab`. See memory `firebase-deploy-cloud-shell`.

## Hard constraints
- **Firestore enforces App Check** → no local/Node script can read or write production data (permission-denied). Bulk data changes must be done **inside the authenticated app** (build an admin button) — not via scripts.
- **NetSuite reads for diagnosis**: the old unauthenticated SuiteQL curl to the proxy is **DEAD** — since the 2026-07 security hardening the proxy rejects it with `Missing App Check token`. Diagnosis paths: the RTG "NetSuite Transmit Log" (click a row = full NetSuite error + sent payload), 11.1 → NetSuite Sync Queue, or ask the user for a screenshot.

## Key conventions & gotchas
- **Super admin**: gate admin features with a role normalized to include super admin (e.g. ShopFloor maps `superadmin`→`admin`). Super admin can reach tabs but was historically excluded from inner `['admin','programmer']` gates — include it.
- **Brand → NetSuite map** (`BRAND_NETSUITE_MAP`, duplicated in PickPackApp/NetSuiteSync/ERPPushPull/AdminTab): `m2c`=sub3/loc19, `ce`=sub2/loc17, `uniquity`=sub6/loc20 ("Unique - HP"), `leyla`=sub5/loc18. Keep all copies in sync.
- **Mainline assembly** = `routingType === 'MAIN'` OR `recordType === 'PRODUCT'`. Inception/Node Grouping/Visual Assembly/BOM filter to mainline; orphans/sub-components live only in BOM Engine / Master Library. Inception stamps saved PRODUCTS as `routingType: MAIN`.
- **Assembly data model** (`Approved_Designs` doc): `manufacturingSpecs.cadUrl` = the working GLB (what Visual Assembly/BOM read); `revisions[]` = history; `finalRevisionId` = current; `nodeClusters[]` = node groups (have `location`/`position`/`category`); BOM lines = `assembly_pins` (keyed by `assemblyId`, link `clusterId`). The doc id never changes on update, so BOM/CPQ stay linked.
- **CPQ flows**: stored in `cpq_flows`, edited in **System Admin → CPQ Flows** (the "8. CPQ Configurator" tab is the runtime). "Auto Sync BOM" appends steps; updates are in-place (no delete needed).
- **NetSuite bin transfer / adjustment**: bin-transfer items need a line-level `quantity` + top-level `subsidiary`; OAuth signing must percent-encode `!` (the `!transform` receipt URL). A count that moves stock between an item's bins = a **bin transfer**, not an adjustment (mixed +/- bins are rejected). Transfers must validate the source bin actually holds the qty (live `nsStock[].bins`, not the stale stored home bin).
- **Labels**: 2"×4" item/bin labels via `Shared/labelPrint.js`; plating packing list via `Shared/platingPackingList.js`.
