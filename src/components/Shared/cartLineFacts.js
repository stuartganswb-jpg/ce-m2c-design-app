// ── WHAT A PILLOW LINE IS, IN FULL, PURE (S7, 2026-10-17) ─────────────────────────────────────────
//
// Stuart: "once we add a pillow to cart, currently there is no way to check again on the stitch and welt selections,
// Ashley wanted to be sure that she put the seam down the middle rather than the edge and there is no way to see it
// on the lines in the cart". The cart line's note held the facts but the row clips it to one line. These rows are read
// from the DESIGN the line carries (line.pillow.design), never from the clipped note — the same design that goes to the
// sewing document, so what the rep checks is what the floor reads.
import { treatmentsOfDesign, treatmentWordsOf } from './pillowTreatments.js';
import { dimsOf } from './pillowPricing.js';

const str = (v) => String(v == null ? '' : v).trim();

/** [{ label, value }] for a pillow line (line.pillow), a one-of-a-kind line (line.oneOfAKind), or [] for anything else. */
export function cartLineFactsOf(line, { findPart = null } = {}) {
    if (!line) return [];
    const out = [];
    if (line.oneOfAKind) {
        out.push({ label: 'one of a kind', value: str(line.oneOfAKind.code) || '—' });
        return out;
    }
    const p = line.pillow;
    if (!p) return out;
    const d = p.design || {};
    const dims = dimsOf(d.size || p.sizeKey);
    if (p.sizeKey || d.size) out.push({ label: 'size', value: `${str(p.sizeKey || d.size)}${dims ? ` (${dims.w}" wide × ${dims.h}" tall)` : ''}` });
    const fabricIds = [...new Set((Array.isArray(d.panels) ? d.panels : []).map(x => str(x && x.fabricId)).filter(Boolean))];
    const nameOf = (id) => { const it = typeof findPart === 'function' ? findPart(id) : null; return it ? str(it.legacyErpId || it.itemId || id) : id; };
    if (fabricIds.length) out.push({ label: 'fabric', value: fabricIds.map(nameOf).join(' + ') + (p.group ? ` · group ${p.group}` : '') });
    else if (p.group) out.push({ label: 'group', value: str(p.group) });
    const edge = str(d.flange).toUpperCase();
    out.push({ label: 'edge', value: edge && edge !== 'NONE' ? `${edge.toLowerCase()}${Number(d.flangeSize) ? ` ${d.flangeSize}"` : ''}` : 'knife edge' });
    const treatments = treatmentsOfDesign(d);
    if (treatments.length) treatments.forEach(t => out.push({ label: t.placement === 'FOUR_SIDES' ? 'round the 4 sides' : (t.placement === 'MIDDLE' ? 'down the middle' : 'on a seam'), value: treatmentWordsOf(t).replace(/ · (4 sides|down the middle|on a seam)/, '') }));
    else out.push({ label: 'stitch / leather', value: 'none' });
    const seams = Array.isArray(d.seams) ? d.seams : [];
    const plainSeams = seams.filter(s => !treatments.some(t => t.seamId !== undefined && t.seamId === s.id));
    if (plainSeams.length) out.push({ label: 'seams', value: `${plainSeams.length} drawn` });
    if (d.outerTrim && d.outerTrim.trimId) out.push({ label: 'trim', value: `${nameOf(d.outerTrim.trimId)} on ${['top', 'bottom', 'left', 'right'].filter(k => d.outerTrim[k]).join(', ') || 'the edges'}` });
    if (str(d.fill)) out.push({ label: 'fill', value: str(d.fill).toLowerCase() });
    if (p.standardSku) out.push({ label: 'standard', value: str(p.standardSku) });
    return out;
}
