# CE / M2C Design-Collab — Project Guide

React + Firebase manufacturing PLM/WMS for Classical Elements & M2C Studio. Live at **4cosworkcenter.com** (Vercel). Firebase project: `ce-m2c-design-collab`. Repo: `github.com/stuartganswb-jpg/ce-m2c-design-app`.

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

**MULTI-SESSION GIT SAFETY — multiple Claude sessions often work this repo at once:**
- **NEVER switch branches in the shared checkout** (`git checkout <branch>` races the other session's in-flight files — this once landed a commit on main unintentionally). Commit small changes directly on main (fix-forward, as above); use an isolated **`git worktree`** for bigger multi-commit work.
- Stage ONLY files you changed (never `git add -A` — the other session's work may be sitting in the tree).
- Always `git pull --rebase --autostash` before push — it preserves the other session's uncommitted worktree state.

## Firebase Functions (NOT auto-deployed)
`functions/index.js` (`netsuiteProxy` = NetSuite OAuth proxy; `authenticatePin` = PIN auth). **Vercel does NOT deploy functions.** Local `firebase login` fails on this Mac (localhost callback). **Deploy from Google Cloud Shell** (shell.cloud.google.com): `git pull` then `firebase deploy --only functions:netsuiteProxy --project ce-m2c-design-collab`. See memory `firebase-deploy-cloud-shell`.

## Hard constraints
- **Firestore enforces App Check** → no local/Node script can read or write production data (permission-denied). Bulk data changes must be done **inside the authenticated app** (build an admin button) — not via scripts.
- **NetSuite reads for diagnosis**: you CAN POST read-only SuiteQL to the proxy via curl: `https://netsuiteproxy-f3h3jadzaq-uc.a.run.app` with `{targetUrl, method:"POST", payload:{q:"..."}}`. Useful to verify locations/bins/stock.

## Key conventions & gotchas
- **Super admin**: gate admin features with a role normalized to include super admin (e.g. ShopFloor maps `superadmin`→`admin`). Super admin can reach tabs but was historically excluded from inner `['admin','programmer']` gates — include it.
- **Brand → NetSuite map** (`BRAND_NETSUITE_MAP`, duplicated in PickPackApp/NetSuiteSync/ERPPushPull/AdminTab): `m2c`=sub3/loc19, `ce`=sub2/loc17, `uniquity`=sub6/loc20 ("Unique - HP"), `leyla`=sub5/loc18. Keep all copies in sync.
- **Mainline assembly** = `routingType === 'MAIN'` OR `recordType === 'PRODUCT'`. Inception/Node Grouping/Visual Assembly/BOM filter to mainline; orphans/sub-components live only in BOM Engine / Master Library. Inception stamps saved PRODUCTS as `routingType: MAIN`.
- **Assembly data model** (`Approved_Designs` doc): `manufacturingSpecs.cadUrl` = the working GLB (what Visual Assembly/BOM read); `revisions[]` = history; `finalRevisionId` = current; `nodeClusters[]` = node groups (have `location`/`position`/`category`); BOM lines = `assembly_pins` (keyed by `assemblyId`, link `clusterId`). The doc id never changes on update, so BOM/CPQ stay linked.
- **CPQ flows**: stored in `cpq_flows`, edited in **System Admin → CPQ Flows** (the "8. CPQ Configurator" tab is the runtime). "Auto Sync BOM" appends steps; updates are in-place (no delete needed).
- **NetSuite bin transfer / adjustment**: bin-transfer items need a line-level `quantity` + top-level `subsidiary`; OAuth signing must percent-encode `!` (the `!transform` receipt URL). A count that moves stock between an item's bins = a **bin transfer**, not an adjustment (mixed +/- bins are rejected). Transfers must validate the source bin actually holds the qty (live `nsStock[].bins`, not the stale stored home bin).
- **Labels**: 2"×4" item/bin labels via `Shared/labelPrint.js`; plating packing list via `Shared/platingPackingList.js`.
