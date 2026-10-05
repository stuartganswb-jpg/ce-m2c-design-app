// ── THE FINISH LIBRARY KEEPS ITSELF STRAIGHT — one record per code, a material on every finish (Stuart 2026-10-05) ──
// M2C · FLAT IRON NEW: "when selecting wood finish it is not applying to the wood pole. also the wood finishes are on
// the finish selection board on the left twice, once with thumbnail once without."
// Both were the finish RECORDS (system/master_finishes), not the flow or its parts:
//   · SM01–SM10 were tagged material METAL. A part wears only a finish of a material it is made in
//     (hardwareModel.takesFinish), so the oak rod (WOOD) could not take them. They became METAL on 08-17, when blank
//     materials were seeded from the CODE — "S + a digit is wood, everything else metal" — and SM01 has a letter
//     after the S.
//   · the list held TWO records for every SM code — one the floor-recipe sync made (Production Ready, a picture),
//     one added by hand 14 minutes later (Working, no picture). A flow offers finishes BY CODE, so both showed.
//   · nine finishes the recipe sync made had NO material at all (BRASSWASH, BRONZEPATINA, GUNMETAL …): the board
//     filed them under their free-text type, "MIXED", which no part is made in — they applied to nothing.
// So the editor (4.5 Mass Update) now holds the rules, and they live here:
//   · ONE RECORD PER CODE — a save whose code is already taken is refused; codes that exist twice are listed, and
//     the copies that hold nothing the kept one lacks can be removed in one step.
//   · A MATERIAL ON EVERY FINISH — a save without one is refused; finishes with none are listed.
//   · BULK — a material set on, or a removal of, several ticked finishes at once.
// Pure. Harness: scripts/finishLibrary.test.mjs.

const U = (v) => String(v == null ? '' : v).trim().toUpperCase();

/** The code a flow, a recipe and a quote know a finish by. */
export const finishCodeOf = (f) => U(f && (f.code || f.name));
export const hasMaterial = (f) => !!U(f && f.material);

/** Finishes that carry no material — they cannot be applied to any part. */
export const missingMaterialOf = (finishes = []) => (finishes || []).filter(f => f && finishCodeOf(f) && !hasMaterial(f));

/**
 * Is this code already taken? Checked across EVERY list a flow can offer from (in-house and outsourced).
 * @param exceptId  the record being edited (its own code is not a clash)
 * @returns the record that holds the code, or null
 */
export const codeTakenBy = (lists = [], code, exceptId = null) => {
    const c = U(code);
    if (!c) return null;
    for (const list of lists) {
        const hit = (list || []).find(f => f && f.id !== exceptId && finishCodeOf(f) === c);
        if (hit) return hit;
    }
    return null;
};

/** What a copy holds that would be lost with it. */
const carries = (f) => ({
    picture: !!(f.textureUrl || f.finalImageUrl),
    maps: Array.isArray(f.clientMapping) ? f.clientMapping.length : 0,
    species: !!U(f.bomSuffix),
    sub: !!f.isSubFinish || !!U(f.subFinishCode),
});
const score = (f) => { const c = carries(f); return (c.picture ? 8 : 0) + (U(f.status) === 'PRODUCTION READY' ? 4 : 0) + (c.maps ? 2 : 0) + (c.species || c.sub ? 2 : 0) + (hasMaterial(f) ? 1 : 0); };
/** Would removing `copy` lose anything `keep` does not already hold? */
const losesNothing = (keep, copy) => {
    const k = carries(keep), c = carries(copy);
    return (!c.picture || k.picture) && c.maps === 0 && !c.species && !c.sub;
};

/**
 * Codes that exist more than once, with the record to keep and what may go.
 * @returns Array<{ code, keep, remove: record[], look: record[] }>  — `remove` = copies that hold nothing the
 *          kept one lacks; `look` = copies that do (client names, a species suffix, a sub-finish, their own picture
 *          while the kept one has none) — those are a person's call.
 */
export function duplicateCodesOf(finishes = []) {
    const by = new Map();
    (finishes || []).forEach((f, i) => { const c = finishCodeOf(f); if (!c) return; if (!by.has(c)) by.set(c, []); by.get(c).push({ f, i }); });
    const out = [];
    by.forEach((rows, code) => {
        if (rows.length < 2) return;
        const ranked = [...rows].sort((a, b) => score(b.f) - score(a.f) || a.i - b.i);
        const keep = ranked[0].f;
        const rest = ranked.slice(1).map(r => r.f);
        out.push({ code, keep, remove: rest.filter(c => losesNothing(keep, c)), look: rest.filter(c => !losesNothing(keep, c)) });
    });
    return out.sort((a, b) => a.code.localeCompare(b.code));
}

/** A one-line description of a record, for a confirm. */
export const finishLine = (f) => `${finishCodeOf(f)}${f.name && U(f.name) !== finishCodeOf(f) ? ` (${f.name})` : ''} — ${f.status || 'no status'}, ${f.textureUrl || f.finalImageUrl ? 'picture' : 'no picture'}, material ${U(f.material) || 'NONE'}`;

/** The confirm for removing the copies that hold nothing. */
export function duplicateRemovalText(dups = []) {
    const go = dups.filter(d => d.remove.length);
    const n = go.reduce((s, d) => s + d.remove.length, 0);
    const out = [`Remove ${n} duplicate finish record${n === 1 ? '' : 's'}?`, '', 'Each code keeps ONE record — the copy removed holds nothing the kept one lacks:', ''];
    go.forEach(d => { out.push(`KEEP    ${finishLine(d.keep)}`); d.remove.forEach(r => out.push(`remove  ${finishLine(r)}`)); out.push(''); });
    const look = dups.filter(d => d.look.length);
    if (look.length) out.push(`Left for you to look at (the copy holds customer names, a species suffix, a sub-finish or its own picture): ${look.map(d => d.code).join(', ')}.`);
    return out.join('\n').trimEnd();
}

/** The list with those records gone. */
export const withoutIds = (finishes = [], ids = []) => { const s = new Set(ids); return (finishes || []).filter(f => !s.has(f.id)); };
/** The list with a material set on those records — and on nothing else. */
export const withMaterial = (finishes = [], ids = [], material = '') => {
    const s = new Set(ids), m = U(material);
    if (!m) return finishes;
    return (finishes || []).map(f => (s.has(f.id) ? { ...f, material: m } : f));
};

/**
 * Why a finish may not be saved, or '' when it may.
 * @param exceptId      the record being edited
 * @param originalCode  its code as it stands — an edit that leaves the code alone is never refused for a clash
 *                      that already exists (that is how a doubled code gets corrected by hand)
 */
export function finishSaveRefusal({ config = {}, lists = [], exceptId = null, originalCode = '' } = {}) {
    if (!U(config.name)) return 'Finish name required.';
    if (!U(config.material)) return 'Choose a MATERIAL.\n\nA part only wears a finish of a material it is made in — a finish with no material cannot be applied to any part.';
    const code = U(config.code || config.name);
    const clash = (exceptId && code === U(originalCode)) ? null : codeTakenBy(lists, code, exceptId);
    if (clash) return `${finishCodeOf(clash)} already exists${clash.name ? ` (${clash.name})` : ''}.\n\nA flow offers finishes by CODE, so two records with one code both show on the CPQ finish board. Edit the existing one instead.`;
    return '';
}

/**
 * The material a code states by itself, where the convention is unambiguous — or '' (a person decides).
 * S01… = a stain (WOOD) · AC… = clear · P01 / EP1 / MEP1… = METAL. Anything else is NOT guessed: "SM01" was
 * guessed METAL once, and was a wood stain.
 */
export const materialKnownFromCode = (code) => {
    const c = U(code);
    if (/^AC\d*$/.test(c)) return 'CLEAR';   // as the 08-17 seed tagged them
    if (/^S\d+$/.test(c)) return 'WOOD';
    if (/^(P|EP|MEP)\d+$/.test(c)) return 'METAL';
    return '';
};
