# Fabricut H1 → Per-Assembly Flows — Migration Game Plan

**Date:** 2026-07-24 · **Status:** PLAN (nothing executed) · **Owner:** Stuart + Claude sessions

## The goal

Move Fabricut from the ONE combined size-matrix flow (SIZE steps + `sizeVariantOf` runtime
translation) to the H2 model that proved out today: **one 🎯 single-assembly flow per rod
diameter (¾" / 1" / 1-3/8"), combined only at the CPQ landing** ("Fabricut H1 — pick rod
diameter…"), projections from `proj:` tags (PROJ_SELECT / implied). Much easier to manage:
per-assembly leaks are impossible by construction — every option a flow shows is a pin on that
diameter's own assembly.

**The prime directive:** the combined flow is LIVE and the pricing + customer part# machinery
built on it is the crown jewel. It ships intact or we don't ship.

## Why the crown jewels survive automatically

Almost everything expensive we built for Fabricut is keyed to **ITEMS, not flows**. A flow only
decides *which items get offered when*; these never notice the flow shape change:

| Machinery | Where it lives | Migration impact |
|---|---|---|
| Fabricut pricing tiers/codes ($0-w-arm, pricedWith) | `manufacturingSpecs.fabricut` on items (Library 1.5 editor) | none |
| Price levels (Std / FabCost / FabWholesale / FabRetail) | CPQ customer bar, reads item data | none |
| Customer part#s / clientPricing rows (SKU = pattern#) | CRM customer + item docs | none |
| Finish variants `/P` `/EPn` billing | `finishVariantOf` chains on items | none |
| Species `-O` / `-W` | `speciesVariantOf` + bomSuffix on items | none |
| Return fee $ (CE-FEE-H1FR/MTR, /P /EP tiers) | fee ITEM docs | none (linkage changes, see below) |
| NetSuite push (rollup, discounts, qty rules) | `resolveJobLines` — flow-agnostic | none |

What DOES change is generation-time wiring: which pins exist on which assembly, and how
returns/projections gate. That's designer + 1.6 work plus two small generator changes.

## What actually changes

1. **Per-size SKUs become direct pins.** Today the combined flow pins the ¾" master's parts and
   translates through `sizeVariantOf` at runtime (H1-75BE → H1-1B6). Per-assembly: each
   diameter's assembly pins its OWN exact SKUs — translation chain not needed at runtime
   (chains stay on items; spec sheets and the archive still read them).
2. **Returns become pinned fee rows.** The combined flow's OPT-BEND/OPT-MITER are
   generator-built synthetics (suppressed in 🎯 mode on purpose — 2bdd7b2). Like H2: pin
   CE-FEE-H1FR + CE-FEE-H1MTR in each diameter's 1.6 with `proj:` **minimum** tags (4-5/8" —
   H1 bans returns at 3-5/8"), endTreatment set. Fee flags (skip push/ride rollup) ride the
   fee item docs as today.
3. **Projection question from tags.** Brackets get exact `proj:` tags (3-5/8" / 4-5/8" per
   physical item); 2+ distinct tags → the generator emits the Bracket Projection step. Wood
   arms W{S|E|6}B become tagged sibling options instead of a proj-swap.
4. **Landing group stamps.** Flows get `sizeGroupLabel: "Fabricut H1"` etc. → CPQ (and now
   Vision) collapse them into one picker entry.

## ⚠️ Hard rules (the "don't wreck it" list)

- **NEVER add a `codeRx` to the H1 family while the combined flow is live.** codeRx activates
  the virtual sizeKey grammar (`skOf`/`sizeKeyOf`), family-union + review-gate on regenerate,
  and bare-code parsing in the spec modal — all of which would change the LIVE combined flow's
  behavior. The generator's group stamping currently requires codeRx (AdminTab ~665-681), so:
- **M2 code change:** stamp `sizeGroup*` without codeRx — a small "diameter of this assembly"
  picker next to the 🎯 checkbox (options from the family's dia list) that fills
  sizeGroupLabel/Choice/Sort directly. Purely additive; existing generates untouched.
- **The H1 master assembly DOC never gets deleted or re-pinned.** Spec-sheet registry, GLB
  archive, and the live combined flow read it. New per-dia assemblies are NEW docs.
- **Freeze combined-flow edits once the pilot passes parity** — a change made only on one side
  during the transition window is how prices drift.
- **Portal hold:** per-assembly Fabricut flows stay out of the portal until the portal
  Configurator/portalEngine mirror PROJ_SELECT + the landing (same hold H2 is under today).

## Phase plan

**M0 — Baseline fixtures (no code, ~1hr).** From the LIVE combined flow capture 4 golden
carts covering: each dia × proj, a species pick, a French + a miter return w/ plates, backplate
incl + CP upcharge, Std + FabWholesale price levels, one clientPricing customer. Save quote
lines + push previews (screenshots fine). These are the acceptance tests for everything below.

**M1 — Per-dia assemblies (designer + 1.6).** For ¾", 1", 1-3/8": per-dia GLB via 1.6 Fusion
Import (standard path), pins = that dia's exact SKUs + fee rows + species pairs + plate
flags, `proj:`/`mount:` tags from the dictionaries. The union report / Assembly Design Planner
doubles as the per-dia pin checklist so nothing is missed.

**M2 — Generator: group stamps without codeRx** (small, gated, shippable any time).

**M3 — Pilot ¾" flow (parallel, hidden).** Generate 🎯 flow from the ¾" assembly with a test
group label ("H1 NEW — TESTING"). Run every M0 fixture side-by-side vs the combined flow at ¾":
same items, same $, same push preview, same species/fee/plate behavior, both price levels,
clientPricing intact. Fix 1.6 data (not code) until parity. Combined flow untouched throughout.

**M4 — Full set + landing.** 1" and 1-3/8" flows, real `sizeGroupLabel`, landing + sibling
switcher verified in CPQ and Vision. Spec sheets: each per-dia doc opens its own cell
(0cbc60f already handles this); registry cells keep serving the other sizes.

**M5 — Cutover.** Hide the combined flow from the picker (do NOT delete the flow doc — archive;
the master assembly doc lives forever). Watch the first week of real quotes. Rollback = unhide
the combined flow; nothing is destroyed at any step.

**M6 — Portal mirror.** PROJ_SELECT + landing in portal Configurator + portalEngine, then
Fabricut per-assembly goes portal-live (same gate unlocks H2 for the portal).

## Sequencing recommendation

Let H2 field-test the per-assembly model for a week or two first — it's the free pilot. Then
M0–M3 in a quiet week. Phase 4 (ceiling + double) and Phase B (two-part finials) should land
ON the per-assembly model (build once, not twice) — natural ordering: migrate first, then those.

## Effort split

- Designer: 3 per-dia GLBs (Fusion exports she already knows how to make).
- Stuart/1.6: pins + tags per dia (the long pole; checklist-driven).
- Code: M2 stamp picker (~1 evening), M6 portal mirror (the big one, already owed for H2).
