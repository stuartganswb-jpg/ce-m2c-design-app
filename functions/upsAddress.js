// 🌍 WHAT AN ADDRESS MUST CARRY, BY COUNTRY — so an international shipment can be rated at all.
//
// Stuart 2026-10-21: live negotiated rates for international, from UPS's own system rather than the
// uploaded agreement. The rating call already asked for negotiated rates and already knew the
// international services — what stopped it was our OWN validation: street, city, STATE and ZIP were
// demanded of every address on earth. Most countries have no state, several have no postal code, so
// a perfectly good London or Dublin address was refused here before UPS ever saw it.
//
// This decides what a given country actually needs. It is used by rating AND by label creation,
// because a label to a country without provinces should not demand one either.

// UPS wants a state/province code for these. Elsewhere it is optional and sent only when given.
const STATE_REQUIRED = new Set(['US', 'CA', 'PR', 'MX', 'IE', 'IN', 'AU', 'BR', 'CN', 'IT', 'ES']);

// Countries with no postal code system at all — demanding one makes them unshippable.
// (UPS accepts an empty PostalCode for these.)
const NO_POSTAL = new Set([
    'AE', 'AO', 'AW', 'BF', 'BI', 'BJ', 'BO', 'BS', 'BW', 'BZ', 'CD', 'CF', 'CG', 'CI', 'CK', 'CM',
    'DJ', 'DM', 'ER', 'FJ', 'GD', 'GH', 'GM', 'GQ', 'GY', 'HK', 'JM', 'KI', 'KM', 'KP', 'LY', 'ML',
    'MO', 'MR', 'MW', 'NA', 'NR', 'NU', 'PA', 'QA', 'RW', 'SB', 'SC', 'SL', 'SR', 'ST', 'SY', 'TF',
    'TG', 'TK', 'TL', 'TO', 'TT', 'TV', 'UG', 'VU', 'WS', 'YE', 'ZW',
]);

const str = (v) => String(v === undefined || v === null ? '' : v).trim();
const up = (v) => str(v).toUpperCase();

// ⚠ NEVER TRUNCATE A COUNTRY CODE. Slicing to two letters turns GBR into GB, which is right by
// luck — and turns AUT (Austria) into AU (Australia), which puts a parcel on the wrong continent
// and reads as perfectly valid all the way to the label. A code that is not exactly two letters is
// REFUSED below and a person fixes it.
const countryOf = (a) => (up((a || {}).country) || 'US');
const isDomestic = (a, shipperCountry = 'US') => countryOf(a) === up(shipperCountry || 'US');

const needsState = (country) => STATE_REQUIRED.has(up(country));
const needsPostal = (country) => !NO_POSTAL.has(up(country));

// What is missing, in the words a person would use. Returns [] when the address can be sent.
function addressGaps(a) {
    const s = a || {};
    const country = countryOf(s);
    const gaps = [];
    if (!str(s.addressee || s.attention)) gaps.push('name / company');
    if (!str(s.addr1)) gaps.push('street');
    if (!str(s.city)) gaps.push('city');
    if (needsState(country) && !str(s.state)) gaps.push(`state / province (required for ${country})`);
    if (needsPostal(country) && !str(s.zip)) gaps.push(`postal code (required for ${country})`);
    if (!/^[A-Z]{2}$/.test(country)) gaps.push('country (two letters, e.g. GB)');
    return gaps;
}

// UPS REQUIRES A SHIPMENT VALUE to rate many international lanes, and returns a refusal or a wrong
// figure without one. It is meaningless on a domestic move, so it is sent only when the parcel
// actually crosses a border — never invented, never defaulted to a number nobody chose.
function invoiceLineTotalOf({ shipTo, shipperCountry = 'US', declaredValue, currency = 'USD' }) {
    if (isDomestic(shipTo, shipperCountry)) return null;
    const v = Number(declaredValue);
    if (!Number.isFinite(v) || v <= 0) return null;
    return { CurrencyCode: up(currency).slice(0, 3) || 'USD', MonetaryValue: v.toFixed(2) };
}

module.exports = {
    STATE_REQUIRED, NO_POSTAL,
    countryOf, isDomestic, needsState, needsPostal, addressGaps, invoiceLineTotalOf,
};
