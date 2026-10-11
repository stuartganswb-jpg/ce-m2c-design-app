// The pillow request, pinned (S7, step 3c, 2026-10-11): the board writes a jobs PILLOW_REQUEST carrying the
// priced holder + the consumed rows + the photographed fabrics; tab 7's load resolves them by code, refuses
// a missing holder or one without a NetSuite id, and puts the unsourceable on the note.
import { pillowRequestOf, pillowCartPlanOf, pillowSummaryOf, PILLOW_REQUEST_STATUS, PILLOW_MADE_TO_ORDER } from '../src/components/Shared/pillowRequest.js';
import { pricePillow, DEFAULT_PILLOW_PRICING } from '../src/components/Shared/pillowPricing.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; } else { fail++; console.error('  ✗', name, extra); } };

const config = { ...DEFAULT_PILLOW_PRICING, prices: { '22x22': { A: 650, B: 775 } }, fabricGroups: { A: { rank: 1 }, B: { rank: 2 } }, seamLabor: { perSeam: 15 }, details: { FLANGE: { price: 20, per: 'EACH' } }, sizes: { '22x22': { fillItem: 'FILL-22', zipperItem: 'ZIP-22' } } };
const items = {
    'FAB-A': { id: 'a', legacyErpId: 'FAB-A', itemName: 'Savery', netSuiteInternalId: '1', manufacturingSpecs: { priceGroup: 'A', width: 54 } },
    'FILL-22': { id: 'f', legacyErpId: 'FILL-22', itemName: 'Insert', netSuiteInternalId: '2', manufacturingSpecs: {} },
    'ZIP-22': { id: 'z', legacyErpId: 'ZIP-22', itemName: 'Zipper', netSuiteInternalId: '3', manufacturingSpecs: {} },
    'CUSTOM PILLOW': { id: 'cp', legacyErpId: 'CUSTOM PILLOW', itemName: 'Custom Pillow', netSuiteInternalId: '9', manufacturingSpecs: { productType: 'Non-Inventory' } },
    'CAPTURE:x1': { id: 'CAPTURE:x1', captured: true, assetId: 'x1', legacyErpId: 'ROMO/INDIGO', itemName: 'Romo Indigo (photo)', manufacturingSpecs: { priceGroup: 'B', width: 54, customData: { patternId: 'ROMO', color: 'INDIGO' } } },
};
const findPart = (id) => items[id] || null;
const design = { size: '22x22', fill: 'DOWN', flange: 'FLANGE', flangeSize: 2, seams: [{ id: 1, treatment: 'STANDARD', lengthIn: 22 }], panels: [{ label: 'A', fabricId: 'FAB-A', widthIn: 22, heightIn: 11 }, { label: 'B', fabricId: 'CAPTURE:x1', widthIn: 22, heightIn: 11 }], back: null, outerTrim: {} };
const geometry = { panels: design.panels, warnings: [] };
const priced = pricePillow({ design, findPart, config, qty: 1 });
ok('fixture prices: 775 (B) + 15 + 20 = 810', priced.ok && priced.unitPrice === 810, JSON.stringify(priced.errors));
const session = { customerId: 'C1', customerName: 'Acme Interiors', jobName: 'Lobby', quoteId: 'Q-1' };

// ── the summary ──────────────────────────────────────────────────────────────────────────────
ok('the summary reads size · group · panels · seams · edge · fill', pillowSummaryOf({ priced, geometry, design }) === '22x22 · group B · 2 panels · 1 seam · flange · down');

// ── the request ──────────────────────────────────────────────────────────────────────────────
// the board re-prices for the ordered quantity before it writes the request
const priced2 = pricePillow({ design, findPart, config, qty: 2 });
const r = pillowRequestOf({ session, priced: priced2, geometry, design, capturedFabrics: [{ id: 'CAPTURE:x1', assetId: 'x1', code: 'ROMO/INDIGO', name: 'Romo Indigo (photo)', priceGroup: 'B', widthIn: 54, railroad: false, patternId: 'ROMO', color: 'INDIGO' }], snapshot: 'data:image/png;base64,AAA', qty: 2, by: 'stuart', at: 1000 });
ok('a priced design with a customer makes a request', r.ok && r.doc && r.doc.status === PILLOW_REQUEST_STATUS && r.doc.brandId === 'uniquity' && r.doc.jobId === 'PILLOWREQ-1000');
ok('the customer and the Vision session ride it', r.doc.customer.id === 'C1' && r.doc.customer.name === 'Acme Interiors' && r.doc.jobName === 'Lobby' && r.doc.visionQuoteId === 'Q-1');
const L = r.doc.pillowRequest.lines[0];
ok('the holder: CUSTOM PILLOW at 810, qty 2, total 1620, made to order SEW', L.holder.legacyErpId === 'CUSTOM PILLOW' && L.holder.price === 810 && L.qty === 2 && L.holder.total === 1620 && L.holder.madeToOrder === PILLOW_MADE_TO_ORDER && PILLOW_MADE_TO_ORDER === 'SEW');
ok('consumed = the library rows (fabric A, back, fill, zipper); the photographed fabric is NOT consumed', L.consumed.map(c => c.legacyErpId).join(',') === 'FAB-A,FAB-A,FILL-22,ZIP-22' && L.consumed.every(c => c.legacyErpId !== 'ROMO/INDIGO'), L.consumed.map(c => c.legacyErpId).join(','));
ok('the consumed quantities are for the ordered qty (qty 2: back 0.75 × 2 = 1.5 yd; fill 2)', L.consumed.find(c => c.panel === 'BACK').qty === 1.5 && L.consumed.find(c => c.legacyErpId === 'FILL-22').qty === 2);
ok('sourced = the photographed fabric with pattern, colour, photo', L.sourced.length === 1 && L.sourced[0].code === 'ROMO/INDIGO' && L.sourced[0].patternId === 'ROMO' && L.sourced[0].assetId === 'x1' && L.sourced[0].panel === 'B');
ok('the design, the panels, the snapshot, the captured fabrics and the breakdown ride the line', L.design.size === '22x22' && L.panels.length === 2 && L.snapshot.startsWith('data:image') && L.capturedFabrics[0].assetId === 'x1' && L.breakdown.sizePrice === 775);
ok('the CRM sees a PRICED request: the holder row then the parts at $0 then the sourced one', r.doc.cpqData.totalPrice === 1620 && r.doc.cpqData.breakdown[0].isRollup && r.doc.cpqData.breakdown[0].total === 1620 && r.doc.cpqData.breakdown.slice(1, 5).every(b => b.price === 0 && b.inKit) && r.doc.cpqData.breakdown[5].captured === true);
ok('no customer refuses', !pillowRequestOf({ session: {}, priced, geometry, design }).ok && pillowRequestOf({ session: {}, priced, geometry, design }).errors[0].code === 'NO_CUSTOMER');
ok('an unpriced design refuses and says why', (() => { const bad = pricePillow({ design: { ...design, panels: [{ label: 'A', fabricId: 'GHOST', widthIn: 22, heightIn: 22 }] }, findPart, config }); const x = pillowRequestOf({ session, priced: bad, geometry, design }); return !x.ok && x.errors[0].code === 'NOT_PRICED' && /GHOST/.test(x.errors[0].message); })());

// ── tab 7's load ─────────────────────────────────────────────────────────────────────────────
const byCode = (code) => items[String(code || '').toUpperCase()] || null;
const plan = pillowCartPlanOf({ line: L, findByCode: byCode });
ok('the plan resolves the holder at the request\'s price and qty', plan.ok && plan.holder.item.id === 'cp' && plan.holder.rate === 810 && plan.holder.qty === 2 && plan.holder.madeToOrder === 'SEW');
ok('the holder note names the design and the fabric to be sourced', /CUSTOM PILLOW · 22x22 · group B/.test(plan.holder.note) && /TO BE SOURCED: ROMO\/INDIGO \(panel B\)/.test(plan.holder.note));
ok('parts: fabric A twice in yards, fill and zipper each', plan.parts.map(p => `${p.code}:${p.uom}:${p.yards ?? p.each}`).join(',') === 'FAB-A:YARD:0.75,FAB-A:YARD:1.5,FILL-22:EACH:2,ZIP-22:EACH:2', plan.parts.map(p => `${p.code}:${p.uom}:${p.yards ?? p.each}`).join(','));
ok('a part note says the panel and the quantity', /panel A · 0.75 yd/.test(plan.parts[0].note));
ok('a missing holder refuses and names it', (() => { const p = pillowCartPlanOf({ line: L, findByCode: (c) => (c === 'CUSTOM PILLOW' ? null : byCode(c)) }); return !p.ok && p.errors[0].code === 'HOLDER_MISSING' && /CUSTOM PILLOW is not in this brand/.test(p.errors[0].message); })());
ok('a holder without a NetSuite id refuses', (() => { const p = pillowCartPlanOf({ line: L, findByCode: (c) => (c === 'CUSTOM PILLOW' ? { ...items['CUSTOM PILLOW'], netSuiteInternalId: '' } : byCode(c)) }); return !p.ok && p.errors[0].code === 'HOLDER_NO_NS_ID'; })());
ok('a consumed item not in the library goes on the note, not the cart', (() => { const p = pillowCartPlanOf({ line: L, findByCode: (c) => (c === 'ZIP-22' ? null : byCode(c)) }); return p.ok && p.missing.join() === 'ZIP-22' && /NOT IN LIBRARY: ZIP-22/.test(p.holder.note) && p.parts.length === 3; })());

console.log(fail ? `\n❌  ${pass} passed, ${fail} failed` : `\n✅  ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
