// The Fulfilment tab's rules.   node scripts/fulfilment.test.mjs
import {
  isReadyToShip, fulfilmentQueueOf, recentlyShippedOf, shipToOf, addressErrors, boxDims, packagesFromPack,
  blankPackage, packageErrors, rateOf, sortedRates, shipPatchOf, voidPatchOf, nsShipPayloadOf, labelDocHtml, boxSizeLabel,
  shipmentPackagesOf, shippedBoxesOf, rideAlongPatchOf, voidEffectsOf, ownTrackingOf, soAfterVoid,
} from '../src/components/Shared/fulfilment.js';
import { boxShipStampsOf } from '../src/components/Shared/orderBoxes.js';
let pass = 0, fail = 0;
const eq = (n, got, want) => { const g = JSON.stringify(got), w = JSON.stringify(want); if (g === w) { pass++; return; } fail++; console.log(`✗ ${n}\n    got  ${g}\n    want ${w}`); };
const ok = (n, c) => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}`); };

// queue
const packed = { id: 'a', packStatus: 'Packed', packedAt: 2 };
ok('packed is ready', isReadyToShip(packed));
ok('unpacked is not', !isReadyToShip({ packStatus: 'Packing' }));
ok('put-away is not', !isReadyToShip({ ...packed, packMode: 'PUTAWAY' }));
ok('put-away by bin is not', !isReadyToShip({ ...packed, putawayBin: 'A-1' }));
ok('shipped is not', !isReadyToShip({ ...packed, shippedAt: 5 }));
ok('closed is not', !isReadyToShip({ ...packed, currentPhase: 'Closed' }));
ok('deleted is not', !isReadyToShip({ ...packed, deleted: true }));
ok('voided (shippedAt null) is ready again', isReadyToShip({ ...packed, shippedAt: null }));
eq('queue oldest pack first', fulfilmentQueueOf([{ ...packed, id: 'b', packedAt: 9 }, packed, { id: 'c' }]).map((d) => d.id), ['a', 'b']);
eq('queue tolerates garbage', fulfilmentQueueOf(null), []);
eq('recently shipped window', recentlyShippedOf([{ id: 'x', shippedAt: 100 }, { id: 'y', shippedAt: 100 + 86400000 * 5 }], 100 + 86400000 * 5, 3).map((d) => d.id), ['y']);

// ship-to
const cust = { shippingAddresses: [
  { addressBookId: '1', label: 'Warehouse', addressee: 'Fabricut', addr1: '9303 E 46th St', city: 'Tulsa', state: 'ok', zip: '74145' },
  { addressBookId: '2', isDefault: true, addressee: 'Fabricut HQ', addr1: '1 Main', city: 'Tulsa', state: 'OK', zip: '74101' },
] };
eq('custom drop-ship wins', shipToOf({ shippingMethod: 'CUSTOM', customShippingAddress: { attention: 'Jo', addressee: 'Client', addr1: '5 Elm', city: 'Aspen', state: 'co', zip: '81611' }, shippingAddressId: '1' }, cust).address.state, 'CO');
eq('saved address chosen on the order', shipToOf({ shippingAddressId: '1' }, cust).address.addr1, '9303 E 46th St');
eq('default when none chosen', shipToOf({}, cust).address.addressee, 'Fabricut HQ');
eq('label stands in for addressee', shipToOf({ shippingAddressId: '9' }, { shippingAddresses: [{ label: 'Site', addr1: 'x', city: 'y', state: 'z', zip: '1' }] }).address.addressee, 'Site');
eq('no address → blank + says so', shipToOf({}, null).source, 'no address on file — enter it');
eq('custom without street falls back', shipToOf({ shippingMethod: 'CUSTOM', customShippingAddress: { addr1: '' } }, cust).address.addressee, 'Fabricut HQ');
eq('address errors named', addressErrors({ addr1: '1 Main' }), ['name or company', 'city', 'state', 'zip']);
eq('complete address no errors', addressErrors(shipToOf({}, cust).address), []);

// packages
eq('box dims longest first', boxDims({ w: 6, h: 4, d: 48 }), { length: '48', width: '6', height: '4' });
eq('2-D box leaves height blank', boxDims({ w: 10, h: 12 }), { length: '12', width: '10', height: '' });
const std = [{ name: 'Small 12', w: 12, h: 12, d: 12 }, { name: 'Pole 96', w: 6, h: 6, d: 96 }];
eq('one package per chosen box', packagesFromPack({ SMALL: 'Small 12', POLE: 'Pole 96' }, std).map((p) => [p.slot, p.length, p.fromStandard]), [['SMALL', '12', true], ['POLE', '96', true]]);
eq('unknown box starts blank, not guessed', packagesFromPack({ SMALL: 'Random box' }, std)[0], { boxName: 'Random box', slot: 'SMALL', length: '', width: '', height: '', weight: '', fromStandard: false });
eq('no boxes recorded → one blank custom package', packagesFromPack({}, std), [blankPackage()]);
eq('package errors name the field', packageErrors([{ length: 12, width: 12, height: 0, weight: '' }]), ['Package 1: height (inches, up to 108)', 'Package 1: weight (lb, up to 150)']);
eq('valid package', packageErrors([{ length: 30, width: 10, height: 8, weight: 12.5 }]), []);
eq('over-limit weight', packageErrors([{ length: 30, width: 10, height: 8, weight: 151 }]), ['Package 1: weight (lb, up to 150)']);
eq('no packages', packageErrors([]), ['Add at least one package.']);

// rates
const svc = [{ code: '01', published: 90, negotiated: 60 }, { code: '03', published: 20, negotiated: 14 }, { code: '02', published: 40, negotiated: null }];
eq('negotiated view falls back to published', rateOf(svc[2], 'negotiated'), 40);
eq('published view', rateOf(svc[0], 'published'), 90);
eq('sorted cheapest first (negotiated)', sortedRates(svc, 'negotiated').map((s) => s.code), ['03', '02', '01']);
eq('sorted cheapest first (published)', sortedRates(svc, 'published').map((s) => s.code), ['03', '02', '01']);

// stamps
const result = { environment: 'PRODUCTION', shipmentId: '1Z999', serviceCode: '03', serviceName: 'Ground', published: 20, negotiated: 14,
  packages: [{ trackingNumber: '1ZAAA' }, { trackingNumber: '1ZBBB' }] };
const pkgs = [{ boxName: 'Small 12', length: '12', width: '12', height: '12', weight: '5' }, { boxName: 'Pole 96', length: '96', width: '6', height: '6', weight: '9' }];
const patch = shipPatchOf({ result, packages: pkgs, labelUrls: ['u1', 'u2'], by: 'Andrea', now: 1000 });
eq('tracking numbers stamped', patch.trackingNumbers, ['1ZAAA', '1ZBBB']);
eq('shippedAt stamped', [patch.shippedAt, patch.shippedBy, patch.shipCarrier], [1000, 'Andrea', 'UPS']);
eq('package row carries its tracking + label', patch.shipPackages[1], { boxName: 'Pole 96', length: 96, width: 6, height: 6, weight: 9, trackingNumber: '1ZBBB', labelUrl: 'u2' });
eq('charges kept', patch.shipCharge, { published: 20, negotiated: 14 });
const v = voidPatchOf({ by: 'Eric', now: 2000, prior: patch });
eq('void clears shipped', [v.shippedAt, v.trackingNumbers, v.shipmentId], [null, [], '']);
eq('void keeps history', v.shipVoided, [{ shipmentId: '1Z999', trackingNumbers: ['1ZAAA', '1ZBBB'], voidedAt: 2000, voidedBy: 'Eric' }]);
eq('second void appends', voidPatchOf({ now: 3, prior: { ...patch, shipVoided: v.shipVoided } }).shipVoided.length, 2);
const ns = nsShipPayloadOf(patch);
eq('netsuite status shipped', ns.shipStatus, { id: 'C' });
eq('netsuite one package line per box', ns.package.items.map((i) => [i.packageTrackingNumber, i.packageWeight]), [['1ZAAA', 5], ['1ZBBB', 9]]);
ok('netsuite descr capped at 60', ns.package.items.every((i) => i.packageDescr.length <= 60));

// box size, written the UPS way
eq('box size L×W×H (L = d)', boxSizeLabel({ w: 6, h: 4, d: 48 }), '48" × 6" × 4" (L×W×H)');
eq('missing depth shows a dash', boxSizeLabel({ w: 12, h: 10 }), '— × 12" × 10" (L×W×H)');
eq('no box', boxSizeLabel(null), '— × — × — (L×W×H)');

// label
ok('label doc is 4x6', labelDocHtml(['data:image/gif;base64,AAA']).includes('size:4in 6in'));
ok('one page per label', labelDocHtml(['a', 'b']).split('class="pg"').length === 3);
ok('label src escaped', !labelDocHtml(['x" onerror="y']).includes('" onerror="'));

// ── ONE PACKAGE PER NUMBERED BOX — AND A BOX SHIPS ONCE (Stuart 2026-10-06) ─────────────────────────────────
{
  const std = [{ id: 's', name: 'Small Box A', w: 8, h: 6, d: 12 }, { id: 't', name: 'Tube 10ft', w: 4, h: 4, d: 120 }];
  const T = (no, qty) => ({ at: 1, by: 'Sandra', qty, boxes: [{ no, qty }] });
  // SO60831: document A (small parts in Box 1 and 3), document B (a finial in Box 1, the pole in Box 2).
  const A = { id: 'A', packStatus: 'Packed', packBoxes: { SMALL: 'Small Box A', POLE: '' }, packedLines: { L0: { at: 1, by: 'S', qty: 48, boxes: [{ no: 1, qty: 30 }, { no: 3, qty: 18 }] }, L1: T(1, 1) } };
  const B = { id: 'B', packStatus: 'Packed', packBoxes: { SMALL: 'Small Box A', POLE: 'Tube 10ft' }, packedLines: { L0: T(1, 2), 'POLE-0': T(2, 1), 'POLE-0-R0': { at: 1, by: 'S', qty: 1, withPole: 'POLE-0' } } };
  let boxes = [{ no: 1, type: 'Small Box A', by: 'S', at: 1 }, { no: 2, type: 'Tube 10ft', by: 'S', at: 2 }, { no: 3, type: 'Small Box A', by: 'S', at: 3 }];

  let sp = shipmentPackagesOf({ doc: A, boxes, stdBoxes: std });
  eq('a document ships the boxes ITS pieces are in — one package each, by number', sp.packages.map((p) => `Box ${p.boxNo} ${p.boxName} ${p.length}x${p.width}x${p.height} ${p.fromStandard}`), ['Box 1 Small Box A 12x8x6 true', 'Box 3 Small Box A 12x8x6 true']);
  eq('…nothing shipped yet', [sp.already, sp.numbered, sp.rides], [[], true, false]);
  eq('a box type with no standard box on file starts blank, still its own package', shipmentPackagesOf({ doc: A, boxes: [{ no: 1, type: 'Odd crate' }, { no: 3, type: '' }], stdBoxes: std }).packages.map((p) => `${p.boxNo}:${p.boxName}:${p.length}`), ['1:Odd crate:', '3:Custom box:']);
  const legacy = { id: 'L', packStatus: 'Packed', packBoxes: { SMALL: 'Small Box A', POLE: 'Tube 10ft' }, packedLines: { L0: { at: 1, by: 'S', qty: 4 } } };
  sp = shipmentPackagesOf({ doc: legacy, boxes: [], stdBoxes: std });
  eq('a document packed BEFORE box numbers: the two box types it recorded, as before', [sp.numbered, sp.packages.map((p) => `${p.slot}:${p.boxName}`), sp.packages.some((p) => p.boxNo)], [false, ['SMALL:Small Box A', 'POLE:Tube 10ft'], false]);

  // A ships: Box 1 and Box 3 go out.
  const pkgs = shipmentPackagesOf({ doc: A, boxes, stdBoxes: std }).packages.map((p, i) => ({ ...p, weight: String(5 + i) }));
  const result = { shipmentId: '1ZSHIPA', serviceCode: '03', serviceName: 'Ground', environment: 'PRODUCTION', negotiated: 20, published: 30, packages: [{ trackingNumber: '1ZA1' }, { trackingNumber: '1ZA3' }] };
  const patchA = shipPatchOf({ result, packages: pkgs, labelUrls: ['u1', 'u3'], by: 'Eric', now: 100 });
  eq('the shipment record names each box', patchA.shipPackages.map((p) => `Box ${p.boxNo} ${p.trackingNumber} ${p.weight}lb ${p.labelUrl}`), ['Box 1 1ZA1 5lb u1', 'Box 3 1ZA3 6lb u3']);
  eq('the boxes this shipment sent', shippedBoxesOf(patchA).map((b) => `${b.no}:${b.trackingNumber}:${b.weight}`), ['1:1ZA1:5', '3:1ZA3:6']);
  boxes = boxShipStampsOf(boxes, shippedBoxesOf(patchA), { shipmentId: patchA.shipmentId, shipService: patchA.shipService, by: 'Eric', now: 100, withRef: 'WO-SO60831-EP5', withDocId: 'A' });
  eq('the order\'s boxes carry their tracking number', boxes.map((b) => `${b.no}:${b.trackingNumber || '-'}:${b.shippedWith || '-'}`), ['1:1ZA1:WO-SO60831-EP5', '2:-:-', '3:1ZA3:WO-SO60831-EP5']);
  ok('…and nothing else about a box is lost', boxes[0].type === 'Small Box A' && boxes[0].by === 'S' && boxes[1].shippedAt === undefined);

  // B ships next: Box 1 already left — only Box 2 is bought a label.
  sp = shipmentPackagesOf({ doc: { ...B }, boxes, stdBoxes: std });
  eq('a box ships ONCE: the sibling is offered only the box still here', [sp.packages.map((p) => p.boxNo), sp.already.map((a) => `${a.no}:${a.trackingNumber}:${a.shippedWith}`), sp.rides], [[2], ['1:1ZA1:WO-SO60831-EP5'], false]);
  const patchB = shipPatchOf({ result: { shipmentId: '1ZSHIPB', serviceName: 'Ground', environment: 'PRODUCTION', packages: [{ trackingNumber: '1ZB2' }] }, packages: sp.packages.map((p) => ({ ...p, weight: '9' })), labelUrls: ['u2'], by: 'Eric', now: 200, already: sp.already });
  eq('…and carries BOTH tracking numbers — every box its pieces travel in', [patchB.trackingNumbers, patchB.shipPackages.map((p) => `Box ${p.boxNo}${p.shippedEarlier ? ' earlier' : ''} ${p.trackingNumber}`)], [['1ZA1', '1ZB2'], ['Box 1 earlier 1ZA1', 'Box 2 1ZB2']]);
  eq('…but stamps only the box it sent', shippedBoxesOf(patchB).map((b) => b.no), [2]);
  eq('NetSuite gets a package line per tracking number, with real weights', nsShipPayloadOf(patchB).package.items.map((i) => `${i.packageTrackingNumber}:${i.packageWeight}`), ['1ZA1:5', '1ZB2:9']);
  ok('a second stamp never overwrites a shipped box', boxShipStampsOf(boxes, [{ no: 1, trackingNumber: 'OTHER' }], { shipmentId: 'X' })[0].trackingNumber === '1ZA1');

  // C — a document whose only box already left: nothing to buy.
  const C = { id: 'C', packStatus: 'Packed', packedLines: { L0: T(1, 4) } };
  sp = shipmentPackagesOf({ doc: C, boxes, stdBoxes: std });
  eq('every box already shipped → it RIDES: no package to buy', [sp.packages.length, sp.rides, sp.already.map((a) => a.no)], [0, true, [1]]);
  const ride = rideAlongPatchOf({ already: sp.already, by: 'Eric', now: 300 });
  eq('marked shipped IN that box — its tracking, no shipment of its own', [ride.shippedAt, ride.shipmentId, ride.trackingNumbers, ride.shipService, ride.shippedInBoxes, ride.shipPackages.map((p) => p.labelUrl)], [300, '', ['1ZA1'], 'Ground', [1], ['']]);
  ok('…which takes it out of the ship queue', !isReadyToShip({ ...C, ...ride }));

  // D — voiding A's shipment.
  const shippedA = { ...A, ...patchA }, shippedB = { ...B, ...patchB }, rodeC = { ...C, ...ride };
  boxes = boxShipStampsOf(boxes, shippedBoxesOf(patchB), { shipmentId: '1ZSHIPB', shipService: 'Ground', by: 'Eric', now: 200, withRef: 'WO-B', withDocId: 'B' });
  const v = voidEffectsOf({ doc: shippedA, boxes, siblings: [shippedA, shippedB, rodeC, legacy], by: 'Eric', now: 400 });
  eq('its boxes are back to packed-and-waiting; the sibling\'s box is untouched', v.boxes.map((b) => `${b.no}:${b.trackingNumber || '-'}:${b.shippedAt || '-'}`), ['1:-:-', '2:1ZB2:200', '3:-:-']);
  eq('a box back from a void keeps what it is', [v.boxes[0].type, v.boxes[0].by, v.changed], ['Small Box A', 'S', true]);
  eq('the document that rode in that box returns to the queue; the one with its own shipment keeps it, less that box', v.siblings.map((x) => `${x.id}:${x.kind}`), ['B:TRIM', 'C:RETURN']);
  eq('…B keeps Box 2', [v.siblings[0].patch.trackingNumbers, v.siblings[0].patch.shipPackages.map((p) => p.boxNo)], [['1ZB2'], [2]]);
  ok('…C is ready to ship again, with the void on its record', isReadyToShip({ ...rodeC, ...v.siblings[1].patch }) && v.siblings[1].patch.shipVoided[0].trackingNumbers[0] === '1ZA1');
  eq('after the void A is offered its boxes again', shipmentPackagesOf({ doc: { ...shippedA, ...voidPatchOf({ prior: shippedA }) }, boxes: v.boxes, stdBoxes: std }).packages.map((p) => p.boxNo), [1, 3]);
  eq('voiding a shipment made before box numbers touches no box and no sibling', [voidEffectsOf({ doc: { id: 'L', shipmentId: 'OLD' }, boxes, siblings: [shippedB] }).changed, voidEffectsOf({ doc: { id: 'L', shipmentId: 'OLD' }, boxes, siblings: [shippedB] }).siblings], [false, []]);
  eq('a document with no shipment id voids nothing', voidEffectsOf({ doc: { id: 'Z', shipmentId: '' }, boxes, siblings: [shippedB] }).changed, false);

  // ── THE SALES ORDER HOLDS EVERY TRACKING NUMBER ───────────────────────────────────────────────────────────
  const added = (so, patch) => [...new Set([...(so.trackingNumbers || []), ...patch.trackingNumbers])];   // what arrayUnion does on the server
  let so = { id: 'SO60831' };
  so = { ...so, trackingNumbers: added(so, patchA) };
  so = { ...so, trackingNumbers: added(so, patchB), shippedAt: 200 };
  eq('two documents shipped → the order holds all three numbers, each once', so.trackingNumbers, ['1ZA1', '1ZA3', '1ZB2']);
  eq('what a shipment itself bought — not a box that left earlier on a sibling\'s', [ownTrackingOf(shippedA), ownTrackingOf(shippedB), ownTrackingOf(rodeC)], [['1ZA1', '1ZA3'], ['1ZB2'], []]);
  eq('a shipment made before box numbers: its own list', ownTrackingOf({ trackingNumbers: ['1ZOLD', '1ZOLD', ''] }), ['1ZOLD']);
  let after = soAfterVoid({ so, doc: shippedB, siblings: [shippedA, shippedB, rodeC] });
  eq('voiding B takes away ONLY B\'s number — the order is still shipped', after, { trackingNumbers: ['1ZA1', '1ZA3'] });
  after = soAfterVoid({ so, doc: shippedA, siblings: [shippedA, shippedB, rodeC], returnedIds: ['C'] });
  eq('voiding A takes away A\'s two; B\'s stays', after, { trackingNumbers: ['1ZB2'] });
  eq('voiding the only shipment left → the order reads un-shipped', soAfterVoid({ so: { trackingNumbers: ['1ZB2'], shippedAt: 200 }, doc: shippedB, siblings: [shippedB] }), { trackingNumbers: [], shippedAt: null });
  eq('an order whose list was OVERWRITTEN before today comes out whole: the other document\'s number is put back', soAfterVoid({ so: { trackingNumbers: ['1ZB2'] }, doc: shippedB, siblings: [{ id: 'OLD', shippedAt: 5, trackingNumbers: ['1ZOLD'] }, shippedB] }), { trackingNumbers: ['1ZOLD'] });
  eq('a number NetSuite put on the order (the tracking pull) is not this void\'s to remove', soAfterVoid({ so: { trackingNumbers: ['1ZNS', '1ZB2'] }, doc: shippedB, siblings: [] }), { trackingNumbers: ['1ZNS'] });
}


console.log(`fulfilment: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
