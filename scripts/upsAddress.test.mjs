// node scripts/upsAddress.test.mjs — what an address must carry, by country.
import assert from 'node:assert';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { countryOf, isDomestic, crossesBorder, needsState, needsPostal, addressGaps, invoiceLineTotalOf, unitsFor, toCm, toKg } = require('../functions/upsAddress.js');

let n = 0;
const ok = (c, what) => { assert.ok(c, what); n += 1; };
const eq = (a, b, what) => { assert.deepStrictEqual(a, b, what); n += 1; };

const us = { addressee: 'A Co', addr1: '1 Main St', city: 'High Point', state: 'NC', zip: '27260', country: 'US' };
const gb = { addressee: 'A Co', addr1: '1 High St', city: 'London', zip: 'SW1A 1AA', country: 'GB' };
const hk = { addressee: 'A Co', addr1: '1 Queen’s Rd', city: 'Hong Kong', country: 'HK' };

// ── the country ──────────────────────────────────────────────────────────────
eq(countryOf({}), 'US', 'no country given means home');
eq(countryOf({ country: 'gb' }), 'GB', 'and it is upper-cased');
ok(isDomestic(us), 'a US address is domestic');
ok(!isDomestic(gb), 'a British one is not');

// ── THE BUG THIS FIXES ───────────────────────────────────────────────────────
// Every address on earth was required to carry a state and a zip. Most countries have no state and
// several have no postal code, so a good London address was refused by US before UPS ever saw it.
eq(addressGaps(us), [], 'a complete US address is ready to send');
eq(addressGaps(gb), [], 'and so is a London one, WITHOUT a state');
eq(addressGaps(hk), [], 'and Hong Kong, without a state OR a postal code');

ok(needsState('US') && needsState('CA') && needsState('MX'), 'the countries that use provinces');
ok(!needsState('GB') && !needsState('DE') && !needsState('FR'), 'and the ones that do not');
ok(needsPostal('GB') && needsPostal('DE'), 'most countries post by code');
ok(!needsPostal('HK') && !needsPostal('AE'), 'a few have none at all');

// ── still refused when something real is missing ─────────────────────────────
ok(addressGaps({ ...us, state: '' }).some(g => /state/.test(g)), 'a US address with no state IS a gap');
ok(addressGaps({ ...us, state: '' })[0].includes('US'), 'and the message names the country, so it is actionable');
ok(addressGaps({ ...gb, zip: '' }).some(g => /postal/.test(g)), 'a British address with no postcode is a gap');
ok(addressGaps({ ...gb, addr1: '' }).includes('street'), 'no street, no shipment');
ok(addressGaps({ ...gb, city: '' }).includes('city'), 'nor no city');
ok(addressGaps({ ...gb, addressee: '' }).includes('name / company'), 'nor nobody to send it to');
ok(addressGaps({ ...gb, country: 'GBR' }).some(g => /two letters/.test(g)), 'a three-letter country is not a UPS country code');
ok(addressGaps({}).length >= 4, 'an empty address is all gaps, not a crash');

// ── INBOUND COUNTS TOO (Stuart 2026-10-21) ───────────────────────────────────
// A supplier in China sending to us has a US ship-TO. Deciding from the destination alone quoted
// that on the DOMESTIC account — the wrong account, the wrong rates, and nothing saying so.
{
    const cn = { addressee: 'Supplier', addr1: '1 Fuhua Rd', city: 'Shenzhen', country: 'CN' };
    ok(crossesBorder({ shipTo: gb }), 'outbound to Britain crosses');
    ok(crossesBorder({ shipFrom: cn, shipTo: us }), 'INBOUND from China crosses too');
    ok(!crossesBorder({ shipTo: us }), 'US to US does not');
    ok(!crossesBorder({ shipFrom: us, shipTo: us }), 'nor with our own origin spelled out');
    ok(crossesBorder({ shipFrom: cn, shipTo: gb }), 'and a third-country move crosses at both ends');
    // The customs value follows the same rule, or an inbound quote would carry none.
    eq(invoiceLineTotalOf({ shipFrom: cn, shipTo: us, declaredValue: 900 }),
        { CurrencyCode: 'USD', MonetaryValue: '900.00' }, 'an inbound move still needs its value');
}

// ── the shipment value UPS wants to rate a border crossing ───────────────────
eq(invoiceLineTotalOf({ shipTo: us, declaredValue: 500 }), null, 'a domestic move needs no declared value');
eq(invoiceLineTotalOf({ shipTo: gb, declaredValue: 500 }), { CurrencyCode: 'USD', MonetaryValue: '500.00' }, 'a border crossing does');
eq(invoiceLineTotalOf({ shipTo: gb, declaredValue: 500, currency: 'eur' }), { CurrencyCode: 'EUR', MonetaryValue: '500.00' }, 'in the currency asked for');
eq(invoiceLineTotalOf({ shipTo: gb }), null, 'and is never invented when nobody gave one');
eq(invoiceLineTotalOf({ shipTo: gb, declaredValue: 0 }), null, 'nor conjured from a zero');
eq(invoiceLineTotalOf({ shipTo: gb, declaredValue: 'abc' }), null, 'nor from nonsense');

// ── UNITS FOLLOW THE ORIGIN (found live 2026-10-21) ──────────────────────────
// UPS refused the first real inbound rate — Hangzhou to High Point — with "111057 Invalid Unit of
// Measurement for the given country". Every package went up as IN/LBS because a US origin had
// always been the only origin.
eq(unitsFor('US'), { dim: 'IN', weight: 'LBS' }, 'leaving the US, inches and pounds');
eq(unitsFor('PR'), { dim: 'IN', weight: 'LBS' }, 'and Puerto Rico with it');
eq(unitsFor('CN'), { dim: 'CM', weight: 'KGS' }, 'leaving China, centimetres and kilograms');
eq(unitsFor('GB'), { dim: 'CM', weight: 'KGS' }, 'and Britain, whatever the floor types');
eq(unitsFor(), { dim: 'IN', weight: 'LBS' }, 'no origin given means our own dock');

// The floor keeps typing inches and pounds; the numbers are converted once, here.
eq(toCm(20), 51, '20 in is 51 cm, rounded UP — a box is never smaller than it is');
eq(toCm(12), 31, 'and 12 in is 31 cm');
eq(toKg(30), 13.6, '30 lb is 13.6 kg, to one decimal');
eq(toKg(35), 15.9, 'and 35 lb is 15.9 kg');
ok(toKg(30) < 14, 'NOT rounded up to a whole kilo — that would add a pound to every box');
eq(toKg(0.2), 0.5, 'and nothing is ever quoted at no weight at all');

console.log(`upsAddress: ${n} assertions passed`);
