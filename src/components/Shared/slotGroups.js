// ─────────────────────────────────────────────────────────────────────────────────────────────
// WHICH SLOT IS THIS CLUSTER FROM? (Stuart 2026-09-03, the H1-2TRV load: "on these larger
// assemblies with multiple tracks and rods it can be hard for the designer to tag them all
// correctly" — 1.5 should show the same slots 1.6 loaded, and light up everything in one.)
//
// 1.6 Build has always recorded the answer, three ways, and nobody could read it:
//   1. since 2026-09-03 the cluster carries slotId / slotLabel / slotOrder outright;
//   2. the cluster id is `CLUSTER-<slotId>-<timestamp>` (the slot id in the middle);
//   3. the first node name is the slot's prefix, `S<n><MINT>-<PRETTY-LABEL>` — and <n> IS the
//      load order (the repair path writes the older `S<n>-<NAME>` form, which reads the same).
// Confidence descends in that order. A cluster that matches none of them (made by hand in 1.5,
// an AUTO- proposal, a 2D region) lands in UNGROUPED — listed, never hidden, never guessed
// into a slot. Pure: no React, no Firestore; node-tested in scripts/slotGroups.test.mjs.
// ─────────────────────────────────────────────────────────────────────────────────────────────

const U = (v) => String(v == null ? '' : v).trim().toUpperCase();

/** `CLUSTER-<slotId>-<ts>` → slotId, or null. A hand-made `CLUSTER-<ts>` (no middle segment) and
 *  a 2D region `CLUSTER-<ts>-<i>` (a small index, not a millisecond timestamp) never match — the
 *  tail alone decides; a mutation test showed an extra all-digits guard was unreachable. */
export function slotIdFromClusterId(id) {
    const m = String(id || '').match(/^CLUSTER-(.+)-(\d{10,})$/);
    return m ? m[1] : null;
}

/** `S<n><MINT>-<PRETTY>` or `S<n>-<NAME>` → { order, label }, or null. */
export function parsePrefix(nodeName) {
    const m = String(nodeName || '').match(/^S(\d+)(?:[A-Z0-9]{5})?-([A-Z0-9-]+)$/);
    if (!m) return null;
    return { order: Number(m[1]), label: m[2] };
}

/**
 * ONE cluster's slot identity — the same words on every screen (Stuart 2026-09-03: "i need to
 * see the slot id's on this screen and then enter those same slot ids on 1.5 and see them glow").
 * @returns {{order:(number|null), slotId:string, label:string, source:'stamp'|'id'|'prefix'|'none'}}
 *          `slotId` is the 1.6 slot id when known (short_rod, slot_1786739405484…), else the S<n>
 *          prefix itself, else '' — it is the string a person types into the other screen's filter.
 */
export function slotIdentityOf(cl) {
    const pfx = parsePrefix(cl && cl.nodes && cl.nodes[0]);
    if (cl && cl.slotOrder != null && Number.isFinite(Number(cl.slotOrder))) {
        return { order: Number(cl.slotOrder), slotId: String(cl.slotId || ''), label: cl.slotLabel || cl.name || '', source: 'stamp' };
    }
    const sid = slotIdFromClusterId(cl && cl.id);
    if (sid) return { order: pfx ? pfx.order : null, slotId: sid, label: (cl && cl.name) || (pfx && pfx.label) || '', source: 'id' };
    if (pfx) return { order: pfx.order, slotId: String(cl.nodes[0]), label: (cl && cl.name) || pfx.label, source: 'prefix' };
    return { order: null, slotId: '', label: (cl && cl.name) || '', source: 'none' };
}

/** `#3 · short_rod` — the chip text both screens print; '' when nothing is known. */
export function slotChipText(cl) {
    const t = slotIdentityOf(cl);
    if (t.source === 'none') return '';
    return `${t.order != null ? `#${t.order}` : '#?'}${t.slotId ? ` · ${t.slotId}` : ''}`;
}

/**
 * Group an assembly's nodeClusters by the 1.6 slot each was loaded from.
 * @returns {Array<{key, order:(number|null), label, source:'stamp'|'id'|'prefix'|'ungrouped', clusters:Array}>}
 *          sorted by load order (unknown order last, then by label); UNGROUPED always last.
 */
export function slotGroupsOf(clusters = []) {
    const groups = new Map();
    const put = (key, seed, cl) => {
        const g = groups.get(key) || { key, ...seed, clusters: [] };
        // A later, more confident read of the same slot upgrades what an earlier one left blank.
        if (g.order == null && seed.order != null) g.order = seed.order;
        if (!g.label && seed.label) g.label = seed.label;
        if (!g.slotId && seed.slotId) g.slotId = seed.slotId;
        g.clusters.push(cl);
        groups.set(key, g);
    };
    for (const cl of clusters || []) {
        if (!cl) continue;
        const pfx = parsePrefix(cl.nodes && cl.nodes[0]);
        if (cl.slotOrder != null && Number.isFinite(Number(cl.slotOrder))) {
            put(`slot:${U(cl.slotId) || Number(cl.slotOrder)}`, { order: Number(cl.slotOrder), slotId: String(cl.slotId || ''), label: cl.slotLabel || cl.name || '', source: 'stamp' }, cl);
            continue;
        }
        const sid = slotIdFromClusterId(cl.id);
        if (sid) {
            put(`slot:${U(sid)}`, { order: pfx ? pfx.order : null, slotId: sid, label: cl.name || (pfx && pfx.label) || '', source: 'id' }, cl);
            continue;
        }
        if (pfx) {
            put(`pfx:${pfx.order}:${pfx.label}`, { order: pfx.order, slotId: String(cl.nodes[0]), label: cl.name || pfx.label, source: 'prefix' }, cl);
            continue;
        }
        put('ungrouped', { order: null, slotId: '', label: 'Ungrouped', source: 'ungrouped' }, cl);
    }
    const out = [...groups.values()];
    out.sort((a, b) => {
        if (a.source === 'ungrouped') return 1;
        if (b.source === 'ungrouped') return -1;
        if (a.order != null && b.order != null && a.order !== b.order) return a.order - b.order;
        if (a.order != null && b.order == null) return -1;
        if (a.order == null && b.order != null) return 1;
        return U(a.label).localeCompare(U(b.label));
    });
    return out;
}

/** Every node name in a group — what the 3D isolate takes. */
export function nodesOfGroup(group) {
    return (group?.clusters || []).flatMap(c => c.nodes || []);
}

/** What is still missing on a slot, as short words; empty = complete at the cluster level. */
export function slotGaps(group) {
    const gaps = [];
    const noCat = (group?.clusters || []).filter(c => !U(c.category) || U(c.category) === 'OTHER').length;
    const noPos = (group?.clusters || []).filter(c => !U(c.position)).length;
    if (noCat) gaps.push(`${noCat} without a category`);
    if (noPos) gaps.push(`${noPos} without a position`);
    return gaps;
}
