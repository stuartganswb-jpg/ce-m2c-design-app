// THE FULFILMENT RULES — what is ready to ship, where it goes, what it weighs, what a shipment
// stamps. Pure; the WMS Fulfilment tab (Shared/FulfilmentPanel) renders these and the tests
// (scripts/fulfilment.test.mjs) hold them.
//
// Stuart 2026-09-03: "after SO Pack is ready we will post to a fulfillment tab which we will enter
// in weight and dimensions of packing, tie into UPS API, get rate, set shipping details, ship the
// order, push the tracking back into NetSuite and release its fulfillment record as shipped."
// Stuart 2026-09-16: the new boxes are not in stock yet — every package's dimensions are editable
// and overrule the standard box they started from.
import { isClosedState } from './orderLifecycle.js';

// ── THE QUEUE ────────────────────────────────────────────────────────────────────────────────
// A pack doc ships once: packed (not a stock put-away), not yet shipped, not closed or deleted.
export const isReadyToShip = (d) => !!d
    && d.packStatus === 'Packed'
    && d.packMode !== 'PUTAWAY' && !d.putawayBin
    && !d.shippedAt
    && !isClosedState(d);

export const fulfilmentQueueOf = (docs = []) => (Array.isArray(docs) ? docs : [])
    .filter(isReadyToShip)
    .sort((a, b) => (Number(a.packedAt) || 0) - (Number(b.packedAt) || 0));

// Shipped in the last `days` (the void / reprint window on screen).
export const recentlyShippedOf = (docs = [], now = Date.now(), days = 3) => (Array.isArray(docs) ? docs : [])
    .filter((d) => d && d.shippedAt && Number(d.shippedAt) >= now - days * 86400000)
    .sort((a, b) => Number(b.shippedAt) - Number(a.shippedAt));

// ── THE SHIP-TO ──────────────────────────────────────────────────────────────────────────────
const str = (v) => String(v === undefined || v === null ? '' : v).trim();
export const BLANK_ADDRESS = { attention: '', addressee: '', addr1: '', addr2: '', city: '', state: '', zip: '', country: 'US', phone: '', residential: false };

// The order's custom drop-ship address, else its saved address-book entry, else the customer's
// default, else the first on file — the same precedence as Shared/salesOrderHeader.shipToLinesOf.
export function shipToOf(so, customer) {
    const pick = (a, source) => ({
        address: {
            ...BLANK_ADDRESS,
            attention: str(a.attention), addressee: str(a.addressee) || str(a.label),
            addr1: str(a.addr1), addr2: str(a.addr2), city: str(a.city),
            state: str(a.state).toUpperCase(), zip: str(a.zip), country: (str(a.country) || 'US').toUpperCase().slice(0, 2),
            phone: str(a.phone),
        },
        source,
    });
    const o = so || {};
    if (str(o.shippingMethod).toUpperCase() === 'CUSTOM' && o.customShippingAddress && str(o.customShippingAddress.addr1)) {
        return pick(o.customShippingAddress, 'custom drop-ship address on the order');
    }
    const list = (customer && Array.isArray(customer.shippingAddresses)) ? customer.shippingAddresses : [];
    const saved = list.find((a) => str(a.addressBookId) && str(a.addressBookId) === str(o.shippingAddressId));
    if (saved) return pick(saved, 'saved address chosen on the order');
    const def = list.find((a) => a.isDefault) || list[0];
    if (def) return pick(def, list.find((a) => a.isDefault) ? "customer's default address" : "customer's first address on file");
    return { address: { ...BLANK_ADDRESS }, source: 'no address on file — enter it' };
}

export function addressErrors(a) {
    const x = a || {};
    const out = [];
    if (!str(x.addressee) && !str(x.attention)) out.push('name or company');
    if (!str(x.addr1)) out.push('street');
    if (!str(x.city)) out.push('city');
    if (!str(x.state)) out.push('state');
    if (!str(x.zip)) out.push('zip');
    return out;
}

// ── THE PACKAGES ─────────────────────────────────────────────────────────────────────────────
// A standard box's three sides, longest first (UPS reads Length as the longest side).
export const boxDims = (box) => {
    if (!box) return { length: '', width: '', height: '' };
    const sides = [box.w, box.h, box.d].map(Number).filter((n) => n > 0).sort((p, q) => q - p);
    return { length: sides[0] ? String(sides[0]) : '', width: sides[1] ? String(sides[1]) : '', height: sides[2] ? String(sides[2]) : '' };
};

// One package per box the packer chose (SMALL, POLE). The dims START from the standard box and are
// then the packer's to change; a box name with no standard box on file starts blank.
export function packagesFromPack(packBoxes, stdBoxes = []) {
    const chosen = ['SMALL', 'POLE']
        .map((slot) => ({ slot, name: str(packBoxes && packBoxes[slot]) }))
        .filter((b) => b.name);
    const rows = chosen.map(({ slot, name }) => {
        const box = (stdBoxes || []).find((b) => str(b.name) === name) || null;
        return { boxName: name, slot, ...boxDims(box), weight: '', fromStandard: !!box };
    });
    return rows.length ? rows : [blankPackage()];
}

export const blankPackage = () => ({ boxName: 'Custom box', slot: '', length: '', width: '', height: '', weight: '', fromStandard: false });

// The same limits the upsRate / upsShip functions enforce, said before the call.
export function packageErrors(rows) {
    const list = Array.isArray(rows) ? rows : [];
    if (!list.length) return ['Add at least one package.'];
    if (list.length > 20) return ['At most 20 packages per shipment.'];
    const out = [];
    list.forEach((p, i) => {
        const bad = ['length', 'width', 'height'].filter((k) => !(Number(p[k]) > 0 && Number(p[k]) <= 108));
        if (bad.length) out.push(`Package ${i + 1}: ${bad.join(', ')} (inches, up to 108)`);
        if (!(Number(p.weight) > 0 && Number(p.weight) <= 150)) out.push(`Package ${i + 1}: weight (lb, up to 150)`);
    });
    return out;
}

// ── THE RATES ────────────────────────────────────────────────────────────────────────────────
// display: 'both' | 'negotiated' | 'published' (HQ 9.5 → system/ups_config.rateDisplay).
export const RATE_DISPLAYS = ['both', 'negotiated', 'published'];
export const rateOf = (s, display) => {
    if (!s) return null;
    if (display === 'published') return s.published;
    return s.negotiated !== null && s.negotiated !== undefined ? s.negotiated : s.published;
};
export const sortedRates = (services = [], display = 'both') => [...(services || [])]
    .filter((s) => rateOf(s, display) !== null && rateOf(s, display) !== undefined)
    .sort((a, b) => rateOf(a, display) - rateOf(b, display));

// ── WHAT A SHIPMENT STAMPS ───────────────────────────────────────────────────────────────────
// On the pack doc and its sales order. `shippedAt` is the field the lifecycle already reads as
// shipped (orderLifecycle.openForSearch, the reopen rules); RTG's floorPhase stays 'Packed'.
export function shipPatchOf({ result, packages, labelUrls = [], by = '', now = Date.now() }) {
    const pk = (result && result.packages) || [];
    const trackingNumbers = pk.map((p) => p.trackingNumber).filter(Boolean);
    return {
        shippedAt: now,
        shippedBy: by,
        shipCarrier: 'UPS',
        shipServiceCode: result.serviceCode || '',
        shipService: result.serviceName || '',
        shipmentId: result.shipmentId || '',
        shipEnvironment: result.environment || '',
        shipCharge: { published: result.published ?? null, negotiated: result.negotiated ?? null },
        trackingNumbers,
        shipPackages: (packages || []).map((p, i) => ({
            boxName: p.boxName || '', length: Number(p.length), width: Number(p.width), height: Number(p.height), weight: Number(p.weight),
            trackingNumber: (pk[i] && pk[i].trackingNumber) || '',
            labelUrl: labelUrls[i] || '',
        })),
    };
}

export function voidPatchOf({ by = '', now = Date.now(), prior = {} }) {
    return {
        shippedAt: null, shippedBy: null, shipmentId: '', trackingNumbers: [], shipPackages: [],
        shipVoided: [...(Array.isArray(prior.shipVoided) ? prior.shipVoided : []), {
            shipmentId: prior.shipmentId || '', trackingNumbers: prior.trackingNumbers || [], voidedAt: now, voidedBy: by,
        }],
    };
}

// The NetSuite Item Fulfillment update: status Shipped + one package line per UPS package.
export function nsShipPayloadOf(patch) {
    const pk = (patch && patch.shipPackages) || [];
    return {
        shipStatus: { id: 'C' },
        package: {
            items: pk.map((p) => ({
                packageTrackingNumber: p.trackingNumber,
                packageWeight: p.weight,
                packageDescr: `UPS ${patch.shipService || ''} — ${p.boxName || 'box'} ${p.length}x${p.width}x${p.height} in`.slice(0, 60),
            })),
        },
    };
}

// ── THE LABEL ────────────────────────────────────────────────────────────────────────────────
// UPS returns a landscape GIF (label on the left); it prints turned a quarter-turn onto 4x6 stock.
export function labelDocHtml(images = []) {
    const pages = (images || []).filter(Boolean).map((src) =>
        `<div class="pg"><img src="${String(src).replace(/"/g, '&quot;')}" alt="UPS label"/></div>`).join('');
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>UPS label</title><style>
@page{size:4in 6in;margin:0;}
html,body{margin:0;padding:0;}
.pg{width:4in;height:6in;overflow:hidden;position:relative;page-break-after:always;}
.pg img{position:absolute;top:0;left:0;width:7in;height:4in;transform-origin:top left;transform:rotate(90deg) translate(0,-4in);}
</style></head><body>${pages}</body></html>`;
}
