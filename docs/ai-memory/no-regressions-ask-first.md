---
name: no-regressions-ask-first
description: Never regress working features or lose work; ask before any action that could go backwards
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 16514794-a0fe-4468-ad5a-b6fab28bf535
---

Stuart's standing rule (given 2026-06-14): **do not go backwards — ask me if anything.** Never regress a working feature, overwrite/revert good code, drop a working behavior, or delete a branch/data without an explicit go-ahead. When unsure whether something could lose progress, ask first.

**Why:** this is a live production PLM app (4cosworkcenter.com) where many tabs share the same files and Firestore docs (window_config, nodeClusters, CPQ flows, VisionHardware, assembly_pins) — a careless or "clever" rewrite can silently break a flow that already works. Forward progress only.

**How to apply:**
- Keep the **preview-first** workflow: feature branch → Vercel preview → Stuart tests → merge to prod only on his say-so. Never push straight to prod or delete branches/data unprompted.
- Prefer **additive, guarded** changes over rewrites; don't remove/replace existing working behavior without flagging it and confirming.
- Before any destructive/irreversible step (branch delete, doc overwrite, schema change, reverting), call it out and wait for a yes.
- The current **region-grouped Hide-Geometry** in AdminTab's CPQ Flow Builder (clusters grouped by Location/Position with node thumbnails + parent region toggles) is **canonical** — Stuart confirmed 2026-06-14. Build CPQ-flow changes *additively on top of* the current prod version; never reintroduce the old flat checklist.
