---
name: multi-image-views
description: Multiple images per item — Asset Gallery multi-file upload + master-library card carousel of all views (front/side/angle)
metadata: 
  node_type: memory
  type: project
  originSessionId: a2e48ddc-d8eb-4cbc-91fa-488105e948d1
---

Lets one inventory item carry several photos (front/side/angle) and flip through them on its master-library card.

**Files:**
- `Shared/AssetGalleryTab.js` — upload file input is now `multiple`; `handleUpload` loops `uploadFiles`, each view uploaded as its own `global_assets` doc sharing the same pattern/finish + `associatedParts`. "N views selected" hint.
- `HQ/LibraryTab.js` — module-level `PartCardImage` carousel on each item card (‹ › arrows + 📷 N/N badge, arrow clicks `stopPropagation` so they don't open the detail panel). Subscribes to all `global_assets`, builds two maps: `assetsByPF` ("PATTERN|FINISH"→urls, the same match that sets finalImageUrl) and `assetsById` (associatedParts→urls). Per card, images = dedupe([finalImageUrl cover, pattern/finish matches, explicit links]). One/zero images → unchanged single-image / "No Image" / "🧊 3D CAD".

**No new firestore rule** (reuses `global_assets`, already allowed). Brand note: LibraryTab is brand-scoped (shows activeBrand's parts) but the image match is by code, not brand.

**Status:** built 2026-06-16, build+lint clean, on branch `feat/multi-image-views` (off main, commit 82b7265), preview pushed, isolated (1 commit on main, nothing else). NOT merged to prod. **AWAITING USER TESTING — paused 2026-06-16, revisit in a few days (≈2026-06-19+); user needs to prep images first.**

**Preview:** ce-m2c-design-app-git-feat-multi-image-views-m2-c-ce-design-app.vercel.app
**Test:** (A) Asset Gallery → upload panel → select several images at once, set Pattern/Finish (optionally link the part), Upload → all upload. (B) Master Library → that item's card shows arrows + 📷 N/N; flip through views. Related: [[cpq-combo-photos]] (the other pending preview branch).
