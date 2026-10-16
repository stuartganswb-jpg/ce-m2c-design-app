// ⏱ THE TIME CLOCK'S TWO LOCKS — server side (Stuart 2026-10-16: "how can we make sure it will only work onsite tablets
// and not offsite" · "both locks, so personal phones are refused. one wifi network").
//   1. THE SHOP NETWORK — a punch is taken only from an internet address on the trusted list (time_config/clock.networks).
//      A browser cannot prove where it is; the server sees the address the request came from.
//   2. AN ENROLLED TABLET — a punch carries the id an admin gave that tablet when setting it up (time_devices/<id>,
//      active). A phone on the shop Wi-Fi has none.
// Pure, CommonJS (the functions package). index.js clockCheck / clockPunch / clockDevice use it.
// Harness: scripts/timeClockGuard.test.mjs.

const PUNCH_KINDS = ['in', 'lunchOut', 'lunchIn', 'out'];
const STATE_AFTER = { in: 'in', lunchOut: 'lunch', lunchIn: 'in', out: 'out' };

// Addresses that are never the caller's own: private and link-local networks, and Google's front-end / load-balancer
// ranges (35.191.0.0/16, 130.211.0.0/22), which can sit after the caller in the chain.
const v4 = (ip) => { const m = String(ip).match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/); return m ? m.slice(1).map(Number) : null; };
function isInfrastructureIp(ip) {
    const s = String(ip || '').toLowerCase();
    const o = v4(s);
    if (o) {
        const [a, b] = o;
        return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254)
            || (a === 35 && b === 191) || (a === 130 && b === 211 && o[2] <= 3);
    }
    return s === '::1' || s.startsWith('fc') || s.startsWith('fd') || s.startsWith('fe80');
}
/** X-Forwarded-For, as a list (left = what the caller claimed, right = what Google appended). */
const forwardedChainOf = (req) => {
    const h = req && req.headers ? req.headers['x-forwarded-for'] : '';
    return String(Array.isArray(h) ? h.join(',') : (h || '')).split(',').map(s => s.trim().replace(/^::ffff:/, '')).filter(Boolean);
};
/**
 * The address the request came from. Google's front end APPENDS the address it saw to X-Forwarded-For, so the answer is
 * read from the RIGHT — the last entry that is not Google's own or a private address; anything to its left the caller
 * could have written themselves. Falls back to the socket's address.
 */
function clientIpOf(req) {
    const chain = forwardedChainOf(req);
    for (let i = chain.length - 1; i >= 0; i--) if (!isInfrastructureIp(chain[i])) return chain[i];
    return String((req && (req.ip || (req.socket && req.socket.remoteAddress))) || '').replace(/^::ffff:/, '');
}

/** Is this address on the trusted list? */
const networkTrusted = (ip, networks) => !!ip && (Array.isArray(networks) ? networks : []).some(n => n && String(n.ip || '').trim() === ip);

/** The same key as Shared/timeClock.clockKeyOf and firestore.rules clockKey(). */
const clockKeyOf = (name) => String(name == null ? '' : name).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');

const isAdminRole = (role) => ['admin', 'superadmin'].includes(String(role || '').toLowerCase().replace(/[^a-z]/g, ''));

/** A tablet's id: 128 random bits, hex — unguessable, and nothing but an id. */
const newDeviceId = (randomBytes) => randomBytes(16).toString('hex');
const deviceIdValid = (id) => /^[a-f0-9]{32}$/.test(String(id || ''));

const REFUSAL = {
    NOT_SIGNED_IN: 'Enter your PIN first. · Ingrese su PIN primero.',
    BAD_PUNCH: 'That is not a punch this clock knows. · Ese registro no existe.',
    NOT_ENROLLED: 'This device is not a shop time clock — punches are taken only on the shop tablets. · Este dispositivo no es un reloj de la tienda — solo se registra en las tabletas de la tienda.',
    NOT_ON_SITE: 'This tablet is not on the shop network — punches are taken only at the shop. · Esta tableta no está en la red de la tienda — solo se registra en la tienda.',
    NOT_ADMIN: 'Only an admin can set up a tablet or trust a network. · Solo un administrador puede configurar una tableta.',
};

/**
 * May this punch be taken? → null, or { code, message }.
 * @param device    the time_devices record for the id the tablet sent (null when there is none)
 * @param networks  time_config/clock.networks
 */
function punchRefusalOf({ name, kind, ip, device, networks }) {
    if (!String(name || '').trim()) return { code: 'unauthenticated', message: REFUSAL.NOT_SIGNED_IN };
    if (!PUNCH_KINDS.includes(kind)) return { code: 'invalid-argument', message: REFUSAL.BAD_PUNCH };
    if (!device || device.active === false) return { code: 'permission-denied', message: REFUSAL.NOT_ENROLLED };
    if (!networkTrusted(ip, networks)) return { code: 'permission-denied', message: REFUSAL.NOT_ON_SITE };
    return null;
}

/** What the kiosk is told before anyone types a PIN. */
const deviceCheckOf = ({ ip, device, networks }) => ({
    enrolled: !!device && device.active !== false, deviceName: (device && device.active !== false && device.name) || '',
    onSite: networkTrusted(ip, networks), ip,
});

/** The punch the server writes (the server's time; `t` is set by the caller with serverTimestamp). */
const punchDocOf = ({ name, kind, nowMs, deviceId, device, ip }) => ({
    name: String(name).trim(), kind, at: nowMs, source: 'clock', deviceId, device: (device && device.name) || '', ip,
});
const statusDocOf = ({ name, kind, nowMs }) => ({ name: String(name).trim(), kind, state: STATE_AFTER[kind], at: nowMs });

/** The trusted list with this address on it (once). */
const withNetwork = (networks, { ip, label, by, nowMs }) => {
    const list = Array.isArray(networks) ? networks.filter(Boolean) : [];
    return networkTrusted(ip, list) ? list : [...list, { ip, label: String(label || 'Shop Wi-Fi').trim(), trustedBy: String(by || ''), at: nowMs }];
};

module.exports = {
    PUNCH_KINDS, REFUSAL, clientIpOf, forwardedChainOf, isInfrastructureIp, networkTrusted, clockKeyOf, isAdminRole, newDeviceId, deviceIdValid,
    punchRefusalOf, deviceCheckOf, punchDocOf, statusDocOf, withNetwork,
};
