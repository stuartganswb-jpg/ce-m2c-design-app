// One name per collection (Eric 2026-09-29 · Stuart 2026-09-30: H1 FABRICUT vs FABRICUT H1).   node scripts/collectionName.test.mjs
import { canonicalCollection, canonicalCollections, isAliasCollection, hasAliasCollection, collectionMergesOf, collectionMergeSummary } from '../src/components/Shared/collectionName.js';
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}`); };
const eq = (n, a, b) => ok(`${n} — got ${JSON.stringify(a)}`, JSON.stringify(a) === JSON.stringify(b));

// ── the one name ────────────────────────────────────────────────────────────────────────────
eq('the reversed spelling is the same collection', canonicalCollection('H1 FABRICUT'), 'FABRICUT H1');
eq('NetSuite\'s own "H1 Fabricut" value, as the sync reads it', canonicalCollection('H1 Fabricut'), 'FABRICUT H1');
eq('spaces and case do not make a new one', canonicalCollection('  h1   fabricut '), 'FABRICUT H1');
eq('the name itself stays', canonicalCollection('Fabricut H1'), 'FABRICUT H1');
eq('any other collection is only uppercased', canonicalCollection('Brimar'), 'BRIMAR');
eq('blank stays blank', canonicalCollection(null), '');
eq('a list: aliases mapped, duplicates merged, blanks dropped, order kept', canonicalCollections(['H1 FABRICUT', 'BRIMAR', 'FABRICUT H1', '']), ['FABRICUT H1', 'BRIMAR']);
ok('an alias is recognised', isAliasCollection('H1 FABRICUT') && isAliasCollection(' h1 fabricut'));
ok('the name is not an alias', !isAliasCollection('FABRICUT H1') && !isAliasCollection('BRIMAR'));
ok('a list with an alias', hasAliasCollection(['BRIMAR', 'H1 FABRICUT']) && !hasAliasCollection(['FABRICUT H1']) && !hasAliasCollection(null));

// ── the merge, on records shaped like the live ones (2026-09-30) ────────────────────────────
const recs = [
    { id: 'CE-ASM-8315', legacyErpId: 'H1-PCKF1', manufacturingSpecs: { collections: ['H1 FABRICUT'] } },            // the fee Eric missed
    { id: 'CE-INV-51244', legacyErpId: 'H1-1R', manufacturingSpecs: { collections: ['FABRICUT H1'] } },              // already right
    { id: 'CE-FEE-4594', legacyErpId: 'H1-FRPF', manufacturingSpecs: { collections: ['BRIMAR'] } },                   // another collection
    { id: 'X-BOTH', legacyErpId: 'H1-X', manufacturingSpecs: { collections: ['FABRICUT H1', 'H1 FABRICUT'] } },      // both spellings
    { id: 'X-MIXED', legacyErpId: 'M2C-1', manufacturingSpecs: { collections: ['Boujee', 'H1 FABRICUT'] } },         // someone else's tag, mixed case
    { id: 'X-LOWER', legacyErpId: 'M2C-2', manufacturingSpecs: { collections: ['Boujee'] } },                         // mixed case, no alias
    { id: 'X-NONE', legacyErpId: 'Z', manufacturingSpecs: {} },
];
const m = collectionMergesOf(recs);
eq('only records carrying the other spelling are merged', m.map(x => x.id), ['CE-ASM-8315', 'X-BOTH', 'X-MIXED']);
eq('the fee moves to the one name', m[0].after, ['FABRICUT H1']);
eq('a record carrying both keeps one entry', m[1].after, ['FABRICUT H1']);
eq('another tag is left exactly as written (case too)', m[2].after, ['Boujee', 'FABRICUT H1']);
eq('the before is kept for the audit record', m[0].before, ['H1 FABRICUT']);
eq('a mixed-case tag with no alias is never touched', collectionMergesOf([recs[5]]).length, 0);
eq('in words', collectionMergeSummary(m), ['3 × H1 FABRICUT → FABRICUT H1']);
eq('after the merge there is nothing left to merge', collectionMergesOf(m.map(x => ({ id: x.id, manufacturingSpecs: { collections: x.after } }))).length, 0);

console.log(`collectionName: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
