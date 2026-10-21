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

// ⚠ A SHIPMENT IS INTERNATIONAL IF **EITHER END** IS ABROAD — not just the destination. An INBOUND
// move (a supplier in China sending to us) has a US ship-TO, so deciding from the destination alone
// quoted it on the DOMESTIC account: the wrong account, and therefore the wrong rates, with nothing
// on screen to say so (Stuart 2026-10-21, asking to rate inbound from suppliers).
function crossesBorder({ shipFrom, shipTo, shipperCountry = 'US' }) {
    const home = up(shipperCountry || 'US');
    const from = shipFrom ? countryOf(shipFrom) : home;    // no origin given means we are the origin
    const to = countryOf(shipTo);
    return from !== home || to !== home;
}

// ⚠ UNITS FOLLOW THE ORIGIN COUNTRY, NOT OURS. UPS refuses a parcel leaving China quoted in inches
// and pounds — "111057 Invalid Unit of Measurement for the given country", seen live on the first
// real inbound rate (Hangzhou → High Point, 2026-10-21). Outbound never met it, because a US origin
// is exactly the case where inches and pounds are right. On UPS's API only the US and Puerto Rico
// are imperial; everywhere else is centimetres and kilograms.
const IMPERIAL_UNITS = new Set(['US', 'PR']);
const unitsFor = (country) => (IMPERIAL_UNITS.has(up(country) || 'US')
    ? { dim: 'IN', weight: 'LBS' }
    : { dim: 'CM', weight: 'KGS' });

// The floor types inches and pounds whatever the origin, so the conversion lives here rather than
// in somebody's head at a desk. Dimensions round UP (a box is not smaller than it is); weight keeps
// one decimal, because rounding 30 lb up to a whole kilo would quietly add a pound to every box.
const toCm = (inches) => Math.ceil(Number(inches) * 2.54);
const toKg = (pounds) => Math.max(0.5, Math.round(Number(pounds) * 0.45359237 * 10) / 10);

// UPS REQUIRES A SHIPMENT VALUE to rate many international lanes, and returns a refusal or a wrong
// figure without one. It is meaningless on a domestic move, so it is sent only when the parcel
// actually crosses a border — never invented, never defaulted to a number nobody chose.
function invoiceLineTotalOf({ shipTo, shipFrom, shipperCountry = 'US', declaredValue, currency = 'USD' }) {
    if (!crossesBorder({ shipFrom, shipTo, shipperCountry })) return null;
    const v = Number(declaredValue);
    if (!Number.isFinite(v) || v <= 0) return null;
    return { CurrencyCode: up(currency).slice(0, 3) || 'USD', MonetaryValue: v.toFixed(2) };
}

module.exports = {
    STATE_REQUIRED, NO_POSTAL, IMPERIAL_UNITS,
    countryOf, isDomestic, crossesBorder, needsState, needsPostal, addressGaps, invoiceLineTotalOf,
    unitsFor, toCm, toKg,
};
