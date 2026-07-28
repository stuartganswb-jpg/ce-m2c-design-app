# Stock View (HQ 12.5) — Three-Scenario Redesign

**Spec'd:** 2026-07-28 from Stuart's description · **Status:** PLAN, nothing built yet
**Files:** `src/components/HQ/StockViewTab.js` (2207 ln), `src/components/HQ/RTGDispatchTab.js` (1579 ln), `src/components/PickPack/PickPackApp.js` (CONVERT tab ~2766)

## The principle

The Sales Snapshot popup is the model — Stuart likes how it reads and wants **all** replenishment to run through that shape. The main 12.5 grid's push path (`pushPOsToDispatch` :445, `pushWOsToDispatch` :558) is the "old and clunky" one: it makes the operator choose Finishing-vs-Shop by hand. **Routing should be derived from what the item IS, not asked.**

---

## Scenario 1 — Finished assemblies (`HAFICBR1S/CP`)

Stocked *complete* in bins, pulled and shipped. Watch stock vs sales → replenish.

**Today:** works. Snapshot FINISHED view → Order qty → `⚙ Generate Orders` → `createStockFinWOs` (:972) writes `hq_work_orders` with `source:'SALES_SNAPSHOT'`, `routeTo:'FINISHING'` and a **complete pre-built `finPayload`** parked for RTG.

**Delta wanted:** RTG **auto-releases** these to the Finishing Floor instead of waiting for a manual "Push to Finishing" click, and logs it.

⚠ **Decision needed:** that manual gate was added deliberately (2026-07-16, "same control gate as the POs — nothing reaches the floor un-reviewed"). Recommend scoping auto-release to `source === 'SALES_SNAPSHOT'` + `type === 'Stock'` only, so customer/custom work keeps its review step. Also note: auto-release doesn't itself reduce NetSuite concurrency — the `ns_outbox` worker is what serializes those writes. It removes a click and centralizes the log, which is the real win.

---

## Scenario 2 — Raw cores / BOM bases (`HAFICBR1S`)

The base item inside the finished assembly. Don't run out. Some in-house (work order), some outsourced (purchase order).

**Today:** the RAW CORES (BOM) view exists (`snapView === 'RAW'`, :1431) but **ordering is deliberately disabled in it** (:1444 — "Raw Cores view sets thresholds (ROPs)" only). Order routing logic already exists for the FINISHED view (`generateOrders` :1185): bought → one PO per vendor, made → per-row WO parked in RTG, in-house-with-a-vendor → per-item chooser modal (`routeModal` :72/:1776). Vendors resolve to NetSuite-synced `VEND-<nsid>` CRM records (`resolveVendorRec`, :520).

**Deltas wanted:**
1. **Unlock ordering in the Raw Cores view** — same filters, same rows, PO + WO both available. (This is the core unlock.)
2. **Vendor confirmation step** before creating POs — show the NetSuite vendor per item, let it be confirmed/changed, then **group all items sharing a vendor into ONE PO**. (Grouping already exists; the confirm UI does not.)
3. In-house items → WO → **straight to Shop Floor** via the same RTG auto-route (scenario 1's mechanism, different destination).
4. PO → RTG → NetSuite → real PO# comes back → **email it to the vendor** and **log it on the vendor's CRM card** (External Coop).
5. **New button: "Open POs by vendor"** on Stock View.

---

## Scenario 3 — Fabricut H1 (three-tier: raw → phosphate → plated)

`H1-75DS` (raw) · `H1-75DS/P` (phosphated in-house base for ALL in-house paint finishes P01, P02…) · `H1-75DS/EP1` (outsourced plated).

**Deltas wanted:**
1. **A paired view**: raw item with its `/P` immediately beneath it — `H1-75DS` then `H1-75DS/P` — so both stock levels read together. (Two buttons: raw+phosphate pairs, and the plated tier.)
2. Order the **raw** `H1-75DS` → RTG → auto to **Shop Floor**.
3. Order the **`/P`** → creates **demand on the WMS CONVERT tab** (PickPackApp :2766, which already has the raw→phosphate cart flow) — a new panel listing what to pull and phosphate.
4. The **`/EP1`** plated tier behaves like scenario 1 (stocked, watched, replenished). Note the main grid already routes plated suffixes to `plating_demand` (:457-489, keyed off `outsourceFinishes` suffix match) — that mechanism likely gets reused rather than rebuilt.

---

## Cross-cutting

- **Routing rule to encode once:** finished assembly → Finishing · in-house base → Shop · outsourced base → PO · phosphate tier → Convert · plated tier → plating demand. Derive from item data (`isInHouse`, `vendorName`, finish suffix, assembly-ness), never ask.
- Everything continues to stage through RTG so `ns_outbox` serializes NetSuite writes and RTG stays the single audit log.
- The main-grid legacy push path should eventually be retired or reduced to a thin wrapper over the new routing, so there's one code path, not two.

## Suggested build order

1. **Scenario 2 ordering unlock + vendor confirm + auto-route** — biggest gap, reuses the most existing machinery.
2. **Scenario 1 auto-release** — small, once the routing rule exists.
3. **"Open POs by vendor" + CRM/vendor logging + PO email** — reporting layer on top of 1-2.
4. **Scenario 3 paired H1 view + Convert demand** — most new UI, and the Convert panel is its own piece.
