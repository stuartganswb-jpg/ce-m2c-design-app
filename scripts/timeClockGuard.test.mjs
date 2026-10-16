// ⏱ The time clock's two locks — the shop network and an enrolled tablet (Stuart 2026-10-16).   node scripts/timeClockGuard.test.mjs
import { createRequire } from 'module';
import crypto from 'crypto';
import { clockKeyOf as appClockKeyOf } from '../src/components/Shared/timeClock.js';
const require = createRequire(import.meta.url);
const G = require('../functions/timeClockGuard.js');

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}`); };
const eq = (n, a, b) => ok(`${n} — got ${JSON.stringify(a)}`, JSON.stringify(a) === JSON.stringify(b));
const req = (xff, ip = '169.254.8.1') => ({ headers: xff == null ? {} : { 'x-forwarded-for': xff }, ip });

// ── where the request came from ─────────────────────────────────────────────────────────────────────────
eq('one address: it', G.clientIpOf(req('73.12.40.9')), '73.12.40.9');
eq('a caller who writes their own X-Forwarded-For does not choose the answer — the address Google appended does', G.clientIpOf(req('73.12.40.9, 98.7.6.5')), '98.7.6.5');
eq('Google\'s front end after the caller is skipped', G.clientIpOf(req('73.12.40.9, 35.191.12.4')), '73.12.40.9');
eq('…and its load balancers', G.clientIpOf(req('73.12.40.9,130.211.2.9')), '73.12.40.9');
eq('private addresses are never the caller', G.clientIpOf(req('10.0.0.4, 192.168.1.20, 172.20.1.1, 73.12.40.9, 169.254.1.1')), '73.12.40.9');
eq('no header: the socket', G.clientIpOf(req(null, '::ffff:73.12.40.9')), '73.12.40.9');
eq('IPv6 passes through', G.clientIpOf(req('2601:600:8000::1')), '2601:600:8000::1');
eq('the chain, for the setup screen', G.forwardedChainOf(req('1.1.1.1, 73.12.40.9')), ['1.1.1.1', '73.12.40.9']);
eq('infrastructure, by range', ['35.191.0.1', '130.211.3.255', '130.211.4.0', '172.15.0.1', '172.32.0.1', 'fd00::1', '8.8.8.8'].map(G.isInfrastructureIp), [true, true, false, false, false, true, false]);

// ── the trusted network ─────────────────────────────────────────────────────────────────────────────────
const nets = [{ ip: '73.12.40.9', label: 'Shop Wi-Fi' }];
eq('on the list / not / no address', [G.networkTrusted('73.12.40.9', nets), G.networkTrusted('98.7.6.5', nets), G.networkTrusted('', nets), G.networkTrusted('73.12.40.9', null)], [true, false, false, false]);
eq('trusting a network adds it once', [G.withNetwork(nets, { ip: '73.12.40.9', by: 'Boss', nowMs: 1 }).length, G.withNetwork(nets, { ip: '98.7.6.5', label: '', by: 'Boss', nowMs: 2 })[1]], [1, { ip: '98.7.6.5', label: 'Shop Wi-Fi', trustedBy: 'Boss', at: 2 }]);
eq('the first network', G.withNetwork(undefined, { ip: '73.12.40.9', label: 'Main', by: 'Boss', nowMs: 3 }), [{ ip: '73.12.40.9', label: 'Main', trustedBy: 'Boss', at: 3 }]);

// ── a punch, refused or taken ───────────────────────────────────────────────────────────────────────────
const tablet = { name: 'Finishing tablet 2', active: true };
const ask = (o) => { const r = G.punchRefusalOf({ name: 'Pat', kind: 'in', ip: '73.12.40.9', device: tablet, networks: nets, ...o }); return r && r.code + ':' + r.message.split(' — ')[0]; };
eq('the shop tablet on the shop Wi-Fi: taken', ask({}), null);
eq('a phone on the shop Wi-Fi (no tablet id): refused', ask({ device: null }), 'permission-denied:This device is not a shop time clock');
eq('a removed tablet: refused', ask({ device: { ...tablet, active: false } }), 'permission-denied:This device is not a shop time clock');
eq('a shop tablet taken home: refused', ask({ ip: '98.7.6.5' }), 'permission-denied:This tablet is not on the shop network');
eq('no network trusted yet: refused', ask({ networks: [] }), 'permission-denied:This tablet is not on the shop network');
eq('no PIN', ask({ name: ' ' }), 'unauthenticated:Enter your PIN first. · Ingrese su PIN primero.');
eq('not a punch', ask({ kind: 'break' }), 'invalid-argument:That is not a punch this clock knows. · Ese registro no existe.');
ok('every refusal is said in English and Spanish', Object.values(G.REFUSAL).every(t => t.includes(' · ')));

eq('what the kiosk is told before the PIN', [G.deviceCheckOf({ ip: '73.12.40.9', device: tablet, networks: nets }), G.deviceCheckOf({ ip: '98.7.6.5', device: null, networks: nets })],
    [{ enrolled: true, deviceName: 'Finishing tablet 2', onSite: true, ip: '73.12.40.9' }, { enrolled: false, deviceName: '', onSite: false, ip: '98.7.6.5' }]);
eq('the punch written: the server\'s time, the tablet and the network on it', G.punchDocOf({ name: ' Pat ', kind: 'lunchOut', nowMs: 5, deviceId: 'd1', device: tablet, ip: '73.12.40.9' }),
    { name: 'Pat', kind: 'lunchOut', at: 5, source: 'clock', deviceId: 'd1', device: 'Finishing tablet 2', ip: '73.12.40.9' });
eq('the state after it', G.statusDocOf({ name: 'Pat', kind: 'lunchOut', nowMs: 5 }), { name: 'Pat', kind: 'lunchOut', state: 'lunch', at: 5 });

// ── identity ────────────────────────────────────────────────────────────────────────────────────────────
eq('the person key matches the app and the rules', ['Sandra G', ' G Florida ', 'Rafa'].map(G.clockKeyOf), ['Sandra G', ' G Florida ', 'Rafa'].map(appClockKeyOf));
eq('admins only set up tablets', ['admin', 'superadmin', 'SUPERADMIN', 'super_admin', 'paint_manager', ''].map(G.isAdminRole), [true, true, true, true, false, false]);
const id = G.newDeviceId(crypto.randomBytes);
eq('a tablet id: 32 hex characters, and checked as such', [id.length, G.deviceIdValid(id), G.deviceIdValid('x'), G.deviceIdValid(id.toUpperCase())], [32, true, false, false]);

console.log(`timeClockGuard: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
