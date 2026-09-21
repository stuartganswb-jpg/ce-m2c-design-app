// ITEM PICTURES FROM A DRAWING — matched by FILENAME, exactly, never by guess.
//
// Stuart 2026-09-21: the H1-2TRV bracket arms are welded together in the Fusion file, so they do
// not come apart into separate nodes and 4.5's GLB render — which photographs a part's own nodes
// out of the assembly — has nothing to photograph. There is no picture for those parts and no way
// to make one from the model. A dimensioned shop drawing of the seven arms exists, so each arm is
// cut out of it as its own PNG named for the item, and this is the reader that puts them on the
// right records.
//
// ⚠ WHY NOT 14.5. The Batch Image Processor already uploads pictures and stamps items, but it
// derives the item code by splitting the filename on its last hyphen and treating a piece of six
// characters or fewer as a FINISH code. Four of these seven filenames lose against that rule:
//
//      H1-2TRVBDBL-MA   → pattern H1-2TRVBDBL  + finish MA   (the assembled double bracket)
//      H1-2TRVBDBL-TA   → pattern H1-2TRVBDBL  + finish TA   (same wrong part)
//      H1-2TRVBADBL-T   → pattern H1-2TRVBADBL + finish T    (the 6.87" arm)
//      H1-2TRVBA        → pattern H1           + finish 2TRVBA
//
// Three of those land on REAL parts, so the picture would go quietly onto the wrong item. Here the
// filename IS the item code, whole, and a code that does not resolve to exactly one library record
// is refused by name rather than approximated. 14.5 also stamps GALLERY — "a real photograph" —
// which would then refuse a genuine photograph later; a drawing is a stand-in and says so.
//
// Pure: no Firestore, no canvas. The caller reads the library and does the uploading.

const U = (v) => String(v == null ? '' : v).trim().toUpperCase();

/**
 * "H1-2TRVBDBL-MA.png" → "H1-2TRVBDBL-MA". The whole name, minus the extension. Nothing is split.
 * Trimmed BEFORE the extension is stripped: the pattern is anchored to the end, so a trailing
 * space left the ".png" on the code and turned a good file into a NO_MATCH.
 */
export const codeFromFilename = (name) => U(String(name || '').trim().replace(/\.[A-Za-z0-9]+$/, ''));

/**
 * CODE → the library records carrying it, over both identity fields. A list, not a single part,
 * because two records sharing one code is a data fault this must SAY rather than resolve.
 */
export const buildCodeIndex = (parts = []) => {
    const m = new Map();
    (parts || []).forEach(p => {
        if (!p) return;
        [p.legacyErpId, p.itemId].forEach(k => {
            const key = U(k);
            if (!key) return;
            const cur = m.get(key);
            if (!cur) m.set(key, [p]);
            else if (!cur.some(x => x.id === p.id)) cur.push(p);
        });
    });
    return m;
};

export const DRAW_READY = 'READY';
export const DRAW_NO_CODE = 'NO_CODE';
export const DRAW_NO_MATCH = 'NO_MATCH';
export const DRAW_AMBIGUOUS = 'AMBIGUOUS';
export const DRAW_DUPLICATE = 'DUPLICATE';
export const DRAW_HAS_PHOTO = 'HAS_PHOTO';

/**
 * What this batch of files would do, decided before anything is written.
 * @param {{name:string}[]} files  the dropped files (only `name` is read here)
 * @param {object[]} parts         the library records in scope (the active brand's)
 * @param {(part)=>boolean} hasPhoto  true when the record already holds a REAL photograph
 * @returns rows [{ file, code, part, status, why }] in the order given
 */
export const planDrawingImport = ({ files = [], parts = [], hasPhoto = () => false }) => {
    const index = buildCodeIndex(parts);
    const claimed = new Map();                       // code → the file that already took it
    return (files || []).map(f => {
        const file = String((f && f.name) || '');
        const code = codeFromFilename(file);
        const row = { file, code, part: null };
        if (!code) return { ...row, status: DRAW_NO_CODE, why: 'no code could be read from the filename' };
        const hits = index.get(code) || [];
        if (!hits.length) return { ...row, status: DRAW_NO_MATCH, why: `no item on this brand carries the code ${code}` };
        if (hits.length > 1) return { ...row, status: DRAW_AMBIGUOUS, why: `${hits.length} items carry the code ${code} — not guessing which` };
        const part = hits[0];
        if (claimed.has(code)) return { ...row, part, status: DRAW_DUPLICATE, why: `${claimed.get(code)} already claimed ${code} in this batch` };
        claimed.set(code, file);
        if (hasPhoto(part)) return { ...row, part, status: DRAW_HAS_PHOTO, why: 'already has a real photograph — left alone' };
        return { ...row, part, status: DRAW_READY, why: '' };
    });
};

/** Counts by status, for the confirmation the operator reads before anything is written. */
export const drawingSummary = (rows = []) => (rows || []).reduce((m, r) => {
    if (r && r.status) m[r.status] = (m[r.status] || 0) + 1;
    return m;
}, {});

/** The plan in words — every file accounted for, so nothing is skipped silently. */
export const drawingPlanText = (rows = []) => {
    const ready = rows.filter(r => r.status === DRAW_READY);
    const rest = rows.filter(r => r.status !== DRAW_READY);
    const line = (r) => `  • ${r.file} → ${r.part ? (r.part.itemName || r.code) : r.code}`;
    return [
        ready.length ? `${ready.length} picture(s) will be written:\n${ready.map(line).join('\n')}` : 'Nothing to write.',
        rest.length ? `\n${rest.length} file(s) will be SKIPPED:\n${rest.map(r => `  • ${r.file} — ${r.why}`).join('\n')}` : '',
    ].filter(Boolean).join('\n');
};
