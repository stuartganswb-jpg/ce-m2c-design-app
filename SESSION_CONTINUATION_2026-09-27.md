# Session continuation brief — 2026-09-27

> **Superseded 2026-10-04 by `SESSION_CONTINUATION_2026-10-04.md`** — read that one. This file is kept as the record of
> 09-22 → 09-27 (the bin lock, row pairs, Reopen for rows, live rod cuts).

For the session that carries on from here. Written by the session that ran 2026-09-22 → 09-27 with
Stuart (display releases, the row-pair route, the bin lock, App Imp triage). Read this first, then
`STATE_OF_THE_APP_2026-09-23.md` for the wider orientation (it is still right; this brief is what
changed since). `CLAUDE.md` binds every session: plan first and wait, requested scope only, no
temporary fixes, trace every change through RTG → floors → WMS → NetSuite before touching it.

## 0. How this session works with Stuart

- **One issue at a time.** He names it, you state the cause and the plan (one paragraph, with the
  downstream trace), he says **go**, you build, verify, push, and report with the commit. He tests
  live and comes back with a screenshot. Do not build ahead of a go, except a defect in the thing
  you just shipped that blocks his test — state it and fix it.
- **He pins you in.** HQ (`/hq`) and the WMS (`/pick-pack`) sit behind a PIN. Open a Chrome tab
  with Claude-in-Chrome and ask; **never type a PIN or credential** — he presses Login. Every
  Vercel deploy reloads the tab and logs it out again, so ask again after each push you need to
  look at.
- **Verify every push in the served bundle**, not by "Ready" on Vercel: pull
  `curl -sL https://www.4cosworkcenter.com/ | grep -o 'static/js/main\.[a-z0-9]*\.js'`, extract
  every chunk map from main with `\{[0-9]+:"[a-f0-9]{8}"(,[0-9]+:"[a-f0-9]{8}")*\}`, fetch each
  chunk to a FILE and `LC_ALL=C grep` a plain-ASCII **runtime** string (comments are stripped;
  non-ASCII may be escaped). Other sessions push between yours — an intermediate bundle often lands
  first without your code. Shared modules (displayRelease, repaintRun, oeReviewPlan) land in the
  shared chunk 99 / 216 / 733 or in main; WMS and 10.5 code in main / 665.
- **Harnesses:** `node scripts/<name>.test.mjs` (pure modules only; anything importing firebase is
  not importable in node). Lint `npx --no-install eslint <file>` must show 0 errors. Full build
  `CI=false npx --no-install react-scripts build` before every push. Ship:
  `rm -f .git/index.lock; git add <your files>; git commit; git pull --rebase --autostash origin main; git push origin main`.
- **Never** run scripts against production data (App Check refuses anyway); every data change is
  an in-app button. Cloud Shell function deploys are Stuart's.
- **Another session owns the finishing floor** (`FinishingFloor/*`, recipes, coats, hand step,
  JFP runs on the floor, the Urgent tick, the Work Order Queue header). Hand findings over; do not
  edit there. Grace's App Imp cards (B4/B5 JFP, hand-finish first step, "parts complete") are theirs.

## 1. Where the live work stands

**The floor rule (hard):** shop, finishing and WMS gates read the document's own facts, never the
door. A row / Order Entry to-be-finished group is ONE finishing + shop pair by row AND finish, like
a CPQ split; no NetSuite WO for a pair; small parts wait on the custom pole; staging requires the
small-parts label and the shop's completion label scanned together (both barcode the finishing
work order id); Push to Active Floor only after the match.

**Tabletop (10.5 build "Fabricut H1 Tabletop × 50", SO60551 + SO60565):**
- SO60551 was split whole by RTG, then RETIRED and released by rows (WO-SO60551 / SHOP-SO60551
  closed from 10.5; PKG-SO60551 closed). SO60565 was always on the row route.
- Base Front 1 (SO60565): the old per-line documents — complete.
- Base Front 2 (SO60551): H1-138TRV/P06 on the floor (WO-OE-SO60551-BASE-FRONT-2-P06-1790428792244
  + its shop sibling). The H1-138CC/P06 line needed a decision; that is fixed as of 9bab8a27 — the
  review should now plan ONE pull, H1-138CC/P, need 50, 62 available in 138R-010. **Stuart was
  about to press ▶ Try again on Base Front 2 — start there.** HTTENDSTOP × 100 is stocked, picked
  by the WMS off the SO Pack card.
- Base Front 3 (SO60551): not started (H1-1R/EP2, H1-1BF/EP2 — plated lines → the plater).
- Top Row 1 / 2, Base Front 4: no lines on the sales order yet (the CPQ breakdown has none for them).
- **Still unproven live:** the first row PAIR through staging (two scans → one document → Push to
  Active Floor) and the 6 am RTG stock refresh on a real morning.

**Wall display (10.5 build "Fabricut H1 Wall Board × 35", SO60585 + SO60586):**
- Nothing auto-released. Stuart closed both sales orders from the WMS SO Pack screen on 9/23
  ("redoing") before any row started; that closed the whole-order documents too and 10.5 read every
  row as DONE. Since abcecabe each order shows **⟲ Reopen for rows** on 10.5: the sales order comes
  back Dispatched on the row route, the whole-order documents stay closed and marked retired, the
  pack card closes, rows read NOT STARTED. **He has not pressed it yet** (his last word: SO60585
  "has not been started at all" — the Completed on SHOP-SO60585 is the close's stamp).
- Lines on both are base items (tab 7 / CRM shapes), so ↻ Fix line codes will not offer.

**App Imp (HQ tab, read via Chrome):** Eric's cards resolved with test lines: rod cut (9/25),
JFP put-away inactive twins (9/24), receiving cart per-line bins (9/22), RTG View override,
Bin Count (his note answered; awaiting his retest). Sandra's convert bin (9/25) resolved.
Open and undiagnosed: Eric 9/19 receiving bin-transfer memo length (every WMS memo passes
`nsMemo` 40-char cap — needs the 11.1 transmit-log row). Grace's finishing cards → other session.

## 2. What shipped 9/25 → 9/27 (all verified in the served bundle)

| commit | what |
|---|---|
| 4c82b141 | **The bin lock.** Live-bin rows carry `{ bin (UPPER), name, id, qty }`; Bin Count rows keyed by NetSuite bin id (NetSuite has TWO "Production Stock" bins at CE — 110 + 190 of H1-75SR — which collided into one React key and left ghost rows on every search). `lockBin` in PickPackApp guards every typed destination bin before a post (pack put-away, JFP re-post, receiving, plating pull + put-away, rod cut, convert single/cart, ring pack build/break/repack, transfer, count push): must exist at this location (resolved by id, posted with NetSuite's spelling); near-misses like PLANTING/PLATING refused; twins named and the exact spelling required; only the Transfer tab may create a bin (typed twice). `ensureBinExists` lives only in `createLockedBin`. |
| 93825d70 | Convert accepts the scanned bin when the target has no home bin and writes it back as home; `activeItemOf` (Shared/repaintSource) + the WMS `resolveItemDetail` read ACTIVE items only (inactive twins had been stamped on two JFP orders); the JFP re-post re-resolves the active item; rod cut resolves an unsynced stick live; the count search reads a deferred value (typing lag). |
| 5e205c19 | `raisePaintRun` (the one JFP/repaint writer) reads open paint-only RTG records for the same item and requires the door's `confirmDuplicate` answer; a confirmed second run is stamped `duplicateOf`. Pure filter in `Shared/paintRunGuard` (harness 13). |
| abcecabe | 10.5 Review → carries the row's undecided line indexes (`hq_oe_review_lines`); Order Entry Needs loads that one rows-released order for that review only (`loadOeNeeds({ keepSoId })`), never sweeps it with Generate. **⟲ Reopen for rows** (`reopenForRowsCheck/Text/SoPatch`, `splitRetiredStamp`; `splitRetiredDoc` honours `splitRetired: true`). |
| a1581043 | Rod cuts: both benches (WMS Rod Cuts, Stock View cut tool) resolve a stick the library lacks live from NetSuite — id, item type, `BUILTIN.DF(custitem_bit_product_type)` — via `Shared/nsItemLookup` (harness 8). The library is consulted, never required. Service/fee/description types refused. |
| 23645a7d | A 10.5 row line carries the BASE item with the finish beside it, never CPQ's billing SKU (`…/P` for paints, exact `/EP2` for plating): `rowLineErpOf`; `billedErp` kept on the line; **↻ Fix line codes** on 10.5 repairs lines anchored before the rule (used on SO60551: H1-138CC/P → H1-138CC, H1-1BF/EP2 → H1-1BF). displayRelease harness 109. |
| 9bab8a27 | `oeDoorOf(part, finish, inventory)`: a line with an in-house finish on a raw that has a `/P` record is MAKE — pull the /P shelf, convert from the raw behind it, source only the raw shortfall. `routeShort` decides sourcing BEFORE the assembly test, so a bought casting modelled as a NetSuite assembly (H1-138CC ← CAC Industries) is a PO, not a shop WO. |

Earlier in the week (still relevant): ee973195 collapse of the five "is Order Entry order" tests
(`reopenQuote.isOrderEntryOrder`), 8a30234d row pairs (`Shared/rowPairShape` + `rowPair`),
1522879b CPQ split = one pair per finish, 1d500d7d SO Pack closed section, 19da8087 receiving
per-line bins, 98008ff8 the material grid (`materialGrid` + `MaterialGridCard`) and the 6 am
stock refresh (`hq_config/floor_stock_refresh`). Full detail in `STATE_OF_THE_APP_2026-09-23.md`.

## 3. Waiting on Stuart

- Press ▶ Try again on Base Front 2; then the first PAIR through staging and Push to Active Floor.
- Press ⟲ Reopen for rows on SO60585 and SO60586, then start Row 1 of the wall.
- Merge the two Production Stock bins in NetSuite (until then anyone posting to that name is asked
  for the exact spelling).
- Eric's two failed JFP orders (HZLWP8135/B5, /B4): the ↩ re-post now posts against the active
  item; if he already adjusted by hand, leave them.
- Eric's HWMMP835/BL → HWMMP635/BL cut on the WMS bench (live NetSuite read).

## 4. Named, not built

- Review modal wording for a pair (it still speaks of NetSuite work orders / FLOW1 on the base
  assembly; a pair raises none).
- RTG double listing of CPQ-born display orders; a custom-only CPQ order writes a pick-only fin doc
  born Complete; the estimate transform on tab 7; whole-order rows counted as started for display
  demand.
- Order Entry Needs excludes rows-released orders from its board; a per-row view of their demand
  lives only on 10.5 and the Snapshot.
- The count screen cannot adjust an item OUT of a bin it has no balance row in (Brief D).
- Payments (NMI pay link proven in sandbox 9/23): document buttons, NetSuite posting, vault.

## 5. Memory and files to trust

Memory (`~/.claude/projects/…/memory/`): `floor-same-every-door`, `row-pair-rule`,
`bin-lock-rule`, `paint-run-guard`, `order-entry-starts-on-rtg`, `rod-cuts-wms`,
`deploy-verify-asset-manifest`, `finishing-floor-other-session`, `one-issue-at-a-time`,
`working-agreement`. Code of record: `Shared/displayRelease.js` (+ `scripts/displayRelease.test.mjs`),
`Shared/rowPairShape.js` / `rowPair.js`, `Shared/oeGenerate.js` / `oeReviewPlan.js`,
`Shared/stagingKey.js`, `Shared/orderStatus.js`, `Shared/pickLines.js`, `PickPack/PickPackApp.js`
(the bin lock is near `loadBinIndex`), `HQ/DisplayBuildsPanel.js`.
