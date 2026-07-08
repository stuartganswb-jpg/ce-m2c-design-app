// ============================================================================
// CANONICAL ASSEMBLY TAG SPEC — the single vocabulary for clusters, pins,
// parts, and CPQ steps. Tabs 1.5 (Node Grouping), 1.6 (Assembly Builder),
// 2 (Visual Assembly), 3 (BOM Engine), the CPQ generator (System Admin →
// Generate), the CPQ runtime (tab 8), and Client Vision (VisionHardware) must
// all read/write THESE values. Name/title regexes are allowed only as
// IMPORT-TIME SUGGESTIONS (suggestTagsFromName) — never as runtime truth.
//
// Axes:
//   LOCATION  (mount surface, placement-level) : WALL | CEILING | END
//       END = mounts on/at the rod end (inside-mount). Legacy dialects
//       normalize in: INSIDE→END, IM→END, OPEN→WALL, CEIL→CEILING.
//   POSITION  (placement-level)                : LEFT | CENTER | RIGHT | FRONT | BACK | SHARED
//       FRONT/BACK = the two pole rows of a DOUBLE bracket flow.
//   CATEGORY  (what the cluster holds)         : POLE | BRACKET | BACKPLATE | FINIAL | RING | OTHER
//       (finial slots hold ALL end-treatment choices; legacy 'END'→FINIAL.)
//   END TREATMENT (per CHOICE, pin/option-level):
//       FINIAL         — decorative end; allowed only when no return chosen.
//       FRENCH_RETURN  — FEE choice; replaces that side's bracket, keeps the
//                        backplate pairing, hides that side's long rod half.
//       MITER_RETURN   — FEE choice; same gating as FRENCH_RETURN.
//       INSIDE_MOUNT   — REAL PART (special rod-end bracket); same gating
//                        (replaces the side's bracket, no finial with it).
//   Choice flags (pin/option-level booleans): isFee, isHiddenPart (BOM-only /
//       never rendered), isBasic (bracket takes NO backplate),
//       usesReturnPlates (bracket pairs with the RETURN backplates).
//   Part-level (manufacturingSpecs.customData): bracketType (mount capability,
//       normalized by bracketMountsOf), isReturnBracket, projection, feeType
//       (BENT_RETURN|MITER_RETURN — legacy endTreatment source), bpOrientation.
// ============================================================================

export const TAG_LOCATIONS = ['WALL', 'CEILING', 'END'];
export const TAG_POSITIONS = ['LEFT', 'CENTER', 'RIGHT', 'FRONT', 'BACK', 'SHARED'];
export const TAG_CATEGORIES = ['POLE', 'BRACKET', 'BACKPLATE', 'FINIAL', 'RING', 'OTHER'];
export const END_TREATMENTS = ['FINIAL', 'FRENCH_RETURN', 'MITER_RETURN', 'INSIDE_MOUNT'];

const U = (s) => String(s == null ? '' : s).toUpperCase().trim();

// --- Normalizers: accept every legacy dialect, emit only canonical values. ---
export const normalizeLocation = (v) => {
    const t = U(v);
    if (!t) return '';
    if (t === 'WALL' || t === 'OPEN' || /\bWALL\b/.test(t)) return 'WALL';
    if (t.includes('CEIL')) return 'CEILING';
    if (t === 'END' || t.includes('INSIDE') || t === 'IM' || /\bEND\b/.test(t)) return 'END';
    return TAG_LOCATIONS.includes(t) ? t : '';
};

export const normalizePosition = (v) => {
    const t = U(v);
    if (!t) return '';
    if (TAG_POSITIONS.includes(t)) return t;
    if (t.startsWith('L')) return 'LEFT';
    if (t.startsWith('R') && !t.startsWith('RI')) return 'RIGHT';
    if (t.includes('RIGHT')) return 'RIGHT';
    if (t.includes('LEFT')) return 'LEFT';
    if (t.includes('CENT') || t.includes('MID')) return 'CENTER';
    if (t.includes('FRONT')) return 'FRONT';
    if (t.includes('BACK') && !t.includes('BACKPLATE')) return 'BACK';
    return '';
};

export const normalizeCategory = (v) => {
    const t = U(v);
    if (!t) return '';
    if (TAG_CATEGORIES.includes(t)) return t;
    if (t === 'END') return 'FINIAL'; // 1.6's legacy END slot category = the end-treatment (finial) cluster
    if (t.includes('BACKPLATE') || t.includes('BACK PLATE') || t.includes('BACK-PLATE')) return 'BACKPLATE';
    if (t.includes('BRACKET')) return 'BRACKET';
    if (t.includes('FINIAL')) return 'FINIAL';
    if (t.includes('RING')) return 'RING';
    if (t.includes('POLE') || t.includes('ROD') || t.includes('TUBE')) return 'POLE';
    return 'OTHER';
};

export const normalizeEndTreatment = (v) => {
    const t = U(v).replace(/[\s-]+/g, '_');
    if (!t) return '';
    if (END_TREATMENTS.includes(t)) return t;
    if (t === 'BENT_RETURN' || t.includes('FRENCH') || t.includes('BEND')) return 'FRENCH_RETURN';
    if (t.includes('MITER') || t.includes('MITRE') || t === 'MTR') return 'MITER_RETURN';
    if (t.includes('INSIDE') || t === 'IM') return 'INSIDE_MOUNT';
    if (t.includes('FINIAL')) return 'FINIAL';
    return '';
};

// --- Import-time suggester: best-effort tags from a CAD node / choice / file name.
// NEVER call at runtime for behavior — persist the result and let a human confirm.
export const suggestTagsFromName = (name) => {
    const t = U(name);
    const out = { location: '', position: '', category: '', endTreatment: '' };
    if (!t) return out;
    if (/\bFIW\b|\bWALL\b/.test(t)) out.location = 'WALL';
    else if (/\bFIC\b|CEIL/.test(t)) out.location = 'CEILING';
    else if (/\bFIIM\b|\bIM\b|INSIDE\s*MOUNT|\bEND\b/.test(t)) out.location = 'END';

    if (/\bLEFT\b|\bLH\b|\bL\b$/.test(t)) out.position = 'LEFT';
    else if (/\bRIGHT\b|\bRH\b|\bR\b$/.test(t)) out.position = 'RIGHT';
    else if (/\bCENTER\b|\bCENTRE\b|\bMID/.test(t)) out.position = 'CENTER';
    else if (/\bFRONT\b/.test(t)) out.position = 'FRONT';
    else if (/\bBACK\b/.test(t) && !/BACKPLATE|BACK PLATE/.test(t)) out.position = 'BACK';

    if (/BACKPLATE|BACK PLATE|BACK-PLATE|MOUNTING BASE/.test(t)) out.category = 'BACKPLATE';
    else if (/BRACKET/.test(t)) out.category = 'BRACKET';
    else if (/FINIAL/.test(t)) out.category = 'FINIAL';
    else if (/\bRING/.test(t)) out.category = 'RING';
    else if (/POLE|\bROD\b|TUBE/.test(t)) out.category = 'POLE';

    // MTR/IM/EC/CC also as embedded code suffixes ("H275INRODMTRLEFT", "H1-75IM", "H1-75EC") — word
    // boundaries fail inside alphanumeric codes, so these use substring/suffix forms.
    if (/MITER|MITRE|MTR/.test(t)) out.endTreatment = 'MITER_RETURN';
    else if (/FRENCH|BEND|BENT|RETURN|\bFR\b/.test(t)) out.endTreatment = 'FRENCH_RETURN';
    else if (/INSIDE\s*MOUNT|\bFIIM\b|\bIM\b|\dIM(?=$|[^A-Z0-9])|\dIM[-_ ]/.test(t)) out.endTreatment = 'INSIDE_MOUNT';
    else if (/FINIAL|END\s*CAP|ENDCAP|\bCAP\b|\dEC(?=$|[^A-Z0-9])|\dCC(?=$|[^A-Z0-9])/.test(t)) out.endTreatment = 'FINIAL';
    return out;
};

// --- Runtime resolver: a choice's end treatment. Persisted tag FIRST (pin/option
// .endTreatment), then part-level truth (feeType / productType), then — legacy
// fallback only — the name suggestion. New data should never reach the fallback.
export const endTreatmentOf = ({ pinOrOption, part } = {}) => {
    const explicit = normalizeEndTreatment(pinOrOption?.endTreatment);
    if (explicit) return explicit;
    const cd = part?.manufacturingSpecs?.customData || {};
    const fromFee = normalizeEndTreatment(cd.endTreatment || cd.feeType);
    if (fromFee) return fromFee;
    if (U(part?.manufacturingSpecs?.productType) === 'FINIAL') return 'FINIAL';
    const byName = suggestTagsFromName(pinOrOption?.partName || pinOrOption?.label || part?.itemName);
    return byName.endTreatment || '';
};

// A choice that REPLACES the side's bracket / excludes finials (returns + inside mounts).
export const isReturnTreatment = (et) => et === 'FRENCH_RETURN' || et === 'MITER_RETURN' || et === 'INSIDE_MOUNT';

// --- Part mount capability, normalized. Brackets: exactly one of WALL|CEILING|END.
// Backplates may allow several (customData.bpMounts array wins; else bracketType).
export const bracketMountsOf = (part) => {
    const cd = part?.manufacturingSpecs?.customData || {};
    if (Array.isArray(cd.bpMounts) && cd.bpMounts.length) {
        return [...new Set(cd.bpMounts.map(normalizeLocation).filter(Boolean))];
    }
    const single = normalizeLocation(cd.bracketType);
    return single ? [single] : [];
};

// ============================================================================
// ALIGNMENT VALIDATOR — encodes the cross-tab contract. Read-only; returns
// issue rows the audit UI renders (and optionally one-click-fixes).
// severity: 'ERROR' (breaks generator/Vision/CPQ), 'WARN' (works by luck —
// name-regex or fallback is carrying it), 'INFO' (nice-to-fix).
// ============================================================================
export const validateAssemblyAlignment = ({ assembly, pins = [], parts = [], flows = [] }) => {
    const issues = [];
    const push = (severity, area, text, fix = null) => issues.push({ severity, area, text, fix, assemblyId: assembly.id, assemblyName: assembly.itemName || assembly.itemId || assembly.id });
    const clusters = assembly.nodeClusters || [];
    const partIndex = {};
    parts.forEach(p => { [p.id, p.itemId, p.legacyErpId].forEach(k => { if (k) partIndex[k] = p; }); });
    const findPart = (id) => partIndex[id] || null;

    clusters.forEach(c => {
        const label = c.name || c.id;
        const cat = U(c.category), loc = U(c.location), pos = U(c.position);
        // Dialect values → normalizable ERRORs with an auto-fix payload.
        if (loc && !TAG_LOCATIONS.includes(loc)) {
            const n = normalizeLocation(loc);
            push('ERROR', 'CLUSTER', `"${label}": location "${loc}" is a legacy dialect${n ? ` → should be ${n}` : ' (unknown)'}`, n ? { type: 'cluster', clusterId: c.id, patch: { location: n } } : null);
        }
        if (pos && !TAG_POSITIONS.includes(pos)) {
            const n = normalizePosition(pos);
            push('ERROR', 'CLUSTER', `"${label}": position "${pos}" is non-canonical${n ? ` → ${n}` : ''}`, n ? { type: 'cluster', clusterId: c.id, patch: { position: n } } : null);
        }
        if (cat && !TAG_CATEGORIES.includes(cat)) {
            const n = normalizeCategory(cat);
            push('ERROR', 'CLUSTER', `"${label}": category "${cat}" is non-canonical${n ? ` → ${n}` : ''}`, n ? { type: 'cluster', clusterId: c.id, patch: { category: n } } : null);
        }
        // Missing tags the generator/Vision need.
        const sugg = suggestTagsFromName(label);
        const isHidden = !!c.hidden;
        // Hidden hardware (bushings/screws/fasteners): a HIDDEN cluster becomes includedParts on its
        // position's step — its CATEGORY is unused by the generator, so hidden clusters don't need one.
        // An UNTAGGED cluster that *looks* like hardware gets a one-click "mark HIDDEN" fix.
        const HARDWAREISH = /BUSHING|SCREW|BOLT|WASHER|FASTENER|\bNUT\b|MMC\d|HARDWARE/i;
        if (!cat && !isHidden) {
            if (HARDWAREISH.test(label)) {
                push('ERROR', 'CLUSTER', `"${label}": untagged and looks like hidden BOM hardware (bushing/screw) — Fix marks it HIDDEN (BOM-only; rides its position's step as an included part).`, { type: 'cluster', clusterId: c.id, patch: { hidden: true, ...(sugg.position ? { position: sugg.position } : {}) } });
            } else {
                push('ERROR', 'CLUSTER', `"${label}": no CATEGORY tag${sugg.category ? ` (name suggests ${sugg.category})` : ''}`, sugg.category ? { type: 'cluster', clusterId: c.id, patch: { category: sugg.category } } : null);
            }
        }
        const catN = normalizeCategory(cat);
        if (catN === 'BRACKET' && !normalizeLocation(loc)) push('ERROR', 'CLUSTER', `"${label}": BRACKET cluster has no mount LOCATION (WALL/CEILING/END)${sugg.location ? ` (name suggests ${sugg.location})` : ''}`, sugg.location ? { type: 'cluster', clusterId: c.id, patch: { location: sugg.location } } : null);
        if (!isHidden && (catN === 'BRACKET' || catN === 'BACKPLATE' || catN === 'FINIAL') && !normalizePosition(pos)) push('ERROR', 'CLUSTER', `"${label}": ${catN} cluster has no POSITION tag${sugg.position ? ` (name suggests ${sugg.position})` : ''}`, sugg.position ? { type: 'cluster', clusterId: c.id, patch: { position: sugg.position } } : null);
        // A hidden cluster's included parts attach to a POSITION's step — untagged position = they
        // can't ride the right step (LEFT bushings must follow the LEFT end).
        if (isHidden && !normalizePosition(pos) && sugg.position) push('WARN', 'CLUSTER', `"${label}": HIDDEN cluster has no POSITION — its included parts attach to a position's step (name suggests ${sugg.position})`, { type: 'cluster', clusterId: c.id, patch: { position: sugg.position } });
        // Name/tag contradiction (the "HCUNEC1 RIGHT tagged LEFT" class of bug).
        if (sugg.position && normalizePosition(pos) && sugg.position !== normalizePosition(pos)) {
            push('WARN', 'CLUSTER', `"${label}": name says ${sugg.position} but tag says ${normalizePosition(pos)} — confirm which is right`, { type: 'cluster', clusterId: c.id, patch: { position: sugg.position } });
        }
    });

    // Pins.
    const clusterIds = new Set(clusters.map(c => c.id));
    pins.forEach(pin => {
        const label = pin.partName || pin.partId || pin.id;
        if (pin.clusterId && !clusterIds.has(pin.clusterId)) {
            // Stale leftovers from an earlier build/re-group: the generator ignores them, but they STILL
            // pollute every consumer that reads pins by assemblyId — Vision's flowPins ("pinned" part
            // lists), the BOM Engine component list, and the ERP push's pin lookups. Deleting is safe:
            // the cluster they belonged to is gone.
            push('ERROR', 'PIN', `Stale pin "${label}" points at a cluster that no longer exists (${pin.clusterId}) — leftover from an earlier build; it pollutes Vision's pinned-part lists and the BOM.`, pin.id ? { type: 'deletePin', pinId: pin.id } : null);
            return; // don't double-report tag issues on a pin that should just be removed
        }
        const cl = clusters.find(c => c.id === pin.clusterId);
        const catN = normalizeCategory(cl?.category);
        const part = findPart(pin.partId) || (pin.legacyErpId ? findPart(pin.legacyErpId) : null);
        if (!part && !pin.isFee && !pin.isHiddenPart && !String(pin.partId || '').startsWith('FEE-') && !String(pin.partId || '').startsWith('HIDDEN-')) {
            push('ERROR', 'PIN', `Pin "${label}" doesn't resolve to a library part (${pin.partId}) — create/import the item (Item Starter Kit) or fix the item # in the 1.6 Assign tool.`);
        }
        // Hidden choices are never options, so they need no endTreatment. But a hidden choice with only
        // a synthetic HIDDEN-… id is GEOMETRY-ONLY — it will never reach the BOM. If it's real hardware
        // (fasteners/standoffs), it needs its item # in 1.6 so the generator can include it.
        if (pin.isHiddenPart) {
            if (/^HIDDEN-/.test(String(pin.partId || ''))) {
                push('INFO', 'PIN', `Hidden choice "${label}" carries no item # — geometry-only, it will NOT reach the BOM. If it's real hardware, add its item # in 1.6's Assign tool (keep HIDE checked) so it's included when this position is used.`);
            }
            return;
        }
        // End-treatment choices must carry the explicit tag — name-regex is what breaks flows.
        if (catN === 'FINIAL') {
            const explicit = normalizeEndTreatment(pin.endTreatment) || normalizeEndTreatment(part?.manufacturingSpecs?.customData?.endTreatment || part?.manufacturingSpecs?.customData?.feeType) || (U(part?.manufacturingSpecs?.productType) === 'FINIAL' ? 'FINIAL' : '');
            const byName = suggestTagsFromName(label).endTreatment;
            if (!explicit && byName) push('WARN', 'PIN', `End choice "${label}" has NO endTreatment tag — only its NAME (${byName}) makes it work. Tag it.`, pin.id ? { type: 'pin', pinId: pin.id, patch: { endTreatment: byName } } : null);
            if (!explicit && !byName) push('ERROR', 'PIN', `End choice "${label}" has no endTreatment tag and no name hint. ⚠ Fix tags it FINIAL — use ONLY for finials/end caps. If this is actually a return or inside mount, set it in 1.6's Assign tool instead: a return mis-tagged FINIAL keeps the long rod AND stops the bracket from greying.`, pin.id ? { type: 'pin', pinId: pin.id, patch: { endTreatment: 'FINIAL' } } : null);
        }
        if (catN === 'BRACKET' && part) {
            const mounts = bracketMountsOf(part);
            if (!mounts.length) {
                // Derivable: the cluster this bracket is pinned in carries the mount location, and the
                // name often does too ("Inside Mount Bracket…"). Offer the derived value as a fix.
                const derived = normalizeLocation(cl?.location) || suggestTagsFromName(part.itemName).location || suggestTagsFromName(label).location;
                push('ERROR', 'PART', `Bracket "${part.itemName || label}" has no customData.bracketType — Vision's mount filter can't place it (arms won't populate).${derived ? ` Fix sets ${derived} (from its cluster/name).` : ''}`, derived && part.id ? { type: 'part', partDocId: part.id, patch: { 'manufacturingSpecs.customData.bracketType': derived } } : null);
            }
            const proj = parseFloat(part.manufacturingSpecs?.customData?.projection);
            if (!proj) push('WARN', 'PART', `Bracket "${part.itemName || label}" has no customData.projection — Vision can't auto-seed fabrication math. Enter it in the Master Library (customData.projection).`);
        }
        if (catN === 'BACKPLATE' && part) {
            const par = part.manufacturingSpecs?.parametric || {};
            if (!parseFloat(par.width) && !parseFloat(par.length)) push('WARN', 'PART', `Backplate "${part.itemName || label}" has no parametric width/length — Vision O2O math falls back to defaults. Enter dims in the Master Library (parametric).`);
        }
    });

    // Linked CPQ flows.
    flows.filter(f => f.linkedAssemblyId === assembly.id || f.linkedAssemblyId === assembly.itemId).forEach(f => {
        if (!f.fabShape) push('WARN', 'FLOW', `Flow "${f.name}": no fabShape (STRAIGHT/MITERED/BOW) — Vision bay preset won't seed.`);
        if (f.fabProjection === undefined || f.fabProjection === '' || f.fabProjection === null) push('INFO', 'FLOW', `Flow "${f.name}": no fabProjection preset — Vision derives projection from the selected bracket instead.`);
        (f.steps || []).forEach(s => {
            const title = U(s.title);
            const known = /POLE|TUBE|ROD|BRACKET|FINIAL|RING|SPLICE|END TREATMENT|FINISH|COLOR|PATINA|LENGTH/.test(title) || U(s.dataSource) === 'MASTER_FINISHES';
            if (!known) push('WARN', 'FLOW', `Flow "${f.name}" step "${s.title}": Vision can't classify this step from its title — it won't map to a Fabrication Settings field.`);
            (s.styleOptions || []).forEach(o => {
                const et = normalizeEndTreatment(o.endTreatment);
                const byName = suggestTagsFromName(o.partName || o.optId).endTreatment;
                if (!et && byName && byName !== 'FINIAL') push('WARN', 'FLOW', `Flow "${f.name}" step "${s.title}" option "${o.partName}": return-ness is only name-derived (${byName}). Regenerate after tagging pins.`);
            });
        });
    });

    // Dedupe: the same part pinned at several positions (or the same message per pin) collapses into one
    // row with a count — the raw list repeated every part-level issue once per pin and drowned the signal.
    const seen = new Map();
    issues.forEach(i => {
        const k = `${i.severity}|${i.area}|${i.text}`;
        const cur = seen.get(k);
        if (cur) { cur.count = (cur.count || 1) + 1; if (!cur.fix && i.fix) cur.fix = i.fix; }
        else seen.set(k, { ...i, count: 1 });
    });
    return [...seen.values()];
};
