# Rod Piece Inventory (Offcut Sub-Ledger) — Session Brief

> **STATUS 2026-08-27: BUILT (v1 shipped from the CPQ session — no separate session needed).**
> Engine `Shared/rodPieces.js` (+ `scripts/rodPieces.test.mjs`, 45 green), writes
> `Shared/rodPieceLedger.js`, UI `Shared/RodPieceInventory.js` (HQ 6.5 "Rod Piece Stock" tool +
> shop Custom-tab shelf + `RodCutPanel` on the custom card), piece label in `Shared/labelPrint.js`,
> `rod_pieces` rule added to firestore.rules (**rules deploy still pending — Cloud Shell**).
> This brief remains as the design record.

*Written 2026-08-27 by the CPQ/spec-sheet session, dictated by Stuart. This is its OWN project —
"a fairly big job that warrants its own [session]". Scope: everything sold BY THE FOOT — poles,
rods, traverse rods/fascia. Read APP_ARCHITECTURE_BRIEF.md §4 first; §0 below is the operating
manual every session needs.*

---

## 0. Operating the session (copied from the working sessions — reuse it)

- **Pin-in workflow**: Stuart pins you into the live app via **Claude-in-Chrome** (his Chrome, his
  logins — NOT the preview pane). `tabs_context_mcp` first; drive by `find`→ref, not coordinates.
  Two gates: Factory Portal (email+password) then **Enterprise PLM PIN on every /hq load** — Stuart
  types both; you navigate to the gate and tell him it's up. Auth survives SPA tab-switching, NOT
  reloads.
- **Vercel auto-deploys on push to main.** Verify with `curl -s https://www.4cosworkcenter.com/version.json`
  (ms epoch vs your commit time) AND a **string-LITERAL** marker grep of the live bundle (comments
  are minified away — that mistake keeps being made). Lazy tabs live in chunks — sweep every file in
  `/asset-manifest.json`, not just `main.*.js`. Stale-build trap: see CLAUDE.md (redeploy without
  build cache). User must hard-refresh (⌘⇧R) after deploy.
- **Firestore enforces App Check** — NO local script can touch prod data. Bulk data ops = an admin
  button inside the authenticated app.
- **Multi-session git**: never switch branches in the shared checkout; stage ONLY your files;
  `git pull --rebase --autostash` before push; fix-forward on main.
- Offline test suites live in `scripts/*.test.mjs` (`node scripts/<name>.test.mjs`) — build one for
  the recommendation engine; it's the fast loop.

---

## 1. The problem (Stuart's words, 2026-08-27)

> "We stock and purchase these rods in set lengths typically 12, 20 or 22 ft. We then sell them by
> the foot but of course this leaves us with tons of off cuts and in a few months our pristine
> inventory count will be worthless as it will be showing 200 ft available but in reality it will be
> made up of lots of small off cut lengths that may or may not be useable — if we have 3 pc at 3 ft
> we can not sell that as a 9 ft pole."

Aggregate feet is the wrong unit for availability. The system of record (NetSuite) can keep feet;
the app needs a **piece-level sub-ledger** so 200 ft reads as "1 × 20 ft full + 12 offcuts, longest
7 ft" — which is the number that actually answers "can we cut a 9 ft pole today?".

## 2. What Stuart asked for (the spec, near-verbatim)

1. **Receiving in pieces**: "we receive in 100 pcs which equals 1200 ft." Stock arrives as N pieces
   of a set length. Full, uncut pieces are NOT individually labelled — they are a count on a shelf.
2. **Setup lives on the tooling tab (6.5 Tools, Specs & FAQs)**: add a **"piece length"** field per
   rod item/family (typical values 12, 20, 22 ft). This is the mechanism for declaring how an item
   is stocked.
3. **First stop for poles on a work order is CUSTOM on the shop floor** — that is where the cut
   happens (already true today: `shop_custom_orders` carry `cutLength`/`cutList`). The piece
   workflow hangs off the cut station:
   - Operator pulls a rod (full or offcut), cuts the order.
   - A **label with a piece #** is generated and applied to the REMAINING pole — that is the moment
     a piece enters the ledger. (Full shelf stock stays unlabelled; only remainders get identity.)
   - If the remainder is too short to be useful, the operator marks it **scrap** instead.
4. **A simple inventory screen** of all poles and their piece lengths — visible from the SHOP and
   from HQ (same data, two vantage points).
5. **A recommendation tool at the floor**: as orders arrive, check the order's cut length against
   all current pieces of that item and recommend which to use — grab an existing piece or take a
   new full rod.
6. **The rule**: *"always use the cuts when possible — it is better to use a 7 ft rod for a 6 ft
   order than to cut a new rod, as long as the waste factor is under 18 in."*

### The rules, SETTLED with Stuart 2026-08-27 (his examples verbatim — build to these)
- **The waste rule (18 in is a hard cap on scrap, 36 in is the minimum usable piece).** His
  examples: an 8 ft (96") piece on the shelf —
  - order for **72"** → remainder would be 24" (unusable: under 36", and over the 18" waste cap)
    → **cut from a NEW rod**, leave the 96" piece alone.
  - order for **80"** → remainder 16" ≤ 18" → **use the piece, scrap the 16"** (round to foot for
    the NS adjustment).

  So per candidate offcut, compute `rem = pieceLen − cutLen`:
  - `rem ≥ 36"` → piece is usable: cut from it, remainder gets a new piece # and stays in the
    ledger (this is the "always use the cuts when possible" half — a 120" piece serves a 72" order
    and leaves a 48" piece).
  - `rem ≤ 18"` → use the piece and SCRAP the remainder (waste is acceptable).
  - `18" < rem < 36"` → the dead zone: remainder would be unusable and the waste too big →
    **do not use this piece**; prefer another piece or a new full rod.
  - Standing sweep: **any piece under 36" is scrap**, whenever it appears.
  - Ranking among usable candidates: prefer the piece that consumes best (least leftover ledger
    length / a ≤18" full-consume beats opening a big piece) — engine detail, keep it in the pure
    module with tests over his two examples above.
- **NetSuite stays feet-based; the app owns piece truth. Scrap posts an NS inventory adjustment**
  (round to foot) — same staged-outbox pattern as the existing rod-cut flow's 2-line acct 254
  adjustment (memory `rod-cuts-wms`).
- **Scope: everything classified rod/pole/fascia — one set of rules/tools for anything "marked
  rod, pole, etc."** Drive it off item classification (productType/tags), not a hand-picked list.
- **Multi-piece orders (LEFT/CENTER/RIGHT)**: straight cuts (splice joints) → match each cut
  **independently** against the ledger. **Miter cuts at an angle → cut ALL pieces from ONE rod**
  so they match — the recommendation must treat a mitered multi-cut order as one combined length
  against one source.
- SETTLED 2026-08-27 (same day, built in the CPQ session): **brand scoping** — pieces are stamped
  with a brand and recommendations only offer the order's brand (matches the NetSuite
  subsidiary/location split). **Scrap rounding** — feet round UP (16" → 2 ft): conservative, the
  count may only ever understate the shelf.

## 3. Proposed shape (for the next session to refine, not gospel)

**Config (6.5 Tools tab)** — follow the registry pattern already there: 6.5 stores per-rod facts in
`system/bracket_span_map` (`{map, caps}` keyed by rod id, live-edited in `HQ/ToolsSpecsTab.js`).
Add a parallel doc, e.g. `system/rod_stock_config`: `{ [itemId]: { pieceLengthFt: 12|20|22, … } }`.
The 6.5 tab is a REGISTRY of tools by design ("the bracket-span guide is the first of several
tools") — this is literally the second tool it was built to receive.

**Piece ledger** — new collection, e.g. `rod_pieces`:
```
{ id: <piece#>,            // short, printable, barcode-able (e.g. P-810-0042)
  itemId / legacyErpId,    // the rod item (canonical identity — memory canonical-item-identity)
  brand, lengthIn,         // current usable length
  status: OFFCUT | SCRAP | CONSUMED,
  bornOf: { orderRef, fromPieceId|FULL, cutLength, at, by },
  history: [ {cutLength, orderRef, at, by}… ] }
```
Full uncut stock is NOT in this collection (unlabelled shelf count = NS feet ÷ pieceLength); a
piece doc is born the first time a rod is cut with a usable remainder.

**Cut station flow (ShopFloor custom card)** — the card already renders `cutList` + cut sheet. Add:
- On card open / Start: the **recommendation panel** — pieces of this item sorted per the rule,
  "USE PIECE P-810-0042 (7 ft — 12 in waste)" vs "CUT NEW 12 ft ROD".
- On Complete (or a dedicated "log the cut" action): operator confirms which source was used →
  ledger writes: consume/shrink the piece (or create one from a full rod's remainder) → offer
  **scrap** when remainder < 18 in → print the **piece label** (extend `Shared/labelPrint.js` —
  `printRodLabels` and `code128BSvg` barcodes already exist; 2"×4" stock).

**Inventory screen** — one component, two mounts (shop + HQ), like Pick status spans screens today.
Rows: item → pieces (length, piece#, age, born-of), plus the honest availability line: "NS says
200 ft · longest single piece 7 ft". Candidate homes: a panel on WMS/Pick ("ROD CUTS" tab already
exists in PickPackApp) and a section in 12.5 Stock View or its own HQ tab-slot.

**Recommendation engine** — a pure module (`Shared/rodPieces.js`) + offline test file
(`scripts/rodPieces.test.mjs`), same style as `Shared/finishedGoodsRun`/`hardwareModel`: input
(cutLength(s), pieces[], pieceLengthFt) → ranked suggestions + waste math + scrap flags. Keep ALL
policy (the 18 in rule) in this one module so the rule is testable and changeable in one place.

## 4. What already exists (don't rebuild it)

- **Cut lengths already flow to the floor**: CPQ per-foot lines carry `perFoot/feet` (money) and
  `cutLength` (physical, per piece, never multiplied) — `Shared/hardwareHandoff.js`; RTG split puts
  `cutLength`/`cutList` on `shop_custom_orders` (`HQ/RTGDispatchTab.js`); the shop custom card
  (`ShopFloor/ShopFloor.js` CustomCard) renders cut sheet + BUILD × N banner (config qty multiplies
  counts, never lengths).
- **A rod-cut mini-flow exists for STOCK cuts**: Sales Snapshot ✂ on 8 ft rods → `rod_cut_orders`
  → WMS ROD CUTS scan flow → 2-line NS adjustment acct 254 (`HQ/StockViewTab.js`,
  `PickPack/PickPackApp.js` ~1360-1400). Different purpose (cutting stock into stocked shorter
  items), but it is the pattern for scan-confirmed cuts + NS adjustments — and the two flows must
  not double-count.
- **Labels**: `Shared/labelPrint.js` — `printRodLabels({orderRef,itemId,sidemark,length,count})`,
  `printStockItemLabels`, code128 barcodes, print-window plumbing.
- **6.5 registry** for per-rod config; **NetSuite writes** go through the proxy/`ns_outbox` staged
  worker (memory `netsuite-concurrency`, `rtg-netsuite-transmit`) — never direct.
- **Splice logic** (`flow.spliceOverInches`, mandatory over 120") decides how LONG orders ship in
  pieces — interacts with cut planning on multi-piece poles.

## 5. Key files
`HQ/ToolsSpecsTab.js` (6.5 registry — piece-length field home) · `ShopFloor/ShopFloor.js`
(CustomCard — cut station, recommendation panel + cut logging) · `HQ/RTGDispatchTab.js` (split:
cutList onto shop orders) · `Shared/hardwareHandoff.js` (perFoot/feet/cutLength contract) ·
`Shared/labelPrint.js` (piece labels) · `PickPack/PickPackApp.js` (ROD CUTS tab pattern, WMS home
for the inventory view) · `HQ/StockViewTab.js` (12.5 — HQ inventory vantage; existing ✂ flow) ·
`Shared/nsTransmit.js` + `functions/index.js` proxy (NS adjustments).

Memories: `rod-cuts-wms`, `canonical-item-identity`, `netsuite-concurrency`, `cpq-splice-checkout-scope`,
`fabricut-h1-rollout` (per-foot items), `traverse-generator-fork`.

## 6. Suggested build order
1. Rules are settled (§2) — only the two minor opens (brand scoping, scrap rounding) need a word.
2. `Shared/rodPieces.js` + offline tests — the rule, pure; pin Stuart's 72"/80" examples as tests.
3. 6.5 piece-length field (registry doc + editor row).
4. `rod_pieces` ledger + the cut-station panel on the shop custom card (recommend → confirm → label/scrap).
5. The inventory screen (shop + HQ mounts).
6. NS scrap adjustment via the staged outbox (last — app ledger works without it).
