// The Fulfilment tab's rules.   node scripts/fulfilment.test.mjs
import {
  isReadyToShip, fulfilmentQueueOf, recentlyShippedOf, shipToOf, addressErrors, boxDims, packagesFromPack,
  blankPackage, packageErrors, rateOf, sortedRates, shipPatchOf, voidPatchOf, nsShipPayloadOf, labelDocHtml, boxSizeLabel,
} from '../src/components/Shared/fulfilment.js';
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

console.log(`fulfilment: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
