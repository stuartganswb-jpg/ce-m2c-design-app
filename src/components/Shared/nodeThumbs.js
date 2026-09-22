// PHOTOGRAPH ONE COMPONENT OUT OF THE ASSEMBLY — WITHOUT TOUCHING THE TAGGING.
//
// Stuart 2026-09-21: "really need to try and split the nodes on 1.6, only for thumbnail purposes,
// do not split on 1.6 itself as the tagging is finally perfect and working."
//
// The kits seeded from H1-SimpleKits are holders; their COMPONENTS have no picture, because 4.5's
// render sweep photographs whatever a PIN names and the pins name the bracket, not the pieces
// inside it. 1.6's ⤢ split would fix that by writing new pins one level down — and rewriting pins
// is exactly what must not happen here.
//
// It does not have to. The renderer was never limited to whole brackets: `belongs()` tests each
// mesh's OWN name before walking up its ancestry, so handing it a child's name renders just that
// child. And the child can be found without any pin at all, because Fusion component names ARE the
// item codes — the premise the whole 1.6 Fusion import rests on. So: read the node names out of
// the GLB, match them to the component codes, render each one alone. Nothing is written to
// assembly_pins or nodeClusters, and re-running cannot drift the tagging.
//
// Pure — no three.js, no Firestore. The caller supplies the node names and does the rendering.

import { splitCode } from './partImage.js';

// Fusion component names carry versioning noise — and FBXLoader sanitizes separators, so
// "H1-75BE v3:2" can arrive as "H1-75BE_v32". Strip from the version marker to the end.
//
// ⚠ This lived in Shared/fusionImport, which imports FBXLoader, GLTFExporter and three's geometry
// utils at module load — so nothing could reuse it without dragging three.js in, and a node
// harness could not test it at all. It moved HERE, and fusionImport imports it back; there is no
// second copy to drift (the BRAND_NETSUITE_MAP lesson).
export const cleanFusionName = (s) => String(s || '')
    .replace(/[\s_]v\d+.*$/i, '')
    .replace(/:\d+$/, '')
    .replace(/\.\d{3}$/, '')
    .replace(/_+$/, '')
    .replace(/\s+/g, ' ')
    .trim();

/** The comparison key: version noise stripped, then alphanumerics only — the CPQ matcher's rule,
 *  so a raw mesh "Body1.048" and a stored "Body1048" are one and the same. */
export const nodeKey = (s) => cleanFusionName(s).toLowerCase().replace(/[^a-z0-9]/g, '');

/** A part's code without its finish: geometry does not vary by finish, so H1-2TRVBP/P is the node
 *  H1-2TRVBP. A part with no code at all returns ''. */
export const baseCodeOf = (part) => {
    const k = splitCode((part && (part.legacyErpId || part.itemId)) || '');
    return k ? k.pattern : '';
};

export const NODE_READY = 'READY';
export const NODE_NONE = 'NO_NODE';
export const NODE_AMBIGUOUS = 'AMBIGUOUS_CODE';
export const NODE_NO_CODE = 'NO_CODE';
export const NODE_HAS_PHOTO = 'HAS_PHOTO';

/** raw GLB node names → key → the raw names carrying it (a component instanced twice has two). */
export const buildNodeIndex = (nodeNames = []) => {
    const m = new Map();
    (nodeNames || []).forEach(n => {
        const k = nodeKey(n);
        if (!k) return;
        const cur = m.get(k);
        if (!cur) m.set(k, [String(n)]);
        else if (!cur.includes(String(n))) cur.push(String(n));
    });
    return m;
};

/**
 * Which parts can be photographed out of THIS model, decided before anything renders.
 *
 * @param {object[]} parts      the component records wanted (kit components without a picture)
 * @param {string[]} nodeNames  every node name in the assembly's GLB
 * @param {(part)=>boolean} hasPhoto  true when the record already holds a REAL photograph
 * @returns rows [{ part, code, node, instances, status, why }]
 *
 * Several NODES under one key is normal — the same component placed twice — so one is chosen and
 * the count reported. Several PARTS under one key is not: two different records whose codes reduce
 * to the same key (H1-2TRV-WB and H1-2TRVWB both key to h12trvwb) would each take the other's
 * picture, so both are refused.
 */
export const planNodeThumbs = ({ parts = [], nodeNames = [], hasPhoto = () => false }) => {
    const index = buildNodeIndex(nodeNames);
    const byKey = new Map();
    (parts || []).forEach(p => {
        const k = nodeKey(baseCodeOf(p));
        if (!k) return;
        byKey.set(k, [...(byKey.get(k) || []), p]);
    });
    return (parts || []).map(part => {
        const code = baseCodeOf(part);
        const row = { part, code, node: '', instances: 0 };
        if (!code) return { ...row, status: NODE_NO_CODE, why: 'the record carries no item code' };
        const k = nodeKey(code);
        if ((byKey.get(k) || []).length > 1) {
            return { ...row, status: NODE_AMBIGUOUS, why: `${(byKey.get(k) || []).map(p => p.legacyErpId || p.itemId).join(' and ')} reduce to the same node name` };
        }
        const hits = (index.get(k) || []).slice().sort();
        if (!hits.length) return { ...row, status: NODE_NONE, why: `no node named ${code} in this model` };
        if (hasPhoto(part)) return { ...row, node: hits[0], instances: hits.length, status: NODE_HAS_PHOTO, why: 'already has a real photograph — left alone' };
        return { ...row, node: hits[0], instances: hits.length, status: NODE_READY, why: '' };
    });
};

export const nodeThumbSummary = (rows = []) => (rows || []).reduce((m, r) => {
    if (r && r.status) m[r.status] = (m[r.status] || 0) + 1;
    return m;
}, {});

/** The plan in words, per assembly — every part accounted for, nothing skipped silently. */
export const nodeThumbPlanText = (rows = [], asmName = '') => {
    const ready = rows.filter(r => r.status === NODE_READY);
    const none = rows.filter(r => r.status === NODE_NONE);
    const other = rows.filter(r => r.status !== NODE_READY && r.status !== NODE_NONE);
    return [
        asmName ? `${asmName}:` : '',
        ready.length
            ? `  ${ready.length} component(s) will be photographed:\n${ready.map(r => `    • ${r.code} → node "${r.node}"${r.instances > 1 ? ` (${r.instances} placements, one is enough)` : ''}`).join('\n')}`
            : '  nothing to photograph here',
        none.length ? `  ${none.length} not in this model: ${none.map(r => r.code).join(', ')}` : '',
        other.length ? `  ${other.length} skipped:\n${other.map(r => `    • ${r.code} — ${r.why}`).join('\n')}` : '',
    ].filter(Boolean).join('\n');
};
