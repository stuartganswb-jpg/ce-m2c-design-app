# Plating round trip — SO60420 (live run, 2026-09-11, S3 driving, Stuart pinned in)

*The first live run of the split → shop → plater → WMS → pack chain for a custom order with an outsourced
(/EP) finish. Script from `SHOP_FLOOR_CONTINUATION_BRIEF.md` §5.1; the WMS side fixed first in 47c2b6b
(the custom plating line now carries its order links; custom put-away posts no NetSuite build). Every step
below is filled in AS IT HAPPENS — expected vs seen, with the screenshot file. Nothing here is inferred.*

**Stuart's framing (09-11):** the small parts should be in stock and available → they are a PULL and PACK
(pick-only finishing document, no paint line); the rod goes to the SHOP for the bend, then to the plater.

## 0. The order as RTG wrote it

| what | expected | seen |
|---|---|---|
| RTG board row for SO60420 | one sales order, split into a finishing doc (small parts, pick-only: `currentPhase 'Complete', pickOnly: true`, plated lines `pickOnly:true, finishOutsourced:true` covered by live stock) + a shop doc `SHOP-<orderKey>` (the bent rod, `isOutsourced: true`, finish /EP…) | **✓ as expected.** Card `SO: SO60420 · FABRICUT · SENT TO FLOOR · FINISHING ✓ · SHOP ✓ · SEP 11` (doc id `SO-APP-QUOTE-1789159651328`). Quote QUOTE-1789159651328 "WMS PLATING TEST" $410.15 → NetSuite SO60420 POSTED 4:51:59 PM (Transmit Log). Recipe **EP3**. BOM: `H1-1` [Plating TEST round trip] ×1 — H1-1R rod ×1 (drawing: WALL B 90.0", TUBE B CUT 106.00", C-to-C 89.0"), H1-FRPF French return ×2, H1-1ILPE/EP3 ×1, H1-1BP-R/EP3 ×3, H1-1BPR/EP3 ×1, H1-1STDOFF ×3. Auto-release terminal 4:56:03–07 PM: "⚡ Auto-release: importing & splitting SO SO60420…" → "🧭 SO SO60420 stock-first: **8 plated lines in stock → WMS pick**" → "Created **pick-only document WO-SO60420** (8 plated lines from stock + the custom half to pack) — nothing for the finishing floor" → "Created **Shop custom order SHOP-SO60420 [BEND] (3 custom lines)**" → "Created **Packaging order PKG-SO60420 (11 lines)**". Screenshot: RTG board + terminal (ss_56688rj4y), the View modal (ss_4816heklp). |
| Backorders | none if every small part is in stock; else the short lines on `hq_sales_orders.backorderLines[]` and the fin doc ON HOLD (BACKORDER) | **✓ none** — 8/8 plated lines covered by live stock; no BACKORDER chip on the card. |
| Setup Queue (finishing) | the order does NOT appear — pick-only; an outsourced finish never enters the finishing floor | (checked on the finishing tablet later — see §2) · **Board-side note for S2:** the Daily Job Log row for SO60420 reads `CUSTOM SHOP · SHOP · fabricating` before ▶ Start was ever pressed, and `FINISHING · FINISHED · off the floor` for a pick-only doc that never went to finishing — the wording, not the state, misleads. |
| WMS pick queue | NOT yet open — the sibling pick is released by the shop's ▶ Start | **✓** "No orders currently require picking"; PENDING · 15 lists `WO-SO60420 · H1-1 · ×0 · EP3 · SHOP FAB PENDING · ▶ PICK NOW` (screenshot ss_0911hsuz1). Note: the pending row's quantity reads **×0** for the header item H1-1 (the doc's 8 lines are the small parts; the header has no qty of its own) — wording, S3. |
| Shop → Custom Fabrication | the card: cut list / Pole Cut Sheet (bend), `finSiblingId` set, sibling chip `Pending` | **✓** staged card `1" Round Hollow Rod Stock (14 GA) · WO SHOP-SO60420 · H1-1R · SO SO60420 · Qty 3 · Cut 90" · FABRICUT · PLATED (outsourced)`; chips `CUSTOM SHOP SHOP fabricating` + `FINISHING FINISHED off the floor`; ▶ START / 🔍 VIEW (ss_2259g8nz5). Notes: "Qty 3" is the three custom LINES (rod + 2 French returns), not three rods; "Cut 90"" is the wall length, the cut sheet's raw cut is 106" (see §1); the "fabricating" chip shows before Start (same wording note as the Daily Job Log). |

## 1. Shop ▶ Start

| expected | seen |
|---|---|
| shop doc `status 'In Process'`; sibling `customFabStatus 'In Process'`; WMS pick OPENS (`releaseSiblingToPickPack`); message to FINISHING only if a finishing half exists (none here → no message) | **✓** Confirm box "▶ START SHOP-SO60420? · 1\" Round Hollow Rod Stock (14 GA) · It moves to the Active side; sibling small parts release to Pick/Pack and finishing is notified." → OK. Active Order: `IN PROCESS · WO: SHOP-SO60420 · SO: SO60420 · H1-1R · REQ QTY 3 · CUT TO 90"`; REST OF THIS ORDER: `CUSTOM SHOP fabricating · FINISHING FINISHED off the floor · WAREHOUSE PICKING in the pick queue`; the button reads **SEND TO PLATING** (the shared outsourced test recognised EP3); `↳ BEND THE POLE · STRAIGHT · 2 bend · 1 splice · 020 90"`; POLE CUT SHEET: CENTER Finished 89.00" · Raw cut 106.00"; Bend radius 4" · Pole Ø 1" · System 020 92.25"; HIDDEN HANGER LOCATIONS: FIPBHS Splice 1 44.5" from L.Edge; FIPBH Bracket 1 44.5" from L.Edge — Splice support (ss_6183dua34). WMS: `WO-SO60420` moved from PENDING into **Awaiting Pick (Small Parts)** with START PICKING within 2 s. Operator note: the ▶ Start on a staged card opens a native confirm; two earlier presses were lost to it (the tab froze for the driver until it was answered). Also note "STRAIGHT · 2 bend · 1 splice" in one header line — the drawing shows one bent tube; wording for S1/S2. |

## 2. WMS pick + pack of the small parts (in parallel with the shop)

| expected | seen |
|---|---|
| pick queue row for SO60420, small parts only, pole row shows the LENGTH from the shop doc; pick → `Picked_Awaiting_Staging`; SO Pack card shows the four numbers; pack REFUSED while the custom half is not `Complete` ("custom parts are not ready") | **Row as opened (ss_1815wgdsl):** `WO-SO60420 · FABRICUT · H1-1 · REF: WMS PLATING TEST · ✂ 90" ×1` (the pole row, from the shop doc — ✓); chips `CUSTOM SHOP fabricating · FINISHING FINISHED off the floor 42m · WAREHOUSE PICKING in the pick queue`; "4 Line Items (8 BOM lines grouped into 4 picks)": H1-1ILPE/EP3 ×1 @ M E4R-N3-R4 (10 live) · H1-1BP-R/EP3 ×3 @ M E4R-N3-R4 (20 live) · H1-1BPR/EP3 ×1 @ M E4R-N3-R4 (100 live) · H1-1STDOFF ×3 @ PRD-001 (276 live). **⚠ DEFECT (S3, mine):** the row carries the yellow banner "Already in production on the finishing floor — this pick was overtaken. Pull the parts now if the floor still needs them, or clear it. ✕ CLEAR PICK — PARTS ON THE FLOOR" — `isOvertakenPick` reads the pick-only doc's born-`Complete` phase as "the floor already has it"; on a pick-only order the pick is never overtaken, and the CLEAR button offered is the wrong action. Same root as S2's isDoneState finding; fix in `PickPackApp.js` (read `pickOnly`). **Note for S1/S2:** the standoffs pick as the bare code `H1-1STDOFF` from PRD-001 while the quote line reads "H1-1STDOFF · EP3" — either the item is tagged Unfinished (then fine) or the plated variant is missing from the split. Pick + pack refusal: run in §2b below. |
| **2b · the pick itself** — START PICKING claims the order; four picks, each bin + qty validated against LIVE per-bin stock; `pickStatus 'Picked_Awaiting_Staging'`; staging label prints; the WMS logs the operator out after the pick (by design) | **✓** After the shop's Complete the row chip already read `CUSTOM SHOP · AT THE PLATER since Sep 11` (the sibling mirror, ss_0893qu4g4). START PICKING → full-screen pick: 1/4 `H1-1ILPE/EP3` bin M E4R-N3-R4 ×1 → 2/4 `H1-1BP-R/EP3` M E4R-N3-R4 ×3 → 3/4 `H1-1BPR/EP3` M E4R-N3-R4 ×1 → 4/4 `H1-1STDOFF` PRD-001 ×3 (ss_9804ej37m) → "🐕 Order Complete. Printing staging label…" (ss_098005imz) → staging label printed → back to the PIN gate (the operator is signed out after a pick — Sandra's tablets expect that; the driver re-PINs). No bin or qty refusal fired (every bin scanned was the live bin). |

## 3. Shop Complete & Label (outsourced)

| expected | seen |
|---|---|
| shop `status 'Sent to Plating'`; sibling `customFabStatus 'Sent to Plating'` (chip "At the plater since <today>"); ONE `plating_demand` `PLD-CUSTOM-<shopDocId>` with `finSiblingId / orderKey / salesOrderId / shopOrderId`; OB PLATING alert; message to PICK_PACK; NOTHING to finishing; RTG row reads "At the plater" | **✓** SEND TO PLATING → confirm "Mark SHOP-SO60420 complete and send to OB PLATING (outgoing prep)?" → the Zebra label print dialog (fires BEFORE any write — the driver's tab froze until it was dismissed) → alert "🚚 SHOP-SO60420: take the pieces to the OB PLATING bin. Scan them in on WMS → Plating (📥 OB Plating) — they ride the next weekly plater PO from there." No phosphate prompt (outsourced). Recently Completed row: `SHOP-SO60420 · FABRICUT · 1" Round Hollow Rod Stock (14 GA) · Sent to Plating by stuart · 9/11/2026, 5:39:26 PM` with 🖨 REPRINT LABEL / ↩ UNDO (ss_835316h1q). **WMS → Plating (ss_18560w7ce):** `📥 OB PLATING — CUSTOM OUTGOING · 1 AWAITING SCAN-IN · 0 LINES IN BIN` → `SHOP-SO60420 · H1-1R → H1-1R/EP3 · 3 pcs · finish EP3 · Custom fab complete — OUTGOING bin · cut 90" · SO SO60420 · 📥 INTO OB PLATING` — ONE demand ✓. Sibling chip / RTG "At the plater": verified in §5 below (HQ tab re-opened later). **Note for S2 (the split) + S1:** the demand says **3 pcs of H1-1R/EP3** because the shop doc's `qty` is 3 = the three custom LINES (rod + 2 French returns), not three rods; the plater PO will be priced on that count. The target `H1-1R/EP3` names the raw rod's plated variant, which the custom put-away no longer builds (47c2b6b), so it is label-only here. |

## 4. Shop ↩ Undo, then Complete again

| expected | seen |
|---|---|
| Undo prompt names the demand cancellation; demand GONE from WMS → Plating; shop back to `In Process`; sibling `In Process`. Complete again → ONE fresh demand (not two) | **Undo ✓:** prompt "↩ Put SHOP-SO60420 BACK INTO PRODUCTION? • Shop status returns to "In Process" • Finishing/staging is told the custom parts are NOT complete … • **Its OB PLATING demand is cancelled — a second Complete raises a fresh one**" → OK; the card is back on the Active side, `IN PROCESS · WO: SHOP-SO60420` (ss_50042zqiz); WMS → Plating: the "OB PLATING — CUSTOM OUTGOING" panel is gone (0 demands) within 2 s ✓. **Complete again ✓:** confirm "Mark SHOP-SO60420 complete and send to OB PLATING (outgoing prep)?" → print dialog → alert "🚚 SHOP-SO60420: take the pieces to the OB PLATING bin…"; row `Sent to Plating by stuart · 5:49:18 PM`; WMS → Plating: `OB PLATING — CUSTOM OUTGOING · **1** AWAITING SCAN-IN` — one fresh demand, not two (ss_9167rw8pt). |

## 5. WMS → Plating: 📥 Into OB Plating (scan-in)

| expected | seen |
|---|---|
| `plating_shipments` line `status 'staged', custom: true`, bin OB PLATING, **carrying `finSiblingId / orderKey / soAppId / shopOrderId`** (47c2b6b); the demand ENDS (ledgered, not deleted by hand); plating label prints | **✓** 📥 INTO OB PLATING → confirm "📥 Scan SHOP-SO60420 into OB PLATING? 3 pc(s) · H1-1R → H1-1R/EP3 · finish EP3 · It joins the staged plating lines and rides the next weekly shipment/PO." → alert "✅ SHOP-SO60420 staged in OB PLATING — it rides the next weekly plating shipment/PO." → plating label printed. Panel: `OB PLATING — CUSTOM OUTGOING · 0 AWAITING SCAN-IN · 1 LINE IN BIN (3 PCS)`; `STAGED FOR THIS WEEK'S PLATING SHIPMENT — 1 LINE (3 PCS): H1-1R → H1-1R/EP3 — CUSTOM EP3 - EP3 — Custom fab complete — OUTGOING bin · cut 90" · SO SO60420 · WO SHOP-SO60420 · 3 → OB PLATING` (ss_6687xhhw0). The link fields are not displayed; their proof is behavioural at §7/§8 (the RTG record stamps only if the line carries `finSiblingId`). **Named, not fixed (S3):** a shop ↩ Undo between scan-in and Ship is not refused — the demand is already fulfilled, so `cancelPlatingDemand` finds nothing to cancel and the staged line would be orphaned in OB PLATING; the refusal today only covers SHIPPED lines. |

## 6. WMS → Plating: 📦 Ship (weekly plater PO)

| expected | seen |
|---|---|
| the $0-rate prompt fires for the custom line (type the $/ea); ONE NetSuite PO to the plater (real); `hq_purchase_orders` `Sent to Plater` on the RTG PO panel; line `status 'shipped'` | **✓ with one gap.** SHIP PALLET → the Ship Plating Pallet modal (vendor Dayton Grey): `H1-1R — CUSTOM EP3 · SHOP-SO60420 · QTY 3 · $/EA [blank] · $0.00` — the $/ea is typed IN the modal, so the "$0 anyway?" prompt never had to fire; Stuart: $10 → line $30.00, TOTAL PLATING COST $30.00 (ss_5383p60d5) → CREATE PO & SHIP PALLET → alert "✅ Plating shipment **PLT-CE-1789164485442** created — NetSuite **(pending sync)** ("Weekly Plating Shipment" $30.00), 1 line / 3 pcs shipped, label spooled." → two labels printed (pallet + packing list). OUT AT PLATER now lists `PLT-CE-1789164485442 · 1 line · 3 pcs · **NS PO —**` above the old PO2198 (ss_36476s9l6). **Gap:** the NetSuite POST returned no id and the SuiteQL memo lookup found nothing yet, so the shipment and its `hq_purchase_orders` row carry `nsPoId: null` — Receive transforms `purchaseorder/<nsPoId>/!transform/itemreceipt` and needs it. Whether the PO exists in NetSuite: check the RTG PO panel / NetSuite (below). |

## 6a. The refusal: shop ↩ Undo AFTER the pull has shipped

| expected | seen |
|---|---|
| "⛔ … cannot be reopened — those parts are already at the plater — receive them back before reopening" | **✓** Recently Completed → ↩ UNDO on SHOP-SO60420 → the usual confirm ("↩ Put SHOP-SO60420 BACK INTO PRODUCTION? …") → then the refusal: "⛔ SHOP-SO60420 cannot be reopened — those parts are already at the plater — receive them back before reopening." Row unchanged (`Sent to Plating by stuart · 5:49:18 PM`, ss_3323ojiqg). Wording note (S3): the confirm comes BEFORE the refusal — the operator commits to an undo and is then told no; refusing first would read better. |

## 7. WMS → Plating: Receive

| expected | seen |
|---|---|
| item receipt QUEUED on the outbox (`platercv-<shipmentId>`, 11.1 shows it, posts ≈1 min); line `received`; RTG record `floorPhase 'Plating Received'` (47c2b6b — needs the link) | **✗ BLOCKED — the ship step's PO-id gap.** RECEIVE PO → ITEM RECEIPT on PLT-CE-1789164485442 → alert "This shipment has no NetSuite PO id on file — can't create the item receipt. (Was the PO created in Phase 3?)". Nothing posted. Cause (`pushPlatingShipment`): the NetSuite PO POST returns 204 with the id only in a Location header the proxy does not forward, so the code recovers the id with ONE SuiteQL lookup by memo, immediately — it found nothing (NetSuite had not indexed the new record yet, or the POST failed in a way the proxy reported as ok), the shipment and `hq_purchase_orders` were written with `nsPoId: null` and the alert said "(pending sync)". Nothing ever retries the lookup, so the shipment cannot be received until someone stamps the id by hand. **Stuart, 18:20:** no such PO in NetSuite. **Fix shipped 1e5e5a4** (Stuart: "go ahead and fix"): Ship retries the memo lookup 5× over 10 s; a shipment still without a number carries `nsPoPending` and the alert says NUMBER NOT RECOVERED (never "pending sync"); the Out-at-plater row gains **⟳ FIND NETSUITE PO** (memo lookup → the vendor's last-3-days POs to pick from → only when both are empty, a guarded re-post through the SAME description/payload builders Ship uses); admin Reset refuses when a number is on file and warns to Find first when there is none. Continued below once the bundle is live. |

## 8. Receive to a cart → Put away & build

| expected | seen |
|---|---|
| custom put-away: NO NetSuite build/adjustment; line `built`, `nsBuildSkipped 'custom-fab'`; sibling `customFabStatus 'Complete'`; RTG `floorPhase 'Plated'` ("Plated, ready to pack"); pieces committed to the order's bin | |

## 9. Pack allowed

| expected | seen |
|---|---|
| SO Pack / Packaging Prep no longer refuses; the order packs; `packStatus 'Packed'` | (after §8) |
| **9a · the refusal BEFORE the parts are back** — Packaging Prep must refuse to pack while `customFabStatus` is 'Sent to Plating' | **✗ DEFECT (S3, mine).** Packaging Prep card `WO-SO60420 · FABRICUT · 8 lines` with chips `CUSTOM SHOP AT THE PLATER since Sep 11 · FINISHING FINISHED · WAREHOUSE PICKED awaiting staging` (ss_0220p5wi9) → tap → workspace opens read-only ("👁 Looking only") → **Start packing was ALLOWED** ("🔒 YOU ARE PACKING THIS", ss_7645jxl3k) with the 8 small parts listed TO PACK and the pole-match banner offering "THIS ORDER HAS NO POLES — SAY WHY & CONTINUE" as a way past the missing pole. `customPartsReady` is asked only on the PICK QUEUE's staging handshake (VERIFY & STAGE) and in `pendingReasonOf`; the Packaging Prep station (the newer packing surface) never asks it, at Start or at Complete. A packer could box the small parts and ship without the plated pole. I did NOT complete the pack; CLOSE released the claim. Fix: `startPacking` and the pack-complete both refuse with the same words the handshake uses ("custom parts are not ready — AT THE PLATER…"). |

## 10. Board-side observations for S2 (written into BRIEF_S2 §6 after the run)

Read on the RTG board (HQ re-PINned) after Ship, 18:10 EDT:

- **The spine held.** Daily Job Log row `SO SO60420 · FABRICUT`: `CUSTOM SHOP · AT THE PLATER since Sep 11 · FINISHING · FINISHED off the floor · WAREHOUSE · PICKED awaiting staging` — the shop's mirror and the WMS pick both reached RTG's record with no RTG-side write.
- The SO card in DISPATCHED THIS WEEK reads only `SENT TO FLOOR · FINISHING ✓ · SHOP ✓ · SEP 11`; the plater state shows on the job-log row, not on the card. Wording, S2's call.
- **PO panel:** `PO: PLT-CE-1789164485442 · Vendor: Dayton Grey · NS 42036 · 1 line(s) · ✎ EDIT PO · SENT TO PLATER · 3 × H1-1R @ 10.00 · total 30.00` — no NS PO number (the WMS wrote `nsPoId: null`), and **✎ EDIT PO is offered on a PO that has left us** (S2's `poLinesLocked` hand-off from A, STATE §2.2 #15, still not landed).
- The Transmit Log carries no entry for the plating PO — it is a direct write from the WMS, not an outbox entry (STATE §0 "every NetSuite write through the outbox except the plating build-back" is also except the plating PO and the plating pull).
- Before Start (§0): the job-log row said `SHOP · fabricating` for a Pending shop doc and `FINISHING · FINISHED off the floor` for a pick-only doc that never went to finishing; the pick-only doc's born-`Complete` also trips the WMS's "overtaken pick" banner (§2).
- The split's shop doc `qty` is 3 = the three custom LINES (rod + 2 French returns); the shop card, the demand, the staged line and the plater PO all say "3 pcs / 3 × H1-1R @ 10.00" for one bent rod. S2 (the split) with S1: what should a shop doc's qty mean, and what should the plater be billed on?
- `H1-1STDOFF` picked as the bare code from PRD-001 while the quote line reads "· EP3" — Unfinished tag or missing plated variant (S1).
