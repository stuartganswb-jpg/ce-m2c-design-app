// KIT CODE ⇄ FLOW SELECTIONS (Stuart 2026-08-13, the hybrid). A kit code and a set of CPQ answers
// are the SAME information in two spellings: kitAlign stores setup/frontRail/drive/mount/material
// per kit record, the per-motor codes hang off it as kitMotorCodes. This module translates both
// directions and is what Quick Ship population, the CPQ code field, and the reverse banner all
// share. Pure — node-tested, no Firestore, no React.
//
// GRAMMAR (from Fabricut_Traverse.xlsx, verified by the importer tests):
//   H1-2TRV-4  M?  (D|FRT)?  C?  /(P|EP|W)  (-<watt>(W|C))?
// M = motorized · D = double · FRT = double with the front as a ring · C = ceiling ·
// /P painted /EP plated /W wood · the -NN suffix is a MOTOR wattage and its trailing LETTER is the
// MOUNT (W wall / C ceiling — not wood): H1-2TRV-4M/P-35C is a ceiling kit whose flags carry no C.
//
// THE SECOND FAMILY (Stuart 2026-09-10, tab H1-138TRV of the same workbook — "just the rod and
// brackets change"): the 1-3/8" traverse is a product INSIDE the H1-138 collection, which is why
// that assembly asks Rod Type: Solid / Traverse. Its codes carry no drive or mount letters — every
// kit is hand-drawn and wall-mounted — and one letter this family alone has:
//   H1-138TRV-4  (H|V)  D?  /(P|EP)
// H = horizontal bracket · V = vertical bracket · D = double · /P painted · /EP plated.
// The bracket STYLE is not an engine axis (H1-138TRV-H and -V are two bracket parts at every
// projection), so the seeder REPORTS it rather than picking it — exactly as projection stays asked
// on H1-2TRV. It IS part of a kit's identity: the -4H/P and -4V/P kits share every axis and differ
// only here, so the axes key carries it (blank on every H1-2TRV kit — their keys do not move).

const U = (v) => String(v ?? '').trim().toUpperCase();

export const axesKeyOf = (a) => [U(a?.setup), U(a?.frontRail) || 'TRACK', U(a?.drive), U(a?.mount), U(a?.material), U(a?.bracketStyle)].join('|');

/** Parse a kit code → { family, align, watt } or null when it is not a kit code at all. */
export function parseKitCode(code) {
    const c = U(code);
    const m = c.match(/^(H1-2TRV)-4([A-Z]*)\/(EP|P|W)(?:-(\d+)(W|C))?$/);
    if (m) {
        const [, family, flags, material, watt, mountLetter] = m;
        // flags must be composed ONLY of M / D|FRT / C — anything else is not a code we know
        if (!/^(M)?(D|FRT)?(C)?$/.test(flags)) return null;
        const align = {
            setup: /D|FRT/.test(flags) ? 'DOUBLE' : 'SINGLE',
            frontRail: /FRT/.test(flags) ? 'RING' : 'TRACK',
            drive: /M/.test(flags) ? 'MOTORIZED' : 'MANUAL',
            mount: mountLetter ? (mountLetter === 'C' ? 'CEILING' : 'WALL') : (/C$/.test(flags) ? 'CEILING' : 'WALL'),
            material, minFeet: 4,
        };
        return { family, align, watt: watt || null };
    }
    const m2 = c.match(/^(H1-138TRV)-4(H|V)(D)?\/(EP|P)$/);
    if (m2) {
        const [, family, style, dbl, material] = m2;
        const align = {
            setup: dbl ? 'DOUBLE' : 'SINGLE',
            frontRail: 'TRACK',
            drive: 'MANUAL',
            mount: 'WALL',
            material, minFeet: 4,
            // The two fields this family adds. rodKind answers the H1-138 collection's first
            // question; bracketStyle is reported by the seeder and keys the explosion's bracket.
            rodKind: 'TRAVERSE',
            bracketStyle: style,
        };
        return { family, align, watt: null };
    }
    return null;
}

/** The kit record whose kitAlign matches these axes, or null. `kits` = library docs (partClass Kit). */
export function matchKit(kits, align) {
    const want = axesKeyOf(align);
    return (kits || []).find(k => axesKeyOf(k?.manufacturingSpecs?.kitAlign) === want) || null;
}

/**
 * Resolve a typed code to { kit, motorItem, parsed }. The kit's own motorCodes are the authority —
 * an exact code match there wins (it carries the resolved motor); parsing is the fallback so a
 * base-set code (no motor suffix) still lands. null when nothing matches.
 */
export function resolveKitCode(kits, code) {
    const c = U(code);
    for (const k of kits || []) {
        if (U(k?.legacyErpId || k?.itemId) === c) return { kit: k, motorItem: '', parsed: parseKitCode(c) };
        const mc = (k?.manufacturingSpecs?.kitMotorCodes || []).find(x => U(x.code) === c);
        if (mc) return { kit: k, motorItem: mc.motorItem || '', parsed: parseKitCode(c) };
    }
    const parsed = parseKitCode(c);
    if (!parsed) return null;
    const kit = matchKit(kits, parsed.align);
    return kit ? { kit, motorItem: '', parsed } : null;
}

/**
 * The code the CURRENT configuration resolves to — the reverse banner. Given the axes and (when
 * motorized) the chosen motor item #, returns the customer's own language: the per-motor code when
 * one exists for that motor, else the base kit code. null = no kit matches (a custom order).
 */
export function kitCodeFor(kits, align, motorItem) {
    const kit = matchKit(kits, align);
    if (!kit) return null;
    if (U(align?.drive) === 'MOTORIZED' && motorItem) {
        const mc = (kit.manufacturingSpecs?.kitMotorCodes || []).find(x => U(x.motorItem) === U(motorItem));
        if (mc) return mc.code;
    }
    return kit.legacyErpId || kit.itemId || null;
}

/** Human chips for a parsed code — what the CSR (or a portal user) reads before prefilling. */
export function describeKitAlign(align, motorItem) {
    if (!align) return [];
    const mat = { P: 'Painted aluminum', EP: 'Plated aluminum', W: 'Wood' }[U(align.material)] || align.material;
    const style = { H: 'Horizontal bracket', V: 'Vertical bracket' }[U(align.bracketStyle)];
    return [
        align.setup === 'DOUBLE' ? (U(align.frontRail) === 'RING' ? 'Double — front as ring' : 'Double') : 'Single',
        ...(style ? [style] : []),
        align.drive === 'MOTORIZED' ? 'Motorized' : 'Manual',
        ...(motorItem ? [motorItem] : []),
        U(align.mount) === 'CEILING' ? 'Ceiling' : 'Wall',
        mat, '4ft set minimum',
    ];
}
