# Order Entry → Floors Auto-Flow — Session Handoff Brief

*Written 2026-08-29 mid-test. Scope: the Order Entry (tab 7) → Order Entry Needs → shop →
phosphate → finishing → WMS chain built 8/28–29, which is SHIPPED but whose first live test
FAILED partway — production was skipped and the convert station holds duplicate data. The next
session starts with a DATA CLEANUP + root-cause, then the on-hand/bin feature (§5). Operating
procedures (pin-in login, Vercel bundle verification, Cloud Shell, multi-session git): read
`CPQ_ORDERENTRY_TAB11_BRIEF.md` §0 verbatim — it applies unchanged. Memories `quick-ship-stocked-items`
and `wo-creation-audit` carry the running state; trust them + this brief over older briefs.*

---

## 1. The model (Stuart's rule, settled 8/28)

**Client-manufactured lines ALWAYS keep the sales link. Master Library + the stock views are for
STOCK and stocked backorders only.** An Order Entry (tab 7) sales order's TO-BE-FINISHED lines
(raw part + finish + qty) drive everything downstream, and the system routes them itself:

- **/P components in stock** → finishing WO releases straight to the Setup Queue.
- **/P short, raw on hand** → convert to-do (WMS Convert tab, linked by `finWoId`); the WO holds
  on `awaitingConvert` and AUTO-RELEASES to finishing when the WMS posts the convert.
- **raw short too** → component milling WO goes STRAIGHT into the shop's milling intake
  (`SHOP-WO-CMP-*`, routeTo MILLING, needsPhosphating) → shop mills → operator converts →
  finishing → WMS **pack & hold** in a bin until every part arrives (weeks are normal).
- RTG shows a **🔁 AUTO-FLOW** status chip for these orders — never Push buttons.

## 2. Shipped this session (all on main, bundle-verified)

- `Shared/finishedRunPrecheck.js` — ONE component pre-check on every WO-creating screen
  (batched live NetSuite read, /P→convert+gate, raw→shop WO, self-pull filtered);
  `executeMakeupActions({dispatchShop})` writes the shop milling doc directly;
  `releaseFinWoToFloor`; `clearConvertGate` returns 'released'|'cleared' and auto-releases
  autoFlow/ORDER_ENTRY WOs from the WMS convert-complete hook.
- Tab 7: to-be-finished lines fire linked WOs at SO save (gated `awaitingSoAccept`, cleared by
  the outbox writeBack); outsourced finishes route to plating (authority = hq_outsource_finishes);
  checkout has **Need-by date + Production notes** (ride every downstream doc); finish shows on
  the SO/invoice document (legacy orders resolve it from the line note).
- Stock View → **🧾 Order Entry Needs**: per-SO board (SO#, customer, need-by, notes, per-line
  finish + linked WO/PO status via `soAppId`), per-line ⚙ Generate + toolbar ⚙ Generate All
  Missing (OE), ↻ Refresh. Generation auto-flows per §1.
- RTG: auto-flow chip + release effect (independent of the ⚡ toggle; treats
  `orderClass==='ORDER_ENTRY'` as autoFlow to heal pre-flag docs); awaitingConvert /
  awaitingSoAccept gates on release + auto-release; BOTH-sourced chooser unified (⚖ defaults WO).
- Machine load labels: >1 spray-zone load (70 S · 35 M · 17 L) prints PART i OF n labels, same
  barcode; Setup Queue shows the load plan + reprint.
- Shop floor DATA (entered via UI): programs `H2-138-TB3-MILL` / `H2-138-TB4-MILL` (VF4 pref +
  VF2, 15 min setup, 1.5 min/pc, Small vise), saw cuts (TB3 3.5" / TB4 5.125", Mac Cold Saw),
  `TUMBLE-DEBURR` (SPK), `H2-138-TB4-BEND-90` (Simasv); routings TB3 saw→mill→tumble, TB4
  saw→mill→tumble→bend.
- 11.1: probe fixed (ROWNUM real-row + ItemVendor joins) so **vendorNsId finally imports**;
  drop-and-retry keeps a bad column from bricking the sync; `custitem_sourcing_both` wired both
  ways (field NOT created by Eric yet — spec = `ERIC_NETSUITE_SOURCING_VENDOR_SPEC.md`; the
  'Sourced BOTH ways' pull flag is deliberately UNTICKED until his field + the seeding push).
- Christie's vendor bug: NetSuite renamed vendor 241 (CE8780) — vendor re-sync fixed it; card resolved.

## 3. ⚠ THE FAILED TEST — what is actually true (2026-08-29 ~11:20 AM)

READ WINDOW PRODUCTS sale `QS-1787697627832` (SD-Stock, 8/25): TRAV12 ×230, TRAVLB ×962,
TRAVEC ×450, all finish **RF2 (Bronze)**. Needs-board generation at ~10:47 created
`WO-OE-HRW-138TRAV12-1788013068657`, `WO-OE-HRW-138TRAVLB-1788013250519`,
`WO-OE-HRW-138TRAVEC-1788013258455`. Then:

1. **TRAVLB SKIPPED PRODUCTION.** It sits `awaitingConvert` with demands `CVW-CE-252074`
   (962 × TB3→TB3/P) + `CVW-CE-252719` (962 × TB4→TB4/P) — but **raw on hand is 0 and NO
   milling WOs exist** (shop milling intake shows only old Joshua Tree/wood orders). Root-cause
   candidates, in order: (a) the 10:47 generation ran on the pre-`dispatchShop` bundle, so SHOP
   actions would have parked `WO-CMP-*` in RTG — but none are visible there either, so (b) the
   raw-availability read likely failed (`rawKnown=false` → converts only, NO shop WOs, by
   design) or (c) the SHOP action path errored after the converts wrote. Read the two demand
   docs' `baseAvailAtRequest` (null = raw read failed) and hunt `WO-CMP-*` in hq_work_orders.
   **Fix so a raw-read failure can never silently skip production** (loud warn + a Generate
   retry, or block the convert-only outcome).
2. **CONVERT TAB IS FULL OF DUPLICATES.** Waves from every earlier ordering attempt:
   `CVW-CE-081404/099839/118859/155878/175582` (TB4 ×140×4 + more), `CVW-CE-207239` (TB4 ×122),
   `CVW-CE-097881/116466/153959/172940` (TRAVUA ×140×4), `CVW-CE-205348` (TRAVUA ×122) — those
   are the deleted WO11519–22 wave's leftovers (deleting a WO does NOT delete its convert
   demands — a real gap: **the WO delete cascade should offer to remove linked convert/plating
   demands**). Plus the new 252074/252719 pair.
3. **TRAV12 + TRAVEC auto-flowed to finishing** (log 11:15:41) — Stuart thinks the destination
   is right, but there's no visual proof of component stock on the job. TRAVEC chip said
   "RELEASING…" — verify it actually landed (fin_workorders) and the chip state updates.
4. RTG's "DISPATCHED BUILD WITH NO NETSUITE WORK ORDER" repair banner **falsely flags OE
   builds** — they deliberately have no app NetSuite WO (the SO is the NS record). Repair
   correctly skipped it (log 11:16:23) but the red banner is noise: exclude
   `orderClass==='ORDER_ENTRY'` / orderType sales from `nsOrphans`.
5. Old finishing-floor cards from earlier waves (WO11523/24/27, dispatched Aug 27) still sit in
   the Setup Queue alongside the new ones.

## 4. FIRST TASK — data cleanup, then re-run the trace

Kill EVERYTHING tied to the READ WINDOW sale + the stray stock waves so one clean end-to-end
trace is possible (Stuart: "kill all associated work orders for this read window sale and start
all over so we can trace all steps"):

- RTG ✕ (ledgered) the three `WO-OE-HRW-*-17880132*` WOs + their fin_workorders copies (TRAV12,
  TRAVEC released to floor) + Setup Queue leftovers WO11523/24/27 (+ anything HRW on the floor).
- Delete ALL the convert demands listed in §3.2 (both waves). Firestore is App-Check-locked —
  do it in-app: the Convert tab has no delete affordance today, so either add a small admin
  ✕ on convert rows (gated admin/superadmin) or a one-shot cleanup button; prefer the permanent
  ✕ (this gap will recur).
- Verify no `WO-CMP-*` / `SHOP-WO-CMP-*` strays in hq_work_orders / shop_custom_orders.
- Check NetSuite: WO11519–22 (the 542-pc TRAVLB wave) were POSTED — Eric may need to close them
  there; the app-side docs were deleted.
- Then: Order Entry Needs → ⚙ Generate All Missing (OE) on the fresh bundle and walk the whole
  chain: milling WOs land in shop intake (TB3/TB4 routings!) → mill → convert → auto-release →
  finishing (load labels: 962 S = 14 loads) → WMS pack & hold.

## 5. NEXT FEATURE (Stuart: "can start there in a new session")

**On-hand + bin, visible on the job.** In the finishing job window (Setup Queue card / specs
and the Active Floor job view), each pull line should show LIVE inventory on hand and its bin
location so the floor can visually confirm stock exists before starting. Sources: the same live
read the pre-check uses (`fetchAvailability`, brand location) + bin from the item's
`manufacturingSpecs.homeBin` / `binLocation` (or the WMS live `nsStock[].bins` pattern — see
memory `rod-cuts-wms` for the stale-home-bin trap). Cache per card open; NetSuite-unreachable
shows "unverified", never blocks.

## 6. Key files

`Shared/finishedRunPrecheck.js` (pre-check/make-up/auto-flow/gate-clear) · `HQ/StockViewTab.js`
(Order Entry Needs, `generateOeLineOrder`, `generateAllOeMissing`) · `HQ/QuickShipTab.js` (tbf
lines, SO save auto-fire, checkout fields) · `HQ/RTGDispatchTab.js` (auto-flow effect + chip,
gates, nsOrphans) · `PickPack/PickPackApp.js` (convert complete → `clearConvertGate`, load
labels, QS card) · `FinishingFloor/SetupQueue.js` (load plan, re-make pre-check) ·
`Shared/labelPrint.js` · `Shared/finishingTime.js` (SIZE_CAPACITY 70/35/17, machineLoadPlan) ·
`Shared/QuickShipInvoiceModal.js`. Shop floor code (`ShopFloor/*`) belongs to ANOTHER session —
hand patch specs, don't edit.
