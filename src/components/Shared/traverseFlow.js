// TRAVERSE FLOW GENERATOR (Stuart 2026-08-04: "traverse generator should be saved as its own, since
// it is very different... i do not think we need to try and make all the code work for both").
//
// The standard generator in AdminTab builds a POLE flow: a rod, its finish and length, end
// treatments, brackets. A traverse system shares the vocabulary but not the grammar, and the two
// were fighting inside one function — the fascia is pinned on POLE clusters, so the pole path
// collected it a SECOND time and emitted a phantom "Pole / Rod Material" + "Pole Length" pair
// carrying the SAME geometry nodes as the Fascia step, with its own independent selection. Two
// steps controlling one part is why the aluminium fascia rendered as disconnected bars: step 1 lit
// aluminium while the phantom step defaulted to wood and both node sets stayed on.
//
// Forking the flow shape removes that by construction — a traverse assembly never runs the pole
// path, so there is nothing to collect twice. The low-level helpers (add / addPerPosition /
// addEndTreatment / geom) stay SHARED and are passed in: turning options into steps is the same job
// in both worlds. What differs, and what this module owns, is WHICH steps exist and in WHAT ORDER.
//
// THE ORDER (Stuart 2026-08-04): "the flow should be a choice of fascia wood or aluminum, then
// choose associated finishes and length, then choose either projection or single/double, as both
// drive sequential choices, then if double there are 2 tracks shown and only double brackets shown
// (all tagged this way) if single, then show the 3 projections bracket options and single track."
//
// SETUP GATES PROJECTION, not the other way round. His tags already say so: every DOUBLE part
// (H12TRVBDBL, H12TRVRAD, H12RCTARDBL) is proj:any, and only the SINGLE parts carry 3-5/8 / 4-5/8 /
// 6. So Single-or-Double is asked first, and on DOUBLE the projection question has no content and
// is not asked at all.

// THE DRIVE IS A PROPERTY OF THE ORDER, NOT OF A TRACK (Stuart 2026-08-05: "they must pick between
// the two... it is an either or, either manual or motorized ends, no combination. this question can
// come at any point the order is not really important"). It was built as a SUB-choice hanging off
// the Track step on the theory that a two-track system could be motorised on one and manual on the
// other. It cannot. One question, two answers, applied to the whole system — and the answer is what
// the cut list reads: a motorised track is cut −2" against the fascia where a manual one is −0.5",
// and the F-clip −3" against −1" (see TRAVERSE_DEDUCTIONS).

import {
    offeredChoices, dedupeByPart, traverseRoleOf, traverseEnds, driveTypeOf, setupOf,
    needsSetupStep, setupsOffered, isRider,
} from './traverseTags';

/** Does this assembly's option pool carry any traverse tag at all? */
export const isTraverseAssembly = (opts) => (opts || []).some(o => traverseRoleOf(o));

// Roles that are chosen on their OWN step and must never leak into a pole/finial/bracket pool.
// FASCIA leaking into the pole pool is the phantom-step bug; TRV_END leaking into the finial pool
// is a drive pulley appearing in the End Treatment picker.
const OWN_STEP_ROLES = ['FASCIA', 'TRACK', 'TRV_END'];
const hasOwnStep = (o) => OWN_STEP_ROLES.includes(traverseRoleOf(o));

// A pool a traverse flow may still offer as an ordinary choice: no traverse role of its own, and
// not a rider (carriers and F-clips are built, never picked).
export const traverseChoicePool = (list) => (list || []).filter(o => !hasOwnStep(o) && !isRider(o));

// Bracket projections this assembly actually sells, from the 1.6 proj: tags. Mirrors the pole
// generator's rule: RETURN-type options are excluded because their tag is a minimum-depth gate, not
// a projection on offer — counting them invented phantom cards.
export function projectionsOffered(opts) {
    const byF = new Map();
    (opts || []).forEach(o => {
        if (!o.projInches) return;
        const et = String(o.endTreatment || '').toUpperCase();
        if (et === 'FRENCH_RETURN' || et === 'MITER_RETURN'
            || (o.isFee && /return|miter|mitre|french|bend/i.test(String(o.partName || '')))) return;
        const f = Math.round(parseFloat(String(o.projInches).replace(/[^0-9.]/g, '')) * 1000) / 1000;
        if (Number.isFinite(f) && !byF.has(f)) byF.set(f, String(o.projInches));
    });
    return [...byF.entries()].map(([f, raw]) => ({ f, raw })).sort((a, b) => a.f - b.f);
}

const projLabel = (f) => f === 0.75 ? '.75" Projection'
    : f === 3.625 ? '3-5/8" Projection'
    : f === 4.625 ? '4-5/8" Projection'
    : f === 6 ? '6" Projection'
    : `${f}" Projection`;

/**
 * Build the whole step list for a traverse assembly.
 *
 * Emits into the caller's `steps` array via the shared `add`/`addPerPosition`/`addEndTreatment`
 * helpers, so every step carries exactly the shape CPQ already knows how to run. Returns a small
 * report the caller folds into its own bookkeeping.
 *
 * Deliberately does NOT emit "Pole / Rod Material" or "Pole Length" — on a traverse system the
 * fascia IS that step, and emitting both is the bug this module exists to remove.
 */
export function buildTraverseFlow({
    pole = [], finial = [], brackets = [], backplates = [], rings = [], other = [],
    add, addPerPosition, addEndTreatment, geom, takeIncluded,
    bay, singleMode = false, sizeFamily = null,
}) {
    const allOpts = [...pole, ...finial, ...brackets, ...backplates, ...rings, ...other];

    // ── The parts that own their own step ────────────────────────────────────────────────────────
    // ONE MATERIAL, LISTED ONCE (Stuart: "currently showing 4 choices should just be 2"). A fascia
    // pinned in two clusters is still one material; dedupe MERGES the copies' nodes so the option
    // renders all of itself rather than half.
    const fascia = dedupeByPart(offeredChoices(allOpts, { role: 'FASCIA' }));
    // THE SECOND TRACK IS NOT A CHOICE — IT IS WHAT "DOUBLE" MEANS (Stuart 2026-08-05: "when i make
    // the switch from single to double it removes the bracket arms rather than adding a second
    // track"). A double ADDS a track; it does not swap one for another. So a track tagged
    // setup:DOUBLE never enters the Track picker — offering it there would put two identical
    // extrusions in one dropdown and ask the customer to pick between a thing and itself. It rides
    // on the DOUBLE answer instead, which is exactly what a geometryMap entry is for.
    const allTracks = offeredChoices(allOpts, { role: 'TRACK' });
    const doubleTracks = allTracks.filter(t => setupOf(t) === 'DOUBLE');
    // What the customer actually chooses: the track itself, for its finish. Deduped by part —
    // the same extrusion pinned at two nodes is one track, listed once.
    const track = dedupeByPart(allTracks.filter(t => setupOf(t) !== 'DOUBLE'));
    const { ends, drives, isChoice: driveIsChoice } = traverseEnds(allOpts);
    // ONE OPTION PER DRIVE, owning both ends. The same plug is pinned at LEFT and at RIGHT, so
    // deduping by part and merging the nodes turns "a plug on each end" into a single answer —
    // which is what an either/or question needs. Two DIFFERENT parts on one drive would stay two
    // options rather than silently losing one: visible and diagnosable beats quietly wrong.
    const endsForDrive = (d) => dedupeByPart(ends.filter(e => driveTypeOf(e) === d))
        .map(o => ({ ...o, driveType: d }));

    // ── Never a question, always built ───────────────────────────────────────────────────────────
    // Carriers ride inside the track; the F-clip attaches the track to the fascia. Both are cut and
    // consumed per configuration, neither is ever chosen. They were being tagged HIDE, which means
    // "never render anywhere" — the opposite of what a real part needs.
    const riders = allOpts.filter(isRider);
    const riderInc = riders.length
        ? riders.map(o => ({ partId: o.partId, partName: o.partName, qty: 1, traverseRole: traverseRoleOf(o) }))
        : null;
    // Only one drive → nothing to ask, but the end still has to be BUILT. It rides as an included
    // part instead of vanishing for want of a question.
    const endInc = (!driveIsChoice && ends.length)
        ? ends.map(o => ({ partId: o.partId, partName: o.partName, qty: 1, traverseRole: 'TRV_END' }))
        : null;

    // ── The ordinary pools, with the own-step roles and riders removed ───────────────────────────
    const finialOpts = traverseChoicePool(finial);
    const bracketOpts = traverseChoicePool(brackets);
    const backplateOpts = traverseChoicePool(backplates);
    // Rings belong to the decorative FRONT pole, never to the track — the carriers do that job
    // inside it.
    const ringOpts = traverseChoicePool(rings).filter(o => String(o.position || '').toUpperCase() === 'FRONT');

    // ── 1. FASCIA — the pole step of a traverse system ───────────────────────────────────────────
    // Stuart 2026-08-04: "the fascia step needs to act like a pole step... first choose from
    // material there are wood and metal fascia loaded, then based off this selection we will choose
    // the appropriate finish and enter length". Same two shapes the pole uses, for the same reason:
    // with SEVERAL materials the material step owns the finish (each option carries its own scoped
    // finish list) and the length step is dimensions only; with ONE there is nothing to choose, so
    // finish and length combine.
    const fasciaNodes = fascia.map(o => o.targetNode).filter(Boolean).join(', ');
    if (fascia.length > 1) {
        add({
            title: 'Fascia Material', type: 'STYLE_SWAP', partHandling: 'Custom', hideQty: true,
            required: true, useClientPricing: true, stepRole: 'TRV_FASCIA',
            styleOptions: fascia, geometryMap: geom(fascia),
        });
        add({
            title: 'Fascia Length', type: 'DIMENSIONS', partHandling: 'Custom',
            calculatorTemplate: bay.calc, qtyHelperText: bay.qtyHelper, required: true,
            useClientPricing: true, geometryMap: {}, targetNodes: fasciaNodes,
            ...(riderInc ? { includedParts: riderInc } : {}),
        });
    } else if (fascia.length === 1) {
        add({
            title: 'Fascia Length & Finish', type: 'VISUAL_DIMENSIONS', dataSource: 'master_finishes',
            partHandling: 'Custom', calculatorTemplate: bay.calc, qtyHelperText: bay.qtyHelper,
            required: true, useClientPricing: true, geometryMap: {}, targetNodes: fasciaNodes,
            ...(fascia[0]?.partId ? { linkedItemId: fascia[0].partId } : {}),
            ...(riderInc ? { includedParts: riderInc } : {}),
        });
    }

    // ── 2. SINGLE OR DOUBLE — before everything it gates ─────────────────────────────────────────
    // It decides which tracks and which brackets exist, so it cannot be asked after them. Only when
    // the assembly can actually be built both ways: a step with one answer is not a question.
    // The DOUBLE answer OWNS the second track: its nodes render and its part bills only while
    // DOUBLE is selected, and SINGLE carries no extra geometry at all. That makes the step
    // additive, which is what a double physically is — one fascia, two tracks.
    const hasSetupStep = needsSetupStep(allOpts);
    const secondTrackNodes = doubleTracks.map(o => o.targetNode).filter(Boolean).join(', ');
    if (hasSetupStep) add({
        id: 'TRV-SETUP', title: 'Single or Double', type: 'STYLE_SWAP', stepRole: 'TRV_SETUP',
        partHandling: 'Custom', required: true, hideQty: true, useClientPricing: true,
        styleOptions: setupsOffered(allOpts).map(t => {
            const isDouble = t === 'DOUBLE';
            return {
                optId: `OPT-SETUP-${t}`,
                partId: isDouble ? (doubleTracks[0]?.partId || '') : '',
                partName: isDouble ? 'Double (two tracks)' : 'Single (one track)',
                trvSetup: t, price: 0,
                targetNode: isDouble ? secondTrackNodes : '',
            };
        }),
        geometryMap: secondTrackNodes ? { 'OPT-SETUP-DOUBLE': secondTrackNodes } : {},
    });

    // ── 3. DRIVE — motorised or manual, for the whole order ──────────────────────────────────────
    // Its position in the flow genuinely does not matter (Stuart: "this question can come at any
    // point"); it sits beside Single-or-Double because both are system-level either/ors that gate
    // parts further down, and answering them together reads better than scattering them.
    //
    // THE ENDS ARE REAL PARTS ("should i just tag them the ends?"). As synthetic Motorized/Manual
    // labels they had no partId — nothing to bill and nothing to render. Tagged trv:end + their
    // drive, the ends ARE the answer, so picking one picks an actual part.
    if (driveIsChoice) {
        const driveOpts = drives.flatMap(endsForDrive);
        add({
            id: 'TRV-DRIVE', title: 'Traverse Drive', type: 'STYLE_SWAP', stepRole: 'TRV_DRIVE',
            partHandling: 'Custom', required: true, hideQty: true,
            finishDataSource: 'master_finishes', useClientPricing: true,
            styleOptions: driveOpts, geometryMap: geom(driveOpts),
        });
    }

    // ── 4. BRACKET PROJECTION — gated by the setup answer ────────────────────────────────────────
    // Every DOUBLE part is proj:any, so on a double this question has nothing to ask. trvSetupOnly
    // tells CPQ to skip the step entirely when DOUBLE is chosen (see CPQTab's disabled-step pass);
    // with no setup step at all it is simply always asked.
    const projVals = (singleMode && !sizeFamily) ? projectionsOffered([...bracketOpts, ...backplateOpts, ...finialOpts]) : [];
    const impliedProjInches = projVals.length === 1 ? projVals[0].f : null;
    if (projVals.length >= 2) add({
        id: 'PROJ-CHOICE', title: 'Bracket Projection', type: 'PROJ_SELECT', stepRole: 'SIZE',
        required: true, hideQty: true,
        ...(hasSetupStep ? { trvSetupOnly: 'SINGLE' } : {}),
        styleOptions: projVals.map(x => ({
            optId: `PROJ-${String(x.f).replace(/\./g, '_')}`, partName: projLabel(x.f), projInches: x.raw,
        })),
    });

    // ── 5. TRACK — the extrusion, chosen for its finish ──────────────────────────────────────────
    // Its CUT LENGTH depends on the drive answered above (−0.5" manual, −2" motorised against the
    // fascia), but that is a fabrication consequence, not a second question.
    if (track.length) add({
        title: 'Track', type: 'STYLE_SWAP', partHandling: 'Custom', required: true, hideQty: true,
        finishDataSource: 'master_finishes', useClientPricing: true, stepRole: 'TRACK',
        styleOptions: track, geometryMap: geom(track),
        ...(endInc ? { includedParts: endInc } : {}),
    });

    // ── 6. ENDS AND BRACKETS ─────────────────────────────────────────────────────────────────────
    // End Treatment comes BEFORE the brackets on purpose: picking a return here can remove that
    // end's outer bracket step, so each end is settled first and no bracket is picked that then
    // disappears. Traverse has no LEFT/RIGHT pole segments, so no end-pole geometry rides along.
    addEndTreatment(finialOpts, []);
    addPerPosition(bracketOpts, 'Bracket & Mount', {
        clone: true, subOpts: backplateOpts, subLabel: 'Backplate', stepRole: 'BRACKET',
    });
    const bracketPositions = new Set(bracketOpts.map(b => b.position || ''));
    const looseBackplates = backplateOpts.filter(bp => !bracketPositions.has(bp.position || ''));
    if (looseBackplates.length) addPerPosition(looseBackplates, 'Backplate');
    if (ringOpts.length) add({
        title: 'Rings', type: 'STYLE_SWAP', partHandling: 'Small Parts',
        finishDataSource: 'master_finishes', useClientPricing: true,
        qtyHelperText: 'Number of rings', styleOptions: ringOpts, geometryMap: geom(ringOpts),
    });

    // ── 7. FEES — same as the pole flow ──────────────────────────────────────────────────────────
    add({ title: 'Splice', type: 'STATIC_FEE', qtyHelperText: 'Number of splices', basePrice: '0' });
    add({ title: 'Cut / Splice Fee', type: 'STATIC_FEE', qtyHelperText: 'Per cut / splice', basePrice: '0' });

    return {
        impliedProjInches,
        counts: {
            fascia: fascia.length, track: track.length, ends: ends.length,
            riders: riders.length, brackets: bracketOpts.length,
        },
    };
}
