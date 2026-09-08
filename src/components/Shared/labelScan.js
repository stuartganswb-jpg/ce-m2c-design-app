// ══ WHAT A SCANNED LABEL MEANS ════════════════════════════════════════════════════════════════
//
// Stuart 2026-09-08: "we have the ring packs and the EA vs Pr … after the UOM add in () the actual
// # in pcs in the label, so later when we scan these labels a warning can pop up you scanned
// 2 x 2pr label, 4 single pcs are needed for this order. or you scanned 2 x 7pk, 14 total rings
// are needed for this order."
//
// THE PROBLEM THIS SOLVES. Every label in the app barcodes the PLAIN ITEM CODE, and every scanner
// matches on exactly that. So a 7-pack label and a single scan identically: the screen sees
// "H1-138RG" twice and counts two pieces, when the operator is holding fourteen rings. Printing
// the piece count in human-readable text is not enough — the SCANNER has to know.
//
// So a UOM label's barcode carries three things, and this module is the ONE place that writes and
// reads that grammar:
//
//     H1-138RG*7PK*7          item * unit * pieces-in-one-of-them
//
// `*` is the separator because no item code in this system contains one (they carry - / and
// digits), and Code128B encodes it fine.
//
// ── THE RULE THAT KEEPS EVERY EXISTING SCANNER WORKING ────────────────────────────────────────
// A plain code — every label printed before today, and every item label still printed now — parses
// to exactly what it always meant: that item, one piece. So a screen can adopt `parseScan` without
// changing any behaviour, and gains pack-awareness for free the day someone scans a UOM label.
// Nothing needs a migration and no old label stops working.
//
// Pure: no Firestore, no NetSuite, no browser, no React. Tested offline
// (scripts/labelScan.test.mjs) because a wrong answer here miscounts a customer's order.

const SEP = '*';

export const upScan = (v) => String(v == null ? '' : v).trim().toUpperCase();

/**
 * The barcode for a UOM label. `pcs` is how many pieces ONE of these represents — scanning the
 * label twice means twice that, which is the whole point.
 */
export function encodeUomScan({ code, uom, pcs }) {
    const c = upScan(code);
    const u = upScan(uom).replace(/\*/g, '');       // a stray separator in a unit name would lie
    const n = Math.max(1, Math.floor(Number(pcs) || 1));
    if (!c) return '';
    if (!u || n <= 1) return c;                      // a single is just the code — no false pack
    return `${c}${SEP}${u}${SEP}${n}`;
}

/**
 * Read anything a scanner hands us.
 *
 * @returns {{ code, uom, pcs, isUom, raw }}
 *   code   the item, always — this is what an existing screen already matches on
 *   uom    the selling unit, '' for a plain scan
 *   pcs    pieces THIS ONE SCAN represents: 1 for a plain code, the pack size for a UOM label
 *   isUom  true only when the label actually declared a unit
 *
 * Deliberately forgiving in one direction only: a malformed or half-typed composite falls back to
 * the item code with pcs 1. Under-counting shows up as a shortage a human resolves; over-counting
 * ships a customer short and nobody notices, so the failure is aimed at the visible side.
 */
export function parseScan(raw) {
    const s = upScan(raw);
    if (!s) return { code: '', uom: '', pcs: 1, isUom: false, raw: '' };
    if (!s.includes(SEP)) return { code: s, uom: '', pcs: 1, isUom: false, raw: s };

    const parts = s.split(SEP);
    const code = upScan(parts[0]);
    const uom = upScan(parts[1]);
    const n = Math.floor(Number(parts[2]));
    if (!code) return { code: s, uom: '', pcs: 1, isUom: false, raw: s };
    if (!uom || !Number.isFinite(n) || n <= 0) return { code, uom: '', pcs: 1, isUom: false, raw: s };
    return { code, uom, pcs: n, isUom: true, raw: s };
}

/** Just the item, for a screen that only wants to know WHICH part was scanned. */
export const scannedCode = (raw) => parseScan(raw).code;

/** How many pieces this scan is worth. A plain scan is one. */
export const scannedPcs = (raw) => parseScan(raw).pcs;

/**
 * The warning Stuart described, as a pure answer rather than a message baked into a screen.
 *
 * Given the scans taken so far for one line and how many pieces that line needs, say where the
 * count actually stands. The SENTENCE is the caller's — the floor and the office word things
 * differently — but the arithmetic is here so two screens cannot disagree about it.
 *
 * @param {Array<string>} scans   raw scanned strings, in the order they were taken
 * @param {number} needed         pieces the line requires
 */
export function scanTally(scans, needed) {
    const parsed = (scans || []).map(parseScan).filter(p => p.code);
    const pcs = parsed.reduce((a, p) => a + p.pcs, 0);
    const want = Math.max(0, Math.floor(Number(needed) || 0));
    // Group identical labels so the message can say "2 × 7PK" rather than listing them.
    const byLabel = new Map();
    parsed.forEach(p => {
        const k = p.isUom ? `${p.uom}|${p.pcs}` : 'EACH|1';
        const hit = byLabel.get(k);
        if (hit) hit.count += 1;
        else byLabel.set(k, { uom: p.isUom ? p.uom : 'EA', pcs: p.pcs, count: 1 });
    });
    const groups = [...byLabel.values()];
    return {
        pcs,
        needed: want,
        over: want > 0 && pcs > want,
        short: want > 0 && pcs < want,
        exact: want > 0 && pcs === want,
        remaining: Math.max(0, want - pcs),
        groups,                                   // [{ uom, pcs, count }]
        // "2 × 7PK (14 pcs)" — the readable half, built from the same numbers.
        summary: groups.map(g => `${g.count} × ${g.uom}${g.pcs > 1 ? ` (${g.count * g.pcs} pcs)` : ''}`).join(' + '),
    };
}

/** How a unit reads on a label and in a message: "7PK (7 pcs)". Singles stay plain. */
export const uomDisplay = (uom, pcs) => {
    const u = upScan(uom) || 'EA';
    const n = Math.max(1, Math.floor(Number(pcs) || 1));
    return n > 1 ? `${u} (${n} pcs)` : u;
};
