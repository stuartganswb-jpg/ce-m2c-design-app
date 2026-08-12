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
// Tabs H1-138TRV and Discards are ignored by instruction.

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

/**
 * Parse the traverse kit workbook. `sheets` = [{ name, grid: [[cell,…],…] }] (the same shape
 * customerControlFile's loader emits). Returns { family, kits, components, rules, warnings }.
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

    return { family, kits, components, rules, warnings };
}

/**
 * Diff parsed kits/components against the library so the page can show what WOULD change.
 * `libByCode` = Map(code → { id, hasKitAlign, row }) where row = the customer's clientPricing row.
 */
export function diffTraverseKits(parsed, libByCode) {
    const kitEntries = parsed.kits.map(k => {
        const hit = libByCode.get(k.code);
        return { ...k, status: hit ? 'UPDATE' : 'NEW', docId: hit ? hit.id : null };
    });
    const compEntries = parsed.components.map(c => {
        const hit = libByCode.get(c.code);
        return { ...c, status: hit ? 'ALIGN' : 'MISSING', docId: hit ? hit.id : null };
    });
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
