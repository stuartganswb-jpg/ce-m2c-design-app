# Brief E — Handoff (sales side: CPQ · Vision · Order Entry · CRM SO surfaces · tab 12)

*Written 2026-09-03 by the Brief E session. Read `BRIEF_E_SALES_SIDE.md` first (territory, rules,
acceptance); this file is the state after the first shipping night. Line numbers are as of
tonight — re-locate by symbol.*

## 0. Stuart's answers to §8 (given in this session, 2026-09-03)

| # | question | answer |
|---|---|---|
| Q1 | CPQ need-by source | **Option A**: an optional Need-by input at CPQ checkout, PLUS a computed **ready date**: painted (P codes) 4 weeks, plated (EP / MEP) 6 weeks; the **Rush fee** at checkout shortens them to 2 and 4. |
| — | Production notes on CPQ | **Option A**: the same field Order Entry has. |
| Q12 / E4 | delete the retired generator | **Yes.** (Stuart's caution about Uniquity pillows: checked — the deleted block held nothing pillow-related; tab 7 has no pillow code at all. `Shared/pillowCodes.js` is untouched.) |
| E1+E2 | three commits, CPQ first | **Go.** |
| E6.1 | one-owner splice fix | **Go.** |
| E6.2 | TRACK list for Eric | **Not needed** — "no live orders like this right now, only test data; we just watch going forward." |
| Q4 / E8 | portal mirror | **Option A**: hand-off with a field list (§5 below). |
| Q3 / E3 | class map | **Wait for Eric.** |
| Q2 | estimate → SO transform | Still unverified live; first real CRM Approve is a watched run (RTG Transmit Log: a row labelled "Sales Order ⇐ estimate"). |
| — | process | Stuart answers E's questions **in E's session**; commits small and shippable — the team tests each build from 2026-09-04; new bugs come via the integration session (App Imp). |

## 1. What shipped (all on `main`, Vercel auto-deployed; lint 0 errors, CI build compiled)

| commit | what | proof |
|---|---|---|
| `961de69` | **E4** — retired tab-7 generator deleted: the `!OE_SAVE_AUTOFIRE_RETIRED` block, its flag, `woWriteBacks` / `tbfMade`, six imports only it used. Hand-off log line kept. | `git diff -w` = removals + the comment that describes what remains |
| `c73263e` | **E1+E2 CPQ door** — new `Shared/salesOrderHeader.js`; CPQ checkout gains Need-by + Production notes + the live 🗓 ready date + the "need-by before ready date without Rush" confirm; finalize stamps the recipe + `finishOutsourced` per line and writes the SO from `soHeaderOf`; reopen restores the two fields | build compiled; marker `No ready-date promise` in `main.*.js` |
| `eb5cb6b` | **E1+E2 Order Entry door** — tab 7's SO doc spreads `soHeaderOf({door:'QUICKSHIP'})`; local outsourced test → shared `isFinishOutsourced`; rush fee on the order shortens the ready date; the Quick Ship QUOTE job carries the same header fields; invoice modal reads `needBy` with `needByDate` fallback | build compiled |
| `efb4fd9` | **E1+E2 CRM approve** — `approveToSalesOrder` writes the SO from `soHeaderOf({door:'CRM'})` (recipe from the job, no PENDING-RECIPE placeholder, no +14-day date) | build compiled |
| `da9bfac` | **E6.1** — one owner per traverse component: configurator lines stamp `trvOfKit`; the explosion skips codes the cart already carries for that kit | lint |
| `dc4f84b` | **E9** — guide sections 8, 7, 4.6 | — |

**Not yet done live (needs Stuart pinned in):** the §6 acceptance runs in `BRIEF_E_SALES_SIDE.md`.
The code is verified by lint + CI build + reading; nothing here has been exercised against
production data yet. First runs to do, in order: (1) a CPQ custom order saved as SO — check the
`hq_sales_orders` doc carries the header (needBy '' or the typed date, readyDate, recipe /
recipeSource, shipTo[]), RTG shows the date or a dash, NetSuite payload identical to before;
(2) an Order Entry order with a `/EP3` to-be-finished line — `recipes:['EP3']`,
`finishOutsourced:true` on the line; (3) a tab-7 traverse order through the components modal —
tab 12 / the outbox payload shows ONE 58034 line.

## 2. The header, as written now (every door — `Shared/salesOrderHeader.soHeaderOf`)

`customer, customerId, customerPo, sidemark, jobName, memo, needBy ('' when none — NEVER
invented), readyDate, leadWeeks, leadBasis ('PAINT'|'PLATED'|'STAIN'|null), rushApplied, shipTo[],
shippingMethod, shippingAddressId, customShippingAddress, shippingAmount, productionNotes,
internalMemo, recipe (CODE or ''), recipeLabel, recipeSource ('finishes'|'finishLabel'|
'configKey'|'lineCode'|'configValue'|'mixed'|'none'), recipes[], source ('CPQ'|'QUICKSHIP'|'CRM'),
hqJobId, appCreated, createdBy` — plus **aliases for one release**: `reqDate` and `needByDate`,
written EQUAL to `needBy`.

On the JOB (CPQ finalize): `needBy, productionNotes, readyDate, leadWeeks, leadBasis,
rushApplied, recipe, recipeLabel, recipeSource, recipes`; `cpqData.breakdown[]` lines now carry
`finishCode / finishLabel` (TAGS-engine lines; absent = mill) and `finishOutsourced` on every
line with a finishCode; same on `cartItems[].pricingBreakdown[]`. Quick Ship QUOTE jobs carry
`orderSidemark, poNumber, internalMemo, needBy, productionNotes, shipping*`.

**Lead times** live in ONE table, `LEAD_WEEKS` in `salesOrderHeader.js`: **PAINT 4/2, PLATED 6/4,
STAIN 4/2** (the third class was added 2026-09-03 in `6e0bfdd` — Stuart: *"for wood 4 weeks is lead
time"* — after the live Fabricut orders surfaced S-codes; §10). `leadBasis` is therefore
`'PAINT'|'PLATED'|'STAIN'|null`, ordered longest-promise-first so a mixed order is only as quick as
its slowest finish. An order with no applied finish (mill, or a small-parts colour like /BS /N90
/CP) still makes **no promise** (`leadBasis: null`, `readyDate: ''`). Ask before adding a fourth
class, do not derive one — and note `isWoodStainCode` lives in `Shared/finishRouting` (A's file,
the authority on what a code IS); this table only says how long it takes. A rush fee is recognised by the keyword test tab 7 always
used (RUSH / EXPEDITE in type, name or `customData.feeType`) — `isRushFeeItem`. S1 candidate: a
feeType tag on the item.

## 3. The alias window — who switches, then the aliases stop

| reader | today | switch to | owner | status |
|---|---|---|---|---|
| RTG `autoSplitSalesOrder`, board `needByOf`, fin-doc `reqDate` at split | `so.reqDate`, `so.needBy \|\| so.reqDate` | `so.needBy` first; `so.recipe` first (fallback scan for pre-`c73263e` docs, stamping `recipeSource`) | **B** (`-d6`) | spec sent 2026-09-03; B confirmed it is B4 |
| WMS Quick Ship order table (`PickPackApp` ~:3719) | `so.needByDate` | `so.needBy \|\| so.needByDate` inside D7 (`Shared/pickLines.js`, the one reader) | **D** (`-5a`) | key list sent; D notes the pick-card "need by" chip reads the **fin doc's** `reqDate`, which B sources from `needBy` at split |
| Order Entry Needs (`StockViewTab` ~:2157, :2199, :2337, :2516) | `so.needByDate` | `so.needBy \|\| so.needByDate` | **A** (`-11`) | spec sent |
| portal `portalMyOrders` (`functions/index.js:1155`) | `so.reqDate \|\| so.createdDate` | `so.needBy \|\| so.readyDate \|\| so.createdDate` (the portal decides which the customer should see — the promise is `readyDate`) | portal session | in §5 |
| documents (`QuickShipInvoiceModal`) | — | done (`needBy \|\| needByDate`) | E | shipped |

When all four have switched, remove the two alias lines in `soHeaderOf` (one edit) and note it here.

## 4. State of E1–E9

- **E1 / E2** shipped on all three doors (§1). E5 (Vision, proven unchanged) — `VisionHardware.js`
  untouched this session (`git log` shows no E commit on it); the live Vision → CPQ → SO run is
  still to do with Stuart.
- **E3** waits on Eric: class internal id per brand for SO + estimate (CE = 2 Hardware; M2C /
  Uniquity / Leyla = ?) and custom form ids per brand (CE 177 / 299; do the others use the
  default form?). Then: `buildNsSalesHeader` in `nsTransmit.js`, the map in `brandNetsuite.js`
  beside `BRAND_NETSUITE_MAP` (tell A and D when it grows), Quick Ship's inline header +
  `shipMethodRef` go, a brand with no entry refuses to queue with a named error.
- **E4** shipped. **E6.1** shipped (tab 7). CPQ's path: prove on tab 12 that a traverse flow's
  `extraItems` does not also list the splice (F will send the engine's splice source as a spec).
  **E6.2** dropped by Stuart.
- **E7** — CPQ and Order Entry reopen restore the header (CPQ: `reopenQuote.js` session +
  the mount; Order Entry: `quickShipExtras.soExtras` already carried `needBy` / `prodNotes`).
  Vision untouched.
- **E8** — hand-off, §5.
- **E9** — guide sections 8, 7, 4.6 done (`dc4f84b`). The CRM pipeline text lives in the
  "Save = send" path of section 8 (Approve builds the SO from the same header).

## 5. Portal mirror — the field list (E8, hand-off to the portal session)

The portal fills a job the same finalize consumes; until swept, portal-created jobs finalize
with `needBy: ''` (honest, not broken). To mirror:

1. `portalQuoteRequest` (`functions/index.js` ~:1646, job write ~:1763), `portalVisionDraft`
   (~:1882), `portalStockQuoteRequest` (~:2141): if the portal collects a customer date and
   notes, accept `needBy` (ISO `yyyy-mm-dd`, else '') and `productionNotes` (≤ 2000 chars) in
   `request.data` and stamp them on the job top-level under those names. Staff pricing in CPQ
   then carries them through (`reopenQuote` restores both).
2. `portalMyOrders` (~:1155): `date: so.reqDate || so.createdDate` → decide which date the
   customer sees — `so.readyDate` is the promise, `so.needBy` their ask; `reqDate` stops being
   written after the alias window.
3. The portal's own checkout (`portal/src/Checkout.jsx`) has no date field today; adding one
   is the portal session's call. The ready-date rule (`LEAD_WEEKS`) is in `Shared/salesOrderHeader.js`
   — `portalRequestLines` ESM⇄CJS pair pattern applies if the portal wants to show it.

Functions need a Cloud Shell deploy (`firebase deploy --only functions --project ce-m2c-design-collab`).

## 6. Named, not fixed (rule 2)

- `functions/index.js:1155` reads `so.reqDate` (portal) — §5.
- `StockViewTab` writes `reqDate: today + 14 days` on its own WO / PO docs (`:576, :612, :717,
  :742, :1288, :1686, :1824, :2516`) — A's file, A's model (`parkWorkOrder`). Not the SO header.
- `RTGDispatchTab.js:1963` and `:2401` also invent `+7` / `+14` day dates (a make-up WO and the
  Brimar test seed) — B's file.
- `PickPackApp` derives `defSidemark` from cart lines / `job.note` (`:745`) — could read
  `so.sidemark` now; D's file.
- The ExternalCoopTab quote DOCUMENT still resolves ship-to from the job at print time (its own
  `fmtAddr`) rather than `so.shipTo` — same words, two formatters; fold into
  `salesOrderHeader.shipToLinesOf` when the CRM documents are next touched (E's file, not
  this pass).
- `resolveJobRecipe` source 2 (`finishLabel`) takes the code as the text before the first
  " - " — matches `finishLabelOf`'s format; if that format ever changes, this reads the label.
- The old-engine (non-TAGS) breakdown lines carry no per-line `finishCode`, so they get no
  `finishOutsourced`; the header `recipe` covers them. B reads the header first.
- Sinaya's custom-fee card (Flat Iron flow, old engine): Stuart says ignore — being rebuilt.

## 7. Verify the deploy

`curl -s https://www.4cosworkcenter.com/version.json` stamp after the commit time; then
`curl -sL https://www.4cosworkcenter.com/ | grep -o 'static/js/main\.[a-z0-9]*\.js'`, download,
`LC_ALL=C grep -c 'No ready-date promise'` (CPQ + salesOrderHeader are in main). Tab 7 is a
lazy chunk: sweep `/asset-manifest.json` for `not consumed twice`. Save-is-send refuses from a
stale bundle — reload and re-PIN after the deploy.

## 8. Guide sections touched (S2)

`UserGuideTab.js`: **8 · CPQ Configurator** → paths "8 · Checkout", "9 · Save = send",
"Reopening"; **7 · Quick Ship / Order Entry** → "Create the record", "To-be-finished → floor"
(rewritten to the review-gate truth); **4.6** → "💲 Fees". Repo docs: this file,
`SYSTEM_FLOW_AUDIT.md` §6 (state note), the patch specs appended to Briefs A, B, D §7.

---

## 10. Session 2 — 2026-09-03 evening (documents, the stain class, the live-run pre-flight)

### Shipped

| commit | what | proof |
|---|---|---|
| `9802142` | **Customer documents print descriptions and part numbers.** Two defects: the ITEM cell was hardcoded blank (`item: b.isHeader ? '▶' : ''`) so NO document had ever printed an item number, and descriptions were whatever the line stored at save — so pre-08-31 orders printed the designer's 1.6 node labels for ever. `customerDocLines` now takes an optional print-time resolver `{findPart, custKeys}` and re-resolves the description from the Master Library (keeping the row's indent prefix) and the clientSku from the customer's pricing row. The CRM feeds it a slim index built off the `Approved_Designs` snapshot it already subscribes to — no extra Firestore traffic. | Verified live on SO60239 before/after: `- HBR1-1INPOLE / - H21INPOLELEFT` with blank ITEM → `HBR1-1INPOLE · 1" Round Rod 16ga (Cut 46")`, `H1-FRPF · FRENCH RETURN`. Deploy confirmed by grepping the shipped chunk for the emitted expression, NOT the version stamp — see the trap below. |
| `6e0bfdd` | **STAIN lead class** (Stuart: *"for wood 4 weeks is lead time"*). `LEAD_WEEKS.STAIN = {std:4, rush:2}`, `leadBasisOf` returns `'STAIN'` after PLATED and PAINT (a mixed order is only as quick as its slowest finish), `leadText` says "stained finish". Keyed off `isWoodStainCode`, which `finishRouting` deliberately keeps OUT of `isAppliedFinishCode`, so a lead class cannot move a part between floors. Also fixed two extensionless relative imports (`./finishRouting`, `./clientPricing`) that had broken the node suites. | `run-traverse-tests`: 31 passed, 0 failed. Six-case behaviour table verified in node. |

### The finish codes, read from the live CPQ list (answers A's and D's pre-flight questions)

| Fabricut name | code | class | routes |
|---|---|---|---|
| Aged Champagne | `P14` | painted | in-house finishing |
| Warm Bronze | `P16` | painted | in-house finishing |
| Aged Brass | `EP5` | plated | **outsourced** — and by BOTH routes independently (in the plated list AND matching the `EP*` suffix grammar), so it is not one library edit from flipping |
| Natural Oak | `S04` | wood stain | in-house |
| Pure Oak | `S11` | wood stain | in-house |

Every finish resolves to a real CODE, so A's "name lands as the code" failure mode and D's
"toBeFinished with no code → confidently wrong FROM FINISHING label" both **do not fire** on these
orders. Recorded as ruled out, not merely unobserved.

### Named, not fixed — carry these forward

1. **⚠ OBSERVED, LIVE: every wood pole line routes to the SHOP, straight ones included.**
   Verified by me in the Master Library on 2026-09-03, after A opened the cards and D relayed it —
   not taken on trust: **`H1-138WHTOAK-6` (1-3/8" × 72" White Oak Rod) carries PART HANDLING =
   `Custom`.** So does the family (`H1-138WHTOAK` by-foot, `-4`, `-8`, `-10`). There is **no
   stained wood pole item at all** — no `/S04`, no `/S11` variant — so a stained wood line resolves
   to the RAW ROD, and `classifyLine` rule 1 returns that item's `Custom` immediately.
   **Consequence:** Stuart's second-pass rule *"wood + straight → finishing"* **does not hold
   today**. Tonight's H1-138 #1 (NATURAL OAK 72" ×2) and #2 (PURE OAK 72" ×2) will send their
   POLES to the shop floor, not to the finishing Setup Queue. If that is seen during the run it is
   THIS finding, not a new bug.
   **Why it is not simply a mis-tag:** the rod is a mill code with no finish suffix, and the
   settled rule (`handlingForErp`) makes a suffix-less mill code Custom — correctly, it is made to
   order. So the wood rule cannot be satisfied by item-level tagging at all: the item is genuinely
   Custom, and "straight → finishing" is a fact about the LINE (is it cut? is it mitered?), not
   about the item. A is putting that to Stuart with options — keying the escalation to the CUT
   (`fabMethod` / `qtyMiters`) rather than a generic partHandling stamp — and implementing nothing
   tonight. Correct call.
   **What the floors/WMS show** (D): the small-parts lines still reach the finishing pick on the
   fin doc; the pole arrives as a custom sibling from the shop; the pack gate holds until
   `customFabStatus` is Complete, so the order can still pack. The wrongness is upstream — a
   straight oak pole sitting in custom fab instead of the stain line — and **nothing on any screen
   says it is in the wrong place.**
   *(Superseded: an earlier draft of this handoff said all four orders were safe, on the shared
   assumption that wood pole items were tagged Small Parts. Both D and I assumed the data rather
   than reading it. The corrected statement is above.)*

1b. **Wood + miter — still hypothetical, and now differently framed.** The split I described with
   D (fee escalates via rule 0, pole classifies by its item tag) cannot occur while wood rods are
   tagged `Custom`, because pole and fee then BOTH go to the shop. It would become live only if
   the wood rods were ever retagged `Small Parts`. Keep it recorded, but read item 1 first.

2. **Order Entry pack path — fee lines reach the packer.** `packLinesOf` reads `job.lines` with
   no fee filter, so a fee line (e.g. `FEE-H1-MRPF`) is presented to the packer as a physical item
   and blocks pack completion. **D7 owns it.** **UNEXERCISED** on 2026-09-03 — never run, as
   distinct from run and passed — because H1-75 #1 (the only order carrying that fee) went through
   the CPQ door. Its stated proof: a node test in D7's `Shared/pickLines.js` feeding a QUICKSHIP
   order carrying `FEE-H1-MRPF` and asserting it reaches neither the pick list nor the pack list.
   D deliberately declined a fifth live order to demonstrate it — raising a real NetSuite order
   that moves real stock to prove something a code read already establishes is the wrong trade.
3. **Two vocabularies for one class.** S-codes are now known in two places: `LEAD_WEEKS.STAIN` +
   `leadBasisOf` here (how long it takes — mine) and `isWoodStainCode` in `Shared/finishRouting`
   (what an S-code IS — A's, and the authority). Anyone adding a routing clause should look at
   both so they cannot drift.
4. **`B5` never landed** — `customFabStatus 'Sent to Plating'` and `gatesOf` are not on main, so a
   plated line's pack gate still reads the old contract. Report as "B not landed", not as a fault.

### Two traps worth re-reading before the next deploy

- **The version stamp lies when several sessions push.** After `9802142` the stamp advanced past my
  commit time while the bundle still served the OLD code — another session's build had finished in
  between. Verify a deploy by grepping the shipped chunk for the *emitted expression*
  (`isHeader?"\u25b6":e.legacyErpId||""`), not by the stamp, and not by a comment or an identifier
  (both are minified away). My change added no new string literal, which is why the usual
  marker-grep was useless.
- **Extensionless relative imports break the node suites.** CRA resolves `'./clientPricing'`; node
  does not. Every relative import in a node-reachable `Shared/` module needs the explicit `.js`.

### Still not done

The four-order live run (`0903/`) had not been entered when this was written: **zero orders, zero
quotes, zero work orders created.** Setup reached — Fabricut (CUST-4720), price level *Fabricut
Cost*, sidemark ROOM LEFT, flow H1-138, 18 steps loaded — and stopped there. Door plan: H1-138 #1
and H1-75 #1 through **CPQ**; H1-138 #2 and H1-75 #2 through **Order Entry**. Stuart's rulings that
bind the run: straight cuts need no Vision sheet; wood is Small Parts on the item and miters
escalate per line (`ea04009`); wood lead time is 4 weeks. **But see §10 item 1 — the wood rods are
tagged `Custom`, so the wood poles WILL go to the shop on this run regardless of that ruling.**

