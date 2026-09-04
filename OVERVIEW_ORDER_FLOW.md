# Overview — How an Order Flows Through the System

**Who this is for:** everyone testing. A plain-language map of how a job travels from a quote in HQ out to the Shop Floor, Finishing Floor, and Pick/Pack, and back to NetSuite. Use it to understand where your screen fits in the whole.

> Status note for testers: the **inside of each app works**; the **handoffs between apps** are what's actively being finished. Where a connection is still being wired, it's flagged **[being connected]** so you know what to test now vs. what's coming.

---

## The big picture

```
DESIGN (HQ Tabs 1–4)  →  CPQ QUOTE (Tabs 8/9)  →  NetSuite (quote → confirmed Sales Order)
        │                                                    │
        └──────────────  RTG DISPATCH (Tab 13) ──────────────┘
                              splits the order
                 ┌────────────────────────┴───────────────────────┐
        CUSTOM PARTS → SHOP FLOOR                 SMALL PARTS → FINISHING FLOOR
        (fabricated to size)                      (stock parts, painted/finished)
                 └───────────────→ PICK / PACK ←───────────────┘
                         match the two halves, finish, pack,
                         ship, and mark fulfilled in NetSuite
```

The thread that ties it together is the **order identity** — a job's quote, and the Sales Order it becomes — carried onto both the shop and finishing work orders so the two halves stay matched. **[being connected]**

---

## Stage 1 — Design & catalog (HQ)

A product is built up the front-office tabs: **Inception** (sketch → 3D model → approvals) → **Node Grouping** (tag the model's parts) → **Visual Assembly** (pin the sub-parts) → **BOM Engine** (enter data, costs, prices) → **Master Library** (the finished catalog item). See **SOP 1** for the main-assembly + CPQ setup.

---

## Stage 2 — Quote (CPQ)

Sales configures and prices a job two ways, both ending in a quote:
- **Vision Hardware (Tab 9)** for measured drapery-hardware jobs (see **SOP 2**), which pushes lines into…
- **CPQ Configurator (Tab 8)**, where each line is configured in 3D, priced (including customer-specific pricing), and added to a quote cart.

Finalizing pushes the quote to NetSuite as an **Estimate** today. The plan: when NetSuite returns a **confirmed Sales Order**, it's imported and reconciled back to the originating quote, which then **auto-creates the work orders**. **[being connected]**

---

## Stage 3 — Dispatch (RTG, Tab 13)

**RTG Dispatch** is the control center. It takes a confirmed order and splits it into two streams:
- **Custom parts → Shop Floor** (things fabricated to size: cut poles, custom brackets).
- **Small parts → Finishing Floor** (catalog parts that get picked and finished).

Since 4 Sep 2026 this is automatic: one release engine on RTG (the ⚡ toggle is its kill switch) splits a sales order and releases every parked work order through the door its type names the moment its gates clear — a stock build's NetSuite work order is queued at that same moment (Route A, `Shared/floorRelease.js`). There are no push buttons; one supervisor override lives in the order's detail view. Both halves share `orderKey` and cross-link (`finSiblingId` / `shopSiblingId`); the custom half's four states (`Pending → In Process → Sent to Plating → Complete`) gate packing. **[live]**

---

## Stage 4 — Shop Floor (custom fabrication)

Custom jobs land in the Shop Floor's **Custom** queue, flow through **Milling → Scheduler**, get produced against their **routings & programs**, and are marked complete. Operators can pull a part's **program print** from the central Asset Gallery via the new **Print** button (see the prints feature). Stock-replenishment work orders (to keep small parts on the shelf) also originate here from the inventory view.

---

## Stage 5 — Finishing Floor (small parts)

Small-parts work orders arrive in the **Setup Queue**, then move to the **Active Floor**, which schedules the spray/bake/hand steps. The job window is meant to show the matching **custom-parts status** (so finishing can see when the shop side is done) — that cross-floor status mirror is **[being connected]**. Recipes + the asset gallery show finishers exactly what to do.

---

## Stage 6 — Pick / Pack

Once a finishing manager releases a job, **Pick/Pack** picks the small parts (bin-by-bin), stages them with a barcoded label, and **scans to match** them with the custom parts coming off the Shop Floor. Matched orders move to finishing as "Set Up," then — after finishing — return to Pick/Pack to be **packed, labeled, shipped**, and pushed back to NetSuite as **fulfilled**. The queue-feeding, staging match, and pack/fulfill close-out are **[being connected]**.

---

## Cross-cutting tools

- **Asset Gallery + Print buttons** — one central place for finish swatches, reference images, and now **program prints** (PDFs/drawings), retrievable anywhere by the program/item name.
- **NetSuite** — the system of record for accounting; the app pushes prices, costs, and fulfillment to it. The goal is for staff to work in these friendlier screens while NetSuite stays the back-end ledger.
- **Login** — every app uses the same PIN login; admin and superadmin see all tabs.

---

## What to test now vs. what's coming

**Test now (works inside each app):** building a main assembly + CPQ flow (SOP 1); running Vision → CPQ to produce a priced quote (SOP 2); navigating each floor app and its tabs; the Asset Gallery + Print buttons.

**Coming / [being connected]:** the automatic SO import + order split, the shared key that keeps shop & finishing halves matched, the finishing→pick/pack release + staging scan, and the pack/ship/fulfill close-out. If a handoff *between* apps doesn't carry data yet, that's expected — note it, but it's on the build list, not a surprise.
