# REPAINT & JUST FOR PAINT — the one engine, for a joint session

*Brief A, 2026-09-09. For a session picking up the paint-run path across HQ, the finishing floor
and the WMS. Read §1 before proposing anything: the most important fact here is that this
mechanism already existed and was invisible.*

---

## 1 · The finding that shaped all of it

Asked for a "repaint" tool, the honest answer was: **you already have one.**

A **Just For Paint** run with its *Pull Pieces From* field set has done exactly this since Eric
asked for it on **2026-08-12**:

| Step | Where | What happens |
|---|---|---|
| Setup Queue builds the pull line from `jfpPullFrom` | `FinishingFloor/SetupQueue.js:149` | the comment already read *"when repainting stock of a different finish"* |
| WMS pick posts **−qty of the source** at pick confirm | `PickPack/PickPackApp.js:3317` | memo reads *"repaint source"* |
| Put-away posts **+qty of the target** into the scanned bin | `PickPackApp.js:1808` | `paintOnlyAdjustment` |

Nothing about the mechanism was missing. What was missing is that **the form lived only on the JFP
template record and demanded both codes from memory** — so standing on `HHRMBF75/M3` you saw
nothing, and no screen told you which colour had eight on the shelf.

**The lesson worth carrying:** before building a tool, check whether the engine exists and is
merely unreachable. This one had been live for four weeks.

---

## 2 · What a paint run IS

No library assembly. No NetSuite work order. Two inventory adjustments and a floor job.

```
hq_work_orders / fin_workorders
  paintOnly: true
  jfpItemCode      the TARGET — painted pieces are adjusted INTO this at put-away
  jfpItemId        its NetSuite internal id (resolved at CREATION, never at packing)
  jfpPullFrom      the SOURCE colour — the pick adjusts this OUT
  jfpPullFromNsId
  jfpFinishId / jfpFinishLabel   the recipe the floor runs
  type             'Just For Paint' | 'Repaint'
  repaint: true    + repaintFrom, repaintAvailAtIssue   (Repaint only)
```

Those fields ride on **both** documents deliberately: by packing time the library record is not in
the room, and they are exactly what the WMS reads to decide whether to move stock at all.

**JFP** = an item the app was never taught (a legacy code being discontinued).
**REPAINT** = an item it knows, pulled in another colour.
Same order. Only the reason differs — and the reason is worth keeping on the record.

---

## 3 · Where it lives now

| Module | Owns |
|---|---|
| `Shared/paintOnly` | the JFP vocabulary, validation, and the put-away adjustment payload |
| `Shared/repaintSource` | which colours qualify, the sibling query, **the stock refusal** |
| `Shared/repaintRun` | `releaseRunToFloor` + `raisePaintRun` — **the one writer, both doors** |

**Two doors, one writer.** Master Library (`LibraryTab`, under *Generate Production Work Order*) and
Sales Snapshot (`StockViewTab`, on the row beside the ✂ rod cut). The rules and the writer are
shared; only the layout differs, because one lives on an item page and one in a table row.

### The rules, and why each is the way it is

- **Siblings come from NetSuite, not the app library.** The catalogue is the authority on what
  colours exist — the app never having been taught them is the whole reason this tool exists.
- **`LIKE '<base>/%'`, anchored on the slash**, so `HHRMBF75` cannot drag in `HHRMBF750`.
- **Empty colours are listed and greyed, never hidden.** "That colour exists but is empty" is a more
  useful answer than a shorter list.
- **Short stock is REFUSED, not warned.** A repaint against stock that is not there fails at the
  pick two weeks later, in front of somebody holding a scanner.
- **Free entry** accepts any NetSuite item #, validated when typed — checked at the moment the
  person who knows the item is standing there, not at the put-away bin.
- **Not gated on the sourcing tag.** The two items that prompted this disagree: one is tagged
  in-house (and waited forever on milling we do not do), the other outsourced (correctly — but we
  can still paint it here). Reading the tag would refuse the exact cases it exists for.

---

## 4 · What changed under it this week (and what to re-test)

`releaseRunToFloor` and `raisePaintRun` **moved out of `LibraryTab` into `Shared/repaintRun`**
rather than being copied, so the Snapshot's tool is the same tool by construction rather than by
resemblance. Writer 7's conversion moved with them: the floor document is now built by
`Shared/floorRelease.buildFinDoc`, so a paint run gained what a hand-written write never had —
the board's later urgent statement, a hold placed while parked, the NetSuite anchor when one
exists, the dispatch stamps, and the **pole/sled assertion** that caught Sandra's WO11535.

> **The Master Library repaint was tested and working on 2026-09-08 — BEFORE that move.**
> Behaviour is unchanged by construction, but that is a claim about code, not about the floor.
> **Run one repaint from each door before trusting it.**

---

## 5 · Known edges — say these out loud before extending anything

**Stock moves down at the PICK and up at the PUT-AWAY.** A run abandoned between the two leaves the
source already deducted. That is how JFP has always worked; it was rare, and Repaint will make it
common. *This is the first thing a joint session should decide about.*

**The pick's negative adjustment is queued, not posted.** A rejection lands in 11.1 → Sync Queue
with the payload, retryable, while the app's own record stays correct.

**A JFP/Repaint order has no NetSuite work order**, deliberately — `onStockBuildDone` gates on
`!after.nsWoId`, so the server trigger skips it and the adjustment is queued client-side. Nothing
to deploy; do not "fix" this by giving it an anchor.

**The target is resolved against NetSuite at creation.** Discovering a typo at the put-away bin,
two weeks and one paint line later, would be the worst possible moment.

**No BOM is consumed.** A repaint is a colour change, not a build — if a future case needs
components consumed as well, that is a different document, not a flag on this one.

---

## 6 · Questions a joint session should settle

1. **Abandonment.** Should a repaint reverse its pick adjustment when the run is closed unstarted,
   or is a manual correction acceptable? (Today: manual.)
2. **Should a repaint appear on the RTG board differently from a normal finishing run?** It carries
   `type: 'Repaint'` and `repaintFrom`, but no card treats it specially.
3. **Should the WMS pick warn** when the source colour's stock has fallen below the run's quantity
   between issue and pick? `repaintAvailAtIssue` is stamped for exactly this comparison and nothing
   reads it yet.
4. **Multi-colour sources.** Today one source colour per run. Two half-covering colours means two
   runs — acceptable, or worth a split?
5. **The Snapshot's ♻ pre-fills the quantity from the row's Rec.** Right number? It is what the
   operator was looking at when they decided they were short.

---

## 7 · Files a joint session will touch

```
Shared/repaintRun.js      the writer            (A)
Shared/repaintSource.js   the rules             (A)   16 assertions
Shared/paintOnly.js       JFP vocabulary + put-away payload
HQ/LibraryTab.js          door 1                (A)
HQ/StockViewTab.js        door 2                (A)
FinishingFloor/SetupQueue.js   the pull line    (B)
PickPack/PickPackApp.js   both adjustments      (D)
```

The two halves that actually move stock are **D's**, and neither was changed this week — the pick
and put-away behave exactly as they have since August. Anything proposed here that changes *when*
stock moves is a conversation with D before it is a commit.
