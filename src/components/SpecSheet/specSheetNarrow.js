// specSheetNarrow.js — the 📐 pickers: choose your way to a sheet with the CPQ's own questions.
//
// Stuart 2026-08-23: "narrow the choices down … rod world, then setup, then projection, then arm."
// Every sheet carries the answers of the CPQ leaf it was built from, so the pickers are read back
// off the sheet list rather than asked of the engine a second time.
//
// 2026-09-30 (Stuart: "go with 1" · "go ahead"). Until today the solid sheets carried no answers,
// so only "Bracket arm" ever showed; and a leaf only carries the questions its world ASKED — the
// H1-2TRV solid world never asks setup or mount (all single, all wall), a double never asks mount
// or projection. With every picker open at once, answering a lower question first dropped sheets
// that never had it. So, as the configurator does:
//   · the questions are asked in the CPQ's order, each once the one above it is answered — a sheet
//     is only ever asked what its own world asked, and every sheet is reachable;
//   · a question with one answer is not asked (unchanged);
//   · "Bracket arm" is always there — a direct jump, it names every sheet;
//   · a sheet that draws two things (the traverse pairs, two basics to a sheet) stays while ONE of
//     them answers every pick so far — never one drawing's setup with the other's projection.
// Pure: no React, no scene. scripts/specSheetNarrow.test.mjs walks every path.

export const NARROW = [
    { key: 'rodKind', label: 'Rod' },
    { key: 'setup', label: 'Setup' },
    { key: 'frontLayer', label: 'Front' },
    { key: 'drive', label: 'Drive' },
    { key: 'mount', label: 'Mount' },
    { key: 'proj', label: 'Projection', fmt: (v) => `${v}"` },
    { key: '__arm', label: 'Bracket arm', always: true },
];

const has = (v) => v !== undefined && v !== null && v !== '';
const byValue = (a, b) => ((typeof a === 'number' && typeof b === 'number') ? a - b : String(a).localeCompare(String(b)));

// One fact set per thing a sheet draws: its leaf's answers plus the arm it is filed under.
export const pageFacts = (answers, arm) => [{ ...(answers || {}), __arm: arm || '' }];
export const traverseFacts = (drawings, armOf) => (drawings || []).map(d => ({ ...(d.answers || {}), __arm: armOf(d) || '' }));

// ── THE SHEET DROPDOWN'S NAMES (Stuart 2026-09-30: "yes, name the drop downs also need the fabricut
// name selection option") ──────────────────────────────────────────────────────────────────────
// A name is stored as its PARTS — our codes plus the words around them — and spoken at display time
// through the sheet's edition (H1 codes / Fabricut codes / Customer #s), so switching the edition
// renames the dropdowns without rebuilding a drawing. A traverse sheet names EACH drawing with its
// own set-up: its old name read the first drawing only ("6WB + DWB · SINGLE · 6"" for a double).
const FRONT_WORDS = { FASCIA: 'rod front', TRACK: 'track front' };
export const setUpWords = (a = {}) => [
    a.setup ? String(a.setup).toLowerCase() : '',
    FRONT_WORDS[a.frontLayer] || '',
    a.mount ? String(a.mount).toLowerCase() : '',
    has(a.proj) ? `${a.proj}"` : '',
].filter(Boolean).join(' · ');
export const traverseNameParts = (drawings, armOf) => ({
    drawings: (drawings || []).map(d => ({ code: armOf(d) || '', setUp: setUpWords(d.answers) })),
});
// codeOf(ourCode) → the edition's code, or nothing (then ours stands). Words are never translated —
// a plate family (H1-138BP) is not a part, and prints the same way on the sheet itself.
export function sheetName(page, codeOf = (c) => c) {
    const n = page?.nameParts;
    const say = (c) => (c ? (codeOf(c) || c) : '');
    if (!n) return page?.title || '';
    if (n.drawings) return n.drawings.map(d => `${say(d.code)}${d.setUp ? ` (${d.setUp})` : ''}`).join(' + ');
    return `${(n.codes || []).map(say).join(' + ')}${n.tail || ''}`;
}

// Our codes on a sheet, for telling two alike-spoken lines apart.
export const ourCodes = (page) => {
    const n = page?.nameParts;
    return n ? (n.drawings ? n.drawings.map(d => d.code) : (n.codes || [])).filter(Boolean).join(' + ') : '';
};
// In another edition two lines can read the same — two parts with no Fabricut number that share a
// description — so a repeated line carries our code too. No dropdown ever offers two identical lines.
export function distinctLabels(entries) {
    const count = new Map();
    entries.forEach(e => count.set(e.label, (count.get(e.label) || 0) + 1));
    return entries.map(e => (count.get(e.label) > 1 && e.ours && e.ours !== e.label ? `${e.label} (${e.ours})` : e.label));
}
// The sheet dropdown, in the edition. H1 is spoken exactly as the names were built.
export function sheetLabels(pages, codeOf, edition = 'H1') {
    const names = (pages || []).map(p => sheetName(p, codeOf));
    return edition === 'H1' ? names : distinctLabels((pages || []).map((p, i) => ({ label: names[i], ours: ourCodes(p) })));
}
// The Bracket arm picker, in the edition: the VALUE stays our code (a pick survives an edition switch),
// the line reads the edition's code, sorted as it reads. H1 keeps today's list as it is.
export function armOptions(values, codeOf, edition = 'H1') {
    const opts = (values || []).map(v => ({ value: String(v), label: String(codeOf(v) || v), ours: String(v) }));
    if (edition === 'H1') return opts.map(({ value, label }) => ({ value, label }));
    const labels = distinctLabels(opts);
    return opts.map((o, i) => ({ value: o.value, label: labels[i] })).sort((a, b) => a.label.localeCompare(b.label));
}

// → { steps: the pickers to show, each with its live values; pages: the sheets that survive }.
// A pick below an unanswered question is ignored (the screen clears them; this holds regardless).
export function narrowPages(pages, narrow = {}) {
    let pool = (pages || []).map(page => ({ page, facts: page.facts || [] }));
    const steps = [];
    let open = true;
    for (const ax of NARROW) {
        if (!open && !ax.always) continue;
        const values = [...new Set(pool.flatMap(x => x.facts.map(f => f[ax.key])).filter(has))].sort(byValue);
        if (values.length <= 1) continue;
        steps.push({ ...ax, values });
        const picked = narrow[ax.key];
        if (has(picked) && values.some(v => String(v) === String(picked))) {
            pool = pool
                .map(x => ({ page: x.page, facts: x.facts.filter(f => String(f[ax.key]) === String(picked)) }))
                .filter(x => x.facts.length);
        } else if (!ax.always) {
            open = false;
        }
    }
    return { steps, pages: pool.map(x => x.page) };
}
