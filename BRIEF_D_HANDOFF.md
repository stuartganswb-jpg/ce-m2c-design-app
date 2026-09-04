# Brief D handoff — the WMS, 2026-09-03

*Written at the end of the session. Everything below is either LIVE (pushed and verified in the
served bundle) or NAMED AS NOT DONE. Nothing is described as working that has not been verified,
and nothing that shipped unexercised is described as tested.*

---

## 0. The one-line state

Every loop the warehouse closes now closes, **except** that almost none of it has been exercised by
a real operator. Ten commits shipped; two Cloud Shell functions deployed; **the live floor test is
the outstanding risk, not the code.**

---

## 1. What shipped, and what proves it

| # | commit | what | proof |
|---|---|---|---|
| 1 | `039dcdc` | pick/pack claim gate — one order, one pair of hands | live, marker in `main.*.js` |
| 2 | `9c56aa4` | plating receiving station — scan → cart → bin | live |
| 3 | `dd20cd1` | the plated build-back rides the convert RESTlet (component bin) | live; **Stuart confirmed a build posted** |
| 4 | `1f850dd` | item labels at the plating dock | live |
| 5 | `d028f89` | SO Pack rename · read-only open · Close order | live |
| 6 | `8962bf6` | the four numbers per line, collapse + green | live |
| 7 | `976fd3e` | committed order bins (+ 34 offline assertions) | live |
| 8 | `eb02f2b` | the arrival alert (+12 more, 46 total) | live |
| 9 | `44ab49c` | SO Pack shows both doors | live |
| 10 | `0d74b53` | **the WMS user guide — there was none** (S2) | live |
| 11 | `0cc185e` | `finishAsAvailable`, named for the exception | live |
| 12 | `36d3f5f` | `Shared/pickLines` — ONE line reader (+26 assertions) | live |
| 13 | `032f38d` | **the pack gate opens** — D1 | live |
| 14 | `8627b0c` | the plating receipt rides the outbox — D5 (part) | live |
| 15 | `b6b616c` | **D2 + D3** — `functions/index.js` | pushed **and deployed** (Cloud Shell, "Deploy complete") |

Offline suites: `node scripts/committedBins.test.mjs` (46) · `node scripts/pickLines.test.mjs` (26).

---

## 2. The brief's items, honestly

| item | state |
|---|---|
| **D1** the receipt closes the order | **DONE, unexercised.** Receipt → `propagateFloorState 'Plating Received'`; build-back → `mirrorCustomStatusToSibling(…, 'Complete')` + `'Plated'`. The pack gate is B's `customPartsReady`, one test. |
| **D2** the app builds every NS WO it opens | **DEPLOYED, never posted live.** The `orderType === 'stock'` guard is gone; a sales-typed doc with `nsWoId` builds at pack. FLOW1 builds the base assembly. **Eric never answered; Stuart chose a watched test order instead** — see §4. |
| **D3** the root build, automated | **DEPLOYED, OFF.** `onMillComplete` reads C2's stamps. Gated by `system/wms_config.rootBuildAuto` (brand → true), read at fire time. **No brand is on.** Turn CE on after 3 clean manual ⛏ posts (Stuart's threshold). It writes `nsRootBuildSkipped` saying why when it skips. |
| **D4** the fulfilment queue | **PARKED BY STUART as its own project** — a whole Fulfilment tab tomorrow (weight, dims, UPS rate, ship, tracking back). "dont worry on existing fulfilments we are working for now and forward", so the already-fulfilled pre-check is NOT wanted. Eric confirmed the multi-location orders carry ONE location per line, so that fix is `location` on the payload when the session runs. Memory: `fulfilment-screen-project`. |
| **D5** the direct posts ride the outbox | **HALF.** Receipt moved (dedupe key, writeBack). Pull stays immediate by Stuart's instruction — Sandra needs NetSuite's answer at the bin. Scrap stays immediate and now says why. **BUILD-BACK'S OWN POST IS STILL DIRECT** — a real inventory movement with no double-post guard. It needs the convert RESTlet reachable through the outbox. **The biggest thing left in my territory.** |
| **D6** every gate verified end to end | **NOT DONE — needs live runs.** Rod cut, convert (note A's `clearConvertGate` now narrows self-release to sales, so a STOCK WO waits for RTG's effect — two rows, not one), demand-delete, plating build-back. Also prove both ORIGINS now that A's grid raises cuts and converts as well as the Snapshot. |
| **D7** one pick-line reader | **DONE.** `Shared/pickLines`. Closed the Order Entry fee defect *and* found two more the local copy had: an explicit `FEE-` code still needed its NAME to agree, and the pattern required singular `RETURN` so "Mitered Returns" passed both. Price is deliberately never tested — a £0 plated collar is a real part. |
| **D8** the WMS guide | **DONE.** New section; B, C and E all confirmed they were out of the file. |

---

## 3. Beyond the brief — Stuart's WMS spec, 2026-09-03

All live. Rename to **SO Pack** (label only — the KEY is permission identity). Opening a card is
**looking, not taking** (my claim gate had made opening *claim*; that was my defect). Four numbers
per line. **Committed bins**, app-only, never pushed — scan any empty bin for the first part, every
later part is told to follow it, a bin held by another open order is refused by name, release is per
**quantity** because partial is the normal case. **The arrival alert** at both handlers he named
(Plating for plated, Packaging Prep for painted/stained), oldest need first, and "no" is recorded
with what was left outstanding. **Both doors** on SO Pack. **`finishAsAvailable`** — the flag names
the *exception*, so its absence means the default on every order written before today.

---

## 4. What must happen next, in order

1. **THE LIVE PASS. Nothing above has been used by an operator.** The claim gate, the four numbers,
   committed bins, the arrival alert, the pack gate: all unexercised. This is the risk.
2. **The watched FLOW1 test order** (D2). Enter through **Order Entry**, ONE to-be-finished line
   whose raw item exists in NetSuite but whose finished variant does not — a mill code plus an
   applied paint finish. The review says which flow it planned; you want the one anchoring on the
   BASE item. Take it to pack and watch 11.1 for an entry labelled `… · SALES`. If it fails,
   nothing moved and the error IS Eric's answer.
3. **Turn D3 on for CE** after 3 clean manual ⛏ posts: Firestore console → `system/wms_config` →
   `rootBuildAuto` → `{ ce: true }`. **There is no UI for this** — deliberate, it is a go-live gate.
4. **Build-back onto the outbox** (D5's remainder).
5. **Move the SO Pack date read to `needBy`** — E is holding the `reqDate`/`needByDate` aliases open
   *for me* and cannot delete them until I say so. Tell E when done.

---

## 5. Waiting on other sessions

| from | what | state |
|---|---|---|
| **A** | `clearReceiptGate` export + `parkWorkOrder` setting `awaitingReceipt` | agreed 3 ways; **I build my clearing half only when A exports it** — a clearer for a gate nobody sets is dead code |
| **A** | `PO_STATUS` extended + `isOpenPo` | then I map my plating PO's `'Sent to Plater'` onto it; then B adds the Open POs button. **Until then a PO vanishes from the board the moment it is queued** |
| **B** | the release half of `finishAsAvailable`; the `awaitingReceipt` gate + release; Open POs button | approved by Stuart; B builds after its board work |
| **B** | Order Entry rows on the RTG board | **NOT approved** — Stuart approved only the Open POs button. B is asking him directly rather than inferring from the "every order via RTG" rule |
| **E** | `nsQty` on `hq_sales_orders.lines[]` | the pushed integer, so my card compares like with like — a per-foot pole reads 1 here and 12 in NetSuite |
| **F** | `takesNoFinish(part, line)` in `Shared/finishLabel` | then I wire the OE line table + pack labels to print "no finish" instead of a code |

---

## 6. Named and NOT fixed

- **A PO is invisible on the RTG board for its whole useful life** (board queries `status == 'Approved'`; the chain runs Draft → Approved → Queued → Pushed → Sent). My plating PO is worse — `'Sent to Plater'` is never `'Approved'`, so it never appears at all. Mine to change once A extends the vocabulary.
- **The build-back's NetSuite post has no double-post guard.** §2 D5.
- **Wood poles route to the SHOP, straight ones included** — the rods are correctly tagged Custom and "straight" is a fact about the LINE. Stuart accepted it for the four live orders. The fix is cut-keyed (`fabMethod` / `qtyMiters`), A's to shape, and **must not be "fixed" by retagging `H1-138WHTOAK-*`** — that would break the miter half.
- **Two 2026-08-14 Order Entry orders were committing stock for three weeks** (`QS-1786738589252`, 23 pcs traverse; `QS-1786734991717`, empty). Stuart is closing them in NetSuite; the app side closes from SO Pack. The *cause* — an Order Entry sale never reaching the board — is B's fix.
- **Item-tag projection errors found by E** (`CE-FEE-6294/4594/4642/4539`, `CE-INV-60175` tagged 3.625" when the E suffix means 4-5/8"). If one reaches a pick it reads as a SHORTAGE rather than a data fault — exactly what `codeHealth` separates and what A's Backorder window must keep apart.
- **A silent CPQ ordering bug** (choosing ends before the rod, then the rod deletes both end treatments with no prompt). Not mine, and nothing downstream would know an order shipped without its returns.

---

## 7. Things worth not relearning

- **PickPack strings compile into `main.*.js`, NOT a lazy chunk.** This brief's §0 says otherwise and is stale; a chunk-only sweep false-negatived for 20 minutes. Sweep every `static/js/*.js` in `asset-manifest.json`. And with six sessions pushing, `version.json` advancing proves *someone's* build finished, never yours. Memory: `pickpack-in-main-bundle`.
- **Verify by marker in the SERVED bundle, never by the version stamp.**
- **The plain REST API cannot set a build's COMPONENT bin.** That is why the convert RESTlet exists; the plated build-back now rides it. The file said so at the top the whole time and I put the bin on the header first — one wasted deploy.
- **A committed bin is app-only and must never be pushed.** NetSuite keeps showing the shelf bin, marked committed to the order.
- **Ask, don't derive — including about DATA.** I built a whole finding on wood rods "probably" being tagged Small Parts. They are Custom. Nobody could tell from code; A opened the card. When a finding turns on what an item's card says, someone has to open the card.
