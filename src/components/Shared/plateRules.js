// PLATE ASSOCIATIONS — the backplate rides free with its arm; the cover plate is the paid upgrade.
//
// Stuart 2026-08-03: "the backplate pricing was included when we selected a bracket arm and then if
// a cover plate was chosen there was a $10 upcharge. now it is no longer combining these items with
// the brackets just charging for them … we need to be able to associate the backplates with the
// coverplates and then both of those can be associated with bracket arms or even the french and
// miter returns (fees)."
//
// WHY IT STOPPED: the BP-$0 / CP-upcharge rule has only ever run at the FABRICUT price levels
// (CPQTab guards it with `priceLevel !== 'STANDARD'`, added with Phase 3 price levels), where it is
// carried by fabricut.retail === null meaning "included in the arm". On STANDARD — our own internal
// pricing — plates have always billed at whatever manufacturingSpecs.basePrice says. So the moment
// real base prices landed on the plate items the quote started charging for them.
//
// THE MODEL, and it is deliberately OPT-IN so nothing anywhere changes until a pairing is declared:
//   BACKPLATE   manufacturingSpecs.plateRole = 'INCLUDED'
//               → $0 whenever the step has a main selection (the bracket arm, or a french/miter
//                 return fee). Its cost lives in that arm's price. With NO main selection it prices
//                 normally, because then nothing is including it.
//   COVER PLATE manufacturingSpecs.plateRole = 'UPGRADE'
//               manufacturingSpecs.plateUpgradeOf   the BP item # it replaces (blank → derived from
//                                                   the code, H1-1CP-R ⇄ H1-1BP-R)
//               manufacturingSpecs.plateUpcharge    the flat $ over that BP (blank → CP base − BP base)
//               → bills the upcharge only, so the arm keeps covering the plate it was always
//                 covering and the customer pays only for the upgrade.
//   anything else / unset → priced exactly as before. No blast radius.

import { isPlatedSuffix } from './priceLevels';

// PREMIUM TIER (Stuart 2026-08-03: "the rule is affected also by the /p or /ep premium"). A plated
// cover plate costs more to upgrade to than a painted one, so the upcharge is TIERED exactly the
// way every other price in the app is — painted vs plated — and the tier is decided by the same
// isPlatedSuffix the Fabricut ladder uses, so /EP1-6 and /P25 agree everywhere. /P is phosphate,
// an in-house paint step, and stays on the painted tier.
// WHICH ARMS AND RETURNS CARRY A FREE PLATE (Stuart 2026-08-03: "where can i assign the parts that
// the backplates are included? i do not see how using this tool i can tell it to include backplates
// and upgrade cover plates for miter returns").
//
// He is right that there was nowhere to say it. The rule was IMPLICIT — any main selection on the
// step (bracket arm, or a french/miter return that replaces the arm) included the plate. That is
// the correct DEFAULT, because it is how the catalogue actually works, but it left no way to see
// which items carry a plate or to name an exception.
//
// So the tick is an OVERRIDE, not a gate: manufacturingSpecs.includesPlate === false means THIS arm
// or fee does NOT cover its plate, and the plate bills normally. Undefined keeps today's behaviour.
// Declaring it as an allow-list instead would have silently un-included every arm nobody got to yet.
export const includesPlate = (parentPart) => specsOf(parentPart).includesPlate !== false;

export const PLATE_ROLES = [
    { id: '', label: '— none (priced normally) —' },
    { id: 'INCLUDED', label: 'Backplate — included with the arm / return ($0 on the quote)' },
    { id: 'UPGRADE', label: 'Cover plate — upgrade, bills the upcharge only' },
];

const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
const specsOf = (p) => (p && p.manufacturingSpecs) || {};
export const codeOfPart = (p) => String((p && (p.legacyErpId || p.itemId)) || '').trim().toUpperCase();

export const plateRoleOf = (part) => {
    const r = String(specsOf(part).plateRole || '').trim().toUpperCase();
    return (r === 'INCLUDED' || r === 'UPGRADE') ? r : '';
};

export const suffixOfCode = (code) => { const c = String(code || ''); const i = c.lastIndexOf('/'); return i > 0 ? c.slice(i + 1).toUpperCase() : ''; };

// Is THIS line the premium tier? Either the resolved plate is itself a plated variant, or the step's
// chosen finish is a plated code (the case where the plate doc is the suffixless base).
export const isPremiumPlate = (plate, finishCode, outsourceCodes) =>
    isPlatedSuffix(suffixOfCode(codeOfPart(plate)), outsourceCodes) ||
    isPlatedSuffix(String(finishCode || '').toUpperCase(), outsourceCodes);

// The backplate a cover plate replaces. Explicit field wins; otherwise the house naming convention
// — …CP… ⇄ …BP… on the same stem, finish suffix preserved — which is how every H1 plate is named.
export const pairedBackplateCode = (part) => {
    const explicit = String(specsOf(part).plateUpgradeOf || '').trim().toUpperCase();
    if (explicit) return explicit;
    const code = codeOfPart(part);
    if (!code) return '';
    // The real codes read H1-1CP-R / H1-1BP-R — the CP follows a DIGIT, so a plain word boundary
    // never fires. Swap a CP preceded by a non-LETTER (digit, dash, or start) and followed by a
    // delimiter or end: H1-1CP-R ✓, H1-1CP-V/EP4 ✓, but HCPX-9 and HCP-9 are left alone, because
    // there the CP is part of a word and swapping it would invent an item that doesn't exist.
    const swapped = code.replace(/(^|[^A-Z])CP(?=$|[^A-Z0-9])/g, (m, pre) => `${pre}BP`);
    return swapped === code ? '' : swapped;
};

/**
 * What a plate sub-line should actually bill.
 *
 * @param {object}   plate        the resolved plate item (after size/species/finish resolution)
 * @param {number}   normalPrice  what it would have billed with no association at all
 * @param {boolean}  hasParent    does the step carry a main selection (bracket arm or return fee)?
 * @param {function} findByCode   (CODE) => part, to resolve the paired backplate
 * @returns {{price:number, note:string}|null}  null = no association, caller keeps normalPrice
 */
export function platePrice({ plate, baseDoc, normalPrice, hasParent, parentPart, finishCode, outsourceCodes, findByCode }) {
    // The role is declared on whichever doc carries it. A finish VARIANT (H1-1CP-V/EP4) is usually a
    // separate record from its mill base, and nobody should have to tag all of them — so the base
    // doc answers for its variants, exactly as the finish-variant price chain already does.
    const role = plateRoleOf(plate) || plateRoleOf(baseDoc);
    if (!role) return null;
    const src = plateRoleOf(plate) ? plate : baseDoc;   // the doc whose fields we read
    const base = Math.max(0, num(normalPrice) ?? 0);

    if (role === 'INCLUDED') {
        // Nothing to be included IN — a plate chosen with no arm/return on the step is a plate the
        // customer is buying on its own, so it bills.
        if (!hasParent) return { price: base, note: 'no arm on this step — plate billed on its own' };
        // …or the arm/return on this step is one that has been told it does NOT cover its plate.
        if (!includesPlate(parentPart)) return { price: base, note: `${codeOfPart(parentPart) || 'this arm'} does not include its plate — billed` };
        return { price: 0, note: `included in ${codeOfPart(parentPart) || 'the arm / return'} price` };
    }

    // UPGRADE. Tiered: a plated upgrade may cost more than a painted one, and the premium field
    // falls back to the painted one when it is left blank, so a single figure still works.
    const premium = isPremiumPlate(plate, finishCode, outsourceCodes);
    const tierNote = premium ? ' premium' : '';
    const explicit = premium
        ? (num(specsOf(src).plateUpchargePremium) ?? num(specsOf(src).plateUpcharge))
        : num(specsOf(src).plateUpcharge);
    // Pair off the RESOLVED plate so the finish suffix carries into the code we look up.
    const bpCode = pairedBackplateCode(plate) || pairedBackplateCode(src);
    if (explicit !== null) return { price: Math.max(0, explicit), note: `${tierNote ? 'premium ' : ''}upgrade over ${bpCode || 'the standard plate'}` };

    const bp = bpCode && typeof findByCode === 'function' ? findByCode(bpCode) : null;
    const bpPrice = bp ? (num(specsOf(bp).basePrice ?? bp.basePrice) ?? 0) : null;
    if (bpPrice === null) {
        // We cannot prove what it replaces, so we must not guess a discount — bill it in full and
        // say why, rather than silently under-charging.
        return { price: base, note: `no paired backplate found${bpCode ? ` (${bpCode})` : ''} — billed in full` };
    }
    return { price: Math.max(0, base - bpPrice), note: `${tierNote ? 'premium ' : ''}upgrade over ${bpCode} ($${bpPrice.toFixed(2)})` };
}
