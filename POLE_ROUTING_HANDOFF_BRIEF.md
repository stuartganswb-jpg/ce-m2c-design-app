# Pole routing — handoff, 2026-09-01

**Updated 2026-09-01 evening.** The rule this brief was written to flag is now FIXED — §1 records
what it actually turned out to be, because the answer is not what either of my two attempts said.
Sections 2–6 are unchanged context; §4 (fulfillments) is still open and still needs Eric.

---

## 1. ✅ RESOLVED — the handling rule, and what it actually is

**Status 2026-09-01 evening: fixed by Stuart with another session (`0615687`, `25a25d9`).
Nothing to do here. Verified against the repo before this section was rewritten.**

I had this section telling you to "delete `autoPartHandlingFor` and never touch partHandling".
That was my correction to my own bug and it was still not the rule. Stuart's real rule is narrower
and better:

### The rule — the FINISH SUFFIX decides handling

| item code | handling | why |
|---|---|---|
| mill code, no suffix | `Custom` | nothing applied yet — the shop makes it |
| `/P` `/P01` `/P25` `/EP*` `/MEP*` | `Custom` | a finish is APPLIED to it |
| `/BS` `/N90` `/CP` | `Small Parts` | a complete stocked assembly — stays in finishing |

Finish stream is `POLES` either way. **`isStocked` plays no part in it** — that was my invention,
twice over (first as `isStocked ? Small Parts : Custom`, then as "leave handling alone").

Lives in `Shared/finishRouting.js` as `handlingForErp` / `isAppliedFinishCode`, reusing the existing
`isOutsourcedFinishCode` so the EP grammar has ONE definition. `autoPartHandlingFor` is deleted;
only a tombstone comment remains in `poleCut.js:109`.

### A SIXTH copy of the pole test — the one my sweep missed
`8f4e709` swept five. There was a sixth, in **`StockViewTab.pullNetSuiteStock`** (~:420) — a
*separate* NetSuite importer with its own copy of both the pole test AND the handling rule:

```js
const isPoleOrLinear = pTypeClean === 'pole' || pTypeClean === 'poles' || uom ft…   // no ROD
const autoPartHandling = isPoleOrLinear ? 'Custom' : 'Small Parts';                 // every pole
```

That is how a **stocked** `/BS` pole arrived from NetSuite already routed to the shop floor. Fixed
in `25a25d9`. My sweep looked for writers of finishing work orders and missed an *importer* that
writes the routing fields — worth remembering as the shape of the gap, not just the instance.

### The re-flip is closed too
The sync now **fills the blank only** on a pole's handling — `existingAppRecord…partHandling ||
handlingForErp(...)`. A hand-set value survives every pull. Stuart: *"these rules cover 90%, the
rest we will do by hand"* — and the old rule re-deriving it every time is exactly what kept
re-flipping `HCUMP810/BS` after it had been put right.

`HCUMP810/BS` and `HRW-138TRAV12` are back to `Small Parts`. Stuart re-ran the force fix; poles
look good.

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
| `8f4e709` | **The sweep.** Five local copies of the pole test (StockView ×2, QuickShip ×2, PickPack ×1) now call `isPoleCategory`. **Incomplete — a sixth lived in an IMPORTER, not a writer; see §1.** |
| `ce34fe1` | Pole tags: `autoFinishStream` + the force-fix button + Setup Queue/ActiveFloor/sync all using one category test. Carried the bad `autoPartHandlingFor`, since removed in `0615687` — see §1. |
| `b0a7d9b` | 14.5 pillow folders: separator optional (Ashley's `Dalton27P23x23`), filename as second witness. |
| `d07019c` | 14.5: `: _ / -` and space all skipped as separators. |
| `ba96e33` | 14.5: surfaces library read/write permission failures instead of blaming the folder name. |
| `7e43b6a` | Photo beats `.glb` render beats inherited stand-in; legacy renders classified by their `auto_thumbs/` storage path. |
| `48d0230` | 14.5 imports stamp the item directly; one shared gallery matcher. |
| `7bed796` | User Guide gains a "Working on the App" section. |

**Landed by Stuart + another session after the above** — `0615687` (suffix decides handling),
`25a25d9` (the sixth copy, in `pullNetSuiteStock`), `3f6a953` + `b531f53` (Order Entry pair:
`pushToShop` resolves the order type instead of assuming 'stock', and passes `finSiblingId` through
so the sibling release stops no-oping). My pole-aware `finPayload` branch in RTGDispatchTab is
untouched by those.

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

**And §1 was the same failure in a different costume, twice.** I derived a routing rule from an
adjacent sentence rather than asking — `isStocked ? 'Small Parts' : 'Custom'` — and when that was
caught, my proposed correction ("never touch handling") was ALSO a guess. The real rule was a third
thing: the finish suffix decides. `autoFinishStream` answered a question Stuart actually asked;
everything I built around handling answered one he did not.

The sixth copy in `pullNetSuiteStock` says something about the sweep, too: I swept the WRITERS of
finishing work orders and missed an IMPORTER that writes the same routing fields. "Every place that
decides X" has to mean every place, not every place of the kind I was already looking at.
