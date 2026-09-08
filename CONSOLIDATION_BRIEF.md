# Consolidation brief — six sessions back to one

*Written 2026-09-08 by the Brief D (WMS) session, at Stuart's request, as the orientation document
for the ONE session that replaces A–F. Read this first, then the individual handoffs it points at.
Everything here is either verified or explicitly marked as not.*

---

## 0. How to use this, and the one rule that matters most

Six specialist sessions (A–F) ran in parallel from 2026-09-02 to 2026-09-08, cut from
`SYSTEM_FLOW_AUDIT.md`. They are being collapsed back into one session that works **one issue at a
time**. This document is the map; the detail lives in each session's own handoff, which is the
authority for its area:

| was | area | handoff | brief |
|---|---|---|---|
| A | Stock View · Sales Snapshot · Master Library — WO/PO creation | `BRIEF_A_HANDOFF.md` (590 lines, the fullest) | `BRIEF_A_WO_PO_CREATION.md` |
| B | RTG Dispatch · Finishing Floor — release, gates | `BRIEF_B_HANDOFF.md` | `BRIEF_B_RTG_FINISHING.md` |
| C | Shop Floor — plating hand-off, milling record | `BRIEF_C_HANDOFF.md` | `BRIEF_C_SHOP_FLOOR.md` |
| D | WMS — pick/pack, plating, the NetSuite write path | `BRIEF_D_HANDOFF.md` | `BRIEF_D_WMS.md` |
| E | CPQ · Order Entry · CRM — the sales order | `BRIEF_E_HANDOFF.md` | `BRIEF_E_SALES_SIDE.md` |
| F | tag engine · kits · spec sheets · 1.6 authoring | `BRIEF_16_AUTHORING_ALIGNMENT_HANDOFF.md` | `BRIEF_F_KITS_SPEC_SHEETS.md` |

**THE ONE RULE THAT SURVIVED EVERY SESSION.** The working agreement in `CLAUDE.md` — plan and wait,
requested scope only, no temporary fixes, trace downstream — was not decoration. Every session that
followed it shipped work that held; the three genuine near-misses this week all came from deriving
something instead of reading it (§6).

---

## 1. What actually changed, in one page

The system had **ten writers of work orders, six release paths, and three copies of most rules**.
The week's work was consolidation: one writer, one release engine, one closer, one gate list, one
line reader, one stock reader, one NetSuite write path.

**The spine, as it now stands.** Any door (CPQ, Order Entry, CRM approve, Vision) writes ONE sales
order header. RTG splits it, releases it automatically, and is the master record. The floors report
back to RTG. The warehouse picks, packs and puts away. Every NetSuite write goes through the outbox.

| what | where it landed |
|---|---|
| ONE sales-order header, every door | `Shared/salesOrderHeader.js` (E) |
| ONE work-order writer | `Shared/workOrderCreate.parkWorkOrder` (A) — nine of ten writers converted |
| ONE release engine, no push buttons | `Shared/floorRelease.js` + RTG B3 `ff69f79` (B) |
| ONE gate list, and gates that declare what would lift them | `Shared/orderStatus.GATES` (B) — `7923d03` |
| ONE closer, which now also kills queued NetSuite writes | `Shared/orderLifecycle.js` — `1013530` (B) |
| ONE line reader for both dialects | `Shared/pickLines.js` (D) |
| ONE availability reader | `Shared/oeReviewPlan.fetchAvailabilityUnits` (A) |
| ONE PO vocabulary | `Shared/purchaseOrders.js` (A) |
| ONE plated-demand writer | `Shared/platingDemand.js` (A) |
| the WMS closes its loops | committed bins, arrival alert, plating receipt → pack gate (D) |

**Two functions deployed** (they do NOT auto-deploy): `onStockBuildDone` now builds sales-typed
anchors at pack, and a new `onMillComplete` posts the milled root's build. Deploy verified by the
CLI output creating a function that did not previously exist.

---

## 2. Where we stand — the honest status

### Live and verified in the served bundle
Everything in §1. Each session verified its own markers by sweeping every asset in
`asset-manifest.json`; the method and its four traps are §6.

### Live but NEVER EXERCISED BY AN OPERATOR — this is the real risk
Nothing below has been used on the floor by Sandra or Andrea, or on a real order end to end:

- the pick/pack claim gate (one order, one pair of hands);
- SO Pack's four numbers, the collapse/green behaviour, committed bins, the arrival alert;
- the plating receipt → pack gate loop (D1) — **built to close a gate C1 correctly shut**;
- the sales-typed anchor build at pack (D2) — **this payload has never been posted live**;
- RTG's one release engine (B3) on a real order;
- A's converted writers.

**The four-order Fabricut live run did not complete.** Order 1 was saved as a QUOTE only; order 3
was abandoned (no 4-5/8" return exists in the data); orders 2 and 4 were not confirmed entered. Do
not read the week's work as proven.

### Deployed but deliberately OFF
`onMillComplete` is gated per brand on `system/wms_config.rootBuildAuto`. **No brand is on.** Turn
CE on after three clean manual ⛏ Mill Build posts (Stuart's threshold). It stamps
`nsRootBuildSkipped` saying why when it skips. RTG's ⛏ button stays until then, per brand.

---

## 3. The queue — what to do, in order

Stuart's instruction: **one issue at a time.** The sequence below respects the dependencies that
already exist; items in the same numbered step can be done in any order.

1. **THE LIVE PASS.** Before any new code. Take one real order through every screen with Stuart
   pinned in. This is the outstanding risk and nothing else changes that.
2. **The PO chain**, in this order because each depends on the last: A extends `PO_STATUS` +
   exports `isOpenPo` → D maps the plating PO's `'Sent to Plater'` onto it → B's RTG panel adopts
   the predicate and adds an **Open POs** button beside Open WOs (Stuart asked for the button).
   *Until this lands, a purchase order is invisible on the RTG board for its whole useful life, and
   the plating PO never appears at all.*
3. **The `awaitingReceipt` gate**, three-part and fully specified (A §3j): A sets it and exports
   `clearReceiptGate({ poId, itemId, receivedQty, operatorName })` — clearing only when received
   **covers** `qtyNeeded`, because a PO for 12 arriving as 5 does not make the order runnable → D
   calls it at receipt → B adds the GATES entry and releases.
4. **The `finishAsAvailable` release half** (B). D's SO Pack already sets/clears the flag with
   `finishAsAvailableAt/By/Reason`; RTG's card does too (`e72e7ce`). The release reads it.
5. **B5 part 2, the stock-first split** (Stuart's EP rule): at push, AFTER `nsInternalId` exists,
   ask `fetchAvailabilityUnits`; in stock → straight to WMS pick; short → A's Backorder window.
   Three-way answer, never two — see §5.
6. **A's Backorder window + Stock Build Needs**, sharing ONE covering function.
7. **The Fulfilment tab** — Stuart's own next project: weight, dimensions, UPS rate, ship, tracking
   back to NetSuite. The nine stuck fulfilment entries belong to it. "Forward only, no back-fixing."
8. **The long tail**: A's writer 7 and A6 sweep; B1 remaining call sites, B4, B6; C3–C7; E3 (waits
   on Eric); F's traverse template and the H1-2TRV data pass.

---

## 4. Waiting on people, not on code

| who | what | blocks |
|---|---|---|
| **Stuart** | the live pass (§3.1); turning CE's root-build flag on after 3 clean ⛏ posts; closing the two stale 14-Aug orders in NetSuite | most verification |
| **Eric** | class internal id + custom form id per brand (M2C, Uniquity, Leyla) | E3 — a non-CE brand's SO push |
| **Eric** | whether a build of the base assembly against the anchor closes a FLOW1 order correctly | D2 was shipped anyway, with a watched test order substituted for the answer at Stuart's direction |
| **the designer** | H1-2TRV slot/tag pass with F's panel | F6 |

---

## 5. Named and NOT fixed — read before touching these

These are known, deliberate, and each would be a wrong "fix" if guessed at.

- **Wood poles route to the SHOP, straight ones included.** The raw rods (`H1-138WHTOAK-*`) are
  correctly tagged Part Handling = **Custom** — a suffix-less mill code IS made to order — and
  "straight vs mitered" is a fact about the **line**, not the item. So no item-level tag can express
  Stuart's "wood + straight → finishing" rule. **Do not fix this by retagging the rods**: it would
  fix straight wood and permanently break the miter escalation. The fix keys on the CUT
  (`fabMethod` / `qtyMiters`). Accepted live for the 2026-09-03 orders.
- **A `codeHealth` shortage is not the same as a data fault.** Four states, and only
  `OUT_OF_STOCK` means "go make some". A Backorder window that collapses them fills with broken
  items nothing can clear. And `codeHealth` **explains** a shortage — it takes no quantity and never
  detects one. Arithmetic decides membership; health only labels it.
- **Two stale Order Entry sales orders from 2026-08-14** (`QS-1786738589252` 23 pcs,
  `QS-1786734991717` empty) are real open NetSuite orders committing stock. They must be closed in
  NetSuite by hand; the app side closes from SO Pack. The *cause* — an Order Entry sale never
  reaching the board — is fixed (`b9fe48c`).
- **Item-tag projection defects** (E, live): no 4-5/8" return exists in the data at all (every
  return fee is tagged 6"/6.5"), and `CE-INV-60175` / `H1-75ILE` is tagged 3.625" when the E suffix
  means 4-5/8" across the catalogue. A customer's `H3553F` is unpickable. **1.6 data + GLB work, not
  a tag flip.**
- **A silent CPQ ordering bug**: choosing the ends before the rod is accepted and priced, then
  picking the rod **deletes both end treatments with no prompt**, and they cannot be re-selected.
  The operator's natural order triggers it. An order entered that way ships without its returns.
- **The plating build-back's NetSuite post still has no double-post guard** — the one remaining
  direct write that moves real inventory. Moving it needs the convert RESTlet reachable through the
  outbox. (Receipt already moved; the pull stays immediate by Stuart's instruction.)
- **The WMS pre-pack confirm** lists an Order Entry custom half (`<woId>-C`) as "still in
  production" forever, because nothing stamps `floorPhase` on it. D's screen, needs a spec.
- **Two pull adjustments in the WMS carry no writeBack**, so nothing links them to an order in
  either direction. Correct today (pure stock movements), but invisible to any future audit that
  reasons outward from an order.

---

## 6. Lessons that cost real time this week — do not relearn them

**Deploy verification has four traps, and each produced a confident wrong answer before it was
caught.** A sweep must satisfy all four:

1. **The marker must be a string the code actually EMITS** — read it from the source, never from a
   description of it. (The D session built a marker from a peer's prose, told two sessions their
   working deploy was stale, and nearly triggered a pointless production rebuild.)
2. **It must not be a SUBSTRING of pre-existing code.** (B matched the existing
   `label:"awaiting NetSuite WO #"` and concluded a stale build.)
3. **Plain ASCII only** — an em-dash or middle dot may be unicode-escaped in the bundle.
4. **The sweep must prove it read the bytes**: re-fetch `asset-manifest.json` immediately before
   sweeping, use `curl -sf`, and report failures and total bytes. Filenames rotate the instant any
   session deploys, and `curl -s` writes the 404 body — which greps exactly like "absent". This
   faked a "production has lost its Spanish translations" result.

Plus the category that defeats all four: **a logic-only commit emits no new string and cannot be
verified this way at all.** The honest answer is a behavioural check, not a better grep.

**`version.json` proves nothing** with several sessions pushing — it advances on everyone's deploy.

**Ask, don't derive — and that includes DATA.** The wood-routing finding was built on rods being
"probably" tagged Small Parts. They are Custom. No amount of code reading could have told anyone;
someone had to open the item card. When a conclusion turns on what a record says, read the record.

**When a conclusion is absurd, suspect the tooling.** "Production has lost Spanish" while Sandra
uses it daily is not a finding, it is a broken sweep.

**In a shared checkout, stage only your own files.** Twice this week an uncommitted file belonging
to another session was one careless `git add -A` from becoming someone else's commit.

---

## 7. Vocabulary a single session must not re-fork

The whole week's value is that these are each in ONE place. Adding a second copy of any of them is
the failure mode the audit was written about.

- gates and their lift patches — `Shared/orderStatus.GATES` / `liftPatchFor` / `isReleasable`
- closing an order — `Shared/orderLifecycle.closeOrderEverywhere` (many callers, one closer)
- what a line IS — `Shared/pickLines.js` (never filter a line on PRICE: a £0 plated collar is a
  real part, because the money sits on the finial it belongs to)
- "can I promise this?" — `fetchAvailabilityUnits` (available, unit-aware). "Which bin?" is a
  different question, answered by the WMS's `fetchLiveBins`. Do not swap them.
- PO status — `Shared/purchaseOrders.PO_STATUS` (extend it rather than writing a private string;
  the WMS's `'Sent to Plater'` is the last hold-out and is queued to join)
- committed bins — `Shared/committedBins.js`, **app-only, never pushed to NetSuite**
- "takes no finish" — `Shared/finishLabel.takesNoFinish` (item wins; a line's flag is a pin fact)
- the NetSuite write path — `Shared/nsOutbox.enqueueNsWrite`, and nothing else

---

## 8. Test suites that exist — run them, they are fast and offline

```
node scripts/orderStatus.test.mjs      # gates, custom-fab states (B)
node scripts/committedBins.test.mjs    # committed bins + the arrival alert, 46 assertions (D)
node scripts/pickLines.test.mjs        # both line dialects + the fee rule, 26 assertions (D)
node scripts/stockRun.test.mjs         # the work-order writer (A)
node scripts/finishLabel.test.mjs      # the no-finish reader (F)
node scripts/slotGroups.test.mjs       # 1.6 authoring (F)
```

They are pure modules with no Firestore, NetSuite or browser — which is the only verification this
stack allows without a live pin-in, and it is why the durable fixes are shaped that way.
