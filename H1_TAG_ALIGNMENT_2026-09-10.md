# H1 tag alignment — rev 3, after Stuart's tag pass (2026-09-10 afternoon, S1)

*Re-read from the live pins after the tag pass and run through the real adapter and engine. Locators carry BOTH
numbers every screen prints: **1.6 `#n · slot`** is the chip the Assign tool shows on each section heading (it
starts at #0); **1.5 `#n`** is the cluster's position in the 1.5 list. Rev 1 used only the first, rev 2 only the
second — sorry for the confusion. Rev 3 also withdraws item 1I (see §2).*

## 0. Where the step order stands now

Your target, every flow: Rod Setup → Rod → Rod length → Ends (front L, front R, then rear) → Bracket →
Backplate → Rings → Accessories.

After the tag pass **all four assemblies now rank the same way**, and it is not the target: Ends → Brackets →
Plates → Rod → Rings (+ Accessories / Fascia / Track ends), single and double alike. H1-75 joined the others the
moment its rods gained tier FRONT (correct tagging). That confirms the finding: the order is the engine's slot
ranking rule (the 20 Aug reshuffle), not the tags. The tags are now aligned enough that the engine change is the
next step — §3.

## 1. What changed in the pass (verified in the pins)

- **H1-75 rods tagged FRONT** — `1.6 #0 · short_rod / 1.5 #1`, `#1 · long_left / #2`, `#2 · long_right / #3` ✓.
  The 29 FRONT-tagged brackets / plates / ends are back on the order.
- **H1-1 doubles** — `1.6 #16 · slot_1787259482659 / 1.5 #14` H1-1R now DOUBLE; the BACK ring is gated ✓.
- **H1-1 return fee items** — `1.6 #29 / #30 · slot_17873211… / 1.5 #27 / #28` now H1-FRPF / H1-MRPF;
  `#31 / #32 / 1.5 #29 / #30` now H1-DBLFR / H1-DBLMR; `#20 / 1.5 #18` now H1-FRPF ✓. Every return pin keeps its
  projection tag.
- **H1-2TRV front-of-the-double** — `1.6 #40 · left_bracket / 1.5 #41`, `#41 · center_bracket / #42`,
  `#42 · right_bracket / #43`: DRTWB = fascia, DWB = track ✓.

## 2. Still open — your call, with both numbers

**2A. Stray `drive: MANUAL` on solid parts** (the drive axis belongs to the traverse; single value so it is
applied silently, but it is noise and one more part tagged MOTORIZED would make the question appear):
- H1-75, 21 pins: `1.6 #63 · left_end / 1.5 #64` ×3, `#64 · right_end / #65` ×2, `#61 · left_return_backplate / #62` ×8,
  `#62 · right_return_backplate / #63` ×8.
- H1-1, 22 pins: `1.6 #84 · left_end / 1.5 #85` ×3, `#85 · right_end / #86` ×3, `#82 · left_return_backplate / #83` ×8,
  `#83 · right_return_backplate / #84` ×8.
- H1-138, 118 pins: brackets and plates — `1.6 #99 · center_bracket / 1.5 #99` ×21, `#98 · left_backplate / #98` ×15,
  `#92 · center_bracket / #92` ×2 and the rest of the bracket / backplate / end sections around #89–#106.
- H1-2TRV, 8 pins on `1.6 #38 / #39 / #44 / #45` (NEW-SLOT) — these are traverse ends, where the tag belongs ✓.
4.5 Mass Update can clear a column in one pass if you prefer that to 1.6.

**2B. Double return fees' projection written without the tier words (H1-138):** `1.6 #70 · fr_mtr_dbl_left… /
1.5 #66` and `#71 · fr_mtr_dbl_right… / #67` — H1-DBLFR / H1-DBLMR carry **"8.5,3.25"**; every other double part
writes **"FRONT:8.5, BACK:3.25"**. Still as it was.

**2C. Returns tagged `setup: SINGLE`** — decision, not a defect until you say: H1-1 `1.6 #19 / #20 / 1.5 #17 / #18`
(4-5/8"), `#29 / #30 / 1.5 #27 / #28` (6"); H1-138 `#16 / #17 / 1.5 #8 / #9` (6" bends), `#22 / #23 / 1.5 #14 / #15`
(the 1-3/8" traverse returns); the doubles are correctly DOUBLE. If a single-depth return may sit on a double's
front rod, clear SINGLE; if not, leave them.

**2D. Carrier drift (H1-2TRV):** HTSLNTCAR at `1.6 #12 · slot_1788119996689 / 1.5 #7` is CLEAR (NO FINISH); the
same carrier at `#43 · slot_1788631872538 / 1.5 #44` is not. One of them is wrong.

**2E. In-line plates (H1-138):** `1.6 #46 · left_backplate / 1.5 #36`, `#47 · center_backplate / #37`,
`#48 · right_backplate / #38`, `#49 / #39` carry `inlineOnly`; the same eight plate codes at `#7 · center_backplate
/ 1.5 #6` and on H1-2TRV `#36 · center_backplate / 1.5 #20` do not. Confirm which set is right (in-line arms
pair by this tag).

**2F. Parked geometry (no item number) — harmless now, list for when you assign them:** H1-75 22 pins
(`1.6 #12 / #13 / #63 / #64` ends, `#16–#19` double NEW-SLOTs); H1-1 12 (`#84 / #85` ends, `#19 / #20`, `#29–#32`);
H1-138 13 (`#16 / #17`, `#70–#72`, `#96 / #97`, `#103 / #104`).

**2G. Withdrawn — "the traverse world inside H1-138" (rev 1/2 item 1I).** Those 54 pins are the 1-3/8"
traverse track parts of the H1-138 collection (fascia H1-138TRV at `1.6 #19 / #20 / #21`, TRV brackets and
plates at `#26–#37`, the 1-3/8" traverse return fees 138TRVMTR / 138TRVFR at `#22 / #23`), a product of its own,
not a leftover. They are why H1-138 asks Rod Type: Solid / Traverse, which is right. Nothing to retire. If
that traverse should walk in the same order, it will — the engine rule is shared.

**2H. Still open from 09-06, not re-checked** (about which slots exist): `trv: trv-only` on the H1-2TRV arms
(`1.6 #5 / #6 · left/right_end / 1.5 #2 / #3`); `H12RCTAR4625RIGHT` NO PLATE; wood `H1-2RCTWR` LEFT + RIGHT with no
CENTER (the #10 / #11 rule); rear `H1-2TRVNUT` tagged TRACK; S72 `returnOnly`.

## 3. Next: the engine (Issue 3 proper)

One ranking for every assembly, tiered or not: Rod → Rod length → Ends (front L, front R, back L, back R) →
Bracket → Backplate → Rings → Accessories → Fascia/Track/Track ends where the assembly has them. The Rod Setup
axes stay first as they are. Proven in `scripts/hardwareModel.test.mjs` (a fixture per assembly shape: untiered
single, tiered double, traverse), then read on the rail for all four flows without saving. One commit on
`Shared/hardwareModel.js` (rank) and `Shared/HardwareConfigurator.js` (the length step moves to right after the
rod). Say "go 3" and I will plan the exact diff.
