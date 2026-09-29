// BEFORE A PLATED LINE IS PUT AWAY — does NetSuite hold what the put-away is about to post against?
//
// Mark, App Imp 2026-09-28: four put-aways off one plating shipment (PLT-CE-1782150374239, pulled in
// June) failed at the dock with NetSuite's raw words — "Invalid binnumber reference key PLATING" and
// "Please configure the inventory detail in line 1 of the component list". Read live, neither was the
// app's posting shape. The first is NetSuite saying the item is not in that bin at all: H1-75BP-H,
// H1-138BP-S and H1-1ILE held nothing in PLATING any more (moved or counted outside the WMS since the
// pull). The second is H1-75RCP-H/EP3's bill of materials consuming H1-75CP-H — not the part that went
// to plating — so the build looked for H1-75CP-H in PRD-014 and found none.
//
// The put-away posts three things, in order (PickPackApp.putAwayFromCart): the return WIP-Plating →
// Good out of the plating bin, the short-piece scrap out of the same, and the build that consumes the
// raw part. This checks each against NetSuite's live facts BEFORE any of them posts, and when one would
// fail it says so in words the dock can act on — what NetSuite holds, where, and who puts it right.
// Nothing is guessed and nothing is corrected here: NetSuite's stock and BOMs are Stuart / Eric's.
//
// Refuse only on COMPLETE knowledge (the validator rule): no balances read, or a read that may have been
// cut off at SuiteQL's 1000 rows, is unknown — the put-away goes ahead and NetSuite answers as before.
// Pure. The caller reads the rows (platingBalancesSql, assemblyBomSql) and hands them here.

const S = (v) => String(v == null ? '' : v).trim();
const U = (v) => S(v).toUpperCase();
const N = (v) => Number(v) || 0;
const idOf = (v, what) => {
    const id = S(v);
    if (!/^\d+$/.test(id)) throw new Error(`Not a NetSuite ${what} id: "${v}"`);
    return id;
};

export const STATUS_GOOD = '1';
export const STATUS_WIP_PLATING = '13';
export const SUITEQL_PAGE = 1000;

// Every non-zero balance of ONE item at ONE location — by bin and inventory status.
export const platingBalancesSql = (itemId, locationId) =>
    `SELECT BUILTIN.DF(ib.binnumber) AS bin, ib.inventorystatus AS status, BUILTIN.DF(ib.inventorystatus) AS statusname, ib.quantityonhand AS qty `
    + `FROM InventoryBalance ib WHERE ib.item = ${idOf(itemId, 'item')} AND ib.location = ${idOf(locationId, 'location')} AND ib.quantityonhand <> 0`;

// The components of every ACTIVE bill-of-materials revision of an assembly.
export const assemblyBomSql = (assemblyId) =>
    `SELECT DISTINCT c.item AS id, BUILTIN.DF(c.item) AS code FROM assemblyitembom aib `
    + `JOIN bomrevision br ON br.billofmaterials = aib.billofmaterials `
    + `JOIN bomrevisioncomponentmember c ON c.bomrevision = br.id `
    + `WHERE aib.assembly = ${idOf(assemblyId, 'assembly')} AND NVL(br.isinactive, 'F') = 'F'`;

// SuiteQL rows → one shape. A read that filled a whole page may be cut off: that is not knowledge.
export const balancesOf = (rows) => {
    if (!Array.isArray(rows) || rows.length >= SUITEQL_PAGE) return null;
    return rows.map(r => ({ bin: U(r.bin), status: S(r.status), statusName: S(r.statusname), qty: N(r.qty) }));
};
export const bomOf = (rows) => {
    if (!Array.isArray(rows) || rows.length >= SUITEQL_PAGE) return null;
    return rows.map(r => ({ id: S(r.id), code: U(r.code) }));
};

// line: the plating_shipments line (erpId, netSuiteInternalId, platingBin, fromBin, wipReversed,
//       scrapPosted, builtPlacements). got / scrap: what came back / what did not.
// assembly: { id, type } or null (not found). balances / bom: from balancesOf / bomOf (null = unknown).
// Returns { ok: true } or { ok: false, reason, msg }.
export function platingPutAwayCheck({ line, got, scrap = 0, target, assembly, balances, bom, pulledOn = '' }) {
    const l = line || {};
    const code = U(l.erpId);
    const plat = U(l.platingBin);
    const from = U(l.fromBin);
    const stays = 'Nothing was posted. The plated pieces stay on the cart.';
    const refuse = (reason, msg) => ({ ok: false, reason, msg });

    // The finished assembly must exist, and be an assembly, before anything is sent.
    if (!assembly) return refuse('NO_ASSEMBLY', `⛔ Couldn't find ${target} in NetSuite by item id. Confirm the plated assembly exists with ${code} as a BOM component.\n\n${stays}`);
    if (assembly.type && !/assembl/i.test(assembly.type)) return refuse('NOT_AN_ASSEMBLY', `⛔ ${target} is type "${assembly.type}" in NetSuite, not an Assembly, so it cannot be built.\n\n${stays}`);

    const held = (bin, status) => (balances || []).filter(b => b.bin === bin && b.status === status).reduce((a, b) => a + b.qty, 0);
    const holding = () => (balances && balances.length)
        ? balances.map(b => `   ${b.qty} · ${b.bin || '(no bin)'} · ${b.statusName || b.status}`).join('\n')
        : '   none at this location';

    // 1 — the return (and any short-piece scrap) come OUT of WIP-Plating in the plating bin.
    const needWip = (l.wipReversed ? 0 : N(got)) + (l.scrapPosted ? 0 : N(scrap));
    if (balances && needWip > 0 && plat) {
        const have = held(plat, STATUS_WIP_PLATING);
        if (have < needWip) {
            return refuse('NOT_IN_PLATING_BIN',
                `⛔ NetSuite does not hold these pieces where the put-away needs them.\n\n`
                + `${code} went to plating from ${from || 'its bin'}${pulledOn ? ` on ${pulledOn}` : ''}. To bring ${needWip} back, NetSuite must hold ${needWip} × ${code} in ${plat} as WIP-Plating — it holds ${have} there.\n\n`
                + `What NetSuite holds of ${code} at this location now:\n${holding()}\n\n`
                + `The stock was moved or counted outside the WMS since the pull. Stuart / Eric must put NetSuite right — return the pieces to WIP-Plating in ${plat}, or confirm they are already counted as Good — before this line is put away.\n\n${stays}`);
        }
    }

    // 2 — the build consumes the part that went to plating: it must be on the assembly's BOM.
    if (bom && bom.length && !bom.some(c => (S(l.netSuiteInternalId) && c.id === S(l.netSuiteInternalId)) || c.code === code)) {
        return refuse('NOT_ON_BOM',
            `⛔ The build would fail — ${code} is not on ${target}'s bill of materials in NetSuite.\n\n`
            + `NetSuite's BOM for ${target} consumes: ${bom.map(c => c.code).join(', ')}.\n`
            + `The part that went to plating is ${code}, so NetSuite cannot build ${target} from it.\n\n`
            + `The BOM must be corrected in NetSuite (Eric) before this line is put away.${l.wipReversed ? ' The return to Good already posted and will not post again.' : ''}\n\n${stays}`);
    }

    // 3 — once the return has posted, the build takes the pieces as Good from the bin they came back to.
    if (balances && l.wipReversed && from) {
        const built = (Array.isArray(l.builtPlacements) ? l.builtPlacements : []).reduce((a, p) => a + N(p && p.qty), 0);
        const toBuild = N(got) - built;
        const have = held(from, STATUS_GOOD);
        if (toBuild > 0 && have < toBuild) {
            return refuse('NOT_GOOD_IN_FROM_BIN',
                `⛔ The build would fail — it consumes ${toBuild} × ${code} as Good from ${from}, and NetSuite holds ${have} there.\n\n`
                + `What NetSuite holds of ${code} at this location now:\n${holding()}\n\n`
                + `The return to Good already posted. Stuart / Eric must put ${code} right in NetSuite before this line is put away.\n\n${stays}`);
        }
    }
    return { ok: true };
}
