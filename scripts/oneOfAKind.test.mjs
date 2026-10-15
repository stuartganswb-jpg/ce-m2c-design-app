// One-of-a-kind pillows and wall art, pinned (S7, 2026-10-14): a card's readiness by name, the library record
// (stocked one, the photo, the making), the NetSuite item body from a template, the cart plan (the piece at its
// price as itself or on the CUSTOM PILLOW holder; its making beneath at $0 — yards or one unit), sold once.
import { oneOfAKindCardOf, cardReadinessOf, oneOfAKindDocOf, oneOfAKindCartPlanOf, oneOfAKindEditCardOf, oneOfAKindEditPatchOf, oneOfAKindEditableOf, oneOfAKindSoldPatchOf, oneOfAKindAvailableOf, isOneOfAKindItem, OOAK_MAKINGS } from '../src/components/Shared/oneOfAKind.js';
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; } else { fail++; console.error('  ✗', name, extra); } };
const item = (code, extra = {}) => ({ id: `ID-${code}`, legacyErpId: code, itemName: extra.name || code, netSuiteInternalId: extra.ns === undefined ? '1' : extra.ns, manufacturingSpecs: { ...(extra.specs || {}) } });
const lib = [
    item('BRIDSML', { ns: '7001' }), item('BRIDLRG', { ns: '7002' }), item('SCRAPFAB', { ns: '7003' }), item('BRIDWALLSML', { ns: '7011' }), item('BRIDWALLMED', { ns: '7012', }), item('Bridwalllrg', { ns: '' }),
    item('Bell/10F', { ns: '', specs: { productType: 'FABRIC', width: 54, customData: { convertedFrom: 'Bell/10T' } } }), item('Bell/10T', { ns: '42889', specs: { customData: { yardsPerThrow: 2 } } }),
    item('Savery/05F', { ns: '777', specs: { productType: 'FABRIC', width: 54 } }),
    item('Custom Pillow', { ns: '49702' }),
];
const by = (c) => lib.find(x => x.legacyErpId.toUpperCase() === String(c || '').toUpperCase()) || null;

// ── the card ─────────────────────────────────────────────────────────────────────────────────
const c = oneOfAKindCardOf({ id: 'c1', fileName: 'IMG_1.jpg', dataUrl: 'data:image/jpeg;base64,AA' });
ok('a fresh card: pillow, bin SHOW, no making, no NetSuite item field', c.kind === 'PILLOW' && c.bin === 'SHOW' && c.createInNetSuite === undefined && c.making.type === '');
ok('empty card refuses by name: code, price, making', (() => { const r = cardReadinessOf(c, { findByCode: by }); return !r.ok && r.errors.map(e => e.code).join(',') === 'NO_CODE,NO_PRICE,NO_MAKING'; })());
const good = { ...c, code: 'SHOW-0412', name: 'Bell stripe lumbar', price: '350', making: { type: 'NONINV', noninvCode: 'bridsml' } };
ok('code + price + a pillow making = ready', cardReadinessOf(good, { findByCode: by }).ok);
ok('a wall making on a pillow refuses; a wall card takes it', !cardReadinessOf({ ...good, making: { type: 'NONINV', noninvCode: 'BRIDWALLSML' } }, { findByCode: by }).ok && cardReadinessOf({ ...good, kind: 'WALL', making: { type: 'NONINV', noninvCode: 'BRIDWALLSML' } }, { findByCode: by }).ok);
ok('a making not in the library / with no NetSuite id refuses by name', cardReadinessOf({ ...good, making: { type: 'NONINV', noninvCode: 'BRIDLRG2' } }, { findByCode: by }).errors[0].code === 'MAKING_NOT_FOR_KIND' && cardReadinessOf({ ...good, kind: 'WALL', making: { type: 'NONINV', noninvCode: 'BRIDWALLLRG' } }, { findByCode: by }).errors[0].code === 'MAKING_NO_NS_ID');
ok('a fabric making needs the fabric and its yards', cardReadinessOf({ ...good, making: { type: 'FABRIC', fabricCode: 'Bell/10F', yards: '' } }, { findByCode: by }).errors[0].code === 'NO_YARDS' && cardReadinessOf({ ...good, making: { type: 'FABRIC', fabricCode: 'Bell/10F', yards: '1.5' } }, { findByCode: by }).ok);
ok('a taken code refuses', cardReadinessOf(good, { findByCode: by, takenCodes: ['show-0412'] }).errors[0].code === 'DUPLICATE_CODE');
ok('no photo is a warning, not a refusal', cardReadinessOf({ ...good, dataUrl: '' }, { findByCode: by }).ok && cardReadinessOf({ ...good, dataUrl: '' }, { findByCode: by }).warnings.some(w => /no photo/.test(w)));

// ── the record ───────────────────────────────────────────────────────────────────────────────
const d = oneOfAKindDocOf({ ...good, making: { type: 'FABRIC', fabricCode: 'bell/10f', yards: '1.25' }, sizeKey: '20x12' }, { id: 'UNIQUITY-OOAK-1-0', by: 'Liz', at: 5, nsId: '', photoUrl: 'https://x/p.jpg', thumbUrl: 'https://x/t.jpg' });
ok('the library record: the tag as the code, PILLOW, stocked, bin SHOW, the price, the photo as a GALLERY picture', d.legacyErpId === 'SHOW-0412' && d.manufacturingSpecs.productType === 'PILLOW' && d.manufacturingSpecs.isStocked === true && d.manufacturingSpecs.homeBin === 'SHOW' && d.manufacturingSpecs.basePrice === 350 && d.finalImageUrl === 'https://x/p.jpg' && d.imageSource === 'GALLERY' && !d.netSuiteInternalId);
ok('its making: the fabric in yards, AVAILABLE, who and when', d.manufacturingSpecs.customData.oneOfAKind.making.fabricCode === 'BELL/10F' && d.manufacturingSpecs.customData.oneOfAKind.making.yards === 1.25 && d.manufacturingSpecs.customData.oneOfAKind.status === 'AVAILABLE' && d.manufacturingSpecs.customData.oneOfAKind.importedBy === 'Liz' && d.manufacturingSpecs.customData.oneOfAKind.sizeKey === '20x12');
const w = oneOfAKindDocOf({ ...good, kind: 'WALL', making: { type: 'NONINV', noninvCode: 'bridwallmed' } }, { id: 'X', nsId: '9009' });
ok('wall art: WALL ART, the making × 1, the NetSuite id when created', w.manufacturingSpecs.productType === 'WALL ART' && w.manufacturingSpecs.customData.oneOfAKind.making.noninvCode === 'BRIDWALLMED' && w.manufacturingSpecs.customData.oneOfAKind.making.each === 1 && w.netSuiteInternalId === '9009' && w.manufacturingSpecs.customData.oneOfAKind.nsCreated === true);
ok('isOneOfAKindItem / available', isOneOfAKindItem(d) && !isOneOfAKindItem(lib[0]) && oneOfAKindAvailableOf([d, w, lib[0]]).length === 2);


// ── the cart plan ────────────────────────────────────────────────────────────────────────────
const holder = by('Custom Pillow');
const p1 = oneOfAKindCartPlanOf({ item: d, findByCode: by, holder });
ok('an app-only piece sells on the CUSTOM PILLOW holder (id 49702) at its price, the tag in the via', p1.ok && p1.piece.nsId === '49702' && p1.piece.price === 350 && /SHOW-0412/.test(p1.piece.via));
ok('…its fabric making = 1.25 yd of Bell/10F, pushed as 0.625 × the throw', p1.making.uom === 'YARD' && p1.making.yards === 1.25 && p1.making.nsId === '42889' && p1.making.nsQtyFactor === 0.5 && /0\.625 × Bell\/10T/.test(p1.making.nsVia));
const p2 = oneOfAKindCartPlanOf({ item: w, findByCode: by, holder });
ok('a piece with its own NetSuite item sells as itself; a non-inventory making × 1', p2.ok && p2.piece.nsId === '9009' && p2.piece.via === '' && p2.making.uom === 'EACH' && p2.making.each === 1 && p2.making.item.legacyErpId === 'BRIDWALLMED');
const own = oneOfAKindDocOf({ ...good, making: { type: 'FABRIC', fabricCode: 'Savery/05F', yards: '2' } }, { id: 'Y' });
ok('a fabric with its own NetSuite id pushes as itself (no factor)', (() => { const p = oneOfAKindCartPlanOf({ item: own, findByCode: by, holder }); return p.ok && p.making.uom === 'YARD' && !p.making.nsQtyFactor; })());
const soldDoc = { ...d, manufacturingSpecs: { ...d.manufacturingSpecs, customData: { oneOfAKind: { ...d.manufacturingSpecs.customData.oneOfAKind, status: 'SOLD' } } } };
ok('a sold piece refuses; no holder id refuses by name', oneOfAKindCartPlanOf({ item: soldDoc, findByCode: by, holder }).errors[0].code === 'SOLD' && oneOfAKindCartPlanOf({ item: d, findByCode: by, holder: null }).errors[0].code === 'NO_NS_IDENTITY');
const sp = oneOfAKindSoldPatchOf({ soId: 'QS-1', by: 'Liz', at: 9 });
ok('the sold patch: SOLD, the SO, unstocked', sp['manufacturingSpecs.customData.oneOfAKind.status'] === 'SOLD' && sp['manufacturingSpecs.customData.oneOfAKind.soldOn'] === 'QS-1' && sp['manufacturingSpecs.isStocked'] === false);
ok('the makings lists', OOAK_MAKINGS.PILLOW.length === 3 && OOAK_MAKINGS.WALL.length === 3);
// ── editing a filed piece ─────────────────────────────────────────────────────────────────────
const ec = oneOfAKindEditCardOf(d);
ok('a filed piece becomes a card with its fields', ec && ec.code === d.legacyErpId && ec.name === d.itemName && ec.price === d.manufacturingSpecs.basePrice && ec.making.type === 'FABRIC' && ec.making.fabricCode === 'BELL/10F' && ec.making.yards === 1.25 && ec.sizeKey === '20x12' && ec.state === 'EDIT');
ok('a plain item is not editable as one', oneOfAKindEditCardOf(lib[0]) === null && !oneOfAKindEditableOf(lib[0]));
const ep = oneOfAKindEditPatchOf({ ...ec, making: { type: 'NONINV', noninvCode: 'BRIDSML', fabricCode: '', yards: '' }, price: '725', note: 'was bridlrg by mistake' }, d, { findByCode: by, by: 'stuart', at: 5000 });
ok('a fabric making → BRIDSML writes the making map whole, the price and the note, dotted for updateDoc', ep.ok && ep.patch['manufacturingSpecs.customData.oneOfAKind.making'].noninvCode === 'BRIDSML' && ep.patch['manufacturingSpecs.customData.oneOfAKind.making'].each === 1 && ep.patch['manufacturingSpecs.basePrice'] === 725 && ep.patch['manufacturingSpecs.customData.oneOfAKind.note'] === 'was bridlrg by mistake' && ep.patch['manufacturingSpecs.customData.oneOfAKind.editedBy'] === 'stuart' && ep.patch.updatedAt === 5000 && !('legacyErpId' in ep.patch));
const epF = oneOfAKindEditPatchOf({ ...ec, making: { type: 'FABRIC', fabricCode: 'Bell/10F', yards: '1.5', noninvCode: '' } }, d, { findByCode: by });
ok('back to a fabric making: the fabric and yards whole, no noninv code lingers', epF.ok && epF.patch['manufacturingSpecs.customData.oneOfAKind.making'].type === 'FABRIC' && epF.patch['manufacturingSpecs.customData.oneOfAKind.making'].yards === 1.5 && !('noninvCode' in epF.patch['manufacturingSpecs.customData.oneOfAKind.making']));
ok('a wrong making for the kind refuses', !oneOfAKindEditPatchOf({ ...ec, making: { type: 'NONINV', noninvCode: 'BRIDWALLSML' } }, d, { findByCode: by }).ok);
ok('a sold piece refuses', !oneOfAKindEditPatchOf(ec, { ...d, manufacturingSpecs: { ...d.manufacturingSpecs, customData: { oneOfAKind: { ...d.manufacturingSpecs.customData.oneOfAKind, status: 'SOLD' } } } }, { findByCode: by }).ok && !oneOfAKindEditableOf({ ...d, manufacturingSpecs: { ...d.manufacturingSpecs, customData: { oneOfAKind: { ...d.manufacturingSpecs.customData.oneOfAKind, status: 'SOLD' } } } }));

console.log(fail ? `\n❌  ${pass} passed, ${fail} failed` : `\n✅  ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
