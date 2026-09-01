# Pole routing — handoff, 2026-09-01

**Stuart is picking up here.** One shipped rule is WRONG and is actively doing damage on every
sync. Everything else in this brief is context around that.

---

## 1. ⛔ THE THING TO FIX FIRST — my rule is wrong

**Stuart, 2026-09-01:**
> "that force should not have forced the change to custom (they should have stayed small parts to
> stay in finishing), custom drives poles to shop floor, it should have updated the tag finish
> stream to Poles finish like a pole"

### What the correct state looks like
`HCUMP810/BL` — his screenshot, the reference:

| field | value |
|---|---|
| PROD TYPE | `POLE` |
| **PART HANDLING** | **`SMALL PARTS`** ← keeps it in FINISHING |
| **FINISH STREAM** | **`POLES — finish like a pole (-P recipe)`** |

### What I shipped instead
`Shared/poleCut.js:113`:
```js
export const autoPartHandlingFor = (productType, isStocked) =>
    isPoleCategory(productType) ? (isStocked ? 'Small Parts' : 'Custom') : 'Small Parts';
```

I invented the `isStocked ? 'Small Parts' : 'Custom'` branch. Stuart's original words were *"they
need to be tagged small parts in the parts handling as these are stocked poles and do not require
custom"* — I read "stocked poles → Small Parts" as implying "unstocked poles → Custom". **He never
said that, and it is wrong: `Custom` routes a pole to the SHOP FLOOR instead of finishing.**

### The correct rule
**The pole auto-rule must not touch `partHandling` at all.** It sets the finish stream and nothing
else. Handling is a human's call and already correct on these items.

Concretely:
- `autoPartHandlingFor` should be **deleted**, and both call sites stop setting handling:
  - `NetSuiteSyncTab.js:540` — the 🪝 Force Pole / Rod Tags backfill
  - `NetSuiteSyncTab.js:975` — the Master Library sync's per-item stamp
- `autoFinishStream` (POLES for any pole/rod category) is CORRECT and stays.

### ⚠ Live damage — two items are wrong right now
The force fix ran **2026-09-01 15:11** and flipped these to `Custom`. They must go back to
`Small Parts` (Master Library → the part → PART HANDLING):

```
HCUMP810/BS      (Pole) — handling SMALL PARTS → Custom     ← revert to Small Parts
HRW-138TRAV12    (Pole) — handling Small Parts → Custom     ← revert to Small Parts
```

**And it will keep happening.** `NetSuiteSyncTab.js:975` runs on EVERY Master Library sync, so any
pole/rod not flagged stocked gets flipped to Custom again on the next pull. Fix the code before the
next sync, or the two reverts above will simply undo themselves.

*(Side note, not a bug: those two items being treated as "not stocked" is itself worth a look —
`specs.isStocked` is false on them. Irrelevant once handling is left alone.)*

---

## 2. What that same 3:11 PM run got RIGHT — don't undo it

The pole-count repair half of the force fix was correct and fixed a live floor stoppage:

```
Open work orders: 4 repaired.
  WO-HCUMP810-N25-502251 · HCUMP810/N25 — poles 10
  WO-HCUMP610-N25-443233 · HCUMP610/N25 — poles 10
  WO-HCUMP610-N25-436606 · HCUMP610/N25 — poles 10
  WO-HCUMP415-N25-464595 · HCUMP415/N25 — poles 10   ← Sandra's WO11535
```

**Sandra G, 11:40** — *"Keep showing on finishing stage because say the order has small parts."*
WO11535 (`HCUMP415/N25`) read "10 pcs · 0 pole(s)" and carried BOTH streams: POLE SPRAY and POLE
BAKE completed at 10:39, while SLED SPRAY and SLED BAKE sat PENDING forever on an order with no
small parts. It could never complete. That order is now repaired.

---

## 3. Code shipped this session (all on `main`, all deployed)

| commit | what |
|---|---|
| `00b26f3` | **Sandra's fix.** Stock View grid + RTG release now stamp `poles`/`totalPoles` and leave sled sizes null for pole/rod items. RTG was the only release path that never asked "is this a pole?" — `poles:` did not appear in that file. |
| `8f4e709` | **The sweep.** Five remaining local copies of the pole test (StockView ×2, QuickShip ×2, PickPack ×1) now call `isPoleCategory`. Zero local copies remain in any WO-writing path. |
| `ce34fe1` | Pole tags: `autoFinishStream` + the force-fix button + Setup Queue/ActiveFloor/sync all using one category test. **Contains the bad `autoPartHandlingFor` — see §1.** |
| `b0a7d9b` | 14.5 pillow folders: separator optional (Ashley's `Dalton27P23x23`), filename as second witness. |
| `d07019c` | 14.5: `: _ / -` and space all skipped as separators. |
| `ba96e33` | 14.5: surfaces library read/write permission failures instead of blaming the folder name. |
| `7e43b6a` | Photo beats `.glb` render beats inherited stand-in; legacy renders classified by their `auto_thumbs/` storage path. |
| `48d0230` | 14.5 imports stamp the item directly; one shared gallery matcher. |
| `7bed796` | User Guide gains a "Working on the App" section. |

**Deliberately NOT touched** (named, not fixed): the tag classifiers in BOMTab, AdminTab,
NodeClusterTab, VisionHardware, tagSheetImport — they sort parts into BACKPLATE/BRACKET/FINIAL/
RING/POLE for the tag engine, a different question. `Management.js`'s `totalPoles` is its DEMO-WO
generator.

---

## 4. Open: NetSuite fulfillments (11.1 queue — 9 failed)

Investigated, **nothing changed**, waiting on Eric for the first one.

### A. Multi-location — 3 failures (Andrea, 09-01 morning)
`WO-SO60104` · `WO-SO59789` · `WO-SO60105` (BRIMAR)
> "Fulfillments can be shipped from only one location when using Multi-Location Inventory."

Our payload (`PickPackApp.js` ~1290) is a bare transform with **no location**:
```js
POST .../salesOrder/<id>/!transform/itemFulfillment
{ shipStatus: { id: 'B' }, memo: … }
```
The transform pulls every open line with whatever location it carries. We set location only on the
SO **header** at creation (`nsTransmit.js:595`), never per line.

**Two possible truths, opposite fixes — DO NOT GUESS:**
1. Lines are all one location, NetSuite just wants it stated → add `location` to the payload.
2. Lines genuinely sit at two locations → also mark other-location lines unfulfilled, i.e. **one
   fulfillment per location**.

**Question for Eric:** open SO60104 — is the Location column the same on every line, or two?

### B. Already closed — 3 failures (Sandra, 08-31 16:21)
`WO-SO59619` · `WO-SO59620` · `WO-SO59727` (NS 882307 / 882308 / 886441)
> "You have an invalid sales order … or the order is already closed."

These can never succeed and will retry forever, which is how a real failure gets missed.
**Proposed (approved in principle, not built):** before queuing and on retry, run the query the app
already has in `pullFulfillment` — `SELECT … WHERE t.type='ItemShip' AND t.createdfrom = <so>` — and
if a fulfillment exists, write its number back and mark done instead of failing.

### C. Not a fulfillment — 3 failures (Sinaya)
Sales Order QUOTE-1785764574235 · Michele Dunker → *"Please enter value(s) for: Class."*
`class: { id: '2' }` is sent only when `brand === 'ce'` (`nsTransmit.js:596`). A non-CE brand sends
no class and NetSuite requires one. Needs a per-brand class map.

---

## 5. Also open, from earlier

- **NetSuite WO close** — non-WIP orders refuse `!transform/workorderclose`. Blocks the whole scrap
  flow. Eric must choose: PATCH the status / create WOs as WIP / close by hand.
- **`ItemVendor.vendor`** — the column does not exist on this account; the PO vendor-id fix has
  never had data. Eric clarified 08-27 that Inventory items use `salesdescription` and Assemblies
  use `description`.
- **Sales sync cadence** — Eric asked weekly-Sunday; what shipped caches per month.
- `APP_ARCHITECTURE_BRIEF.md` — the general orientation doc. Its published artifact page is a
  section behind the .md; republish when the repo doc settles.

---

## 6. The pattern behind almost all of it

Every pole bug this fortnight was one shape: **a screen deciding for itself what a pole is.**
The Setup Queue's copy could not see a `ROD` (Grace, WO11485/11486). RTG had no copy at all
(Sandra, WO11535). Five more copies existed and agreed only by luck.

`Shared/poleCut.js → isPoleCategory` is the one answer. Category only — `POLE`/`ROD` — never the
finish stream, never the code grammar.

**And §1 is the same failure in a different costume:** I derived a routing rule from an
adjacent sentence rather than asking. `autoFinishStream` answers a question Stuart actually asked.
`autoPartHandlingFor` answers one he did not.
