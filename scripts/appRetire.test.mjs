// Harness for Shared/appRetire.js — retiring a record NetSuite has no item for.
//   node scripts/appRetire.test.mjs
//
// Stuart 2026-10-05: "can you retire the 9" — the nine 1-3/8" traverse arm-and-plate records, app-made, no NetSuite item.

import { isAppOnlyItem, canRetireInApp, isAppRetired } from '../src/components/Shared/appRetire.js';

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}`); };

// The records as the library carried them that day.
const kit = { id: 'CE-INV-2347', legacyErpId: 'H1-138TRV-VE', partClass: 'Kit', manufacturingSpecs: { kitComponents: [{ partId: 'A' }, { partId: 'B' }] } };
const kitNoId = { ...kit, netSuiteInternalId: '' };
const arm = { id: 'CE-INV-62502', legacyErpId: 'H1-138TRVEBA', netSuiteInternalId: '62502', manufacturingSpecs: {} };
const armNum = { ...arm, netSuiteInternalId: 62502 };
const oldNs = { id: 'X', legacyErpId: 'H1-OLD', netSuiteInternalId: '777', manufacturingSpecs: { isRetired: true } };

ok('a record with no NetSuite id is app-only', isAppOnlyItem(kit));
ok('…a blank id is no id', isAppOnlyItem(kitNoId) && isAppOnlyItem({ ...kit, netSuiteInternalId: '  ' }) && isAppOnlyItem({ ...kit, netSuiteInternalId: null }));
ok('a NetSuite-linked record is not — text or number id', !isAppOnlyItem(arm) && !isAppOnlyItem(armNum));
ok('nothing is not an item', !isAppOnlyItem(null) && !isAppOnlyItem(undefined));

ok('an app-only record may be retired from the Library', canRetireInApp(kit));
ok('a NetSuite-linked record may not — NetSuite owns its flag', !canRetireInApp(arm));
ok('a record not saved yet is not offered it', !canRetireInApp({ ...kit, isNew: true }));

ok('not retired until the flag is set', !isAppRetired(kit));
ok('retired once it is', isAppRetired({ ...kit, manufacturingSpecs: { ...kit.manufacturingSpecs, isRetired: true } }));
ok('only TRUE retires — a stray value does not', !isAppRetired({ ...kit, manufacturingSpecs: { isRetired: 'true' } }) && !isAppRetired({ ...kit, manufacturingSpecs: { isRetired: false } }));
ok('an item NetSuite retired is not "retired here" — it stays out of the Library\'s Retired view', !isAppRetired(oldNs));
ok('a record with no specs is not retired', !isAppRetired({ id: 'Z' }));

console.log(`\n${fail === 0 ? '✅' : '❌'}  ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
