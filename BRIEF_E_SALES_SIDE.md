# Brief E — CPQ · Vision · Order Entry: one sales order, whichever door it came through

*Cut from `SYSTEM_FLOW_AUDIT.md` (§6, §10, §13 e/g) and the hand-offs from B and D. Inherits
`CPQ_ORDERENTRY_TAB11_BRIEF.md` (08-26) §1 for what shipped on the sales side and §2 for what was
still open; the session that wrote it worked the traverse and kit surfaces through 09-01 and was
retired (Q14) — if its handoff appears, read it first. Written 2026-09-02. This session's job: the
two doors a customer order comes through — CPQ (with Vision and the portal feeding it) and Order
Entry — write **one** sales-order header, stamp the finish **once**, and send NetSuite **one**
header; and the dead generator in tab 7 goes.*

## ⛔ WORKING AGREEMENT (Stuart, 2026-08-31) — binds this session

1. **Plan first, always** — state the plan and WAIT for approval before editing code, shipping, or
   changing production data. Reading and measuring need no permission; changing does.
2. **Requested scope only.** Adjacent problems get NAMED, not fixed.
3. **No temporary fixes.**
4. **Look downstream — RTG is the single source of truth.** CPQ and Order Entry are the kickoff of
   the entire operation: what they write becomes work orders, both floors' queues, the WMS pick
   and the NetSuite transaction. Trace every change through all of them and say so in the plan.

**Two sales-side rules already in force** (`CROSS_SESSION_CONTRACT.md`): **never hardcode against
flow details** — flows are data (`cpq_flows`), resolve through the flow doc / library / finishes at
read time; and **a screen shared by several flows is extended by ADDING, never by editing** —
Stuart on Vision Hardware, 08-08: *"it is imperative we do not alter how it works … this screen is
tied into several CPQ flows that all function."* One guarded mount, then `git diff -w` proves the
rest untouched. Plus this fortnight's: **ask, don't derive.**

## ⚙ STANDING RULES (Stuart, 2026-09-02) — verbatim from Brief A

**S1 · Tags before code.** **S2 · The guide moves with the code** — sections 8, 7 and 4.6 exist
(`UserGuideTab.js:162, :177, :189`); you update them. **S3 · Everything auto-routes; RTG records
everything** — both doors record to RTG (they already do; the audit's claim that Quick Ship had no
RTG card was wrong and is corrected in §6). **S4 · BOTH always asks** — Order Entry's to-be-finished
lines already ask at the review gate; keep it. **S5 · POs open, accumulate, then send** — not a
sales-side concern.

**Decisions that bind this brief:** *Q9* — **one SO header shape regardless of door, "whether
generated from CPQ or order entry."** *Q10* — **the recipe stamped at save, "same for order entry
when ordering a custom finished item."** *Q12* — the retired tab-7 generator goes. *Q6* — Order
Entry's stocked lines go straight to WMS; the record is on RTG. *B §8 answer 2* — outsourced
finishes never enter the finishing floor: B's split needs to know a line's finish is outsourced
**from the sales doc**, so you stamp it. *Q7, second pass* — the pole rule is the suffix; nothing
here re-derives it.

---

## 0. Operating the session

**Login.** Stuart pins you in — **Claude-in-Chrome**, his session, `find`→ref, never credentials.
HQ: Factory Portal (email+password) then the Enterprise PLM PIN on every `/hq` load. Auth survives
SPA tab-switching, not reloads.

**Vercel.** `curl -s https://www.4cosworkcenter.com/version.json` → stamp after commit time.
**`CPQTab` and `HardwareConfigurator` are in `main.*.js`; `QuickShipTab`, `ExternalCoopTab`,
`VisionHardware` are lazy chunks** — sweep `/asset-manifest.json`. String-literal markers only.
**Save-is-send refuses from a stale bundle** (`assertFreshBundle` on finalize, `cc85d66`): after a
deploy, reload → Stuart re-PINs, or the finalize you are testing will refuse on purpose.

**Cloud Shell.** Rules are deployed. The portal's functions (`portal*`) are not yours; if your
header change reaches them (§4 E8) it is a hand-off.

**Git.** Multi-session repo: never switch branches, stage only your files, `pull --rebase
--autostash`, fix-forward, lint to 0 errors. `CPQTab.js` (5,376 lines) and `QuickShipTab.js`
(2,452) took 21 commits each since 08-25; `ListAgents` and ask before either.

**Diagnosis.** Tab 12 (ERP Push/Pull) is the NetSuite **pre-flight** — it shows the exact payload
a job would send without sending it; the RTG Transmit Log shows what was sent and what NetSuite
said. The 🩺 Flow Doctor in CPQ diagnoses a flow live. Firestore is App-Check locked.

---

## 1. Territory

**You own:** `src/components/HQ/CPQTab.js` · `VisionHardware.js` · `ClientVisionTab.js` ·
`QuickShipTab.js` · `ExternalCoopTab.js` (the CRM: quote/SO surfaces, approve, edit, close, the
pipeline view) · `ERPPushPullTab.js` (tab 12) · `Shared/nsTransmit.js` · `Shared/hardwareHandoff.js` ·
`Shared/lineClassification.js` · `Shared/reopenQuote.js` · `Shared/quoteDisplay.js` ·
`Shared/visionBridge.js` · `Shared/printForm.js` · `Shared/QuickShipInvoiceModal.js` ·
`Shared/aliasIdentity.js` · `Shared/brandNetsuite.js` (the brand map — A and D read it; tell them
when it grows) · the new `Shared/salesOrderHeader.js` this brief creates.

**Read-only:** F's — `HardwareConfigurator.js`, `hardwareModel.js`, `hardwarePricing.js`,
`kitSeed.js`, `kitCode.js`, `CustomerCollectionsTab.js`, `SpecSheet/*`, and the flow generator in
`AdminTab.js`; A's — `StockViewTab` (Order Entry Needs reads your SO header — you hand them the
field names), `oeReviewPlan`, `finishRouting` (you *call* `isOutsourcedFinishCode`); B's —
`RTGDispatchTab` (`autoSplitSalesOrder` reads your header — hand-off), the floors; D's — the WMS
(reads `lines[]` and the header for pick/pack/fulfil — hand-off); the portal (`portal/`,
`functions/portal*`) — mirror, §4 E8.

**Must not touch:** the engine (F), the split (B), the writers (A), the WMS (D), pricing rules
(`priceChoice`, `clientPricing`, `priceLevels` — settled), and Vision's shared screen except by
adding one guarded mount.

---

## 2. What this brief inherits

| ref | item | this brief's part |
|---|---|---|
| **Q9** | one SO header shape, both doors | E1 |
| **Q10** | recipe stamped at save, both doors | E2 |
| **Q12** | delete `QuickShipTab.js:1545–1701` | E4 |
| audit §6 / P2 #14 | two sales-order shapes; CPQ's SO doc is thin (`CPQTab.js:3010-3017`), Quick Ship's is rich (`QuickShipTab.js:1446-1500`); RTG reads `so.reqDate` for one and `so.needByDate` for the other | E1 |
| **found 09-02** | CPQ's SO `reqDate` is `Date.now() + 14 days` (`CPQTab.js:3015`, and portal approve `ExternalCoopTab.js:908`) — there is **no need-by on a CPQ job**; RTG schedules every CPQ order on an invented date | E1 (the field) + §8 Q1 |
| **found 09-02** | **two NetSuite header builders**: `nsTransmit.buildNsTransaction` (`:592-610`) and Quick Ship's inline copy (`QuickShipTab.js:1323-1331`), each hard-coding `brand === 'ce' → customForm 177/299 + class 2`, each resolving the ship method separately (`resolveShipMethod` vs `shipMethodRef`) | E3 |
| D §4 D4(c) | Sinaya's "Please enter value(s) for: Class" — a non-CE brand sends no class | E3: the per-brand class/form map |
| B §4 B4 | B reads `so.recipe` once you stamp it; keeps the five-source scan as a fallback that names its source | E2 |
| B §8 answer 2 | B's split must drop the finishing doc for an outsourced recipe — it needs to know from the sales doc | E2: `finishOutsourced` per line, both doors |
| audit §8 | `queueEstimateToSalesOrder` — "⚠ Needs live verification on the first real approve" (`nsTransmit.js:642`) | §8 Q2 |
| peer session, 09-01 | item **58034** (track splice) pushes twice at $0 on a traverse order where the configurator also picks a splice — real double stock relief, unfixed; and **past traverse orders are missing their TRACK line** in NetSuite (the forward fix `5b7faae` does not touch posted orders) | E6 |
| retiring session, closing comments (relayed by Stuart 09-02) | **the Kit-class push path is untested**: a cuff-bracket kit (`H1-2RCTCB / ECB / 6CB`, client rows `H3622F / H3623F / H3624F`) reaching NetSuite through the TAGS engine must be proven to emit items **59101 + 64805 / 59100 / 64806** rather than let the dollars ride the rollup — the `21b43b0` joiner-incident class (memory `cpq-parts-universe-seam`) | §6 acceptance; tab 12 first, then one live order |
| `CPQ_ORDERENTRY_TAB11_BRIEF.md` §2 | its still-open list (per-foot $0 quotes reopen once; the H1-75 depth audit; kit sheet imports) | fold what is yours into §6; the kit items are F's |
| memory `portal-cpq-contract` | the portal mirrors CPQ logic — a logic/schema change needs the mirror sweep | E8 |

---

## 3. The rules you build on — settled

**Save is send.** CPQ finalize writes the job (`jobs`, `cpqData.{breakdown, cartItems,
configuration, quantities, dimensions}`, `engineeringNotes`) and, for a sales order, the
`hq_sales_orders` doc and the outbox transaction in one press (`CPQTab.js:2981-3035`); NetSuite's
number writes back to both (`jobsSalesOrderWriteBack`, `boardSalesOrderWriteBack`). Order Entry
writes its SO doc `NS_QUEUED` and the writeBack flips it to `Pending` with the real number
(`QuickShipTab.js:1465-1467, :1707`). The portal approves an existing estimate into an SO by
transform (`queueEstimateToSalesOrder`).

**One parts universe** (`21b43b0`): the CPQ pushes from the same parts it priced from
(`libraryParts + liveAssemblies`, deduped). A line that cannot reach NetSuite **blocks** the queue
(`cc85d66`) — never a silent rollup.

**The line contract** (`Shared/hardwareHandoff.js` §top): every breakdown line carries `name, qty,
price, total, partHandling, partId, legacyErpId, isFee, cutLength, dimensions, finishCode,
finishLabel, hidden, clientSku`. Six consumers read it; **"the new engine does NOT invent a
payload."** `classifyLine` routes on the ITEM's handling first, the line's second.

**Which item a finished line consumes** (`routeFinishedItem`, `nsTransmit.js:65`): outsourced →
finished stock; in-house → finished stock only where flagged stocked; paint → the one `/P` item;
else the base item. Lifted out so the TAGS engine and the push share it. Do not fork it.

**Vision** engineers; CPQ quotes what was engineered. Vision writes `cpq_drafts` with the full cut
sheet in `specs.engineeringNotes`; CPQ reads the draft (`visionBridge.seedFromVision` — matches on
part numbers, **reports `missed`, never approximates**); the job's `engineeringNotes` become the
shop's `fabNotes` at split (B's). Vision never writes a sales order.

**The portal** submits `PORTAL_REQUEST` jobs with **no breakdown, by design** — staff price them in
CPQ; the same finalize follows. `portalStock`/`portalStockQuoteRequest` mirror tab 7's picker.

**The three reopen doors** (`reopenQuote.js`): CPQ restores the locked job context from
`hq_reopen_quote` and re-finalizes into the **same** job id; Vision restores the session; Order
Entry restores the **cart** the quote was built from (`quickShipCart`, since 08-31) and saving
supersedes the old quote. None gates the others (`a6b3ba3`).

**Identity:** the real item is the identity everywhere; an alias rides alongside for display and
documents (`aliasIdentity`, `clientSku`). Quick Ship transmits EACH counts, never packs. A traverse
kit is its own line on documents and a holder line in NetSuite (`8952f95`).

**The CRM** (`ExternalCoopTab`): pipeline-first customer view (quotes | sales orders, live floor
status), approve → SO, edit/close an SO gated by its work orders (`c40572d`), the documents print
`customerDocLines` with the finish said on every line (`ec23ccd`).

---

## 4. The work, in order

### E1 — one sales-order header (Q9)

New `Shared/salesOrderHeader.js`:

```js
soHeaderOf({ door: 'CPQ' | 'QUICKSHIP' | 'PORTAL', job, form, customer, brand, by })
→ {
  customer, customerId,
  customerPo,            // CPQ: job.poNumber · QS: soExtras.po
  sidemark,              // CPQ: orderSidemark || sidemark · QS: soExtras.sidemark
  jobName,
  needBy,                // the customer's date — NEVER today+14 (see §8 Q1)
  shipTo: [],            // resolved address lines, both doors (QS builds them today, :1456)
  shippingMethod, shippingAddressId, customShippingAddress, shippingAmount,
  productionNotes,       // QS: soExtras.prodNotes · CPQ: new field, or engineeringNotes.shopNotes
  internalMemo,
  memo,                  // derived: sidemark || jobName — the one RTG shows
  recipe, recipes,       // E2
  orderClass, source, hqJobId, appCreated,
}
```

- CPQ save-as-SO (`CPQTab.js:3010`) and portal approve (`ExternalCoopTab.js:903`) write it from
  the job; Order Entry (`QuickShipTab.js:1446`) writes it from the form — **the same keys**.
- **Readers move to one set** — hand-offs: **B** — `autoSplitSalesOrder` and the board read
  `so.needBy` (not `reqDate`) and `so.memo`; **A** — Order Entry Needs reads `needBy`,
  `productionNotes` (already those names — good); **D** — pick/pack/labels read `shipTo`,
  `customerPo`, `sidemark`; **documents** (`printForm`, `QuickShipInvoiceModal`,
  `customerDocLines`) read the one set — they already read `customerPo / sidemark / shipTo /
  needByDate / productionNotes`, so rename `needByDate → needBy` once and everything reads.
- **Migration:** write the old names alongside (`reqDate`, `needByDate`) for one release, switch
  every reader, then stop writing them. No backfill of old docs; readers fall back.

**The +14-day fiction.** `reqDate: new Date(Date.now() + 12096e5)` on every CPQ SO and every portal
approve. A CPQ job has no need-by. E1 adds it (§8 Q1 decides where it comes from) and until it is
answered, the SO doc carries `needBy: null` and RTG shows "no date" instead of a date nobody chose.

**Downstream trace (rule 4):** *work orders* — the split reads the same SO, one field name for the
date; *finishing / shop* — `reqDate` on floor docs is copied from the SO's `needBy` at split (B) —
real dates, at last; *WMS* — pack and labels read one header; *NetSuite* — E3 sends the same header
from the same object; *CRM / documents* — one set. **Nothing changes in what NetSuite receives
except the class map (E3).**

### E2 — the finish stamped once, at save (Q10, B4, answer 2)

- **CPQ:** move RTG's five-source resolver (`fetchEnrichedJobData` `:739-776` — `cartItems[]
  .finishLabel`, `finishes[]`, `config` keys, `engineConfig.globalFinish`, `breakdown[].finishCode`,
  matched against `master_finishes`) into `Shared/salesOrderHeader.resolveJobRecipe(job,
  masterFinishes)` and call it at finalize. Stamp `recipe` (a **code**, `RF1`, the contract's
  form) and `recipeLabel`, plus `recipeSource` naming which of the five it came from — or
  `'none'`, so PENDING-RECIPE explains itself on B's floor. B then reads `so.recipe` first and
  keeps its scan only for docs saved before this (B4).
- **Order Entry:** each to-be-finished line already carries `finishCode`; stamp `recipes[]` (the
  distinct codes) on the header and `recipe` when there is exactly one. Order Entry Needs keeps
  reading the line's.
- **Both doors:** `finishOutsourced: isOutsourcedFinishCode(code)` on every line that carries a
  finish (Quick Ship stamps it today, `:1477`; CPQ lines do not) — this is what lets B's split
  write **no finishing doc** for an outsourced recipe (answer 2), and the WMS label say FROM
  PLATING. One shared test, never a local regex.

**Trace:** *finishing* — the Setup Queue receives `recipe` from the SO; *shop* — `finishRecipe`
from the same; *WMS* — `finishOutsourced` on the line; *NetSuite* — unchanged.

### E3 — one NetSuite header (D4 c, the second builder)

`buildNsSalesHeader({ brand, nsCustomerId, header, asType })` in `nsTransmit.js`, returning the
`entity / subsidiary / location / customForm / class / memo / otherRefNum /
custbody_bit_internalmemo / custbody50 / shipping…` block — called by `buildNsTransaction`
(`:592`) **and** by Quick Ship (`QuickShipTab.js:1323`), whose inline copy and `shipMethodRef`
cache go. The brand's `customForm` ids and **`class`** live in `Shared/brandNetsuite.js` beside
`BRAND_NETSUITE_MAP` — one map, four brands, filled with Eric (§8 Q3); a brand with no class
entry **refuses to queue** with a named error rather than sending nothing (the `cc85d66` rule).
`resolveShipMethod` is the one ship-method lookup. **Lines stay door-specific** — CPQ's rollup +
items, Quick Ship's each-lines — that is by design.

**Trace:** *NetSuite* — identical headers from both doors; Sinaya's Class error cannot recur;
*everything else* — nothing.

### E4 — the dead generator goes (Q12)

Delete `QuickShipTab.js:1545–1701` — the `if (tbfLines.length && !OE_SAVE_AUTOFIRE_RETIRED) { … }`
block, 157 lines — and the flag at `:1541`. `tbfMade` / `woWriteBacks` (`:1533-1534`, referenced at
`:1707-1709`) go with it. The hand-off message at `:1542` stays. One commit; `git diff -w` shows
only removals.

### E5 — Vision, unchanged, proven

Vision is extended by adding only. After E1/E2, run a Vision line → CPQ → finalize → SO and prove:
the draft seeds (`visionBridge` reports no `missed`), `engineeringNotes` reach the job, the SO
header carries the sidemark and the need-by, the split's `fabNotes` carry the cut sheet. `git diff
-w` on `VisionHardware.js` is empty or one guarded mount.

### E6 — the traverse items the peer session found

1. **58034 pushes twice at $0.** *(Corrected 09-02 by the E session — the kit-builder slot
   `cfg.spliceId` is the ordinary pole-kit builder and is NOT the source.)* On a tab-7 traverse order
   the double is: (1) `applyTrvComponents` pushing the modal's chart-included splice as an ordinary
   cart line (→ a NetSuite line at $0), and (2) `explodeTraverse` at save adding `P.splice` from the
   usage-count table into `trvPushLines` (→ a second $0 line) — same item, both at chart count.
   Fix shape: **one owner** — the configurator line carries its role, and the explosion drops roles
   the cart already carries for that kit. CPQ's path has no explosion; its only risk is
   `flow.extraItems` listing the same splice — prove on tab 12, don't assume. Real double stock
   relief until then.
2. **Past traverse orders missing the TRACK line.** `5b7faae` fixed resolution going forward.
   Produce the list — jobs with a `trvOrder` saved before that commit that reached NetSuite — with
   their SO numbers, for Eric to add the line by hand. **Do not post anything.**

### E7 — the reopen doors after E1

All three reopen paths must restore the new header: CPQ's `hq_reopen_quote` payload carries
`needBy / customerPo / productionNotes`; Order Entry's `quickShipCart` restore repopulates
`soExtras`; Vision's session restore is untouched. A quote saved before E1 reopens with the fields
blank, never with `+14 days`.

### E8 — the portal mirror (hand-off or follow-on)

The portal fills a job the same finalize consumes, so E1/E2 reach it: `portalQuoteRequest`,
`portalStockQuoteRequest`, `portalVisionDraft` (`functions/index.js`). Per `portal-cpq-contract`,
a schema change needs the mirror sweep. **Ask (§8 Q4)** whether E does it after E1 lands or hands
the field list to a portal session. Until swept, portal-created jobs finalize with `needBy: null`
— honest, not broken.

### E9 — the guide (S2)

`UserGuideTab.js` **"8 · CPQ Configurator"** (`:162`), **"7 · Quick Ship / Order Entry"** (`:177`),
**"4.6"** (`:189`), and the CRM pipeline text: the one header (what "need by" means and who sets
it), the finish stamped at save, what "outsourced" does to routing, the reopen doors. Plus the
repo guide. Listed in the handoff.

---

## 5. What you do NOT do

- **No flow hardcoding.** Resolve through the flow doc, the library, the finishes.
- **No engine changes** (F) — `HardwareConfigurator`, the model, pricing. **No split logic** (B).
  **No writers** (A). **No WMS** (D).
- **No second header builder, ever again** — E3 is the one; a new door calls it.
- **No editing Vision's shared screen** — add a guarded mount or nothing.
- **No pricing changes.** `priceChoice` is the one chain; the checkout model is settled.
- **No posting to NetSuite for the data pass** (E6.2) — a list for Eric, nothing else.
- **No pole tag.** No fixing in passing.

---

## 6. Acceptance — live runs, Stuart pinned in, tab 12 and the Transmit Log open

| run | expect |
|---|---|
| CPQ custom order, finalize as SO | `hq_sales_orders` carries the E1 header, `recipe` + `recipeSource`, `finishOutsourced` per line; NetSuite header identical to before plus the class map; RTG shows the real `needBy` (or "no date"), never +14 |
| Order Entry stocked order | same header keys; `NS_QUEUED → Pending` with the real SO #; straight to the WMS pick; RTG record present |
| Order Entry to-be-finished line, `/EP3` | line `finishOutsourced:true`, `recipes:['EP3']`; Order Entry Needs routes it to the plating triple (A); no finishing WO |
| Non-CE brand sales order | class sent from the map; queue refuses with a named error if the brand has no entry |
| Portal approve → SO | E1 header from the job; `queueEstimateToSalesOrder` verified live (§8 Q2) |
| Vision line → CPQ → SO | `missed` empty; cut sheet on the job; `VisionHardware.js` diff empty or one mount |
| Traverse order with a splice | **one** 58034 line on tab 12 and in NetSuite |
| Cuff-bracket kit (`H1-2RCTCB`) through the TAGS engine → SO | tab 12 shows **59101 + 64805/59100/64806** as their own lines at their own rates; nothing on the rollup that belongs to an item |
| The TRACK list | SO numbers for Eric; nothing posted |
| Reopen CPQ / Vision / Order Entry after E1 | header fields restored; a pre-E1 quote reopens blank, not +14 |
| tab 7 after E4 | `git diff -w` = removals only; every tab-7 flow still works (cart, kits, aliases, per-foot, documents, save) |
| B's Setup Queue (with B4) | a CPQ order's group is its stamped recipe; PENDING only with `recipeSource:'none'` |
| Documents (quote, SO, invoice, packing list) | print `customerPo / sidemark / shipTo / needBy / productionNotes` from the one header, both doors |

---

## 7. Sequencing and hand-offs

1. **E1 + E2 planned together** (one header, one commit per door). Ship CPQ first (it carries the
   +14 fiction), Order Entry second (mostly renames), portal approve third.
2. E3 any time — it is self-contained and closes Sinaya's error; get the class map from Eric first.
3. E4 now. E6.1 now; E6.2 is a list. E5, E7 after E1. E8 per §8 Q4. E9 last.
4. **Hand-offs out:** **B** — read `so.needBy`, `so.recipe`, `line.finishOutsourced`; **A** — Order
   Entry Needs reads `needBy`; **D** — the header keys for pack/labels, and `finishOutsourced` on
   lines; **F** — nothing; **portal** — the field list (E8); **Eric** — the class map, the TRACK
   list.
5. **Hand-offs in:** D's class-map request; B's date for reading `so.recipe`.

### Hand-off in from F — the kit bill shape (Stuart's decision, 2026-09-03; patch spec, F does not edit these files)

**Decision (Q1 of Brief F §8, answered in the F session):** ONE shape on BOTH doors — tab 7 and
CPQ must "be aligned and appear the same". Customer paperwork (quote, SO, packing slip, invoice),
in this order:

1. the **kit code + first 4 ft**, at the kit price (the customer's kit row); the **motor folds into
   this line at the per-motor code** (tab 7's way — H1-2TRV-4M/P-35C, not "kit + motor");
2. **additional feet** immediately below, at the billable per-foot rate (the row's `perFootPrice`);
3. any **additional billable components added in CPQ** (extra brackets, a finial, rings above the
   chart…) next, at their billable rate;
4. then **every included kit component at $0.00** (the chart's brackets, carriers, end stops, the
   feet inside the kit — the packing slip still lists them).

**NetSuite:** every item pushes at **$0.00** and the **total per configuration (kit + extras)
rolls up into ONE line.** Neither today's shape is it exactly: tab 7 puts the traverse $ on the
CE-TRV-SYSTEM holder with components at $0 (close — but the kit's paperwork order and the
per-config total need checking); the engine puts the kit $ on the generic CPQ rollup (61502) and
pushes the fascia at qty × feet at its rate and every component at its own rate (wrong under the
decision — components must be $0).

**Split of the work.**
- **F (kitSeed.applyKitPricing, its own module):** emit `lines` already in the order above; mark
  every included component `inKit: true, total: 0` (included = in `explodeTraverse(kit, length)`
  up to the chart qty — counts above it bill the difference, as the components chart already
  does); fold the motor into the kit line (`billedId` = the per-motor code, price from
  `kitMotorCodes`); keep `feet`/`cutLength` untouched (the bench reads them). Node-tested with
  prod-shaped fixtures. Stuart's 1a/1b: projection stays asked; seed, never lock.
- **E (nsTransmit, the TAGS branch ~:153):** when the cart carries a kit (`cart.kit` / a line with
  `isKit`), push **every** component line at rate 0 (still qty × billed feet for per-foot items, so
  stock relieves correctly) and put the **whole configuration total** on ONE holder line. Use the
  same holder both doors use — tab 7's **CE-TRV-SYSTEM** (fallback 61502 exactly as tab 7 does)
  — with the description carrying the kit code / per-motor code so Eric can read it. Today's
  "kit dollars ride the rollup, components at their rates" must go; otherwise the SO total is the
  kit + the parts.
- **E (hardwareHandoff.handoffItem, the breakdown assembly):** F's `applyKitPricing` now stamps
  every line with `billGroup` (1 kit · 2 extra feet · 3 added · 4 included, `BILL_GROUP` in
  `kitSeed.js`). Stamp the rows handoff builds itself — `extraRows` = 3, `trvRows` = `billable ? 3
  : 4` — and, when any line carries `billGroup`, STABLE-sort the final `breakdown` by it before
  the total. That is the whole change; nothing is removed.
- **E (customer documents):** print `pricingBreakdown` in the order it arrives; no re-sorting.
  Tab 7's traverse mirror (`trvDocLines`) already prints kit → parts; align its order to 1-4 too.
- **Prove on tab 12** with one kit-seeded CPQ order and the same kit on tab 7: identical line
  order on paper, identical NetSuite payload shape (one holder at the config total, N lines at $0).

**Q3 confirmed the same day:** E owns the 58034 double-push + the past TRACK list; F owns the
components step and will name the engine's splice source (`HardwareConfigurator` spliceCodes /
the Vision seed's `seed.splices`) when E asks.

---

## 8. Open questions (ask before the plan)

1. **The CPQ need-by.** A CPQ job has none today. Add a date at finalize (sales sets it), take it
   from the customer's requested ship date on the quote, or leave it null until the CRM sets it?
2. **Estimate → SO transform** (`nsTransmit.js:642`): has a real portal/CRM approve ever posted
   through it? If not, the first one is a watched run.
3. **The class map** — Eric: class ids per brand (CE = 2 Hardware; M2C, Uniquity, Leyla = ?), and
   the sales-order / estimate form ids for each.
4. **The portal mirror** — E after E1, or a portal session with the field list?
5. **The retired session's handoff** — **not written as a file** (checked 09-02). Its closing
   comments are recorded here (§2) and in Brief F §2/§3; E starts from `CPQ_ORDERENTRY_TAB11_BRIEF.md`
   §1/§2 and this brief.

---

## 9. Handoff

`BRIEF_E_HANDOFF.md`: what shipped (commit, run, proof), the state of E1–E9, what waits on Eric /
B / D / the portal, anything named and not fixed. Update `SYSTEM_FLOW_AUDIT.md` §6 to the new
state. **The guide (S2):** the sections in E9, listed.
