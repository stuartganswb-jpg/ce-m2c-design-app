// Harness for Shared/blindShip.js — the blind packing list (Stuart 2026-10-08): a custom drop address prints the
// packing list in the customer's name, at every door and every printer, unless the CRM set the order to standard.
//   node scripts/blindShip.test.mjs
import { isCustomDrop, wantsStandardList, wantsBlindList, packingModeOf, isBlindShipment, packingListPatch, blindPartyOf, withBlindPacking, blindItemNoOf } from '../src/components/Shared/blindShip.js';
import { soHeaderOf, jobHeaderPatchOf } from '../src/components/Shared/salesOrderHeader.js';
import { packingListOf } from '../src/components/Shared/packingList.js';

let pass = 0, fail = 0;
const eq = (n, got, want) => {
    const g = JSON.stringify(got), w = JSON.stringify(want);
    if (g === w) { pass++; return; }
    fail++; console.log(`✗ ${n}\n    got  ${g}\n    want ${w}`);
};
const ok = (n, c) => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}`); };

const DROP = { attention: '', addressee: 'ERIN WILEY INTERIORS', addr1: '1722 CHANTILLY LANE', addr2: '', city: 'CHESTER SPRINGS', state: 'PA', zip: '19425' };
const BRIMAR = { id: 'CUST-4572', name: 'BRIMAR', portalLogoUrl: 'https://storage.example/brimar.png',
    shippingAddresses: [
        { addressBookId: '1', label: 'Warehouse', addressee: 'Brimar Receiving', attention: 'Dock 4', addr1: '900 Other Rd', city: 'Elsewhere', state: 'IL', zip: '60000' },
        { addressBookId: '2', isDefault: true, label: 'Main', addressee: 'BRIMAR', attention: 'Accounts', addr1: '28250 BALLARD DRIVE', addr2: '', city: 'Lake Forest', state: 'il', zip: '60045-4536' },
    ] };

// ── THE RULE ─────────────────────────────────────────────────────────────────────────────────────
{
    const job = { shippingMethod: 'CUSTOM', customShippingAddress: DROP };
    ok('a custom drop address is a drop shipment', isCustomDrop(job));
    ok('…and prints blind', isBlindShipment(job));
    ok('a saved address is not', !isBlindShipment({ shippingMethod: 'SAVED', shippingAddressId: '2', customShippingAddress: null }));
    ok('CUSTOM with no street is not a drop — the header itself falls back to the saved address', !isBlindShipment({ shippingMethod: 'CUSTOM', customShippingAddress: { addressee: 'Someone', addr1: '' } }));
    ok('an order with no header at all (read from NetSuite, or before the one header) is not blind', !isBlindShipment({ soId: 'SO60106' }));
    ok('nothing to hand is not blind', !isBlindShipment() && !isBlindShipment(null, undefined));
    ok('lower-case method reads the same', isBlindShipment({ shippingMethod: 'custom', customShippingAddress: DROP }));
    // A screen holds the job, the sales order, or both.
    ok('the sales order alone (Order Entry) decides', isBlindShipment({ source: 'QUICKSHIP', shippingMethod: 'CUSTOM', customShippingAddress: DROP }));
    ok('the job decides when the sales order is not to hand', isBlindShipment(null, job));
    ok('either saying CUSTOM is a drop shipment (a stale copy never un-blinds one)', isBlindShipment({ shippingMethod: 'SAVED' }, job));
    // The CRM's override.
    ok('the override prints the standard list', !isBlindShipment({ ...job, packingListStandard: true }));
    ok('…from whichever document carries it', !isBlindShipment(job, { packingListStandard: true }) && wantsStandardList(null, { packingListStandard: true }));
    ok('the override taken off again is blind again', isBlindShipment({ ...job, packingListStandard: false }));
    ok('only a true flag overrides', isBlindShipment({ ...job, packingListStandard: 'yes' }));
}
// ── THE CRM'S CHOICE GOES BOTH WAYS, ON ANY ORDER ("print standard or blind on crm") ──────────────
{
    const drop = { shippingMethod: 'CUSTOM', customShippingAddress: DROP };
    const saved = { shippingMethod: 'SAVED', shippingAddressId: '2' };
    eq('nothing chosen: the address decides', [packingModeOf(drop), packingModeOf(saved), isBlindShipment(drop), isBlindShipment(saved)], ['AUTO', 'AUTO', true, false]);
    eq('BLIND chosen: a saved address prints blind too', [packingModeOf({ ...saved, packingListBlind: true }), isBlindShipment({ ...saved, packingListBlind: true })], ['BLIND', true]);
    eq('…and an order with no header at all', isBlindShipment({ soId: 'SO60106', packingListBlind: true }), true);
    eq('STANDARD chosen: a drop address prints standard', [packingModeOf({ ...drop, packingListStandard: true }), isBlindShipment({ ...drop, packingListStandard: true })], ['STANDARD', false]);
    eq('the choice is read from whichever document carries it', [isBlindShipment(saved, { packingListBlind: true }), isBlindShipment(drop, { packingListStandard: true }), wantsBlindList(null, { packingListBlind: true })], [true, false, true]);
    eq('two copies that disagree (one stale): blind wins', [packingModeOf({ packingListBlind: true }, { packingListStandard: true }), isBlindShipment({ ...saved, packingListStandard: true }, { packingListBlind: true })], ['BLIND', true]);
    ok('only a true flag counts', !isBlindShipment({ ...saved, packingListBlind: 'yes' }) && packingModeOf({ packingListBlind: 1 }) === 'AUTO');
    eq('what the CRM writes: both flags, together, with who and when', [packingListPatch('BLIND', ' Stuart ', 123), packingListPatch('standard', '', 5), packingListPatch('AUTO', 'x', 7)], [
        { packingListBlind: true, packingListStandard: false, packingListSetAt: 123, packingListSetBy: 'Stuart' },
        { packingListBlind: false, packingListStandard: true, packingListSetAt: 5, packingListSetBy: '' },
        { packingListBlind: false, packingListStandard: false, packingListSetAt: 7, packingListSetBy: 'x' },
    ]);
    eq('an unknown choice is the address rule', packingModeOf(packingListPatch('whatever')), 'AUTO');
    // Each choice written over the other leaves exactly one in force — on the job, then on the header built from it.
    const afterBlind = { ...drop, ...packingListPatch('STANDARD'), ...packingListPatch('BLIND') };
    const afterAuto = { ...saved, ...packingListPatch('BLIND'), ...packingListPatch('AUTO') };
    eq('STANDARD then BLIND is blind; BLIND then back to the address is the address', [packingModeOf(afterBlind), packingModeOf(afterAuto), isBlindShipment(afterAuto)], ['BLIND', 'AUTO', false]);
    const hdr = soHeaderOf({ door: 'CRM', job: { id: 'J1', ...saved, ...packingListPatch('BLIND') }, customer: BRIMAR });
    eq('both flags ride the header from the job, so a sales order made after the choice has it', [hdr.packingListBlind, hdr.packingListStandard, isBlindShipment(hdr)], [true, false, true]);
    ok('forced blind builds the same form data', withBlindPacking({ billTo: ['BRIMAR'], packing: { lines: [] } }, { docs: [{ ...saved, packingListBlind: true }], customer: BRIMAR }).blind.from.length === 3);
}
// ── BOTH DOORS WRITE THE SAME KEYS — the header module's own output is what the rule reads ──────
{
    const cpq = soHeaderOf({ door: 'CPQ', job: { id: 'J1', customer: { id: 'CUST-4572', name: 'BRIMAR' }, shippingMethod: 'CUSTOM', customShippingAddress: DROP }, customer: BRIMAR });
    const oe = soHeaderOf({ door: 'QUICKSHIP', form: { customerId: 'CUST-4572', customerName: 'BRIMAR', ship: { method: 'CUSTOM', custom: DROP }, lines: [] }, customer: BRIMAR });
    const saved = soHeaderOf({ door: 'QUICKSHIP', form: { ship: { method: 'SAVED', addressId: '2' }, lines: [] }, customer: BRIMAR });
    eq('CPQ, Order Entry, and a saved address through the one header', [isBlindShipment(cpq), isBlindShipment(oe), isBlindShipment(saved)], [true, true, false]);
    eq('the drop address is what both ship to', [cpq.shipTo, oe.shipTo], [['ERIN WILEY INTERIORS', '1722 CHANTILLY LANE', 'CHESTER SPRINGS, PA 19425'], ['ERIN WILEY INTERIORS', '1722 CHANTILLY LANE', 'CHESTER SPRINGS, PA 19425']]);
    // The CRM header edit keeps a drop a drop, and turns one off.
    eq('the CRM header edit: custom stays a drop, saved stops being one', [
        isBlindShipment(jobHeaderPatchOf({ shippingMethod: 'CUSTOM', customShippingAddress: DROP })),
        isBlindShipment(jobHeaderPatchOf({ shippingMethod: 'SAVED', shippingAddressId: '2', customShippingAddress: DROP })),
    ], [true, false]);
    // The override rides from the job to the sales order when the header is rebuilt.
    const withFlag = (v) => soHeaderOf({ door: 'CRM', job: { id: 'J1', shippingMethod: 'CUSTOM', customShippingAddress: DROP, ...(v === undefined ? {} : { packingListStandard: v }) }, customer: BRIMAR });
    eq('the override rides the header from the job', [withFlag(true).packingListStandard, withFlag(false).packingListStandard, 'packingListStandard' in withFlag(undefined)], [true, false, false]);
    ok('…so a sales order made after the tick prints standard', !isBlindShipment(withFlag(true)));
    ok('an Order Entry header never writes the key (its sales order keeps what the CRM set)', !('packingListStandard' in oe));
}
// ── WHO IT IS FROM ───────────────────────────────────────────────────────────────────────────────
{
    eq('the customer: their logo, their name, their DEFAULT saved address — street and town only',
        blindPartyOf(BRIMAR, 'ignored'), { name: 'BRIMAR', logoUrl: 'https://storage.example/brimar.png', from: ['BRIMAR', '28250 BALLARD DRIVE', 'Lake Forest, IL 60045-4536'] });
    eq('no default: the first saved address', blindPartyOf({ name: 'CALICO', shippingAddresses: [{ addr1: '1 First St', addr2: 'Suite 2', city: 'Town', state: 'PA', zip: '19000' }] }).from, ['CALICO', '1 First St', 'Suite 2', 'Town, PA 19000']);
    eq('no logo and no address on file: their name in type, nothing invented', blindPartyOf({ name: 'NEWCO' }), { name: 'NEWCO', logoUrl: '', from: ['NEWCO'] });
    eq('the record not to hand: the name the order carries — never ours', blindPartyOf(null, 'FABRICUT'), { name: 'FABRICUT', logoUrl: '', from: ['FABRICUT'] });
    eq('a saved entry with no street adds nothing', blindPartyOf({ name: 'X', shippingAddresses: [{ isDefault: true, label: 'Will call', addr1: '' }] }).from, ['X']);
}
// ── THE FORM DATA ────────────────────────────────────────────────────────────────────────────────
{
    const data = { billTo: ['BRIMAR'], shipTo: ['ERIN WILEY INTERIORS'], po: 'PO-1', packing: { lines: [] } };
    const job = { shippingMethod: 'CUSTOM', customShippingAddress: DROP };
    const blind = withBlindPacking(data, { docs: [job], customer: BRIMAR, name: 'BRIMAR' });
    eq('a drop shipment: the same data, plus who it is from', [blind.blind.name, blind.blind.from.length, blind.billTo, blind.shipTo, blind.po], ['BRIMAR', 3, ['BRIMAR'], ['ERIN WILEY INTERIORS'], 'PO-1']);
    ok('the data handed in is not changed', !('blind' in data));
    ok('not a drop shipment: the data comes back untouched', withBlindPacking(data, { docs: [{ shippingMethod: 'SAVED' }], customer: BRIMAR }) === data);
    ok('the override: untouched', withBlindPacking(data, { docs: [{ ...job, packingListStandard: true }], customer: BRIMAR }) === data);
    ok('no data, no crash', withBlindPacking(null, { docs: [job] }) === null);
    ok('the customer record could not be read: still blind, in their name', withBlindPacking(data, { docs: [job], customer: null, name: 'BRIMAR' }).blind.from.join() === 'BRIMAR');
}
// ── THEIR ITEM NUMBERS ───────────────────────────────────────────────────────────────────────────
{
    const pl = packingListOf({
        ordered: [
            { legacyErpId: 'H1-1BBS', clientSku: 'H3654F', name: 'Brass bracket', qty: 2 },
            { legacyErpId: 'H1-1KF', name: 'Knob finial', qty: 1 },                           // no number of theirs
            { legacyErpId: 'H1-1EC', clientSku: 'h1-1ec', name: 'End cap', qty: 1 },          // "theirs" is just ours again
        ],
        packDocs: [],
    });
    eq('a line carries their number beside ours only when it has one', pl.lines.map(l => [l.code, l.custCode]), [['H1-1BBS', 'H3654F'], ['H1-1KF', undefined], ['H1-1EC', undefined]]);
    eq('a blind list prints theirs, else ours', pl.lines.map(blindItemNoOf), ['H3654F', 'H1-1KF', 'H1-1EC']);
    eq('nothing to print for nothing', blindItemNoOf(null), '');
}

console.log(`${fail ? '✗' : '✓'} blindShip: ${pass} passed${fail ? `, ${fail} FAILED` : ''}`);
process.exit(fail ? 1 : 0);
