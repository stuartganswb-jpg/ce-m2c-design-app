// node scripts/baseShipping.test.mjs — the base shipping rate, offline.
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/components/Shared/baseShipping.js', import.meta.url), 'utf8');
const mod = await import(`data:text/javascript;base64,${Buffer.from(src).toString('base64')}`);
const { baseRateOf, shipAmountFor, defaultShipping, defaultShippingNote, mayAutoSetShipping } = mod;

let n = 0;
const ok = (c, what) => { assert.ok(c, what); n += 1; };
const eq = (a, b, what) => { assert.deepStrictEqual(a, b, what); n += 1; };

const CFG = { baseRatePct: { uniquity: 8 } };

// ── the rate ─────────────────────────────────────────────────────────────────
eq(baseRateOf('uniquity', CFG), 8, "Uniq'uity is 8%");
eq(baseRateOf('UNIQUITY', CFG), 8, 'the brand is matched whatever its case');
eq(baseRateOf('ce', CFG), 0, 'a brand with no rate gets none — CE is untouched');
eq(baseRateOf('m2c', CFG), 0, 'and so is M2C');
eq(baseRateOf('uniquity', {}), 0, 'no config at all means no default');
eq(baseRateOf('uniquity', null), 0, 'and neither does a missing one');
for (const bad of [0, -5, 'abc', null, 101, Infinity, NaN]) {
    eq(baseRateOf('uniquity', { baseRatePct: { uniquity: bad } }), 0, `${String(bad)} is not a rate — refuse rather than guess`);
}

// ── the arithmetic ───────────────────────────────────────────────────────────
eq(shipAmountFor(6460, 8), 516.8, "8% of Stuart's own order");
eq(shipAmountFor(100, 8), 8, 'a round one');
eq(shipAmountFor(33.33, 8), 2.67, 'rounded to the cent, never a fraction of one');
eq(shipAmountFor(0, 8), 0, 'no goods, no freight');
eq(shipAmountFor(-50, 8), 0, 'a negative subtotal is not a charge');
eq(shipAmountFor(100, 0), 0, 'no rate, no charge');

// ── the order of precedence ──────────────────────────────────────────────────
const base = { brand: 'uniquity', cfg: CFG, typed: '', goodsSubtotal: 6460 };

const applied = defaultShipping(base);
ok(applied.apply, 'an empty box on a Uniq’uity order is filled');
eq(applied.amount, 516.8, 'with 8% of the goods');
eq(applied.reason, 'base-rate', 'and says why');

// 1. A PERSON WHO TYPED OUT-RANKS EVERYTHING.
for (const typed of ['0', '0.00', '75', ' 75 ', 'anything']) {
    eq(defaultShipping({ ...base, typed }).apply, false, `"${typed}" was typed — never overruled`);
}
eq(defaultShipping({ ...base, typed: '0' }).reason, 'typed', 'including a deliberate zero — free freight is a decision');

// …BUT THE DEFAULT FOLLOWS THE CART while the box still holds what the app itself put there.
// A rep adds a second pillow and the freight must move with it, or a $1,400 order ships on $56.
const first = defaultShipping(base);                                  // $6,460 → 516.80
eq(first.amount, 516.8, 'the first fill');
const grown = defaultShipping({ ...base, goodsSubtotal: 12920, typed: '516.80', lastAuto: 516.8 });
ok(grown.apply, 'the cart grew and the untouched default grows with it');
eq(grown.amount, 1033.6, 'to 8% of the larger cart');
eq(defaultShipping({ ...base, goodsSubtotal: 12920, typed: '75', lastAuto: 516.8 }).apply, false,
    'but a figure a person typed over it is never moved again');
eq(defaultShipping({ ...base, typed: '516.80', lastAuto: null }).apply, false,
    'and with nothing auto-set on record, a filled box is treated as a person’s');
ok(mayAutoSetShipping('', null), 'an empty box is always the app’s to fill');
ok(mayAutoSetShipping('516.80', 516.8), 'a string and a number of the same value are the same figure');
ok(!mayAutoSetShipping('516.81', 516.8), 'a cent of difference is a person');

// 2. THE CUSTOMER'S OWN 4.6 PROGRAMME BEATS THE PERCENTAGE — Fabricut must not be billed twice.
eq(defaultShipping({ ...base, customerFlatRate: true }).apply, false, 'flat rate wins');
eq(defaultShipping({ ...base, customerFlatRate: true }).reason, 'flat-rate', 'and says so');
eq(defaultShipping({ ...base, brand: 'ce', customerFlatRate: true }).apply, false, 'for any brand, as Stuart said');

// 3. A BRAND WITH NO RATE CHANGES NOTHING.
eq(defaultShipping({ ...base, brand: 'ce' }).apply, false, 'CE is left exactly as it was');
eq(defaultShipping({ ...base, brand: 'ce' }).reason, 'no-rate', 'and says why');

// An empty cart defaults nothing — there is nothing to take a percentage of yet.
eq(defaultShipping({ ...base, goodsSubtotal: 0 }).apply, false, 'no goods yet, nothing filled');
eq(defaultShipping({ ...base, goodsSubtotal: 0 }).reason, 'no-goods', 'and says why');

// ── what it says ─────────────────────────────────────────────────────────────
ok(defaultShippingNote(applied, 'uniquity').includes('8%'), 'the note names the rate');
ok(defaultShippingNote(applied, 'uniquity').includes('516.80'), 'and the figure');
ok(defaultShippingNote(applied, 'uniquity').includes('Change it'), 'and says it can be changed');
eq(defaultShippingNote(defaultShipping({ ...base, typed: '75' }), 'uniquity'), '', 'and says nothing when it did nothing');

// ── 📦 a customer's own flat-rate boxes fill it, counted by the caller (tab 7, 2026-10-20) ────────────────────
{
    const flat = { total: 22.5, rows: [{ qty: 1, code: 'H1-SHIP-S', total: 22.5 }] };
    const d = defaultShipping({ ...base, customerFlatRate: true, flatRate: flat });
    eq([d.apply, d.amount, d.reason], [true, 22.5, 'flat-rate'], 'the boxes fill an empty box');
    ok(defaultShippingNote(d, 'ce').includes('1 × H1-SHIP-S') && defaultShippingNote(d, 'ce').includes('22.50'), 'and the note names the boxes');
    eq(defaultShipping({ ...base, customerFlatRate: true, flatRate: flat, typed: '40' }).apply, false, 'a typed figure still wins');
    eq(defaultShipping({ ...base, customerFlatRate: true, flatRate: { total: 0, rows: [] } }).reason, 'flat-rate', 'no boxes counted: still never the percent');
    eq(defaultShipping({ ...base, customerFlatRate: true, flatRate: { total: 0, rows: [] } }).apply, false, '…and nothing is filled');
}

console.log(`baseShipping: ${n} assertions passed`);
