# Joiner-Rollup Incident (SOLVED) + H1-2TRV Session Handoff — 2026-08-31

*Two things live here: (1) the joiner incident — checkout/extras items not pushing to NetSuite as
item lines, their dollars riding the rollup — **root-caused and fixed the same evening** (§1: the
CPQ resolved the push against a 366-part list while pricing against 3,464); (2) everything shipped
and every setting touched on 2026-08-31, so nothing has to be rediscovered.*

---

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

## 0. Operating the session (unchanged, reuse it)

- **Pin-in**: Stuart pins you into the live app via **Claude-in-Chrome** (his real Chrome). He types
  Factory Portal login + Enterprise PLM PIN — never enter credentials; clicking Authenticate on his
  pre-typed PIN is OK. Auth survives SPA tab-switching, NOT reloads. Native confirm/alert dialogs
  freeze CDP — ask Stuart to dismiss.
- **Deploys**: push to `main` → Vercel auto-deploys (~2 min). Verify: `curl -s
  https://www.4cosworkcenter.com/version.json` (ms-epoch string!) vs `git log -1 --format=%ct`;
  marker-grep the live bundle with plain-ASCII **string literals** (comments minify away; CPQTab/
  HardwareConfigurator live in `main.*.js`, tabs are lazy chunks — sweep `/asset-manifest.json`).
- **Git**: multi-session repo — never switch branches, stage only your files, `rm -f
  .git/index.lock`, `git pull --rebase --autostash` before push, fix-forward on main.
- **App Check** blocks all local scripts against prod Firestore. Read prod data by driving the
  authenticated app; **React-fiber scraping works well**: walk `__reactFiber$`/`__reactContainer$`
  from `#root`, scan `memoizedState` chains for the arrays/objects you need (used repeatedly today
  to dump jobs, payloads, library records, the live engine model).
- Offline suites: `node scripts/{hardwareModel,hardwareHandoff,kitSeed,specSheetPages,specSheetRows}.test.mjs`
  (624/45/48/79/19 — all green at session end).

---

## 1. ✅ SOLVED 2026-08-31 (evening) — the CPQ pushed from a NARROWER parts list than it priced from

**Root cause (proven on live prod data, commit 21b43b0):** `CPQTab` splits one `Approved_Designs`
read into two state lists — `libraryParts` (only `partClass` ∈ Inventory | Fee | Alias, plus
`checkoutSelectable` ticks) and `liveAssemblies` (`Assembly` | `Master Assembly`). The configurator
is handed BOTH (`parts={[...libraryParts, ...liveAssemblies]}`), so it priced the joiner correctly.
The NetSuite resolver was handed **`libraryParts` alone**, so `matchPart('CE-INV-52742')` searched a
list that structurally could not contain it → the line fell into `unresolved` (a warning nobody
reads at save time) → its $16 rode the `BRIMAR — GENERATED` rollup. Every order, both operators,
no staleness required.

**Why tab 12 "disproved" it:** `ERPPushPullTab` loads `Approved_Designs` WHOLE (no class filter, no
brand filter). The pre-flight that included `52742 · Joiner ×1` was run through a different parts
universe than the save path — the disproof of "the resolver drops it" tested the wrong tab.

**Live measurements (React-fiber read of the running CPQ tab, 2026-08-31):**
- `libraryParts` = **366** parts (347 Inventory + 19 Fee) ← the entire save-time resolver universe.
- `liveAssemblies` = **3,098** parts, and the joiner is in it:
  `CE-INV-52742 / H1-1JNR-16G / partClass "Assembly" / checkoutSelectable **false** / NS id 52742`.
- Full library (tab 12's view) = **6,871** docs.

**The bigger half of the same seam:** **2,614** finish-variant SKUs (`BASE/P`, `/EP`, `/BS`, …) are
`Assembly`-class too — only 109 finish variants were in the 366. `routeFinishedItem` looks up
`${base}/${CODE}` in that same list, so from the CPQ save path it almost never found the finished
SKU and pushed the **BASE mill item** where the phosphated/plated stock item should have been
consumed. Tab 12 / RTG routed those correctly the whole time; the two paths disagreed because they
read two different libraries. ⚠ Expect CPQ-saved orders from now on to carry finished-variant item
lines where they used to carry base items (this is the correction, not a new bug) — watch the first
few in the RTG Transmit Log.

**The fix (21b43b0):** one parts universe on both sides of the save — `txData` now carries
`[...libraryParts, ...liveAssemblies]` deduped by doc id. `src/components/HQ/CPQTab.js` ~line 2991.

**Not affected:** Order Entry / Quick Ship (tab 7) loads `Approved_Designs` brand-filtered with NO
class filter; RTG queries by code without a class filter.

### Open follow-ups from this incident
- **`nsId` falls back to `legacyErpId || itemId` before `'UNMAPPED'`** (`nsTransmit.js:67`), so a part
  with no NetSuite id pushes `item:{id:"H1-1JNR-16G"}` and NetSuite 400s the whole transaction. The
  `LINES_UNMAPPED` guard added in cc85d66 therefore guards a path the code rarely reaches.
- **The fee-class skip is still silent** (`nsTransmit.js:196`): a mis-classed record still vanishes
  from a push with no record anywhere. Make it auditable.
- **`matchPart`'s fuzzy prefix fallback now runs over ~3,464 parts instead of 366** on the CPQ path
  (it always did on tab 12). Exact id/code/name matches still win first; watch for a legacy
  STYLE_SWAP line resolving to a different item than before.
- The **64904 vs 61502 rollup-item** difference was never explained; most likely tab 12's `cpqFlows`
  snapshot had not loaded when that pre-flight built its preview (`flowDoc` undefined → default
  61502 + the "no dedicated rollup item" warning). Re-check rather than assume.

### NetSuite manual cleanup (Stuart/team, in NS — totals unchanged)
Add item **52742** and reduce the BRIMAR — GENERATED rollup by the same amount:
SO60147 1×$16 · SO60151 1×$16 · SO60152 2×$32 · SO60158 1×$16 · SO60166 2×$32 · SO60168 2×$32 ·
SO60169 1×$16 · SO60170 (verify, likely 1×$16). Also: old estimates **QUO120/121/122** carry
joiners at **$0** (pre-08-28 extras bug era) — review if still open.

### Guards shipped earlier the same day (commit cc85d66) — keep them
- `assertFreshBundle` gates CPQ `handleFinalizeQuote` (both save buttons): a tab older than the live
  deploy refuses to save; the cart survives as a draft.
- `buildNsTransaction` **hard-blocks the queue** on unresolved/UNMAPPED TAGS, checkout-addon and
  trvcfg lines (`LINES_UNRESOLVED` / `LINES_UNMAPPED`), naming the lines and dollars.
  ⚠ Note what this meant between 18:52 and the fix: those guards turned the silent rollup into a
  **hard refusal to queue** for exactly the Brimar-with-joiner orders. Anything entered in that
  window may be saved-but-not-transmitted — check the RTG Transmit Log / ns_outbox for gaps.

## 2. Shipped 2026-08-31 (all on main, deployed, tests green)

**H1-2TRV tri-mode (2cec198)** — "the front of a double is a question":
- New `frontLayer` AXIS in `Shared/hardwareModel.js` (order 22, `requires:{setup:'DOUBLE'}`, scope
  rods). Values are DISCOVERED: front-capable TRACK votes TRACK, FASCIA votes FASCIA — only an
  assembly holding both ever grows the question; `requires` keeps it closed until Double is picked.
  `activeAxes` gained the generic `requires` gate (implied-aware `eff()`).
- Mode map: SINGLE = 1 track, no rings, no back-tier steps. DOUBLE+TRACK = both tracks, no rings.
  DOUBLE+FASCIA = front track + front TRV_ENDs suppressed ("the front layer is the fascia…"), rear
  track is the order's track, ring step opens. `carriesRings` FASCIA branch is now
  `ctx.frontLayer==='FASCIA'` (a lone-fascia double still implies it via the implied axis).
- TRACK slots **auto-pick** (`trackAuto` in HardwareConfigurator, gated on `answers.setup` being
  answered — an untouched screen never bills). Step stays VISIBLE (carries the finish fee);
  trackAuto feeds the TRV_END settle gate, so drive answer auto-settles the correct ends.
- Verified live end-to-end incl. drive filtering (Motorized → 2× HSOM-04 Somfy billed, plug gone)
  and Brimar/solid-flow regression (no frontLayer question — structurally impossible without a
  FASCIA choice; test: "a solid double never asks about its front layer").

**Paint-match upcharge (a725e31 + e12528e + 81deae2)**:
- Extras on SLOT steps are **slot-scoped** (`slot` field on the extras entry) — the same fee on
  Front and Back Track steps is two independent ticks, two lines. Length-step extras (splices)
  unchanged. extraLines/handoff filter/UI lookups all match code+slot.
- A FEE item (canonical fee test) ticked on a TRACK step arms `matchFinishOverride`: THAT track
  wears the FASCIA's live finish (its exception first, else the config finish) — bill line
  `finishCode`, floor sheets, AND the 3D render (texture override bypasses noFinish/material
  gates). Derived, never copied — change the fascia finish and the track follows.
- The fee itself **prices at the matched finish's variant** (H1-TRKFUP → H1-TRKPF painted /
  H1-TRKEPF plated) via priceChoice with the matched finishCode.
- **A TRACK never takes the config finish uninvited** (81deae2): role-scoped rule in lineFinishFor
  + textureOverrides — stock bronze/champagne unless the fee is ticked (was silently telling the
  floor to paint every track for free).
- Reopen fidelity: CPQTab engineSeed prefers `engineConfig.extras` (slot fields survive).

**Document identity (297065a)** — "the 1.6 label never leaves 1.6" (invoice S060147 exposed it):
- `Shared/hardwareHandoff.js handoffLine`: line name = **master library `itemName` first**, pin
  label only when nothing resolves. Kills "H21INPOLELEFT" descriptions on docs/floors/NS.
- **clientSku end-to-end**: survives the CPQTab quote-merge; checkout add-ons carry it
  (feeRules `buildCheckoutCatalog` gained `skuFor`, buildAddOnLines passes it, CPQTab provides it);
  `Shared/lineClassification.customerDocLines` swaps it in as the printed Item # on MONEY docs
  (ours preserved as `houseItemNo`; floors/NS untouched).
- **perFoot/feet + hidden now survive the quote-merge** (they were dropped — the S060147 invoice's
  "1 × $9.00" for an 8 ft pole, and hidden parts printing on money docs). NOTE: already-saved
  orders keep their saved names/stamps — fix-forward only.

**Transmit guards (cc85d66)** — see §1.

**Earlier same-day (context)**: e43d39f settle restraint (nothing settles before its world);
H1-2TRV tag repair (nut pins → `trv: fclip` (+`setup: double` on the rear one), second-position
fascia rows' item #s cleared → parked; "the fascia is never doubled").

## 3. Settings / data state (live now)

- **Tab 11 → BRIMAR/H1-2TRV flows**: H1-2TRV flow's Configurator Add-On Items has ONE row:
  code **H1-TRKFUP**, label "Custom finish — paint this track to match the fascia", Step **Track**
  (substring-matches both Front Track and Back Track steps). H1-COLF1 was WRONG (removed).
  ⚠ Tab-11 BufferedInput commits need real Enter-keydown + focusout when driven synthetically —
  a plain synthetic blur does NOT commit (a junk `FEE` row got created that way; deleted).
- **Fee items**: H1-TRKFUP "2\" Traverse Track Finish Upgrade" (Fee, 1 client mapping, variants
  ⤿ H1-TRKPF / H1-TRKEPF). H1-COLF1/2 = Custom Finish Single/Multi Color (different purpose).
- **Joiner record**: CE-INV-52742 / H1-1JNR-16G, Assembly, productType Joiner, NS id 52742,
  Brimar clientSku **DFR7000** @ $16.
- **1.6 H1-2TRV**: ⚠ the team re-saved the assembly mid-day (new 37 MB GLB
  `ce_H1_2TRV_1788208405709.glb`, ~25 new pins, ceiling-mount expansion — mount tags on brackets
  H1-2TRV-WB/-CB/-DRTWB are DONE). **Six new pins are untagged and resurrect the SOLID world**
  (Rod Type question): H1-2RCTWR ×2 (CE-INV-62616), H1-2RCTAR ×2 (untagged copies of CE-INV-2446),
  H1-2RCTACROD4 (CE-INV-55958), and one untagged copy of the H1-2TRV track (CE-INV-52988).
  Deliberately NOT guess-tagged (mid-build). Fix pattern: fascia copies → `trv: fascia` +
  `rod: front`; track copy → `trv: track`; hidden riders → `trv: fclip`. No flow regenerate needed.
  Also: a first GLB fetch can fail transiently (37 MB); the viewer caches the failure — reload.
- **BRIMAR flow** now has `nsRollupItemId = 64904` in their runtime (see §1 clue).

## 4. Files touched today
`Shared/hardwareModel.js` (frontLayer axis+gate, carriesRings, mode-C suppression) ·
`Shared/HardwareConfigurator.js` (trackAuto/settle, valueLabel/AXIS_LABEL, hint, slot-scoped
extras, matchFinishOverride, lineFinishFor/textureOverrides track rules) ·
`Shared/hardwareHandoff.js` (library-name lines) · `Shared/feeRules.js` (skuFor/clientSku) ·
`Shared/lineClassification.js` (clientSku swap on money docs) · `Shared/nsTransmit.js` (hard
unresolved/unmapped blocks) · `HQ/CPQTab.js` (merge carries clientSku/perFoot/hidden, skuFor,
engineConfig.extras reopen, assertFreshBundle on finalize) · `scripts/hardwareModel.test.mjs`
(tri-mode block; ring tests updated to the frontLayer doctrine).

## 5. Parked / open beyond the incident
- H1-2TRV: the six untagged new pins (team's ceiling build) — walk shows Rod Type until tagged.
- Multi-color fee H1-TRKFUP vs H1-COLF2 offering — Stuart's call if multi-color belongs on tracks.
- Bronze/champagne **auto-match** ("associated in library to match fascia") — which stock color a
  given fascia takes is NOT yet modeled; the track line simply carries no finish when unpainted.
- Portal mirror-sweep still pending (frontLayer axis, slot-scoped extras, checkout scoping).
- Cloud Shell deploys Stuart owns: firestore rules (rod_pieces, hq_deletion_log).
- Old orders keep old line names/stamps until reopened + re-saved.

Memories updated: `hardware-tag-engine` (tri-mode/paint-match/doc-identity),
`cpq-netsuite-push-model` (incident + guards).
