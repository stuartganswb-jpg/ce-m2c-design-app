---
name: cpq-combo-photos
description: "Combined wallplate+bracket product photos — hidden combo_images store, recorded on the 14.5 Batch Processor, pulled into the CPQ checkout doc roll-up"
metadata: 
  node_type: memory
  type: project
  originSessionId: a2e48ddc-d8eb-4cbc-91fa-488105e948d1
---

A single photo showing TWO configured pieces together (bracket + its wallplate/backplate, each at a finish), pulled into the CPQ checkout "doc roll-up" as the final page. First step toward the future goal: a client presenter that gathers finished photography for a configuration.

**Recording:** hidden `combo_images` collection (like [[program-prints-asset-gallery]]). One photo per pair, keyed by a CANONICAL order-independent key `PATTERN/FINISH_PATTERN/FINISH` (each piece normalized, EP01=EP1, the two sorted, joined by `_`). Recorded by naming the file that way and dropping it into the **14.5 Batch Processor → "Combination Photos"** mode (`Shared/ComboImageUploader.js`, parses the filename → two pieces → bulk save). Helper `Shared/comboImages.js` owns parse/key/subscribe/upload/match.

**Pull (frozen-as-sold):** CPQ subscribes to combo_images → comboMap. In `CPQTab.handleAddToCart`, resolve each flow step's bracket (`dynamicConfigParams[stepId]` → styleOption.partId → part.legacyErpId pattern) + its wallplate/backplate (`[stepId+'__sub']` → subOption.partId) to `{pattern, finish}` (finish = step's `[stepId+'__finish']` code; both pieces share the step finish). `matchCombosForPieces` returns combos whose BOTH pieces are configured; their urls are stored on the cart item as `productPhotography` (so they don't depend on the viewer's db — ConfiguredItemViewer just renders them as the last `flex 1 1 100%` page).

**Key CPQ facts:** selection state = `dynamicConfigParams` keyed by stepId (+`__sub`, +`__finish`); part = `[...libraryParts, ...liveAssemblies].find(p=>p.id===partId)`; finish = `[...globalFinishes,...outsourceFinishes,...dynamicAssets].find(f=>f.id===finId).code`. Reference flow: **Flat Iron Vision Hardware Board** (wallplate/backplate is the bracket step's `__sub`, picked 2nd). Pattern taken as `legacyErpId.split('/')[0]` so it works whether legacyErpId is base or finished.

**macOS filename gotcha (fixed):** Finder stores a typed `/` as `:` in the real filename, so a file named `H1-138BP-H/EP1_...` arrives as `H1-138BP-H:EP1_...`. `parsePiece` accepts `/` OR `:`; the uploader shows `:` back as `/`. Verified typed/mac-stored/reversed/EP01==EP1 all yield one canonical key.

**Status:** built 2026-06-16 on branch `feat/cpq-combo-photos` (off main), build+lint clean, preview pushed (latest `2bbdb38`, incl. the macOS fix). NOT merged to prod. **AWAITING USER TESTING — paused 2026-06-16, revisit in a few days (≈2026-06-19+); user needs to prep the combo photos first.**

**Before testing:** publish the `combo_images` firestore.rules line (committed in repo + full block handed to user; rules deploy separately from the app — same gotcha as program_prints) or the uploader Save throws permission-denied.

**Preview:** ce-m2c-design-app-git-feat-cpq-combo-photos-m2-c-ce-design-app.vercel.app
**Test:** (A) 14.5 Batch Processor → "Combination Photos" → drop files named PART/FINISH_PART/FINISH → pieces parse to chips → Save. (B) CPQ → configure bracket + its wallplate/backplate sub-pick at that finish (Flat Iron Vision Hardware Board in the `ce` brand) → Add to Cart → open doc roll-up → combo is the last "Product Photography" page. If it doesn't show = code mismatch (part legacyErpId pattern + finish code must equal the filename pieces).

**Both pending previews merge independently on top of current main:** this + [[multi-image-views]]. Ask which to push when the user returns.
