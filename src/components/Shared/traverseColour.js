// ── THE TRAVERSE COLOUR THAT GOES WITH A FINISH — SAID ON THE RECIPE (Stuart 2026-10-13) ────────────────────────────
// "on the recipe card in finishing add the matching traverse tag for the complimentary bronze or champagne colors" —
// "recipe read only". A traverse track, its F-clips and its stock-colour parts are not finished in the fascia's finish:
// they take the sub finish 4.5 Mass Update aligns to it — TBR (Traverse Bronze) or TCP (Traverse Champagne) — the
// pairing CPQ, Order Entry and RTG already route by (Shared/subFinish.subFinishOfFinish). The floor could not see it.
// This reads the same 4.5 record and says it; it is never set here. Pure.
//   a finish that has a traverse colour   → { kind: 'WEARS', code: 'TCP', name: 'Traverse Champagne' }
//   a traverse colour itself (TBR / TCP)  → { kind: 'IS', code, name, goesWith: ['P01', 'P02', …] }
//   anything else (a stock colour, …)     → null
import { subFinishOfFinish } from './subFinish.js';
import { streamMasterOf } from './finishingTime.js';

const U = (v) => String(v == null ? '' : v).trim().toUpperCase();
const codeOf = (f) => U(f && (f.code || f.name));
const words = (s) => String(s || '').trim().toLowerCase().replace(/(^|[\s-])([a-z])/g, (m, a, b) => a + b.toUpperCase());
const byCode = (a, b) => a.localeCompare(b, undefined, { numeric: true });

/** The finish a recipe code stands for: "S03 - Walnut" → S03, "S03-S" / "S03-P" → S03. */
export const finishOfRecipeCode = (code) => U(streamMasterOf(String(code == null ? '' : code).split(' - ')[0]));

/** @param recipeCode a recipe's code, or the recipe stamped on a work order · @param finishes 4.5's master finishes */
export function traverseColourOf(recipeCode, finishes = []) {
    const code = finishOfRecipeCode(recipeCode);
    if (!code) return null;
    const list = (finishes || []).filter(Boolean);
    const own = list.find(f => codeOf(f) === code);
    if (own && own.isSubFinish) {
        const goesWith = [...new Set(list.filter(f => U(f.subFinishCode) === code).map(codeOf).filter(Boolean))].sort(byCode);
        return { kind: 'IS', code, name: words(own.name && U(own.name) !== code ? own.name : ''), goesWith };
    }
    const sub = subFinishOfFinish(code, list);
    if (!sub) return null;
    const rec = list.find(f => codeOf(f) === sub);
    return { kind: 'WEARS', code: sub, name: words(rec && rec.name && U(rec.name) !== sub ? rec.name : '') };
}

/** One line, for a title or a print. '' when there is nothing to say. */
export const traverseColourText = (tag) => {
    if (!tag) return '';
    const label = `${tag.code}${tag.name ? ` · ${tag.name}` : ''}`;
    if (tag.kind === 'IS') return `Traverse colour ${label} — goes with ${tag.goesWith.length ? tag.goesWith.join(', ') : 'no finish yet (set in 4.5 Mass Update)'}`;
    return `Traverse parts: ${label}`;
};
