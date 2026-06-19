---
name: program-prints-asset-gallery
description: "Program Prints — hidden central PDF store (program_prints collection), uploaded via the 14.5 Batch Processor, pulled by a Print button across shop floor + master library"
metadata: 
  node_type: memory
  type: project
  originSessionId: a2e48ddc-d8eb-4cbc-91fa-488105e948d1
---

Central store for CNC program prints (drawings/PDFs), keyed by program NAME under a deterministic id `PRINT-{SAFENAME}` (re-upload overwrites). A "Print" button anywhere resolves by name.

**v1 was rejected** (2026-06-16): storing prints in `global_assets` + an upload card in the Asset Gallery cluttered the gallery with thumbnail-less PDFs. Owner: "I absolutely hate this idea." Redesigned same day per [[no-regressions-ask-first]].

**v2 (current):**
- **Hidden store:** own collection `program_prints` (NOT `global_assets`), storage `program_prints/{SAFENAME}.pdf`. Gallery never shows prints; `AssetGalleryTab` also defensively filters out any legacy `category==='PROGRAM_PRINT'` docs left from v1.
- **Upload tool lives on the 14.5 Batch Processor** ([HQ.js:354](src/components/HQ/HQ.js) mounts `BatchImageProcessor`), via a new Images|Program-Prints mode toggle → renders `Shared/ProgramPrintUploader.js`.
- **PDF page-splitting:** one multi-page PDF → one single-page PDF per page. `pdf-lib` splits; `pdfjs-dist@3.11.174` (legacy build, CDN worker pinned to version) renders the page preview + reads the text label to auto-guess each name. Owner chose **auto-read + confirm each** (conveyor UI: preview + editable name, Save&Next / Skip / "Save all remaining"). Falls back to a blank name if a page has no text layer.
- **Print button sites:** all shop-floor sites (verification modal, scheduler, floor cards, Programs tab, routing op rows) + **master-library item detail panel** ([LibraryTab.js](src/components/HQ/LibraryTab.js), resolves by legacyErpId/itemName/itemId/programNum via `resolvePrintUrlAny`).

**Helper `Shared/programPrints.js`** is the single source of truth: `printKey`/`printSafe`/`printDocId`, `subscribeProgramPrints` (whole `program_prints` collection → name→doc Map), `fetchProgramPrint`, `programPrintExists`, `uploadProgramPrint`, `saveProgramPrint`, `resolvePrintUrl`, `resolvePrintUrlAny`. ShopFloor subscribes → printMap passed to ShopEngineering; LibraryTab subscribes itself. Legacy `shop_programs.drawingUrl` kept as fallback in resolve, so existing programs work with no migration; new program-drawing uploads dual-write a print via `saveProgramPrint`.

**Status:** v2 SHIPPED to prod 2026-06-16 — merged to `main` (fast-forward `7820ca8..c62b732`) → Vercel/4cosworkcenter.com. Added deps: `pdf-lib`, `pdfjs-dist@3.11.174`. Owner confirmed upload works after the rule went live. v1 orphans in `global_assets` (category PROGRAM_PRINT) + `global_assets/prints/` storage are harmless, can be purged later.

**Gotcha — Firestore rules are an explicit per-collection allowlist with default-deny** ([firestore.rules](firestore.rules), ends "Anything not explicitly listed above is denied"). The new `program_prints` collection threw `Missing or insufficient permissions` on first write until a `match /program_prints/{document=**} { allow read, write: if isAuth(); }` line was added. Rules are PROJECT-WIDE (`ce-m2c-design-collab`, shared prod+preview) and deploy SEPARATELY from the Vercel app (owner published via Firebase console; repo file also updated). Any NEW collection needs a rule line or writes silently fail.
