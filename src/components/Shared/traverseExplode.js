// TRAVERSE ORDER → COMPONENT CONSUMPTION (Stuart 2026-08-13): "in netsuite you do not need to push
// these kits but rather all of the components so they are consumed in inventory... one generic
// traverse non inventory item ... to make the amounts match and then the lines of the actual items
// to be consumed." Pure module — the quantities that hit stock deserve node tests.
//
// The explosion covers what the sheet DEFINES for a bare system: fascia, track(s), brackets by the
// per-length count table, splices by the same table, and the ends (plugs manual / the chosen motor
// motorized). Carriers and the configurator items land when the configurator does (step 4) — every
// caller should surface `skipped` so nobody mistakes a partial consumption for a complete one.

const U = (v) => String(v ?? '').trim().toUpperCase();

// Family part codes for H1-2TRV. Data-shaped (per family) rather than logic-shaped so the next
// traverse family is an entry here, not an edit below.
export const TRAVERSE_FAMILY_PARTS = {
    'H1-2TRV': {
        fascia: { W: 'H1-2RCTWR', P: 'H1-2RCTAR', EP: 'H1-2RCTAR' },   // wood vs aluminum
        track: 'H1-2TRVTRK/C',
        plug: 'H1-2TRVPLUG',
        baseMotor: 'HSOM-21',
        // ⚠ A SINGLE'S BRACKET IS THREE ITEMS, ONE PER PROJECTION (Stuart 2026-08-22, refining tab
        // 7). The sheet has said so all along — H1-2TRV-WB "STANDARD" 3.625, H1-2TRV-EWB "EXTENDED"
        // 4.625, H1-2TRV-6WB "EXTENDED 6" — and the Carrier Usage chart carries a separate count row
        // for each of the three. Quick Ship never asked, so every single-track order consumed the
        // 3.625 bracket whatever depth was actually sold. A DOUBLE has no projection (one bracket
        // carries both rods), which is why only the singles are keyed this way.
        brackets: { SINGLE: { '3.625': 'H1-2TRV-WB', '4.625': 'H1-2TRV-EWB', '6': 'H1-2TRV-6WB' }, DOUBLE_TRACK: 'H1-2TRV-DWB', DOUBLE_RING: 'H1-2TRV-DRTWB', CEILING: 'H1-2TRV-CB' },
        // The return arm matching each projection. Not exploded (end treatments bill as their own
        // lines) — carried so a surface that asks for a projection can name the arm that fits it.
        returnArms: { '3.625': 'H1-2TRVSRA', '4.625': 'H1-2TRVERA', '6': 'H1-2TRV6RA' },
        splice: 'H1-2TRVSPLC',
        frontRingPole: 'H1-2RCTPR',
    },
};

// A decimal projection in the language the shop and the sheet use: 3.625 → 3-5/8". Generic to
// sixteenths rather than a lookup, so a depth nobody has sold yet still reads properly.
export const projLabel = (v) => {
    const n = parseFloat(v);
    if (!Number.isFinite(n)) return String(v ?? '');
    const whole = Math.floor(n);
    const frac = Math.round((n - whole) * 16);
    if (!frac) return `${whole}"`;
    const gcd = (a, b) => (b ? gcd(b, a % b) : a);
    const d = gcd(frac, 16);
    return `${whole}-${frac / d}/${16 / d}"`;
};

/**
 * The projections a SINGLE sells, derived from the bracket map so a fourth depth is a data edit
 * here and not a change to any screen. `standard` marks the shallowest — the one the sheet calls
 * STANDARD and the one an order falls back to when nobody asked.
 */
export const singleProjections = (family = 'H1-2TRV') => Object.entries(TRAVERSE_FAMILY_PARTS[family]?.brackets?.SINGLE || {})
    .map(([inches, code]) => ({ inches, code, label: projLabel(inches), returnArm: TRAVERSE_FAMILY_PARTS[family]?.returnArms?.[inches] || '' }))
    .sort((a, b) => parseFloat(a.inches) - parseFloat(b.inches))
    .map((p, i) => ({ ...p, standard: i === 0 }));

// qty at a length from a rules usage row ({ byFeet: {2: n … 36: n} }) — exact foot, else the next
// table entry UP (a 4.5ft system needs 5ft's bracket count, never 4ft's).
export const usageAt = (row, feet) => {
    const by = row?.byFeet || {};
    if (by[feet] !== undefined) return by[feet];
    const keys = Object.keys(by).map(Number).sort((a, b) => a - b);
    const up = keys.find(k => k >= feet);
    return up !== undefined ? by[up] : (keys.length ? by[keys[keys.length - 1]] : 0);
};

/**
 * One traverse system → the component lines NetSuite consumes.
 * `rules` = the system/traverse_rules_<family> doc (usage rows). Returns { lines, skipped } where
 * lines = [{ code, qty, why }] and skipped = human notes for what is NOT consumed yet.
 */
export function explodeTraverse({ family = 'H1-2TRV', align, feet, motorItem, rules, proj }) {
    const P = TRAVERSE_FAMILY_PARTS[family];
    if (!P || !align) return { lines: [], skipped: ['unknown family — nothing exploded'] };
    const ft = Math.max(parseInt(feet) || 4, align.minFeet || 4);
    const setup = U(align.setup); const ring = U(align.frontRail) === 'RING';
    const lines = []; const skipped = [];
    const add = (code, qty, why) => { if (code && qty > 0) lines.push({ code: U(code), qty, why }); };

    add(P.fascia[U(align.material)] || P.fascia.P, ft, 'fascia (per ft)');
    add(P.track, ft * (setup === 'DOUBLE' && !ring ? 2 : 1), setup === 'DOUBLE' && !ring ? 'two tracks (per ft)' : 'track (per ft)');
    if (ring) { add(P.frontRingPole, 1, 'front ring pole'); skipped.push('ring COUNT rides the configurator — front pole consumed, rings not yet'); }

    // The single's bracket follows the PROJECTION sold. No projection given = the standard depth,
    // which is what every order consumed before the question was asked — so an older caller, and a
    // cart line saved before this existed, still explode exactly as they did.
    const singles = singleProjections(family);
    const singleHit = singles.find(p => p.inches === String(proj ?? '').trim()) || singles[0];
    const singleCode = singleHit ? singleHit.code : '';
    const bracketCode = U(align.mount) === 'CEILING' ? P.brackets.CEILING
        : setup === 'DOUBLE' ? (ring ? P.brackets.DOUBLE_RING : P.brackets.DOUBLE_TRACK)
        : singleCode;
    const bracketRow = (rules?.usage || []).find(u => U(u.itemId) === U(bracketCode))
        || (rules?.usage || []).find(u => U(u.itemId) === U(singleCode));
    add(bracketCode, bracketRow ? usageAt(bracketRow, ft) : 2, 'brackets (count table)');
    if (U(align.mount) === 'CEILING' && !(rules?.usage || []).some(u => U(u.itemId) === U(P.brackets.CEILING)))
        skipped.push('ceiling bracket count uses the standard table — confirm when ceiling lands in the flow');
    if (setup === 'SINGLE' && !String(proj ?? '').trim())
        skipped.push('no projection on this line — consumed the standard ' + singleCode + ' (' + (singleHit ? singleHit.label : '') + ')');

    const spliceRow = (rules?.usage || []).find(u => U(u.itemId) === U(P.splice));
    const splices = spliceRow ? usageAt(spliceRow, ft) : 0;
    if (splices > 0) add(P.splice, splices, 'splices (count table)');

    if (U(align.drive) === 'MOTORIZED') add(U(motorItem) || P.baseMotor, 1, 'motor');
    else add(P.plug, 2, 'end plugs (manual, both ends)');

    skipped.push('carriers + configurator items consume when the configurator ships');
    return { lines, skipped };
}
