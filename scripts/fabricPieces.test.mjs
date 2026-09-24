// Fabric cut stock, pinned (S7, 2026-09-24): yards round UP to ⅛, a piece is labelled with the
// largest size it makes in its fabric's orientation, the roll's yards are NetSuite's minus the
// pieces, a throw converts to yards by its length, scrap posts one negative line in yards.
import {
    FABRIC_PIECE_STATUS, fabricCodeKey, newFabricPieceId, yardsUp, isLivePiece, pieceLabelOf, honestYards,
    yardsPerThrowOf, convertPlanOf, scrapAdjustmentPayload, fabricRowsOf,
} from '../src/components/Shared/fabricPieces.js';
import { DEFAULT_PILLOW_PRICING } from '../src/components/Shared/pillowPricing.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; } else { fail++; console.error('  ✗', name, extra); } };

const SIZES = ['20x12', '24x15', '19x19', '23x23', '36x20', '45x15', '20x20', '22x22', '24x24', '52x28'];
const config = { ...DEFAULT_PILLOW_PRICING, sizeOrder: SIZES, prices: Object.fromEntries(SIZES.map(s => [s, { A: 1 }])), seamAllowanceIn: 0.5 };
const naka = { id: 'u1', legacyErpId: 'NAKA10-FAB', itemName: 'Naka 10 yardage', netSuiteInternalId: '9001', manufacturingSpecs: { productType: 'FABRIC', width: 40, customData: { railroad: true, convertedFrom: 'NAKA10-THROW' } } };
const savery = { id: 'u2', legacyErpId: 'SAVERY-NAT', itemName: 'Savery', netSuiteInternalId: '9002', manufacturingSpecs: { productType: 'FABRIC', width: 54, customData: {} } };
const nakaThrow = { id: 't1', legacyErpId: 'NAKA10-THROW', itemName: 'Naka 10 throw', manufacturingSpecs: { productType: 'Throw', width: 40, length: 80 } };
const xlThrow = { id: 't2', legacyErpId: 'NAKA10-XL', manufacturingSpecs: { productType: 'Throw', width: 40, customData: { yardsPerThrow: 3 } } };

// ── identity + yards ─────────────────────────────────────────────────────────────────────────
ok('code key drops case, punctuation and any suffix', fabricCodeKey('naka10-fab/EP') === 'NAKA10FAB');
ok('piece ids start F- and are unique', /^F-[A-Z0-9]+$/.test(newFabricPieceId()) && newFabricPieceId() !== newFabricPieceId());
ok('16" → 0.5 yd (rounded UP to ⅛); 20" → 0.625; 36" → 1; 0 → 0', yardsUp(16) === 0.5 && yardsUp(20) === 0.625 && yardsUp(36) === 1 && yardsUp(0) === 0);
ok('37" rounds up, not down', yardsUp(37) === 1.125);
ok('a piece with no status is live; CONSUMED and SCRAP are not', isLivePiece({}) && isLivePiece({ status: 'CUT' }) && !isLivePiece({ status: 'CONSUMED' }) && !isLivePiece({ status: 'SCRAP' }));

// ── the label ────────────────────────────────────────────────────────────────────────────────
const p20 = { id: 'F-1', itemCode: 'SAVERY-NAT', lengthIn: 20, widthIn: 54 };
ok('a 20" × 54" plain cut is labelled up to 45x15 and lists every size it makes', (() => { const l = pieceLabelOf(p20, { fabric: savery, config }); return l.key === '45x15' && l.text === 'up to 45x15' && l.sizes.join(',') === '45x15,19x19,24x15,20x12'; })());
const p30r = { id: 'F-2', itemCode: 'NAKA10-FAB', lengthIn: 54, widthIn: 40 };
ok('a 54" × 40" cut of a RAILROAD fabric is labelled up to 52x28 (turned)', pieceLabelOf(p30r, { fabric: naka, config }).key === '52x28');
ok('the same cut read without its fabric (no railroad) is not 52x28', pieceLabelOf(p30r, { fabric: null, config }).key !== '52x28');
ok('a piece too small for any size says so', pieceLabelOf({ lengthIn: 8, widthIn: 54 }, { fabric: savery, config }).text === 'no standard size');
ok('no table → no standard size', pieceLabelOf(p20, { fabric: savery, config: DEFAULT_PILLOW_PRICING }).key === '');

// ── honest yards ─────────────────────────────────────────────────────────────────────────────
const pcs = [{ lengthIn: 20, widthIn: 54, status: 'CUT' }, { lengthIn: 16, widthIn: 54 }, { lengthIn: 30, widthIn: 54, status: 'CONSUMED' }, { lengthIn: 9, status: 'SCRAP' }];
const hy = honestYards({ nsYards: 10, pieces: pcs });
ok('two live pieces = 1 yd; the roll holds NetSuite\'s 10 − 1 = 9 yd; longest 20"', hy.pieceCount === 2 && hy.pieceYards === 1 && hy.rollYards === 9 && hy.longestIn === 20);
ok('no NetSuite figure → roll yards unknown, pieces still counted', honestYards({ pieces: pcs }).rollYards === null && honestYards({ pieces: pcs }).pieceCount === 2);
ok('the roll never goes negative', honestYards({ nsYards: 0.5, pieces: pcs }).rollYards === 0);

// ── the convert ──────────────────────────────────────────────────────────────────────────────
ok('yards per throw from the throw\'s length (80" → 2.222), from customData (3), else 2', yardsPerThrowOf(nakaThrow) === 2.222 && yardsPerThrowOf(xlThrow) === 3 && yardsPerThrowOf({}) === 2);
const cv = convertPlanOf({ throws: 3, yardsPerThrow: 2, fabric: naka, throwItem: nakaThrow });
ok('3 throws at 2 yd = 6 yd to build on the fabric-yardage item', cv.ok && cv.yards === 6 && cv.widthIn === 40);
ok('the typed yards per throw wins over the throw\'s length', convertPlanOf({ throws: 1, yardsPerThrow: 2.5, throwItem: nakaThrow }).yards === 2.5);
ok('no typed figure → the throw\'s own length', convertPlanOf({ throws: 1, throwItem: nakaThrow }).yards === 2.222);
ok('a fraction of a throw refuses', !convertPlanOf({ throws: 1.5, yardsPerThrow: 2 }).ok);
ok('a fabric without a NetSuite id refuses and names it', (() => { const r = convertPlanOf({ throws: 1, yardsPerThrow: 2, fabric: { legacyErpId: 'X' } }); return !r.ok && /X has no NetSuite internal id/.test(r.errors[0]); })());
ok('a width mismatch between throw and fabric refuses', !convertPlanOf({ throws: 1, yardsPerThrow: 2, fabric: savery, throwItem: nakaThrow }).ok);
ok('no yards per throw anywhere refuses', !convertPlanOf({ throws: 1 }).ok);

// ── the scrap posting ────────────────────────────────────────────────────────────────────────
const sp = scrapAdjustmentPayload({ internalId: '9001', nsConfig: { subsidiary: '6', location: '20' }, yards: 0.625, memo: 'scrap', bin: 'F-04' });
ok('one negative line in yards, account 254, the brand\'s subsidiary + location, bin detail when given', sp.payload.account.id === '254' && sp.payload.subsidiary.id === '6' && sp.payload.inventory.items[0].adjustQtyBy === -0.625 && sp.payload.inventory.items[0].location.id === '20' && sp.payload.inventory.items[0].inventoryDetail.inventoryAssignment.items[0].binNumber.refName === 'F-04');
ok('no bin → no inventory detail', !('inventoryDetail' in scrapAdjustmentPayload({ internalId: '9001', nsConfig: { subsidiary: '6', location: '20' }, yards: 1 }).payload.inventory.items[0]));
ok('no id / no yards → nothing to post', scrapAdjustmentPayload({ internalId: '', nsConfig: {}, yards: 1 }) === null && scrapAdjustmentPayload({ internalId: '1', nsConfig: { subsidiary: '6', location: '20' }, yards: 0 }) === null);

// ── the drill-down rows ──────────────────────────────────────────────────────────────────────
const pieces = [
    { id: 'F-A', codeKey: 'NAKA10FAB', itemCode: 'NAKA10-FAB', lengthIn: 54, widthIn: 40, status: 'CUT' },
    { id: 'F-B', codeKey: 'NAKA10FAB', itemCode: 'NAKA10-FAB', lengthIn: 20, widthIn: 40, status: 'CUT' },
    { id: 'F-C', codeKey: 'NAKA10FAB', itemCode: 'NAKA10-FAB', lengthIn: 30, widthIn: 40, status: 'CONSUMED' },
    { id: 'F-D', codeKey: 'GHOST', itemCode: 'GHOST', lengthIn: 25, widthIn: 54, status: 'CUT' },
];
const rows = fabricRowsOf({ fabrics: [naka, savery], throwsByCode: { 'NAKA10-THROW': nakaThrow }, pieces, config, nsYardsByCode: { 'NAKA10-FAB': 10 } });
ok('one row per fabric plus one for a piece whose fabric is not in the library, sorted by code', rows.map(r => r.code).join(',') === 'GHOST,NAKA10-FAB,SAVERY-NAT');
const nk = rows.find(r => r.code === 'NAKA10-FAB');
ok('the Naka row carries its throw, width, railroad, two live pieces longest first, labelled', nk.throwCode === 'NAKA10-THROW' && nk.throwItem === nakaThrow && nk.widthIn === 40 && nk.railroad === true && nk.pieces.map(p => p.id).join() === 'F-A,F-B' && nk.pieces[0].label.key === '52x28');
ok('the consumed piece is history, not stock', nk.history.length === 1 && nk.history[0].id === 'F-C');
ok('the row\'s roll yards = 10 − (54 + 20)/36', nk.avail.rollYards === 7.944 && nk.avail.pieceCount === 2);
ok('a fabric with no pieces still lists (the library row is the declaration)', rows.find(r => r.code === 'SAVERY-NAT').pieces.length === 0);
ok('a ghost piece lists under its own code with no fabric', rows[0].fabric === null && rows[0].pieces.length === 1);

console.log(fail ? `\n❌  ${pass} passed, ${fail} failed` : `\n✅  ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
