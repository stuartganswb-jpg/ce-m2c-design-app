// 🔎 Any stocked item at checkout (Stuart 2026-10-02).   node scripts/checkoutSearch.test.mjs
import { isSearchableStockedItem, searchStockedItems, pickedItemEntries } from '../src/components/Shared/checkoutSearch.js';
import { buildAddOnLines } from '../src/components/Shared/feeRules.js';
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}`); };
const eq = (n, a, b) => ok(`${n} — got ${JSON.stringify(a)}`, JSON.stringify(a) === JSON.stringify(b));

const item = (id, code, name, specs = {}, extra = {}) => ({ id, legacyErpId: code, itemName: name, partClass: 'Inventory', manufacturingSpecs: { isStocked: true, ...specs }, clientPricing: [], ...extra });
const lib = [
    item('A1', 'HTTENDSTOP', 'End Stopper', { basePrice: 0.5, partHandling: 'Small Parts' }),
    item('A2', 'H1-138JNR', 'Joiner for 14-Guage 1-3/8" Round Rod', { basePrice: 4, partHandling: 'Small Parts' }, { partClass: 'Assembly' }),
    item('A3', 'H1-138JNR-OLD', 'Old Joiner', { isRetired: true }),
    item('A4', 'HSCPC1', 'Wood Pole Joiner Dbl sided screw', { isStocked: false }),
    item('A5', 'H1-SHIP-S', 'Flat rate box - small', { basePrice: 25 }),
    item('A6', 'H1-PCKF2', 'Packaging Fee', { productType: 'FEE' }, { partClass: 'Fee' }),
    item('A7', 'H1-2TRV-CB', 'Ceiling Bracket kit', {}, { partClass: 'Kit' }),
    item('A8', 'H1-138JNRX', 'Joiner, extra long', { basePrice: 6 }),
];

// ── what may be added ───────────────────────────────────────────────────────────────────────
eq('stocked items only — not retired, not unstocked, not a shipping box, not a fee, not a kit', lib.map(isSearchableStockedItem), [true, true, false, false, false, false, false, true]);
eq('an Assembly-class stocked item is an item like any other', isSearchableStockedItem(lib[1]), true);

// ── the search ──────────────────────────────────────────────────────────────────────────────
eq('by code: the exact code first, then codes that start with it', searchStockedItems(lib, 'h1-138jnr').map(p => p.legacyErpId), ['H1-138JNR', 'H1-138JNRX']);
eq('by words in the name, any order', searchStockedItems(lib, 'joiner round').map(p => p.legacyErpId), ['H1-138JNR']);
eq('every word must match', searchStockedItems(lib, 'joiner walnut'), []);
eq('one letter is not a search', searchStockedItems(lib, 'h'), []);
eq('blank', searchStockedItems(lib, '  '), []);
eq('items already on the checkout list are not offered twice', searchStockedItems(lib, 'joiner', { exclude: ['A2'] }).map(p => p.legacyErpId), ['H1-138JNRX']);
eq('the list is capped', searchStockedItems([...Array(30)].map((_, i) => item('X' + i, `HX-${String(i).padStart(2, '0')}`, 'Widget')), 'widget', { limit: 12 }).length, 12);
eq('a record listed twice comes back once', searchStockedItems([lib[0], lib[0]], 'stopper').length, 1);

// ── a pick becomes an ordinary checkout line ────────────────────────────────────────────────
const priceFor = (p) => (p.id === 'A2' ? 3.25 : Number(p.manufacturingSpecs.basePrice) || 0);   // the caller's one price chain
const skuFor = (p) => (p.id === 'A2' ? 'H9529F' : '');
const entries = pickedItemEntries([lib[1], lib[0]], { priceFor, skuFor });
eq('the entry carries the chain\'s price and the customer\'s part #', [entries[0].code, entries[0].unitPrice, entries[0].clientSku, entries[0].via, entries[0].isFee], ['H1-138JNR', 3.25, 'H9529F', 'SEARCH', false]);
eq('no customer: the base price', entries[1].unitPrice, 0.5);
eq('its Part Handling rides with it (the floor routes it)', entries.map(e => e.partHandling), ['Small Parts', 'Small Parts']);
const lines = buildAddOnLines({ A2: 3, A1: 2 }, entries, 0);
eq('…and the checkout writes it as a REAL line, no finish', lines.map(l => [l.legacyErpId, l.qty, l.price, l.total, l.isFee, l.isAddOn, !!l.finishCode]), [['H1-138JNR', 3, 3.25, 9.75, false, true, false], ['HTTENDSTOP', 2, 0.5, 1, false, true, false]]);
eq('quantity 0 = not on the order', buildAddOnLines({ A2: 0 }, entries, 0), []);
eq('no picks, no entries', pickedItemEntries([]), []);

console.log(`checkoutSearch: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
