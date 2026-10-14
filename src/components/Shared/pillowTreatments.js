// ── STITCH & LEATHER TREATMENTS — the show upgrades, PURE (S7, 2026-10-14) ─────────────────────────
//
// Stuart 2026-10-14: "the leather welt comes welt and mini welt. the railroad or blanket stitch is $50.00
// upgrade and available in two basic options - the 4sides or down the middle. the leather welts are
// $65.00 same two options (upcharges to existing pillow sales price) … make them options on the custom
// pillow page as well so they can be used as seam and edge treatments if anyone wants them in any
// position other than these two." · "just put the nau items and stitch colors onto the work orders,
// later maybe we will add to netsuite lines. down the middle correct it is one seam right down the
// middle with the same fabric both sides and back. yes same price all colors."
//
// So: four TREATMENTS, each a priced detail in the price table (6.5 Pillow Pricing, kind TREATMENT, per
// EACH — a blank price = not offered, as every detail). Two PLACEMENTS on the counter: round the FOUR
// SIDES (design.edgeTreatment) or DOWN THE MIDDLE (one real seam, two half-width face panels of the
// same fabric, the back whole; the seam is `included` — the upcharge is its price, no seam labour).
// On the board any drawn seam may carry one (seam.treatment = the code, seam.colour), and the edge
// picker takes one round the four sides. The colour is WORDS on the line, the summary and the sewing
// document (the yarn name; the leather name + its NAU code) — no consumed item until Stuart adds them
// to NetSuite. Same price every colour. Proven by scripts/pillowTreatments.test.mjs.

const str = (v) => String(v == null ? '' : v).trim();
const up = (v) => str(v).toUpperCase();
const num = (v) => (v === null || v === undefined || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));

export const TREATMENT_KIND = 'TREATMENT';

export const TREATMENTS = [
    { code: 'STITCH_RAILROAD', label: 'Railroad stitch', family: 'STITCH', glyph: '┉' },
    { code: 'STITCH_BLANKET', label: 'Blanket stitch', family: 'STITCH', glyph: '⌇' },
    { code: 'LEATHER_WELT', label: 'Leather welt', family: 'LEATHER', glyph: '◯', nsPrefix: 'NAU330' },
    { code: 'LEATHER_MINI_WELT', label: 'Mini leather welt', family: 'LEATHER', glyph: '○', nsPrefix: 'NAU320' },
];

export const PLACEMENTS = [
    { code: 'FOUR_SIDES', label: '4 sides' },
    { code: 'MIDDLE', label: 'Down the middle' },
];

/** The yarn card (stitches.xlsx + the photo), in the card's order. `hex` is the tile's swatch only. */
export const YARN_COLOURS = [
    { name: 'White', hex: '#e9e6e1' }, { name: 'Cream', hex: '#e3dccb' }, { name: 'Burnt Orange', hex: '#b5651d' },
    { name: 'Bright Orange', hex: '#e2561b' }, { name: 'Purple', hex: '#5e3a6b' }, { name: 'Bright Green', hex: '#7a9a2c' },
    { name: 'Dark Green', hex: '#3d4a33' }, { name: 'Denim', hex: '#4a5a73' }, { name: 'Light Brown', hex: '#a9865c' },
    { name: 'Taupe', hex: '#d4c4a3' }, { name: 'Chocolate', hex: '#5a4432' }, { name: 'Mink', hex: '#8d7b6a' },
    { name: 'Light Grey', hex: '#a9a39c' }, { name: 'Dark Grey', hex: '#55575d' }, { name: 'Black', hex: '#1e1e1e' },
];

/** The leather welts (leather_welts.xlsx): the colour name, the supplier's swatch number, the NAU code. */
export const LEATHER_COLOURS = {
    LEATHER_WELT: [
        { name: 'Taupe', number: '406', hex: '#a8a39a' }, { name: 'Black', number: '444', hex: '#262321' },
        { name: 'Crème', number: '401', hex: '#dcd5c3' }, { name: 'Beige', number: '403', hex: '#d0c6ae' },
        { name: 'Dark Beige', number: '412', hex: '#b3a68c' }, { name: 'Rust', number: '434', hex: '#8a3d1c' },
        { name: 'Mustard', number: '429', hex: '#c9a32a' },
    ],
    LEATHER_MINI_WELT: [
        { name: 'Mustard', number: '429', hex: '#c9a32a' }, { name: 'Cactus', number: '445', hex: '#a9b36a' },
        { name: 'Mushroom', number: '446', hex: '#6b5a3c' }, { name: 'Seafoam', number: '452', hex: '#bfd8d2' },
        { name: 'Mauve', number: '458', hex: '#e8c9c3' },
    ],
};

export const treatmentOf = (code) => TREATMENTS.find(t => t.code === up(code)) || null;
export const isTreatmentCode = (code) => !!treatmentOf(code);
export const placementOf = (code) => PLACEMENTS.find(p => p.code === up(code)) || null;

/** The colours a treatment offers: the yarn card for a stitch; the welt's own list for leather (code = NAUxxx/nnn). */
export const coloursOf = (code) => {
    const t = treatmentOf(code);
    if (!t) return [];
    if (t.family === 'STITCH') return YARN_COLOURS.map(c => ({ name: c.name, code: '', hex: c.hex }));
    return (LEATHER_COLOURS[t.code] || []).map(c => ({ name: c.name, number: c.number, code: `${t.nsPrefix}/${c.number}`, hex: c.hex }));
};

/** One colour by name (case-blind) on a treatment, or null. */
export const colourOf = (code, name) => coloursOf(code).find(c => up(c.name) === up(name)) || null;

/** The treatments the price table offers (a priced TREATMENT row), with the price. */
export const treatmentsOffered = (config) => TREATMENTS
    .map(t => { const row = config && config.details && config.details[t.code]; return row && num(row.price) !== null ? { ...t, price: num(row.price), label: str(row.label) || t.label } : null; })
    .filter(Boolean);

/** The built-in detail rows for the price sheet (6.5 Pillow Pricing). */
export const BUILT_IN_TREATMENT_DETAILS = TREATMENTS.map(t => ({ code: t.code, label: `${t.label} (4 sides, down the middle or on a seam)`, kind: TREATMENT_KIND, per: 'EACH' }));

/** "blanket stitch · down the middle · burnt orange" / "leather welt · 4 sides · taupe NAU330/406". */
export const treatmentWordsOf = ({ code, placement = '', colour = '' } = {}) => {
    const t = treatmentOf(code);
    if (!t) return '';
    const p = placementOf(placement);
    const c = colourOf(code, colour);
    const colourWords = c ? `${c.name.toLowerCase()}${c.code ? ` ${c.code}` : ''}` : (str(colour) ? str(colour).toLowerCase() : '');
    return [t.label.toLowerCase(), p ? p.label.toLowerCase() : (up(placement) === 'SEAM' ? 'on a seam' : ''), colourWords].filter(Boolean).join(' · ');
};

/**
 * Every treatment a design carries, in order: the edge treatment (4 sides), then each seam that carries
 * one (`middle` seams say DOWN THE MIDDLE, the rest ON A SEAM). The words ride the summary and the
 * sewing document; pricePillow charges each one once.
 */
export const treatmentsOfDesign = (design) => {
    const d = design || {};
    const out = [];
    const et = d.edgeTreatment || null;
    if (et && isTreatmentCode(et.code)) out.push({ code: up(et.code), placement: 'FOUR_SIDES', colour: str(et.colour), colourCode: (colourOf(et.code, et.colour) || {}).code || '' });
    (Array.isArray(d.seams) ? d.seams : []).forEach(s => {
        if (!isTreatmentCode(s.treatment)) return;
        out.push({ code: up(s.treatment), placement: s.middle ? 'MIDDLE' : 'SEAM', colour: str(s.colour), colourCode: (colourOf(s.treatment, s.colour) || {}).code || '', seamId: s.id });
    });
    return out;
};

export const treatmentWordsOfDesign = (design) => treatmentsOfDesign(design).map(treatmentWordsOf).filter(Boolean).join(' · ');
