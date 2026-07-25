// BAY / FIT MATH — the Vision Hardware pole-solve + O2O ("does it fit?") computation, extracted
// VERBATIM from VisionHardware.js (2026-07-25) so the customer portal's measurement intake can run
// the IDENTICAL math. ⚠ MIRROR RULE: portal/src/shared/bayMath.js is a byte-for-byte copy of this
// file (same convention as sizeMatrix.js / priceLevels.js) — edit HERE, then `cp` into the portal
// in the same commit and diff the two. A hand-edited second copy WILL drift, and drift here means
// a quoted system that doesn't fit the customer's opening — the exact failure this module exists
// to prevent ("every day customers are confused over the outside edge measurements and we can't
// afford to not have these orders fit").
//
// Pure function of its inputs — no React, no Firestore, no component state:
//   engData      the Vision engineering-data object (shape STRAIGHT|MITERED|BOW, inputMode, walls
//                w1/w2/w3, angles a1/a2, bowDepth, end styles, mounts, poleDiameter, deduct and
//                allowance settings, selected bracket/backplate ids, bracketW…)
//   safeProj     the effective bracket projection in inches — use safeProjOf(engData)
//   libraryParts array of library part docs — read only for the return-end O2O contribution
//                (backplate pole-axis half + return-arm thickness); pass [] when unavailable and
//                return ends fall back to the half-bracket-width share.
//
// Output object, in two tiers:
//   FIT / CUSTOMER-FACING: poleO2O, endAddL, endAddR, totalSystemO2O (THE number that has to fit
//     the opening), wall1/2/3 + pole1/2/3 (the C2C readouts), isLeftInside/isRightInside,
//     endStyleL/endStyleR.
//   SHOP-ONLY (never render to a customer — compute and STORE on the draft for the floor):
//     rawLeft/rawCenter/rawRight, totalPoleRawInches, orderL/orderC/orderR, sawAngle1/sawAngle2,
//     mDeduct1/mDeduct2, bendDeductL/R, imDeductL/R, addL_RAW/addR_RAW, poleFeetQty,
//     qtyMiters/qtyBends/qtyMiterReturns/qtyFinials, recRings, bowR/bowHW_R.

const rad = (deg) => (deg * Math.PI) / 180;

// The effective projection: engData.proj parsed, 0 when blank/invalid.
export const safeProjOf = (engData) => parseFloat(engData?.proj) || 0;

export function computeBayMath({ engData, safeProj, libraryParts = [] }) {
    let mDeduct1 = 0, mDeduct2 = 0, wall1 = engData.w1, wall2 = engData.w2, wall3 = engData.w3, pole1 = 0, pole2 = 0, pole3 = 0, sawAngle1 = 0, sawAngle2 = 0;
    let bowR = 0, bowHW_R = 0;

    const isLeftInside = engData.shape === 'STRAIGHT' ? engData.mountLeft === 'INSIDE' : engData.mountOuter === 'INSIDE';
    const isRightInside = engData.shape === 'STRAIGHT' ? engData.mountRight === 'INSIDE' : engData.mountOuter === 'INSIDE';

    // Per-side End Style: Left = engData.endStyle, Right = endStyleRight (falls back to Left when unset).
    const endStyleL = engData.endStyle;
    const endStyleR = engData.endStyleRight || engData.endStyle;
    const bendDeductL = (!isLeftInside && endStyleL === 'RETURN_BEND') ? (engData.poleDiameter / 2) : 0;
    const bendDeductR = (!isRightInside && endStyleR === 'RETURN_BEND') ? (engData.poleDiameter / 2) : 0;
    const imDeductL = isLeftInside ? engData.insideMountDeduct : 0;
    const imDeductR = isRightInside ? engData.insideMountDeduct : 0;

    if (engData.shape === 'STRAIGHT') {
        if (engData.inputMode === 'WALL') {
            wall2 = engData.w2;
            pole2 = wall2 - bendDeductL - bendDeductR - imDeductL - imDeductR;
        } else {
            pole2 = engData.w2 - bendDeductL - bendDeductR - imDeductL - imDeductR;
            wall2 = engData.w2;
        }
    } else if (engData.shape === 'MITERED') {
        mDeduct1 = engData.a1 === 180 ? 0 : safeProj * Math.tan(rad((180 - engData.a1) / 2));
        mDeduct2 = engData.a2 === 180 ? 0 : safeProj * Math.tan(rad((180 - engData.a2) / 2));
        if (engData.inputMode === 'WALL') {
            wall1 = engData.w1; wall2 = engData.w2; wall3 = engData.w3;
            pole1 = Math.max(0, wall1 - mDeduct1 - imDeductL);
            pole2 = Math.max(0, wall2 - mDeduct1 - mDeduct2);
            pole3 = Math.max(0, wall3 - mDeduct2 - imDeductR);
        } else {
            pole1 = engData.w1 - bendDeductL - imDeductL; wall1 = pole1 + mDeduct1 + imDeductL;
            pole2 = engData.w2; wall2 = pole2 + mDeduct1 + mDeduct2;
            pole3 = engData.w3 - bendDeductR - imDeductR; wall3 = pole3 + mDeduct2 + imDeductR;
        }
        sawAngle1 = engData.a1 === 180 ? 0 : 90 - (engData.a1 / 2); sawAngle2 = engData.a2 === 180 ? 0 : 90 - (engData.a2 / 2);
    } else if (engData.shape === 'BOW') {
        const c = engData.w2; const h = engData.bowDepth;
        if (h > 0) {
            const rInput = (h / 2) + ((c * c) / (8 * h)); const theta = 2 * Math.asin(c / (2 * rInput));
            if (engData.inputMode === 'WALL') { bowR = rInput; bowHW_R = bowR - safeProj; pole2 = Math.max(0, (bowHW_R * theta) - imDeductL - imDeductR); wall2 = c; }
            else { bowHW_R = rInput; bowR = bowHW_R + safeProj; pole2 = (bowHW_R * theta) - imDeductL - imDeductR; wall2 = 2 * bowR * Math.sin(theta / 2); }
        }
    }

    // --- RAW CUTS & O2O MATH ---
    const addL_RAW = (!isLeftInside && endStyleL === 'RETURN_BEND') ? engData.gripAllowance : 0;
    const addR_RAW = (!isRightInside && endStyleR === 'RETURN_BEND') ? engData.gripAllowance : 0;

    const orderL = engData.shape === 'MITERED' ? pole1 + bendDeductL + imDeductL : 0;
    const orderR = engData.shape === 'MITERED' ? pole3 + bendDeductR + imDeductR : 0;
    const orderC = engData.shape === 'STRAIGHT' ? (pole2 + bendDeductL + bendDeductR + imDeductL + imDeductR) : (engData.shape === 'BOW' ? pole2 + imDeductL + imDeductR : pole2);

    const rawLeft = engData.shape === 'MITERED' ? pole1 + addL_RAW : 0;
    const rawRight = engData.shape === 'MITERED' ? pole3 + addR_RAW : 0;
    const rawCenter = (engData.shape === 'STRAIGHT' || engData.shape === 'BOW') ? pole2 + addL_RAW + addR_RAW : pole2;

    const totalPoleRawInches = rawLeft + rawCenter + rawRight;
    const poleO2O = orderL + orderC + orderR;
    // Per-end O2O contribution: a return end WITH a backplate adds half the backplate's pole-axis
    // dimension — the end-return arm lands at the backplate's middle (orientation set on the backplate
    // item: vertical→width, horizontal→length). Any other end keeps the legacy bracketW share, so a
    // plain non-backplate job is unchanged (½·bracketW + ½·bracketW = bracketW).
    const bpEndHalf = (id) => {
        const p = libraryParts.find(x => x.id === id);
        const par = p?.manufacturingSpecs?.parametric || {};
        const o = (p?.manufacturingSpecs?.customData?.bpOrientation || 'VERTICAL').toUpperCase();
        const dim = o.startsWith('H') ? parseFloat(par.length)                             // horizontal → length
            : o.startsWith('R') ? (parseFloat(par.fixedDiameter) || parseFloat(par.width)) // round → diameter
            : parseFloat(par.width);                                                       // vertical / square → width
        return ((dim || 0)) / 2;
    };
    const isRetBkt = (id) => !!libraryParts.find(p => p.id === id)?.manufacturingSpecs?.customData?.isReturnBracket;
    const o2oRightBktId = engData.bracketIdRight;
    const o2oRightBpId = engData.backplateIdRight;
    // Return-bracket arm thickness (e.g. ½" flat-iron stock) is set on the bracket item and adds
    // to each return end's O2O on top of the half-backplate.
    const armThk = (id) => parseFloat(libraryParts.find(p => p.id === id)?.manufacturingSpecs?.customData?.armThickness) || 0;
    // An INSIDE-mounted end sits flush to the wall and adds nothing past the pole (the inside-mount
    // deduct already trims the pole to fit). An OUTSIDE end adds, in precedence order:
    //   1. return-ARM bracket (Flat Iron pattern) + plate → half the plate's pole-axis dim + arm;
    //   2. a RETURN end style (french/miter) with a chosen backplate (Stuart 2026-07-25: "the
    //      backplate drives the total system o2o measurement") → half that plate's pole-axis dim
    //      (+ any arm thickness) — the return lands on its mounting base, so the base's outer
    //      edge is the system's outside edge. Fires only when the plate's dims resolve (> 0);
    //   3. otherwise the legacy half-bracket-width share — so nothing changes until a real plate
    //      with real dims is selected.
    const returnEndL = endStyleL === 'RETURN_BEND' || endStyleL === 'RETURN_MITER';
    const returnEndR = endStyleR === 'RETURN_BEND' || endStyleR === 'RETURN_MITER';
    const endAddOf = (inside, isReturnEnd, bktId, bpId) => {
        if (inside) return 0;
        if (isRetBkt(bktId) && bpId) return bpEndHalf(bpId) + armThk(bktId);
        if (isReturnEnd && bpId) { const h = bpEndHalf(bpId); if (h > 0) return h + armThk(bktId); }
        return engData.bracketW / 2;
    };
    const endAddL = endAddOf(isLeftInside, returnEndL, engData.bracketId, engData.backplateIdLeft);
    const endAddR = endAddOf(isRightInside, returnEndR, o2oRightBktId, o2oRightBpId);
    const totalSystemO2O = poleO2O + endAddL + endAddR;

    const poleFeetQty = Math.ceil(totalPoleRawInches / 12) || 0;
    const qtyMiters = engData.shape === 'MITERED' ? 2 : 0;
    const qtyBends = (endStyleL === 'RETURN_BEND' && !isLeftInside ? 1 : 0) + (endStyleR === 'RETURN_BEND' && !isRightInside ? 1 : 0);
    const qtyMiterReturns = (endStyleL === 'RETURN_MITER' && !isLeftInside ? 1 : 0) + (endStyleR === 'RETURN_MITER' && !isRightInside ? 1 : 0);
    const qtyFinials = (endStyleL === 'FINIAL' && !isLeftInside ? 1 : 0) + (endStyleR === 'FINIAL' && !isRightInside ? 1 : 0);
    const recRings = Math.ceil(totalSystemO2O / 12) * 4;

    return {
        // fit / customer-facing
        isLeftInside, isRightInside, endStyleL, endStyleR,
        wall1, wall2, wall3, pole1, pole2, pole3,
        poleO2O, endAddL, endAddR, totalSystemO2O,
        // shop-only (store, never render to a customer)
        mDeduct1, mDeduct2, sawAngle1, sawAngle2,
        bendDeductL, bendDeductR, imDeductL, imDeductR,
        addL_RAW, addR_RAW, orderL, orderC, orderR,
        rawLeft, rawCenter, rawRight, totalPoleRawInches,
        poleFeetQty, qtyMiters, qtyBends, qtyMiterReturns, qtyFinials, recRings,
        bowR, bowHW_R,
    };
}
