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
        brackets: { SINGLE: 'H1-2TRV-WB', DOUBLE_TRACK: 'H1-2TRV-DWB', DOUBLE_RING: 'H1-2TRV-DRTWB', CEILING: 'H1-2TRV-CB' },
        splice: 'H1-2TRVSPLC',
        frontRingPole: 'H1-2RCTPR',
    },
};

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
export function explodeTraverse({ family = 'H1-2TRV', align, feet, motorItem, rules }) {
    const P = TRAVERSE_FAMILY_PARTS[family];
    if (!P || !align) return { lines: [], skipped: ['unknown family — nothing exploded'] };
    const ft = Math.max(parseInt(feet) || 4, align.minFeet || 4);
    const setup = U(align.setup); const ring = U(align.frontRail) === 'RING';
    const lines = []; const skipped = [];
    const add = (code, qty, why) => { if (code && qty > 0) lines.push({ code: U(code), qty, why }); };

    add(P.fascia[U(align.material)] || P.fascia.P, ft, 'fascia (per ft)');
    add(P.track, ft * (setup === 'DOUBLE' && !ring ? 2 : 1), setup === 'DOUBLE' && !ring ? 'two tracks (per ft)' : 'track (per ft)');
    if (ring) { add(P.frontRingPole, 1, 'front ring pole'); skipped.push('ring COUNT rides the configurator — front pole consumed, rings not yet'); }

    const bracketCode = U(align.mount) === 'CEILING' ? P.brackets.CEILING
        : setup === 'DOUBLE' ? (ring ? P.brackets.DOUBLE_RING : P.brackets.DOUBLE_TRACK)
        : P.brackets.SINGLE;
    const bracketRow = (rules?.usage || []).find(u => U(u.itemId) === U(bracketCode))
        || (rules?.usage || []).find(u => U(u.itemId) === U(P.brackets.SINGLE));
    add(bracketCode, bracketRow ? usageAt(bracketRow, ft) : 2, 'brackets (count table)');
    if (U(align.mount) === 'CEILING' && !(rules?.usage || []).some(u => U(u.itemId) === U(P.brackets.CEILING)))
        skipped.push('ceiling bracket count uses the standard table — confirm when ceiling lands in the flow');
    if (setup === 'SINGLE') skipped.push('bracket assumed standard projection (' + P.brackets.SINGLE + ') — Quick Ship does not ask projection');

    const spliceRow = (rules?.usage || []).find(u => U(u.itemId) === U(P.splice));
    const splices = spliceRow ? usageAt(spliceRow, ft) : 0;
    if (splices > 0) add(P.splice, splices, 'splices (count table)');

    if (U(align.drive) === 'MOTORIZED') add(U(motorItem) || P.baseMotor, 1, 'motor');
    else add(P.plug, 2, 'end plugs (manual, both ends)');

    skipped.push('carriers + configurator items consume when the configurator ships');
    return { lines, skipped };
}
