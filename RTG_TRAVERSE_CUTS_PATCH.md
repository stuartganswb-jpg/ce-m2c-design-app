# Patch spec for B (RTG Dispatch) — carry the traverse cut list to the floors

**From:** Brief E (sales side), 2026-09-08. **Why:** Stuart: "the drive type selection will drive the
overall cut length sizes of the traverse tracks … these measurements must be added to the shop floor
bom and raw cuts." Vision now writes them on the job's `engineeringNotes`; RTG's `fabNotes` pick-list
copies named cut fields to the floors and needs one more.

## What Vision writes (`cpq_drafts` → job `engineeringNotes`, only on a traverse rod)
```js
traverseCuts: [ { role: 'FASCIA'|'TRACK'|'FCLIP', cutInches: 79.5, qty: 1|2 }, … ],
rodKind: 'TRAVERSE', setup: 'SINGLE'|'DOUBLE', frontLayer: 'FASCIA'|'TRACK'|'', drive: 'MANUAL'|'MOTORIZED'
```
Source of the numbers: `Shared/traverseTags.js` `TRAVERSE_DEDUCTIONS` — fascia as ordered; track −0.5" manual / −2" motorized; F-clip −1" / −3". Two tracks and no fascia on a double with a track front & rear.

## The one line — `src/components/HQ/RTGDispatchTab.js` ~1114, inside `fabNotes = { … }`
```js
                // Traverse: fascia / track / F-clip cuts by drive (Vision, Shared/traverseTags).
                traverseCuts: Array.isArray(eng.traverseCuts) ? eng.traverseCuts : null,
                drive: eng.drive || null, setup: eng.setup || null, frontLayer: eng.frontLayer || null,
```
Then whichever shop-floor cut sheet renders `pole1/pole2/pole3` should list `traverseCuts` rows when present (role · qty · cutInches) instead of "Main Tube Raw Cut".

Nothing else changes: the fields are additive, absent on every solid-pole job.
