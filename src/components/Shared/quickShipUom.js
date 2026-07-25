// QUICK SHIP SELLING UNITS — "packs" (Stuart 2026-07-25).
//
// The model: we STOCK rings/finials as EACH and PACK them per customer. A pack is a SELLING unit,
// never a separate SKU. Different customers buy the same ring in 7-packs, 10-packs or 12-packs;
// finials by the piece or in pairs.
//
// So a Quick Ship line carries a pack unit + its each-count, and qty means PACKS:
//   qty 2 × "7 PACK" of a $4 ring  →  quote/invoice shows 2 × 7 PACK = $56
//                                  →  NetSuite + pick/pack get 14 EACH
// Nothing about item identity or stock changes — only presentation and the qty multiplier.
//
// The vocabulary is a master list (Mass Update 4.5 → QUICK SHIP UOM), so new pack sizes are data,
// not code. Each customer's preferred pack per category lives on their CRM record (Portal Access).

// Pack unit → how many EACH it contains. Entries are free text from the master list, so parse
// rather than enumerate: a leading number wins ("7PACK"→7, "10 PK"→10), then the named units.
// An explicit " - N" suffix always overrides, for a unit whose name doesn't carry its count
// ("BAKERS DOZEN - 13").
export function packSizeOf(uom) {
    const raw = String(uom || '').trim().toUpperCase();
    if (!raw) return 1;

    const explicit = raw.match(/-\s*(\d+(?:\.\d+)?)\s*$/);
    if (explicit) { const n = parseFloat(explicit[1]); if (n > 0) return Math.round(n); }

    const lead = raw.match(/^(\d+)/);
    if (lead) { const n = parseInt(lead[1], 10); if (n > 0) return n; }

    if (/\bPAIR\b|\bPR\b/.test(raw)) return 2;
    if (/\bDOZEN\b|\bDOZ\b/.test(raw)) return 12;
    return 1; // EA / EACH / 1PC / anything unrecognized sells one-for-one
}

// Display label for a pack unit — the master-list text minus any " - N" count hint.
export const packLabelOf = (uom) => String(uom || '').trim().replace(/\s*-\s*\d+(?:\.\d+)?\s*$/, '').toUpperCase();

// A pack that contains exactly one each is not a pack — treat it as loose so the UI and the
// invoice don't sprout meaningless "1 PACK" wrappers.
export const isRealPack = (uom) => !!uom && packSizeOf(uom) > 1;

// Per-category customer preference (crm_records fields, set in CRM → Portal Access). The keys are
// the Quick Ship kit-builder slots that sell in packs; every other slot sells each.
export const PACK_PREF_FIELDS = [
    { slot: 'ring', field: 'qsRingPack', label: 'Preferred Ring Pack' },
    { slot: 'finial', field: 'qsFinialPack', label: 'Preferred Finial Pack' },
    { slot: 'insideMount', field: 'qsInsideMountPack', label: 'Preferred Inside Mount Pack' },
];

// The pack unit to sell a slot in for a customer: their CRM preference, else the item's own
// Quick Ship UOM (Mass Update 4.5), else loose/each.
export function packUnitFor(slot, customer, item) {
    const pref = PACK_PREF_FIELDS.find(p => p.slot === slot);
    const fromCust = pref ? customer?.[pref.field] : '';
    if (fromCust) return String(fromCust).toUpperCase();
    const fromItem = item?.manufacturingSpecs?.quickShipUom;
    return fromItem ? String(fromItem).toUpperCase() : '';
}

// RUSH FEES — master list entries carry their price: "RUSH 3 DAY - 75". Same " - N" grammar as
// the pack counts above, so one convention covers both lists.
export function rushFeeAmountOf(entry) {
    const m = String(entry || '').match(/-\s*\$?\s*(\d+(?:\.\d+)?)\s*$/);
    const n = m ? parseFloat(m[1]) : NaN;
    return Number.isFinite(n) && n >= 0 ? n : null;
}
export const rushFeeLabelOf = (entry) => String(entry || '').trim().replace(/\s*-\s*\$?\s*\d+(?:\.\d+)?\s*$/, '').trim();
