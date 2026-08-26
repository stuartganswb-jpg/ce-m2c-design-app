# Shop Floor Catch-Up — Session Handoff Brief

*Written 2026-08-26. Scope: the SHOP FLOOR app (`src/components/ShopFloor/ShopFloor.js`, 1,458
lines + `ShopEngineering.js`, 991 lines) — essentially frozen since 2026-07-18 while the rest of
the app modernized around it. Stuart: "this whole portion of the app has received little attention
recently and time to catch it up to the rest."*

**§0 Operations — identical to the sibling briefs.** Read `CPQ_ORDERENTRY_TAB11_BRIEF.md` §0 for
the full procedures and reuse them verbatim: **Chrome pin-in login** (Stuart authenticates the
Factory Portal email gate + the per-load PIN; drive his Chrome via find→refs, never coordinates;
SPA-switching preserves auth, reloads don't), **Vercel verification** (version.json build stamp vs
commit time; ShopFloor is a lazy chunk — sweep `/asset-manifest.json`, string-literal markers
only), **Cloud Shell** for functions + firestore.rules deploys (rules deploy for `hq_deletion_log`
may still be pending — check with Stuart), and the multi-session git rules from CLAUDE.md.
Governing conventions: `APP_ARCHITECTURE_BRIEF.md` §4 (H1 principle, canonical `itemCode`,
deletion ledger, "ask what the item IS").

---

## 1. What the shop app is (60 seconds)

PIN-gated (via `authenticatePin` callable; perms doc `shop_config/permissions`, edited in HQ
AdminTab; `superadmin`→`admin` collapse; ALL role gates client-side — rules are flat `isAuth()`).
Tabs: **floor** (machine cards) · **milling** (HQ intake + backlog) · **scheduler** ("AI" queue +
production tracker) · **custom** (the day-to-day tab: staged/active custom orders, phosphate +
per-config checklists, Complete & Label) · **logs / export / reports(QC) / livio(handyman)** ·
four engineering tabs (routings/programs/tooling/machine config) in `ShopEngineering.js`.

Data: `shop_custom_orders` (written by RTG autoSplit + pushToShop; mirrored to the fin sibling via
`workOrderContract.mirrorCustomStatusToSibling` — that mirror is what Setup Queue/WMS/Where-is-it
read), `shop_milling`, `shop_schedule`, `shop_routings/programs/tooling/materials`,
`shop_failures`, `shop_livio`. The `shopDb` wrapper prefixes bare names with `shop_` (duplicated
in both files). `writeLog` goes to `hq_logs` (NOT `shop_logs` — see stubs).

Lifecycle of a custom order: RTG splits/pushes → `shop_custom_orders` `Pending` → **▶ Start**
(mirrors `In Process`, and — critically — `releaseSiblingToPickPack` is the ONLY thing that opens
the WMS pick for a split order) → checklists (advisory) → **Complete & Label** (ZPL; `Sent to
Plating` raises `plating_demand` once; mirror `Complete` is the signal everyone reads) → closed
only by HQ (`closeOrderEverywhere` / RTG buttons / delete cascade).

## 2. The correctness holes (fix these first — they break the rest of the app's promises)

1. **Move-by-DELETE at intake** — `handleAcceptHQOrder` (ShopFloor.js:306) copies five fields into
   a new `shop_milling` doc then **deletes the `shop_custom_orders` doc**. `orderKey`/
   `finSiblingId`/`quoteId` linkage is destroyed: `linkedDocsOf` can never find the order again,
   `closeOrderEverywhere` silently closes nothing, RTG's Daily Job Log loses the SHOP stage.
   Same pattern at `dispatchToAIQueue` (:345, milling→schedule). Fix: stamp
   (`status:'In Milling'`, `millingId`) instead of deleting; keep the doc as the spine.
2. **`SO: undefined` on cards AND printed labels** — `autoSplitSalesOrder`'s shop payload
   (RTGDispatchTab.js:924) writes `salesOrderId` but no `soNum`; the shop UI and Zebra label read
   `order.soNum` (:964, :1103, label path). `pushToShop` writes it; the split path must too.
3. **No canonical `itemCode` on shop docs** — neither RTG shop payload (RTGDispatchTab.js:924,
   :1367) is wrapped in `withItemCode`; cards read `order.item || order.partNum`. Wrap both, read
   via `woItemCodeOf`. (Found in the 8/25 audit as finding #5; still open.)
4. **Queue cross-contamination** — the milling intake picker (:762) lists ALL `Pending` custom
   orders (never filters `routeTo`/`isStock`), and the custom tab (:933) shows Stock-Milling docs.
   The same order appears in both tabs, can be started from either, and accepting a custom-fab
   order into milling DELETES it (see #1). Filter both sides.
5. **Un-ledgered bulk deletes** — `clearToolLibrary` / `clearAllMaterials`
   (ShopEngineering.js:98-113) raw-batch-delete everything with no `hq_deletion_log` entry
   (the 8/25 sweep covered `handleDelete` + the nuke, not these). Route through
   `recordDeletion`/`hardDeleteWithLedger`.
6. **The floor is blind to holds/closes/urgent** — HQ writes `held`/`heldReason`/`closed`/
   `urgent*` onto shop docs (`orderHold`, lifecycle, RTG); the shop UI renders none of them. An
   operator can start a stopped order.

## 3. Convention catch-up (bring it level with the rest of the app)

- **Where-is-it**: `Shared/WhereIsIt.js` already has the SHOP next-move string; the shop header
  has no lookup. Drop it in (orders = customOrders + the fin siblings already subscribed).
- **`orderStatusOf`/chips for the shop's own state** — today raw strings in spans; the sibling
  chip uses `OrderStatusChips` but the shop doc's own lifecycle is hand-rolled everywhere.
- **Server-side rules** for `shop_*` (firestore.rules:105-119 is flat `isAuth()`), and a real
  `signOut` in `handleLogout` (:267 clears localStorage only).
- **NetSuite honesty**: the export tab's "NetSuite Work Order Build routine triggered" alert
  (:506-521) triggers NOTHING — no ns_outbox, nothing reads `erpExported`. Either wire it through
  `enqueueNsWrite` (the SHOP route has no NetSuite WO at all today — 8/25 audit finding #7) or
  make the button say what it does. Never claim a write that didn't happen.
- **Latency**: reuse `Shared/BufferedInput` for any laggy fields; hoist `CustomCard`/`StagedCard`
  out of `renderCustomTab` (defined inline → remount every render, every keystroke).
- **Scope the `fin_workorders` listener** (:132) — the shop tablet subscribes to the ENTIRE
  finishing collection to render one sibling chip.
- **Dead code/stubs to kill or build**: "Dispatch to AI Queue" / "✨ AI Optimize" (no AI — a
  deterministic grouping; rename or build), `'Cut to Size Rods'` staged-rods branch (no writer
  exists), `matHistory` subscribed but never rendered, `shop_finishing_alerts` (rules only),
  `shop_logs` (AdminTab's super-admin viewer reads it; nothing writes it — repoint or write it),
  `updatedAt` never stamped on shop docs (RTG's job log sorts on it), the second-Firebase-app
  legacy materials importer with a hardcoded API key (ShopEngineering.js:295 — retire it).
- **Duplication**: `shopDb` + `cleanId` copy-pasted across both files; `TABS` (ShopFloor.js:26)
  hand-synced with `SHOP_TABS` (AdminTab.js:36) and already drifted. One shared module.
- **UI debt**: all-inline styles (~120 repeated mono-label blocks; `shopStyles.css` unused),
  ~20 `alert()`s, no error boundaries, 14-tab nav overflows on tablets, division dropdown offers
  brands the parts feed excludes.

## 4. Suggested order of work

Phase 1 (correctness): #1 intake stamping + #2 soNum + #3 itemCode + #4 queue separation — these
four interlock; test the full RTG→shop→complete→close chain afterward (seed the Brimar test order
from RTG, run it through, close it, check the Daily Job Log and orphan audit see every stage).
Phase 2 (visibility): holds/closed/urgent on cards, Where-is-it, status chips, updatedAt stamps.
Phase 3 (honesty + hardening): ledger the bulk wipes, export-tab truth or wiring, rules, signOut,
stub cleanup, legacy importer retirement.
Phase 4 (polish): card hoisting/memoization, style extraction, alert→modal, listener scoping.

Add a **Shop Floor section to the User Guide tab** (`UserGuideTab.js`) when the dust settles —
Work Orders and Orders & Customers sections exist; the floor deserves the same treatment.

## 4.5 Status (2026-08-26 session)

Phases 1–3 SHIPPED (commits `984d0c1` spine/queues, `95e51ca` holds/where-is-it, + the honesty/
hardening commit). §2 #1–#6 and most of §3 are closed. Still open, deliberately parked:
- **RTG payload stamps** — RTGDispatchTab.js is another session's territory; the shop side now
  RESOLVES soNum/itemCode with fallbacks, but the autoSplit shop payload should still stamp
  `soNum: so.soId || orderKey` + single-line `itemCode`, and pushToShop's payload should be
  wrapped in `withItemCode(...)`. Patch spec handed to Stuart for the owning session.
- **firestore.rules deploy** — shop master-data deletes now gated to admin/programmer/superadmin
  (isShopEngineer). Needs the Cloud Shell rules deploy (along with the pending hq_deletion_log
  append-only rule if not yet live).
- **Real schedule optimizer** (Stuart's pick): replace the deterministic setup-code sort with a
  genuinely smarter scheduler — machine capacity, due-date lateness, changeover minimization.
  Buttons renamed honestly in the meantime ("Dispatch to Schedule" / "⚙ Optimize Schedule").
- **NetSuite wiring for the shop route** — export tab is now honest (archive stamp, manual NS
  entry); real ns_outbox wiring is its own project and needs the WO-mapping talk with Eric.
- **Phase 4 polish** (§3 tail): card hoisting/memoization, BufferedInput, style extraction,
  alert→modal, tablet nav overflow, division dropdown scope. Plus the User Guide section.

## 5. Key files & memories
`ShopFloor/ShopFloor.js` · `ShopFloor/ShopEngineering.js` · `Shared/workOrderContract.js`
(mirror + releaseSiblingToPickPack + withItemCode) · `Shared/orderLifecycle.js` (linkedDocsOf /
closers / deletion ledger) · `Shared/orderHold.js` · `RTGDispatchTab.js` (autoSplit :924,
pushToShop :1367, auto-release) · `AdminTab.js` (SHOP_TABS perms editor) · `firestore.rules`.
Memories: `wo-creation-audit` (findings #5/#7 overlap here), `canonical-item-identity`,
`order-lifecycle-authority`, `user-directory-model`.
