# Portal session brief — 2026-08-09 (CPQ pivot running in parallel)

Read `CROSS_SESSION_CONTRACT.md` first. This tab owns the **customer portal**; a parallel session
is actively rebuilding **CPQ/H1** (`H1_COLLECTION_LOAD_PLAYBOOK.md` = its plan, §6 = its protocol).
The two stacks are close in nature by design — the portal mirrors CPQ — which is exactly why the
discipline in §1 exists. **Check before you push, every time.**

## 1. ⚠ GIT — the conflict discipline (both sessions push to main)

1. Before ANY commit: `git status --short` — if files outside YOUR list below show modified,
   they are the other session's in-flight work. **Stage only files you changed, by name.**
2. Always `rm -f .git/index.lock`, then `git pull --rebase --autostash origin main` BEFORE push.
   Autostash preserves the other session's uncommitted tree — read the rebase output; if a
   conflict names a file you didn't touch, STOP and coordinate with Stuart, don't resolve blind.
3. **Never** `git checkout <branch>`, **never** `git stash` the shared tree, never `git add -A`.
4. Commit small and push promptly — long-lived uncommitted work in the shared tree is what
   creates the collisions.

## 2. ⛔ OFF LIMITS — the CPQ session's active field (grown since 08-08)

```
src/components/HQ/AdminTab.js · CPQTab.js          ← generator + runtime, actively edited TODAY
src/components/Shared/sizeMatrix.js                ← actively edited; portal/src/shared/sizeMatrix.js
                                                     is a MIRROR TARGET synced FROM it (byte-equal,
                                                     test-pinned) — never edit the portal copy alone
src/components/HQ/AssemblyBuilderTab.js (1.6) · CustomerCollectionsTab.js (4.6) · LibraryTab.js
src/components/SpecSheet/* · BOMTab.js · CollectionReadinessBoard.js
src/components/Shared/collectionReadiness.js · clientPricing.js · priceLevels.js · itemCodeMatch.js
src/components/Shared/fusionImport.js · assemblyTags.js · aliasIdentity.js · plateRules.js
src/components/HQ/ERPPushPullTab.js · RTGDispatchTab.js · VisionHardware.js
```

Yours: `portal/` (except `portal/src/shared/sizeMatrix.js` — mirror target), `functions/` portal
exports + `portalEngine.js` + `portalRequestLines.js` (CJS mirror — change with its src twin ONLY
via coordination), `ExternalCoopTab.js`, `FormPreview.js`, Quick Ship tab 7, CRM quote/SO surfaces.
If a portal bug traces into the off-limits list: stop, report, Stuart routes it.

## 3. Deploys — what ships how (and what's pending)

| Surface | How | Notes |
|---|---|---|
| App frontend (`src/`) | auto — Vercel `ce-m2c-design-app` on push (~2 min) | hard-refresh ⌘⇧R |
| Portal (`portal/`) | auto — Vercel `ce-client-portal` (~10 s) | |
| Cloud Functions | **manual — Cloud Shell only** (local `firebase login` fails on this Mac) | `cd ~/ce-m2c-design-app && git pull origin main && firebase deploy --only functions:<names> --project ce-m2c-design-collab` — READ the pull output; a stale checkout reports success while shipping old code |
| NetSuite RESTlet | manual — File Cabinet → SuiteScripts, replace file | |

**Verify-before-diagnosing list (may already be done — check, don't assume):**
- `functions:portalMyOrders,portalResolve` @ ≥`c007153` — until deployed, portal cards show raw
  FIN-ids and checkout fee part#s are missing. NOT a new bug.
- `netsuite/ce_convert_build_restlet.js` @ `26dd4e5` (floors territory, listed for completeness).
- Prod bundle checks: app is CODE-SPLIT — sweep every chunk map, ASCII markers (floors brief).

## 4. CPQ / Vision — current status (what the parallel session has live, as of `10e1980`)

**The H2-method pivot is underway.** H1 will be rebuilt as per-diameter masters (H1-75 / H1-1 /
H1-138) with ONE generator-built combined flow, diameter first — like H2. The legacy H1 flow keeps
working through a parallel run; portal `portalFlowIds` swap only at cutover (coordinate then).

Landed, in order:
- `246e09f` — `H1-RND` gained `codeRx` (+ `stampedOnly`: importer keys are truth, no virtual
  parse, 🧬 stamper barred). `masterSizeScaleOf` now also matches assembly NAME ('H1-138' /
  'H2-75'). Legacy-H1 render invariants pinned by test. **Portal sizeMatrix mirror re-synced.**
- `f6cd60d` — 4.6 is the pricing/alias control surface (tier editor parity, $0-w/-arm null
  semantics fixed, per-customer row seeding, alias create/list). Library drawer = one-off edits.
- `c321d90` — **Flow mode switch** on flow settings (Single assembly / Combined size family,
  persisted `singleAssembly`, honored by Regenerate) + `sizeFamilyOfParts` needs DOMINANCE
  (≥5 keyed pins, ≥60%) — the Brimar poisoning (one stray H1 end cap family-izing a foreign
  flow) can't recur. **Mirror re-synced again.**
- `7910534` — Brimar render fixes: explicit `rtn-only` beats `inl-only` (inline suppresses only
  NAME-derived return-ness); pool-exclusive flag emission; parked/hidden pins emit no options;
  CPQ `__sub` healing pool-scoped; **render-map audit** — a red strip under the 3D pane names any
  mapped node the model doesn't have.
- Vision Hardware verified as flag-consumer only (zero geometryMap reads) — CPQ render fixes are
  Vision-neutral; corrected flags make Vision's pools consistent.

**Portal-relevant consequences:**
- Flows will be REGENERATED repeatedly during the pivot — portal renders whatever the flow doc
  says, so portal behavior changes without portal deploys. Check flow regen timestamps before
  chasing a "portal regression".
- Known portal-side gaps (pre-existing, now documented): portal has NO `__sub` heal/clear —
  stale out-of-pool backplate picks can persist in portal params; portalEngine derives
  `returnOnly` independently from `R[BC]P-` code shape (a second source of truth); portalEngine's
  inlined priceLevels lacks the `/P25`-is-plated outsourced-registry correction; CPQ's wall-mount
  auto-lines aren't mirrored. All good portal-session work — coordinate timing with the pivot.

## 5. Architecture refresher (unchanged)

Portal = BFF (`portal*` functions shape whitelisted payloads; `portalEngine.js` = hand-ported
pricing; identity via `portal_users` claims; entitlement on `crm_records`
portalFlowIds/portalPriceLevel/portalCollections, edited in ExternalCoopTab's PortalAccessPanel).
Request lifecycle: Configurator → `portalQuoteRequest` → `jobs` (PORTAL_REQUEST, cartItems shaped
for zero-re-entry reopen) → CRM pipeline → staff price in CPQ → SO. Unpriced requests have no
breakdown BY DESIGN — render honestly (FormPreview `unpriced`, portalRequestLines mirror pair).
Verification: pure modules + `node --test` only (App Check + PIN gate). ESLint 0 errors; leave
pre-existing warnings.

## 6. ✅ DONE (2026-08-10, `7cc614c` — this session took portal ownership; portal session retired): order tagging fields

The HQ side is SHIPPED (`fe14ff5` + the CPQTab sweep inside `c9e3755`). The portal must mirror
it. Two fields, two levels:

**Order Sidemark (header level)** — captured ONCE at the start of a session, e.g.
"Smith Residence". Prints at the HEADER of quotes / sales orders / packing slips.
**Line Tag (per configuration)** — captured at the START of each configured line, e.g.
"Living Room", then "Primary Bedroom". Names that line on every document.

**The HQ data contract you must match (jobs doc):**
- `orderSidemark` = the raw typed header sidemark (nullable). Reopen restores from THIS field.
- `sidemark` = display chain `orderSidemark || jobName || 'Multi-Room Project'` — legacy field
  every consumer already reads (CRM cards, RTG notes, ERP push memo). Never write it raw.
- `cpqData.cartItems[].sidemark` = the per-LINE tag (legacy name; 'No Sidemark' when empty).
  Documents render it as `▶ AssemblyName [tag]`.
- NetSuite estimate memo = `[jobName, sidemark]` deduped, joined ' - ' (ERPPushPullTab) — so the
  header sidemark reaches SO/packing-slip headers via NetSuite memo inheritance automatically.

**Portal work (your territory):**
1. `portal/src/Configurator.jsx` — add both inputs: an order sidemark field at session/flow
   start and a line tag field at the top of the step run (HQ styles it as a strip above step 1,
   brass-bordered when filled; placeholder `"Living Room", "Primary Bedroom"`).
2. `functions/index.js portalQuoteRequest` — accept `{ sidemark, lineTag }`, sanitize exactly
   like `portalVisionMeasure` already does (`String(x||'').slice(0,120)`), and stamp the job:
   `orderSidemark`, `sidemark` per the chain above (portal fallback today is the hardcoded
   `'Portal request'` at ~line 1626 — keep it as the LAST fallback), and the line tag onto the
   request's cartItems line so staff reopen-in-CPQ lands with `lineTag` pre-filled (CPQTab
   restores it from `cartItems[].sidemark` on Edit — that plumbing is already live).
3. Cloud Shell deploy `portalQuoteRequest` after (functions never auto-deploy).
4. QuickShip portal counter already has its own job/sidemark notion — leave it; this work order
   is the configurator path only.

## 7. ✅ DONE (2026-08-10, `0426536`): portal multi-line orders + checkout add-ons

Order cart (`portal/src/orderCart.js`, localStorage) — review screen adds lines instead of
submitting; cart bar over the showroom → `Checkout.jsx`: lines + 4.6 Checkout Items add-ons
(new `portalCheckoutCatalog` BFF, per-customer priced, whitelisted, NO all-fees fallback) +
sidemark/note → ONE `portalQuoteRequest` v2 (lines[] entitlement-checked per line; addOns[]
re-validated server-side; legacy payload still accepted; line[0] mirrored top-level).
Staff: reopen-in-CPQ restores all cart lines + pre-ticks add-ons (session `addOnSel`).
`portalRequestLines` mirror pair multi-line + Add-on rows (parity 3/3);
`functions/feeRulesPort.js` = new CJS subset mirror of Shared/feeRules — keep in step.
Presentation generator moved Configurator → Checkout success (multi-line aware, presMeta
stamped at add-time). ⚠ Cloud Shell: portalCheckoutCatalog + portalQuoteRequest + portalMyOrders.
