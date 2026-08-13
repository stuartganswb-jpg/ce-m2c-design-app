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

const U = (v) => String(v ?? '').trim().toUpperCase();

export const axesKeyOf = (a) => [U(a?.setup), U(a?.frontRail) || 'TRACK', U(a?.drive), U(a?.mount), U(a?.material)].join('|');

/** Parse a kit code → { family, align, watt } or null when it is not a kit code at all. */
export function parseKitCode(code) {
    const m = U(code).match(/^(H1-2TRV)-4([A-Z]*)\/(EP|P|W)(?:-(\d+)(W|C))?$/);
    if (!m) return null;
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
    return [
        align.setup === 'DOUBLE' ? (U(align.frontRail) === 'RING' ? 'Double — front as ring' : 'Double') : 'Single',
        align.drive === 'MOTORIZED' ? 'Motorized' : 'Manual',
        ...(motorItem ? [motorItem] : []),
        U(align.mount) === 'CEILING' ? 'Ceiling' : 'Wall',
        mat, '4ft set minimum',
    ];
}
