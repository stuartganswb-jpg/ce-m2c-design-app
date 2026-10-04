// ↑ A customer row from the tiers — one reader, one source per row (Stuart 2026-10-04, 4.6 · H1-138BST).   node scripts/tierRows.test.mjs
import { tierRowOf, stockedVariantsOf, seedPlanOf, seedConfirmText, seedRowDoc } from '../src/components/Shared/tierRows.js';
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}`); };
const eq = (n, a, b) => ok(`${n} — got ${JSON.stringify(a)}`, JSON.stringify(a) === JSON.stringify(b));

// H1-138BST as saved on 2026-10-04: painted 12/24/48, plated 24/44/88, its own cost 13, their part #s.
const fab = { paintedCost: 12, paintedWholesale: 24, paintedRetail: 48, platedCost: 24, platedWholesale: 44, platedRetail: 88, cost: 13, fabCodePainted: 'H3662F', fabCodePremium: 'H3662F PREMIUM', source: 'COLLECTION_PAGE' };
const mk = (code, ms = {}, extra = {}) => ({ id: code, legacyErpId: code, itemId: code, manufacturingSpecs: { isStocked: true, ...ms }, clientPricing: [], ...extra });
const base = mk('H1-138BST', { fabricut: fab }, { clientPricing: [{ customerId: 'CUST-4720', customerName: 'FABRICUT', clientSku: 'H3662F', price: 13, clientSalesPrice: 24, clientRetailPrice: 48, source: 'TIER_SEED' }] });
const inv = [base, mk('H1-138BST/EP1'), mk('H1-138BST/EP2'), mk('H1-138BST/P'), mk('H1-138BST/P25'),
    mk('H1-138BST/EP6', { isStocked: false }), mk('H1-138BST/EP5', { isRetired: true }), mk('H1-138BST/EP4', { aliasOf: 'H1-138BST' }), mk('H1-138BS/EP1'), mk('H1-138BSTX/EP1')];
const find = (c) => inv.find(p => p.legacyErpId === String(c).toUpperCase()) || null;
const OUT = [{ code: 'P25' }];
const row = (code) => tierRowOf(find(code), find, OUT);
const nums = (r) => r && [r.clientSku, r.price, r.clientSalesPrice, r.clientRetailPrice, r.tier, r.inherited];

// ── one source per row ──────────────────────────────────────────────────────────────────────
eq('the BASE: its own price only — $13, nothing borrowed from the painted tier', nums(row('H1-138BST')), ['H3662F', 13, '', '', 'OWN', false]);
eq('/EP1 inherits the PLATED tier and the premium part #', nums(row('H1-138BST/EP1')), ['H3662F PREMIUM', 24, 44, 88, 'PLATED', true]);
eq('/P inherits the PAINTED tier and the painted part #', nums(row('H1-138BST/P')), ['H3662F', 12, 24, 48, 'PAINTED', true]);
eq('/P25 is plated (the outsourced registry), not a paint', nums(row('H1-138BST/P25')), ['H3662F PREMIUM', 24, 44, 88, 'PLATED', true]);
eq('a variant never takes the base\'s OWN price', row('H1-138BST/EP1').price, 24);
// a variant stamped with its own numbers keeps them
const stamped = mk('H1-138EC/EP2', { fabricut: { cost: 31, wholesale: 60, retail: 120 } });
eq('a variant with its own box: its own numbers', nums(tierRowOf(stamped, () => mk('H1-138EC', { fabricut: fab }), OUT)), ['H3662F PREMIUM', 31, 60, 120, 'OWN', false]);
// a base with tiers and no own price (a fee: one record, painted / plated) reads painted, whole
const fee = mk('H1-FRR', { fabricut: { paintedCost: 35, paintedRetail: 70, platedCost: 43, platedRetail: 86, fabCodePainted: 'DFR01' } });
eq('a suffixless item with no own price: the painted tier, wholesale = retail ÷ 2 of the SAME tier', nums(tierRowOf(fee, find, OUT)), ['DFR01', 35, 35, 70, 'PAINTED', false]);
eq('own price with retail but no wholesale: half its OWN retail', nums(tierRowOf(mk('X', { fabricut: { cost: 10, retail: 40, paintedWholesale: 99 } }), find, OUT)).slice(1, 4), [10, 20, 40]);
eq('a group-priced plate ($0 with the arm): no row', tierRowOf(mk('H1-138BP', { fabricut: { cost: null, retail: null, paintedCost: 5 } }), find, OUT), null);
eq('no tier box anywhere: no row', [tierRowOf(mk('Z'), find, OUT), tierRowOf(mk('Z/EP1'), find, OUT), tierRowOf(null)], [null, null, null]);
eq('a base with no plated tier: its /EP has nothing to inherit', tierRowOf(mk('Q/EP1'), () => mk('Q', { fabricut: { paintedCost: 5, paintedRetail: 10 } }), OUT), null);

// ── which finishes a base seeds ─────────────────────────────────────────────────────────────
eq('the stocked, live variants — not unstocked, retired, an alias, or another item', stockedVariantsOf(base, inv).map(p => p.legacyErpId), ['H1-138BST/EP1', 'H1-138BST/EP2', 'H1-138BST/P', 'H1-138BST/P25']);
eq('a variant has no variants', stockedVariantsOf(find('H1-138BST/EP1'), inv), []);

// ── the plan ────────────────────────────────────────────────────────────────────────────────
const KEYS = new Set(['CUST-4720', 'FABRICUT']);
const plan = seedPlanOf({ part: base, inventory: inv, findByCode: find, outsourceCodes: OUT, customerKeys: KEYS });
eq('from the base: the base and its four stocked finishes', plan.rows.map(x => [x.code, x.change]), [['H1-138BST', 'REPLACE'], ['H1-138BST/EP1', 'NEW'], ['H1-138BST/EP2', 'NEW'], ['H1-138BST/P', 'NEW'], ['H1-138BST/P25', 'NEW']]);
eq('…the base\'s mixed row of today is replaced by its own price', [plan.rows[0].existing.clientSalesPrice, plan.rows[0].row.clientSalesPrice, plan.rows[0].hand], [24, '', false]);
const one = seedPlanOf({ part: find('H1-138BST/EP1'), inventory: inv, findByCode: find, outsourceCodes: OUT, customerKeys: KEYS });
eq('from a variant: that variant alone', one.rows.map(x => x.code), ['H1-138BST/EP1']);
const seeded = inv.map(p => (p.legacyErpId === 'H1-138BST/EP1' ? { ...p, clientPricing: [{ customerId: 'cust-4720', clientSku: 'H3662F PREMIUM', price: 24, clientSalesPrice: 44, clientRetailPrice: 88, source: 'TIER_SEED' }] } : p));
eq('a row that already matches is left alone (its key matched case-blind)', seedPlanOf({ part: base, inventory: seeded, findByCode: find, outsourceCodes: OUT, customerKeys: KEYS }).rows[1].change, 'SAME');
const hand = inv.map(p => (p.legacyErpId === 'H1-138BST/P' ? { ...p, clientPricing: [{ customerId: 'FABRICUT', clientSku: 'H3662F', price: 11 }] } : p));
eq('a hand-entered row it would replace is called out', (() => { const x = seedPlanOf({ part: base, inventory: hand, findByCode: find, outsourceCodes: OUT, customerKeys: KEYS }).rows.find(r => r.code === 'H1-138BST/P'); return [x.change, x.hand]; })(), ['REPLACE', true]);
eq('another customer\'s row is not this customer\'s', seedPlanOf({ part: base, inventory: inv, findByCode: find, outsourceCodes: OUT, customerKeys: new Set(['BRIMAR']) }).rows[0].change, 'NEW');
const noOwn = mk('H1-138BSX', { fabricut: { platedCost: 24, platedRetail: 88 } });
eq('a base with nothing of its own and no painted tier is skipped, its plated finish still seeds', (() => { const pl = seedPlanOf({ part: noOwn, inventory: [noOwn, mk('H1-138BSX/EP1')], findByCode: (c) => (c === 'H1-138BSX' ? noOwn : null), outsourceCodes: OUT, customerKeys: KEYS }); return [pl.rows.map(x => x.code), pl.skipped.map(s => s.code)]; })(), [['H1-138BSX/EP1'], ['H1-138BSX']]);

// ── the words, and the stored row ───────────────────────────────────────────────────────────
const text = seedConfirmText(plan, 'FABRICUT');
ok('the confirm lists every row and what it replaces', text.startsWith('Write 5 FABRICUT price rows from the saved tiers?')
    && text.includes("H1-138BST  →  H3662F · net $13 · sales — · retail —  (the item's own price)")
    && text.includes('replaces the row: H3662F · net $13 · sales $24 · retail $48')
    && text.includes('H1-138BST/EP1  →  H3662F PREMIUM · net $24 · sales $44 · retail $88  (plated tier, from the base item)')
    && text.includes('H1-138BST/P  →  H3662F · net $12 · sales $24 · retail $48  (painted tier, from the base item)'));
eq('the stored row', seedRowDoc(plan.rows[1].row, { customerId: 'CUST-4720', customerName: 'FABRICUT', by: 'stuart', now: 5 }), { customerId: 'CUST-4720', customerName: 'FABRICUT', clientSku: 'H3662F PREMIUM', price: 24, clientSalesPrice: 44, clientRetailPrice: 88, source: 'TIER_SEED', updatedAt: 5, updatedBy: 'stuart' });

console.log(`tierRows: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
