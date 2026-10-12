// ── THE UNIQUITY CATALOG, READ FROM ITS OWN CODES — PURE (S7 quick sell, step 1, 2026-10-12) ──────
//
// Stuart 2026-10-12: "using the pillow chart i loaded earlier, we can make a way of tagging all
// fabrics … making it super easy for standard sizes / options to just sell normal pillows". The
// library already says everything the quick sell needs, in ONE code grammar (4.5, 2,585 records):
//
//   Bell/10P19x19     a finished pillow — pattern Bell, colour 10, 19 wide × 19 tall (1,536)
//   Bell/10T          the throw (-XL / -XXL / TXL variants)                                (346)
//   Bell/10F          the fabric yardage item the throw converts into                      (72)
//   SWA/Bell10        the small sample · SWAL/Bell10 the large one                         (478)
//
// and every pattern's pillows are PRICED by the chart already (Bell/10P19x19 at 500 = group C at
// 19x19, and only C). So the catalog can tag itself: each colourway's group is the chart column its
// pillow prices sit in, written onto its fabric item and its throws (`manufacturingSpecs.priceGroup`,
// the field the fabric sheet writes). A fabric item with no throw link gets `customData.convertedFrom`
// from the grammar. The sizes' fill inserts are proposed from the inserts in the library
// (Insert-PC-19x19 for 19x19). What the catalog cannot tag it NAMES: a colourway whose pillows exist
// but whose yardage item does not (the office creates it from the fabric sheet, Eric in NetSuite).
//
// Pure: no imports past the pricing module, no Firestore, no Date. Proven by scripts/pillowCatalog.test.mjs.

import { sizeKeyOf, priceGroupOf, sizePriceOf } from './pillowPricing.js';
import { yardsPerThrowOf } from './fabricPieces.js';

const str = (v) => String(v == null ? '' : v).trim();
const up = (v) => str(v).toUpperCase();
const num = (v) => (v === null || v === undefined || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
const isHttp = (u) => /^https?:\/\//i.test(str(u));

export const codeOf = (item) => str(item && (item.legacyErpId || item.itemId));
export const KINDS = { PILLOW: 'PILLOW', THROW: 'THROW', FABRIC: 'FABRIC', SAMPLE: 'SAMPLE', SAMPLE_L: 'SAMPLE_L' };

/**
 * One code → { ok, pattern (UPPER), patternRaw, colour, kind, sizeKey, variant ('' | 'XL' | 'XXL') }.
 * Not every Uniquity record is a colourway code (inserts, zippers, Special / Bridget pillows,
 * CUSTOM PILLOW): those answer ok false and are simply not part of the catalog.
 */
export function parseUniquityCode(code) {
    const c = str(code);
    const none = { ok: false, pattern: '', patternRaw: '', colour: '', kind: '', sizeKey: '', variant: '', code: c };
    if (!c) return none;
    let m = c.match(/^SWA(L)?\/([A-Za-z][A-Za-z'’ .&-]*?)\s*(\d+)$/);
    if (m) return { ok: true, pattern: up(m[2]), patternRaw: str(m[2]), colour: m[3], kind: m[1] ? KINDS.SAMPLE_L : KINDS.SAMPLE, sizeKey: '', variant: '', code: c };
    m = c.match(/^([A-Za-z][A-Za-z'’ .&-]*)\/(\d+)([PTFS])?(.*)$/);
    if (!m) return none;
    const pattern = up(m[1]), patternRaw = str(m[1]), colour = m[2], k = up(m[3]), rest = str(m[4]);
    if (k === 'P') {
        const sizeKey = sizeKeyOf(rest);
        if (!sizeKey || !/^\d+[xX]\d+$/.test(rest)) return { ...none, pattern, patternRaw, colour, kind: KINDS.PILLOW };
        return { ok: true, pattern, patternRaw, colour, kind: KINDS.PILLOW, sizeKey, variant: '', code: c };
    }
    if (k === 'T') {
        const v = up(rest).replace(/^-/, '');
        if (v && v !== 'XL' && v !== 'XXL') return { ...none, pattern, patternRaw, colour, kind: KINDS.THROW };
        return { ok: true, pattern, patternRaw, colour, kind: KINDS.THROW, sizeKey: '', variant: v, code: c };
    }
    if (k === 'F') return rest ? { ...none, pattern, patternRaw, colour, kind: KINDS.FABRIC } : { ok: true, pattern, patternRaw, colour, kind: KINDS.FABRIC, sizeKey: '', variant: '', code: c };
    if (k === 'S') return { ok: true, pattern, patternRaw, colour, kind: KINDS.SAMPLE, sizeKey: '', variant: '', code: c };
    return { ...none, pattern, patternRaw, colour };
}

export const colourwayKeyOf = (pattern, colour) => `${up(pattern)}/${str(colour)}`;
/** The code a pillow of a colourway at a size carries (the library's own spelling of the pattern). */
export const pillowCodeOf = ({ patternRaw, pattern, colour, sizeKey }) => `${patternRaw || pattern}/${colour}P${sizeKey}`;
/** The fabric yardage code a colourway's throw converts into. */
export const fabricCodeOf = ({ patternRaw, pattern, colour }) => `${patternRaw || pattern}/${colour}F`;

/** Any picture the item carries, for a TILE (a line's picture on paper is Shared/lineImage's rule). */
export const tilePictureOf = (item) => {
    const u = item && (item.finalImageUrl || item.componentImageUrl);
    return isHttp(u) ? str(u) : '';
};
export const basePriceOf = (item) => num(item && item.manufacturingSpecs && item.manufacturingSpecs.basePrice);
const colourNameOf = (name, pattern, colour) => {
    const n = str(name);
    const m = n.match(/col(?:or|our|\.)\s*#?\s*\d+\s*[-–:]?\s*([A-Za-z][A-Za-z &'’/-]*?)(?:\s+\d+["”]?\s*[xX×]|\s+\d+\s*[xX×]|\s*$)/i);
    if (m && m[1]) return str(m[1]).replace(/\s+(XL|XXL|Small Sample|Large Sample)$/i, '');
    return '';
};

/**
 * The brand's items → the colourways.
 *   { list: [cw], byKey: Map key → cw, patterns: [{ pattern, label, colourways: [cw] }], sizesSeen: [sizeKey] }
 *   cw = { key, pattern, patternRaw, colour, label, colourName, fabric, throws: { STD, XL, XXL }, samples: { S, L },
 *          pillows: { sizeKey → item }, group, groupFrom ('FABRIC' | 'THROW' | ''), picture, pictureFrom }
 * The group a colourway KNOWS today: its fabric item's, else its throw's.
 */
export function colourwaysOf(items = []) {
    const byKey = new Map();
    const get = (p) => {
        const key = colourwayKeyOf(p.pattern, p.colour);
        if (!byKey.has(key)) byKey.set(key, { key, pattern: p.pattern, patternRaw: p.patternRaw, colour: p.colour, label: '', colourName: '', fabric: null, throws: {}, samples: {}, pillows: {}, group: '', groupFrom: '', picture: '', pictureFrom: '' });
        return byKey.get(key);
    };
    const sizesSeen = new Set();
    (items || []).forEach(it => {
        if (!it || (it.manufacturingSpecs && it.manufacturingSpecs.isRetired === true)) return;
        const p = parseUniquityCode(codeOf(it));
        if (!p.ok) return;
        const cw = get(p);
        if (p.kind === KINDS.PILLOW) { if (!cw.pillows[p.sizeKey]) cw.pillows[p.sizeKey] = it; sizesSeen.add(p.sizeKey); }
        else if (p.kind === KINDS.THROW) { const v = p.variant || 'STD'; if (!cw.throws[v]) cw.throws[v] = it; }
        else if (p.kind === KINDS.FABRIC) { if (!cw.fabric) cw.fabric = it; }
        else if (p.kind === KINDS.SAMPLE) { if (!cw.samples.S) cw.samples.S = it; }
        else if (p.kind === KINDS.SAMPLE_L) { if (!cw.samples.L) cw.samples.L = it; }
    });
    const list = [...byKey.values()].map(cw => {
        const named = cw.throws.STD || cw.fabric || Object.values(cw.pillows)[0] || cw.samples.S || cw.throws.XL || null;
        cw.label = str(named && named.itemName) || cw.key;
        cw.colourName = colourNameOf(cw.label, cw.pattern, cw.colour) || colourNameOf(cw.fabric && cw.fabric.itemName) || colourNameOf(Object.values(cw.pillows)[0] && Object.values(cw.pillows)[0].itemName) || '';
        const gF = priceGroupOf(cw.fabric), gT = priceGroupOf(cw.throws.STD) || priceGroupOf(cw.throws.XL) || priceGroupOf(cw.throws.XXL);
        cw.group = gF || gT || '';
        cw.groupFrom = gF ? 'FABRIC' : (gT ? 'THROW' : '');
        const pic = [['FABRIC', cw.fabric], ['THROW', cw.throws.STD], ['THROW', cw.throws.XL], ...Object.values(cw.pillows).map(x => ['PILLOW', x]), ['SAMPLE', cw.samples.S], ['SAMPLE', cw.samples.L]].find(([, x]) => tilePictureOf(x));
        cw.picture = pic ? tilePictureOf(pic[1]) : '';
        cw.pictureFrom = pic ? pic[0] : '';
        return cw;
    }).sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
    const byPattern = new Map();
    list.forEach(cw => { if (!byPattern.has(cw.pattern)) byPattern.set(cw.pattern, { pattern: cw.pattern, label: cw.patternRaw, colourways: [] }); byPattern.get(cw.pattern).colourways.push(cw); });
    return { list, byKey, patterns: [...byPattern.values()], sizesSeen: [...sizesSeen] };
}

// ── THE GROUP A COLOURWAY'S PRICES SAY ────────────────────────────────────────────────────────

const groupCodesOf = (config) => Object.keys((config && config.fabricGroups) || {});

/**
 * Which chart column the colourway's pillow prices sit in.
 *   { group, reason, priced: n, agree: n, candidates: { G: n }, evidence: [{ sizeKey, code, price, matches: [G] }],
 *     mismatches: [{ sizeKey, code, price, expected }] }
 * reason: 'ONE' (one column fits every priced size) · 'MOST' (no column fits all; the best fits more
 * than half, mismatches listed) · 'TIE' (two columns fit equally — nothing chosen) · 'NO_PRICES'
 * (no pillow of a table size carries a price) · 'NO_FIT' (prices fit no column anywhere).
 */
export function groupFromPillowPrices({ pillows = {}, config = {} } = {}) {
    const groups = groupCodesOf(config);
    const evidence = [];
    Object.entries(pillows || {}).forEach(([sizeKey, it]) => {
        const price = basePriceOf(it);
        if (price === null || price <= 0) return;
        if (!(config.prices && config.prices[sizeKey])) return;
        const matches = groups.filter(g => sizePriceOf(config, sizeKey, g) === price);
        evidence.push({ sizeKey, code: codeOf(it), price, matches });
    });
    const out = { group: '', reason: 'NO_PRICES', priced: evidence.length, agree: 0, candidates: {}, evidence, mismatches: [] };
    if (!evidence.length) return out;
    const counts = {};
    evidence.forEach(e => e.matches.forEach(g => { counts[g] = (counts[g] || 0) + 1; }));
    out.candidates = counts;
    const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    if (!ranked.length) { out.reason = 'NO_FIT'; return out; }
    const [bestG, bestN] = ranked[0];
    const tied = ranked.filter(([, n]) => n === bestN);
    if (bestN === evidence.length && tied.length === 1) { out.group = bestG; out.reason = 'ONE'; out.agree = bestN; return out; }
    if (tied.length > 1) { out.reason = 'TIE'; out.agree = bestN; return out; }
    if (bestN * 2 > evidence.length) {
        out.group = bestG; out.reason = 'MOST'; out.agree = bestN;
        out.mismatches = evidence.filter(e => !e.matches.includes(bestG)).map(e => ({ sizeKey: e.sizeKey, code: e.code, price: e.price, expected: sizePriceOf(config, e.sizeKey, bestG) }));
        return out;
    }
    out.reason = 'NO_FIT'; out.agree = bestN;
    return out;
}

// ── THE PLAN: what the catalog writes onto itself ─────────────────────────────────────────────

const INSERT_RX = /^INSERT-PC-\s*(\d+)\s*["”]?\s*[xX×]\s*(\d+)\s*["”]?$/;
/** The insert in the library for a size (Insert-PC-19x19 · Insert-PC- 18"x18"), indoor only; null when none. */
export const insertForSize = (sizeKey, items = []) => {
    const want = sizeKeyOf(sizeKey);
    if (!want) return null;
    const hits = (items || []).filter(it => {
        const m = up(codeOf(it)).match(INSERT_RX);
        return m && sizeKeyOf(`${m[1]}x${m[2]}`) === want;
    });
    return hits[0] || null;
};

/**
 * items + config → the plan.
 *   rows        one per PATTERN: { pattern, label, group, agree ('ALL' | 'SPLIT' | 'NONE'), colourways: [{ cw, derived, writes }] }
 *   writes      [{ id, code, kind: 'FABRIC' | 'THROW', path, from, to }]  — the library writes (priceGroup, convertedFrom)
 *   fill        [{ sizeKey, code, current }]  — the fill inserts proposed where the table has none
 *   missing     [{ key, pattern, colour, label, group, throwCode, fabricCode }]  — colourways with pillows / a throw and no yardage item
 *   counts      { patterns, colourways, derived, writes, missing, fill, tagged }
 */
export function catalogTagPlanOf({ items = [], config = {} } = {}) {
    const cat = colourwaysOf(items);
    const writes = [], missing = [];
    const rows = cat.patterns.map(p => {
        const cws = p.colourways.map(cw => {
            const derived = groupFromPillowPrices({ pillows: cw.pillows, config });
            const w = [];
            const to = derived.group;
            if (to) {
                const targets = [['FABRIC', cw.fabric], ['THROW', cw.throws.STD], ['THROW', cw.throws.XL], ['THROW', cw.throws.XXL]].filter(([, it]) => it);
                targets.forEach(([kind, it]) => {
                    const from = priceGroupOf(it);
                    if (from !== to) w.push({ id: it.id, code: codeOf(it), kind, path: 'manufacturingSpecs.priceGroup', from, to });
                });
            }
            if (cw.fabric && cw.throws.STD) {
                const cd = (cw.fabric.manufacturingSpecs && cw.fabric.manufacturingSpecs.customData) || {};
                if (!str(cd.convertedFrom)) w.push({ id: cw.fabric.id, code: codeOf(cw.fabric), kind: 'FABRIC', path: 'manufacturingSpecs.customData.convertedFrom', from: '', to: codeOf(cw.throws.STD) });
            }
            writes.push(...w);
            if (!cw.fabric && (Object.keys(cw.pillows).length || cw.throws.STD || cw.throws.XL)) {
                missing.push({ key: cw.key, pattern: cw.pattern, patternRaw: cw.patternRaw, colour: cw.colour, label: cw.label, colourName: cw.colourName, group: to || cw.group || '', throwCode: codeOf(cw.throws.STD || cw.throws.XL || null), fabricCode: fabricCodeOf(cw), pillows: Object.keys(cw.pillows).length });
            }
            return { cw, derived, writes: w };
        });
        const gs = [...new Set(cws.map(c => c.derived.group).filter(Boolean))];
        const group = gs.length === 1 ? gs[0] : '';
        const agree = gs.length === 1 && cws.every(c => c.derived.group) ? 'ALL' : (gs.length === 0 ? 'NONE' : 'SPLIT');
        return { pattern: p.pattern, label: p.label, group, agree, groups: gs, colourways: cws };
    });
    const fill = Object.keys((config && config.prices) || {}).map(sizeKey => {
        const current = str(config.sizes && config.sizes[sizeKey] && config.sizes[sizeKey].fillItem);
        if (current) return null;
        const it = insertForSize(sizeKey, items);
        return it ? { sizeKey, code: codeOf(it), current } : null;
    }).filter(Boolean);
    const derivedN = rows.reduce((s, r) => s + r.colourways.filter(c => c.derived.group).length, 0);
    const taggedN = cat.list.filter(cw => cw.group).length;
    return { rows, writes, fill, missing, counts: { patterns: rows.length, colourways: cat.list.length, derived: derivedN, writes: writes.length, missing: missing.length, fill: fill.length, tagged: taggedN } };
}

/** The updateDoc patches, one per item, from the plan's writes (several writes to one item merge). */
export const catalogTagPatchesOf = (writes = [], { by = '', at = 0 } = {}) => {
    const byId = new Map();
    (writes || []).forEach(w => {
        if (!byId.has(w.id)) byId.set(w.id, { id: w.id, code: w.code, patch: { updatedAt: at || 0, catalogTagAt: at || 0, catalogTagBy: by } });
        byId.get(w.id).patch[w.path] = w.to;
    });
    return [...byId.values()];
};

/** The sizes map with the proposed fill inserts set (only where blank). */
export const sizesWithFillItems = (config, fill = []) => {
    const sizes = { ...((config && config.sizes) || {}) };
    (fill || []).forEach(f => {
        const cur = { ...(sizes[f.sizeKey] || { label: f.sizeKey }) };
        if (!str(cur.fillItem)) cur.fillItem = f.code;
        sizes[f.sizeKey] = cur;
    });
    return sizes;
};

/** The "Yardage to create" rows for the fabric sheet download: FABRIC_COLS order, width left blank for the office. */
export const missingYardageRowsOf = (missing = []) => (missing || []).map(m => [
    m.fabricCode, m.throwCode || '', `${m.label} fabric yardage`.replace(/\s+(XL|XXL)\s+fabric yardage$/i, ' fabric yardage'), 'FABRIC',
    m.group || '', '', 'FALSE', m.patternRaw || m.pattern, m.colourName || m.colour, '', '', '', 'TRUE', '', `proposed from the catalog — ${m.pillows} pillow size(s) in the library`,
]);

// ── THE FABRIC ITEMS FROM THE THROWS (Stuart 2026-10-12: "create an app item equal to the throw in
// yardage … 1 throw is basically 2 yards long by the same width, for now 54 in wide for all") ─────
//
// App-only items (no NetSuite id): the throw stays the NetSuite inventory item and a pillow relieves a
// FRACTION of it (the push rule); the fabric item is what the board, the quick sell, the sewing document,
// the pick and the cut ledger name, in yards. When Eric later creates a NetSuite yardage item, the same
// record takes the id through the fabric sheet and pushes as itself.

export const DEFAULT_FABRIC_WIDTH_IN = 54;
export const DEFAULT_YARDS_PER_THROW = 2;

const binOf = (it) => str(it && it.manufacturingSpecs && (it.manufacturingSpecs.homeBin || it.manufacturingSpecs.binLocation)) || str(it && it.binLocation);

/**
 * items + config → what one press creates and fixes.
 *   creates  [{ key, code, throwCode, group, row }]      row = the fabric sheet's row shape (fabricCreateDocOf takes it)
 *   widths   [{ id, code, from, to }]                     existing fabric items with no width → widthIn
 *   throws   [{ id, code, to }]                           standard throws with no yards-per-throw → DEFAULT_YARDS_PER_THROW
 *   skipped  [{ key, reason }]                            colourways with pillows but no throw at all (nothing to convert)
 */
export function fabricCreatePlanOf({ items = [], config = {}, widthIn = DEFAULT_FABRIC_WIDTH_IN } = {}) {
    const cat = colourwaysOf(items);
    const creates = [], widths = [], throws = [], skipped = [];
    cat.list.forEach(cw => {
        const t = cw.throws.STD || cw.throws.XL || cw.throws.XXL || null;
        if (cw.fabric) {
            if (!num(cw.fabric.manufacturingSpecs && cw.fabric.manufacturingSpecs.width)) widths.push({ id: cw.fabric.id, code: codeOf(cw.fabric), from: '', to: widthIn });
        } else if (t) {
            const group = cw.group || groupFromPillowPrices({ pillows: cw.pillows, config }).group || '';
            const code = fabricCodeOf(cw);
            const name = `${str(t.itemName) || cw.key} — fabric yardage`;
            creates.push({
                key: cw.key, code, throwCode: codeOf(t), group,
                row: { code, name, type: 'FABRIC', priceGroup: group, width: widthIn, railroad: false, patternId: cw.patternRaw || cw.pattern, color: cw.colourName || cw.colour, convertedFrom: codeOf(t), homeBin: binOf(t), stocked: true, notes: `app item from the throw ${codeOf(t)} (${DEFAULT_YARDS_PER_THROW} yd per throw, ${widthIn}" wide) — no NetSuite item: pushes as a fraction of the throw`, nsId: '' },
            });
        } else if (Object.keys(cw.pillows).length) {
            skipped.push({ key: cw.key, reason: 'no throw in the library — nothing to convert; bought by the yard, create it on the fabric sheet' });
        }
        if (cw.throws.STD) {
            const cd = (cw.throws.STD.manufacturingSpecs && cw.throws.STD.manufacturingSpecs.customData) || {};
            if (!num(cd.yardsPerThrow) && !num(cw.throws.STD.manufacturingSpecs && cw.throws.STD.manufacturingSpecs.length)) throws.push({ id: cw.throws.STD.id, code: codeOf(cw.throws.STD), to: DEFAULT_YARDS_PER_THROW });
        }
    });
    return { creates, widths, throws, skipped, counts: { creates: creates.length, widths: widths.length, throws: throws.length, skipped: skipped.length, noGroup: creates.filter(c => !c.group).length } };
}

// ── THE STOCK ALIAS: an app-only fabric IS a fraction of its throw, to NetSuite ─────────────────
//
// Stuart 2026-10-12: keep the fabrics in the app and "account for them with fractions of a throw (how we
// do it now)". A fabric item with its OWN NetSuite id reads and pushes as itself, in yards. One without
// reads and pushes as its throw: available yards = the throw's available × yards-per-throw; the sales
// order line = the throw × (yards ÷ yards-per-throw). The app's documents (the sewing document, the pick,
// the cut ledger) keep the fabric in yards — only the NetSuite identity changes.

const r4 = (n) => Math.round(n * 10000) / 10000;

/**
 * fabric + findByCode → null (the fabric stands for itself, or nothing can stand for it) or
 *   { code: THROWCODE, throwCode, nsId, yardsPerThrow, factor: 1 / yardsPerThrow }
 */
export const fabricStockAliasOf = (fabric, findByCode) => {
    if (!fabric || str(fabric.netSuiteInternalId)) return null;
    const cd = (fabric.manufacturingSpecs && fabric.manufacturingSpecs.customData) || {};
    const throwCode = str(cd.convertedFrom);
    if (!throwCode || typeof findByCode !== 'function') return null;
    const t = findByCode(throwCode);
    if (!t || !str(t.netSuiteInternalId)) return null;
    const ypt = yardsPerThrowOf(t);
    if (!(ypt > 0)) return null;
    return { code: up(codeOf(t)), throwCode: codeOf(t), nsId: str(t.netSuiteInternalId), yardsPerThrow: ypt, factor: r4(1 / ypt) };
};

/** The NetSuite line for `yards` of a fabric: as itself, or as a fraction of its throw (null = no identity). */
export const fabricNsLineOf = ({ fabric, yards, findByCode } = {}) => {
    const y = num(yards) || 0;
    if (!fabric) return null;
    if (str(fabric.netSuiteInternalId)) return { nsId: str(fabric.netSuiteInternalId), quantity: r4(y), via: '' };
    const a = fabricStockAliasOf(fabric, findByCode);
    if (!a) return null;
    const q = r4(y / a.yardsPerThrow);
    return { nsId: a.nsId, quantity: q, factor: a.factor, via: `${r4(y)} yd of ${codeOf(fabric)} = ${q} × ${a.throwCode}` };
};

/** The codes an availability read must also fetch for these parts, and how to fold them back. */
export const fabricAliasesOf = (codes = [], findByCode) => (codes || []).map(c => {
    const f = typeof findByCode === 'function' ? findByCode(c) : null;
    const a = f ? fabricStockAliasOf(f, findByCode) : null;
    return a ? { code: up(c), via: a.code, yardsPerThrow: a.yardsPerThrow } : null;
}).filter(Boolean);

/** An availability map with each aliased fabric answered from its throw (only where the fabric itself had no row). */
export const withFabricAliases = (avail = {}, aliases = []) => {
    const out = { ...(avail || {}) };
    (aliases || []).forEach(a => {
        if (out[a.code]) return;
        const t = out[a.via];
        if (!t) return;
        out[a.code] = { available: r4((Number(t.available) || 0) * a.yardsPerThrow), onOrder: r4((Number(t.onOrder) || 0) * a.yardsPerThrow), unit: 'YD', viaThrow: a.via };
    });
    return out;
};
