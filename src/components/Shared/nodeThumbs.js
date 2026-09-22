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

/**
 * THE NAME BEHIND THE SLOT PREFIX (2026-09-23). A model merged by the Assembly Builder names every
 * node `<slot>__<n>_<component>` — `S0ZG584-NEW-SLOT__9_H12TRVLA` — with the component's own name
 * reduced to letters and digits (AssemblyBuilderTab, the merge). Every reader of such a name
 * (1.6's chip label, CPQ, Admin) takes the tail the same way: after the last `__`, the ordinal and
 * its underscore dropped. So does this; a name with no prefix is its own tail.
 */
export const slotTailOf = (n) => { const seg = String(n || '').split('__').pop() || ''; return seg.replace(/^\d+_?/, ''); };

/** raw GLB node names → key → the raw names carrying it (a component instanced twice has two).
 *  A merged model's node is indexed under its slot-stripped tail as well, so `H1-2TRVLA` finds
 *  `S0ZG584-NEW-SLOT__9_H12TRVLA`; the RAW name is what is kept, because the renderer matches by it. */
export const buildNodeIndex = (nodeNames = []) => {
    const m = new Map();
    const put = (k, n) => {
        if (!k) return;
        const cur = m.get(k);
        if (!cur) m.set(k, [String(n)]);
        else if (!cur.includes(String(n))) cur.push(String(n));
    };
    (nodeNames || []).forEach(n => {
        put(nodeKey(n), n);
        const tail = slotTailOf(n);
        if (tail && tail !== String(n)) put(nodeKey(tail), n);
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

/**
 * WHAT ONE TAGGED SLOT CONTAINS — the report that matters when nothing matches.
 *
 * Stuart 2026-09-21: the kit's own picture rendered fine, so the model and the pin are good; the
 * COMPONENTS matched nothing. Whether that is because the pieces are not in there, or are in there
 * under names that are not item codes, cannot be guessed — it has to be looked at. So a slot that
 * matches nothing prints what it actually holds, and the naming answers the question on sight.
 *
 * @param kitCode   the bracket's code, for the heading
 * @param rows      planNodeThumbs's answer for this slot's components
 * @param children  [{ name, depth, isMesh, meshes }] from hardwareThumbs.sceneSubtree
 * @param limit     how many child names to print before saying "and N more"
 */
export const slotReportText = (kitCode, rows = [], children = [], limit = 14, parentFound = true) => {
    const ready = rows.filter(r => r.status === NODE_READY);
    const missed = rows.filter(r => r.status === NODE_NONE);
    // ⚠ THE PIN'S NODE WAS NOT IN THE MODEL AT ALL. Reported as "a single solid" this reads as
    // "the designer welded it", which is the opposite conclusion and would send someone off to
    // redraw parts that are sitting in the file. It means the pin and the GLB disagree — a
    // re-export renamed or removed that node — and the fix is in the tagging, not the geometry.
    if (!parentFound) {
        return `  ${kitCode} — the node this kit is pinned to is NOT in this model\n`
            + '    (the pin and the GLB disagree — nothing can be read from inside it until they match)';
    }
    const out = [`  ${kitCode} — ${children.length} node(s) inside the tagged slot`];
    if (ready.length) out.push(`    ✓ ${ready.map(r => `${r.code} → "${r.node}"`).join(', ')}`);
    if (missed.length) {
        out.push(`    ✗ no node matched: ${missed.map(r => r.code).join(', ')}`);
        // The names themselves — geometry-bearing first, since those are the candidates.
        const cands = children.filter(c => c.meshes > 0).map(c => `${'·'.repeat(Math.max(1, c.depth))} ${c.name}`);
        const shown = cands.slice(0, limit);
        if (shown.length) out.push(`    inside it: ${shown.join(' | ')}${cands.length > limit ? ` … and ${cands.length - limit} more` : ''}`);
        else out.push('    inside it: nothing with geometry — this slot really is one welded solid');
    }
    return out.join('\n');
};

/**
 * EVERY PART IN A PARTS MODEL, BY ITS OWN NAME (Stuart 2026-09-23). The designer's export spec
 * (docs/FUSION_EXPORT_FOR_PART_PICTURES.md) asks for each part as a top-level component named with
 * its item code — H1-2TRV BRACKET PARTS, H1-CUFF BRACKETS, H1-138TRV PARTS, H1-BACKPLATES are that.
 * No pin and no kit: the library is planned against the model's node names directly. A part with no
 * node in THIS model is simply not in it (not an error — every model holds a few parts); two
 * records reducing to one node name are AMBIGUOUS and refused, exactly as planNodeThumbs refuses
 * them; a part that already has a photograph is left alone.
 */
export const planModelThumbs = ({ parts = [], nodeNames = [], hasPhoto = () => false }) => {
    const index = buildNodeIndex(nodeNames);
    // key → base code → the records carrying it. A FINISH VARIANT is the same part in the same
    // geometry (H1-2TRVBA/EP1 is the node H1-2TRVBA): the BASE record is photographed and the
    // variants take its picture in the inheritance pass — they are never rivals for the node
    // (2026-09-23: 110 refusals on H1-2TRV BRACKET PARTS, every one a base against its own finishes).
    // Two DIFFERENT base codes reducing to one name are rivals, and both are refused.
    const groups = new Map();
    (parts || []).forEach(p => {
        const code = baseCodeOf(p);
        if (!code) return;
        const k = nodeKey(code);
        const byBase = groups.get(k) || new Map();
        byBase.set(code, [...(byBase.get(code) || []), p]);
        groups.set(k, byBase);
    });
    const fullKeyOf = (p) => nodeKey(String((p && (p.legacyErpId || p.itemId)) || ''));
    const out = [];
    for (const [k, byBase] of groups) {
        // THE NODE MAY CARRY THE FINISH (2026-09-23, H1-BACKPLATES: H1BPWP4P is H1-BPWP4/P). The
        // family is looked for under its base code AND under each record's full code, finish
        // flattened in. Geometry does not vary by finish, so either hit is the family's node.
        const baseHits = (index.get(k) || []).slice().sort();
        const fullHits = [];
        for (const records of byBase.values()) records.forEach(r => { const fk = fullKeyOf(r); if (fk && fk !== k) (index.get(fk) || []).forEach(n => { if (!fullHits.includes(n)) fullHits.push(n); }); });
        fullHits.sort();
        const hits = baseHits.length ? baseHits : fullHits;
        if (!hits.length) continue;                                  // not in this model
        if (byBase.size > 1) {
            const names = [...byBase.keys()].sort();
            names.forEach(code => out.push({ part: byBase.get(code)[0], code, node: '', instances: hits.length, status: NODE_AMBIGUOUS, why: `${names.join(' and ')} reduce to the same node name` }));
            continue;
        }
        const [code, records] = [...byBase.entries()][0];
        const isBase = (p) => { const c = splitCode((p && (p.legacyErpId || p.itemId)) || ''); return !!c && !c.finish; };
        const base = records.find(isBase);
        // The base record when there is one (its variants inherit in the pass after); a family with
        // no base record has every variant photographed itself — the same node, one render, cached.
        (base ? [base] : records).forEach(part => {
            const row = { part, code: base ? code : String(part.legacyErpId || part.itemId || code), node: hits[0], instances: hits.length };
            if (hasPhoto(part)) out.push({ ...row, status: NODE_HAS_PHOTO, why: 'already has a real photograph — left alone' });
            else out.push({ ...row, status: NODE_READY, why: '' });
        });
    }
    return out.sort((a, b) => a.code.localeCompare(b.code));
};

/** The plan for one model, for the confirm: what is photographed, what is refused — and, for a
 *  model whose nodes match no item at all, the names it actually holds. */
export const modelReportText = (asmName, rows = [], nodeNames = [], limit = 14) => {
    const ready = rows.filter(r => r.status === NODE_READY);
    const had = rows.filter(r => r.status === NODE_HAS_PHOTO);
    const amb = rows.filter(r => r.status === NODE_AMBIGUOUS);
    const lines = [`${asmName}: ${ready.length} to photograph${had.length ? `, ${had.length} already photographed` : ''}${amb.length ? `, ${amb.length} refused` : ''}`];
    if (ready.length) lines.push(`   ${ready.slice(0, limit).map(r => r.code).join(', ')}${ready.length > limit ? ` … and ${ready.length - limit} more` : ''}`);
    amb.forEach(r => lines.push(`   ✗ ${r.code}: ${r.why}`));
    if (!rows.length) {
        const names = [...new Set((nodeNames || []).map(cleanFusionName).filter(Boolean))].sort();
        lines.push(names.length
            ? `   no node in this model is named with an item code — it holds: ${names.slice(0, limit).join(', ')}${names.length > limit ? ` … and ${names.length - limit} more` : ''}`
            : '   the model has no named nodes at all');
    }
    return lines.join('\n');
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
