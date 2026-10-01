// specSheetSolid.js — the SOLID sheets: one per bracket or return at one projection (Stuart 2026-09-30 / 10-01).
//
// "the new ones we worked yesterday based on my customer's sketch … they are lost" → the client's dimensions belong on
// the solid sheets too. His approved draft: ONE sheet per bracket (or return) at one projection — the hero view once
// (a bracket's end view; a return's plan + end view), the rings with their drops, then a BACKPLATES row and a COVER
// PLATES row, every plate with height, width, plate top → rod top, rod bottom → plate bottom and plate top → the bottom
// of each ring's body. The metal rod is always the one drawn.
//
// This module is the PAGE side of that, and it is presentation only: the engine's page list (specPages) and its audit
// are untouched — the engine still answers one page per arm × plate family × sheet part, and those are GROUPED here
// into the sheets a reader holds (exactly as the modal already pairs two basics to a sheet).
//
// ONE ASSEMBLY, ONE LAYOUT. An assembly moves to this layout only when EVERY row page it has can be drawn by it —
// today: a single-rod wall bracket or return of the solid world that takes separate plates. Doubles, ceiling brackets,
// basics (the plate is in the arm), inside mounts and the 1-3/8" traverse pole are not designed yet, so an assembly
// that has any of them keeps the sheets it has, whole (H1-2TRV qualifies; H1-138, H1-75, H1-1 do not — "H1-2TRV
// first"). solidUnsupported() names the reason, so the screen can say why.
// Pure — scripts/specSheetSolid.test.mjs.

const U = (v) => String(v ?? '').trim().toUpperCase();

export const ROW_KINDS = ['BRACKET', 'RETURN', 'INSIDE_MOUNT'];
const isRowPage = (p) => !!p && ROW_KINDS.includes(p.kind);
const isFee = (c) => !!(c && (c.isFee || c.feeItemNo || c.raw?.isFee || c.raw?.feeItemNo));
// materials: a list or a comma string; none named = metal (the tag vocabulary's default).
export const materialsOf = (c) => {
    const m = c?.materials;
    const arr = (Array.isArray(m) ? m : String(m || '').split(/[,\s]+/)).map(x => U(x)).filter(Boolean);
    return arr.length ? arr : ['METAL'];
};

/**
 * What a return IS — from its tags and the fee flag, never its code:
 *   FRENCH  the rod bends back to the wall (a fee)        · endTreatment FRENCH_RETURN
 *   MITER   the rod is mitred back to the wall (a fee)    · endTreatment MITER_RETURN on a fee
 *   ARM     an end arm, a PART: the rod is cut straight and the arm butts it · a return-arm part (END-ARM on a
 *           bracket cluster — the engine re-roles it as the end, with no end treatment of its own), or
 *           MITER_RETURN on a part (the traverse end arms)
 * ⚠ H1-1's inside mount (H1-1IM) is tagged exactly like an end arm today; it is not one. That assembly is not ready
 * for this layout for other reasons — settle the inside mount's tag before it is.
 */
export function returnTypeOf(subject) {
    const et = U(subject?.endTreatment);
    if (et === 'FRENCH_RETURN') return 'FRENCH';
    if (isFee(subject)) return et === 'MITER_RETURN' ? 'MITER' : null;
    if (subject?.isReturnArm || et === 'MITER_RETURN') return 'ARM';
    return null;
}

/** Why this layout cannot draw a row page — or null when it can. */
export function solidUnsupported(p) {
    if (!p || (p.kind !== 'BRACKET' && p.kind !== 'RETURN')) return 'not a bracket or a return';
    if (U(p.answers?.rodKind || 'SOLID') !== 'SOLID') return 'not the solid rod world';
    if (U(p.answers?.setup) === 'DOUBLE' || (p.rods || []).length > 1 || p.subject?.projTiers) return 'a double';
    if (U(p.answers?.mount) === 'CEILING' || U(p.subject?.mount) === 'CEILING') return 'a ceiling mount';
    if (!(p.plates || []).length) return 'no separate plate (a basic)';
    if (p.kind === 'RETURN' && !returnTypeOf(p.subject)) return 'a return this layout does not know';
    return null;
}

/** Every row page the assembly has can be drawn in this layout (and it has some). */
export function solidReady(pages) {
    const rows = (pages || []).filter(isRowPage);
    return rows.length > 0 && rows.every(p => !solidUnsupported(p));
}

// A plate family's row. The engine groups plates by their code stem and already ranks a "…CP" stem as the cover
// plates (specSheetPages.plateFamilies); the sheet reads the same stem — backplates first, any other stem its own row.
export function plateRowOf(stem) {
    const s = U(stem);
    if (/CP$/.test(s)) return { key: 'CP', name: 'Cover plates (CP)', order: 1 };
    if (/BP$/.test(s)) return { key: 'BP', name: 'Backplates (BP)', order: 0 };   // Stuart 2026-09-30: not "Screw backplates"
    return { key: s || 'PLATES', name: s ? `Plates · ${s}` : 'Plates', order: 2 };
}

/**
 * The sheets, in the engine's own order (first appearance): every page of one subject at one projection becomes one
 * sheet carrying all its plates (each with the family row it belongs to), its rings, and the METAL rod of the tiers
 * it stands up — a wood rod is never the one drawn; with no metal rod tagged, the engine's own pick stands.
 * @returns [{ key, kind: 'SOLID', group, subject, answers, label, plates: [{ choice, row }], rings, rods, returnType, pageKeys }]
 */
export function solidSheets({ pages, choices } = {}) {
    const groups = new Map();
    for (const p of (pages || []).filter(isRowPage)) {
        const k = `${p.kind}|${p.subject?.id}|${p.answers?.proj ?? ''}`;
        if (!groups.has(k)) {
            groups.set(k, {
                key: `SOLID__${k}`, kind: 'SOLID', group: p.kind, subject: p.subject, answers: p.answers || {}, label: p.label || '',
                plates: new Map(), rings: new Map(), tiers: new Set(), engineRods: new Map(), pageKeys: [],
                returnType: p.kind === 'RETURN' ? returnTypeOf(p.subject) : null,
            });
        }
        const g = groups.get(k);
        g.pageKeys.push(p.key);
        for (const pl of p.plates || []) if (!g.plates.has(pl.id)) g.plates.set(pl.id, { choice: pl, row: plateRowOf(p.plateFamily) });
        for (const r of p.rings || []) g.rings.set(r.id, r);
        for (const r of (p.rods && p.rods.length ? p.rods : [p.rod]).filter(Boolean)) { g.tiers.add(U(r.tier)); g.engineRods.set(r.id, r); }
    }
    const metal = (choices || []).filter(c => c.role === 'ROD' && U(c.rodKind || 'SOLID') === 'SOLID' && materialsOf(c).includes('METAL'));
    return [...groups.values()].map(g => {
        const rods = metal.filter(c => g.tiers.has(U(c.tier)));
        return {
            key: g.key, kind: g.kind, group: g.group, subject: g.subject, answers: g.answers, label: g.label, returnType: g.returnType, pageKeys: g.pageKeys,
            plates: [...g.plates.values()], rings: [...g.rings.values()], rods: rods.length ? rods : [...g.engineRods.values()],
        };
    });
}

/** The sheet must have what it draws — an independent check on the grouping. */
export function auditSolid(sheets) {
    const out = [];
    for (const s of sheets || []) {
        const say = (why) => out.push({ page: s.key, why });
        if (!s.subject) say('no bracket or return');
        if (!(s.plates || []).length) say('no plate');
        if (!(s.rods || []).length) say('no rod');
        if (s.group === 'RETURN' && !s.returnType) say('a return of no known kind');
        const ids = (s.plates || []).map(p => p.choice?.id);
        if (new Set(ids).size !== ids.length) say('a plate twice');
    }
    return out;
}
