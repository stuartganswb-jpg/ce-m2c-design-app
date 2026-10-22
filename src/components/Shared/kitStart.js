// "START FROM A KIT" — WHICH KITS A FLOW OFFERS, WHAT PICKING ONE FILLS IN, AND THE KIT'S BRACKETS AS THEIR STEPS BECOME
// ANSWERABLE. This is CPQ's picker (HardwareConfigurator.applyKit + its kit-bracket effect, and CPQTab's seedableKits),
// moved here word for word on 2026-10-20 so the customer portal starts a kit exactly as CPQ does (Stuart: "the traverse kits
// needs to behave the same cpq in the app"). CPQ's screen and the portal's server (functions/portalSession) both call it.
//
// It decides nothing new. The seed is kitSeed.seedFromKit and the bracket fills are kitBracketPicks — unchanged; this file is
// only the ORDER CPQ calls them in, and the words of the strip under the picker. kitSeed.js is one of the five stamped engine
// files, so nothing was added there (a change would read as "engine changed" on every saved quote). Pure.
import { kitsForSeeding, seedFromKit } from './kitSeed.js';
import { kitBracketPicksOf, kitBracketSummary } from './kitBracketPicks.js';
import { parseKitCode } from './kitCode.js';

const U = (v) => String(v == null ? '' : v).trim().toUpperCase();

/**
 * THE ROD TYPE THE KIT'S OWN CODE SAYS (Stuart 2026-10-22, H1-2TRV-4M/P: "when we select a fabricut kit it correctly makes all
 * the selections on step 1 except it did not push the traverse rod as selected and that allows the wrong options to still be
 * shown"). Every H1-2TRV-4… code is a traverse system, but the family's kits were imported while H1-2TRV held only the traverse,
 * so their stored alignment never answered Rod Type — and kitSeed leaves a field the kit does not carry alone. The code is the
 * kit's identity (Shared/kitCode), so where the record is silent the code answers; a stored rodKind always wins. kitSeed.js is
 * a stamped engine file, so the reading is done here, before the seed.
 */
export const kitAsItsCodeSays = (kit) => {
    const align = kit && kit.manufacturingSpecs && kit.manufacturingSpecs.kitAlign;
    if (!align || U(align.rodKind)) return kit;
    const fromCode = U(((parseKitCode(kit.legacyErpId || kit.itemId) || {}).align || {}).rodKind);
    return fromCode ? { ...kit, manufacturingSpecs: { ...kit.manufacturingSpecs, kitAlign: { ...align, rodKind: fromCode } } } : kit;
};

/** The id a kit is picked by, as CPQ's picker holds it. */
export const kitIdOf = (k) => String((k && (k.id || k.legacyErpId)) || '');

/**
 * Which kits belong to a flow (CPQTab, 2026-08-26): a kit tagged with the flow's kitFamily (the tag system), or with the
 * assembly's code or its family segment (a generator-suffixed name "H1-2TRV — GENERATED" still finds "H1-2TRV"), or whose
 * own code is the assembly's code or starts with it (the legacy prefix).
 * @returns { base, famFlow, matches(kit) }
 */
export function kitMatcherOf({ assembly = null, flow = null } = {}) {
    const a = assembly;
    const base = a ? U((a.legacyErpId && a.legacyErpId !== 'PENDING' ? a.legacyErpId : '') || a.itemName || a.itemId || '') : '';
    const famFlow = U(flow && flow.kitFamily);
    const baseFam = base.includes(' — ') ? base.split(' — ')[0].trim() : (base.includes(' - ') ? base.split(' - ')[0].trim() : '');
    const matches = (k) => {
        const kf = U(k && k.manufacturingSpecs && k.manufacturingSpecs.kitFamily);
        if (famFlow && kf === famFlow) return true;                       // the tag system
        if (kf && base && kf === base) return true;                       // kit tagged with the assembly code
        if (kf && baseFam && kf === baseFam) return true;
        const code = U(k && (k.legacyErpId || k.itemName));
        if (base && (code === base || code.startsWith(base + '-'))) return true;   // legacy prefix
        return !!baseFam && (code === baseFam || code.startsWith(baseFam + '-'));  // suffixed-name family
    };
    return { base, famFlow, matches };
}

/** The kits "Start from a kit" offers on a flow: Kit-class records that carry an alignment and belong to it. */
export function kitsForFlowOf(kitLibrary = [], { assembly = null, flow = null } = {}) {
    if (!assembly) return [];
    const { base, famFlow, matches } = kitMatcherOf({ assembly, flow });
    if (!base && !famFlow) return [];
    return kitsForSeeding(kitLibrary || []).filter(matches);
}

/** …and the ones that belong to it but lost their alignment — the picker SAYS so rather than silently showing fewer. */
export function unalignedKitsForFlowOf(kitLibrary = [], { assembly = null, flow = null } = {}) {
    const { base, matches } = kitMatcherOf({ assembly, flow });
    return base ? (kitLibrary || []).filter(k => !(k && k.manufacturingSpecs && k.manufacturingSpecs.kitAlign)).filter(matches).length : 0;
}

/**
 * Picking a kit (CPQ's applyKit, 2026-08-22): it SEEDS, it does not lock — every answer stays editable. A kit the assembly
 * cannot build fills in NOTHING (`blocked`). The kit's base length is offered only where no length is typed yet (2026-09-19,
 * QUO155: a re-picked kit must never overwrite a measured 18"). The strip says what was filled in and what was not.
 * @returns { name, blocked, answers, picks, lengthInches, report: { name, blocked, carried, missed }, kitSource }
 */
export function kitStartOf({ model, kit, lengthTyped = false } = {}) {
    const name = String((kit && (kit.legacyErpId || kit.itemName)) || 'the kit');
    const seed = seedFromKit({ model, kit: kitAsItsCodeSays(kit) });
    if (seed.blocked) return { name, blocked: seed.blocked, answers: {}, picks: {}, lengthInches: null, report: { name, blocked: seed.blocked, carried: [], missed: [] }, kitSource: null };
    // The brackets are filled in as they become answerable (kitFillsOf), not reported: the strip says what the kit will pick, and
    // the old "pick the V backplate" instruction is dropped where the kit names its own (Shared/kitBracketPicks).
    const fills = kitBracketSummary({ kit });
    return {
        name, blocked: null, answers: seed.answers, picks: seed.picks,
        lengthInches: seed.lengthInches && !lengthTyped ? seed.lengthInches : null,
        report: { name, blocked: null, carried: fills ? [...seed.carried, fills] : seed.carried, missed: fills ? seed.missed.filter(m => m.what !== 'bracket style') : seed.missed },
        // The kit OWNS the first line of the bill, and the feet above its base bill under it — held as the record, priced later
        // through the same rules every other line uses (hardwareSession.kitBillOf).
        kitSource: { code: name, name: kit.itemName || name, baseFeet: Number(kit.manufacturingSpecs.kitAlign.minFeet) || 4, record: kit },
    };
}

/**
 * The kit's brackets, picked as they become answerable (CPQ's kit-bracket effect, 2026-10-01: "it should prepopulate … the
 * bracket selections in the kit"): the arm once the projection is answered, then the plate in the kit's orientation. Each
 * (slot, part) is filled once (`done`); a pick the customer or operator made is never touched. The CENTRE is filled only where
 * the span wants one (recommendFor: 0 = a short pole held at both ends) — picked regardless it would count as one, above the
 * kit's chart, billed.
 * @returns { [slotKey]: choiceId }
 */
export function kitFillsOf({ model, kit, answers, livePicks, ourId, recommendFor, done } = {}) {
    return kitBracketPicksOf({ model, kit, answers, livePicks,
        codeOf: (o) => ourId(o.partId) || o.name, done,
        wants: (slot) => String(slot.position || '').toUpperCase() !== 'CENTER' || recommendFor(slot) > 0 });
}
