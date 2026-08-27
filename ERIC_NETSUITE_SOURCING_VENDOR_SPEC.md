# NetSuite Setup — Vendors & the "Both" Sourcing Flag (for Eric)

*2026-08-28. Goal: the app's ordering screens route every item by sourcing — MAKE (work order),
BUY (purchase order), or BOTH (the screen asks per item). Vendors and the BOTH flag must come
across on the 11.1 item sync and survive re-syncs. The app side is already deployed and
self-activates once the NetSuite side below exists.*

---

## 1. ONE new item custom field to create

| Setting | Value |
|---|---|
| Type | **Check Box** |
| Label | `Sourced Both Ways (Make & Buy)` |
| **Field ID** | **`custitem_sourcing_both`** ← must be exactly this (type it in the ID field when creating; the app's sync reads this id) |
| Applies to | Inventory Item **and** Assembly/BOM Item (same set as custitem26/27/28) |
| Default | Unchecked |

Meaning: **ticked = we both make this in-house AND buy it from a vendor.** The ordering screens
will then always ask "PO or WO?" for it, defaulting to the work order.
Keep **custitem26 (In-House) ticked too** on these items — Both implies we can make it.

If the ID `custitem_sourcing_both` is somehow unavailable, create it with the closest possible id
and tell Stuart the exact id — the app needs a one-line change to match.

## 2. Populate it

Tick the new box on every item we both make and buy — the H1/H2 assemblies Stuart has flagged,
and anything else that fits. **Coordinate with Stuart before the first item sync after the field
exists** (see §4 — the app already holds some BOTH flags that should be pushed OUT to NetSuite
first so they aren't cleared).

## 3. Vendors — what the sync reads (already live, just needs the data to be right)

For every item we BUY (Outsourced or Both), on the item's **Purchasing/Inventory → Vendors** sublist:

1. The **vendor** listed (this is where the app gets the vendor's internal id — what PO creation
   actually needs; names are only the fallback).
2. **Preferred** ticked when an item has more than one vendor — the sync takes the preferred row;
   without it, whichever row NetSuite lists first wins.
3. **Purchase Price** on the vendor row (PO line rates use it; the item's own cost is the fallback).
4. **Code** (the vendor's part #) filled in where known — it prints on the PO lines.

And the vendor records themselves: active, and if we're using the "Sync to App" gate, ticked
`custentity18`. (The app's PO push refuses a vendor it can't resolve — it never guesses.)

## 4. Cutover order (matters — do it in this sequence)

1. Eric creates `custitem_sourcing_both` (§1) and ticks the obvious items (§2).
2. **Stuart, in 11.1 → Push panel:** tick **"Sourced BOTH · custitem_sourcing_both"** and run the
   push — this seeds NetSuite with the BOTH flags already set in the app (the push previews
   exactly what will be ticked/un-ticked before writing).
3. From then on, normal item syncs keep it aligned: ticked in NetSuite → BOTH in the app;
   un-ticked → the item falls back to plain In-House/Outsourced per custitem26. The pull can be
   frozen per-field on the 11.1 pull card like every other field.

## 5. What the app does with it (context)

- Stocked Sales Snapshot, Raw Cores, and 3-Tier: a BOTH item always opens the per-item
  **PO ↔ WO chooser**, defaulted to the work order (a wrong WO parks for review; a wrong PO is a
  real purchase).
- Vendor internal id + purchase price ride each item so POs group per vendor and price correctly.
