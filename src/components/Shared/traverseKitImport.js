// TRAVERSE KIT SHEET — parse Fabricut_Traverse.xlsx (Stuart 2026-08-12) into kit records, component
// pricing alignment, and the per-length usage rules. Pure module: sheets in ({name, grid}), data
// out — no Firestore, no React, no ExcelJS — so it runs under node --test, which is the only
// verification path this repo has (App Check + PIN gate).
//
// WHY KITS EXIST (Stuart, verbatim intent): "this whole kit exercise is to enable our customers
// with older erp systems (such as Fabricut) to sell these completed systems. for our purposes they
// are only needed strictly to help our CSR align their orders when they come in with a kit code and
// then additional feet." Once the portal is done, the kits retire. So everything here is a SALES
// alignment layer — nothing a kit says ever changes what the shop builds.
//
// THE SHEET SHAPE (tab H1-2TRV): column A = step 3's main answer, column B = the Front Rail
// sub-answer ("rear track front rings" = front-as-ring), C = Category, D = drive, E = mount,
// F = our kit code, G = their pattern #, H/I/J = their net / wholesale / retail, K = description,
// L/M/N = the ADDITIONAL FOOT triple. Category rows:
//   Base Set        → a KIT RECORD. Motorized base sets already price the cheapest motor in
//                     (verified: every per-motor kit differs from its base by exactly the motor
//                     price delta — 60W +100, 45W +100, 50W +25 at every tier checked).
//   Base Plus Motor → NOT a record — an IDENTIFICATION CODE. Fabricut wanted a code per motor;
//                     the only difference is the motor, so each folds onto its base kit as
//                     { code, their sku, which motor }, and CPQ prices the motor as an upcharge.
//   Component       → an EXISTING library item (return arms, brackets, motors) — the importer
//                     aligns the customer's sku/pricing onto it, never creates it.
// Tab "Carrier Parts": more component alignment rows. Tab "Carrier Usage": per-length included
// quantities (TOTALS at each length, not increments) + the configurator item list below row 15.
// Tab "Discards" is ignored by instruction.
//
// TAB H1-138TRV (Stuart 2026-09-10 — "it is time to get these in"): the 1-3/8" traverse, a product
// inside the H1-138 collection. Eleven columns and no header row: A = family label, B = our code,
// C = their pattern, D/E/F = net / wholesale / retail, G = description, H = the word INCREMENT,
// I/J/K = the additional-foot triple. No category column — a row is a KIT when its code parses as
// one (kitCode's grammar, H1-138TRV-4(H|V)D?/(P|EP)) and a COMPONENT otherwise (the H / V brackets
// at three depths, the doubles, the ceiling bracket, the splice). There is no usage table for this
// family and Stuart says there need not be: "the exact same carrier usage and carrier options as the
// H1-2TRV … so just the rod and brackets change." So its rules doc is DERIVED from the H1-2TRV
// Carrier Usage tab — carriers and the configurator list verbatim, the bracket rows re-keyed to this
// family's bracket codes (one row per style, same counts), the splice row re-keyed to its joiner —
// and says so on the doc (`derivedFrom`).

import { parseKitCode } from './kitCode';

const S = (v) => String(v ?? '').trim();
const U = (v) => S(v).toUpperCase();
const money = (v) => { const n = parseFloat(String(v ?? '').replace(/[^0-9.-]/g, '')); return Number.isFinite(n) ? n : null; };

// Accessories that BILL when picked in the configurator (Stuart 2026-08-12: "not included in
// price, all others are"). A SEED, not a law — it lands as a per-item `billable` field on the
// rules doc so the traverse rules tab can change it without touching code.
export const BILLABLE_ACCESSORY_SEED = ['HSOM-19', 'HSOM-39', 'HSOM-23', 'HSOM-45', 'HSOM-42', 'HSOM-40', 'HSOM-44', 'HSOM-43', 'HSOM-46', 'HSOM-47', 'HSOM-48'];

const setupOf = (a) => /DOUBLE/.test(U(a)) ? 'DOUBLE' : /SINGLE/.test(U(a)) ? 'SINGLE' : '';
// Front rail: only meaningful on a DOUBLE ("rear track front rings" = the front-as-ring option the
// CPQ flow already models). Singles normalize to TRACK regardless of what column B says — rows
// 63–68 carry a pasted-over "front and rear" on Single rows.
const frontRailOf = (setup, b) => setup === 'DOUBLE' && /RING/.test(U(b)) ? 'RING' : 'TRACK';
const driveOf = (d) => /MOTOR/.test(U(d)) ? 'MOTORIZED' : /MANUAL/.test(U(d)) ? 'MANUAL' : '';
const mountOf = (e) => /CEIL/.test(U(e)) ? 'CEILING' : /WALL/.test(U(e)) ? 'WALL' : '';
// Material-finish from the code suffix: /P painted aluminum, /EP plated aluminum, /W wood.
const materialOf = (code) => { const m = U(code).match(/\/(EP|P|W)(?:-|$)/); return m ? m[1] : ''; };

const axesKey = (k) => [k.setup, k.frontRail, k.drive, k.mount, k.material].join('|');

// THE 1-3/8" TRAVERSE FAMILY'S PARTS — read off tab H1-138TRV and S1's tag audit of 2026-09-10 (the
// rod H1-138TRV is pinned as the fascia role at 1.6 #19–#21; brackets and plates at #26–#37).
// Exported so the explosion's family table (Shared/traverseExplode, S1's) and the rules doc built
// here key the SAME bracket codes — a bracket the explosion names must be a row the rules doc has.
// Unlike H1-2TRV this family has ONE per-foot part (the rod IS the track), brackets in two STYLES
// at every depth, and no fascia, plug or base motor.
// ⚠ FABRICUT'S "BRACKET" IS TWO OF OUR ITEMS (read from the live pins and library, 2026-09-10
// evening — Stuart confirmed). The sheet sells H1-138TRV-H / -V ("horizontal / vertical bracket")
// at three depths, a double and a ceiling; the H1-138 assembly pins bracket ARMS by depth
// (H1-138TRVSBA 3-5/8", EBA 4-5/8", 6BA 6", DBA double, CBA ceiling — traverseRole TRV_BRACKET) and
// BACKPLATES by orientation (H1-138TRVBP-H, BP-V, BP-C — TRV_BACKPLATE), each in /P, /EP1–6, /P25.
// So a sheet "bracket" = the arm at the sold depth + the plate in the sold orientation, one of each
// per bracket position. The STYLE letter keys the PLATE; the depth keys the ARM.
export const H1_138TRV_PARTS = {
    rod: 'H1-138TRV',
    brackets: {
        SINGLE: { '3.625': 'H1-138TRVSBA', '4.625': 'H1-138TRVEBA', '6': 'H1-138TRV6BA' },
        DOUBLE: 'H1-138TRVDBA',
        CEILING: 'H1-138TRVCBA',
    },
    // One plate per bracket, by the kit's bracketStyle (H / V); the ceiling arm takes the ceiling plate.
    plates: { H: 'H1-138TRVBP-H', V: 'H1-138TRVBP-V', CEILING: 'H1-138TRVBP-C' },
    splice: 'H1-138TRVJNR',
};

// How an H1-2TRV usage row maps onto this family — the SAME counts, this family's codes. The single
// and double bracket rows become ARM rows; the plates ride the standard-depth row's counts (a plate
// per bracket at any depth). A row this table does not name (DRTWB, the ring-front double: no 1-3/8"
// equivalent) is dropped, and said so.
const H1_138TRV_FROM_H1_2TRV = {
    'H1-2TRV-WB': ['H1-138TRVSBA', 'H1-138TRVBP-H', 'H1-138TRVBP-V'],
    'H1-2TRV-EWB': ['H1-138TRVEBA'],
    'H1-2TRV-6WB': ['H1-138TRV6BA'],
    'H1-2TRV-DWB': ['H1-138TRVDBA'],
    'H1-2TRVSPLC': ['H1-138TRVJNR'],
};

// A sheet combo code → the arm and the plate it stands for. `H1-138TRV-(H|V)(E|6|D)?` and the
// ceiling `H1-138TRV-C`; the finish suffix (/P, /EP) is the TIER the price belongs to.
const COMBO_ARM = { '': 'H1-138TRVSBA', E: 'H1-138TRVEBA', '6': 'H1-138TRV6BA', D: 'H1-138TRVDBA' };
export function splitComboCode(code) {
    const c = U(code);
    let m = c.match(/^H1-138TRV-([HV])(E|6|D)?\/(P|EP)$/);
    if (m) return { arm: COMBO_ARM[m[2] || ''], plate: H1_138TRV_PARTS.plates[m[1]], style: m[1], depth: m[2] || '', tier: m[3] };
    m = c.match(/^H1-138TRV-C\/(P|EP)$/);
    if (m) return { arm: H1_138TRV_PARTS.brackets.CEILING, plate: H1_138TRV_PARTS.plates.CEILING, style: 'C', depth: 'C', tier: m[1] };
    return null;
}

/** Tab H1-138TRV → { family, kits, components, rules, warnings }. `baseRules` = the H1-2TRV rules doc. */
function parseH1138Tab(sheet, baseRules) {
    const family = 'H1-138TRV';
    const warnings = [];
    const kits = [];
    const components = [];
    (sheet?.grid || []).forEach((row, i) => {
        const [, code, fabSku, net, sales, retail, name, , ftNet, ftSales, ftRetail] = row;
        if (!S(code)) return;
        const parsed = parseKitCode(code);
        if (parsed && parsed.family === family) {
            if (money(ftNet) === null) warnings.push(`Row ${i + 1} (${U(code)}): a kit row with no additional-foot price`);
            kits.push({
                code: U(code), fabSku: S(fabSku), name: S(name), align: parsed.align,
                net: money(net), sales: money(sales), retail: money(retail),
                perFootNet: money(ftNet), perFootSales: money(ftSales), perFootRetail: money(ftRetail),
                motorCodes: [],
            });
        } else {
            components.push({ code: U(code), fabSku: S(fabSku), net: money(net), sales: money(sales), retail: money(retail), name: S(name) });
        }
    });
    if (!kits.length) warnings.push('H1-138TRV tab: no kit rows recognised — is the code column B?');

    // ── the combo codes → arm + plate rows (Stuart 2026-09-10: "on the arm; plates $0") ──────────
    // The ARM carries the combo's price with the H pattern as its SKU; each PLATE gets a $0 row
    // carrying its own pattern (the standard-depth combo's — a plate is not depth-specific), so a
    // typed Fabricut pattern still resolves to an item. `finishTier` says which variants the row
    // belongs to (diffTraverseKits expands it against the library: /P, or every /EPn and /P25).
    const mapped = [];
    const combos = components.filter(c => splitComboCode(c.code));
    const plain = components.filter(c => !splitComboCode(c.code));
    const armRows = new Map();     // arm|tier → entry (from the H combo; V must agree on price)
    const plateRows = new Map();   // plate|tier → entry (first = standard depth)
    // The sheet lists the V rows before the H rows — walk the H (and ceiling) combos first so the
    // arm's row is the H combo's whatever the sheet's order, then let each V combo check the price.
    const ordered = [...combos.filter(c => splitComboCode(c.code).style !== 'V'), ...combos.filter(c => splitComboCode(c.code).style === 'V')];
    ordered.forEach(c => {
        const x = splitComboCode(c.code);
        const armKey = `${x.arm}|${x.tier}`;
        const h = armRows.get(armKey);
        if (!h) armRows.set(armKey, { code: x.arm, finishTier: x.tier, fabSku: c.fabSku, net: c.net, sales: c.sales, retail: c.retail, name: c.name, derivedFrom: c.code });
        else if (x.style === 'V' && (h.net !== c.net || h.sales !== c.sales || h.retail !== c.retail)) warnings.push(`${c.code}: the V combo prices differently from the H combo (${c.net} vs ${h.net}) — the arm carries the H price; check the sheet`);
        const plateKey = `${x.plate}|${x.tier}`;
        if (!plateRows.has(plateKey)) plateRows.set(plateKey, { code: x.plate, finishTier: x.tier, fabSku: c.fabSku, net: 0, sales: 0, retail: 0, name: `${c.name} (plate — included with the arm)`, derivedFrom: c.code });
        mapped.push({ from: c.code, arm: x.arm, plate: x.plate, tier: x.tier });
    });
    components.length = 0;
    components.push(...plain, ...armRows.values(), ...plateRows.values());

    // ── the rules doc, derived (see the header) ─────────────────────────────────────────────
    const rules = { family, usage: [], configurator: [], updatedFrom: 'Fabricut_Traverse.xlsx', derivedFrom: 'H1-2TRV Carrier Usage (Stuart 2026-09-10: same carrier usage and options — only the rod and brackets change)' };
    if (baseRules && baseRules.usage.length) {
        const dropped = [];
        baseRules.usage.forEach(u => {
            const id = U(u.itemId);
            if (/CARRIER/i.test(S(u.label))) { rules.usage.push({ ...u, byFeet: { ...u.byFeet } }); return; }
            const to = H1_138TRV_FROM_H1_2TRV[id];
            if (!to) { dropped.push(id); return; }
            to.forEach(code => rules.usage.push({
                itemId: code, fabSku: '',
                label: /BP-/.test(code) ? `Backplates (${code}) — one per bracket` : S(u.label).replace(/H1-2TRV\S*/g, code),
                byFeet: { ...u.byFeet }, derivedFrom: id,
            }));
        });
        baseRules.configurator.forEach(c => {
            const id = U(c.itemId);
            const to = H1_138TRV_FROM_H1_2TRV[id];
            if (to) to.forEach(code => rules.configurator.push({ ...c, itemId: code, fabSku: '', derivedFrom: id }));
            else rules.configurator.push({ ...c });
        });
        if (dropped.length) warnings.push(`H1-138TRV rules: no 1-3/8" equivalent for ${dropped.join(', ')} — row(s) not carried`);
    } else warnings.push('H1-138TRV rules: no Carrier Usage tab to derive from — rules not imported');
    return { family, kits, components, rules, warnings, mapped };
}

// The library codes a tiered component row belongs to: /P → the shared paint item; EP → every
// plated variant that exists (/EP1…/EPn and /P25, the plated tier by the same rule 4.6's control
// file uses). `libCodes` = every code the library carries. Empty = nothing to align to.
export function tierTargets(base, tier, libCodes) {
    const b = U(base); const t = U(tier);
    if (!t) return libCodes.has(b) ? [b] : [];
    if (t === 'P') return libCodes.has(`${b}/P`) ? [`${b}/P`] : [];
    const out = [];
    libCodes.forEach(c => { if (c.startsWith(`${b}/`) && /^(EP\d*|P25)$/.test(c.slice(b.length + 1))) out.push(c); });
    return out.sort();
}

/**
 * Parse the traverse kit workbook. `sheets` = [{ name, grid: [[cell,…],…] }] (the same shape
 * customerControlFile's loader emits). Returns { family, kits, components, rules, warnings,
 * families } — the top-level fields are the H1-2TRV tab's (every reader since 08-12 expects them
 * there); `families` lists every family the workbook carries, H1-2TRV first, each in the same
 * shape, and is what the 4.6 import walks.
 */
export function parseTraverseKitSheets(sheets) {
    const warnings = [];
    const byName = new Map(sheets.map(s => [U(s.name), s]));
    const main = byName.get('H1-2TRV');
    if (!main) throw new Error('No H1-2TRV tab in this workbook — is this the traverse kit sheet?');
    const family = 'H1-2TRV';

    // ── main tab rows ────────────────────────────────────────────────────────────────────────────
    const kits = [];            // Base Set rows
    const motorRows = [];       // Base Plus Motor rows, folded onto kits below
    const components = [];      // Component rows (+ Carrier Parts tab appended after)
    main.grid.forEach((row, i) => {
        if (i < 2) return; // two header rows
        const [a, b, cat, drive, mount, code, fabSku, net, sales, retail, name, ftNet, ftSales, ftRetail] = row;
        const c = U(cat);
        if (!S(code)) return;
        if (c === 'BASE SET') {
            const align = { setup: setupOf(a), frontRail: '', drive: driveOf(drive), mount: mountOf(mount), material: materialOf(code), minFeet: 4 };
            align.frontRail = frontRailOf(align.setup, b);
            if (!align.setup || !align.drive || !align.mount || !align.material) { warnings.push(`Row ${i + 1} (${S(code)}): could not read all axes — skipped`); return; }
            kits.push({
                code: U(code), fabSku: S(fabSku), name: S(name), align,
                net: money(net), sales: money(sales), retail: money(retail),
                perFootNet: money(ftNet), perFootSales: money(ftSales), perFootRetail: money(ftRetail),
                motorCodes: [],
            });
        } else if (c === 'BASE PLUS MOTOR') {
            motorRows.push({ i: i + 1, a, b, drive, mount, code: U(code), fabSku: S(fabSku), net: money(net), sales: money(sales), retail: money(retail) });
        } else if (c === 'COMPONENT') {
            components.push({ code: U(code), fabSku: S(fabSku), net: money(net), sales: money(sales), retail: money(retail), name: S(name) });
        }
    });

    // Motor wattage → motor item, read from the motor COMPONENT descriptions ("SOMFY GLYDEA ULTRA
    // 35W…") — data, not a hardcode, so a new motor row simply works.
    const motorByWatt = {};
    components.forEach(cmp => {
        if (!/^HSOM-/.test(cmp.code)) return;
        const w = S(cmp.name).match(/(\d+)\s*W\b/i);
        if (w) motorByWatt[w[1]] = cmp.code;
    });

    // Fold each per-motor code onto its base kit, matched by the axes. The -NN{W|C} suffix: digits
    // are the motor wattage, the LETTER is the mount (W wall / C ceiling) — not wood.
    const kitByAxes = new Map(kits.map(k => [axesKey(k.align), k]));
    motorRows.forEach(r => {
        const m = r.code.match(/-(\d+)(W|C)$/);
        const watt = m ? m[1] : null;
        const align = { setup: setupOf(r.a), frontRail: '', drive: driveOf(r.drive), mount: mountOf(r.mount), material: materialOf(r.code) };
        align.frontRail = frontRailOf(align.setup, r.b);
        const base = kitByAxes.get(axesKey({ ...align, minFeet: 4 }));
        const motorItem = watt ? motorByWatt[watt] : null;
        if (!base) { warnings.push(`Row ${r.i} (${r.code}): no Base Set kit matches its axes — code not attached`); return; }
        if (!motorItem) { warnings.push(`Row ${r.i} (${r.code}): could not resolve its motor from the wattage — code attached without one`); }
        base.motorCodes.push({ code: r.code, fabSku: r.fabSku, motorItem: motorItem || '', net: r.net, sales: r.sales, retail: r.retail });
    });

    // ── Carrier Parts tab → more component alignment ─────────────────────────────────────────────
    const cp = byName.get('CARRIER PARTS');
    if (cp) cp.grid.forEach(row => {
        const code = U(row[5]); if (!code) return;
        components.push({ code, fabSku: S(row[6]), net: money(row[7]), sales: money(row[8]), retail: money(row[9]), name: S(row[10]) });
    });

    // ── Carrier Usage tab → the rules doc ────────────────────────────────────────────────────────
    // Quantities are the TOTAL needed at each length, not the per-foot increment (Stuart: "each of
    // those additional feet details the total number needed for that length").
    const rules = { family, usage: [], configurator: [], updatedFrom: 'Fabricut_Traverse.xlsx' };
    const cu = byName.get('CARRIER USAGE');
    if (cu) {
        // header row: find the one whose cells read 2-FT … 36-FT
        const hdrIdx = cu.grid.findIndex(r => r.some(c => /^\d+-FT$/i.test(S(c))));
        const hdr = hdrIdx >= 0 ? cu.grid[hdrIdx] : [];
        const feetCols = []; hdr.forEach((c, ci) => { const m = S(c).match(/^(\d+)-FT$/i); if (m) feetCols.push([parseInt(m[1]), ci]); });
        let belowSelectable = false;
        cu.grid.forEach((row, i) => {
            if (i <= hdrIdx) return;
            const joined = row.map(S).join(' ');
            if (/items below/i.test(joined)) { belowSelectable = true; return; }
            const itemId = U(row[1]); if (!itemId || /^ITEM/i.test(S(row[1]))) return;
            if (!belowSelectable) {
                const byFeet = {}; feetCols.forEach(([ft, ci]) => { const n = money(row[ci]); if (n !== null) byFeet[ft] = n; });
                if (!Object.keys(byFeet).length) return; // the spacing info row
                rules.usage.push({ itemId, fabSku: S(row[2]), label: S(row[3]), byFeet });
            } else {
                const drive = driveOf(row[0]) || (/BOTH/i.test(S(row[0])) ? 'BOTH' : 'BOTH');
                rules.configurator.push({ itemId, fabSku: S(row[2]), drive, billable: BILLABLE_ACCESSORY_SEED.includes(itemId) });
            }
        });
    } else warnings.push('No Carrier Usage tab — rules not imported');

    // ── the second family, when the workbook carries its tab ────────────────────────────────
    const families = [{ family, kits, components, rules, warnings }];
    const t138 = byName.get('H1-138TRV');
    if (t138) {
        const f = parseH1138Tab(t138, rules);
        families.push(f);
        f.warnings.forEach(w => warnings.push(w));
    }
    return { family, kits, components, rules, warnings, families };
}

/**
 * Diff parsed kits/components against the library so the page can show what WOULD change.
 * `libByCode` = Map(code → { id, hasKitAlign, row }) where row = the customer's clientPricing row.
 */
export function diffTraverseKits(parsed, libByCode) {
    // Every family the workbook carries, each entry stamped with its family so the apply writes
    // the right kitFamily and rules doc. A parse result from before `families` existed is one family.
    const fams = Array.isArray(parsed.families) && parsed.families.length ? parsed.families : [parsed];
    const kitEntries = fams.flatMap(f => f.kits.map(k => {
        const hit = libByCode.get(k.code);
        return { ...k, family: f.family, status: hit ? 'UPDATE' : 'NEW', docId: hit ? hit.id : null };
    }));
    const libCodes = new Set([...libByCode.keys()].map(U));
    const compEntries = fams.flatMap(f => f.components.flatMap(c => {
        if (c.finishTier) {
            // A tiered row lands on every variant of its tier that exists; none = MISSING, named
            // by the combo it came from so the operator sees Fabricut's code, not ours.
            const targets = tierTargets(c.code, c.finishTier, libCodes);
            if (!targets.length) return [{ ...c, code: c.derivedFrom || c.code, family: f.family, status: 'MISSING', docId: null }];
            return targets.map(code => ({ ...c, code, family: f.family, status: 'ALIGN', docId: libByCode.get(code).id }));
        }
        const hit = libByCode.get(c.code);
        return [{ ...c, family: f.family, status: hit ? 'ALIGN' : 'MISSING', docId: hit ? hit.id : null }];
    }));
    return { kitEntries, compEntries };
}

// The clientPricing row a kit or component gets for this customer. Kits carry the per-foot triple
// ON the row — per-customer data lives with the customer, so a second customer's kit pricing is
// just another row (Stuart: "i want to build these tools so there are fields to make everything
// work rather than just coded to fabricut").
export function kitPricingRow(entry, { customerId, customerName, user }) {
    return {
        customerId, customerName: customerName || '',
        clientSku: entry.fabSku || '',
        ...(entry.net !== null ? { price: entry.net } : {}),
        ...(entry.sales !== null ? { clientSalesPrice: entry.sales } : {}),
        ...(entry.retail !== null ? { clientRetailPrice: entry.retail } : {}),
        ...(entry.perFootNet != null ? { perFootPrice: entry.perFootNet } : {}),
        ...(entry.perFootSales != null ? { perFootSales: entry.perFootSales } : {}),
        ...(entry.perFootRetail != null ? { perFootRetail: entry.perFootRetail } : {}),
        source: 'KIT_IMPORT', updatedAt: Date.now(), updatedBy: String(user || ''),
    };
}
