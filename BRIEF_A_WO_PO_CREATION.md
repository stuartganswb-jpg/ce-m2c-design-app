# Brief A — Stock View · Sales Snapshot · Master Library: work-order & purchase-order creation

*Cut from `SYSTEM_FLOW_AUDIT.md` (read it first — §2, §3, §5, §10, §13 are yours). Written
2026-09-02. This session's job: make the ten ways an order is created into one, the three ways a
PO is created into one, and the three ways a plated demand is raised into one — without touching
the paths that release to the floors, which belong to Brief B.*

## ⛔ WORKING AGREEMENT (Stuart, 2026-08-31) — binds this session

1. **Plan first, always** — state the plan and WAIT for approval before editing code, shipping, or
   changing production data. Reading and measuring need no permission; changing does.
2. **Requested scope only** — exactly what was asked. Adjacent problems get NAMED, not fixed.
3. **No temporary fixes** — fix the cause, or say it cannot be done properly and stop.
4. **Look downstream — RTG is the single source of truth.** Before any change, trace it through
   work orders, the finishing floor, the shop floor, WMS and NetSuite, and say so in the plan.

Full text: `CLAUDE.md` (top). Two rules learned the hard way this fortnight, now part of the
agreement in practice: **ask, don't derive** — a rule inferred from an adjacent sentence was wrong
twice on pole routing (`POLE_ROUTING_HANDOFF_BRIEF.md` §1); and **a sweep must cover every place
that decides the thing, not every place you were already looking** — the sixth copy of the pole
test was an *importer*, not a WO writer.

## ⚙ STANDING RULES FOR EVERY BRIEF (Stuart, 2026-09-02) — A through F inherit these

**S1 · Tags before code.** When items need to move differently, the first answer is a **tag on the
item** — edited in **4.5 Mass Update** (bulk) and on the item's **Master Library card** (single) —
and code that reads the tag. Not a rewrite of the routing logic. The settled rules (§3) are the
default; a tag is how an exception or a new behaviour is introduced without a large code change.
(This does not reopen Q7: the pole handling rule *is* the suffix, and no stock- or length-based
pole tag is wanted. S1 is about the next modification, not that one.)

**S2 · The guide moves with the code.** A brief is not complete until the **User Guide** is updated
— both the in-app guide (`src/components/HQ/UserGuideTab.js`, plain JSX) and the repo doc it is
written from — so the explanation the team reads matches what the app does. Every §9 handoff
lists the guide sections touched.

**S3 · Everything auto-routes; RTG records everything.** Any work order — raw stock to the shop,
finished work to the floor — and any purchase order routes on its own. No screen has a manual
"push" a person must press for the work to move. RTG holds the master record of all of it and is
where a person sees status and closes. (For a PO, "auto-route" means it lands in the vendor's
**open** PO automatically — S5 — and RTG records it; the one deliberate act is the final send.)

**S4 · BOTH always asks, on every screen.** An assembly marked sourcing BOTH makes every
work-generating screen — Snapshot, grid, Library card, the pre-check, Order Entry review, the new
Stock Build Needs board — ask whether to create a **work order or a purchase order** for it. Never
defaulted silently.

**S5 · Purchase orders open, accumulate, then send.** Many vendors have minimum orders. A PO is
created **open** for its vendor and **items are added to it** as demand appears — from any screen
— until a person reviews it and sends it to NetSuite. Nothing creates a second open PO for a
vendor while one exists.

---

## 0. Operating the session

**Login (the pin-in workflow).** Stuart pins you into the live app — the standard loop, and it
catches what code-reading misses. Use the **Claude-in-Chrome** tools (his real Chrome, his session),
not the preview pane. `tabs_context_mcp` first, then drive by `find`→ref, not coordinates. Two
gates: **Factory Portal** (email+password) then **Enterprise PLM PIN** on every `/hq` load. Stuart
types both — NEVER enter credentials; navigate to the gate and say it's up. Auth survives SPA
tab-switching but not reloads; a fresh deploy needs reload → Stuart re-PINs.

**Vercel (auto-deploys on push to main).** `curl -s https://www.4cosworkcenter.com/version.json`
→ `{v: <ms epoch>}`; stamp after commit time = live. **StockViewTab and LibraryTab are lazy
chunks** — marker-grep via `/asset-manifest.json`, never `main.*.js` alone. Markers must be string
LITERALS. Stale-build trap: CLAUDE.md (redeploy without build cache).

**Cloud Shell** (functions + rules do NOT auto-deploy): `shell.cloud.google.com` → `git pull` →
`firebase deploy --only <target> --project ce-m2c-design-collab`. **Rules are deployed as of
2026-09-02 (Stuart confirmed)** — the three older briefs that say "pending" are stale on that.
Nothing in this brief needs a rules change unless you add a collection; if you do, it goes in
`firestore.rules` in the same commit and you tell Stuart it needs the Cloud Shell deploy.

**Git.** Multi-session repo — never switch branches in the shared checkout, stage only your files,
`pull --rebase --autostash` before push, fix-forward on main. Lint every file before commit:
`npx --no-install eslint <path>` → 0 errors. Before editing `Shared/`, `ListAgents` and ask any
live peer whether they are in the file; two sessions in `RTGDispatchTab.js` is how work gets lost.

**Diagnosis paths.** Firestore enforces App Check — no script can read or write production. Bulk
data checks are in-app buttons (the 🪝 Force Pole / Rod Tags dry run is the model: Cancel at the
prompt = report, OK = apply). NetSuite reads: the RTG Transmit Log, 11.1 → Sync Queue, or a
screenshot from Stuart.

---

## 1. Territory

**You own:** `src/components/HQ/StockViewTab.js` · `src/components/HQ/LibraryTab.js` (the WO/PO
parts — the card, `createStockBuildWO`, `releaseRunToFloor`, the plating run) ·
`Shared/finishedRunPrecheck.js` · `Shared/finishedGoodsRun.js` · `Shared/oeReviewPlan.js` ·
`Shared/stockRun.js` · `Shared/poleCut.js` · `Shared/finishRouting.js` · `Shared/sourcing.js` ·
`Shared/shortId.js` · and the two new modules this brief creates.

**Read-only to you** (owned by B): `RTGDispatchTab.js`, `workOrderContract.js`,
`orderLifecycle.js`, `orderStatus.js`, `finishingTime.js`, everything in `FinishingFloor/`.
Owned by D: `PickPack/*`, `nsOutbox.js`, `nsWorkOrder.js`, `functions/`. Owned by E: `CPQTab.js`,
`QuickShipTab.js`, `nsTransmit.js`, `lineClassification.js`. Owned by C: `ShopFloor/*`.

**Must not touch:** the release paths (`pushToFinishing`, `pushToShop`, `autoSplitSalesOrder`,
`releaseFinWoToFloor`'s copy step) — B consolidates those. Where your work needs a change in B's
file, you write a **patch spec** into `BRIEF_B_…` §hand-offs (see §7) and stop. One of your ten
writers lives in B's file (RTG re-issue, `RTGDispatchTab.js:1958`); it is handled exactly that way.

---

## 2. What this brief inherits

From the audit, by number:

| ref | item | this brief's part |
|---|---|---|
| P0 #1 | route-open parking (writers 2, 6, 10 write no `routeTo`, no `finPayload`) | abolish it in writers 2 and 6; spec the fix for 10 to B |
| P1 #6 | ten WO writer shapes | one `parkWorkOrder` |
| P1 #7 | twenty local suffix readers, eight routing-grade | sweep the eight |
| P1 #9 | three PO shapes; subsidiary check on one; `source` on one | one `createPurchaseOrder` |
| P2 #11 | `source` missing on writers 1 and 2 | falls out of `parkWorkOrder` |
| §13 a | the plating triple, three copies | one `issuePlatedDemand` + the BOM-core report |
| Q5 | **Snapshot model — always pre-build** | `parkWorkOrder` always writes the complete floor doc |
| Q4 | **everything routes to where it belongs, always** | the route rule inside `parkWorkOrder` |
| Q6, Q11 | **RTG = automatic control + master record, no manual push** — Master Library included | the Library's two paths park through `parkWorkOrder` and let RTG auto-release |
| Q8 | **a "needs a PO" board for stock builds** | §4 A5 |
| Q7 (second pass) | **the suffix rule stands; no tag** | do not reintroduce a stock- or tag-based pole rule |
| S1–S5 | standing rules (top of this brief) | tags before code · guide moves with the code · everything auto-routes, RTG records all · BOTH asks everywhere · POs open, accumulate, send |

---

## 3. The rules you build on — settled, not to be re-derived

**Part Handling for a POLE/ROD is decided by the finish suffix** (`Shared/finishRouting.handlingForErp`, 0615687, reaffirmed 09-02):
mill code, `/P`, `/P##`, `/P25`, `/EP*`, `/MEP*` → **Custom**; any other suffix (`/BS`, `/N90`, `/CP`…) → **Small Parts**; Finish Stream = **POLES** either way (`poleCut.autoFinishStream`). Scoped to pole/rod category. Stuart: *"P is our control for finishes that we always apply custom and any other letters are qualified as small parts finish like poles."* The Master Library sync fills the blank only; a hand-set value survives.

**Where an order goes** (Q4): an item with a finish suffix that is not outsourced → **FINISHING**; a raw/mill code → **SHOP**; an outsourced finish (`isOutsourcedFinishCode`) → **the plating triple** (§13 a), **never a finishing WO — an outsourced finish never enters the finishing floor** (Stuart 09-02, B §8 answer 2: "only to either plating and/or WMS pick pack when available"). Custom lines from a sales order → shop + finishing pair (RTG's split; not yours). Your `parkWorkOrder` must refuse `routeTo:'FINISHING'` for an outsourced finish — throw, do not park.

**What a stocked pole does** (`poleCut`): a 4/6 ft order is a **cut** from stocked 8 ft rods (`poleCutPlan`), gated `awaitingRodCut`; the cut prints the finishing label. Not yours to change; your writer must keep raising the cut.

**Two product models** (`finishedGoodsRun`): Model A (a stocked assembly with pins) takes its BOM literally; Model B (a custom single) pulls its own `/P` core. `/P` cores are STOCKED; phosphating raw → `/P` is a bulk WMS convert (`convert_demand`), never per order.

**The component pre-check** (`finishedRunPrecheck`) runs before every finished-goods WO: in stock → nothing; `/P` short + raw exists → convert demand + `awaitingConvert`; both short → also a component shop WO; raw pull short → shop WO; bought part short → `BUY_NOTE` (a note, never a PO — the decision is a person's). `rawUnknown` → refuse the row. Keep every one of those behaviours.

**Sourcing** (`Shared/sourcing`): IN / OUT / BOTH; BOTH always asks the operator.

**The NetSuite anchor** (`nsWorkOrder.queueNsAssemblyWorkOrder`, D's module, you call it): a milled root that is a NetSuite assembly opens its own WO at creation; a finished stock build opens Route A at release (B's side); Order Entry opens FLOW1/FLOW2 at creation. `parkWorkOrder` carries an **anchor policy**, it does not invent one.

---

## 4. The work, in order

### A1 — `parkWorkOrder`: one writer for all ten intents

New module `src/components/Shared/workOrderCreate.js`. One exported function every screen calls
instead of hand-writing a `hq_work_orders` doc:

```js
parkWorkOrder({
  intent,        // 'STOCK_FINISH' | 'STOCK_MILL' | 'COMPONENT_MILL' | 'REISSUE' | 'ORDER_ENTRY'   (no REMAKE — retired 09-02)
  part, qty, brand, createdBy,
  finish,        // recipe code when known (the suffix, or the OE line's finishCode)
  reqDate, needBy, urgent, note,
  source,        // 'STOCKVIEW_GRID' | 'SALES_SNAPSHOT' | 'RAW_CORES' | 'LIBRARY_MAKEUP' | 'LIBRARY_RUN' | 'SETUP_QUEUE_REMAKE' | 'PRECHECK_MAKEUP' | 'OE_REVIEW' | 'RTG_REISSUE'
  pins, inventory, locationId,     // for the BOM explosion + pre-check
  sales: { soAppId, soId, customerId, customer, flow, nsPlan } | null,
  replaces: { woId, reason } | null,
  anchor: 'AT_CREATION' | 'AT_RELEASE' | 'NONE',
})
→ { woId, gate, made[], routeTo, finPayload }
```

What it does, once, for everyone:

1. **Identity** — `withItemCode`, `type` = the item code (never a category label), `itemName`,
   `stockInternalId`, `productType`, `paintSize`, `rootItem`/`partErpId`/`variantErpId`.
2. **Route** — by the rule in §3. Never blank. Writes `routeTo` on every doc. Route-open parking
   ceases to exist.
3. **Pre-build** — for any FINISHING route, the complete `finPayload` via
   `stockRun.buildStockFinPayload` (extend it; do not write a second builder). Poles get
   `poles/totalPoles` and null sled sizes (`isPoleCategory`); `finishStream` from the part;
   `partsList` from `planFinishedRun`; `tasks: makeFullTasks()`; `sentToPickPack:false`;
   `shopSiblingId/hasCustomSibling` for the sales pair (writer 5 only).
4. **Pre-check + gates** — `runBatchPrecheck` → `executeMakeupActions` → `gate` stamped on the
   doc from birth (`awaitingConvert`, `awaitingComponents`, `componentShopWoIds`). Rod cut via
   `poleCutPlan` → `awaitingRodCut` + the `rod_cut_orders` doc, exactly as the Snapshot does now.
5. **Anchor** — by policy: `AT_CREATION` → `queueNsAssemblyWorkOrder` with the writeBack to this
   doc (root WOs, OE FLOW1/FLOW2); `AT_RELEASE` → nothing here, RTG's Route A does it; `NONE`.
6. **Stamp** `source`, `orderType` (`'stock'` or `'sales'`), `autoFlow: true` on every doc
   (Q6/Q11: RTG releases on its own; no human push), `createdAt/By`, `replacesWo` lineage.
7. **Log** what it made, in the same words on every screen (`made[]`).

Then the ten call sites become one call each. Order of conversion (each its own commit, each
proven by a live run — see §6):

| # | writer | today | after |
|---|---|---|---|
| 3 | Sales Snapshot `StockViewTab.js:1430` | already the model | `parkWorkOrder({intent:'STOCK_FINISH', source:'SALES_SNAPSHOT', anchor:'AT_RELEASE'})` — first, because it changes least and proves the builder |
| 1 | Stock View grid `:728` | enrich-at-release, no `source` | same intent, `source:'STOCKVIEW_GRID'` — this one **gains** a finPayload; the enrich branch stops being reached from here |
| 4 | Raw Cores `:1829` | fine | `intent:'STOCK_MILL', anchor:'AT_CREATION'` |
| 2 | plating base-short `:571` | route-open, no source, no anchor | `intent:'STOCK_MILL', source:'STOCKVIEW_PO_BUILDER', anchor:'AT_CREATION'` — see A3, it moves into the plated triple |
| 6 | Library card `LibraryTab.js:1067` | route-open | `intent:'STOCK_FINISH'` or `'STOCK_MILL'` by suffix — **it now pre-builds and auto-releases through RTG** (Q11); the card's "goes to RTG" behaviour stays, the human push goes |
| 7 | Library `releaseRunToFloor` `:1122` | writes fin directly, second release implementation | parks via `parkWorkOrder` with `autoFlow`; RTG's auto path releases it within the same second. The UX (one press) is unchanged; the mechanism is RTG's. **Coordinate with B** — their builder must be in before this converts, or the run loses fields. If B is not ready, this row waits; do not build a third copy |
| 8 | Setup Queue re-make `SetupQueue.js:508` | B's file | **retired for stock** (Stuart 09-02): the Snapshot addresses a scrapped stock shortfall on future orders; custom re-issue stays RTG's (writer 10). Drop `'REMAKE'` from the intent list |
| 9 | component shop WO `finishedRunPrecheck.js:241` | yours; also writes the shop doc directly when `dispatchShop` | `intent:'COMPONENT_MILL'` — keep the direct shop write for now (it is the OE auto-flow's mechanism); B will absorb it into their shop builder |
| 5 | Order Entry Needs `:2410/:2446` | already pre-builds; the pair | `intent:'ORDER_ENTRY'` with `sales` — carries FLOW1/FLOW2 anchor policy and the Custom sibling |
| 10 | RTG re-issue `RTGDispatchTab.js:1958` | B's file | patch spec to B |

**Downstream trace (rule 4)** for A1, stated here so each plan can cite it: *work orders* — same
ids, same SO anchors, plus `routeTo` + `source` + `finPayload` where they were missing; *finishing*
— identical docs for writers 3/5/8, and writers 1/6 now arrive with the same complete shape (pole
counts, stream, recipe, pulls) instead of being enriched at release; *shop* — writer 4/2/9 shop
docs unchanged in shape; *WMS* — pulls come from the same `planFinishedRun`; the rod cut and
convert gates fire from the same helpers; *NetSuite* — anchors fire from the same
`queueNsAssemblyWorkOrder` calls at the same moments; **no new push, no changed payload**.

### A2 — everything auto-routes; RTG keeps the record (S3)

Falls out of A1 for work orders and A4 for purchase orders. The rule, in Stuart's words: *"all and
any work order for raw stock (shop) or finishing, or a purchase order — they auto route, but RTG
keeps record of all."* So after conversion, on your screens:

- a **finishing** WO parks with `routeTo:'FINISHING'`, a complete `finPayload` and `autoFlow:true`
  — RTG's auto-release takes it the moment its gates are clear; nobody presses Push to Finishing;
- a **shop** WO (raw core, component mill, Library raw make-up) parks with `routeTo:'SHOP'` and
  `autoFlow:true` — same; nobody presses Push to Shop;
- a **purchase order** lands in the vendor's open PO (A4) and appears on RTG's PO panel at once;
  the send to NetSuite is the one act a person does, after checking the vendor's minimum (S5);
- the RTG board shows every one of them, with `source`, from the moment it exists.

Verify, live, that after conversion:
- a Library make-up of a finished item (`H1-138BF/EP1`-class, and a `/BS`-class) parks with
  `routeTo` set and RTG's auto-release takes it — and the board no longer offers **Push to Shop**;
- a Library make-up of a raw item routes SHOP, anchors at creation, and auto-releases;
- a Snapshot raw row parks route-**stated** (`SHOP`), never route-open, and auto-releases;
- a bought short from any screen appears in the vendor's open PO on RTG without a press.

### A3 — the plating triple: `issuePlatedDemand` + the BOM-core report

Stuart's design (§13 a), **settled 09-02 evening after A and D found the double:** *"the plater PO
should stay at WMS at time of ship, but from the Sales Snapshot we will see demand there, so we
need to create demand for these items to be pulled on WMS and sent to the plater tab."* So one
short at the ROP load or the Snapshot → **(1)** a `plating_demand` for the BOM core (the WMS
Plating tab pulls it, moves its bin, stages it for the weekly shipment), **(2)** a shop WO for the
core if it has no stock. **No PO at demand time** — the plater PO is raised by the WMS at the
weekly shipment (Phase 3, `PickPackApp ~2280`), exactly as today; that is the S5 exception. The
demand IS the signal the Snapshot sends; the tab is the connection between it and the shipment.

Today, three copies: PO builder (`StockViewTab.js:545-616`), Snapshot (`createPlatingDemands`
`:1942` + the tier batch's `shop` and `buy` buckets `:1965`), OE review (`:2206` + `:2511`).

New export in `Shared/platingDemand.js`:

```js
issuePlatedDemand({ part, qty, brand, from, createdBy, inventory, nsStock, vendors, soRef })
→ { demandId, shopWoId | null, made[] }
```
- resolves the core with `millBaseOf`, the finish with `isOutsourcedFinishCode`;
- writes the `plating_demand` in the exact doc shape PickPack reads today (`baseErpId`,
  `targetErpId`, `finishCode`, `finishName`, `qty`, `woNum PLW-…`, `status:'open'`) — **no reader
  change**;
- raises **no PO** — the plater PO belongs to the WMS shipment (settled 09-02);
- if `nsStock[core].available < qty` → `parkWorkOrder({intent:'STOCK_MILL', anchor:'AT_CREATION'})`
  for the shortfall, stamped `forPlating: <target>`;
- returns the ids so the caller can log them together.

The three screens call it. The PO builder's inline block and the Snapshot's separate functions go.

**The report Stuart asked for.** A button beside 🪝 on 11.1 (or on Stock View's 3-tier bar —
your call, say which in the plan): **"Plated items without a BOM core"** — every library item
whose suffix is outsourced and which is either not `partClass` Assembly or has no `assembly_pins`
row resolving to its `millBaseOf`. Dry-run report only; it changes nothing. He runs it, it names
the items, NetSuite data gets fixed by a person.

**Trace:** *WMS* sees the same demand doc; *shop* sees a milling WO with a stated purpose; *NetSuite*
gets the same PO through the same outbox path; *finishing* sees nothing (correct — plated work
never enters the spray queue).

### A4 — one PO writer, and POs that open, accumulate, then send (S4, S5)

New `Shared/purchaseOrders.js`. Move the six local helpers out of `StockViewTab.js:1596-1645`
(`loadNsVendors`, `resolveVendorRec`, `resolveVendorByNsId`, `consensusVendorNsId`,
`vendorSubsidiaryGap`, `poRateOf`) and add:

```js
addToOpenPurchaseOrder({ vendorName | vendorNsId, lines:[{part, qty, reason, from}], brand, createdBy, soRef, soAppId, reqDate, note })
→ { poId, created:boolean, rec, gap, lineCount } | { skipped: reason }
```
- **finds the vendor's OPEN PO for this brand** (status `Approved` — the existing pre-queue state;
  do not invent a new status unless RTG needs it, and then coordinate with B) and **appends** the
  lines; creates one only if none is open. Stuart: *"purchase orders should open and items should
  be added before final send, since many vendors have minimum orders."*
- a line for a code already on the open PO from the same `soRef`/WO **adds to its quantity**, it
  does not duplicate the row;
- vendor by name **or** by `consensusVendorNsId` on every path (today only OE review does both);
- `vendorSubsidiaryGap` checked and stamped on every path (today only the Snapshot);
- `source` per line (`from`) and on the PO (`'STOCKVIEW_PO_BUILDER' | 'SALES_SNAPSHOT' | 'OE_REVIEW' | 'PLATING' | 'STOCK_BUILD_NEEDS'`), `note` carried for the memo;
- shows the vendor's minimum beside the running total **if** the record carries one
  (`manufacturingSpecs.moq` / a vendor-level field — read what exists, do not add a sync).

**BOTH asks (S4).** Before any of the three writers — or the pre-check, or the new board — turns a
short on a BOTH-sourced assembly into a document, it asks **work order or purchase order**. The
Snapshot's chooser (`17e1d27`, "BOTH always asks") is the model; make it one shared prompt
component and use it everywhere.

The three writers (`:609`, `:1681`, `:2511`) call `addToOpenPurchaseOrder`. **Hand-offs to B:**
RTG's PO panel becomes the review-and-**send** surface: the open PO shows its lines, sources,
running total and minimum; **Send** is the existing push (`RTGDispatchTab.js:244`), and the memo
at `:268` reads `po.note || po.source` instead of the hard-coded Snapshot text. Their file.

### A5 — the "needs a PO" board for stock builds (Q8)

Today a bought component short on a grid or Snapshot order is a `BUY_NOTE` in a log line. Make it
visible and actionable, modelled on Order Entry Needs:
- `executeMakeupActions` records each `BUY_NOTE` onto the WO doc as `buyNeeds:[{code, qty, vendorName, reason}]` (it already has the data at `finishedRunPrecheck.js:233`);
- Stock View gains a **"Stock Build Needs"** view beside 🧾 Order Entry Needs: every live
  `hq_work_orders` with `buyNeeds`, grouped by vendor, with one **Add to PO** action per vendor
  that calls `addToOpenPurchaseOrder` (appending to the vendor's open PO, S5) and stamps
  `buyNeedsPoId` back on the WO; a BOTH-sourced assembly on the board asks WO-or-PO first (S4);
- a WO whose `buyNeeds` are all covered by a live PO reads as covered (same rule as OE Needs:
  closed/deleted POs do not count).

Nothing automatic — the PO decision stays a person's, which is the rule the pre-check already
honours.

### A6 — the suffix-reader sweep (eight routing-grade sites)

Replace with the `Shared/finishRouting` / `finishingTime` vocabulary — `finishSuffixOf`,
`millBaseOf`, `isOutsourcedFinishCode`, `finishCodeFromErp` — and add one shared `tierOfErp` to
`finishRouting` for the two copies:

| site | replace with |
|---|---|
| `StockViewTab.js:1121` `finishOf` | `finishCodeFromErp` — **but read its comment first**: it strips a `-N` marker and `-10/-12` sizes. If that behaviour is still needed, add it to `finishCodeFromErp` with a test, once. Do not keep two |
| `StockViewTab.js:1875` `tierOfItem` + `LibraryMassUpdateTab.js:745` `tierOfErp` | one `tierOfErp` in `finishRouting` (raw / P / plated / painted) |
| `StockViewTab.js:535`, `:1893`(+`1778`), `:1947`, `:2060` | `finishSuffixOf` / `millBaseOf` / `isOutsourcedFinishCode` |
| `LibraryTab.js:1418` | `isOutsourcedErp` |

`LibraryMassUpdateTab.js` is not yours to own but this one function is a copy of yours — ask any
live peer, then change only that function. The five identity sites and two display sites (audit
§10 Q13) are hygiene; do them only if a commit already touches those lines.

### A7 — `source` on everything

Falls out of A1 and A4. Verify with the RTG board's source column and the deletion ledger that
no order created after your conversions carries a blank `source`.

---

## 5. What you do NOT do

- **No pole tag, no stock-based pole rule.** Q7 second pass: the suffix is the control.
- **No plating redesign.** The process on the WMS Plating tab is the wanted design (Q2). You
  consolidate the *issuing* of the triple; C and D validate the round trip and fix the receipt seam
  (P0 #3).
- **No release-path edits.** `pushToFinishing`, `pushToShop`, `autoSplitSalesOrder`,
  `releaseFinWoToFloor`: B's. You park; RTG releases.
- **No CPQ / Order Entry form work** (E), no floor screens (B, C), no WMS (D).
- **No fixing in passing.** Something adjacent looks wrong → name it in your handoff, move on.
- **No large code change where a tag would do (S1).** If a screen needs an item to behave
  differently, propose the tag (name, values, where 4.5 and the card edit it) and the one read
  site — not a new branch of routing logic.

---

## 6. Acceptance — every row a live run, with Stuart pinned in

| run | expect |
|---|---|
| Snapshot: a finished stock item (`HCUMB410/BS`-class) short | ONE `hq_work_orders` with `routeTo:'FINISHING'`, `source:'SALES_SNAPSHOT'`, complete `finPayload` (pulls, recipe, tasks); RTG auto-releases; Setup Queue shows the recipe group, pulls, no PENDING-RECIPE |
| Snapshot: a stocked pole 4 ft (`HCUMP410/N25`) | same, plus `poles/totalPoles`, `finishStream:'POLES'`, `awaitingRodCut` + a `rod_cut_orders` doc; the cut prints the label; ActiveFloor shows pole steps only |
| Grid: same finished item | **identical doc shape** to the Snapshot's — diff the two docs field by field; the only differences are `source` and ids |
| Grid: `/P` component short, raw in stock | convert demand + `awaitingConvert` on the WO from birth; WMS convert clears it; auto-release follows |
| Grid: `/P` short, raw short | convert demand + component shop WO (`PRECHECK_MAKEUP`, `routeTo:'SHOP'`, root anchor queued) + `awaitingComponents`; RTG clears when the shop completes |
| Library card: finished item make-up | parks with `routeTo:'FINISHING'` and a finPayload; RTG auto-releases; **no Push to Shop offered** |
| Library card: raw item make-up | `routeTo:'SHOP'`, root anchor queued at creation, `source:'LIBRARY_MAKEUP'` |
| Library run (the in-house finishing run) | reaches the floor with the same fields as a Snapshot release — after B's builder lands; before that, this row is blocked, say so |
| Raw Cores: short | `routeTo:'SHOP'`, `source:'RAW_CORES'`, anchor at creation — unchanged behaviour, proven not broken |
| Plated item short (Snapshot, PO builder, OE review — all three) | the triple: `plating_demand` (WMS Plating tab shows it), PO to the plater (RTG PO panel, then NetSuite via the outbox), and a core shop WO **only** when the core is short; all three screens produce identical docs |
| "Plated items without a BOM core" report | lists exactly the items that are not complete assemblies with a core; changes nothing |
| PO from each of the three writers | `source`, `vendorSubsidiaryGap` stamped on all three; the vendor resolved by nsId when the name does not match |
| Stock Build Needs board | a grid order with a bought short shows under its vendor; Generate PO makes one PO; the row reads covered; a deleted PO un-covers it |
| Suffix sweep | `grep -rnE "lastIndexOf\('/'\)|split\('/'\)" src/components/HQ/StockViewTab.js src/components/HQ/LibraryTab.js` shows only identity/display sites, none deciding a route |
| Regression: Order Entry Needs, `HCUMP810 + /N90` and `HCUMP810 + /P01` | one finishing WO / the shop+finishing pair, exactly as b531f53 — proven not broken by A1's conversion of writer 5 |

---

## 7. Sequencing and hand-offs

1. **Plan A1 with the builder's signature and the conversion order above; get approval.** Build
   the module and convert the Snapshot (writer 3) first — the smallest behavioural change, the
   best proof.
2. Convert writers 1, 4, 2, 6 in that order, one commit each, one live run each.
3. **Wait on B for writer 7** (the Library run) — do not build around them.
4. A3 and A4 can run in parallel with step 2; A5 after A4; A6 whenever a commit touches the file.
5. **Patch specs to B**, written into `BRIEF_B_RTG_FINISHING.md` under "hand-offs from A":
   - writer 8 (`SetupQueue.js:508`) and writer 10 (`RTGDispatchTab.js:1958`) → one `parkWorkOrder` call each;
   - the PO memo at `RTGDispatchTab.js:268` → `po.note || po.source`;
   - once `parkWorkOrder` exists, B's builder should read the intent stamps rather than the writers' old field soup.
6. **To D:** the `plating_demand` doc shape is frozen by A3 — D's receipt work reads it; tell D if you add a field.

---

**From E, 2026-09-03 (landed — `eb5cb6b`):** `hq_sales_orders` carries `needBy` (ISO or '')
and `productionNotes` on every door; `needByDate` is written equal to `needBy` for one release,
then stops. **Patch (Order Entry Needs, StockViewTab ~:2157/:2199/:2337/:2516):** read
`so.needBy || so.needByDate`; keep `productionNotes`. Also readable: `so.recipes[]` (the distinct
finish codes of the to-be-finished lines), `so.recipe` when exactly one, `so.readyDate /
leadWeeks` (painted 4 wk, plated 6, Rush → 2/4). `line.finishOutsourced` is on tab 7's lines
as before, from the shared `Shared/salesOrderHeader.isFinishOutsourced`.

## 8. Open questions for Stuart (ask before the plan, not during)

1. The "Plated items without a BOM core" report — 11.1 beside 🪝, or on Stock View's 3-tier bar?
2. `finishOf`'s `-N` marker / `-10`/`-12` size stripping (`StockViewTab.js:1119`) — still real
   item-code conventions, or historical? Decides whether `finishCodeFromErp` gains that behaviour.
3. Stock Build Needs: one PO per vendor across all open stock WOs (like the Snapshot), or one per
   WO (like OE review)?

---

## 9. Handoff

When you stop, write `BRIEF_A_HANDOFF.md`: what shipped (commit, run, proof), what is blocked and
on whom, the exact state of each writer in the §4 table, and anything adjacent you named and did
not fix. Update `SYSTEM_FLOW_AUDIT.md` §2's table to the new state — that table is the shared
truth every brief reads.

**The guide (S2) — not optional.** Before the handoff, update the in-app User Guide
(`src/components/HQ/UserGuideTab.js` — the Work Orders section, Stock View / Sales Snapshot /
Master Library subsections, and the Purchase Orders text) and the repo guide it mirrors, so a
team member reading the guide sees: orders route on their own and RTG records them; POs open and
accumulate until sent; BOTH items ask; where the Stock Build Needs board is and what "covered"
means; and the plated-item triple in plain words. List the sections touched in the handoff.

### Hand-offs from B — the names, verbatim (shipped 3133aba (B5) + 7182f2e (B2), 2026-09-02)

`Shared/workOrderContract.js`: `CUSTOM_FAB_STATUS = { PENDING:'Pending', IN_PROCESS:'In Process', SENT_TO_PLATING:'Sent to Plating', COMPLETE:'Complete' }`; `mirrorCustomStatusToSibling(shopOrderOrLink, status)` — unchanged signature, reads only `finSiblingId`, refuses an unknown status, stamps `customFabAt`.
`Shared/orderStatus.js`: `customPartsReady(wo)` (the one pack-gate test), `customFabLabel(wo)` ("At the plater since <date>"), stage `PLATING`; `GATES`, `gatesOf(wo)`, `openGatesOf(wo)`, `isReleasable(wo)`, `gateSummary(wo)`.
`Shared/orderLifecycle.js`: `propagateFloorState(ctx, { finWo, phase, by })` — phases `'Plating Received'` (receipt) and `'Plated'` (build-back) are B's vocabulary; `'Sent to Plating'` is only ever a `customFabStatus` value.
Contract text: `WORK_ORDER_CONTRACT.md` §5 / §5a.

### Hand-off from B — a BOM pull line that is a NetSuite INTERNAL ID, not an item code (Stuart, 2026-09-04)

**Evidence.** RTG card WO-HCUDEC15-N34-000565-6 (NetSuite WO11588): "Stock View grid · HCUDEC15/N34 ×2 ·
BOM pull: 2×7674". The pull line's `legacyErpId`/`partId` is `7674` — a NetSuite internal id — so the
WMS cannot pick it (nothing scans as 7674) and the floor card names no component. Stuart: "it is on
old item not sure why".

**Cause (verified in code, not data).** `Shared/finishedGoodsRun.pinErpOf(pin, inventory)`: when the
pin has no `legacyErpId`, it looks `pin.partId` up in `inventory` (by doc id / itemId / code /
`netSuiteInternalId`) and, on a MISS, **returns `pid.toUpperCase()` — the raw partId — as if it were
a code**. The inventory the Stock View grid hands the planner is `enrichedInventory`
(`StockViewTab.js:2338`), which EXCLUDES retired items (`isRetired` + the retired NetSuite-id set).
So a component that is retired/old, or simply absent from the library, can never resolve and its
internal id leaks through as the pull code. The planner's `usablePin` accepts it (a numeric string
is not FEE/HIDDEN/OPT), the note is built from it (`:697`), and `parkWorkOrder` parks it verbatim.

**Fix (yours — `finishedGoodsRun.js` + the grid):**
1. `pinErpOf` never manufactures a code from an unresolved id: on a miss return `''` (or `{ code:'',
   unresolved: pid }`), and `planFinishedRun` emits the line as `unresolved: true, partName:
   "component not in the library (NetSuite id 7674)"` with `legacyErpId: null` — the same honesty
   the pick list already has for "not in the library … fix the flow step".
2. `parkWorkOrder` REFUSES to park a finishing run whose plan carries an unresolved line
   (`ParkRefusal { code: 'BOM_UNRESOLVED' }`, naming the pin and the parent), so the WO is never
   created with a pull nobody can pick. **The refusal's message says what to do (Stuart,
   2026-09-04): "The BOM for <parent> names a component the app cannot resolve (NetSuite id 7674).
   Either FIX THE BOM — link that pin to a library item with an item # — or run this as a JUST FOR
   PAINT job (Master Library → JFP), which takes the NetSuite item # and the pull item directly."**
   Same sentence on the grid row, the Snapshot, the Library card and the pre-check — wherever the
   refusal surfaces. (Rule 3: no stopgap that lets it through with a warning.)
3. Resolution should also try the FULL library (retired included) for the lookup — a retired
   component is still a real NetSuite item the pick can scan; `enrichedInventory`'s retired filter
   is right for the GRID's rows, wrong for resolving a BOM pin.
4. Adjacent, named: the grid let an OLD parent (HCUDEC15/N34) be ordered at all — if it is
   retired, the row should not be orderable; if it is not, say why it reads "old".

**Already live, needs a hand fix:** WO11588 exists in NetSuite and on the floor with an unpickable
pull; close/re-issue once the pin resolves (B's writer-10 re-issue via `INTENT.REISSUE` once built,
or by hand now).

**Downstream:** finishing — a card that names its component; WMS — a pull that scans; NetSuite —
the WO's component demand already carries the right item (NetSuite resolved the BOM itself), so
only the app's pull line was wrong. No RTG change.

### Hand-off from B — clearConvertGate's STOCK branch releases through Shared/floorRelease (2026-09-04)

Your 2026-09-02 comment is exactly right ("a stock order released here would reach the floor
unanchored, so the cleared gate hands it to RTG's auto-release effect, which releases AND
anchors") — and that effect runs only while an RTG tab is open (Stuart today: "imperative").
The anchoring release now exists outside RTG: `Shared/floorRelease.releaseStockWoToFloor({ hqOrder,
brand, by, log })` (verbatim payload + Route A, STOP + dedupeKey, refuses sales/no-payload/
already-dispatched). Patch: in `clearConvertGate`, after the re-read, keep your eligibility line
for sales (`releaseFinWoToFloor`) and add the stock branch:
```js
else if (wo && wo.autoFlow && wo.status === 'Approved' && isReleasable(wo) && wo.finPayload) {
    const res = await releaseStockWoToFloor({ hqOrder: wo, brand: wo.brand, by: operatorName || 'convert-complete' });
    if (res.released) return 'released';
}
```
`wo.brand` is on every parked doc (your stamps). Same for the rod-cut path on D's side (spec in
Brief D). After both land, RTG's tab-bound effect is the safety net, not the mechanism.
