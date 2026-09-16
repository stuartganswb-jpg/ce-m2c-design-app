// ── THE UNIT A LINE IS COUNTED IN (Stuart 2026-09-16) ─────────────────────────────────────────
//
// "a lot of confusion on the floor with older legacy items that are sold in pairs and all new items
// that we produce as single eaches … add the UOM to all screens on wms and finishing so they know if
// they need to pick and paint 3 each or 3 prs. we can then just print the same uom on the labels."
//
// Ruling: the display is "3 PR = 6 pcs", and NetSuite's stock unit IS the truth — the legacy items
// are held there as Pair and counted in pairs, so `qty` NEVER changes meaning. It stays in the
// item's own unit, exactly as the work order, the fulfilment and every adjustment already count it.
// `pcs` is the derived companion: what the paint line sprays and the packer puts in the box.
//
// ⚠ THIS MODULE ADDS NO NEW RULES. Almost all of the vocabulary already existed and was live in the
// warehouse; it simply never reached an ORDER LINE:
//   Shared/quickShipUom.packSizeOf   the ONE parser (PAIR/PR → 2, DOZEN → 12, "7PK" → 7, and an
//                                    explicit "- N" suffix that overrides the name)
//   Shared/quickShipUom.packLabelOf  the unit's display text, minus any "- N" count hint
//   Shared/labelScan.uomDisplay      "PR (2 pcs)" — how ONE unit reads on a label
//   Shared/labelScan.parseScan       the barcode already carries code + uom + pcs, and scanTally
//                                    already counts a scanned pair as two. That half is DONE.
// What was missing is here: reading the unit off the item onto a line, the derived piece count, and
// a QUANTITY-AWARE label ("3 PR = 6 pcs" is a line total; uomDisplay describes a single unit).
//
// ⚠ THE FOOTGUN, NAMED: `packSizeOf` reads an explicit "- N" suffix as the authoritative count, and
// `packLabelOf` STRIPS that suffix for display. So pieces must be counted from the RAW unit and only
// the DISPLAY normalised — otherwise "BAKERS DOZEN - 13" quietly becomes twelve. `uomStampOf` is the
// one call that does both correctly, and every writer should use it rather than combining the two by
// hand.
//
// Pure: no Firestore, no React. Harness: scripts/uom.test.mjs.
import { packSizeOf, packLabelOf } from './quickShipUom.js';

/** The unit exactly as the item master states it — raw, because the count hint lives in the text. */
export const rawUomOf = (x) => {
    if (!x) return '';
    if (typeof x === 'string') return x.trim();
    const specs = (x.manufacturingSpecs && typeof x.manufacturingSpecs === 'object') ? x.manufacturingSpecs : {};
    // A LINE's own stamp wins over the item it came from: the line is the photograph taken when the
    // order was raised, and re-reading the library later must never restate history.
    const v = x.uom != null && String(x.uom).trim() !== '' ? x.uom : specs.uom;
    return v == null ? '' : String(v).trim();
};

// The four units the floor actually says out loud, spelled one way. Anything else (a real pack unit
// from the 4.5 master list, like "7PK") keeps its own label — pack names are DATA, not code.
const CANON = [
    [/^(PAIRS?|PRS?)$/, 'PR'],
    [/^(EACH(ES)?|EA|PC|PCS|PIECES?)$/, 'EA'],
    [/^(FEET|FOOT|FT)$/, 'FT'],
];

/** The unit as every screen and label should PRINT it. '' / unknown → EA, the honest default. */
export const uomOf = (x) => {
    const label = packLabelOf(rawUomOf(x));
    if (!label) return 'EA';
    const hit = CANON.find(([re]) => re.test(label));
    return hit ? hit[1] : label;
};

/** How many pieces ONE unit contains. Delegates — there is exactly one parser in this app. */
export const piecesPerUnit = (uom) => packSizeOf(uom);

/** Is this unit anything other than a plain single? Only then is the "= n pcs" tail worth printing. */
export const isMultiPiece = (uom) => piecesPerUnit(uom) > 1;

/**
 * The stamp a line carries: the printable unit AND the piece count, both read from the RAW unit in
 * one place so the "- N" override can never be lost between the two.
 * @returns {{ uom: string, pcs: number }}
 */
export const uomStampOf = (partOrLine, qty) => {
    const raw = rawUomOf(partOrLine);
    const per = packSizeOf(raw);
    const n = Number(qty);
    const q = Number.isFinite(n) ? n : 0;
    // Feet come in fractions (a 106.5" rod is 8.875 ft); pieces never do.
    const pcs = per === 1 ? q : Math.round(q * per);
    return { uom: uomOf(raw), pcs };
};

/**
 * The ONE line string every screen and every label prints (Stuart's ruling):
 *   3 EA                3 PR = 6 pcs                3 × 7PK = 21 pcs
 * A single-piece unit never sprouts a meaningless "= 3 pcs" tail.
 */
export const uomLabel = (qty, uom) => {
    const u = uomOf(uom);
    const per = piecesPerUnit(uom);
    const n = Number(qty);
    const q = Number.isFinite(n) ? n : 0;
    if (per <= 1) return `${q} ${u}`;
    const pcs = Math.round(q * per);
    // A named pack reads "3 × 7PK"; a pair reads "3 PR" — the way the floor says each of them.
    return u === 'PR' ? `${q} ${u} = ${pcs} pcs` : `${q} × ${u} = ${pcs} pcs`;
};
