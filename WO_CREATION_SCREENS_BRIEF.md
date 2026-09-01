# Stock View · Sales Snapshot · Master Library — Work Order Creation Handoff Brief

*Written 2026-08-26. Scope: the three WORK-ORDER-CREATION screens and the delete/transmit spine
built around them on 8/25–26. The sibling brief (`CPQ_ORDERENTRY_TAB11_BRIEF.md`) covers the sales
side and carries the same operating procedures — read its §0 (pin-in login, Vercel verification,
Cloud Shell) verbatim; it applies here unchanged. Governing doc: `APP_ARCHITECTURE_BRIEF.md`
(§4 H1 principle + canonical fields).*

## ⛔ WORKING AGREEMENT (Stuart, 2026-08-31) — binds every session

1. **Plan first, always** — state the plan and WAIT for approval before editing code, shipping, or
   changing production data. Reading and measuring need no permission; changing does.
2. **Requested scope only** — exactly what was asked, nothing beside it. Adjacent problems get
   NAMED, not fixed in passing. Working, tested code is not yours to touch because you are in the file.
3. **No temporary fixes** — fix the cause, or say it cannot be done properly and stop.
4. **Look downstream — RTG is the single source of truth.** CPQ / Order Entry feed work orders, the
   finishing floor, the shop floor, WMS and NetSuite, all hanging off the ONE RTG spine. Before any
   change, trace it forward through every one of them and say so in the plan. No change may break
   that linkage.

Full text: `CLAUDE.md` (top).

---

**Team-facing explainer already exists** — the in-app **User Guide tab → Work Orders** section and
the shareable page https://claude.ai/code/artifact/629a7307-70a0-4dfe-9749-e67bb564ce77. Keep both
current when you change these screens (`UserGuideTab.js`, plain JSX).

---

## 1. What the three screens are (one line each — the guide has the detail)

- **4. Master Library** — one item from its card: RTG-parked raw builds; outsourced→plating with a
  BLOCKING live stock check; the in-house finishing run (only path with a live component check,
  releases DIRECT to floor + queues the NetSuite WO); the make-up cascade; **JFP** (no assembly, no
  NS WO, closes by inventory adjustments — checks item existence, never quantity).
- **12.5 Stock View** — batch builders: WO grid (routes by code suffix, explodes assembly BOMs),
  PO builder (vendor POs + plating demands + AUTO milling WO when the raw base is short — uses the
  session-cached stock pull), RAW cores (shop route), 3-TIER (raw→shop/PO, /P→Convert to-do,
  /EP→Plating to-do, painted→finishing).
- **Sales Snapshot** (inside 12.5) — sales-driven replenisher: recommends from 12mo NetSuite sales
  + live stock; bought→per-vendor POs; made→WOs parked in RTG carrying a complete verbatim
  finPayload; both→chooser; pole cut orders auto-raise and GATE the WO; ⇄ convert suggestions;
  WMS urgent flags.

**The /P rule (Stuart-confirmed):** /P phosphate cores are STOCKED. A custom H1 in-house finish
always PULLS /P from the shelf (Model B in `Shared/finishedGoodsRun.js` + `routeFinishedItem`'s
paint-rollup). Phosphating raw→/P is a separate BULK operation via `convert_demand` on the WMS
Convert tab — never per order. Model A (Brimar/H2 assemblies with pins) takes the BOM literally.

## 2. Shipped on these screens 8/25–26 (all on main, verified)

- **Canonical `itemCode`** on every WO writer (`workOrderContract.withItemCode`; `woItemCodeOf`
  reads it first). 11.1 → **🪪 Stamp Canonical Item Codes** backfill (dry-run on Cancel) — ask
  Stuart if it has been RUN yet.
- **Deletion ledger** (`orderLifecycle`): `softDeleteOrder` (tombstone: doc kept, status
  'Deleted'/'CANCELLED' + deleted:true) / `hardDeleteWithLedger` (full copy must commit BEFORE the
  destroy) → append-only `hq_deletion_log`; RTG 📜 panel is the master view. RTG's delete also
  closes linked floor docs. ⚠ **firestore.rules deploy still pending** — until Stuart deploys,
  ledger writes fail (tombstones still work; hard deletes REFUSE — correct but surprising).
- **⚡ Auto-Release** (RTG): per-brand toggle `hq_config/rtg_auto_release`; releases one order at a
  time off the live mirrors; only orders created AFTER enable; app-created SOs wait for
  `nsInternalId`; rod-cut-gated / stopped / route-ambiguous always wait; every skip logged.
- **✎ Edit PO** (RTG): parked POs editable until NetSuite has them — qty/rate/remove/add (adds
  resolve from the library, refuse without a NetSuite id; blank rate = vendor purchase price).
- **Snapshot UX**: toolbar wraps + a **sticky green Generate bar** appears under the grid the
  moment any Order qty is staged (all three views) — the "no button to save" fix.
- **BufferedInput** on every order/qty box (and tab 11) — the every-other-letter latency fix.
- **Customer-code search** (`Shared/aliasSearch`): Library/Mass-Update/Stock-View/snapshot search
  fields + tab 7 + 4.6 match Their SKU + Fabricut pattern #s; Library cards show ⤿ their numbers.
- Transmit spine context (affects RTG): quotes/SOs auto-queue from CPQ/tab 7; RTG = master in/out
  page (⇄ panel, Transmit Log, Deletion Ledger). Tab 12 = pre-flight/exceptions only.

## 3. The open backlog (from the 8/25 four-agent audit — priority order)

1. **FIN snapshot generator routes EVERYTHING to FINISHING** (`createStockFinWOs`): unconditional
   `routeTo:'FINISHING'`; local `finishOf` returns 'P' for /P (vs `finishCodeFromErp`'s ''). A raw
   core or /P ordered from the FIN view becomes a finishing WO (PENDING-RECIPE / recipe 'P'). Should
   mirror the grid push's routing and send /P to `convert_demand`. ⚠ Stuart believed another
   session fixed raw-vs-/SG here — only the GRID push has it; check whether that session ever
   pushed, and reconcile before rewriting.
2. **Setup Queue scrap re-make** derives recipe by hand — a /P re-make lands as spray recipe 'P'.
   Use `finishCodeFromErp`.
3. **`finishStream` dropped at RTG dispatch** — `pushToFinishing`'s enrich branch never copies it
   (the elbow pole-recipe exception is lost on Stock View WOs).
4. **Library direct-to-floor runs carry no scheduler keys** (`buildStockFinPayload` nulls
   paintSize/productType/paintSizes, no poles branch) → Library pole runs schedule as small parts.
   Also `stockRun`'s itemCode stamp is ungated (can stamp 'PENDING').
5. **autoSplit sales fin doc**: urgent/needBy not carried; no `woRecipeCode` safety net; SO chip
   hidden (readers test `type==='sales'`, writers stamp `orderType`).
6. **No awaitingConvert/awaitingPlating gates** — only rod cuts gate a WO; generalize the
   `awaitingRodCut` pattern; link demand↔WO ids (urgent-core clear is manual; `forPlating` WO not
   linked to its plating_demand).
7. **BOTH-sourced defaults differ** (FIN chooser defaults PO; RAW/TIER default make w/ ⚖ badge);
   FIN also skips `sourcingOf` and the unlinked-part guard.
8. **PO-builder plating short-check uses session-cached nsStock** (no pull = assumes 0; ignores
   onOrder/WIP); grid `isPlating` regex `/EP[1-6]/` vs `hq_outsource_finishes` (MEP2/P25/EP7).
9. **JFP quantity** never checked; JFP inherits the template doc's id/image/dims.
10. Cosmetic: jobs delete no cascade to already-split children; `reorderFor` doesn't return
    shortfall; fin Management demo seeder violates the tasks contract; stockRun recipe lacks
    the `finishCodeFromErp` fallback.

## 4. Stuart's to-dos to chase (operational, not code)

- Deploy `firestore:rules` from Cloud Shell (`hq_deletion_log`) and the functions portal
  `!deleted` filter.
- Run the 11.1 item-code backfill dry-run and read the unresolvable list.
- First real CRM Approve verifies the estimate→SO transform (sibling brief).
- Decide when to flip ⚡ Auto-Release on per brand.

## 5. Key files
`Shared/orderLifecycle.js` (close/delete/ledger/orphans) · `Shared/workOrderContract.js`
(withItemCode/woItemCodeOf/tasks) · `Shared/finishedGoodsRun.js` (Model A/B + stock check) ·
`Shared/finishRouting.js` · `Shared/poleCut.js` (cut orders) · `Shared/stockRun.js` ·
`StockViewTab.js` · `LibraryTab.js` · `RTGDispatchTab.js` (board, auto-release, PO edit, ledger
panel, transmit review) · `NetSuiteSyncTab.js` (backfill + pole tags) · `SetupQueue.js`.

Memories: `wo-creation-audit` (the backlog above, kept current), `canonical-item-identity`,
`rtg-netsuite-transmit`, `finished-goods-wo-model`, `order-lifecycle-authority`, `rod-cuts-wms`.
