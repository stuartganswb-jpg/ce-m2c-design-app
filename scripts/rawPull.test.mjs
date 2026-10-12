// node scripts/rawPull.test.mjs — a to-be-finished part with no /P record is finished from its RAW item (Stuart
// 2026-10-12, SO60812: 100 × HTAEC35 in RF1 were on no work order's parts list). The records are the live ones.
import { planFinishedRun, rawPullLinesOf } from '../src/components/Shared/finishedGoodsRun.js';
let pass = 0, fail = 0;
const eq = (n, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) pass++; else { fail++; console.log(`✗ ${n}\n   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`); } };
const caps = { id: 'CE-INV-66256', legacyErpId: 'HTAEC35', itemName: '1-3/8" Traverse End Cap', partClass: 'Inventory', manufacturingSpecs: { productType: 'Finial', uom: 'Each' } };
const planOf = (part, finish, inventory, pins = []) => planFinishedRun({ part: { ...part, legacyErpId: `${part.legacyErpId}/${finish}` }, qty: 100, pins, inventory });

const noP = planOf(caps, 'RF1', [caps]);
eq('the planner\'s fallback for a part with no /P record: it "pulls" the finished code itself', noP.lines.map(l => [l.legacyErpId, l.quantity]), [['HTAEC35/RF1', 100]]);
const raw = rawPullLinesOf(noP, caps);
eq('…which becomes the RAW item, 100 of them, named and in the item\'s own unit', raw.map(l => [l.legacyErpId, l.partId, l.quantity, l.partName, l.uom, l.pcs, l.rawPull, l.sourceComponent]),
    [['HTAEC35', 'HTAEC35', 100, '1-3/8" Traverse End Cap — raw pull (no /P record)', 'EA', 100, true, 'HTAEC35']]);
const withP = planOf(caps, 'RF1', [caps, { id: 'P', legacyErpId: 'HTAEC35/P', itemName: 'End cap /P', manufacturingSpecs: {} }]);
eq('a part WITH a /P record is untouched: the phosphated pull', rawPullLinesOf(withP, caps).map(l => [l.legacyErpId, l.quantity, !!l.rawPull]), [['HTAEC35/P', 100, false]]);
const plated = planOf(caps, 'EP2', [caps]);
eq('a plated finish is untouched: the mill core goes to the plater', rawPullLinesOf(plated, caps).map(l => [l.legacyErpId, !!l.rawPull]), [['HTAEC35', false]]);
const arm = { id: 'A', legacyErpId: 'H2-138-TB3', itemName: 'Arm', manufacturingSpecs: {} };
const bracket = { id: 'B', legacyErpId: 'HRW-138TRAVLB', itemName: 'Bracket', partClass: 'Assembly', manufacturingSpecs: {} };
const exploded = planOf(bracket, 'RF1', [bracket, arm], [{ partId: 'A', legacyErpId: 'H2-138-TB3', partName: 'Arm', defaultQty: 1 }]);
eq('an assembly\'s members are untouched', [exploded.exploded, rawPullLinesOf(exploded, bracket).map(l => [l.legacyErpId, !!l.rawPull])], [true, [['H2-138-TB3', false]]]);
eq('nothing to read → nothing', [rawPullLinesOf(null, caps), rawPullLinesOf({ erp: 'X/RF1', exploded: false, lines: [] }, caps)], [[], []]);
eq('a line that is already the raw item is left as it is', rawPullLinesOf({ erp: 'HTAEC35', exploded: false, lines: [{ legacyErpId: 'HTAEC35', quantity: 5 }] }, caps), [{ legacyErpId: 'HTAEC35', quantity: 5 }]);
console.log(`rawPull: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
