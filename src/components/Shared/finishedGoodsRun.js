// FINISHED-GOODS RUN PLANNER — the answer to "is this work order creating STOCK or FINISHED
// items?" (Stuart 2026-08-10: "all work order tools need to know are they creating stock or
// finished items, and if they are creating finished items the tool must first go and check the
// stock situation on all the bom components").
//
// The two fundamental work-order types:
//   STOCK     shop floor builds the raw BOM components; the convert stage phosphates them into
//             /P cores (every painted finish except P25).
//   FINISHED  the finishing floor pulls /P phosphated stock and paints it in-house, OR the mill
//             cores are pulled and sent to the outsourced plater (EPn / MEP* / P25).
//
// This module plans a FINISHED run: explode the assembly's BOM (assembly_pins) into the exact
// pull lines the WMS should pick, decide in-house vs plater from the item's own finish suffix,
// and shape the stock check. It is PURE (no Firestore/NetSuite imports at module level) so the
// plan can be asserted in node --test; the one network helper does a dynamic import.
//
// The bug this replaces (WO-HRW-138TRAVATB-P-906470): the Master Library tool wrote partsList: []
// with a display label as `recipe`, so the finishing Setup Queue synthesized a single raw pull of
// the ASSEMBLY's mill code — a code that never holds stock, because only its three components do.

// Explicit .js extension so node --test can import this module directly (webpack accepts both).
import { isOutsourcedFinishCode, finishSuffixOf, millBaseOf } from './finishRouting.js';

// Same precision rule as WMS/SetupQueue: fee/return/splice NAME test only when no real id.
const FEEISH_RE = /\b(FRENCH|MITERED|MITER|BENT)\s+RETURN\b|\bSPLICE\b|\bFEE\b/i;

export const isAssemblyPart = (part) => ['Master Assembly', 'Assembly'].includes(String((part && part.partClass) || ''));

export const erpOf = (part) => String((part && (part.legacyErpId || part.itemId)) || '').toUpperCase();

// A BOM pin that represents a real physical component (not a hidden/fee/placeholder line).
export const usablePin = (pin) => {
    if (!pin || pin.isHiddenPart || pin.isFee) return false;
    const pid = String(pin.legacyErpId || pin.partId || '');
    if (!pid || pid === 'PENDING' || pid === 'N/A' || pid === 'UNASSIGNED') return false;
    if (/(^|-)(FEE|HIDDEN)-/.test(pid.toUpperCase())) return false;
    if (!pin.legacyErpId && FEEISH_RE.test(String(pin.partName || ''))) return false;
    return true;
};

// assembly_pins store partId as a library doc id, an itemId, or the ERP code itself — resolve to
// the ERP code the warehouse actually scans (same resolution order BOMTab uses).
export const pinErpOf = (pin, inventory = []) => {
    if (!pin) return '';
    if (pin.legacyErpId && pin.legacyErpId !== 'PENDING') return String(pin.legacyErpId).toUpperCase();
    const pid = String(pin.partId || '');
    const hit = inventory.find(p => p.id === pid || p.itemId === pid ||
        String(p.legacyErpId || '').toUpperCase() === pid.toUpperCase() ||
        String(p.netSuiteInternalId ?? '') === pid);
    if (hit && hit.legacyErpId && hit.legacyErpId !== 'PENDING') return String(hit.legacyErpId).toUpperCase();
    return pid.toUpperCase();
};

/**
 * Plan a finished-goods run for a library part.
 *
 * @param {object}   part       library record ({legacyErpId|itemId, itemName, partClass})
 * @param {number}   qty        finished pieces wanted
 * @param {object[]} pins       assembly_pins rows for the part (empty → single-part run)
 * @param {object[]} inventory  library records, for pin resolution + "/P variant exists" checks
 * @returns {{ erp, outsourced, finishSuffix, exploded, lines[] }}
 *   lines: { legacyErpId, partId, partName, quantity, partHandling, sourceComponent } — the exact
 *   partsList shape the fin_workorders contract & the WMS pick session read.
 */
export const planFinishedRun = ({ part, qty, pins = [], inventory = [] }) => {
    const erp = erpOf(part);
    const n = Math.max(1, Math.floor(Number(qty) || 1));
    const sfx = finishSuffixOf(erp);
    const outsourced = isOutsourcedFinishCode(sfx);
    const inv = new Map(inventory
        .filter(p => p.legacyErpId && p.legacyErpId !== 'PENDING')
        .map(p => [String(p.legacyErpId).toUpperCase(), p]));

    const comps = (pins || []).filter(usablePin)
        .map(pin => ({ code: pinErpOf(pin, inventory), name: pin.partName || pin.partId || '', per: Math.max(1, Number(pin.defaultQty) || 1) }))
        .filter(c => c.code);
    const src = comps.length ? comps : [{ code: erp, name: (part && part.itemName) || erp, per: 1 }];

    // What the warehouse pulls for one component:
    //   plater run     → the MILL core (the plater receives raw metal)
    //   in-house paint → the /P PHOSPHATED core (phosphate is its own convert stage; the sprayer
    //                    never hangs raw steel). Falls back to the code as the BOM states it when
    //                    no /P record exists (raw hardware that never phosphates).
    const pullOf = (code) => {
        const mill = millBaseOf(code);
        if (outsourced) return mill;
        const phos = `${mill}/P`;
        return inv.has(phos) || code === phos ? phos : code;
    };

    const merged = new Map();
    src.forEach(c => {
        const pull = pullOf(c.code);
        const row = merged.get(pull) || {
            legacyErpId: pull, partId: pull,
            partName: `${c.name || pull}${outsourced ? ' — mill core → plater' : (pull.endsWith('/P') ? ' — phosphated pull' : '')}`,
            quantity: 0, partHandling: 'Small Parts', sourceComponent: c.code,
        };
        row.quantity += c.per * n;
        merged.set(pull, row);
    });

    return { erp, outsourced, finishSuffix: sfx, exploded: comps.length > 0, lines: [...merged.values()] };
};

// SuiteQL for live availability of the plan's pull codes (optionally at one location).
export const availabilityQuery = (codes, locationId) => {
    const idList = codes.map(c => `'${String(c).toUpperCase().replace(/'/g, "''")}'`).join(',');
    return `SELECT Item.itemid AS itemid, SUM(AggregateItemLocation.quantityavailable) AS available ` +
        `FROM Item LEFT JOIN AggregateItemLocation ON AggregateItemLocation.item = Item.id ` +
        `WHERE UPPER(Item.itemid) IN (${idList})` +
        (locationId ? ` AND AggregateItemLocation.location = ${parseInt(locationId, 10)}` : '') +
        ` GROUP BY Item.itemid`;
};

// The check, shaped for a confirm dialog: one row per pull line, shortages flagged. A code
// NetSuite returned no row for reads as 0 with a note — absence of a stock record is itself
// something the person should see before releasing the run.
export const stockCheckReport = (lines, availMap) => {
    const rows = (lines || []).map(l => {
        const code = String(l.legacyErpId || '').toUpperCase();
        const known = availMap && Object.prototype.hasOwnProperty.call(availMap, code);
        const have = known ? (Number(availMap[code]) || 0) : 0;
        const short = Math.max(0, (Number(l.quantity) || 0) - have);
        return { code, need: Number(l.quantity) || 0, have, short, known };
    });
    const shortRows = rows.filter(r => r.short > 0);
    return {
        rows, shortRows, ok: shortRows.length === 0,
        text: rows.map(r => `• ${r.code} — need ${r.need}, available ${r.have}${r.known ? '' : ' (no NetSuite stock row)'}${r.short > 0 ? ` ⚠ SHORT ${r.short}` : ' ✓'}`).join('\n'),
    };
};

// Live availability via the NetSuite proxy. Dynamic import keeps this module pure for node
// tests (nsProxy pulls in firebase). Returns { CODE: available } for every code NetSuite knows.
export const fetchAvailability = async (codes, locationId) => {
    if (!codes || !codes.length) return {};
    const { nsProxyFetch } = await import('./nsProxy');
    const resp = await nsProxyFetch({
        targetUrl: 'https://3728153.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql',
        method: 'POST',
        payload: { q: availabilityQuery(codes, locationId) },
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(JSON.stringify(data).slice(0, 300));
    const out = {};
    (data.items || []).forEach(r => { out[String(r.itemid || '').toUpperCase()] = Number(r.available) || 0; });
    return out;
};
