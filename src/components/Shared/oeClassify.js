// ── ONE CLASSIFIER FOR EVERY DOOR (Stuart 2026-09-27, SO60551: "is 10.5 now using all the same tools?") ──
// The CPQ split decides which lines go to the SHOP with Shared/lineClassification.classifyLine: fees, French
// / miter / bent returns and splices ride the pole on the shop's cut list; the item's own Part Handling tag
// decides the rest; a wood rod is custom only when it is cut (miters, bends, splices). The Order Entry route
// (tab 7's to-be-finished lines and 10.5's rows) had its own narrower test — pole category + finish suffix —
// so SO60551's French returns and traverse miters (Fee items) were stock-checked as plated parts and landed
// on the Backorder board, the stained oak fascia went to finishing un-mitered, and the wood track (no finish
// on the 9/16 quote) was left as a shelf pick. This module feeds the SAME classifyLine the inputs it reads on
// the CPQ path:
//   · the item — the FINISHED record when the library has it (the CPQ line is the finished SKU), else the
//     base; a pole whose finished SKU has no record yet follows the importers' rule for that SKU
//     (finishRouting.handlingForErp, the finish suffix — Stuart 2026-09-01);
//   · the cut facts — CPQ reads counts off the job's engineeringNotes (one cart item's); a row reads them off
//     its OWN fee lines (a miter fee on the row means the row's wood is mitered).
// And the finish a line takes when it names none, or rides: CPQ's rule since 9/18 (Shared/HardwareConfigurator
// "A RETURN CUT INTO THE POLE WEARS THE POLE'S FINISH") — a fee cut into a rod wears the rod's finish, and a
// custom line quoted with no finish takes its row's rod finish. Pure.
import { classifyLine, DIVISION_CUSTOM, DIVISION_SMALL } from './lineClassification.js';
import { isPoleCategory } from './poleCut.js';
import { handlingForErp } from './finishRouting.js';

const U = (v) => String(v == null ? '' : v).trim().toUpperCase();
const specsOf = (p) => (p && p.manufacturingSpecs) || {};
const typeOf = (p) => String(specsOf(p).productType || (p && p.productType) || '');
export const isFeePart = (p) => !!p && (p.partClass === 'Fee' || U(typeOf(p)) === 'FEE');
const isWoodPart = (p) => /\bWOOD\b/i.test(String(specsOf(p).material || ''));
export { DIVISION_CUSTOM, DIVISION_SMALL };

/** Which fabrication a fee names — the words CPQ's own fee rule reads (lineClassification, rule 0). */
export const fabKindOf = (text) => {
    const t = U(text);
    if (/MITER(ED)?\s*RETURN/.test(t)) return 'miterReturn';
    if (/SPLICE/.test(t)) return 'splice';
    if (/\bBEN(D|T)\b|FRENCH\s*RETURN|\bRETURN\b/.test(t)) return 'bend';
    if (/MITER|\bMTR\b|MTR$/.test(t)) return 'miter';
    return '';
};

/**
 * The cut facts of a set of lines (a row, or an order with no rows): the fabrication its FEE lines name,
 * in the shape classifyLine's `fab` takes ({ qtyMiters, qtyBends, qtySplices, qtyMiterReturns }).
 * @param entries [{ line, part }] — every line of the row; only fees count
 */
export const rowFabOf = (entries = []) => {
    const fab = { qtyMiters: 0, qtyBends: 0, qtySplices: 0, qtyMiterReturns: 0 };
    (entries || []).forEach(({ line, part }) => {
        if (!(line && (line.isFee || line.lineIsFee)) && !isFeePart(part)) return;
        const kind = fabKindOf(`${(part && part.itemName) || ''} ${(line && line.name) || ''} ${(line && line.erp) || ''}`);
        const n = Math.max(1, Number(line && line.qty) || 1);
        if (kind === 'miterReturn') fab.qtyMiterReturns += n;
        else if (kind === 'splice') fab.qtySplices += n;
        else if (kind === 'bend') fab.qtyBends += n;
        else if (kind === 'miter') fab.qtyMiters += n;
    });
    return fab;
};

/**
 * Shop or small, by CPQ's classifyLine.
 * @returns { division, rider, pole, fee } — a RIDER is a custom line that is not a pole and has no cut
 *          (a fee, a return, a miter): fabrication ON the pole, on the shop's cut list, never stock-checked,
 *          picked or backordered.
 */
export const oeDivisionOf = ({ line = {}, basePart = null, finishedPart = null, erp = '', finish = '', fab = null } = {}) => {
    const part = finishedPart || basePart;
    const fee = !!(line.isFee || line.lineIsFee || isFeePart(basePart) || isFeePart(finishedPart));
    const cls = {
        name: line.name || '', qty: line.qty,
        partId: line.partId || (part && part.id) || U(erp || line.erp),
        isFee: fee, lineIsFee: fee,
        partHandling: line.partHandling || '', customOverrideHandling: line.customOverrideHandling || '',
    };
    let division = classifyLine(cls, part, fab || {});
    const pole = !fee && (isPoleCategory(typeOf(basePart)) || isPoleCategory(typeOf(finishedPart)));
    // A pole whose finished SKU has no record: the importers' rule for that SKU — mill / applied finish =
    // Custom, /BS /N90 /CP… = Small Parts. Wood is decided by its cut (above); an operator override stands.
    if (pole && !finishedPart && !isWoodPart(basePart) && !U(line.customOverrideHandling)) {
        const code = U(erp || line.erp);
        division = handlingForErp(finish ? `${code}/${U(finish)}` : code) === 'Custom' ? DIVISION_CUSTOM : DIVISION_SMALL;
    }
    const rider = division === DIVISION_CUSTOM && !pole && !(Number(line.cutLength) > 0);
    return { division, rider, pole, fee };
};

/**
 * The finish each line of ONE row takes. A line keeps its own finish — except a RIDER, which wears its rod's
 * finish (CPQ, 9/18: SO60551's miter went out EP4 on a stained oak fascia), and a custom line quoted with no
 * finish, which takes the rod's. The rod = the row's custom non-rider lines that name a finish; when they
 * name more than one, a rider keeps its own finish if it is one of them, otherwise it is left for a person.
 * @param items [{ lineIdx, ownFinish, division, rider }]
 * @returns { [lineIdx]: { finish, source: 'line' | 'rod' | '', why } }
 */
export const rowFinishesOf = (items = []) => {
    const rods = [...new Set((items || []).filter(i => i.division === DIVISION_CUSTOM && !i.rider && U(i.ownFinish)).map(i => U(i.ownFinish)))];
    const out = {};
    (items || []).forEach(i => {
        const own = U(i.ownFinish);
        const needsRod = i.rider || (i.division === DIVISION_CUSTOM && !own);
        if (!needsRod) { out[i.lineIdx] = { finish: own, source: own ? 'line' : '', why: '' }; return; }
        if (rods.length === 1) { out[i.lineIdx] = { finish: rods[0], source: 'rod', why: '' }; return; }
        if (own && rods.includes(own)) { out[i.lineIdx] = { finish: own, source: 'line', why: '' }; return; }
        out[i.lineIdx] = {
            finish: '', source: '',
            why: rods.length ? `rides a rod, and the row's rods take ${rods.join(' and ')} — which one is it cut into?` : `no finish, and no rod in its row names one — set the finish on the line`,
        };
    });
    return out;
};
