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
