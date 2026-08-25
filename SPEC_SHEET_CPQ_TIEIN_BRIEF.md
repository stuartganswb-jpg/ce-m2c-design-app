# Spec sheets + CPQ new engine — completion brief, and the next tie-in phase

Paste into a fresh session and read cold. This records what is DONE (spec sheet generator,
its CPQ tie-ins, and the engine rules added along the way) and frames the next phase:
completing the tie-in with **Vision**, **customer pricing 4.6**, and **order entry tab 7**.

Read `CLAUDE.md` first (ship workflow, multi-session git rules, stale-build trap).
Memories that carry the deep detail: `spec-sheet-generator`, `cpq-splice-checkout-scope`,
`hardware-tag-engine`, `canonical-tag-spec`, `cpq-netsuite-push-model`.

---

## PART 1 — What is COMPLETE

### The spec sheet generator (src/components/SpecSheet/, 📐 in BOM Engine tab 3)

Fully tag-driven, verified on live H1-138 data at every step. One page per CPQ leaf ×
subject; the engine (`hardwareModel.js`) answers everything; `auditPages()` proves each set
against `judge()` independently and runs on every load (currently 0 findings).

- **Paper = the 8.5×11 catalog binder.** Letter is the master (11×17 is gone). Portrait
  standard; doubles auto-landscape (wide section); per-page override buttons. Print + PDF
  emit an all-portrait letter stream with landscape sheets rotated 90° on the page.
- **Doubles**: front rod is the datum; back rod re-seated from the `FRONT:x, BACK:y` tags;
  two-step projection dims; deep doubles print 2 rows/sheet (`· sheet 1/2`).
- **Basics combine 2/sheet** by tag family (materials + rod world + mount; doubles lead,
  deepest projection first): BD+B6, BE+BS, WDB+WB6, WEB+WSB.
- **Returns**: overhead (plan) view on the right (wall at bottom, projection dim wall→pole
  centerline read from the LEAF tag), rtn-only plates at the return's wall leg centred on
  the pole, CENTER rod segment (the bend IS that end's rod), butt-seam suppressed, 2" rod
  stub with break mark, one page PER PROJECTION (page identity includes leaf proj).
- **Ceiling brackets**: geometry stays as modelled (no wall fiction), ONE dim = drop from
  ceiling face to top of pole, plate annotations ride ABOVE the pole.
- **Traverse**: carriers only (never rings), one carrier drawn in the track section,
  carrier drop dim = bottom of track → bottom of eyelet.
- **Passing brackets** (`passing: PASSING` pin tag): one passing ring drawn through the
  open bracket in the section.
- **Catalogs**: finials only, one page per material (Metal/Wood/Acrylic from tags),
  size-packed true-1:1 grid, acrylic finials drawn with collars (`companionsFor`).
- **Names**: `legacyErpId` → `feeItemNo` → `partName` (fee returns show H1-FRPF/MRPF/DBLFR/DBLMR).
- Letter-native type scale (~7pt printed), dim/label spacing pass, notes wrap + sit above
  the footer, row grid charges dim/label room above AND below geometry.
- Tests: `node scripts/specSheetPages.test.mjs` (74) + `specSheetRows.test.mjs` (19),
  prod-shaped fixtures, mutation-tested.

### Engine rules added (Shared/hardwareModel.js — these serve CPQ AND sheets, every assembly)

- **A rtn-only plate follows its RETURN, not the projection axis.** TWO gates carry the
  exemption: the proj axis filter in `admits()` AND the arm↔plate proj pairing inside
  `slots()`. Patching one is not enough. (603-assertion engine suite green.)
- `backRodForArm` / `rodForArm` (SpecSheet/specSheetRows.js): a double arm's own rod is
  the FRONT rod; the back rod pairs by the arm's projTiers cut; a RETURN page prefers the
  rtn-only rear pole and every other page refuses it.
- `pinForChoice` (SpecSheetModal): a pin's identity = partId + tier + cut + returnOnly —
  same code exists as many pins and the flag can be the only separator.

### CPQ new-engine tie-ins shipped this session

- **Splice on the LENGTH step** (`Shared/HardwareConfigurator.js`): orderable at any
  length; REQUIRED over `flow.spliceOverInches` (tab-11 field, blank = 120" one-piece
  shipping limit) — banner, auto-add at CENTER default, re-adds if removed. Flows with no
  curated splice DERIVE candidates from the library by collection scope; joiners are
  diameter-specific so multiple candidates = operator picks (banner says so). The location
  note rides extras → handoff → the per-pin `splice` attachments Vision draws.
- **Checkout catalog collection scoping** (`CPQTab.addOnCatalog`): flow scope = union of
  `manufacturingSpecs.collections[]` across its pinned parts; collection-tagged checkout
  items show only on intersecting flows (Brimar joiner off Fabricut); untagged = global.
- **1.6**: `rtn-only` checkbox now on POLE lines too (the short return rear pole =
  double + back + rtn-only).

### Data/tag state (H1-138) — outstanding items for Stuart

1. **S72 rear-pole pin `returnOnly` tick did not persist** (false in Firestore) — re-tick
   + save the `POLE-FR-MTR-DBL-BACK--DEC-DBL` slot. Everything downstream is wired; the
   DBLFR/DBLMR poke-through fixes itself the moment this saves.
2. FR/MTR **double return pins' proj is `8.5,3.25`** (list) — needs `FRONT:8.5, BACK:3.25`
   (tier map) for the two-step dims to read from tags.
3. H1-138 flow's curated splice extra is **`H2-138SPLC`** (an H2 code, label "Add a splce")
   — replace with the H1-138 joiner or delete and let derivation supply it.
4. The 6" single returns' `feeItemNo` = raw `CE-FEE-4594/6294` — fill pattern codes if wanted.
5. One untagged pin copy per wood single (WSB/WEB/WB6) — sheet unaffected, CPQ finish
   filter reads that copy as METAL.

---

## PART 2 — The NEXT PHASE: Vision, 4.6 pricing, tab 7

### Vision tie-in (VisionHardware.js — see memories `cpq-bay-fab-linkage`, `canonical-tag-spec`)

What exists: the CPQ handoff carries `extras` (with notes), `traverseDraw`/`traverseMotorSide`,
the frozen `renderState`, and CPQTab builds per-pin bracket/**splice** note attachments
(`type: 'splice'`, CPQTab ~line 2526) that Vision draws. The splice location note ("center"
default) is the contract: **Vision draws the splice where the note says.**
To verify/complete: splice attachment placement from the note text (center vs measured
location), returns on the Vision board (the new rtn-only rear pole + rtn plates), and that
Vision reads projection from the 1.6 tags (`pinProjectionOf`) everywhere — no
`customData.projection` leftovers.

### Customer pricing 4.6 (CustomerCollectionsTab.js)

What exists: clientPricing rows (SKU/net/sales per customer), fee rules
(`manufacturingSpecs.feeRule`), checkout tick, plate pricing roles, Fabricut box
write-back, `collections[]` membership (now load-bearing: checkout scoping + splice
derivation read it). To complete: every price the sheet/CPQ/tab-7 shows resolves through
the ONE chain (clientPricing row → Fabricut tier → base) — `priceFor` passed into
`buildCheckoutCatalog`/`buildFeeCatalog` is that chain; keep it single-sourced.

### Order entry tab 7 (QuickShipTab.js — memory `quick-ship-stocked-items`)

What exists: flat SO lines, kits, cut/splice/rush slots via keyword classifiers
(`feeItems(['SPLICE'])` etc.), portal request loading. Known gaps for the tie-in:
- tab 7's splice classifier matches `SPLICE` only — the Brimar item is a "Joiner"; extend
  keywords to `SPLICE|JOINER|JNR|SPLC` to match the CPQ classifier.
- tab 7 fee/billable pickers are "never narrowed by collection" by design — decide with
  Stuart whether the checkout collection-scoping should apply there too.
- The 120" mandatory-splice rule exists only in the CPQ length step; tab 7 cut/kit entry
  has no length gate — decide if it should.
- Portal mirror-sweep (other session's territory, `CROSS_SESSION_CONTRACT.md`): portal fee
  picker not collection-scoped yet.

---

## PART 3 — Infrastructure settings (all of it)

### Vercel (frontend)

- **Auto-deploys production on every push to `main`.** Project: ce-m2c-design-app →
  www.4cosworkcenter.com. No manual step.
- Deploy detection from a shell: poll `https://www.4cosworkcenter.com/version.json` (a
  `{"v":"<ms-epoch>"}` build stamp) until it CHANGES from the pre-push value. The stamp can
  be fresh while code is stale (see next line) — behavior on the page is the real check.
- **Stale-build trap**: a "Ready" deploy can serve OLD code (poisoned build cache). Fix:
  Vercel dashboard → Deployments → ⋯ → Redeploy with "Use existing Build Cache" UNCHECKED.
  `"prebuild": "rm -rf node_modules/.cache"` stays in package.json as a guard.
- **The app is CODE-SPLIT**: tab code (SpecSheet, QuickShip, Admin, CPQ…) never appears in
  `main.*.js`. To grep the live bundle for a marker: extract chunk maps from main
  (`LC_ALL=C grep -oE '\{[0-9]+:"[a-f0-9]{8}"(,[0-9]+:"[a-f0-9]{8}")*\}'` — sweep EVERY
  map, ~31 entries), download each `static/js/<id>.<hash>.chunk.js`, grep those with
  plain-ASCII markers only.
- After deploy the user must hard-refresh (⌘⇧R). The app shows a "NEW VERSION IS LIVE —
  TAP TO UPDATE" toast; a session left on an old bundle throws `ChunkLoadError` when it
  lazy-loads a tab whose chunk hash the new deploy replaced — reload fixes.

### Firebase / Cloud Shell (functions — NOT auto-deployed)

- `functions/index.js`: `netsuiteProxy` (NetSuite OAuth proxy), `authenticatePin`.
  Vercel does NOT deploy these. Local `firebase login` fails on this Mac (localhost
  callback). Deploy from **Google Cloud Shell** (shell.cloud.google.com):
  `git pull` then `firebase deploy --only functions:netsuiteProxy --project ce-m2c-design-collab`.
- **Firestore enforces App Check** → no local/Node script can touch prod data. Bulk data
  changes go through admin buttons inside the authenticated app.
- **Console read recipe** (works while the PIN gate is up — the PIN is app-level only):
  ```js
  let req; window.webpackChunkce_m2c_design_app.push([["__p"+Math.random()], {}, r => { req = r; }]);
  const db = req("1624").db, M = req("565"); // duck-test ops: rJ=collection H9=doc _M=where P=query x7=getDoc GG=getDocs
  ```
  Never brute-force module exports (wedges the Firestore client).
- Dump-to-disk: build a pruned JSON in the page, `navigator.clipboard.writeText` (click
  the page first — focus), then `pbpaste > file`. Clipboard writes FAIL silently without
  focus — verify byte count before overwriting a previous dump.

### The offline verification harness (the fast loop — rebuild in minutes, scratchpad dies daily)

1. Pull the pins+clusters dump via the console recipe (include `passing`, `legacyErpId`,
   `returnOnly` in the keep-list).
2. `curl` the assembly's `manufacturingSpecs.cadUrl` (token-public) → GLB; strip
   images/textures from its JSON chunk → three's GLTFLoader parses headless in Node.
3. Replay `choicesFromAssembly` → `specPages` → placement math with the real modules;
   `buildPageSvg` runs offline for exact fit percentages (copy specSheetPage.js with the
   `./specSheetGeometry` import given a `.js` extension — Node ESM needs it).
   This is how every fix this session was proven before deploy — no screenshots, no loop.

### House rules that keep saving the day

- Multi-session repo: fix forward on `main`, never switch branches, stage only your files,
  `git pull --rebase --autostash` before push. Another session ships concurrently.
- **TDZ**: `useMemo`/`useCallback` DEPS ARRAYS evaluate where written — declare above
  consumers. Struck 3+ times this session alone.
- Fixtures must be prod-shaped (name=code, partId=doc id, trvSetup on pins) and
  mutation-tested; an assertion that cannot fail is decoration.
- Lint 0 errors (`npx --no-install eslint <files>`); `CI=false npx --no-install
  react-scripts build` before shipping component restructures.
- Suites: specSheetPages (74) · specSheetRows (19) · hardwareModel (603) ·
  hardwarePricing (54) · hardwareHandoff (35).
