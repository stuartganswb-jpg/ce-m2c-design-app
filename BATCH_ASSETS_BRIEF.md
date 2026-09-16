# BRIEF — Teach Tabs 14 (Asset Gallery) & 14.5 (Batch Processor) the Fabricut CPQ Logic

> Paste this whole file as the first message of a NEW Claude session in
> `/Users/stuartgansmba/Projects/ce-m2c-design-app`. It is self-contained.

## Mission

HQ **tab 14 "Asset Gallery"** (`src/components/Shared/AssetGalleryTab.js`, ~700 lines) and
**tab 14.5 "Batch Processor"** (`src/components/Shared/BatchImageProcessor.js`, ~513 lines) are the
image upload/tag/search tools. They pre-date the Fabricut H1 rollout and know nothing about its item
model. Update them so Stuart can **upload and tag Fabricut assets that resolve, display, and search
correctly** — especially the plate rule: **every bracket arm includes a standard backplate; the
coverplate is a paid upgrade**. Both tabs mount in `src/components/HQ/HQ.js` (lines ~437–438,
lazy-imported at ~31–32); tab 14.6 Texture Processor is out of scope.

**Scope guard:** another session resumes the CPQ flow work (1-3/8" item additions) tomorrow. Do NOT
edit any CPQ/flow/generator files — see "Files you may not touch" at the bottom. Your edits should
land in the two tab files above plus, if needed, a NEW small helper under `src/components/Shared/`.
If you need identity logic, **import it from `Shared/sizeMatrix.js` / read patterns from
`Shared/fabricutImport.js` — never re-implement or edit them.**

## Ground rules (multi-session repo — non-negotiable)

- **Never `git checkout` / switch branches** in this checkout. Commit small fix-forward changes on
  `main`. Stage ONLY files you changed (never `git add -A`).
- Ship flow: `rm -f .git/index.lock` → `git add <your files>` → commit →
  `git pull --rebase --autostash origin main` → `git push origin main`. Vercel auto-deploys; Stuart
  hard-refreshes (⌘⇧R).
- `npx --no-install eslint <file>` must report **0 errors** before committing.
- Firestore enforces **App Check** — no local/Node scripts against prod data. Anything bulk happens
  inside the authenticated app UI.
- Full build check when done: `CI=false npx --no-install react-scripts build`.

## The Fabricut H1 item model (what the tools must understand)

All of this is LIVE in production CPQ. Ground truth in code:
`src/components/Shared/sizeMatrix.js` (size families/resolvers),
`src/components/Shared/fabricutImport.js` (code grammar, species, tiers),
`src/components/Shared/priceLevels.js` (fabricut codes + price tiers),
`src/components/Shared/assemblyTags.js` (**the locked tag vocabulary — never invent tags**).
Read them; import from them; do not modify them.

### 1 · Code grammar

- Item numbers: `H1-{dia}{STYLE}{proj}` where **dia** = `75` (¾"), `1` (1"), `138` (1-3/8") and
  **proj** = `S` (3-5/8"), `E` (4-5/8"), `6` (6") — e.g. `H1-75CBRE`, `H1-1CBR6`.
- **`R` collection marker**: `H1-75R-JNR`'s R means ROUND collection (there is a separate ¾" SQUARE
  `H1-75S` collection). The importer strips a leading `R-` from the style, so `H1-75R-JNR` ≡ style
  `JNR`. Expect codes both ways when matching.
- Plates: `H1-{dia}{BP|CP|RBP|RCP}-{style}` — BP = backplate, CP = coverplate, RBP/RCP = the
  return-specific plates that exist **only at ¾"** (at 1"/1-3/8" returns use standard BP/CP).
- Finish variants are **separate library docs**: base (mill, unpriced) + `/P` (shared painted) +
  `/EP1..EP6` (exact plated). Note `EP01 → EP1` normalization already exists in the batch processor.
- **Species** (wood/acrylic): one Fabricut product, the FINISH picks the species. Finish docs carry
  `bomSuffix` (`-O` white oak, `-W` walnut) → BOM consumes `${base}-O` / `${base}-W` docs; a few are
  stem-different via `customData.speciesMap` (e.g. `H1-138WR` → `H1-138WHTOAK` / `H1-138WLNUT`).
- Poles are by-the-foot items (`H1-75R`, `H1-1R`, `H1-138R`, wood `H1-138WHTOAK`/`H1-138WLNUT`);
  joiners end `-JNR`.

### 2 · Size identity chain (why one photo can serve several SKUs)

Library docs carry `manufacturingSpecs.customData.sizeKey = { family:'H1-RND', style, dia, proj }`.
`Shared/sizeMatrix.js` exports `buildSizeIndex` / `sizeVariantOf` which resolve any part to its
sibling at another diameter/projection (RBP→BP / RCP→CP collapse at dia≠75; missing → base
fallback). The ¾" (75) doc is the flow-linked "base"; 1" and 1-3/8" docs are size variants of it.
**Implication for assets:** an upload tagged to the base pattern should be discoverable from every
size sibling (same geometry, scaled render), while size-native parts only exist at their own
diameter. Use the sizeKey chain — don't string-guess sibling codes.

### 3 · THE PLATE RULE (the thing Stuart explicitly wants these tabs to reflect)

- A bracket **arm's price already includes its standard backplate (BP)** — BP variants are $0/null
  by design. In CPQ the backplate renders as a sub-line beneath the arm.
- The **coverplate (CP) is a flat-price UPGRADE** (≈$10 cost / $40 retail via
  `Shared/priceLevels.js` tiers), its own selectable part with its own image.
- Which plate pairs with which arm comes from the **3 plate pools + end-arm/inl-bkt tags in
  `Shared/assemblyTags.js`** — that file is the ONLY tag vocabulary; use its exported constants.
- For the gallery this means: an arm's product image *is* arm+backplate; tag/badge arm assets as
  "includes backplate · coverplate upgrade available", and make CP assets findable from the arm
  (associatedParts or a tag), not modeled as if the arm ships bare.

### 4 · Fabricut catalog codes

Base library docs store the Fabricut pattern codes under `manufacturingSpecs.fabricut` (per-level
codes; `fabCodeBase` for single-finish items) — see `Shared/priceLevels.js` (`fabricutCodeOf`).
Search should match these too: typing a Fabricut catalog code in the gallery should find the asset
tagged with our CE `patternId`.

## What the two tools do today (so you extend, not rediscover)

**BatchImageProcessor.js (tab 14.5)** — a conveyor: drop N images → for each, type
`patternId` + `finishId` + collection/productType/notes/associatedParts/associatedFinishes →
watermarked hi-res + thumb to Storage (`global_assets/hires|thumbs/<brand>/…`) → doc in
**`global_assets`** (id `ASSET-<brand>-<PATTERN>_<FINISH>-<ts>-<rand>`; fields around line 220:
`patternId, finishId, customerId, clientSku, name (PATTERN/FINISH), collection, productType, notes,
associatedParts[], associatedFinishes[], originalUrl, thumbnailUrl, url, brandId, uploadedBy`).
EP zero-pad normalization at ~line 184. Part suggestions match `legacyErpId.includes(patternId)`
(~line 268). Reads `Approved_Designs`, `hq_collections`, `system/master_lists`, the three finish
collections. Also hosts the 'prints' mode (ProgramPrintUploader) — leave that alone.

**AssetGalleryTab.js (tab 14)** — browses `global_assets` (100-card cap), text search across
`name/patternId/finishId/customerId/clientSku/collection/productType/notes` + a JSON-stringify match
over `associatedParts` (~lines 135–156). Edit-metadata modal writes back the same fields. Category
chips come from `collection`/`productType`.

## Suggested work items (Stuart's ask, decomposed — confirm/adjust with him)

1. **Fabricut-aware pattern resolution in 14.5**: when `patternId` is a Fabricut/H1 code, resolve it
   against the library — strip `/P`//`EPn` to base, tolerate the `R-` style marker, recognize
   species suffixes (`-O`/`-W`) and plate codes — and auto-fill collection/productType +
   `associatedParts` from the matched doc (and its size siblings via the sizeKey chain) instead of
   relying on free-text `includes()`.
2. **Auto-tags on the asset doc**: stamp diameter (`3/4"`, `1"`, `1-3/8"`), projection (`3-5/8"`,
   `4-5/8"`, `6"`), species, and role tags (arm / backplate / coverplate / return / pole / finial /
   ring, from `assemblyTags.js` pools) into a new `tags[]` (or structured `fab{}`) field on
   `global_assets` — additive, so existing docs keep working.
3. **Plate-rule surfacing**: arm assets get "includes backplate — CP upgrade" metadata/badge; CP
   assets link back to their arms (associatedParts both ways where derivable from the plate pools).
4. **Gallery search/filter in 14**: match the new tags + the doc's Fabricut catalog codes
   (resolve `patternId` → library doc → `manufacturingSpecs.fabricut` codes); optional filter chips
   for diameter/projection/role so "show me all 1-3/8" arms" works.
5. **Backfill**: an in-app "re-tag existing Fabricut assets" button (App Check ⇒ must run in-app)
   that walks `global_assets`, re-resolves each `patternId`, and stamps the new tags.

## Files you may NOT touch (other sessions own them)

`HQ/CPQTab.js`, `HQ/AdminTab.js`, `HQ/ERPPushPullTab.js`, `HQ/VisionHardware.js`,
`HQ/LibraryTab.js`, `HQ/LibraryMassUpdateTab.js`, `HQ/NetSuiteSyncTab.js`, `HQ/StockViewTab.js`,
`PickPack/PickPackApp.js`, `Shared/sizeMatrix.js`, `Shared/fabricutImport.js`,
`Shared/priceLevels.js`, `Shared/assemblyTags.js` (import-only), `SpecSheet/*`,
`Shared/FormPreview.js`, `HQ/ExternalCoopTab.js`, `Shared/ProgramPrintUploader.js`.
Your surface: `Shared/AssetGalleryTab.js`, `Shared/BatchImageProcessor.js`, plus at most a new
`Shared/` helper (e.g. `Shared/fabricutAssetTags.js`) and its imports in those two files.

Start by reading the four ground-truth Shared files and the two tab files, then present Stuart a
short plan (the 5 work items above, sized) before writing code.
