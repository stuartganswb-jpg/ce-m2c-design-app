// specSheetKits.js — the Fabricut KIT a spec-sheet drawing belongs to (Stuart 2026-09-30).
//
// "for this group H1-2TRV we may need to refer to the kit document on 4.6 and 4.7 as they have kits
//  for 4ft sets rather than the individual parts" · "yes switch it, same for H1-138TRV those are kits
//  as well" · "they select the kit for the general style then they select the projection so you can
//  call them all the kit and add - 3 5/8"P, 4 5/8"P etc." · "Put Kit# Pending" · "drop down and title,.
//  it is important to still show the item id's that are in the kit so they can check the id and specs
//  of just the bracket".
//
// So in the Fabricut edition a traverse bracket drawing is NAMED by its kit — in the sheet dropdown and
// the drawing's title — while every part inside keeps its own id on the sheet. A kit is a 4.6 Kit
// record carrying kitAlign (setup · frontRail · drive · mount · material, + bracketStyle on H1-138TRV),
// read through its family's own fields, never its code letters. Fabricut's number for it is the
// clientSku on the kit's Fabricut customer row (4.6 writes it there; the Fabricut customer is found by
// name, as 4.7 and the price levels find it). A kit has no projection: the projection the customer
// picks rides the kit number as " - 3 5/8"P". A drawing with no kit reads "Kit# Pending".
// Pure — scripts/specSheetKits.test.mjs.
import { parseKitCode } from '../Shared/kitCode.js';

const U = (v) => String(v ?? '').trim().toUpperCase();
const has = (v) => v !== undefined && v !== null && v !== '';

export const KIT_PENDING = 'Kit# Pending';
// The spec sheet's front layer → the kit's front rail (a rod front is the kit's "front as a ring").
const FRONT_RAIL = { FASCIA: 'RING', TRACK: 'TRACK' };
const MATERIAL_WORD = { P: 'painted', EP: 'plated', W: 'wood' };
const MATERIAL_ORDER = ['P', 'EP', 'W'];

const codeOf = (p) => U(p?.legacyErpId && p.legacyErpId !== 'PENDING' ? p.legacyErpId : p?.itemId);
const familyOfKit = (p) => U(p?.manufacturingSpecs?.kitFamily) || U(parseKitCode(codeOf(p))?.family);

/** The system kits of one family (a Kit record with kitAlign), retired ones left out. */
export function kitsOfFamily(parts, family) {
    const fam = U(family);
    if (!fam) return [];
    return (parts || []).filter(p => p && p.partClass === 'Kit' && p.manufacturingSpecs?.kitAlign
        && p.manufacturingSpecs?.isRetired !== true && familyOfKit(p) === fam);
}

/** Fabricut's number for a kit: the clientSku on its Fabricut customer row. */
export function fabricutKitNumber(kit) {
    const row = (Array.isArray(kit?.clientPricing) ? kit.clientPricing : [])
        .find(r => /fabricut/i.test(String(r?.customerName || '')) && String(r?.clientSku || '').trim());
    return row ? String(row.clientSku).trim() : '';
}

/**
 * What a drawing asks of a kit — its own set-up. `family` is the rod the drawing carries (a kit family is
 * named after its rod: H1-2TRV, H1-138TRV). Only the axes the drawing states are asked.
 */
export function kitWantOf({ family, answers = {}, styles } = {}) {
    const a = answers || {};
    return {
        family: U(family),
        setup: U(a.setup) || undefined,
        frontRail: FRONT_RAIL[U(a.frontLayer)] || undefined,
        drive: U(a.drive) || undefined,
        mount: U(a.mount) || undefined,
        proj: has(a.proj) ? Number(a.proj) : undefined,
        styles: Array.isArray(styles) && styles.length ? styles.map(U) : undefined,
    };
}

/** The kits (every material, every style asked) that match a want. */
export function kitsFor(parts, want) {
    if (!want?.family) return [];
    return kitsOfFamily(parts, want.family).filter(k => {
        const al = k.manufacturingSpecs.kitAlign;
        const same = (key) => !has(want[key]) || U(al[key] || (key === 'frontRail' ? 'TRACK' : '')) === want[key];
        return same('setup') && same('frontRail') && same('drive') && same('mount')
            && (!want.styles || want.styles.includes(U(al.bracketStyle)));
    });
}

// 3.625 → 3 5/8 · 6 → 6 · 6.5 → 6 1/2 (to the sixteenth).
export function inchWords(n) {
    const x = Number(n);
    if (!Number.isFinite(x) || x <= 0) return '';
    let whole = Math.floor(x), six = Math.round((x - whole) * 16);
    if (six === 16) { whole += 1; six = 0; }
    if (!six) return String(whole);
    let num = six, den = 16;
    while (num % 2 === 0) { num /= 2; den /= 2; }
    return whole ? `${whole} ${num}/${den}` : `${num}/${den}`;
}
export const projSuffix = (proj) => (inchWords(proj) ? ` - ${inchWords(proj)}"P` : '');

// One kit number for a group of kits: the painted one (painted and plated share a pattern — plated is
// its PREMIUM tier), else plated, else wood.
const leadNumber = (kits) => {
    for (const m of MATERIAL_ORDER) {
        const n = fabricutKitNumber(kits.find(k => U(k.manufacturingSpecs.kitAlign.material) === m));
        if (n) return n;
    }
    return '';
};

/** The name a drawing goes by in the Fabricut edition — the kit number and the projection, or Kit# Pending. */
export function kitName(parts, want) {
    const kits = kitsFor(parts, want);
    const suffix = projSuffix(want?.proj);
    if (want?.styles) {
        const byStyle = want.styles.map(s => {
            const n = leadNumber(kits.filter(k => U(k.manufacturingSpecs.kitAlign.bracketStyle) === s));
            return n ? `${n} (${s})` : '';
        }).filter(Boolean);
        return byStyle.length ? `${byStyle.join(' / ')}${suffix}` : KIT_PENDING;
    }
    const n = leadNumber(kits);
    return n ? `${n}${suffix}` : KIT_PENDING;
}

/** The kit line under a drawing's title: each material's number, and the set length. */
export function kitLine(parts, want) {
    const kits = kitsFor(parts, want);
    const nums = MATERIAL_ORDER.flatMap(m => kits.filter(k => U(k.manufacturingSpecs.kitAlign.material) === m)
        .map(k => ({ n: fabricutKitNumber(k), m, style: U(k.manufacturingSpecs.kitAlign.bracketStyle) })))
        .filter(x => x.n);
    if (!nums.length) return `Fabricut kit: ${KIT_PENDING}`;
    const feet = Math.max(...kits.map(k => Number(k.manufacturingSpecs.kitAlign.minFeet) || 0));
    const words = nums.map(x => `${x.n}${x.style ? ` (${x.style})` : ''} ${MATERIAL_WORD[x.m] || x.m.toLowerCase()}`);
    return `Fabricut kit ${words.join(' · ')}${feet ? ` — ${feet} ft set` : ''}`;
}
