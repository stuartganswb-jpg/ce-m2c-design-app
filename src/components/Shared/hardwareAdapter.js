// ─────────────────────────────────────────────────────────────────────────────────────────────
// THE ADAPTER — what 1.6 already stores, read as the hardware model (Stuart 2026-08-17)
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// "the .fbx files are built correctly … the tags on 1.6 should be set."
//
// He is right, and this file is the proof obligation. The new engine does not need a new tagging
// pass: every fact it wants is already stored on the pins and the clusters, under older names that
// grew one collection at a time. This translates them ONCE, in one place, so the engine downstream
// never has to know that `traverseRole: TRV_BRACKET` and `fits: [TRAVERSE]` are the same thought.
//
// It reads PINS DIRECTLY (Stuart's call, 2026-08-17). The generated flow doc is no longer the
// source of which options exist or what renders — it carries only ordering, labels and prices. That
// is the whole point: a stale Regenerate can no longer hide a corrected tag, because there is
// nothing baked left to go stale.
//
// WHERE EACH FACT COMES FROM
//   role         cluster.category + pin.catOverride + pin.endTreatment + pin.traverseRole
//   rodKind      a pole with a fascia/track role is TRAVERSE; any other pole is SOLID
//   fits         trv:* roles mean traverse-only; STD_ONLY means solid-only; silence means the
//                role's default (finials and inside mounts shared, brackets/rings solid)
//   setup        pin.trvSetup       (BOTH → blank, which already means "suits both")
//   drive        pin.driveType
//   proj         pin.projInches
//   mount        pin.mountType, else cluster.location
//   position     cluster.position
//   always       pin.alwaysShown, or the role is a rider
//   nodes        pin.targetNode (the canonical delimiter-aware split)

import { splitNodes } from './nodeList.js';
import { normalizeCategory, normalizePosition, normalizeLocation } from './assemblyTags.js';
import { SOLID, TRAVERSE, RIDER_ROLES } from './hardwareModel.js';

const U = (v) => String(v == null ? '' : v).trim().toUpperCase();

// The traverse vocabulary as it is stored today → what it MEANS in the model. Two separate facts
// were historically carried in one field: what a part IS, and which rod world it belongs to.
const TRV_ROLE_MAP = {
    FASCIA: { role: 'FASCIA' },
    TRACK: { role: 'TRACK' },
    TRV_END: { role: 'TRV_END' },
    CARRIER: { role: 'CARRIER' },
    FCLIP: { role: 'FCLIP' },
    // These never said what the part IS — only that it is traverse-only. The category still
    // supplies the role; this supplies the world.
    TRV_BRACKET: { role: 'BRACKET', fits: [TRAVERSE] },
    TRV_BACKPLATE: { role: 'BACKPLATE', fits: [TRAVERSE] },
    TRV_PART: { fits: [TRAVERSE] },
    STD_ONLY: { fits: [SOLID] },
};

// An end pin's endTreatment says which KIND of end it is. These are alternatives for one place, so
// they become distinct roles that the engine pools back into a single decision per end.
const END_ROLE = {
    FINIAL: 'FINIAL',
    FRENCH_RETURN: 'RETURN',
    MITER_RETURN: 'RETURN',
    INSIDE_MOUNT: 'INSIDE_MOUNT',
};

const CATEGORY_ROLE = {
    POLE: 'ROD',
    BRACKET: 'BRACKET',
    BACKPLATE: 'BACKPLATE',
    FINIAL: 'FINIAL',
    RING: 'RING',
    OTHER: 'ACCESSORY',
};

/**
 * One pin + its cluster → one tagged choice.
 *
 * Returns null for anything that is not a choice at all, so callers never have to filter twice.
 */
export function choiceFromPin(pin, cluster, { classifyCat } = {}) {
    if (!pin) return null;
    const trv = TRV_ROLE_MAP[U(pin.traverseRole)] || {};
    const et = U(pin.endTreatment);
    const catRaw = U(pin.catOverride) || normalizeCategory(cluster?.category) || (classifyCat ? classifyCat(pin) : '');
    const cat = normalizeCategory(catRaw) || catRaw;

    // Role, most specific source first: an explicit traverse role, then the end treatment (which
    // distinguishes a finial from a return in the same cluster), then the cluster's category.
    let role = trv.role || '';
    if (!role && et && END_ROLE[et]) role = END_ROLE[et];
    if (!role) role = CATEGORY_ROLE[cat] || '';
    if (!role) return null;

    // A HIDDEN PIN BILLS BUT NEVER RENDERS — and under default-hidden geometry that needs no
    // special case at all: give it no nodes. (The old model had to force-hide it, which is how a
    // hidden part could still fight a visible one for the same mesh.) A parked pin has no item yet,
    // so it is neither billed nor rendered.
    // ⚠ A HIDDEN PIN IS NEVER A QUESTION (Stuart 2026-08-17: "it is still displaying items tagged
    // as hidden"). Giving it no nodes stopped it RENDERING, but it still had a role and a position,
    // so it still appeared in its slot as something to pick — a choice that bills and shows nothing.
    // Hidden means BOM-only: built, billed, never offered, never drawn. That is exactly what a
    // rider is, so it becomes one.
    const hidden = !!pin.isHiddenPart;
    const parked = !!pin.parked;
    const isRider = RIDER_ROLES.includes(role) || pin.alwaysShown === true || (hidden && !parked);

    const fits = trv.fits || null;
    const rodKindTag = (role === 'FASCIA' || role === 'TRACK') ? TRAVERSE
        : (role === 'ROD' ? (U(pin.traverseRole) ? TRAVERSE : SOLID) : '');

    return {
        id: String(pin.id || pin.choiceNode || pin.partId || ''),
        partId: String(pin.partId || ''),
        name: String(pin.partName || pin.partId || cluster?.name || ''),
        role,
        rodKind: rodKindTag,
        ...(fits ? { fits } : {}),
        nodes: (hidden || parked) ? [] : splitNodes(pin.targetNode || pin.choiceNode || ''),
        setup: U(pin.trvSetup) === 'BOTH' ? '' : U(pin.trvSetup),
        drive: U(pin.driveType),
        proj: pin.projInches || '',
        mount: U(pin.mountType) || normalizeLocation(cluster?.location) || '',
        position: normalizePosition(cluster?.position) || U(cluster?.position) || '',
        // Which rod of a double. Read from the pin first, then the cluster — a whole cluster is
        // usually the back rod's parts, but a single pin can be moved without re-grouping.
        tier: U(pin.tier) || U(cluster?.tier) || '',
        always: isRider && !parked,
        // BOM-ONLY: real, picked and billed, but never drawn and never on a customer document.
        hidden,
        // Tri-state override for the ring rule: tagged true or false wins over what the rod's role
        // and position imply, so an exception to "what a ring rides on" is a tag, not a release.
        ...(pin.carriesRings === true || pin.carriesRings === false ? { carriesRings: pin.carriesRings } : {}),
        // The pairing + companion tags, straight through: a collar comes with the finial that
        // requires it; a basic bracket takes no plate; an in-line bracket takes in-line plates.
        isCollar: !!pin.isCollar,
        requiresCollar: U(pin.requiresCollar),
        // ⚠ THESE FLAGS LIVE ON THE PIN *OR* THE CLUSTER (Stuart 2026-08-17: "the wood brackets are
        // tagged as basic but it is asking for a backplate selection"). 1.6 writes them either way
        // — the assign tool reads `pin?.usesReturnPlates || cl.usesReturnPlates` for exactly this
        // reason — so a flag set on the section rather than the choice was invisible here and the
        // basic wood arms kept asking for a plate they do not take.
        // 🧊 TAKES NO FINISH — the tag that replaces the renderer's hardcoded acrylic item-code
        // list. Read from the pin or the cluster, like every other flag here.
        // 🧪 MATERIALS — everything the part is made in. Blank reads as METAL. The no-finish flag
        // survives as the shorthand it always was: a part made ONLY in a clear material.
        materials: String(pin.materials || cluster?.materials || '').toUpperCase(),
        noFinish: !!(pin.noFinish || cluster?.noFinish),
        isBasic: !!(pin.isBasic || cluster?.isBasic),
        usesReturnPlates: !!(pin.usesReturnPlates || cluster?.usesReturnPlates),
        inlineOnly: !!(pin.inlineOnly || cluster?.inlineOnly),
        returnOnly: !!(pin.returnOnly || cluster?.returnOnly),
        qty: Number(pin.defaultQty) > 0 ? Number(pin.defaultQty) : 1,
        price: Number(pin.price) || 0,
        sort: Number(pin.choiceSort) || 0,
        raw: pin,
    };
}

/**
 * A whole assembly → the choice list the engine resolves.
 *
 * `assembly.nodeClusters` supplies position/location/category; `pins` supply the parts and their
 * per-choice tags. Clusters flagged hidden contribute BOM-only parts, exactly as before.
 */
export function choicesFromAssembly(assembly, pins = [], opts = {}) {
    const byId = new Map();
    (assembly?.nodeClusters || []).forEach(c => byId.set(c.id, c));
    return (pins || [])
        .filter(p => p && (p.assemblyId ? p.assemblyId === assembly?.id : true))
        .map(p => {
            const cluster = byId.get(p.clusterId);
            const c = choiceFromPin(p, cluster, opts);
            if (!c) return null;
            // A hidden CLUSTER is BOM-only for its whole contents — same semantics as a hidden pin.
            // HIDDEN = BUILT, BILLED, NEVER SHOWN TO THE CUSTOMER (Stuart 2026-08-17: "the hidden,
            // if they are actually hidden items, can be hidden from these pages as well, only
            // included in the shop floor bom"). A standoff or an internal sleeve is real — the shop
            // picks it and it must ride the work order — but it has no geometry the customer sees
            // and no place on a quote. The flag rides the choice so every consumer can decide for
            // itself: the pricing panel and the rail drop it, the BOM keeps it.
            if (cluster?.hidden) return { ...c, nodes: [], always: !!c.partId, hidden: true };
            return c;
        })
        .filter(Boolean)
        .sort((a, b) => a.sort - b.sort);
}

/** Every node name the model actually contains, for the ownership report. */
export function modelNodesOf(assembly) {
    const out = [];
    (assembly?.nodeClusters || []).forEach(c => (c.nodes || c.meshes || []).forEach(n => { if (n) out.push(n); }));
    return out;
}
