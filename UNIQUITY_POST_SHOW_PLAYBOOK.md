# Uniquity · After the show — the team's playbook (2026-10-22)

Stuart is away for a day. This is the whole route for every order taken at the show, screen by screen, in the
order the team works it: **look at every order → decide what ships ahead → decide what goes to Stitch & Sew →
get the fabric → sew → pack → ship.** It was written from the app as it is on 2026-10-22; no order has been
walked through the new Launch / Pick & Pack screens live yet, so on the first one watch each step and tell
Stuart (or the app session) if a screen does not do what this says.

## The screens, who uses them, how to get in

| Screen | Address | Who | Sign-in |
|---|---|---|---|
| **12.7 Launch** (decide what ships, what starts) | HQ → Uniquity division → tab **12.7 LAUNCH** | office (Ashley / Laetitia / Stuart) | HQ PIN |
| **12.5 Stock View → 🧾 Order Entry Needs** (start the pillows) | HQ → **12.5 STOCK VIEW** → 🧾 Order Entry Needs | office | HQ PIN |
| **12.5 → 📋 Backorders** (fabric to order) | HQ → 12.5 → 📋 Backorders | office | HQ PIN |
| **6.5 Tools → 🧵 Fabric Cut Stock** (throws → yardage, remnants) | HQ → **6.5 TOOLS, SPECS & FAQS** (brand Uniquity) | office / cutter | HQ PIN (CSR and up) |
| **WMS** (pick the fabric for a sewing document, stage it) | **/pick-pack**, brand switched to **Uniquity** | the Uniquity team | WMS PIN |
| **Stitch & Sew** (cut · sew · stuff · pack the pillows) | **/stitch-sew** | the sewing team | the same PINs |
| **Uniquity Pick & Pack** (pack the orders, UPS labels, ship) | **/uniquity-pickpack** (hub tile 06.5) | the Uniquity team | the show-counter PINs |
| **RTG** (the snapshot of everything, NetSuite transmit log) | HQ → 13. RTG DISPATCH | office | HQ PIN |
| **11.1 NetSuite Sync** (what NetSuite accepted or refused) | HQ → 11.1 | office | HQ PIN |

Two things never to do: never save a test order (saving is sending to NetSuite); never type someone else's PIN.

---

## Step 1 — Look at every order (12.7 Launch)

HQ → Uniquity → **12.7 Launch** → window **ALL OPEN** (the 7 / 14 / 30-day windows hide the older show orders).

One row per stocked order, newest first. The chips on a row say what it is made of:
- **on the shelf** — throws, stocked pillows, anything picked as it is
- **stitch & sew** — custom pillows to make
- **to identify** — a quick-add from the counter that nobody has named yet
- **held / released** — what 12.7 has decided for the shelf lines
- **backordered** — the office owes something (fabric, a throw) — the line says what

The coloured sentence on the right is the suggestion. Read it as:

| Suggestion | Means | Do |
|---|---|---|
| **on the shelf — picked as it is** | nothing to make; the warehouse packs it as always | nothing here — it is already on Uniquity Pick & Pack as TO PACK |
| **pillows + shelf lines — decide** | throws beside pillows; the throws are HELD until you choose | Step 2 |
| **lines to make — start them** | pillows (no throws) not yet started | Step 3 |
| **shelf lines held — release when ready** | you chose Hold; the pillows are being made | release the throws when the pillows are done, or earlier |
| **a quick-add to identify first** | a counter quick-add still called "TBD" | identify it on RTG or the customer's CRM card first — nothing starts or ships on a guess |
| **waiting for NetSuite to accept the order** | the order is still in flight to NetSuite (a few seconds), or NetSuite refused it (then the row says "NetSuite refused" and why) | a refused order still launches, picks and packs; it is held at shipping until NetSuite takes it — fix the refusal on 11.1 → NetSuite Sync Queue (or the 🧾 NetSuite-to-fix chip) |

Open a row (▸). You see:
- **💲 the terms line**, read live from NetSuite: *Pay Before Shipping — $X still to be paid ($Y of $Z paid)* or *paid in full* or *Net 30 — ships before payment*. This is the same gate the warehouse hits at shipping.
- every line with its kind, its state (**held / released / picked as always / started / not started**), and the backorder line at the bottom.

### Where the show orders stood on 2026-10-21 (the five that need a decision)

| Order | Customer | Shelf lines | Pillows | Paid | Notes |
|---|---|---|---|---|---|
| SOUNIQ-4010 | Summerstory (Outpost/Mast) | 5 lines, 10 pieces | 1 line × 2, not started | $2,918.00 of $3,209.80 | the cleanest ship-ahead; 2 items showed backordered on the board |
| SOUNIQ-3996 | Patina | 8 lines | 8 lines, not started | $6,460.00 of $7,106.00 | Dowell/70T + 4 fabrics backordered |
| SOUNIQ-4024 | Tineke Triggs | 2 lines | 2 lines, not started | $2,571.00 of $2,828.10 | Haring/10T backordered — only the Banksy XL could go |
| SOUNIQ-4012 | Comerford Collection | 2 lines | 3 lines, not started | $0.00 of $4,100.80 | nothing paid — anything packed will hold for payment |
| SOUNIQ-3985 | Katie Kirby Interiors | 1 line | 2 lines | $0.00 of $2,090.00 | nothing paid; both pillows' fabric backordered |

Plus 12 orders entirely on the shelf (already TO PACK), 2 pillow-only orders to start (SOUNIQ-3997 MC America, SOUNIQ-3995 PECKY), and 7 counter orders with a quick-add to identify first.

---

## Step 2 — Decide what ships ahead (the throws before the pillows)

For each **"pillows + shelf lines — decide"** row, ask three things:
1. **Are the shelf lines in stock?** The **backordered** chip and the line at the bottom of the open row say what is short. A short throw cannot ship ahead.
2. **Is it paid enough?** Stuart's rule for a pay-first customer shipping a part first: *what is paid must cover the part going out, and what is left of the payment must be more than half of what stays behind.* Example: $1,000 order, $650 paid, throws worth $200 → $450 left against the $800 of pillows still to come → ships. $600 paid → $400 left = exactly half → waits. The screen does this sum for you at packing; if it holds, the Pick & Pack page says "waiting for payment" with the numbers.
3. **Does the customer want two deliveries?** Shipping ahead means two boxes and two UPS charges on that order.

Then press one of:
- **🚚 Ship the shelf lines ahead** — every throw / stocked line is released now. The order appears on Uniquity Pick & Pack as TO PACK for those lines only ("ships 2 lines now as shipment 1; 3 stay behind").
- **⏸ Hold until the pillows are sewn** — nothing ships until the pillows are done; then the whole order packs at once.
- or the per-line **Release / Hold** buttons for a partial of your own choosing (works on any order, any brand — e.g. release everything except one short throw).

Add a note in the box first if you want it on the record ("customer asked for the throws before Friday"). Every decision is on the order: who, when, what.

Changing your mind: press the other button, or Hold / Release the line again. Until something is packed, it is free to change. After shipment 1 has gone, the rest is still yours to hold or release.

---

## Step 3 — Decide what goes to Stitch & Sew, and start it

Who to start first: the oldest orders with their fabric in hand. Open the row on 12.7: a pillow line reads **not started** until it has a sewing document.

Before you start a pillow, know its fabric:
- A pillow is cut from the **fabric-yardage item** of its pattern (e.g. the throw is BELL/10T, the fabric is BELL/10F in yards). The counter stamped the yards each pillow needs on the order.
- The **backordered** chip / **TO BE SOURCED** on a pillow means the fabric is not in stock as yardage. You have two ways to get it (Step 4): convert throws you have into yardage, or order it.

Start:
1. On 12.7, press **▶ Start the made lines → review**. It opens **12.5 Stock View → 🧾 Order Entry Needs** on that order.
2. On the order's row press **▶ Start row** (the pillows of a row start together as one sewing document). Read the review: the fabric pulls in yards, the inserts and zippers, anything short (a short fabric line goes to the **📋 Backorders** board instead of the floor).
3. Press **Continue → Generate**, then **⚙ Generate Order**. That writes the sewing document **WO-… · Stitch & Sew · n custom pillows**. It is released to the WMS pick at once and shows on RTG.
4. On 12.7 the pillow line now reads **started**.

If the review refuses a row, the message says why (usually a fabric with no NetSuite item, a quick-add, or a raw read that failed — retry). Do not force it; tell Stuart.

---

## Step 4 — Fabric: turn throws into the yardage the pillows need

HQ → **6.5 Tools, Specs & FAQs** (division Uniquity) → **🧵 Fabric Cut Stock**.

The screen lists every fabric with NetSuite's yards (press **↻ Read NetSuite yards**) and the **cut ledger**: every remnant piece on the shelf with its size and the largest standard pillow it still makes.

**⇄ Convert throws → yardage** (bottom of the screen):
1. Type the **fabric (yardage) code** (e.g. BELL/10F), the number of **throws** to cut up, the **throw bin** the throws come from and the **yardage bin** the yards go to (both optional).
2. The plan line shows the yards you will get (yards per throw comes from the fabric's library record).
3. Press the button, then press it again (**Press again to post the NetSuite build**). NetSuite consumes the throws and receives the yards. This is a real stock move — do it when you are about to cut, not before.
4. Press **↻ Read NetSuite yards** to see the new figure; the pillow's fabric line is no longer short.

Other buttons there:
- **add a cut** — a remnant you find on the shelf: fabric, length × width → a labelled piece in the ledger. The sewing document will pick from the ledger before cutting a new throw.
- **scrap** — a piece too small for any pillow; it leaves the ledger and NetSuite.

Fabric you do not have at all (no throws either): **12.5 → 📋 Backorders** lists it; order it from the vendor there (PO) — the sewing document waits on the receipt and the WMS picks it when it lands.

---

## Step 5 — The WMS picks the fabric and stages the sewing document

/pick-pack → sign in → brand **Uniquity** (the brand switch at the top).

- **Awaiting Pick** shows the sewing document (WO-… Stitch & Sew). Its lines are the fabric in **yards** (or a **CUT piece by its ledger label** when a remnant covers a panel), the inserts, the zippers.
- Pick them line by line (scan the bin, enter the quantity). A yard line is picked as yards; a cut piece is picked by scanning its piece label.
- Print the staging label and **scan it at the staging bin** — that is the handshake. Until it is scanned, Stitch & Sew cannot take the document to the floor ("stage it to the floor first").

---

## Step 6 — Stitch & Sew makes the pillows (/stitch-sew)

Sign in with any PIN.

**QUEUE** — the sewing documents not yet on the floor, oldest need-by first. Each card shows the pillows (size, fabric, the cut per side, the snapshot) and where the WMS stands.
1. **▶ Start** — the document is Running (do this when the cutter is about to take it).
2. **🧵 To the floor** — only lights once the WMS has staged it (Step 5). The staging label reprint is beside it.

**FLOOR** — the four zones, one at a time, each with **Start** then **Complete**:
1. **✂️ CUT** — cut the panels. Completing CUT asks **what fabric is left and its usable size**: enter each remainder's length × width (or none). Each remainder becomes a labelled piece in the cut ledger (print the label, put it with the piece) — that is how the next pillow finds it.
2. **🪡 SEW** — sew, add the welt / trim the ticket says (leather welt, railroad stitch, blanket stitch — the NAU item and colour are on the ticket).
3. **☁️ STUFF** — insert.
4. **📦 PACK** — bag it. Completing PACK marks the document **Complete** and tells RTG.

**DONE** shows the last seven days. **CUT STOCK** is the same ledger as 6.5.

The moment PACK is complete, the pillow reads **sewn — in hand** on Uniquity Pick & Pack, and the order's block turns TO PACK (or stays WAITING if other pillows of the order are still on the floor).

---

## Step 7 — Pack and ship (Uniquity Pick & Pack, /uniquity-pickpack)

Sign in with the show-counter PIN. Two sides at the top: **Pack · n** and **Ship · n**.

**Pack** — one block per order, oldest first, TO PACK before WAITING.
- **TO PACK** — every line that may go is in hand: throws not held on 12.7, pillows that Stitch & Sew completed. Open it: the lines, the 💲 terms line, and **📦 Packed**.
- **WAITING** — the block says why: *at Stitch & Sew* · *held on 12.7 Launch* · *waiting for 12.7 Launch to decide* (a pillow + throw order nobody decided yet — go to Step 2) · *a quick-add to identify first* · *waiting for NetSuite*.
- Press **📦 Packed** (one press, one confirm). Pull the lines it names, box them. Nothing else to scan or photograph here.
  - A whole order: it is stamped packed and its NetSuite fulfilment is queued (if an item sits in two bins NetSuite knows, a window asks which bin you took it from).
  - A partial ("ships 2 lines now as shipment 1"): the lines going now become their own packed record, *shipment 1* of the order; the order stays on the Pack side for the rest.
  - If the terms are not met, the press still stands: the order moves to the Ship side as **waiting for payment** with the numbers.

**Ship** — the packed orders, the same UPS panel Classical uses (for now on the Classical UPS account; the Uniquity account is being added).
- Pick the order, check the address, enter the box sizes and weight, rate it, **buy the label**, print. The tracking goes onto the order and NetSuite's fulfilment is marked shipped.
- A held order sits above the panel: **Check again** re-reads NetSuite (press it after the customer pays, or after NetSuite accepts a refused order). **Release** (manager PIN) ships an unpaid order with a reason written down — it is never offered for an order NetSuite has not accepted.

What NetSuite sees: one Item Fulfillment per shipment (two for a ship-ahead order), from the item's bin; the office sees them land on **11.1 → NetSuite Sync Queue** (about a minute) and on RTG's transmit log.

---

## The daily loop while Stuart is away

Morning (office, 15 minutes):
1. 12.7 Launch, ALL OPEN — anything new, anything **to identify**, anything **NetSuite refused** (fix it on 11.1 or the 🧾 chip).
2. Decide the **"pillows + shelf lines — decide"** rows (Step 2). Write the note.
3. Start the pillows whose fabric is in hand (Step 3). Convert throws or raise the backorder for the rest (Step 4).
4. 12.5 → 📋 Backorders — anything that arrived? The WMS picks it.

Floor, all day:
5. WMS (Uniquity): pick and stage every sewing document in Awaiting Pick (Step 5).
6. Stitch & Sew: QUEUE → FLOOR, zone by zone; file every remainder at CUT (Step 6).
7. Uniquity Pick & Pack: pack every TO PACK block; ship everything on the Ship side; press **Check again** on anything waiting once it is paid (Step 7).

End of day (office):
8. 12.7 — what is still **held**; release what can go. 11.1 — nothing stuck in the Sync Queue.

## If something is wrong

| You see | Do |
|---|---|
| a block says **waiting for 12.7 Launch to decide** | the office decides it on 12.7 (Step 2) |
| **held on 12.7 Launch** on a line you want to ship | 12.7 → open the row → **Release** on that line |
| **at Stitch & Sew** but the pillow is done | Stitch & Sew → FLOOR → the document's PACK zone must be **Complete** — finish the zones |
| **stage it to the floor first** on Stitch & Sew | the WMS has not scanned the staging label (Step 5) |
| **waiting for payment** | collect the payment (the pay link on the order's CRM card), then **Check again** |
| **waiting for NetSuite** / **NetSuite refused** | 11.1 → NetSuite Sync Queue (or the 🧾 chip): read the refusal, fix the cause (usually the customer record or an item), retry; then **Check again** on the shipment |
| a counter order's customer is **app-only** (sale refused by name) | CRM card → **Match to NetSuite**, or create the customer in NetSuite and sync on 11.1, then save the sale again |
| a **quick-add (TBD)** line | identify it on RTG or the CRM card; the order then goes to NetSuite and launches |
| a fabric line sits on the WMS pick bench of a pillow order that nobody started | skip it — the fabric is picked on the sewing document, not on the order; the order's throws are what to pick |
| a shipment child (QS-SHP-…-01) shows on RTG as its own stocked order | that is shipment 1 of its parent; leave it — the office knows |

Anything else: write it on the App Improvement feedback tab with the order number; the app sessions read it.
