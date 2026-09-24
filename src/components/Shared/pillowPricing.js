// ── THE CUSTOM PILLOW PRICE RULE (Uniquity · S7, Stuart 2026-09-13) ──────────────────────────
//
// One pure module: a pillow DESIGN (what the Vision board draws) + the library items it uses + the
// price table → ONE priced holder line (the non-inventory "custom pillow" item Stuart is setting
// up) and the CONSUMPTION rows beneath it (fabric yards / fabric panels / trim yards / fill /
// zipper at $0). The rule, in Stuart's words:
//
//   "price on custom pillow will be decided by first size selected (will include filler, zipper,
//    base labor) then fabric selected … will decide the price grouping … each section will consume
//    the inventory but the panels will be priced from the highest price group selected, so if there
//    are 3 panels, with three different fabrics, the highest fabric is charged … plus we add the
//    labor charge for every custom seam and a charge for every custom detail such as edge details,
//    trim, etc."
//
// Where the numbers live: `system/pillow_pricing` (shape = DEFAULT_PILLOW_PRICING below), seeded from
// Stuart's pricing spreadsheet — NEVER in this file. A size, group, seam or detail with no row in the
// table is a REFUSAL with a named code (the validator rule: refuse only on complete knowledge, and say
// which row is missing), never a $0 line.
//
// Where the items live: Uniquity `Approved_Designs`. A fabric carries `manufacturingSpecs.priceGroup`
// (its price group), `manufacturingSpecs.width` (inches) and, for a throw cut down to a panel and
// labelled as a fabric, `manufacturingSpecs.length` (inches) too. Running-yard goods have a width and
// no length. Both are "fabrics" to the board (Stuart: "we will break the throws into smaller sizes
// which we label as fabrics").
//
// Downstream contract (the rows copy Shared/hardwareHandoff's line shape so tab 7, the SO doc, the
// documents, the split and the NetSuite push read them with the code they already have):
//   { name, qty, price, total, partHandling, partId, legacyErpId, finishCode: '', isFee }
// plus, on this module's rows only: `isRollup` (the holder), `consumes` (a component the floor pulls
// and NetSuite relieves), `uom`, `panel`. No hardware field is written here — a pillow row must stay
// invisible to Shared/visionBridge and the tag engine.
//
// Pure: no imports, no Firestore, no Date. Proven by scripts/pillowPricing.test.mjs.

export const PILLOW_PRICING_DOC = 'pillow_pricing';   // system/pillow_pricing
export const PILLOW_DIVISION = 'SEW';                 // the Stitch & Sew floor (S2/S3 build the floor)
export const PILLOW_HANDLING = 'Custom';              // made-to-order, never a shelf pull

/** The document shape. Every table starts EMPTY — the spreadsheet fills it, this file never does. */
export const DEFAULT_PILLOW_PRICING = {
    version: 1,
    // Per size, the standard price by fabric group: prices['22x22']['B'] = 185. Stuart: "we have a
    // standard price for a Naka 23x23 pillow" — the size × group cell IS that price, and it already
    // includes the filler, the zipper and the base labour.
    prices: {},
    // Optional fallback when a size has no matrix row: sizes[key].base + fabricGroups[g].upcharge.
    sizes: {},          // sizes['22x22'] = { label: '22x22 Square', base: 150, fillItem: '', zipperItem: '' }
    // The groups, ranked. A higher rank is a pricier group; "highest group" reads rank.
    fabricGroups: {},   // fabricGroups['B'] = { label: 'Group B', rank: 2, upcharge: 35 }
    // Labour per custom seam (every seam the operator draws is a custom seam).
    seamLabor: { perSeam: null },
    // Custom details: the code the design produces → { price, per: 'EACH' | 'YARD' }.
    //   FLANGE / WELT (edge treatment, EACH) · OUTER_TRIM (trim on the outer edges, YARD)
    //   · FRINGE_SEAM (fringe / trim laid on a drawn seam, YARD)
    details: {},
    // Consumption arithmetic.
    seamAllowanceIn: 0.5,   // added to every panel edge before the cut
    yardRounding: 0.125,    // running yards round UP to this step
    // The non-inventory holder the price rides on (Stuart: "we will set one up called custom pillow").
    rollupItem: { legacyErpId: 'CUSTOM PILLOW', itemId: '' },
};

const num = (v) => (v === null || v === undefined || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
const cents = (v) => Math.round((Number(v) || 0) * 100) / 100;
const yd3 = (v) => Math.round((Number(v) || 0) * 1000) / 1000;   // yards keep three decimals (⅛ = 0.125), money keeps cents
const up = (v) => String(v || '').trim().toUpperCase();

/** '22x22 Square' / '12 x 20 Lumbar' / '22X22' → '22x22'; '' when no WxH can be read. */
export const sizeKeyOf = (size) => {
    const m = String(size || '').match(/(\d+(?:\.\d+)?)\s*[xX×]\s*(\d+(?:\.\d+)?)/);
    return m ? `${Number(m[1])}x${Number(m[2])}` : '';
};

/** { w, h } in inches from a size label; null when unreadable. */
export const dimsOf = (size) => {
    const key = sizeKeyOf(size);
    if (!key) return null;
    const [w, h] = key.split('x').map(Number);
    return { w, h };
};

/** The fabric's price group, from the item (manufacturingSpecs.priceGroup, or customData.priceGroup). */
export const priceGroupOf = (item) => {
    if (!item) return '';
    const specs = item.manufacturingSpecs || {};
    return up(specs.priceGroup || (specs.customData && specs.customData.priceGroup) || (item.customData && item.customData.priceGroup));
};

/** Rank of a group in the table; null when the table does not know it. */
export const groupRankOf = (config, group) => {
    const g = (config && config.fabricGroups && config.fabricGroups[up(group)]) || null;
    return g ? (num(g.rank) === null ? null : num(g.rank)) : null;
};

/** The highest-ranked group among those given (the one the pillow is charged at); '' when none rank. */
export const highestGroupOf = (config, groups = []) => {
    let best = '', bestRank = -Infinity;
    (groups || []).forEach(g => {
        const r = groupRankOf(config, g);
        if (r !== null && r > bestRank) { best = up(g); bestRank = r; }
    });
    return best;
};

/** The standard price of a size at a group: the matrix cell, else base + upcharge; null = no row. */
export const sizePriceOf = (config, sizeKey, group) => {
    const key = sizeKeyOf(sizeKey) || String(sizeKey || '');
    const g = up(group);
    const cell = config && config.prices && config.prices[key] && config.prices[key][g];
    if (num(cell) !== null) return num(cell);
    const base = config && config.sizes && config.sizes[key] && num(config.sizes[key].base);
    const upc = config && config.fabricGroups && config.fabricGroups[g] && num(config.fabricGroups[g].upcharge);
    if (base !== null && base !== undefined && upc !== null && upc !== undefined) return base + upc;
    return null;
};

/** 'YARD' for running-yard goods, 'EACH' for a cut panel. The item's UOM wins; else a length means a panel. */
export const fabricUnitOf = (item) => {
    const specs = (item && item.manufacturingSpecs) || {};
    const u = up(specs.uom);
    if (/^(RY|YD|YARD|YARDS|RUNNING)/.test(u)) return 'YARD';
    if (/^(EA|EACH|PC|PANEL)/.test(u)) return 'EACH';
    return num(specs.length) !== null && num(specs.length) > 0 ? 'EACH' : 'YARD';
};

const roundUpTo = (v, step) => (step > 0 ? Math.ceil((v - 1e-9) / step) * step : v);

/**
 * What ONE panel consumes of its fabric.
 *   YARD goods: widths across = ceil((panel width + 2 × allowance) / fabric width); yards =
 *               widths × (panel height + 2 × allowance) / 36, rounded UP to yardRounding.
 *   EACH goods (a cut-down throw): one panel; a warning when the panel does not fit the piece in
 *               either orientation.
 * Unknown panel dimensions → qty null + a warning (never a guess).
 */
export const panelConsumptionOf = ({ item, panel, config = DEFAULT_PILLOW_PRICING }) => {
    const unit = fabricUnitOf(item);
    const specs = (item && item.manufacturingSpecs) || {};
    const allow = num(config.seamAllowanceIn) === null ? 0.5 : num(config.seamAllowanceIn);
    const pw = num(panel && panel.widthIn), ph = num(panel && panel.heightIn);
    const warnings = [];
    if (pw === null || ph === null || pw <= 0 || ph <= 0) {
        return { unit, qty: null, warnings: [`panel ${panel && panel.label ? panel.label : '?'}: dimensions unknown — consumption not computed`] };
    }
    const cutW = pw + 2 * allow, cutH = ph + 2 * allow;
    if (unit === 'EACH') {
        const fw = num(specs.width), fl = num(specs.length);
        if (fw !== null && fl !== null) {
            const fits = (cutW <= fw && cutH <= fl) || (cutW <= fl && cutH <= fw);
            if (!fits) warnings.push(`panel ${panel.label || ''}: ${cutW}×${cutH}" cut does not fit the ${fw}×${fl}" piece`);
        }
        return { unit, qty: 1, warnings };
    }
    const fw = num(specs.width);
    let widths = 1;
    if (fw !== null && fw > 0) widths = Math.max(1, Math.ceil((cutW - 1e-9) / fw));
    else warnings.push(`${(item && (item.legacyErpId || item.itemName)) || 'fabric'}: no width on the item — one width assumed`);
    const step = num(config.yardRounding) === null ? 0.125 : num(config.yardRounding);
    const yards = roundUpTo(widths * cutH / 36, step);
    return { unit, qty: Math.round(yards * 1000) / 1000, widths, warnings };
};

/** Outer-trim inches around the ordered edges + fringe laid on drawn seams (needs seam.lengthIn). */
export const trimInchesOf = (design, dims) => {
    const ot = (design && design.outerTrim) || {};
    let outer = 0;
    if (dims) {
        if (ot.top) outer += dims.w;
        if (ot.bottom) outer += dims.w;
        if (ot.left) outer += dims.h;
        if (ot.right) outer += dims.h;
    }
    let fringe = 0;
    ((design && design.seams) || []).forEach(s => {
        if (/FRINGE/i.test(String(s.treatment || ''))) fringe += num(s.lengthIn) || 0;
    });
    return { outer, fringe };
};

/**
 * The board's `pillowData` (today's shape: fabrics[], seams[] in board pixels, outerTrim, …) as a
 * DESIGN this module prices. `pxPerIn` is the board's drawing scale (VisionPillow: S × 2 = 7 px/in).
 * One panel = the whole face; more than one panel = dimensions UNKNOWN until the board hands over the
 * panel geometry (step 3) — priced, but consumption for those panels is null with a warning.
 */
export const designFromPillowData = (pillowData, { pxPerIn = 7 } = {}) => {
    const pd = pillowData || {};
    const dims = dimsOf(pd.size);
    const fabrics = Array.isArray(pd.fabrics) ? pd.fabrics : [];
    const one = fabrics.length === 1;
    return {
        size: pd.size || '',
        fill: pd.fill || '',
        flange: pd.flange || 'NONE',
        flangeSize: num(pd.flangeSize) || 0,
        stitch: pd.stitch || '',
        panels: fabrics.map((fabricId, i) => ({
            label: String.fromCharCode(65 + i), fabricId: fabricId || '',
            widthIn: one && dims ? dims.w : null, heightIn: one && dims ? dims.h : null,
        })),
        back: pd.back && pd.back.fabricId ? { fabricId: pd.back.fabricId } : null,
        seams: (Array.isArray(pd.seams) ? pd.seams : []).map(s => ({
            id: s.id, treatment: s.treatment || 'STANDARD', trimId: s.trimId || '',
            lengthIn: num(s.lengthIn) !== null ? num(s.lengthIn)
                : (pxPerIn > 0 && [s.x1, s.y1, s.x2, s.y2].every(v => num(v) !== null)
                    ? Math.round(Math.hypot(s.x2 - s.x1, s.y2 - s.y1) / pxPerIn * 100) / 100 : null),
        })),
        outerTrim: { trimId: (pd.outerTrim && pd.outerTrim.trimId) || '', top: !!(pd.outerTrim && pd.outerTrim.top), bottom: !!(pd.outerTrim && pd.outerTrim.bottom), left: !!(pd.outerTrim && pd.outerTrim.left), right: !!(pd.outerTrim && pd.outerTrim.right) },
    };
};

const rowOf = (item, legacyErpId, name, qty, extra = {}) => ({
    name, qty, price: 0, total: 0,
    partHandling: PILLOW_HANDLING, division: PILLOW_DIVISION,
    partId: (item && item.id) || '', legacyErpId: (item && (item.legacyErpId || item.itemId)) || legacyErpId || '',
    finishCode: '', isFee: false, consumes: true,
    ...extra,
});

/**
 * Price one pillow design.
 *   design    from designFromPillowData (or the board's richer step-3 shape with panel dims)
 *   findPart  id → library item (Approved_Designs doc) — the caller's index; null when unknown
 *   config    system/pillow_pricing (DEFAULT_PILLOW_PRICING shape)
 *   qty       pillows ordered (default 1)
 * Returns { ok, errors[], warnings[], group, groupOf, unitPrice, total, holder, rows[], breakdown }.
 * ok === false → NO holder line is produced (a refusal is a refusal); rows still list what could be
 * read so the board can say what is missing.
 */
export function pricePillow({ design, findPart, config = DEFAULT_PILLOW_PRICING, qty = 1 } = {}) {
    const cfg = { ...DEFAULT_PILLOW_PRICING, ...(config || {}) };
    const errors = [], warnings = [];
    const lookup = typeof findPart === 'function' ? findPart : () => null;
    const d = design || {};
    const orderQty = Math.max(1, Math.floor(num(qty) || 1));
    const sizeKey = sizeKeyOf(d.size);
    const dims = dimsOf(d.size);
    if (!sizeKey) errors.push({ code: 'SIZE_UNREADABLE', message: `Pillow size "${d.size || ''}" carries no W×H` });

    // ── the fabrics: every panel, and the back ──────────────────────────────────────────────────
    const panels = Array.isArray(d.panels) ? d.panels : [];
    if (!panels.length) errors.push({ code: 'NO_PANELS', message: 'The design has no fabric panel' });
    const groupOf = {};
    const rows = [];
    const facePanels = panels.map((p, i) => ({ ...p, label: p.label || String.fromCharCode(65 + i) }));
    const backPanel = d.back && d.back.fabricId
        ? { label: 'BACK', fabricId: d.back.fabricId, widthIn: dims ? dims.w : null, heightIn: dims ? dims.h : null }
        : (facePanels[0] && facePanels[0].fabricId
            ? { label: 'BACK', fabricId: facePanels[0].fabricId, widthIn: dims ? dims.w : null, heightIn: dims ? dims.h : null, assumed: true }
            : null);
    if (backPanel && backPanel.assumed) warnings.push('back panel: no back fabric chosen — the first panel\'s fabric is assumed');

    [...facePanels, ...(backPanel ? [backPanel] : [])].forEach(p => {
        if (!p.fabricId) { errors.push({ code: 'FABRIC_MISSING', message: `Panel ${p.label} has no fabric` }); return; }
        const item = lookup(p.fabricId);
        if (!item) { errors.push({ code: 'FABRIC_UNKNOWN', message: `Panel ${p.label}: fabric ${p.fabricId} is not in the library` }); return; }
        const group = priceGroupOf(item);
        if (!group) errors.push({ code: 'FABRIC_NO_GROUP', message: `Panel ${p.label}: ${item.legacyErpId || item.itemName || p.fabricId} carries no price group` });
        else if (groupRankOf(cfg, group) === null) errors.push({ code: 'GROUP_UNKNOWN', message: `Panel ${p.label}: price group ${group} is not in the price table` });
        groupOf[p.label] = group;
        const c = panelConsumptionOf({ item, panel: p, config: cfg });
        c.warnings.forEach(w => warnings.push(w));
        // A fabric PHOTOGRAPHED at a trade show (item.captured, a gallery asset, no library record) prices
        // like any fabric — it carries a group and a width — but nothing in stock can be consumed for it:
        // the row says 'to be sourced' and the order carries the photo, pattern and colour to the office.
        if (item.captured) warnings.push(`panel ${p.label}: ${item.legacyErpId || item.itemName} is a photographed fabric — to be sourced (no stock, no NetSuite line)`);
        rows.push(rowOf(item, p.fabricId, `${item.legacyErpId || item.itemName || p.fabricId} — panel ${p.label}${group ? ` (group ${group})` : ''}${item.captured ? ' · TO BE SOURCED' : ''}`,
            c.qty === null ? null : yd3(c.qty * orderQty), { uom: c.unit, panel: p.label, perPillow: c.qty, ...(item.captured ? { captured: true, consumes: false, assetId: item.assetId || '', patternId: (item.manufacturingSpecs && item.manufacturingSpecs.customData && item.manufacturingSpecs.customData.patternId) || '', color: (item.manufacturingSpecs && item.manufacturingSpecs.customData && item.manufacturingSpecs.customData.color) || '' } : {}) }));
    });

    // ── the size at the highest group ───────────────────────────────────────────────────────────
    const group = highestGroupOf(cfg, Object.values(groupOf));
    let sizePrice = null;
    if (sizeKey && group) {
        sizePrice = sizePriceOf(cfg, sizeKey, group);
        if (sizePrice === null) errors.push({ code: 'SIZE_GROUP_UNPRICED', message: `No price for ${sizeKey} at group ${group}` });
    } else if (sizeKey && !group && !errors.some(e => /FABRIC|GROUP|PANELS/.test(e.code))) {
        errors.push({ code: 'GROUP_UNKNOWN', message: 'No panel carries a ranked price group' });
    }

    // ── labour per custom seam ──────────────────────────────────────────────────────────────────
    const seams = Array.isArray(d.seams) ? d.seams : [];
    const perSeam = num(cfg.seamLabor && cfg.seamLabor.perSeam);
    if (seams.length && perSeam === null) errors.push({ code: 'SEAM_UNPRICED', message: 'The price table has no labour per custom seam' });
    const seamCharge = seams.length && perSeam !== null ? cents(seams.length * perSeam) : 0;

    // ── the custom details ──────────────────────────────────────────────────────────────────────
    const details = [];
    const detailRule = (code) => (cfg.details && cfg.details[code]) || null;
    const addDetail = (code, units, label) => {
        const rule = detailRule(code);
        if (!rule || num(rule.price) === null) { errors.push({ code: 'DETAIL_UNPRICED', message: `${label}: no ${code} row in the price table` }); return; }
        const per = up(rule.per) === 'YARD' ? 'YARD' : 'EACH';
        const u = per === 'YARD' ? Math.round(units * 1000) / 1000 : 1;
        details.push({ code, label, per, units: u, price: cents(num(rule.price) * u) });
    };
    const edge = up(d.flange);
    if (edge && edge !== 'NONE') addDetail(edge, 1, `${edge} edge${num(d.flangeSize) ? ` ${d.flangeSize}"` : ''}`);
    const trim = trimInchesOf(d, dims);
    if (d.outerTrim && d.outerTrim.trimId && trim.outer > 0) {
        const yards = trim.outer / 36;
        addDetail('OUTER_TRIM', yards, 'Outer edge trim');
        const t = lookup(d.outerTrim.trimId);
        if (!t) errors.push({ code: 'TRIM_UNKNOWN', message: `Outer trim ${d.outerTrim.trimId} is not in the library` });
        else rows.push(rowOf(t, d.outerTrim.trimId, `${t.legacyErpId || t.itemName} — outer edge trim`, yd3(roundUpTo(yards, num(cfg.yardRounding) || 0.125) * orderQty), { uom: 'YARD', perPillow: roundUpTo(yards, num(cfg.yardRounding) || 0.125) }));
    }
    const fringeSeams = seams.filter(s => /FRINGE/i.test(String(s.treatment || '')));
    if (fringeSeams.length) {
        if (fringeSeams.some(s => num(s.lengthIn) === null)) warnings.push('a fringe seam has no length — its yardage is not counted');
        const yards = trim.fringe / 36;
        addDetail('FRINGE_SEAM', yards, `Fringe on ${fringeSeams.length} seam${fringeSeams.length === 1 ? '' : 's'}`);
        const byTrim = {};
        fringeSeams.forEach(s => { if (s.trimId) byTrim[s.trimId] = (byTrim[s.trimId] || 0) + (num(s.lengthIn) || 0); });
        Object.entries(byTrim).forEach(([trimId, inches]) => {
            const t = lookup(trimId);
            if (!t) { errors.push({ code: 'TRIM_UNKNOWN', message: `Seam trim ${trimId} is not in the library` }); return; }
            const y = roundUpTo(inches / 36, num(cfg.yardRounding) || 0.125);
            rows.push(rowOf(t, trimId, `${t.legacyErpId || t.itemName} — fringe on seams`, yd3(y * orderQty), { uom: 'YARD', perPillow: y }));
        });
        if (fringeSeams.some(s => !s.trimId)) errors.push({ code: 'TRIM_MISSING', message: 'A fringe seam has no trim chosen' });
    }
    const detailCharge = cents(details.reduce((s, x) => s + x.price, 0));

    // ── what the size includes: fill + zipper, consumed when the table names them ───────────────
    const sizeRow = (cfg.sizes && cfg.sizes[sizeKey]) || {};
    [['fillItem', 'fill insert'], ['zipperItem', 'zipper']].forEach(([field, label]) => {
        const code = sizeRow[field];
        if (!code) return;
        const it = lookup(code);
        if (!it) { warnings.push(`${label} ${code} is not in the library — not consumed`); return; }
        rows.push(rowOf(it, code, `${it.legacyErpId || it.itemName} — ${label}`, orderQty, { uom: 'EACH', perPillow: 1 }));
    });

    const unitPrice = errors.length ? null : cents((sizePrice || 0) + seamCharge + detailCharge);
    const total = unitPrice === null ? null : cents(unitPrice * orderQty);
    const holderCode = (cfg.rollupItem && cfg.rollupItem.legacyErpId) || DEFAULT_PILLOW_PRICING.rollupItem.legacyErpId;
    const holderItem = lookup(holderCode) || lookup(cfg.rollupItem && cfg.rollupItem.itemId) || null;
    const holder = unitPrice === null ? null : {
        name: `Custom Pillow ${sizeKey}${group ? ` · fabric group ${group}` : ''}${seams.length ? ` · ${seams.length} seam${seams.length === 1 ? '' : 's'}` : ''}`,
        qty: orderQty, price: unitPrice, total,
        partHandling: PILLOW_HANDLING, division: PILLOW_DIVISION,
        partId: (holderItem && holderItem.id) || (cfg.rollupItem && cfg.rollupItem.itemId) || '',
        legacyErpId: holderCode, finishCode: '', isFee: false, isRollup: true,
    };
    return {
        ok: errors.length === 0, errors, warnings,
        sizeKey, group, groupOf, unitPrice, total, holder, rows,
        breakdown: { sizePrice, seams: { count: seams.length, each: perSeam, total: seamCharge }, details, detailTotal: detailCharge },
    };
}
