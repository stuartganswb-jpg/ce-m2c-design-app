// BRACKET SPAN — how far apart the brackets can sit before the rod sags.
//
// Ported verbatim from July28/Curtain_Pole_Span_Calculator.xlsx (Stuart, 2026-07-28). Every
// constant below is that workbook's; nothing here was invented or "improved". If the engineering
// needs to change, change it HERE and re-copy to portal/src/shared/ — this file is a verbatim-copy
// pair like sizeMatrix.js / priceLevels.js / bayMath.js.
//
// The model: a single span simply supported between two brackets, carrying the drapery as a
// uniform load. Safe span is the SMALLER of the sag-limited and stress-limited spans; per the
// workbook, sag governs throughout in practice.
//
//   Round tube:   I = π/64 · (OD⁴ − ID⁴),  S = 2I/OD,  ID = OD − 2·wall
//   Rectangle:    I = (b·h³ − bᵢ·hᵢ³)/12,  S = 2I/h    (h = depth in the load direction)
//   Sag-limited:  L = ( 384·E·I / (n·5·w) )^(1/3)      with w in lb/in, limit L/n
//   Stress-limited: L = √( 8·(Yield/FS)·S / w )
//
// Brackets are assumed anchored to studs — i.e. the anchor is not the weak point.

// ---- Engineering constants (workbook "Inputs" sheet) ---------------------------------------
const STEEL = { E: 29000000, yield: 54000 };   // psi · 1018 cold-drawn
const ALUM = { E: 10000000, yield: 16000 };    // psi · 6063-T5
const FS = 2;            // safety factor on yield
// SAG LIMIT — tightened from the workbook's L/180 to L/360 (Stuart 2026-07-28: "those spans are
// way too long, let's set it industry best practice"). L/180 is a structural limit borrowed from
// building codes, where the beam is hidden; a curtain rod is judged BY EYE, so it has to be far
// tighter. L/360 is the standard "no visible sag" figure for exposed decorative work.
const DEFLECTION_N = 360;
const GAUGE_WALL = { 14: 0.083, 16: 0.065 };   // Birmingham Wire Gauge, tube standard
// The 2" rectangular aluminium extrusion, outside dimensions + uniform wall.
const ALUM_PROFILE = { h: 2, w: 0.75, t: 0.105 };

// Fullness is fixed rather than asked: 2.5× is our standard and exposing it invites a wrong
// answer from someone who doesn't know what it means.
export const FULLNESS = 2.5;
export const DEFAULT_DROP_FT = 8;

// ---- Fabric classes ------------------------------------------------------------------------
// Areal weights are the workbook's "flat fabric weight per ft² (incl. lining), before pleating";
// fullness accounts for the extra material. Three classes, in the customer's language.
export const FABRIC_CLASSES = [
    { id: 'SHEER', label: 'Light — sheers & voiles', areal: 0.03, example: 'Voile, linen sheer, anything you can see through' },
    { id: 'PRINT', label: 'Medium — prints & lined drapery', areal: 0.10, example: 'Lined cotton or linen prints — the most common choice' },
    { id: 'BLACKOUT', label: 'Heavy — blackout & interlined', areal: 0.25, example: 'Blackout, interlined, velvet and tapestry' },
];
export const fabricClass = (id) => FABRIC_CLASSES.find(f => f.id === id) || FABRIC_CLASSES[1];

// Drapery load per linear foot of rod = areal weight × drop × fullness.
export const loadPerFoot = (areal, dropFt, fullness = FULLNESS) =>
    (Number(areal) || 0) * (Number(dropFt) || 0) * (Number(fullness) || 0);

// ---- Section properties --------------------------------------------------------------------
const roundSection = (od, wall) => {
    const id = od - 2 * wall;
    const I = (Math.PI / 64) * (Math.pow(od, 4) - Math.pow(id, 4));
    return { I, S: 2 * I / od };
};
// h = the dimension in the load direction (vertical). Strong orientation = the 2" side vertical.
const rectSection = (h, b, t) => {
    const I = (b * Math.pow(h, 3) - (b - 2 * t) * Math.pow(h - 2 * t, 3)) / 12;
    return { I, S: 2 * I / h };
};

// ---- The rods we actually sell ---------------------------------------------------------------
// collection maps the material to the product line, per Stuart: 14 ga is the Fabricut H1 pole,
// 16 ga is the H2 Simple Elegance pole. The 2" rectangular aluminium is H1 ONLY and is offered
// ONLY in the strong (2" vertical) orientation — we do not sell it the weak way, so the weak-axis
// row from the workbook is deliberately absent rather than hidden.
const ROUND_SIZES = [
    { od: 0.5, label: '1/2"', maxSpan: 36 },
    { od: 0.75, label: '3/4"', maxSpan: 48 },
    { od: 1, label: '1"', maxSpan: 60 },
    { od: 1.375, label: '1-3/8"', maxSpan: 72 },
];

// HOUSE MAXIMUM SPAN — the cap that applies no matter what the beam math says.
//
// Why a cap at all: the tube is genuinely stiffer than the installation around it. Sag is only one
// failure; the ones the calculation cannot see are the bracket and its anchor, rings binding as
// they travel over a long unsupported run, and a customer's eye. So the recommendation is the
// SMALLER of the engineered span and this cap — matching the common trade rule of a support
// roughly every 4 ft, opened up for the heavier rods that carry it.
//
// These are OUR house numbers, deliberately in one editable place. Change here, re-copy to
// portal/src/shared/bracketSpan.js.
const ALUM_MAX_SPAN = 72;

// crmCollection ties a rod family to the collection tag used everywhere else in the app — the same
// vocabulary as hq_collections and the "Available Collections" checkboxes on the CRM Portal Access
// panel. That's what lets the portal show a Fabricut customer only the Fabricut rods.
export const ROD_COLLECTIONS = [
    { id: 'H1', label: 'Fabricut H1', crmCollection: 'FABRICUT H1', note: '14 ga steel + the 2" aluminium extrusion' },
    { id: 'H2', label: 'Simple Elegance', crmCollection: 'SIMPLE ELEGANCE', note: '16 ga steel' },
];

// The rod families a customer may see, given their CRM portalCollections. An EMPTY/absent list
// means no restriction — the same rule the catalog gate uses, so turning entitlement on for one
// customer never blanks the page for everyone else.
export function rodCollectionsFor(allowedNames) {
    const allowed = (Array.isArray(allowedNames) ? allowedNames : [])
        .map(c => String(c || '').trim().toUpperCase()).filter(Boolean);
    if (!allowed.length) return ROD_COLLECTIONS;
    const set = new Set(allowed);
    const kept = ROD_COLLECTIONS.filter(c => set.has(c.crmCollection));
    // A customer entitled only to collections this guide doesn't cover would otherwise see an empty
    // page; showing everything is the wrong answer, so the caller renders the "ask us" note instead.
    return kept;
}

export const RODS = [
    ...ROUND_SIZES.map(s => ({
        id: `H1-${s.od}`, collection: 'H1', label: `${s.label} round`, material: 'Steel',
        section: roundSection(s.od, GAUGE_WALL[14]), metal: STEEL, maxSpan: s.maxSpan,
    })),
    ...ROUND_SIZES.map(s => ({
        id: `H2-${s.od}`, collection: 'H2', label: `${s.label} round`, material: 'Steel',
        section: roundSection(s.od, GAUGE_WALL[16]), metal: STEEL, maxSpan: s.maxSpan,
    })),
    {
        id: 'H1-ALU2', collection: 'H1', label: '2" rectangular', material: 'Aluminium',
        section: rectSection(ALUM_PROFILE.h, ALUM_PROFILE.w, ALUM_PROFILE.t), metal: ALUM, maxSpan: ALUM_MAX_SPAN,
    },
];

// ---- The answer -------------------------------------------------------------------------------
// Engineered span in INCHES for one rod under a given load, BEFORE the house cap. Null for a
// non-positive load.
export function engineeredSpanInches(rod, loadLbPerFt) {
    const w = (Number(loadLbPerFt) || 0) / 12; // lb/in
    if (!(w > 0) || !rod || !rod.section) return null;
    const { I, S } = rod.section;
    const sag = Math.pow((384 * rod.metal.E * I) / (DEFLECTION_N * 5 * w), 1 / 3);
    const stress = Math.sqrt(8 * (rod.metal.yield / FS) * S / w);
    return Math.min(sag, stress);
}

// The RECOMMENDED span: the engineered span capped at the house maximum. Also reports which of the
// two bound it, so neither page has to present a number it can't explain — "why does the 1-3/8"
// rod stop at 6 ft?" has a real answer, and it's a different answer from "your fabric is heavy".
export function safeSpanInches(rod, loadLbPerFt) {
    const eng = engineeredSpanInches(rod, loadLbPerFt);
    if (eng === null) return null;
    return Math.min(eng, rod.maxSpan || Infinity);
}

// Whole table for a fabric class + curtain length. Spans are rounded DOWN to the inch — a guide
// that over-promises by a fraction of an inch is worse than one that quietly under-promises.
export function spanTable(fabricId, curtainLengthFt, collectionId) {
    const fab = fabricClass(fabricId);
    const load = loadPerFoot(fab.areal, curtainLengthFt);
    return RODS
        .filter(r => !collectionId || r.collection === collectionId)
        .map(r => {
            const eng = engineeredSpanInches(r, load);
            const capped = eng === null ? null : Math.min(eng, r.maxSpan || Infinity);
            return {
                ...r,
                spanInches: capped === null ? null : Math.floor(capped),
                spanFeet: capped === null ? null : Math.floor(capped) / 12,
                // 'MAX'  = our house limit is the binding constraint (a longer curtain won't shorten it)
                // 'LOAD' = the fabric weight is (a heavier or longer curtain WILL shorten it)
                limitedBy: capped === null ? null : (eng > (r.maxSpan || Infinity) ? 'MAX' : 'LOAD'),
            };
        });
}

// Brackets needed across a rod of a given finished length: the two ends plus enough intermediates
// that no gap exceeds the safe span.
export function bracketsFor(rodLengthInches, spanInches) {
    const L = Number(rodLengthInches) || 0;
    if (!(L > 0) || !(spanInches > 0)) return null;
    return Math.max(2, Math.ceil(L / spanInches) + 1);
}

// Feet-and-inches for display: 123 → "10' 3"".
export function ftIn(inches) {
    if (inches === null || inches === undefined) return '—';
    const total = Math.floor(inches);
    return `${Math.floor(total / 12)}' ${total % 12}"`;
}

// Shown to CUSTOMERS as well as staff — the one assumption that changes what an installer does.
export const STUD_NOTE = 'All measurements assume brackets are mounted into the wall studs.';

// What the numbers assume — shown to staff, not to customers.
export const ASSUMPTIONS = [
    `Fullness ${FULLNESS}× · sag limit L/${DEFLECTION_N} ("no visible sag") · safety factor ${FS} on yield`,
    `House max span caps the engineered figure: ${ROUND_SIZES.map(s => `${s.label} ${s.maxSpan}"`).join(' · ')} · 2" alum ${ALUM_MAX_SPAN}"`,
    `Steel E ${(STEEL.E / 1e6).toFixed(0)} Msi, yield ${STEEL.yield.toLocaleString()} psi (1018 cold-drawn) · 14 ga wall ${GAUGE_WALL[14]}", 16 ga wall ${GAUGE_WALL[16]}"`,
    `Aluminium E ${(ALUM.E / 1e6).toFixed(0)} Msi, yield ${ALUM.yield.toLocaleString()} psi (6063-T5) · ${ALUM_PROFILE.h}" × ${ALUM_PROFILE.w}" × ${ALUM_PROFILE.t}" wall, strong axis only`,
    'Single span simply supported between brackets, uniform load, brackets anchored to studs.',
];
