# The WMS — what it is, what was built, and the rules it runs on

*Written 2026-09-09. The authoritative document for the warehouse: every tab, the rules underneath
it, the data model, the seams into the rest of the system, and what is still unproven. Replaces
`BRIEF_D_WMS.md` (the plan) and `BRIEF_D_HANDOFF.md` (one session's slice) as the thing to read
first. Everything is either verified live or explicitly marked as not.*

---

## 1. What the warehouse is for

Four loops end here: the NetSuite work order the app opened, the plated part that went out, the
component gate a convert or a cut clears, and the sales order that ships. **The warehouse decides
nothing about routing** — that is settled upstream and the warehouse is told. What it decides is
**physical**: which bin, how many, and whether the pieces in someone's hands belong to a customer's
order or to the shelf. Getting that last one wrong is the mistake most of this work is shaped to
prevent.

**Fourteen tabs**, in `Shared/pickTabs.PICK_TABS`:

| tab | what it is for |
|---|---|
| PICK QUEUE | parts for an order the floor has released |
| SO PACK | every customer order and whether its parts are all in yet |
| PACKAGING PREP | box an order, or put finished stock on the shelf |
| BIN COUNT · TRANSFER | count a bin; move stock between bins |
| CONVERT | raw → phosphated `/P` stock |
| RECEIVING (PO) | take in a vendor delivery |
| ROD CUTS & RING PACKS | cut an 8 ft rod down; build a ring pack |
| PLATING | send raw out to the plater, and receive it back |
| LABELS | every label anyone needs |
| CHIPS · GALLERY · MESSAGING · APP IMP | sample chips, assets, floor messages, feedback |

⚠ **Tab keys are permission identity.** A new tab is a new row in the permission matrix and an
admin must tick it per role. Renaming a KEY silently revokes the tab for every role that has it;
rename the label instead (`pickTabLabel`). A tab nobody can be granted looks granted — that cost a
day on ROD CUTS once, and LABELS is the newest one needing a tick.

---

## 2. The rules the whole warehouse runs on

**ONE ORDER, ONE PAIR OF HANDS.** Starting a pick, or pressing Start Packing, writes a *claim* on
the order in a transaction, so two simultaneous taps cannot both win. Every other tablet sees the
name and the time and cannot start it. **Opening a card is looking, not taking** — a card opens
read-only even on an order someone else holds; only Start Packing claims it, and Close releases
only a claim that is yours. Ticking a line or completing a pack on someone else's order is refused
and says who has it. Nothing releases on its own: after four hours a claim reads stale in red and
an admin releases it with a reason, recorded.

**A VALIDATOR REFUSES ONLY ON COMPLETE KNOWLEDGE.** A bin the app cannot find is a hard refusal
only when the bin list is known to be complete; otherwise it warns. NetSuite's SuiteQL caps at 1000
rows, and a truncated list once refused real bins.

**IT NEVER GUESSES A NUMBER A PERSON WOULD ACT ON.** A missing cut length prints as "not recorded";
an unresolvable code is a *data problem*, not a shortage; a malformed scan counts as one piece, not
as a pack. Under-counting surfaces as a shortage a human resolves — over-counting ships a customer
short and nobody notices, so every fallback is aimed at the visible side.

**EVERY NETSUITE WRITE GOES THROUGH THE OUTBOX** (`Shared/nsOutbox.enqueueNsWrite` → the worker),
with one deliberate exception: a write whose *answer* the operator needs while standing at the bin.

---

## 3. SO Pack — every customer order, and whether it is whole

Renamed from "Stock", which was a misnomer: every order on it is a customer's. **The label
changed; the key did not**, for the permission reason above.

**Four numbers per line, four different questions:**

| column | what it means | source |
|---|---|---|
| **Ordered** | what the customer asked for | the line |
| **On hand** | *free* stock — on the shelf and promised to nobody | `fetchAvailabilityUnits` — NetSuite's `quantityavailable`, already net of commitments, unit-aware |
| **In production** | being made or bought *for this order* | open WOs + PO `quantity − received`, matched on `soAppId` |
| **Committed** | physically **gathered** for this order | the committed-bin allocation |

*On hand is deliberately not raw on-hand*, or an order would be told it can have pieces another
order already owns. *In production reads `received` per line, not a header status* — a PO for 5 that
returned 4 leaves 1 inbound and a status cannot say that.

A card **stays closed while the order is missing parts and turns green and opens when it is whole**.
That is not decoration: an order missing parts is not work a packer can do, and showing it like a
ready one sends someone to a shelf for a piece still at the plater. A card whose numbers have not
loaded stays neutral rather than pretending; ▸ forces any card open.

**Both doors.** Order Entry orders show their lines. A configurator order carries no line list on
the sales order at all — its parts live on the work orders dispatch split out — so its card shows
**where its pieces are**: each work order, its state, whether it is packed. Packing stays on
Packaging Prep; a second packing surface would be two places doing one job.

Also on the card: the **committed bin** and gathered count; **Finish as available** (below); item
labels per line and for the whole order; and **Close order**, which calls the one shared closer and
says plainly that NetSuite still holds the commitment until the order is closed there too.

---

## 4. Committed bins — where an order's parts wait for each other

Some orders arrive in pieces over days: the small parts are on the shelf, the poles are at the
plater. Rather than leave the early parts loose in stock where the next order takes them, they wait
together in a **committed bin** belonging to that order.

**APP-ONLY, NEVER PUSHED.** NetSuite goes on showing the stock in its shelf bin, marked committed to
the order. The app carries the finer physical truth — *which* bin, for *which* order — because that
is what stops a newer order being handed pieces an older one is waiting on.

**No naming convention, deliberately.** A committed bin is whichever bin the packer scans, not a
code shape; inventing `CO-*` would reject the labels actually on the racks. So "empty" means exactly
one thing, and it is the only rule enforced: **no other OPEN order is using that bin.**

The refusals are the feature (`Shared/committedBins.js`, 46 offline assertions):

- a bin already held by another open order — refused, **naming the order in it**;
- gathering **more than the line ordered** — the surplus belongs to stock or another customer, and
  absorbing it silently is how a second order goes short with no trace;
- **moving a part-full order to a different bin** — that is a physical act, so it goes through
  release rather than a quiet re-stamp;
- **release is per quantity**, because partial is the normal case: plated poles come back short,
  part ships and part waits. Whole-bin is the shortcut over that. Every release takes a reason.

The pack workspace tells the packer **which bin this order's parts are waiting in** — gathering
them there is pointless if nobody is told where to collect them.

---

## 5. "20 arrived, 10 are for an order" — the arrival alert

Two kinds of arrival, and only one needs asking:

- a pole plated **for** one order comes back for that order — its shipment line carries the sales
  order, so it goes straight to that order's bin, no question;
- **small parts come back in bulk to stock**, and the backorders against them are invisible at the
  dock. That is the arrival that quietly puts a customer's parts on the open shelf.

So on a stock put-away (**Packaging Prep**, painted and stained), on a plated build-back with no
order of its own (**Plating**), and on a vendor receipt (**Receiving**), the screen asks every open
order what it is still short of and offers the split **oldest need first** — the only ordering that
cannot be gamed by which pallet lands first.

**It asks, it does not act.** "No" writes nothing, puts it all to stock, and is **logged with what
was left outstanding**. An operator who is unsure is never trapped into an allocation, and the
decision is on the record either way.

---

## 6. Plating — out to the plater, and back

Four phases: a **demand** appears → **pull** the raw to the plating bin → the weekly **shipment**
goes out with a purchase order and a packing list → the pallet comes **back**.

**The receiving station** (rebuilt 2026-09-03 while Stuart was receiving a live pallet):

1. **Scan to find** — one autofocused box; scan the raw code or the plated code and that line jumps
   up and highlights. No reading down a wall of identical green rows.
2. **Receive to a cart** — how many good pieces came back; several carts per PO; Save Cart closes
   one. **Nothing reaches NetSuite here.**
3. **Put away, which is what posts the build** — pick the line, scan the **bin**. One bin normally,
   Multiple bins for a split where the quantities must add up. Only now does NetSuite hear anything.

Then, in order, each step separately guarded: the pieces that **came back** move out of plating
status; any **short** pieces are adjusted out once; and the **build** posts with the scanned bin.

⚠ **THE BUILD GOES THROUGH THE CONVERT RESTLET, NOT THE PLAIN REST API.** A plated assembly is
bin-managed, and the plain record API *cannot set the consume-from bin on the component list* — it
is unpopulated at create time. Putting the bin only on the header cleared the first refusal and hit
the next one ("configure the inventory detail in line 1 of the component list"). The RESTlet sources
the BOM and sets the bin on every bin-tracked component; that is why it exists for the `/P` convert,
and the plated build-back is the same shape. A split across bins posts one build per bin, each
recorded as it lands, so a retry can never rebuild a bin that already went in.

**The receipt closes the order.** At receipt the order records that the pallet arrived; at
build-back the custom half flips to Complete and the order reads Plated — **that is what opens the
pack gate**, and nowhere else does. If NetSuite succeeds but telling the order fails, it says so
loudly rather than swallowing it: the build must not be repeated, so the operator escalates.

**Item labels print at the dock**, carrying the **plated** code, because that is what the pieces are
once they are back.

---

## 7. Labels — and the pack label the scanner can read

Five kinds in one tab: **item, bin, work order, sales order, UOM/pack.** The sales order label's
barcode is the **order number**, so scanning it anywhere means "this order" and never an item.

**The UOM label is the one that matters.** Printing "(7 pcs)" for the human is the easy half. The
hard half: every label barcodes the plain item code, so **a seven-pack and a single scan
identically** — a screen counts one piece while the operator holds fourteen. That is how an order
ships short.

So the piece count goes **inside the barcode**:

```
H1-138RG*7PK*7          item * unit * pieces-in-one-of-them
```

`Shared/labelScan.js` is the one place that writes and reads that grammar (36 offline assertions),
with the rule that makes it safe to adopt anywhere:

> **A plain code parses to exactly what it always meant — that item, one piece.**

So any screen can adopt `parseScan` without changing behaviour and gains pack-awareness the day
someone scans a pack label. No migration; no old label stops working.

`scanTally(scans, needed)` is the warning, as arithmetic rather than wording baked into a screen:
two 7-packs against 14 needed reads exact; one against 14 is short by 7; two against 4 is over. The
sentence stays the caller's — the floor and the office word things differently — but two screens
cannot disagree about the count.

**One label is one pack.** Units come from the 4.5 master list, so a new pack size is data, and a
unit carries its own count (`BAKERS DOZEN - 13`). A unit worth one piece prints a **plain** label,
because a single is just the item and only a real pack can be miscounted.

---

## 8. Which pole is this? — pick and pack cards

Stuart, 2026-09-09: *"if the labels fall of the pole there is no way for packaging to be sure they
are packing the correct pole with the correct small parts."*

The packer works from the **finishing** document, which holds small parts. The pole is fabricated on
the **shop** order and that is where its length lives (`cutLength` + the structured `cutList`). The
warehouse loaded neither; the link — `shopSiblingId` — already existed and had never been read here.
Both cards now show **length, quantity and sidemark**, loaded once per order and cached.

⚠ **TWO LENGTHS, TWO UNITS, NEVER ALIKE.** A cut length off the shop order is **inches** (96");
a length parsed from a stocked code is **feet** (`HCUMP810` → 8 ft — the grammar is a digit *pair*,
length then diameter, not a `-4` suffix). A bare "4" beside a bare "96" on a packing bench is how the
wrong pole goes in a box. The unit rides every row.

No cut list means **"no cut length recorded"**, not an inferred number.

---

## 9. Receiving (PO) — the vendor dock

Built by the Brief A session in the WMS file with Stuart's explicit go-ahead (2026-09-04),
deliberately the **same five steps as the plating station** because it is the same job with a
different supplier: **find · scan · cart · label · away**.

- the PO may have been raised here **or straight in NetSuite** — a miss against our own records is
  the normal case, and importing it also puts the PO on the RTG board (the standing every-order rule);
- the cart is persisted **on the purchase order**, so a dock tablet that reloads mid-receipt does not
  lose the count;
- the bin is validated by the pack put-away's rule;
- the app's own record is written **first**, so what physically arrived is known even if NetSuite
  argues, then the item receipt through the outbox, then the waiting orders — via the same
  `offerAllocation` the plating dock uses.

---

## 10. What the warehouse writes, and where

| collection | the warehouse's part |
|---|---|
| `fin_workorders` | pick/pack status, claims, put-away bin, pack photos, scrap |
| `hq_sales_orders` | Quick Ship pick/pack, `committedBin` / `committedQty`, `finishAsAvailable` |
| `plating_shipments` | the plating lifecycle: staged → shipped → received → built, carts, bins |
| `plating_demand` | **ended** through `Shared/platingDemand` (fulfil / cancel) — never deleted by hand |
| `rod_cut_orders` | cut complete, cut cancelled (which now lifts the gate it held) |
| `ns_outbox` | every NetSuite write |
| `hq_purchase_orders` | the weekly plater PO; receipts |
| `hq_logs` | every consequential act, with the operator's name |

**Functions** (`functions/index.js` — these do **not** auto-deploy): `nsOutboxWorker`,
`onStockBuildDone` (builds stock **and sales-typed** anchors at pack), `onMillComplete` (the milled
root's build, **off per brand** until `system/wms_config.rootBuildAuto` names one), `netsuiteProxy`.

Deploy: Cloud Shell → `cd ~/ce-m2c-design-app && git pull` → `firebase deploy --only functions:<name> --project ce-m2c-design-collab`.

---

## 11. Still unproven, and still open

**UNEXERCISED BY AN OPERATOR** — the honest headline. The claim gate, SO Pack's four numbers,
committed bins, the arrival alert, the plating receipt → pack gate loop, the sales-typed anchor
build, the LABELS tab and the pole details have all been verified in the served bundle and **none
has been used on the floor**. The live pass is the outstanding risk, not the code.

**OPEN:**

- the plating **build-back's** NetSuite post is the last direct write with no double-post guard;
- the pre-pack confirm calls an Order Entry custom half "still in production" forever — nothing
  stamps a floor phase on it; needs a spec;
- the plating PO must adopt `PO_STATUS` once A extends it, or it stays invisible on the RTG board;
- `clearReceiptGate` must be called at receipt once A exports it;
- `onMillComplete` stays off until three clean manual ⛏ posts on CE earn the flag;
- **LABELS needs granting** in the permission matrix.

---

## 12. Verifying a WMS deploy — four traps, all of which produced a wrong answer

1. the marker must be a string the code **emits** — read it from the source, never from a
   description of it;
2. it must not be a **substring** of pre-existing code;
3. **plain ASCII only** — an em-dash may be escaped in the bundle;
4. the sweep must **prove it read the bytes**: re-fetch `asset-manifest.json` immediately before
   sweeping, `curl -sf`, report failures and total bytes. Filenames rotate the instant anyone
   deploys and `curl -s` writes the 404 body, which greps exactly like "absent".

`version.json` proves nothing on its own. And a **logic-only** change emits no new string and cannot
be verified this way at all — that needs a behavioural check.

**Offline suites** (fast, no Firestore or NetSuite):
`node scripts/committedBins.test.mjs` (46) · `pickLines.test.mjs` (48) · `labelScan.test.mjs` (36).
