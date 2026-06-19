# Program Prints in the Asset Gallery — Spec

**Goal:** Store every CNC program print (drawing/PDF) once, centrally in the Asset Gallery, keyed by the **program name (== the item/part file name)**. Then a **"Print"** button anywhere — especially the Shop Floor — resolves the print by that name and opens it. Replaces today's scattered, per-program `drawingUrl`.

---

## Current state (from scan)

- Assets live in **`global_assets`** (Firestore). Doc fields: `id`, `name` (uppercased), `patternId`, `finishId`, `associatedParts[]` (Approved_Designs ids), `originalUrl` (hi-res/openable), `thumbnailUrl`/`url`, `category`, `brandId`, `createdAt` (`AssetGalleryTab.js:283-298`, `BatchImageProcessor.js:218-236`). Doc ids are **timestamp-unique**, so the same name can duplicate.
- Uploaders are **image-only** today: `BatchImageProcessor` and `AssetGalleryTab.handleUpload` accept `image/png,jpeg` and run every file through a `<canvas>` watermark (`AssetGalleryTab.js:160-198,391`) — **a PDF won't load through that path.** `BatchTextureProcessor` is finish-keyed and image-only — *not* the right tool for prints despite "texture processor" naming.
- Retrieval today = full-collection `onSnapshot` + client-side name/substring filter (`AssetGalleryTab.js:64-155`); the structured pattern is `RTGDispatchTab.loadAssetMap` (`:270-279`) mapping `associatedParts`→url.
- Shop Floor **already mounts the Asset Gallery** (`ShopFloor.js:12,981`). The only existing print field is `shop_programs.drawingUrl`, uploaded to Storage `drawings/{name}.pdf` (`ShopEngineering.js:128-130`), surfaced only on program cards (`:499`). Program **`name`** is the doc id and the human name; routings reference it as `op.progId`/`op.name`/`progName`.

---

## Data model

Reuse `global_assets` with a print discriminator:

```js
global_assets/PRINT-{SAFENAME}   // deterministic id → re-upload overwrites, no dupes
{
  id: "PRINT-{SAFENAME}",
  category: "PROGRAM_PRINT",      // <-- filter key
  name: "{PROGRAM NAME, UPPERCASE}",   // == item/program file name; the lookup key
  originalUrl: "<storage url to the PDF/image>",
  fileType: "pdf" | "image",
  associatedParts: [ ...optional Approved_Designs ids... ],
  brandId, uploadedBy, createdAt, updatedAt
}
```

- **Deterministic doc id** `PRINT-{sanitized name}` (mirror `cleanId`, `ShopEngineering.js:9`) so re-uploading the same program name **overwrites** rather than duplicating — this gives the "saved under the same file name" behavior the owner wants.
- `name` uppercased to match how the gallery stores names and how shop program names compare.

---

## Upload (honor "upload it here")

Add a **"Program Prints"** upload mode in the Asset Gallery (not the texture processor — that one is finish-locked/image-only). In that mode:
1. Accept **PDF and image** (`accept="application/pdf,image/*"`).
2. **Branch around the watermark/canvas** for non-images — upload the raw file straight to Storage (the raw-file fallback already exists at `AssetGalleryTab.js:276-279`). Storage path `global_assets/prints/{brandFolder}/{SAFENAME}.{ext}`.
3. Name field = the **program/item name** (the owner types it or it's parsed from the filename, which already equals the program name). Write the doc with the deterministic id above, `category:'PROGRAM_PRINT'`.
4. Optional: a bulk mode that takes a folder of files named by program and stamps them all (filename → name), since prints are many.

---

## The "Print" button (resolve by program name)

One reusable helper, used everywhere:

```js
// returns the newest PROGRAM_PRINT asset whose name matches, or null
function findProgramPrint(assets, programName) {
  const key = String(programName || '').toUpperCase().trim();
  return assets
    .filter(a => a.category === 'PROGRAM_PRINT' && String(a.name).toUpperCase() === key)
    .sort((a,b) => (b.createdAt?.toMillis?.()||0) - (a.createdAt?.toMillis?.()||0))[0] || null;
}
// Print button onClick: const p = findProgramPrint(assets, prog.name); if (p) window.open(p.originalUrl,'_blank');
```

(Mirrors the existing open behavior at `AssetGalleryTab.js:579`.) Assets are already loaded via `onSnapshot` in the relevant tabs, so no new fetch is needed; otherwise use the `getDocs(collection(db,'global_assets'))` one-shot like `RTGDispatchTab:270`.

**Button sites (program name in scope at each):**
| Site | File:line | Resolver input |
|---|---|---|
| Programs tab cards (replace "View Drawing") | `ShopEngineering.js:499` | `p.name` |
| First-Part Verification modal (best for operators) | `ShopFloor.js:383-394` | `modalData.prog.name` |
| Scheduler Active Tracker rows | `ShopFloor.js:519-554` | `programsMap[t.prog]?.name` |
| Floor machine job cards | `ShopFloor.js:450-456` | `programsMap[j.prog]?.name` |
| Routings op rows | `ShopEngineering.js:385-400` | `op.name` |

Show the button as enabled only when `findProgramPrint` returns a match (greyed/"No print on file" otherwise).

---

## Migration & cleanup

- **Backfill:** one-time pass over `shop_programs` with a `drawingUrl` → create `PRINT-{name}` assets, then treat `global_assets` as the single source. Keep reading `drawingUrl` as a fallback in `findProgramPrint` during transition.
- Point the program editor's drawing upload at the new gallery flow so new prints land centrally instead of in `drawings/{name}.pdf`.

---

## Caveats

1. **`FloorAssetViewer` reads a *different* Firestore instance** (`finishingDb`, `FloorAssetViewer.js:2`). Shop Floor uses the HQ `db`, so prints written to HQ `global_assets` work on Shop Floor. If prints must also appear on the **Finishing** floor viewer, write to both instances or move to a shared one.
2. **PDF preview** isn't supported by the gallery's image grid; for prints, the card should show a PDF/file icon + a "Print/Open" action rather than a thumbnail (or render the first page to a thumbnail later).
3. Deterministic ids mean re-upload overwrites — intended — but warn before overwriting an existing `PRINT-{name}`.
4. Keep `name` normalization (uppercase/trim) identical on write and lookup, or matches silently fail.

---

## Build order

1. Add `category:'PROGRAM_PRINT'` upload mode (PDF-capable, deterministic id) to the Asset Gallery.
2. Add `findProgramPrint` helper + the Print button at the Programs tab and the Verification modal (highest value) first.
3. Roll the button out to scheduler/floor/routings sites.
4. Backfill from `shop_programs.drawingUrl`; redirect the program editor's upload.
