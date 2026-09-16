# BRIMAR rebuild brief — fresh session, 2026-08-11

Read `CROSS_SESSION_CONTRACT.md` for environment/git/deploy rules. This brief is the complete
state of the Brimar incident (2026-08-09 → 08-10, ~8 hours), the DECISION, and the runbook.
Stuart's verdict, quoted: "just needed to add one item to an existing cpq flow and 8 hours later
we are no closer" — the decision is REBUILD BRIMAR CLEAN, and this brief exists so the rebuild
takes 45 minutes and none of the 8 hours repeats.

## 1. THE DECISION

**Rebuild the Brimar assembly from fresh per-part exports. Do not repair the merge further.**
The existing model (`CE-ASM-4367` · `assemblies%2Fce_BRIMAR_COMBINED_1786370319269.glb`) is a
monolith upload (root node `CPQBrimar1inCombinedAsse…`) with empty named husks baked in
(`body1`, `body1003`, … — names with no geometry), stacked Extends on top, and late-added
geometry (elbow, some caps) that is misplaced or absent. Every layer of repair tooling built this
weekend works — and what it ultimately proved is that the base data isn't worth repairing.

**The flow doc is KEPT** (`BRIMAR COMBINED — GENERATED`, rollup id 62184 already in NetSuite).
Rebuild the assembly → relink the flow → regenerate. Flow id unchanged ⇒ CRM/portal/quote links
survive. Some option prices may need re-entry (options carry over where identity matches).

## 2. FIRST FIX BEFORE THE REBUILD (real bug, small) — ✅ FIXED & SHIPPED `bd7a556` (2026-08-10)

> **Correction to the fix described below:** the first attempt (`c9e47f2`, prune the cluster
> record) could NOT work — Load Choices builds rows from the SCENE (`findGrp(cl)` →
> `grp.children`), not from the cluster record; Stuart's retest proved it. The real fix
> (`bd7a556`) filters at the scene walk itself: (1) unpinned names with NO mesh beneath them
> (empty husks) never list — loud "⛔ N empty named husk(s) NOT listed" line in the load log;
> (2) 🗑 on a pinless choice writes the name to the cluster's `excludedNodes`, which the walk
> honors on every Load. Pinned names always list. On the old Brimar record the CPQBrimar husk
> disappears from Load Choices automatically — no delete needed.

**Deleting a pinless choice from a multi-node cluster does nothing** — Stuart's resurrection
loop, confirmed by the alert "No saved pin docs existed … Load Choices will list it again while
the geometry exists." The 🗑 handler (`AssemblyBuilderTab.js`, `deleteChoice`) deletes pins and
offers cluster-record removal only when the row is the cluster's LAST choice. The
`CPQBrimar1inCombinedAsse` husk is the SECOND node of the `NEW-SLOT · FINIAL · RIGHT` cluster
(2 nodes), has zero pins, so: no pins to delete, cluster survives, row resurrects on every Load.
**Fix: when the deleted choice has no pins and the cluster has other choices, offer to remove
THE NODE from the cluster's `nodes` list** (updateDoc `nodeClusters`, same pattern as the
last-choice branch). That closes the loop for any assembly, including post-rebuild mistakes.

## 3. Forensic summary — what was proven, in order (all on-screen tools now)

1. Backplates always-on → generator flag collapse (explicit rtn-only beaten by inl-only) + CPQ's
   heal re-seeding cleared plates → FIXED (`7910534`), pool-scoped healing + explicit-wins.
2. Fake multi-diameter on a single flow → family classification by first stray pin + regenerate
   ignoring the single-assembly switch → FIXED (`c321d90`), visible Flow-mode switch + dominance.
3. 53 shredded map tokens → COMMAS INSIDE NODE NAMES vs comma-CSV maps → FIXED (`c9e3755`),
   nodeList pipe format + exact-key escape, dual-format readers, portal mirrored.
4. Finish color loss → my own exact-key over-application to list keys → FIXED same day (`d9855ab`).
5. Stale names surviving Load Choices → cluster records never rewritten → FIXED (`04c6a2a`),
   Save now reconciles rows AND cluster records against the loaded scene; loud status
   (`f5eeff4`): "ran: N renamed, M dropped" / FAILED / SKIPPED — in the save alert.
6. "Fork" hypothesis → DISPROVEN by identity lines (`b1242c6`): 1.6 and CPQ print doc id + model
   file; both read `CE-ASM-4367 · …319269.glb`. The Link-to-Master dropdown now shows
   doc id + file per option (`e0d6abf`) so a real fork can never hide.
7. The 0-renamed/25-missing paradox → EMPTY NAMED HUSKS (names exist, no meshes) → FIXED
   (`bd1abeb`): reconciliation and the ✗ chip are mesh-aware. Strip attribution (`c320187`)
   names each ghost's owning step/option.
8. REMAINING on Brimar after all of it: ~24 `body*` ghosts owned by bracket options, elbow
   geometry absent-or-misplaced at the ends (a floating cap was visible in one render), and the
   §2 delete bug. This is model-content damage → hence the rebuild decision.

## 4. THE REBUILD RUNBOOK (~45 min with current tooling)

**Designer prep (the one thing that matters most):** export ONE .glb PER SLOT (per part-group),
all from the SAME Fusion document origin so they land aligned — never a whole-assembly export
into one slot (that's what created the root-node husk mess). Component names = exact item codes.

1. **1.6 → new build** (do NOT Extend the old record): name it `BRIMAR COMBINED V2` during build
   (rename display later if wanted — never reuse the exact old name while both exist; the fork
   guard warns). Upload each slot; the **match gate** reports "N of M matched" per file — resolve
   every unmatched name BEFORE continuing; add **designer notes** per choice as you go.
2. Assign item #s (Load Choices): notes are there; ✗ chips (mesh-aware) must be ZERO on a fresh
   build — if any appear, the export is wrong, stop and re-export rather than rebind.
3. **Save** → alert must read "reconciliation ran: 0 renamed, 0 dropped" (a fresh build has
   nothing stale — anything else means a bad upload). Set flags: HUSCBPSTA plates = rtn-only
   ONLY (not inl-only — the both-flags contradiction started the backplate saga).
4. **Flow relink**: System Admin → CPQ Flows → `BRIMAR COMBINED — GENERATED` → first panel
   "File Cabinet Link (Master Assembly)" → pick the V2 record (options show doc id + model
   file). Flow mode: **Single assembly**. → **↻ Regenerate**.
5. **CPQ check**: red strip EMPTY (if not, it names the owner); french return gates the
   backplates; both elbows/caps render on their own ends; HIGHLIGHT to spot-check ownership.
6. Retire the old record: leave `CE-ASM-4367` in place (never delete — pin history), mark its
   itemName with `(RETIRED — see V2)`.

## 5. What this rehearsed (the actual point)

The H1-138 designer upload (single + double + traverse = 3 assemblies) uses EXACTLY this
runbook. Naming: single-rod master = bare `H1-138` (scale identity + future diameter union);
double/traverse = names that do NOT match the bare family code (`H1-138 DOUBLE`,
`H1-138 TRAVERSE`); traverse detects via trv: tags → own generator; double = Single-assembly
flow mode. Per-slot exports, shared origin, codes-as-names, match gate to zero, notes on.

## 6. Session state (for the fresh session's orientation)

- HEAD ≈ `bd1abeb` (+ this brief). All weekend commits are on main; frontend auto-deploys.
- Tasks open: #9 H1 per-dia masters + cutover · #10 1.6 slot presets/tag dictionaries ·
  #11 Brimar (superseded by this rebuild decision + §2 bug).
- Instruments added this weekend (know they exist before diagnosing anything):
  CPQ red strip w/ owner attribution + rendering-model identity · 1.6 EDITING identity line ·
  ✗ not-in-model chips + rebind picker (mesh-aware) · ⇄ sides swap · Save reconciliation with
  loud status · Fusion match gate · designer notes · Flow-mode switch · dominance classifier ·
  Link dropdown with doc ids · readiness board (BOM Engine 🧭) · spec cell checks/coverage.
- Standing law: playbook §6 (fix order single→combined, blast radius named, Vision co-checked,
  incidents become tests). The regression suites live in the session scratchpad; re-create from
  git history if the scratchpad is gone (tests are described in commit messages).
