// H1 SIZE-MATRIX — one CPQ flow covers a whole size family (Rod Diameter × Bracket Projection)
// instead of one near-identical flow per combination. The flow keeps the master geometry (built on
// 3/4" × 4-5/8"); two injected top-level SIZE steps record the chosen diameter/projection; and every
// consumer (CPQ pricing, ERP push, Vision math) resolves each configured part to the right size
// variant through the sizeKey metadata the Fabricut importer stamps on library items
// (manufacturingSpecs.customData.sizeKey = { family, dia, style, projLetter }).
//
// Resolution is sizeKey → sizeKey lookup (no code string surgery at runtime): the base part's key
// gives (style, projLetter); swap in the selected dia/proj; find the library part carrying that key.
// Special rules:
//  - styles with no projection letter (plates, ceiling, inside mount, finials, poles, rings) ignore
//    the Projection answer;
//  - doubles (projLetter 'D') keep their fixed dual projection;
//  - RBP-x/RCP-x (return plates) exist ONLY at 3/4" — at 1" and 1-3/8" returns pair with the
//    STANDARD plates, so the style collapses RBP→BP / RCP→CP when the target diameter isn't 75
//    (Stuart 2026-07-08). The glb still lights the return-position copies; only the ITEM differs.
//  - a missing variant falls back to the base part (quote still works; `missing` reports the gap).

export const SIZE_STEP_TYPE = 'SIZE_SELECT';

export const SIZE_FAMILIES = {
    // SIMPLE ELEGANCE (Stuart 2026-07-22): H2-05 / H2-75 / H2-1 / H2-138 collapse into ONE flow.
    // The code grammar carries the matrix — H2-<dia><style> (longest dia token first: 138 before
    // 1) — so sizeKeys are stamped by rule (System Admin → 🧬 Size-Family Stamper), no importer
    // needed. Single projection today (4-5/8"); brackets carry no projection letter, so the PROJ
    // answer is recorded but never changes the item — add lettered options when 6" bracket codes
    // exist. Master geometry = the H2-138 assembly (the fullest — acrylic finials exist only
    // there); the render normalizes to it via masterSizeScaleOf/renderScaleOf below.
    // codeRx = the SAME grammar the 🧬 stamper applies (dia = capture 1, style = capture 2):
    // items created after a stamp run parse to a VIRTUAL sizeKey (skOf) so they can never leak
    // across diameters just because they're unstamped.
    'H2-RND': {
        label: 'Simple Elegance Round',
        baseDia: '75',
        baseProj: 'E',
        codeRx: /^H2-(138|75|05|1)([A-Z].*)$/,
        dia: {
            id: 'SIZE-DIA', title: 'Rod Diameter',
            options: [
                { optId: 'SIZE-DIA-05', value: '05', label: '1/2" Round Rod', scale: 0.667, inches: 0.5 },
                { optId: 'SIZE-DIA-75', value: '75', label: '3/4" Round Rod', scale: 1, inches: 0.75 },
                { optId: 'SIZE-DIA-1', value: '1', label: '1" Round Rod', scale: 1.333, inches: 1 },
                { optId: 'SIZE-DIA-138', value: '138', label: '1-3/8" Round Rod', scale: 1.833, inches: 1.375 },
            ],
        },
        proj: {
            id: 'SIZE-PROJ', title: 'Bracket Projection',
            // Projections are DIAMETER-DEPENDENT in this collection (Stuart 2026-07-23): the small
            // rods (1/2·3/4·1") come in 3-5/8" and 4-5/8"; the 1-3/8" rod comes in 4-5/8" and 6".
            // `dias` lists where an option is offered — omitted = offered at every diameter.
            options: [
                { optId: 'SIZE-PROJ-S', value: 'S', label: '3-5/8" Projection', dias: ['05', '75', '1'] },
                { optId: 'SIZE-PROJ-E', value: 'E', label: '4-5/8" Projection' },
                { optId: 'SIZE-PROJ-6', value: '6', label: '6" Projection', dias: ['138'] },
            ],
        },
        // Returns need the deeper projections (matches H1): offered at E and 6, never at S.
        // (returnsAllowedFor treats a missing key as "allowed", the spec sheet's returnsHere
        // gate treats it as "never" — always list explicitly.)
        returnsMinProj: ['E', '6'],
    },
    'H1-RND': {
        label: 'Fabricut H1 Round',
        baseDia: '75',
        baseProj: 'E',
        dia: {
            id: 'SIZE-DIA', title: 'Rod Diameter',
            options: [
                { optId: 'SIZE-DIA-75', value: '75', label: '3/4" Round Rod', scale: 1, inches: 0.75 },
                { optId: 'SIZE-DIA-1', value: '1', label: '1" Round Rod', scale: 1.25, inches: 1 },
                { optId: 'SIZE-DIA-138', value: '138', label: '1-3/8" Round Rod', scale: 1.5, inches: 1.375 },
            ],
        },
        proj: {
            id: 'SIZE-PROJ', title: 'Bracket Projection',
            options: [
                { optId: 'SIZE-PROJ-S', value: 'S', label: '3-5/8" Projection' },
                { optId: 'SIZE-PROJ-E', value: 'E', label: '4-5/8" Projection' },
                { optId: 'SIZE-PROJ-6', value: '6', label: '6" Projection' },
            ],
        },
        // Fabricut's french/miter returns are built at the 4-5/8" standard (6" available); there is
        // no 3-5/8" return — the 3.625 flow never offered them.
        returnsMinProj: ['E', '6'],
    },
};

// Item code, PENDING-aware (same convention as the stamper + speciesVariantOf): a legacyErpId of
// 'PENDING' means "no ERP code yet" — fall to itemId.
const codeOf = (p) => String((p?.legacyErpId && p.legacyErpId !== 'PENDING' ? p.legacyErpId : p?.itemId) || '').trim().toUpperCase();

// VIRTUAL sizeKey (Stuart 2026-07-23, the H2-138AFBF leak): an item created AFTER the last 🧬
// stamp run carries no sizeKey, and a key-less part reads as "not family" → partAllowedAtSize
// always allows it → a 138-only acrylic finial listed (and left selected/rendered) at ½". For
// families whose grammar is BY RULE (codeRx — the exact rx the stamper applies), derive the key
// from the code itself, so unstamped family items behave as if stamped: dia-gated, indexed,
// size-swapped. Finish variants ('/' in the code) NEVER get keys, mirroring the stamper's skip.
// A stamped key always wins (skOf tries it first), so stamped items keep identical behavior.
const virtualSkOf = (p) => {
    const code = codeOf(p);
    if (!code || code.includes('/')) return null;
    for (const famKey of Object.keys(SIZE_FAMILIES)) {
        const rx = SIZE_FAMILIES[famKey].codeRx;
        if (!rx) continue;
        const m = code.match(rx);
        if (m) return { family: famKey, dia: m[1], style: m[2], projLetter: '' };
    }
    return null;
};
const skOf = (p) => p?.manufacturingSpecs?.customData?.sizeKey || virtualSkOf(p);

// First size family found among the given parts (array). Used by the generator to decide whether a
// flow gets the SIZE steps at all.
export function sizeFamilyOfParts(parts) {
    for (const p of parts || []) {
        const sk = skOf(p);
        if (sk && SIZE_FAMILIES[sk.family]) return sk.family;
    }
    return null;
}

// The two flow steps, with FIXED ids (SIZE-DIA / SIZE-PROJ) so selections and saved quotes survive
// regenerates. styleOptions carry partName for generic renderers (labels), no partId (not a part).
export function buildSizeSteps(familyKey) {
    const fam = SIZE_FAMILIES[familyKey];
    if (!fam) return [];
    const mk = (axisKey, axis) => ({
        id: axis.id, title: axis.title, type: SIZE_STEP_TYPE, stepRole: 'SIZE',
        sizeAxis: axisKey, sizeFamily: familyKey,
        styleOptions: axis.options.map(o => ({ optId: o.optId, partName: o.label, sizeValue: o.value, sizeScale: o.scale, ...(o.dias ? { dias: o.dias } : {}) })),
    });
    return [mk('DIA', fam.dia), mk('PROJ', fam.proj)];
}

// Whether a PROJECTION option is offered at the selected diameter. Options carry `dias` (baked
// into regenerated flows by buildSizeSteps); flows generated BEFORE the constraint existed lack
// it, so fall back to the registry by optId — no regenerate required for the gate to hold.
export function projAllowedAtDia(familyKey, opt, diaValue) {
    if (!opt || !diaValue) return true;
    let dias = opt.dias;
    if (!dias) {
        const fam = SIZE_FAMILIES[familyKey];
        const reg = fam?.proj?.options?.find(o => o.optId === (opt.optId || opt));
        dias = reg?.dias;
    }
    return !dias || dias.includes(diaValue);
}

// Read the flow's size selections out of a CPQ config map (dynamicConfigParams / cart config).
// Returns null when the flow has no SIZE steps; otherwise { family, dia, proj, scale, diaInches,
// isBase } with unanswered axes defaulting to the family base (= the geometry the flow was built on).
export function sizeSelectionsOf(flow, config) {
    const steps = (flow?.steps || []).filter(s => s?.type === SIZE_STEP_TYPE);
    if (!steps.length) return null;
    const familyKey = steps[0].sizeFamily || 'H1-RND';
    const fam = SIZE_FAMILIES[familyKey];
    if (!fam) return null;
    const pick = (axis, axisDef, dflt) => {
        const st = steps.find(s => s.sizeAxis === axis);
        const sel = st ? (config || {})[st.id] : null;
        const opt = sel ? axisDef.options.find(o => o.optId === sel) : null;
        return opt || axisDef.options.find(o => o.value === dflt) || axisDef.options[0];
    };
    const d = pick('DIA', fam.dia, fam.baseDia);
    let p = pick('PROJ', fam.proj, fam.baseProj);
    // A stale selection can point at a projection the chosen diameter doesn't offer (dia changed
    // after proj was picked) — heal to the first projection valid at this diameter so pricing,
    // push, and size-swaps never resolve through an impossible dia×proj cell.
    if (p.dias && !p.dias.includes(d.value)) {
        p = fam.proj.options.find(o => (!o.dias || o.dias.includes(d.value)) && o.value === fam.baseProj)
            || fam.proj.options.find(o => !o.dias || o.dias.includes(d.value)) || p;
    }
    return {
        family: familyKey, dia: d.value, proj: p.value,
        scale: d.scale || 1, diaInches: d.inches,
        isBase: d.value === fam.baseDia && p.value === fam.baseProj,
    };
}

// Whether french/miter return options are offered under the current size selections. True when the
// flow has no size matrix (non-matrix flows keep today's behavior).
export function returnsAllowedFor(sel) {
    if (!sel) return true;
    const fam = SIZE_FAMILIES[sel.family];
    if (!fam || !fam.returnsMinProj) return true;
    return fam.returnsMinProj.includes(sel.proj);
}

// An option banned when returns aren't available: modeled returns (endTreatment) and the built-in
// OPT-BEND / OPT-MITER fee options. INSIDE_MOUNT and finials are always allowed.
export function isReturnOption(o) {
    const t = String(o?.endTreatment || '').toUpperCase();
    if (t === 'FRENCH_RETURN' || t === 'MITER_RETURN') return true;
    return /^OPT-(BEND|MITER)/i.test(String(o?.optId || ''));
}

// Library lookup index: sizeKey → base part. Variants (codes with '/') never carry sizeKey, but the
// guard keeps a stray stamp from shadowing the base.
export function buildSizeIndex(parts) {
    const idx = new Map();
    (parts || []).forEach(p => {
        const sk = skOf(p);
        if (!sk || !sk.family) return;
        const code = String(p.legacyErpId || p.itemId || '');
        if (code.includes('/')) return;
        const key = `${sk.family}|${sk.dia}|${sk.style}|${sk.projLetter || ''}`;
        if (!idx.has(key)) idx.set(key, p);
    });
    return idx;
}

// Resolve one part to the selected size. Non-family parts (no sizeKey) pass through untouched.
export function sizeVariantOf(part, sel, sizeIndex) {
    const sk = skOf(part);
    if (!part || !sel || !sk || sk.family !== sel.family) return { part, swapped: false };
    const targetDia = sel.dia || sk.dia;
    // projection only applies to styles that come in projections; doubles keep their dual spread
    const targetProj = !sk.projLetter ? '' : sk.projLetter === 'D' ? 'D' : (sel.proj || sk.projLetter);
    let targetStyle = sk.style;
    if (targetDia !== '75' && /^R[BC]P-/.test(targetStyle)) targetStyle = targetStyle.slice(1); // RBP→BP, RCP→CP
    if (targetDia === sk.dia && targetProj === (sk.projLetter || '') && targetStyle === sk.style) return { part, swapped: false };
    const hit = sizeIndex.get(`${sel.family}|${targetDia}|${targetStyle}|${targetProj}`);
    if (!hit || hit === part) return { part, swapped: false, missing: `${sel.family} ${targetDia} ${targetStyle}${targetProj ? '-' + targetProj : ''}` };
    return { part: hit, swapped: true };
}

// FINISH-DRIVEN SPECIES (Stuart 2026-07-09): to Fabricut a wood/acrylic item is ONE product at ONE
// price (H1-138WBF), but the physical BOM item is per-species (H1-138WBF-O oak / -W walnut). The
// selected FINISH decides which one is consumed: a finish carrying `bomSuffix` (e.g. "-O", set in
// tab 4.5's Master Finish editor) resolves the base code to `${base}${bomSuffix}`; stem-different
// items (wood pole H1-138WR → H1-138WHTOAK / H1-138WLNUT) resolve through the base part's
// customData.speciesMap = { "-O": "H1-138WHTOAK", "-W": "H1-138WLNUT" }. Runs BETWEEN the size swap
// and the /P //EPn finish-variant swap; identity when the finish has no bomSuffix.
export function speciesVariantOf(part, finishObj, findByCode) {
    let sfx = String(finishObj?.bomSuffix || '').trim().toUpperCase();
    // Tolerant spellings (Stuart tags finishes "OAK" / "WALNUT" in 4.5): normalize to the dash
    // suffix the item codes actually carry (-O oak / -W walnut); any other value gains the dash.
    if (sfx === 'OAK' || sfx === 'O' || sfx === '-O') sfx = '-O';
    else if (sfx === 'WALNUT' || sfx === 'WAL' || sfx === 'W' || sfx === '-W') sfx = '-W';
    else if (sfx && !sfx.startsWith('-')) sfx = `-${sfx}`;
    if (!part || !sfx || typeof findByCode !== 'function') return part;
    const baseCode = String((part.legacyErpId && part.legacyErpId !== 'PENDING' ? part.legacyErpId : part.itemId) || '').trim().toUpperCase();
    if (!baseCode || baseCode.includes('/')) return part;
    const mapped = part.manufacturingSpecs?.customData?.speciesMap?.[sfx];
    const hit = (mapped && findByCode(String(mapped).trim().toUpperCase())) || findByCode(`${baseCode}${sfx}`);
    return hit || part;
}

// DIAMETER AVAILABILITY (Stuart 2026-07-11, for the 1-3/8" wood/acrylic extras): an option whose
// part is NATIVE to a non-base diameter (sizeKey.dia ≠ the family base, e.g. H1-138WBF wood
// finials, wood/acrylic poles) is offered ONLY at that diameter — unless a size variant exists at
// the selected one. Master-native (base-dia) parts always show: a missing variant there is a data
// gap that falls back to the base item rather than hiding a real choice.
export function partAllowedAtSize(part, sel, sizeIndex) {
    const sk = skOf(part); // stamped key, else the codeRx-derived virtual key (unstamped can't leak)
    if (!part || !sel || !sk || sk.family !== sel.family) return true;
    const fam = SIZE_FAMILIES[sel.family];
    if (!fam || sk.dia === sel.dia || sk.dia === fam.baseDia) return true;
    return !sizeVariantOf(part, sel, sizeIndex).missing;
}

// ---- RENDER-SCALE NORMALIZATION (Stuart 2026-07-23, H2 render screenshots) --------------------
// sizeSelectionsOf().scale is anchored to the family baseDia (¾" = 1); the 3D canvas multiplies
// the whole model by it. That anchor is only right when the flow's MASTER GLB is base-native
// (Fabricut H1, built on ¾"). H2's combined flow generates from the 1-3/8" master, so the raw
// anchor rendered the 138-proportioned geometry unscaled at ¾" and mis-scaled at every other
// dia; the master's own selection is the one that must render at exactly 1.0 (the GLB as
// authored and validated in 1.6). appliedScale = selectedScale / masterScale.
// Master dia resolution, most to least authoritative:
//   1. the rendered assembly doc's stamped sizeKey (family must match);
//   2. that doc's code under the family codeRx, else a bare mainline code ('H2-138' has no
//      style letter, so codeRx can't see it) matched by dia token at the end, longest-first;
//   3. no assembly doc (the portal's whitelisted payload has no codes): the MODAL dia parsed
//      via codeRx from the flow's own option codes — a generated flow's options carry the
//      master assembly's pin codes;
//   4. unresolved → the family base (masterScale 1) = exactly today's behavior, so base-native
//      families are provably unchanged: H1-RND has no codeRx, every strategy falls through.
export function masterSizeScaleOf(familyKey, assemblyDoc, flow) {
    const fam = SIZE_FAMILIES[familyKey];
    if (!fam) return 1;
    const scaleOf = (dia) => { const o = fam.dia.options.find(x => x.value === dia); return (o && o.scale) || null; };
    const sk = assemblyDoc?.manufacturingSpecs?.customData?.sizeKey;
    if (sk && sk.family === familyKey) { const s = scaleOf(sk.dia); if (s) return s; }
    if (assemblyDoc && fam.codeRx) {
        const code = codeOf(assemblyDoc);
        if (code && !code.includes('/')) {
            const m = code.match(fam.codeRx);
            if (m) { const s = scaleOf(m[1]); if (s) return s; }
            const dias = fam.dia.options.map(o => o.value).sort((a, b) => b.length - a.length);
            for (const d of dias) {
                if (code.endsWith(d) && /[^A-Z0-9]/.test(code.charAt(code.length - d.length - 1) || '')) {
                    const s = scaleOf(d); if (s) return s;
                }
            }
        }
    }
    if (fam.codeRx && flow) {
        const counts = {};
        (flow.steps || []).forEach(st => {
            if (st.type === SIZE_STEP_TYPE) return;
            [...(st.styleOptions || []), ...(st.subOptions || [])].forEach(o => {
                const c = String(o.partName || o.partId || '').trim().toUpperCase();
                if (!c || c.includes('/')) return;
                const m = c.match(fam.codeRx);
                if (m) counts[m[1]] = (counts[m[1]] || 0) + 1;
            });
        });
        const top = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
        if (top) { const s = scaleOf(top); if (s) return s; }
    }
    return scaleOf(fam.baseDia) || 1;
}

// One-call render scale for the 3D canvas (CPQTab + portal Configurator): the selected dia's
// scale normalized to the master GLB's native dia. Identity (1) for non-size-matrix flows.
// assemblyDoc = the doc whose GLB is on screen (HQ); the portal passes null and resolution
// falls to the flow's own option codes.
export function renderScaleOf(flow, config, assemblyDoc) {
    const sel = sizeSelectionsOf(flow, config);
    if (!sel) return 1;
    return (sel.scale || 1) / (masterSizeScaleOf(sel.family, assemblyDoc, flow) || 1);
}

// Convenience bundle for consumers: selections + a lazy-indexed swap function. When the flow has no
// size matrix everything degrades to identity, so callers can apply it unconditionally.
export function makeSizeSwap(flow, config, parts) {
    const sel = sizeSelectionsOf(flow, config);
    let idx = null;
    const swap = (part) => {
        if (!sel || !part || !skOf(part)) return part;
        if (!idx) idx = buildSizeIndex(parts);
        return sizeVariantOf(part, sel, idx).part || part;
    };
    return { sel, swap, scale: sel?.scale || 1, returnsAllowed: returnsAllowedFor(sel) };
}
