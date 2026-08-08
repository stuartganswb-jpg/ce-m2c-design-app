// DOES THE GEOMETRY MATCH THE CELL? (playbook 4.2, Stuart 2026-08-08 — built for the H1 load.)
//
// A spec sheet's numbers are raw mesh-bounds measurements; the cell's EXPECTED numbers sit in
// sizeMatrix (dia.options[].inches, proj.options[].inches). Nothing compared them, so the most
// likely mass-load mistake — a ¾" file registered under the 1-3/8" cell, or a model authored in
// the wrong units — printed a confident, wrong sheet. This closes that gap as WARNINGS ONLY:
// the sheet still renders (a human may be deliberately borrowing geometry), but it says so.
//
// Pure and Firestore-free so `node --test` can pin the tolerances. The tolerances are set from
// the option spacing, not taste: dia options are ≥0.25" apart (0.5/0.75/1/1.375) → ±0.09" tells
// them apart with margin; projections are ≥1" apart (3.625/4.625/6; the H2 P75 outlier is
// 2.875" from S) → ±0.45".

const DIA_TOL_IN = 0.09;
const PROJ_TOL_IN = 0.45;

const optOf = (axis, value) => (axis?.options || []).find((o) => o.value === value) || null;

// The option a measurement actually lands on, if any — turns "wrong" into "that's the ¾" set".
const nearestOpt = (axis, measured, tol) => {
    let best = null;
    (axis?.options || []).forEach((o) => {
        if (!Number.isFinite(o.inches)) return;
        const d = Math.abs(o.inches - measured);
        if (d <= tol && (!best || d < best.d)) best = { o, d };
    });
    return best ? best.o : null;
};

const inch = (n) => `${Math.round(n * 1000) / 1000}"`;

// THE ONE CALL. fam = SIZE_FAMILIES[key] (needs dia/proj options with `inches`), sel = the
// selected cell {dia, proj}, measurements in inches (null/undefined = not measured, no warning),
// unitAutoScaled = the loader's >10-units inches heuristic fired on this scene.
// Returns [{ code, text }] — empty when everything agrees.
export function specCellWarnings({ fam, sel, poleDiaIn, projIn, unitAutoScaled } = {}) {
    const out = [];
    if (!fam || !sel) return out;

    const diaOpt = optOf(fam.dia, sel.dia);
    if (Number.isFinite(poleDiaIn) && diaOpt && Number.isFinite(diaOpt.inches)) {
        if (Math.abs(poleDiaIn - diaOpt.inches) > DIA_TOL_IN) {
            const looksLike = nearestOpt(fam.dia, poleDiaIn, DIA_TOL_IN);
            out.push({
                code: 'DIA_MISMATCH',
                text: `pole measures ${inch(poleDiaIn)} but this cell is ${diaOpt.label || inch(diaOpt.inches)}`
                    + (looksLike ? ` — this looks like the ${looksLike.label || inch(looksLike.inches)} geometry` : ''),
            });
        }
    }

    const projOpt = optOf(fam.proj, sel.proj);
    if (Number.isFinite(projIn) && projOpt && Number.isFinite(projOpt.inches)) {
        if (Math.abs(projIn - projOpt.inches) > PROJ_TOL_IN) {
            const looksLike = nearestOpt(fam.proj, projIn, PROJ_TOL_IN);
            out.push({
                code: 'PROJ_MISMATCH',
                text: `projection measures ${inch(projIn)} but this cell is ${projOpt.label || inch(projOpt.inches)}`
                    + (looksLike ? ` — this looks like the ${looksLike.label || inch(looksLike.inches)} geometry` : ''),
            });
        }
    }

    // The inches→meters guess is two-state (see SpecSheetModal's >10-units heuristic): right for
    // true-m and inch scenes, silently wrong for cm/mm. When it FIRED, the scene declared itself
    // production-inches — fine for the base model, worth naming on a registered spec cell where
    // true meters were expected.
    if (unitAutoScaled) {
        out.push({
            code: 'UNIT_GUESSED',
            text: 'this scene was auto-converted from inches (the true-m spec export would not need conversion) — dimensions are trustworthy only if the source really was inches',
        });
    }

    return out;
}

export const specWarningLine = (warnings) =>
    (warnings || []).length ? warnings.map((w) => w.text).join(' · ') : '';
