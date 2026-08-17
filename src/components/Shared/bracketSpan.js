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
// Cast acrylic (PMMA). An order of magnitude less stiff than steel and it CREEPS — it keeps
// deflecting under a load it has already carried — so the published cap matters more here than the
// beam figure does.
const ACRYLIC = { E: 420000, yield: 10000 };   // psi · cast PMMA
const FS = 2;            // safety factor on yield
// SAG LIMIT — tightened from the workbook's L/180 to L/360 (Stuart 2026-07-28: "those spans are
// way too long, let's set it industry best practice"). L/180 is a structural limit borrowed from
// building codes, where the beam is hidden; a curtain rod is judged BY EYE, so it has to be far
// tighter. L/360 is the standard "no visible sag" figure for exposed decorative work.
const DEFLECTION_N = 360;
const GAUGE_WALL = { 14: 0.083, 16: 0.065 };   // Birmingham Wire Gauge, tube standard
// The 2" rectangular aluminium extrusion, outside dimensions + uniform wall.
const ALUM_PROFILE = { h: 2, w: 0.75, t: 0.105 };
// FLAT IRON (M2C) — 1.5" tall × 0.5" wide, 16 ga mild steel, rectangular. Mounted the STRONG way,
// i.e. the 1.5" dimension vertical; like the aluminium, we don't offer it laid over.
const FLAT_IRON_PROFILE = { h: 1.5, w: 0.5, t: GAUGE_WALL[16] };

// TRAVERSE — 1-3/8" round extruded aluminium, 0.125" side wall, carried by both Fabricut H1 and
// Simple Elegance. It is the one rod where sag is not merely cosmetic: an internal track runs the
// carriers, and a bowed track binds them. So it is held to a far tighter standard than a decorative
// rod — roughly 3.5× the L/360 "no visible sag" figure — which is what puts a heavy 10 ft curtain
// at the 48" Stuart specified. Everything else about it (loads, fullness, safety factor) is
// unchanged; only the sag limit and the cap differ.
const TRAVERSE_PROFILE = { od: 1.375, wall: 0.125 };
const TRAVERSE_DEFLECTION_N = 1250;
// Between the 3/4" (48") and 1" (60") rounds, per Stuart — a track that has to stay true doesn't
// get to span like a solid rod of the same diameter.
const TRAVERSE_MAX_SPAN = 54;

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
// noStud = the span when the bracket lands in drywall on a toggle rather than in a stud. It is a
// DIFFERENT failure: nothing to do with the tube, everything to do with what the anchor will hold
// and how it loosens as the curtain is drawn. So it is a flat house cap, not a calculation.
//
// ⚠ THESE NO-STUD FIGURES ARE PROVISIONAL — conservative starting points, not engineering Stuart
// has signed off. They are in one editable place for exactly that reason; confirm them before any
// quote leans on them.
const ROUND_SIZES = [
    { od: 0.5, label: '1/2"', maxSpan: 36, noStud: 24 },
    { od: 0.75, label: '3/4"', maxSpan: 48, noStud: 32 },
    { od: 1, label: '1"', maxSpan: 60, noStud: 36 },
    { od: 1.375, label: '1-3/8"', maxSpan: 72, noStud: 42 },
];

// SOLID round — an acrylic rod is not a tube. I = π d⁴ / 64.
const solidRoundSection = (d) => {
    const I = (Math.PI * Math.pow(d, 4)) / 64;
    return { I, c: d / 2, S: I / (d / 2) };
};

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
const ALUM_NO_STUD = 42;
// ACRYLIC — Stuart 2026-08-17: "acrylic will sag very easy and the limit is 36\" whether brackets
// are in a stud or not." The same figure both ways because the binding constraint is the material
// creeping, not the anchor: a stud does not stop a plastic rod from bowing under its own weight
// over time, so there is nothing for the better fixing to buy.
const ACRYLIC_MAX_SPAN = 36;
// Flat Iron carries the same 72" cap as the 1-3/8" round: its stiffness (I ≈ 0.0613 in⁴) sits just
// ABOVE the 1-3/8" 16 ga round (0.0575), so a tighter cap here would be inconsistent rather than
// cautious. Same one-number lever as the others if that judgement should change.
const FLAT_IRON_MAX_SPAN = 72;

// crmCollection ties a rod family to the collection tag used everywhere else in the app — the same
// vocabulary as hq_collections and the "Available Collections" checkboxes on the CRM Portal Access
// panel. That's what lets the portal show a Fabricut customer only the Fabricut rods.
export const ROD_COLLECTIONS = [
    { id: 'H1', brand: 'ce', label: 'Fabricut H1', crmCollection: 'FABRICUT H1', note: '14 ga steel, the 2" aluminium extrusion, and the 1-3/8" traverse' },
    { id: 'H2', brand: 'ce', label: 'Simple Elegance', crmCollection: 'SIMPLE ELEGANCE', note: '16 ga steel and the 1-3/8" traverse' },
    { id: 'FLATIRON', brand: 'm2c', label: 'Flat Iron', crmCollection: 'FLAT IRON', note: '1.5" × 1/2" 16 ga steel flat bar' },
];

// The rod families to show, narrowed by BRAND first and then by the customer's CRM
// portalCollections. Brand first because a customer never buys another brand's hardware, whatever
// their collection tags say. An EMPTY/absent collection list means no restriction WITHIN the brand
// — the same rule the catalog gate uses, so turning entitlement on for one customer never blanks
// the page for everyone else. A blank brand means "don't filter by brand" (staff, all brands).
export function rodCollectionsFor(allowedNames, brandId) {
    const brand = String(brandId || '').trim().toLowerCase();
    const inBrand = brand ? ROD_COLLECTIONS.filter(c => c.brand === brand) : ROD_COLLECTIONS;
    const allowed = (Array.isArray(allowedNames) ? allowedNames : [])
        .map(c => String(c || '').trim().toUpperCase()).filter(Boolean);
    if (!allowed.length) return inBrand;
    const set = new Set(allowed);
    // A customer entitled only to collections this guide doesn't cover would otherwise see an empty
    // page; showing everything is the wrong answer, so the caller renders the "ask us" note instead.
    return inBrand.filter(c => set.has(c.crmCollection));
}

export const RODS = [
    ...ROUND_SIZES.map(s => ({
        id: `H1-${s.od}`, collection: 'H1', label: `${s.label} round`, material: 'Steel',
        section: roundSection(s.od, GAUGE_WALL[14]), metal: STEEL, maxSpan: s.maxSpan, noStudSpan: s.noStud,
    })),
    // The acrylic rod is its own row, not a variant of the steel one — same diameter, a twentieth
    // of the stiffness.
    {
        id: 'H1-ACR-1.375', collection: 'H1', label: '1-3/8" acrylic', material: 'Acrylic',
        section: solidRoundSection(1.375), metal: ACRYLIC,
        maxSpan: ACRYLIC_MAX_SPAN, noStudSpan: ACRYLIC_MAX_SPAN,
        note: 'Acrylic creeps under load — 36" whether or not the bracket lands in a stud.',
    },
    ...ROUND_SIZES.map(s => ({
        id: `H2-${s.od}`, collection: 'H2', label: `${s.label} round`, material: 'Steel',
        section: roundSection(s.od, GAUGE_WALL[16]), metal: STEEL, maxSpan: s.maxSpan, noStudSpan: s.noStud,
    })),
    {
        id: 'H1-ALU2', collection: 'H1', label: '2" rectangular', material: 'Aluminium',
        section: rectSection(ALUM_PROFILE.h, ALUM_PROFILE.w, ALUM_PROFILE.t), metal: ALUM, maxSpan: ALUM_MAX_SPAN,
    },
    {
        id: 'FLATIRON-15', collection: 'FLATIRON', label: '1-1/2" × 1/2" flat', material: 'Steel',
        section: rectSection(FLAT_IRON_PROFILE.h, FLAT_IRON_PROFILE.w, FLAT_IRON_PROFILE.t), metal: STEEL, maxSpan: FLAT_IRON_MAX_SPAN,
    },
    // The traverse rod is the same extrusion in both collections — one physical rod, listed under
    // each product line that sells it.
    ...['H1', 'H2'].map(col => ({
        id: `${col}-TRAV138`, collection: col, label: '1-3/8" traverse', material: 'Aluminium',
        section: roundSection(TRAVERSE_PROFILE.od, TRAVERSE_PROFILE.wall), metal: ALUM,
        maxSpan: TRAVERSE_MAX_SPAN, deflectionN: TRAVERSE_DEFLECTION_N,
        note: 'internal track — held flat so the carriers run',
    })),
];

// ---- The answer -------------------------------------------------------------------------------
// Engineered span in INCHES for one rod under a given load, BEFORE the house cap. Null for a
// non-positive load.
export function engineeredSpanInches(rod, loadLbPerFt) {
    const w = (Number(loadLbPerFt) || 0) / 12; // lb/in
    if (!(w > 0) || !rod || !rod.section) return null;
    const { I, S } = rod.section;
    // A rod may demand a tighter sag limit than the decorative default — the traverse track does,
    // because a bowed track binds its carriers.
    const n = rod.deflectionN || DEFLECTION_N;
    const sag = Math.pow((384 * rod.metal.E * I) / (n * 5 * w), 1 / 3);
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
            // The no-stud figure is the SMALLER of the engineered span and the anchor cap — a
            // toggle in drywall never buys more than the beam allows, and usually a good deal less.
            const noStudCap = r.noStudSpan || ALUM_NO_STUD;
            const noStud = eng === null ? null : Math.min(eng, r.maxSpan || Infinity, noStudCap);
            return {
                ...r,
                spanInches: capped === null ? null : Math.floor(capped),
                spanFeet: capped === null ? null : Math.floor(capped) / 12,
                noStudInches: noStud === null ? null : Math.floor(noStud),
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
    `House max span caps the engineered figure: ${ROUND_SIZES.map(s => `${s.label} ${s.maxSpan}"`).join(' · ')} · 2" alum ${ALUM_MAX_SPAN}" · flat iron ${FLAT_IRON_MAX_SPAN}" · 1-3/8" acrylic ${ACRYLIC_MAX_SPAN}"`,
    `NOT IN A STUD — a separate, tighter cap, because the anchor fails before the tube does: ${ROUND_SIZES.map(s => `${s.label} ${s.noStud}"`).join(' · ')} · alum ${ALUM_NO_STUD}". PROVISIONAL house numbers, to be confirmed.`,
    `Acrylic ${ACRYLIC_MAX_SPAN}" in a stud or not — cast PMMA at E ${(ACRYLIC.E / 1000).toFixed(0)} ksi creeps under sustained load, so a better fixing buys nothing`,
    `Flat Iron (M2C): ${FLAT_IRON_PROFILE.h}" × ${FLAT_IRON_PROFILE.w}" × ${FLAT_IRON_PROFILE.t}" wall 16 ga mild steel, strong axis (1.5" vertical) only`,
    `Traverse (H1 + H2): ${TRAVERSE_PROFILE.od}" round aluminium, ${TRAVERSE_PROFILE.wall}" wall, held to L/${TRAVERSE_DEFLECTION_N} (not L/${DEFLECTION_N}) and capped at ${TRAVERSE_MAX_SPAN}" — the internal track has to stay true or the carriers bind`,
    `Steel E ${(STEEL.E / 1e6).toFixed(0)} Msi, yield ${STEEL.yield.toLocaleString()} psi (1018 cold-drawn) · 14 ga wall ${GAUGE_WALL[14]}", 16 ga wall ${GAUGE_WALL[16]}"`,
    `Aluminium E ${(ALUM.E / 1e6).toFixed(0)} Msi, yield ${ALUM.yield.toLocaleString()} psi (6063-T5) · ${ALUM_PROFILE.h}" × ${ALUM_PROFILE.w}" × ${ALUM_PROFILE.t}" wall, strong axis only`,
    'Single span simply supported between brackets, uniform load, brackets anchored to studs.',
];

// ── WHICH SPAN ROW GOVERNS A GIVEN ITEM (Stuart 2026-08-17) ────────────────────────────────────
// The CPQ knows the customer chose "H1-138R". This table knows about "H1-1.375" — a rod FAMILY,
// identified by collection and outside diameter. Something has to join them, and Stuart's call was
// that the link belongs HERE rather than as a tag on every rod variant:
//
//   "yes rule based, we already are setting these rules up tab 6.5 so please add the field there."
//
// It is the one place in the hardware work where a fact deliberately does NOT live on the part, and
// the reason is that it is not a fact about the part: the span comes from the family's ENGINEERING —
// section, wall, metal — which is exactly what this module already models. A dozen rows carry it;
// hundreds of rod variants would only repeat it, and repeat it wrongly the first time someone adds
// a length without thinking about beams.
//
// The map is { rodId: "H1-138R, H1-138AR, H1-138WR" } — whatever item codes that family covers,
// however they are spelled. Matching ignores case, punctuation and any finish suffix, because a
// /P or /EP variant is the same steel tube.
const spanKey = (v) => String(v || '').trim().toUpperCase().split('/')[0].replace(/[^A-Z0-9]/g, '');

/** The RODS entry that governs an item code, or null when nothing claims it. */
export function rodForItemCode(code, map) {
    const want = spanKey(code);
    if (!want || !map) return null;
    const hit = Object.entries(map).find(([, codes]) =>
        String(codes || '').split(/[,;|\n]+/).map(spanKey).filter(Boolean).includes(want));
    return hit ? (RODS.find(r => r.id === hit[0]) || null) : null;
}

/**
 * The bracket recommendation for one configuration, or null when it cannot be made honestly.
 *
 * Returns the span this rod carries, how many brackets the length needs, and WHY the span is what
 * it is — because "why is this 3?" deserves an answer at the point of quoting, not a trip to 6.5.
 */
export function bracketAdviceFor({ itemCode, map, rodInches, fabricId, dropFt }) {
    const rod = rodForItemCode(itemCode, map);
    if (!rod || !(rodInches > 0)) return null;
    const drop = Number(dropFt) > 0 ? Number(dropFt) : DEFAULT_DROP_FT;
    const row = spanTable(fabricId, drop, rod.collection).find(r => r.id === rod.id);
    if (!row || !row.spanInches) return null;
    return {
        rod, spanInches: row.spanInches, limitedBy: row.limitedBy,
        brackets: bracketsFor(rodInches, row.spanInches),
        why: row.limitedBy === 'LOAD' ? 'limited by fabric weight' : 'our maximum span',
    };
}
