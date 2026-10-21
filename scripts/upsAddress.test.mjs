// node scripts/upsAddress.test.mjs — what an address must carry, by country.
import assert from 'node:assert';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { countryOf, isDomestic, needsState, needsPostal, addressGaps, invoiceLineTotalOf } = require('../functions/upsAddress.js');

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

// ── the shipment value UPS wants to rate a border crossing ───────────────────
eq(invoiceLineTotalOf({ shipTo: us, declaredValue: 500 }), null, 'a domestic move needs no declared value');
eq(invoiceLineTotalOf({ shipTo: gb, declaredValue: 500 }), { CurrencyCode: 'USD', MonetaryValue: '500.00' }, 'a border crossing does');
eq(invoiceLineTotalOf({ shipTo: gb, declaredValue: 500, currency: 'eur' }), { CurrencyCode: 'EUR', MonetaryValue: '500.00' }, 'in the currency asked for');
eq(invoiceLineTotalOf({ shipTo: gb }), null, 'and is never invented when nobody gave one');
eq(invoiceLineTotalOf({ shipTo: gb, declaredValue: 0 }), null, 'nor conjured from a zero');
eq(invoiceLineTotalOf({ shipTo: gb, declaredValue: 'abc' }), null, 'nor from nonsense');

console.log(`upsAddress: ${n} assertions passed`);
