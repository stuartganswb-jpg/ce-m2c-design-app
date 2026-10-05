// ── ONE ITEM, A SECOND CUSTOMER NUMBER — WHICH ONE PRINTS FOLLOWS HOW IT WAS ORDERED (Stuart 2026-10-04) ────────────
// "how do we make the vertical #'s appear … we need to be able to enter both depending on what they order it must be
//  clear on the customer forms and to the floor" · "we have to sell these as each … in the configurator we select left,
//  center, right" · "take in consideration the 2\" return arms as well".
//
// Fabricut's catalog gives some of OUR single items two numbers:
//   · a 1-3/8" traverse bracket arm is H3629F with the horizontal backplate and H3626F with the vertical one — the arm
//     carries the price and the plate rides free (Shared/plateRules), exactly as every other bracket, so there is one
//     arm record and it could only ever print one number;
//   · a 2" traverse return arm is H3634F at the left end and H3635F at the right — ours is one arm that fits both.
// The second number lives on the SAME record, in the same Customer Alias & Pricing box, as a row that says when it applies:
//   manufacturingSpecs.fabricut.altCodes = [{ plate, position, painted, premium }]
//     plate     our item # of the backplate picked with it (the mill base — H1-138TRVBP-V; a finish suffix is ignored)
//     position  LEFT · CENTER · RIGHT — where along the rod this one sits
//     painted / premium   the customer's number, as the Pattern # (painted) / (premium /EP) fields beside it
// A row applies when EVERYTHING it names is true of the line; a row naming both outranks a row naming one. No row, or
// none that applies → the item's ordinary pattern # prints, exactly as before. Like the pattern # itself, the rows sit on
// the BASE item and its finish variants answer from it (Shared/priceLevels.fabricutCodeOf).
//
// This decides a NUMBER and nothing else: the price, the line, the quantity, the item that is picked and what reaches
// NetSuite are not read or changed here. Pure — scripts/altPattern.test.mjs.
import { isPlatedSuffix } from './priceLevels.js';

const U = (v) => String(v == null ? '' : v).trim().toUpperCase();
const baseOf = (code) => U(code).split('/')[0];
const codeOf = (p) => U(p && (p.legacyErpId && p.legacyErpId !== 'PENDING' ? p.legacyErpId : p.itemId));
const DEFAULT_KEYS = ['fabCodePainted', 'fabCodePremium', 'fabCodeBase'];

export const ALT_POSITIONS = ['LEFT', 'CENTER', 'RIGHT'];

// The record whose box answers: a finish variant — or a record with no box of its own — reads its base item's.
const boxOf = (part, findByCode) => {
    if (!part) return null;
    const code = codeOf(part);
    const own = part.manufacturingSpecs && part.manufacturingSpecs.fabricut;
    const doc = ((code.includes('/') || !own) && typeof findByCode === 'function') ? (findByCode(baseOf(code)) || part) : part;
    return (doc && doc.manufacturingSpecs && doc.manufacturingSpecs.fabricut) || null;
};

const cleanRow = (r) => ({
    plate: baseOf(r && r.plate),
    position: ALT_POSITIONS.includes(U(r && r.position)) ? U(r.position) : '',
    painted: U(r && r.painted),
    premium: U(r && r.premium),
});
const weight = (r) => (r.plate ? 1 : 0) + (r.position ? 1 : 0);

/** The rows that can ever apply: each names a backplate and/or a position, and carries at least one number. */
export const altPatternRowsOf = (part, findByCode) => {
    const fab = boxOf(part, findByCode);
    const rows = fab && Array.isArray(fab.altCodes) ? fab.altCodes : [];
    return rows.map(cleanRow).filter(r => weight(r) > 0 && (r.painted || r.premium));
};

/**
 * The second number for an item ordered this way — '' when no row applies.
 * @param part        the library record on the line (the mill base or a finish variant)
 * @param order       { plateCode: the backplate picked with it, position: LEFT | CENTER | RIGHT, plated: a plated finish }
 * @param findByCode  UPPERCASE code → library record (the variant's base item)
 */
export const altPatternFor = (part, { plateCode = '', position = '', plated = false } = {}, findByCode) => {
    const plate = baseOf(plateCode), pos = U(position);
    const hits = altPatternRowsOf(part, findByCode).filter(r => (!r.plate || r.plate === plate) && (!r.position || r.position === pos));
    if (!hits.length) return '';
    const best = hits.reduce((b, r) => (weight(r) > weight(b) ? r : b), hits[0]);
    // premium on a plated finish, falling back to the other — the rule the ordinary pattern # follows
    return plated ? (best.premium || best.painted) : (best.painted || best.premium);
};

/** The item's ordinary pattern #s — the only numbers a second number ever stands in for. */
export const defaultPatternsOf = (part, findByCode) => {
    const fab = boxOf(part, findByCode);
    return fab ? DEFAULT_KEYS.map(k => U(fab[k])).filter(Boolean) : [];
};

/**
 * THE NUMBER A PRICED LINE SHOULD PRINT INSTEAD — '' to leave the line as the price chain answered it.
 * `printed` is that answer (the customer row's SKU, else the pattern #). The second number replaces the item's OWN
 * ordinary pattern # (or a blank); a different SKU on a customer's own row is that customer's number and stands.
 * Painted or premium follows the record actually billed (`billedId` — …/EPn and the outsourced codes are plated).
 */
export const printedPatternOf = (part, { printed = '', plateCode = '', position = '', billedId = '', outsourceCodes } = {}, findByCode) => {
    const sfx = U(billedId).includes('/') ? U(billedId).split('/')[1] : '';
    const alt = altPatternFor(part, { plateCode, position, plated: isPlatedSuffix(sfx, outsourceCodes) }, findByCode);
    if (!alt) return '';
    const p = U(printed);
    return (!p || defaultPatternsOf(part, findByCode).includes(p)) ? alt : '';
};

/**
 * The item's second numbers, each with WHEN it applies in words — for a lookup that has to tell the reader how the
 * number is ordered ("H3626F · with H1-138TRVBP-V", "H3635F · at the right").
 * @returns [{ code, when, plate, position }]
 */
export const altPatternListOf = (part, findByCode) => altPatternRowsOf(part, findByCode).flatMap(r => {
    const when = [r.plate ? `with ${r.plate}` : '', r.position ? `at the ${r.position.toLowerCase()}` : ''].filter(Boolean).join(', ');
    return [...new Set([r.painted, r.premium].filter(Boolean))].map(code => ({ code, when, plate: r.plate, position: r.position }));
});

/** Every second number carried on THIS record — the search fields answer to them too (Shared/aliasSearch). */
export const altPatternCodesOf = (part) => {
    const rows = part && part.manufacturingSpecs && part.manufacturingSpecs.fabricut && part.manufacturingSpecs.fabricut.altCodes;
    return Array.isArray(rows) ? rows.flatMap(r => [r && r.painted, r && r.premium]).map(v => String(v || '').trim()).filter(Boolean) : [];
};
