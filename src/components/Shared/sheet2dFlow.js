// 2D TEAR-SHEET FLOW GENERATOR (Stuart 2026-08-14) — the fork for drawings.
//
// Same call as the traverse fork: the pole grammar in AdminTab never runs for a
// 2D assembly. A tear-sheet flow is simply ONE STEP PER DRAWN REGION, in the
// order the regions were drawn (draw order = question order): the Dawn's
// regions are Metal Frame / Wood Disc / Tassels / Diffuser / Chain — exactly
// the questions on M2C's static Build & Quote form. Options come from the
// region's pins (1.6 Assign tool), so BOM assignment and per-customer pricing
// ride the same rails as every 3D flow. The flow doc carries sheet2d
// { url, w, h, regions } so the CPQ renders the drawing + halos with no
// assembly read.
import { regionNodeId } from './sheet2d';

export function buildSheet2dFlow({ asm, pinsByCluster, ts }) {
    const sheet = asm?.manufacturingSpecs?.sheet2d;
    if (!sheet?.url) return { error: 'This assembly has no tear sheet (manufacturingSpecs.sheet2d). Import one in 1.5 Node Grouping.' };
    const regions = (asm.nodeClusters || []).filter(c => c.region2d && !c.hidden);
    if (!regions.length) return { error: 'No regions drawn on the tear sheet yet — draw them in 1.5 Node Grouping (drag = oval, SHIFT = circle), then add each region\'s choices in 1.6\'s Assign tool.' };

    // HYBRID (Leyla 2026-08-14): when the assembly borrows a display .glb
    // (sheet2d.renderGlbUrl — one render file serves every Dawn size), the CPQ renders the
    // model center-window with an architect-style material rail on the right. Rail anchors:
    // regions ranked by their tear-sheet height (the elevation IS the fixture's vertical
    // order) → 0..1 fractions the leader-line dots sit at.
    const renderUrl = String(sheet.renderGlbUrl || '').trim();
    const rankById = {};
    [...regions].sort((a, b) => (a.region2d.cy || 0) - (b.region2d.cy || 0))
        .forEach((c, i, arr) => { rankById[c.id] = (i + 0.5) / arr.length; });

    const steps = []; let n = 0; const noChoice = [];
    regions.forEach(cl => {
        const node = regionNodeId(cl.id);
        // With a display .glb, a region tagged with its model nodes (1.5 "3d:" input) routes the
        // step's FINISH selection onto those nodes (the geometryMap is what the CPQ texture
        // pipeline resolves) — frame/wood paint live, exactly like a native 3D flow.
        const target = (renderUrl && String(cl.render3dNodes || '').trim()) ? String(cl.render3dNodes).trim() : node;
        const pins = pinsByCluster[cl.id] || [];
        // Hidden pins with a REAL item # = BOM-only hardware riding this region's step.
        const included = pins.filter(p => p.isHiddenPart && p.partId && !String(p.partId).startsWith('HIDDEN-'))
            .map(p => ({ partId: p.partId, partName: p.partName || cl.name, qty: parseInt(p.defaultQty) || 1 }));
        const choicePins = pins.filter(p => !p.isHiddenPart && !p.parked)
            .sort((a, b) => ((a.choiceSort ?? 9999) - (b.choiceSort ?? 9999)) || String(a.partName || '').localeCompare(String(b.partName || '')));
        const clShort = String(cl.id).replace(/[^A-Za-z0-9]/g, '').slice(-8);
        const seen = {};
        const styleOptions = choicePins.map(p => {
            const pid = p.partId || cl.name;
            // optId keyed by part (stable across regenerates → authored prices survive);
            // a rare duplicate part in one region gets a -2/-3 suffix instead of colliding.
            const pShort = String(pid).replace(/[^A-Za-z0-9]/g, '').slice(0, 20);
            const k = `${clShort}|${pShort}`; seen[k] = (seen[k] || 0) + 1;
            return {
                optId: `OPT-2D-${clShort}-${pShort}${seen[k] > 1 ? `-${seen[k]}` : ''}`,
                partId: pid,
                partName: p.isFee ? `${p.partName || 'Charge'} (fee)` : (p.partName || pid),
                position: '', location: '', targetNode: target, price: 0,
                ...(p.imageUrl ? { imageUrl: p.imageUrl } : {}),
                ...(p.isFee ? { isFee: true } : {}),
                ...(Array.isArray(p.customerIds) && p.customerIds.length ? { customerIds: p.customerIds, customerNames: p.customerNames || [] } : {}),
            };
        });
        if (!styleOptions.length) { noChoice.push(cl.name || cl.id); return; } // no options = no step; flagged in the alert
        const gmap = {}; styleOptions.forEach(o => { gmap[o.optId] = target; });
        // Which side of the render this section's card + leader line sit on (Stuart 2026-08-15:
        // one-sided cards stacked into each other — "split chain, brass and wood to left and
        // the tassels and acrylic to the right"). Explicit railSide from the 1.5 toggle wins;
        // auto alternates so any light gets a balanced split without setup.
        const side = (cl.railSide === 'L' || cl.railSide === 'R') ? cl.railSide : (steps.length % 2 === 0 ? 'L' : 'R');
        steps.push({
            id: `STEP-${ts}-${++n}`,
            title: String(cl.name || 'Choice').replace(/[-_]+/g, ' ').trim(),
            type: 'STYLE_SWAP', partHandling: 'Small Parts', hideQty: true,
            required: styleOptions.length >= 2, // a single-choice region is informational, not a gate
            // ⛔ NO finishDataSource by default (Stuart 2026-08-15: the CE/Fabricut
            // master-finishes chip grid bled into every M2C step — tassel colors are CHOICES,
            // not finishes). Only a node-mapped hybrid region keeps the picker, so its finish
            // can paint the display model once a node-named .glb exists.
            ...(renderUrl && String(cl.render3dNodes || '').trim() ? { finishDataSource: 'master_finishes' } : {}),
            useClientPricing: true,
            styleOptions, geometryMap: gmap, sheet2dClusterId: cl.id, sheet2dRailSide: side,
            ...(included.length ? { includedParts: included } : {}),
        });
    });
    if (!steps.length) return { error: `Every region is missing choices (${noChoice.join(', ')}) — add each region's item #s in 1.6's Assign tool first.` };
    return {
        steps, noChoice,
        sheet2d: {
            url: sheet.url, w: sheet.w || 0, h: sheet.h || 0,
            regions: regions.map(c => ({ id: c.id, name: c.name || '', ...c.region2d, railFrac: rankById[c.id] })),
            ...(renderUrl ? { render3d: { url: renderUrl, from: sheet.renderGlbFrom || '' } } : {}),
        },
    };
}
