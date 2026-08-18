// ─────────────────────────────────────────────────────────────────────────────────────────────
// READING THE DESIGNER'S OWN WORDS (Stuart 2026-08-18)
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// "she needs flexibility in what slots are created and in what the nodes are called as fusion does
//  this automatically and is a lot of work for her to change… the H1 assembly notes is how she likes
//  it. i need you to try and keep this way but add in all the tag fields that we need."
//
// Her sheet already carries a TAG column, and it is not decoration — it is the whole specification,
// written the way a person describes a part:
//
//     "Pole Left Front"            a pole, left piece, front rod
//     "inL Bracket Arm 4 left"     an in-line bracket at 4-5/8", left
//     "Dec-Back-Cover Plates 4 ce" a backplate at 4-5/8", centre
//     "FR 4 LEFT"                  a french return at 4-5/8", left
//     "Ceiling Bracket Arm Center" a bracket, ceiling mount, centre
//     "Hide"                       built and billed, never drawn
//
// Asking her to restate all of that in eight dropdowns would be asking her to write it twice, and
// the second telling is where a mistake goes in. So this reads the phrase and fills the tags; she
// corrects the odd one from a dropdown instead of entering all of them. The words below are HERS,
// taken from two of her sheets — this is a vocabulary, not a guess, and it grows by adding a word.
//
// It never overrides a tag that is already set: an explicit dropdown always wins over a phrase.

const U = (s) => String(s == null ? '' : s).trim().toUpperCase();

// A word she uses → what it means. Longest match wins, so "INSIDE MOUNT" beats "MOUNT".
const CATEGORY_WORDS = [
    ['INSIDE MOUNT', 'INSIDE_MOUNT'], ['IM ', 'INSIDE_MOUNT'],
    ['COVER PLATE', 'BACKPLATE'], ['COVER PLATES', 'BACKPLATE'], ['BACK-COVER', 'BACKPLATE'],
    ['BACKPLATE', 'BACKPLATE'], ['BACK PLATE', 'BACKPLATE'], ['COVERPLATE', 'BACKPLATE'],
    ['BRACKET', 'BRACKET'], ['ARM', 'BRACKET'],
    ['FINIAL', 'FINIAL'], ['END CAP', 'FINIAL'],
    ['CARRIER', 'CARRIER'], ['RING', 'RING'],
    ['POLE', 'POLE'], ['ROD', 'POLE'],
    ['FR-MTR', 'RETURN'], ['FR-MT', 'RETURN'], ['FRENCH', 'RETURN'], ['MITER', 'RETURN'],
    ['MTR', 'RETURN'], ['FR ', 'RETURN'],
];

const PROJECTION_WORDS = [
    [/\b8[.\-]?5\b/, '8.5'], [/\b6[.\-]?5\b/, '6.5'], [/\b4[\s\-]?5\/8\b|\b4\.625\b|\b4\b/, '4.625'],
    [/\b3[\s\-]?5\/8\b|\b3\.625\b|\b3\b/, '3.625'], [/\b3[.\-]?25\b/, '3.25'], [/\b6\b/, '6'],
];

/**
 * What her phrase says. Everything is optional — a phrase that mentions nothing returns nothing,
 * which is exactly right for "Hide".
 *
 * @param phrase her TAG cell
 * @returns { cat, position, tier, proj, mount, hide, basic, inline } — only what was actually said
 */
export function tagsFromPhrase(phrase) {
    const p = ` ${U(phrase).replace(/[_]+/g, ' ')} `;
    if (!p.trim()) return {};
    const out = {};

    // ── what it IS ───────────────────────────────────────────────────────────────────────────
    for (const [word, cat] of CATEGORY_WORDS) {
        if (p.includes(` ${word}`) || p.includes(word)) { out.cat = cat; break; }
    }

    // ── WHERE ALONG the rod. "SHORT" is her word for the centre piece of a three-piece pole. ──
    if (/\bLEFT\b/.test(p)) out.position = 'LEFT';
    else if (/\bRIGHT\b|\bRONT\b/.test(p)) out.position = 'RIGHT';     // "Ront" — her typo, twice
    else if (/\bCENTER\b|\bCENTRE\b|\bSHORT\b|\bPASSING\b/.test(p)) out.position = 'CENTER';

    // ── WHICH ROD of a double ────────────────────────────────────────────────────────────────
    if (/\bBACK\b|\bREAR\b/.test(p) && !/BACK[- ]?COVER|BACKPLATE|BACK PLATE/.test(p)) out.tier = 'BACK';
    else if (/\bFRONT\b/.test(p)) out.tier = 'FRONT';

    // ── how far off the wall ─────────────────────────────────────────────────────────────────
    for (const [rx, v] of PROJECTION_WORDS) { if (rx.test(p)) { out.proj = v; break; } }

    // ── the rest ─────────────────────────────────────────────────────────────────────────────
    if (/\bCEILING\b/.test(p)) out.mount = 'CEILING';
    if (/\bHIDE\b|\bHIDDEN\b/.test(p)) out.hide = true;
    if (/\bBASIC\b/.test(p)) out.basic = true;
    if (/\bINL\b|\bIN-?L\b|\bINLINE\b|\bIN LINE\b/.test(p)) out.inline = true;
    if (/\bDBL\b|\bDOUBLE\b/.test(p)) out.setup = 'DOUBLE';
    if (/\bTRV\b|\bTRAV\b|\bTRAVERSE\b/.test(p)) out.traverse = true;
    if (/\bWOOD\b/.test(p)) out.materials = 'WOOD';
    else if (/\bACRYLIC\b|\bCLEAR\b/.test(p)) out.materials = 'CLEAR';
    return out;
}

// ── "DUPLICATE LEFT AND RIGHT" ───────────────────────────────────────────────────────────────
// Her Claude column. She models a part ONCE, at whichever position Fusion put it, and says where
// else it belongs. Left and right of a curtain rod are the same part mirrored about the centre of
// the pole, and a centre bracket is that part moved to the middle — so this is geometry, not
// modelling, and there is no reason she should be doing it by hand.
const POSITION_WORDS = { LEFT: 'LEFT', RIGHT: 'RIGHT', CENTER: 'CENTER', CENTRE: 'CENTER', CENTRE_: 'CENTER' };

/** The positions a clone instruction asks for. "DUPLICATE CENTER AND RIGHT" → ['CENTER','RIGHT'] */
export function clonesFromPhrase(phrase) {
    const p = U(phrase);
    if (!/\bDUPLICATE\b|\bCLONE\b|\bCOPY\b|\bMIRROR\b/.test(p)) return [];
    const out = [];
    Object.entries(POSITION_WORDS).forEach(([word, pos]) => {
        if (new RegExp(`\\b${word}\\b`).test(p) && !out.includes(pos)) out.push(pos);
    });
    return out;
}
