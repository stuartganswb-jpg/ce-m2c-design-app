// UNIQUITY SOFT GOODS — reading an item code out of a photo folder's name.
//
// Stuart 2026-08-27: "i have folders saved that mostly align with these pillows, the folder has the
// name (Bubley) the color (01, 80, etc.) and the pillow size 20x12, 23x23, etc."
//
// The library codes these as ONE string: pattern, then a variant token that packs colour, kind and
// size together.
//
//     Bubley/01P20x12   pattern Bubley · colour 01 · Pillow · 20 × 12
//     Bubley/01P23x23   a square pillow
//     Bubley/01T        a throw — no size
//     Bubley/01T-XL     the XL throw
//     Bubley/11P19x19   colour 11
//
// "MOSTLY ALIGN" IS THE DESIGN CONSTRAINT. A folder is a person's filing, not a key: separators
// vary, the size may be written 20 x 12, and a colour may be typed 1 instead of 01. So this reads
// tolerantly and REPORTS what it read — the caller shows the resolved code and checks it against
// the library before anything is written. Nothing here decides on its own that a photo belongs to
// an item; it only proposes, and an unresolved folder is handed back for a human to name.

const CLEAN = (s) => String(s == null ? '' : s).trim();

// 20x12 · 20 x 12 · 20X12 · 20×12 — the size anywhere in the name.
const SIZE_RE = /(\d{1,3})\s*[x×X]\s*(\d{1,3})/;
// A standalone colour number: 01, 1, 11, 80. Bounded so it never eats half a size.
const COLOR_RE = /(?:^|[^0-9A-Za-z])(\d{1,3})(?![0-9]*\s*[x×X]\s*\d)(?![0-9A-Za-z])/;
const XL_RE = /(?:^|[^A-Za-z])(XL)(?![A-Za-z])/i;
const THROW_RE = /(?:^|[^A-Za-z])(THROWS?|T)(?![A-Za-z])/i;

/** Colours are two digits in the library codes (01, 11, 80) — a typed "1" means "01". */
export const padColor = (n) => {
    const d = CLEAN(n).replace(/\D/g, '');
    if (!d) return '';
    return d.length === 1 ? `0${d}` : d;
};

/**
 * Read a folder name into the pieces of a Uniquity soft-goods code.
 *
 * @param {string} folder e.g. "Bubley 01 20x12", "Bubley_80_23x23", "Bubley 01 Throw XL"
 * @returns {{pattern, color, kind, size, code, confident, why}|null}
 *   kind   'P' pillow | 'T' throw
 *   code   the proposed library code, e.g. "Bubley/01P20x12" — '' when it cannot be built
 *   confident  true only when a colour AND (a size or an explicit throw marker) were found.
 *              False means the caller must ask; it does NOT mean the parse is wrong.
 */
export function parsePillowFolder(folder) {
    const raw = CLEAN(folder);
    if (!raw) return null;

    // Strip a trailing extension and any leading numbering ("01 - Bubley…" style filing).
    const name = raw.replace(/\.[a-z0-9]{2,4}$/i, '');

    // ── THE FOLDER IS USUALLY THE CODE ITSELF ──────────────────────────────────────────────────
    // Stuart's folders read "Bubley:01p23x23" — which IS Bubley/01P23x23. macOS stores a folder
    // named with a slash by swapping it for a colon (Finder shows the slash, the filesystem and
    // the browser hand us the colon), so naming a folder after the item produces exactly this.
    //
    // The loose "Bubley 01 23x23" parse below could not read it: colour, kind and size run
    // together with no separators, so "01p" never looked like a standalone colour number and the
    // banner said "no colour number" on a folder that was already perfectly named. This form is
    // tried FIRST because it is the most exact thing a folder can say.
    //
    // THE SEPARATOR IS NOT THE POINT (Stuart 2026-08-27: "the folders are saved on dropbox and
    // maybe have : between the Bubley and /01 and on pc's they are seeing it with _"). The same
    // Dropbox folder reaches a Mac as ":", a PC as "_", and a browser that got the real name as
    // "/". Three spellings of ONE character, decided by whose machine is looking — so the
    // character is skipped rather than matched. What identifies the item is what sits either
    // side of it, which is the same everywhere.
    // …AND SOMETIMES THERE IS NO SEPARATOR AT ALL (Ashley 2026-08-31, her screenshot: the folder
    // reached the browser as "Dalton27P23x23"). A Mac swaps the slash for a colon; Windows/Dropbox
    // can simply DROP the illegal character instead of substituting one. So the separator is now
    // optional — zero or more. What anchors the split is the colour+kind+size token, not the
    // punctuation, and a lazy pattern takes the shortest name that leaves a valid one: "Dalton27P23x23"
    // splits as Dalton · 27 · P · 23x23, never Dalton2 · 7 · P.
    const direct = /^\s*([A-Za-z][A-Za-z0-9 _-]*?)\s*[:/_\-\s]*\s*(\d{1,3})\s*([PT])\s*(.*?)\s*$/i.exec(name);
    if (direct) {
        const dPattern = direct[1].trim();
        const dColor = padColor(direct[2]);
        const dKind = direct[3].toUpperCase();
        const rest = direct[4] || '';
        const dSizeM = SIZE_RE.exec(rest);
        const dSize = dSizeM ? `${Number(dSizeM[1])}x${Number(dSizeM[2])}` : '';
        const dXL = XL_RE.test(rest) || /^-?\s*XL$/i.test(rest.trim());
        // A P with no readable size, or a T with trailing text that is not XL, is not something to
        // guess at — fall through to the loose reader rather than invent half a code.
        if ((dKind === 'P' && dSize) || (dKind === 'T' && (!rest.trim() || dXL))) {
            const dVariant = `${dColor}${dKind}${dKind === 'P' ? dSize : (dXL ? '-XL' : '')}`;
            return {
                pattern: dPattern, color: dColor, kind: dKind, size: dSize, isXL: dXL,
                code: `${dPattern}/${dVariant}`, confident: true, why: [],
            };
        }
    }

    const sizeM = SIZE_RE.exec(name);
    const size = sizeM ? `${Number(sizeM[1])}x${Number(sizeM[2])}` : '';

    // Take the size out before looking for the colour, so "20x12" can never be read as colour 20.
    const noSize = sizeM ? name.replace(sizeM[0], ' ') : name;

    const isXL = XL_RE.test(noSize);
    // A lone "T"/"throw" token, or simply no size at all, means a throw.
    const saysThrow = THROW_RE.test(noSize.replace(XL_RE, ' '));
    const kind = size ? 'P' : 'T';

    const colorM = COLOR_RE.exec(noSize);
    const color = colorM ? padColor(colorM[1]) : '';

    // The pattern is what is left once size, colour and the kind words are removed: the leading
    // word(s) of the folder. Kept in the folder's own casing — library codes are "Bubley", not
    // "BUBLEY", and the item code is compared case-insensitively downstream anyway.
    const pattern = noSize
        .replace(colorM ? colorM[0] : '', ' ')
        .replace(/\b(XL|THROWS?|PILLOWS?|COLOU?R|SIZE|[TP])\b/gi, ' ')
        .replace(/[_\-.]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const variant = color ? `${color}${kind}${kind === 'P' ? size : (isXL ? '-XL' : '')}` : '';
    const code = pattern && variant ? `${pattern}/${variant}` : '';

    const why = [];
    if (!pattern) why.push('no pattern name');
    if (!color) why.push('no colour number');
    if (!size && !saysThrow && !isXL) why.push('no size, and nothing saying it is a throw');

    return {
        pattern, color, kind, size, isXL, code,
        confident: !!(pattern && color && (size || saysThrow || isXL)),
        why,
    };
}

/**
 * Match a proposed code against the library, tolerantly — the folder is filing, the library is
 * truth. Exact code first; then pattern + colour + size in any casing, which forgives a folder
 * written "Bubley 1 20 x 12" for the item Bubley/01P20x12.
 *
 * @param {object} parsed  from parsePillowFolder
 * @param {object[]} parts library records
 * @returns {{part, matchedBy}|null}  matchedBy: 'code' | 'parts'
 */
export function matchPillowPart(parsed, parts = []) {
    if (!parsed) return null;
    const U = (v) => String(v == null ? '' : v).trim().toUpperCase();
    const codeOf = (p) => U(p.legacyErpId && p.legacyErpId !== 'PENDING' ? p.legacyErpId : (p.itemId || ''));

    if (parsed.code) {
        const want = U(parsed.code);
        const exact = parts.find(p => codeOf(p) === want);
        if (exact) return { part: exact, matchedBy: 'code' };
    }
    if (!parsed.pattern || !parsed.color) return null;

    const pat = U(parsed.pattern);
    const wantVariant = `${parsed.color}${parsed.kind}${parsed.kind === 'P' ? U(parsed.size) : (parsed.isXL ? '-XL' : '')}`;
    const loose = parts.find(p => {
        const c = codeOf(p);
        const i = c.indexOf('/');
        if (i < 0) return false;
        return c.slice(0, i) === pat && c.slice(i + 1) === wantVariant;
    });
    return loose ? { part: loose, matchedBy: 'parts' } : null;
}

/** Split a resolved code into the { patternId, finishId } pair the Asset Gallery stores. */
export const galleryIdsFor = (code) => {
    const s = CLEAN(code);
    const i = s.indexOf('/');
    if (i < 0) return { patternId: s, finishId: '' };
    return { patternId: s.slice(0, i), finishId: s.slice(i + 1) };
};
