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
export function platePrice(plate, normalPrice, hasParent, findByCode) {
    const role = plateRoleOf(plate);
    if (!role) return null;
    const base = Math.max(0, num(normalPrice) ?? 0);

    if (role === 'INCLUDED') {
        // Nothing to be included IN — a plate chosen with no arm/return on the step is a plate the
        // customer is buying on its own, so it bills.
        if (!hasParent) return { price: base, note: 'no arm on this step — plate billed on its own' };
        return { price: 0, note: 'included in the arm / return price' };
    }

    // UPGRADE: the flat upcharge if one is set, else the difference over the plate it replaces.
    const explicit = num(specsOf(plate).plateUpcharge);
    if (explicit !== null) return { price: Math.max(0, explicit), note: `upgrade over ${pairedBackplateCode(plate) || 'the standard plate'}` };

    const bpCode = pairedBackplateCode(plate);
    const bp = bpCode && typeof findByCode === 'function' ? findByCode(bpCode) : null;
    const bpPrice = bp ? (num(specsOf(bp).basePrice ?? bp.basePrice) ?? 0) : null;
    if (bpPrice === null) {
        // We cannot prove what it replaces, so we must not guess a discount — bill it in full and
        // say why, rather than silently under-charging.
        return { price: base, note: `no paired backplate found${bpCode ? ` (${bpCode})` : ''} — billed in full` };
    }
    return { price: Math.max(0, base - bpPrice), note: `upgrade over ${bpCode} ($${bpPrice.toFixed(2)})` };
}
