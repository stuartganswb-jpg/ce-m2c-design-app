// Fabricut CrossReference import — parses Fabricut_CE_CrossReference.xlsx (CE item # ↔ Fabricut
// code + Retail/Sale prices) and produces a STAMPING PLAN for the Master Library: Fabricut pricing
// (retail = Fabricut MSRP, cost = CE's price to Fabricut) per finish variant, plus the sizeKey
// metadata the H1 size-matrix flows resolve through (family / diameter / style / projection).
// Pure planner (no Firestore): parse → buildFabricutPlan(rows, libIndex) → caller batch-writes.
// Idempotent by design — re-running after Stuart extends the xlsx (poles/finials/rings) simply
// stamps the new rows; existing user-edited fields (names, dims) are never touched.
import ExcelJS from 'exceljs/dist/exceljs.min.js';

// Header contract (lowercased, trimmed). Sheets qualify when ceItem + retail + sale all resolve —
// this skips the "Fabricut to CE Components" and "Notes" sheets automatically, and survives the
// column-order difference between the Non-Traversing and Traversing sheets.
const HEADER_KEYS = {
    ceItem: 'ce item #',
    desc: 'ce description',
    collection: 'collection',
    itemType: 'ce item type',
    fabCode: 'fabricut code',
    retail: 'retail price',
    wholesale: 'wholesale price', // added July 9 (uniformly retail ÷ 2 = Fabricut street price); optional
    sale: 'sale price',
};

// Collection → size-matrix family + diameter token (the token is the literal chunk of the CE code
// between "H1-" and the style, so stripping it yields the style: H1-138ILJLE → ILJLE).
const FAMILY_BY_COLLECTION = {
    '3/4" round': { family: 'H1-RND', dia: '75' },
    '1" round': { family: 'H1-RND', dia: '1' },
    '1-3/8" round': { family: 'H1-RND', dia: '138' },
    '1 3/8" round': { family: 'H1-RND', dia: '138' }, // July 9 rows use the space dialect
    '3/4" square': { family: 'H1-SQ', dia: '75S' },
    '2" rectangular': { family: 'H1-RECT', dia: '2RCT' },
    '1" brass': { family: 'H1-BRASS', dia: '1B' },
    '1 3/8" traverse': { family: 'H1-TRV138', dia: '138TRV' },
    '2" traverse': { family: 'H1-TRV2', dia: '2TRV' },
};

const normHeader = (v) => String(v || '').trim().toLowerCase().replace(/\s+/g, ' ');
const parseNum = (v) => { const n = parseFloat(String(v ?? '').replace(/[$,]/g, '')); return Number.isFinite(n) ? n : null; };

// Projection letter from the CE description — the description is the reliable source ("(3-5/8" P)"
// etc.); deriving from the code alone is ambiguous (H1-75D double vs H1-75DS decorative-short).
export function projLetterFromDesc(desc) {
    const d = String(desc || '');
    if (/\(\s*3\s*-?\s*5\/8|\(\s*3\.625/i.test(d)) return 'S';
    if (/\(\s*4\s*-?\s*5\/8|\(\s*4\.625/i.test(d)) return 'E';
    if (/\(\s*6\s*("|”|in)?\s*P\s*\)/i.test(d)) return '6';
    if (/\(\s*(?:3\s*-?\s*1\/4|3\.25|6\s*-?\s*1\/2|6\.5)[^)]*&[^)]*\)/i.test(d)) return 'D'; // dual-projection doubles
    return '';
}

export const PROJECTION_BY_LETTER = { S: '3.625', E: '4.625', 6: '6', D: '3.25;6.5' };

// Style = CE base code minus the H1- prefix and the diameter token; the projection letter (when the
// description carries one) is stripped off the tail so all sizes/projections of one design share a
// style. If stripping would leave nothing (H1-75D, Decorative Double) the token IS the style.
export function styleFromCode(baseCode, diaToken, projLetter) {
    let t = String(baseCode || '').trim().toUpperCase();
    t = t.replace(/^H1-/, '');
    if (diaToken && t.startsWith(diaToken)) t = t.slice(diaToken.length);
    t = t.replace(/^-/, '');
    if (projLetter && projLetter !== '' && t.length > 1) {
        const tail = projLetter; // 'S' | 'E' | '6' | 'D'
        if (t.endsWith(tail)) { const s = t.slice(0, -1); if (s) t = s; }
    }
    return t;
}

// Read every qualifying sheet of the workbook into flat row objects. Header-matched (not
// position-matched) so reordered or extra columns never break the import.
export async function parseFabricutWorkbook(file) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await file.arrayBuffer());
    const rows = [];
    const sheetsRead = [], sheetsSkipped = [];
    wb.worksheets.forEach(ws => {
        const colFor = {};
        ws.getRow(1).eachCell((cell, colNumber) => {
            const h = normHeader(cell.value);
            Object.entries(HEADER_KEYS).forEach(([key, header]) => { if (h === header) colFor[key] = colNumber; });
        });
        if (!colFor.ceItem || !colFor.retail || !colFor.sale) { sheetsSkipped.push(ws.name); return; }
        sheetsRead.push(ws.name);
        ws.eachRow((row, rowNumber) => {
            if (rowNumber === 1) return;
            const get = (k) => { const c = colFor[k]; if (!c) return ''; const v = row.getCell(c).value; return String((v && v.result !== undefined ? v.result : v) ?? '').trim(); };
            const ceItem = get('ceItem').toUpperCase();
            if (!ceItem || ceItem === '(NONE)') return;
            const cellNum = (k) => { const c = colFor[k]; if (!c) return null; const v = row.getCell(c).value; return parseNum(v && v.result !== undefined ? v.result : v); };
            rows.push({
                ceItem,
                desc: get('desc'),
                collection: get('collection'),
                itemType: get('itemType'),
                fabCode: get('fabCode').toUpperCase(),
                retail: cellNum('retail'),
                wholesale: cellNum('wholesale'),
                sale: cellNum('sale'),
                sheet: ws.name,
            });
        });
    });
    return { rows, sheetsRead, sheetsSkipped };
}

// Build the stamping plan. libIndex = [{ docId, code, hasProjection, hasBpo }] for every library
// doc (code = legacyErpId/itemId, uppercased). Returns { stamps, gaps, stats } — stamps are
// { docId, code, patch } ready for setDoc(..., { merge: true }).
//
// Tier rules (mirrors the xlsx + the live NetSuite variant set /P /P25 /EP1..6):
//   xlsx "/P" row  → painted tier → stamps every library variant whose suffix starts with "P"
//   xlsx "/EP" row → plated tier  → stamps every variant whose suffix starts with "EP"
//   any other exact suffix in the xlsx (brass /B /BL /PL) stamps that exact variant only
//   BP/RBP carry no prices (arm price includes the plate) — their variants get retail/cost null,
//   CP/RCP rows carry the flat upcharge (40/10) and stamp normally. No special-casing needed.
export function buildFabricutPlan(rows, libIndex, nowTs) {
    const ts = nowTs || Date.now();
    // group xlsx rows by base code
    const groups = new Map();
    rows.forEach(r => {
        const [base, suffix = ''] = r.ceItem.split('/');
        if (!groups.has(base)) groups.set(base, { base, tiers: {}, exact: {}, desc: r.desc, collection: r.collection, itemType: r.itemType, fabByTier: {} });
        const g = groups.get(base);
        if (!g.desc && r.desc) g.desc = r.desc;
        const tier = suffix === 'P' ? 'P' : suffix === 'EP' ? 'EP' : null;
        const priceObj = { retail: r.retail, cost: r.sale, wholesale: r.wholesale ?? null };
        // fabCode per tier is a SET: plate rows repeat once per compatible bracket code, so a
        // multi-coded tier means "no single Fabricut code" (plates aren't standalone Fabricut items).
        if (tier) { g.tiers[tier] = priceObj; (g.fabByTier[tier] = g.fabByTier[tier] || new Set()).add(r.fabCode); }
        else if (suffix) g.exact[suffix] = { ...priceObj, fabCode: r.fabCode };
        // Suffixless row = a single-finish item (natural wood / acrylic / raw aluminum — no paint or
        // plate tiers, July 9 additions): its prices stamp the BASE doc directly.
        else { g.tiers.BASE = priceObj; (g.fabByTier.BASE = g.fabByTier.BASE || new Set()).add(r.fabCode); }
    });

    // group library codes by base for prefix lookup
    const libByBase = new Map();
    libIndex.forEach(li => {
        const [base] = li.code.split('/');
        if (!libByBase.has(base)) libByBase.set(base, []);
        libByBase.get(base).push(li);
    });

    const stamps = [];
    const gaps = [];
    let basesMatched = 0, variantsStamped = 0, basesStamped = 0;

    groups.forEach(g => {
        const targets = libByBase.get(g.base) || [];
        if (!targets.length) { gaps.push({ base: g.base, desc: g.desc, collection: g.collection }); return; }
        basesMatched++;

        const fam = FAMILY_BY_COLLECTION[normHeader(g.collection)] || null;
        const projLetter = projLetterFromDesc(g.desc);
        const style = fam ? styleFromCode(g.base, fam.dia, projLetter) : null;

        targets.forEach(li => {
            const suffix = li.code.includes('/') ? li.code.split('/')[1] : '';
            const patch = { manufacturingSpecs: {} };

            if (!suffix) {
                // BASE (mill) doc: full tier record + size metadata for the matrix resolver.
                const fab = { importedAt: ts, source: 'CrossReference' };
                if (g.tiers.P) { fab.paintedRetail = g.tiers.P.retail; fab.paintedCost = g.tiers.P.cost; fab.paintedWholesale = g.tiers.P.wholesale; }
                if (g.tiers.EP) { fab.platedRetail = g.tiers.EP.retail; fab.platedCost = g.tiers.EP.cost; fab.platedWholesale = g.tiers.EP.wholesale; }
                // Single-finish item (suffixless xlsx row): the base doc IS the sellable item — stamp
                // the same {retail, cost, wholesale, tier} shape variants carry so pricing reads uniformly.
                if (g.tiers.BASE) { fab.retail = g.tiers.BASE.retail; fab.cost = g.tiers.BASE.cost; fab.wholesale = g.tiers.BASE.wholesale; fab.tier = 'BASE'; }
                if (g.fabByTier.P?.size === 1) fab.fabCodePainted = [...g.fabByTier.P][0];
                if (g.fabByTier.EP?.size === 1) fab.fabCodePremium = [...g.fabByTier.EP][0];
                if (g.fabByTier.BASE?.size === 1) fab.fabCodeBase = [...g.fabByTier.BASE][0];
                Object.keys(g.exact).forEach(sfx => { fab[`exact_${sfx}`] = { retail: g.exact[sfx].retail, cost: g.exact[sfx].cost, wholesale: g.exact[sfx].wholesale, fabCode: g.exact[sfx].fabCode }; });
                patch.manufacturingSpecs.fabricut = fab;

                const customData = {};
                if (fam && fam.family) {
                    customData.sizeKey = { family: fam.family, dia: fam.dia, style, projLetter: projLetter || '' };
                }
                if (!li.hasProjection && projLetter && PROJECTION_BY_LETTER[projLetter]) customData.projection = PROJECTION_BY_LETTER[projLetter];
                // plate orientation from the style suffix (BP-H / CP-V / RBP-R / RCP-S)
                if (!li.hasBpo && style && /^R?[BC]P-[HRSV]$/.test(style)) {
                    customData.bpOrientation = { H: 'HORIZONTAL', R: 'ROUND', S: 'SQUARE', V: 'VERTICAL' }[style.slice(-1)];
                }
                if (Object.keys(customData).length) patch.manufacturingSpecs.customData = customData;
                basesStamped++;
            } else {
                // VARIANT doc: resolve its tier prices — exact xlsx suffix wins, then P*/EP* prefix.
                let src = g.exact[suffix] || null;
                if (!src && suffix.startsWith('EP')) src = g.tiers.EP || null;
                if (!src && suffix.startsWith('P')) src = g.tiers.P || null;
                if (!src && g.tiers.BASE) src = g.tiers.BASE; // single-finish pricing covers oddball variants (e.g. wood -O/-W species)
                if (!src) return; // no price data for this variant's tier — leave untouched
                patch.manufacturingSpecs.fabricut = {
                    retail: src.retail, cost: src.cost, wholesale: src.wholesale ?? null,
                    tier: g.exact[suffix] ? suffix : (suffix.startsWith('EP') ? 'EP' : suffix.startsWith('P') ? 'P' : 'BASE'),
                    importedAt: ts, source: 'CrossReference',
                };
                variantsStamped++;
            }
            stamps.push({ docId: li.docId, code: li.code, patch });
        });
    });

    return { stamps, gaps, stats: { xlsxBases: groups.size, basesMatched, basesStamped, variantsStamped } };
}
