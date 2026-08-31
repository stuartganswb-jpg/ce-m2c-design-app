// THE ORDER ENTRY REVIEW GATE (Stuart 2026-08-29, after the failed READ WINDOW re-trace).
//
// The old Generate decided everything silently in one click and got FOUR things wrong at once:
// a milling WO for a part we buy (sourcing ignored on components), a phantom 168-short because
// NetSuite counts HTAEC35 in PAIRS and the app compared eaches (units ignored), a stale BOM
// exploded unquestioned, and floor paper with no NetSuite work order anchoring it.
//
// This module PLANS and shows its work; it writes NOTHING. The operator sees, per component:
// live availability WITH NetSuite's unit, the sourcing-resolved action (convert / shop WO /
// vendor PO / ask), and the NetSuite work-order vehicle the line will open. Execution happens
// only after the operator approves — in the caller, not here.
//
// Sourcing rule (the fix for the track bug): a short component routes by ITS OWN setup —
//   assembly or in-house  → shop work order
//   outsourced w/ vendor  → PO draft (qty editable in review — vendor MOQs, Stuart 2026-08-29)
//   outsourced, no vendor → HOLD (named, never guessed)
//   BOTH                  → operator picks in the review (defaults to make)
//
// Unit rule (the fix for the phantom 168): NetSuite's stock unit rides every availability
// number. If it disagrees with the app item's recorded unit (unset = EA), the component is
// flagged and its action HELD until the operator aligns the app item ("NetSuite shows PR —
// OK to update?") or overrides. Numbers are never converted — units are ALIGNED, per Stuart.
//
// NetSuite anchoring (two flows, Stuart 2026-08-29):
//   FLOW2 — the finished variant exists as a NetSuite assembly → a real NetSuite work order
//           opens for the final product; the floor waits for its number (awaitingNsWo).
//   FLOW1 — raw + app-applied finish (no finished NS assembly) → the SALES ORDER is the
//           NetSuite record today; the /P-assembly work order (the raw-consuming vehicle)
//           is planned here and shown, but opens only once the convert RESTlet can build
//           against a work order — flagged, never silent.

import { planFinishedRun, isAssemblyPart } from './finishedGoodsRun.js';
import { millBaseOf } from './finishRouting.js';
import { SOURCING, sourcingOf } from './sourcing.js';

// ── AVAILABILITY WITH UNITS ────────────────────────────────────────────────────────────────────
// One SuiteQL read: per-item available qty AND the item's stock unit label. BUILTIN.DF on the
// unit reference is the only way SuiteQL yields the label; if NetSuite refuses the expression
// the plain query runs instead and units come back unknown (flagged, not guessed).
// quantityonorder = open POs + open WOs in NetSuite (the same aggregate the Stock View On-Ord
// column trusts) — Stuart 2026-08-29: a short already covered by inbound must not be re-ordered.
const unitsQuery = (codes, locationId) => {
    const idList = codes.map(c => `'${String(c).toUpperCase().replace(/'/g, "''")}'`).join(',');
    return `SELECT Item.itemid AS itemid, BUILTIN.DF(Item.stockunit) AS unitname, ` +
        `SUM(AggregateItemLocation.quantityavailable) AS available, ` +
        `SUM(AggregateItemLocation.quantityonorder) AS onorder ` +
        `FROM Item LEFT JOIN AggregateItemLocation ON AggregateItemLocation.item = Item.id ` +
        `WHERE UPPER(Item.itemid) IN (${idList})` +
        (locationId ? ` AND AggregateItemLocation.location = ${parseInt(locationId, 10)}` : '') +
        ` GROUP BY Item.itemid, BUILTIN.DF(Item.stockunit)`;
};
const plainQuery = (codes, locationId) => {
    const idList = codes.map(c => `'${String(c).toUpperCase().replace(/'/g, "''")}'`).join(',');
    return `SELECT Item.itemid AS itemid, SUM(AggregateItemLocation.quantityavailable) AS available, ` +
        `SUM(AggregateItemLocation.quantityonorder) AS onorder ` +
        `FROM Item LEFT JOIN AggregateItemLocation ON AggregateItemLocation.item = Item.id ` +
        `WHERE UPPER(Item.itemid) IN (${idList})` +
        (locationId ? ` AND AggregateItemLocation.location = ${parseInt(locationId, 10)}` : '') +
        ` GROUP BY Item.itemid`;
};

export const fetchAvailabilityUnits = async (codes, locationId) => {
    if (!codes || !codes.length) return { map: {}, unitsKnown: true };
    const { nsProxyFetch } = await import('./nsProxy');
    const run = async (q) => {
        const resp = await nsProxyFetch({
            targetUrl: 'https://3728153.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql',
            method: 'POST', payload: { q },
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(JSON.stringify(data).slice(0, 300));
        return data.items || [];
    };
    try {
        const rows = await run(unitsQuery(codes, locationId));
        const map = {};
        rows.forEach(r => {
            map[String(r.itemid || '').toUpperCase()] = {
                available: Number(r.available) || 0,
                onOrder: Number(r.onorder) || 0,
                unit: String(r.unitname || '').trim().toUpperCase() || null,
            };
        });
        return { map, unitsKnown: true };
    } catch (e) {
        const rows = await run(plainQuery(codes, locationId));
        const map = {};
        rows.forEach(r => {
            map[String(r.itemid || '').toUpperCase()] = { available: Number(r.available) || 0, onOrder: Number(r.onorder) || 0, unit: null };
        });
        return { map, unitsKnown: false };
    }
};

// The unit the APP believes an item is counted in. Unset means eaches — every screen has always
// assumed eaches, so that IS the app's position until an operator aligns it.
export const appUnitOf = (part) => String(part?.manufacturingSpecs?.stockUnit || 'EA').toUpperCase();
const EA_ALIASES = ['EA', 'EACH', 'EACHES'];
export const unitsDisagree = (nsUnit, appUnit) => {
    if (!nsUnit) return false;
    const a = String(appUnit || 'EA').toUpperCase(), n = String(nsUnit).toUpperCase();
    if (a === n) return false;
    return !(EA_ALIASES.includes(a) && EA_ALIASES.includes(n));
};

// ── SOURCING-RESOLVED ROUTE for one short component ────────────────────────────────────────────
export const routeShort = (part, code, qty, reason) => {
    if (!part) return { kind: 'HOLD', code, qty, reason, holdReason: `${code} is not in the Master Library — sync it first` };
    const specs = part.manufacturingSpecs || {};
    const vendorName = String(specs.vendorName || '').trim();
    if (isAssemblyPart(part)) return { kind: 'SHOP', code, qty, reason };
    const src = sourcingOf(specs);
    if (src === SOURCING.BOTH) return { kind: 'ASK', code, qty, reason, vendorName, chosen: 'SHOP' };
    if (src === SOURCING.OUT) {
        return vendorName
            ? { kind: 'PO', code, qty, reason, vendorName, part }
            : { kind: 'HOLD', code, qty, reason, holdReason: `${code} is outsourced but has NO vendor on the item — set it in the Library, then retry` };
    }
    return { kind: 'SHOP', code, qty, reason };
};

// ── THE PLAN ───────────────────────────────────────────────────────────────────────────────────
// jobs: [{ key, so, line, part, finish, qty, pins }] — part is the RAW library record.
// inventory: the library list (for component part lookups and the finished-variant probe).
// Returns { jobs: [{ ...job, finishedErp, plan, components[], nsPlan, holds[] }], nsError, unitsKnown }.
export const buildOeReviewPlan = async ({ jobs = [], inventory = [], locationId }) => {
    const partOf = (c) => inventory.find(p => String(p.legacyErpId || p.itemId || '').toUpperCase() === String(c).toUpperCase()) || null;

    // Plan every line first, so ONE availability read covers every pull code + every mill base.
    // A BOUGHT line (job.buy — Stuart 2026-08-30: the old direct-PO path re-ordered H1-138TRV
    // with plenty already inbound, no stock read, no review) plans as ONE pull of the item
    // itself: stock first, on-order coverage on the shortfall, PO only for what remains.
    const planned = jobs.map(j => {
        const erp = String(j.part.legacyErpId || j.part.itemId || '').toUpperCase();
        if (j.buy) {
            return {
                ...j, finishedErp: erp,
                // buyQty: a per-foot line buys FEET (pieces × cut) — the vendor and NetSuite both
                // count that item in feet; production still counts pieces.
                plan: { erp, exploded: false, lines: [{ legacyErpId: erp, partName: j.part.itemName || '', quantity: j.buyQty || j.qty }] },
            };
        }
        const finishedErp = `${erp}/${j.finish}`;
        const plan = planFinishedRun({ part: { ...j.part, legacyErpId: finishedErp }, qty: j.qty, pins: j.pins || [], inventory });
        const lines = plan.exploded ? plan.lines : plan.lines.filter(l => String(l.legacyErpId || '').toUpperCase() !== plan.erp);
        return { ...j, finishedErp, plan: { ...plan, lines } };
    });
    const codes = new Set();
    planned.forEach(p => p.plan.lines.forEach(l => {
        const c = String(l.legacyErpId || '').toUpperCase();
        if (!c) return;
        codes.add(c);
        const mill = millBaseOf(c);
        if (/\/P$/.test(c) && mill !== c) codes.add(mill);
    }));

    let avail = {}, unitsKnown = true;
    if (codes.size) {
        try {
            const res = await fetchAvailabilityUnits([...codes], locationId);
            avail = res.map; unitsKnown = res.unitsKnown;
        } catch (e) {
            return { jobs: [], nsError: e.message || String(e), unitsKnown: false };
        }
    }

    // Walk lines against a running remainder so two lines shorting one shelf don't both claim it.
    // On-order gets its own remainder: inbound that "covers" one line's short must not also cover
    // the next line's.
    const remaining = {};
    const onOrderLeft = {};
    Object.entries(avail).forEach(([c, v]) => { remaining[c] = v.available; onOrderLeft[c] = v.onOrder || 0; });

    // A short already covered by inbound (open PO/WO in NetSuite) defaults to SKIP — shown with
    // "N on order" and a tick the operator can clear to order anyway (Stuart 2026-08-29: the app
    // "missed the fact that the component is already on order for sufficient qty").
    const applyCoverage = (action) => {
        if (!['SHOP', 'PO', 'ASK'].includes(action.kind)) return action;
        const pool = Math.max(0, Number(onOrderLeft[action.code]) || 0);
        if (pool >= action.qty) {
            onOrderLeft[action.code] = pool - action.qty;
            return { ...action, skip: true, coveredBy: pool };
        }
        if (pool > 0) return { ...action, coveredBy: pool }; // partial — shown, not auto-skipped
        return action;
    };

    const out = planned.map(p => {
        const components = [];
        const holds = [];
        p.plan.lines.forEach(l => {
            const code = String(l.legacyErpId || '').toUpperCase();
            if (!code) return;
            const need = Number(l.quantity) || 0;
            const have = Math.max(0, Number(remaining[code]) || 0);
            const short = Math.max(0, need - have);
            remaining[code] = Math.max(0, (Number(remaining[code]) || 0) - need);
            const compPart = partOf(code);
            const nsUnit = (avail[code] || {}).unit;
            const appUnit = appUnitOf(compPart);
            const mismatch = unitsDisagree(nsUnit, appUnit);
            const comp = {
                code, name: l.partName || compPart?.itemName || '', need, have, short,
                onOrder: (avail[code] || {}).onOrder || 0,
                nsUnit, appUnit, unitMismatch: mismatch, partId: compPart?.id || null,
                noStockRecord: !(code in avail),
                actions: [],
            };
            if (short > 0 && p.buy) {
                // Bought line: the vendor covers what stock + inbound do not. The operator chose
                // PO (or the item is flagged bought) — never invent a shop WO here.
                const vendorName = String(compPart?.manufacturingSpecs?.vendorName || '').trim();
                comp.actions.push(applyCoverage(vendorName
                    ? { kind: 'PO', code, qty: short, reason: 'ordered line (bought)', vendorName, part: compPart }
                    : { kind: 'HOLD', code, qty: short, reason: 'ordered line (bought)', holdReason: `${code} is bought but has NO vendor on the item — set it in the Library, then retry` }));
            } else if (short > 0) {
                const mill = millBaseOf(code);
                if (/\/P$/.test(code) && mill !== code) {
                    const rawHave = Math.max(0, Number(remaining[mill]) || 0);
                    const claimed = Math.min(rawHave, short);
                    remaining[mill] = Math.max(0, (Number(remaining[mill]) || 0) - short);
                    // The convert itself always stands (phosphating must still happen — it waits
                    // on the WMS tab for raw, inbound or milled); coverage applies to ACQUIRING
                    // the raw behind it.
                    comp.actions.push({ kind: 'CONVERT', target: code, base: mill, qty: short, rawHave });
                    if (rawHave < short) comp.actions.push(applyCoverage(routeShort(partOf(mill), mill, short - claimed, `raw behind ${code}`)));
                } else {
                    comp.actions.push(applyCoverage(routeShort(compPart, code, short, 'pull line short')));
                }
            }
            // A unit disagreement makes every number on this row unreliable — hold its actions
            // until the operator aligns or overrides. NONE-action rows still show the flag.
            if (mismatch || (!unitsKnown && short > 0)) {
                comp.held = true;
                comp.holdReason = mismatch
                    ? `NetSuite counts ${code} in ${nsUnit} — the app has ${appUnit}. Align before routing.`
                    : `NetSuite unit unreadable this pull — verify ${code} manually before routing.`;
            }
            comp.actions.filter(a => a.kind === 'HOLD').forEach(a => holds.push(a.holdReason));
            components.push(comp);
        });

        if (p.buy) {
            return { ...p, components, holds, nsPlan: { flow: 'PO', note: 'Bought item — the vendor PO is the NetSuite record; no work order opens.' } };
        }
        // NetSuite vehicle: finished variant present as a synced NetSuite assembly → FLOW2.
        const finPart = partOf(p.finishedErp);
        const isNsAssembly = finPart && finPart.netSuiteInternalId &&
            (finPart.partClass === 'Assembly' || finPart.partClass === 'Master Assembly' || finPart.netSuiteRecordType === 'assemblyitem');
        // FLOW1 upgrade (Stuart 2026-08-31): the finish-variant not existing in NetSuite does not
        // mean nothing does — the BASE assembly (HRW-138TRAVLB behind /RF2) usually IS one. Its
        // top-level work order opens with the job so the item shows ON ORDER to a CSR the moment
        // production starts, and the closing chain is: mill builds the components → app convert
        // phosphates them → the final assembly build posts against THIS work order and consumes
        // the /P components per the BOM.
        const basePart = partOf(p.erp);
        const baseIsNsAssembly = basePart && basePart.netSuiteInternalId &&
            (basePart.partClass === 'Assembly' || basePart.partClass === 'Master Assembly' || basePart.netSuiteRecordType === 'assemblyitem');
        const nsPlan = isNsAssembly
            ? { flow: 'FLOW2', assemblyInternalId: String(finPart.netSuiteInternalId), note: `NetSuite work order opens for ${p.finishedErp} ×${p.qty} — the floor waits for its number.` }
            : baseIsNsAssembly
            ? { flow: 'FLOW1', baseAssemblyInternalId: String(basePart.netSuiteInternalId), baseErp: String(p.erp).toUpperCase(), note: `Top-level NetSuite work order opens on the BASE assembly ${String(p.erp).toUpperCase()} ×${p.qty} (the /${p.finish} variant is app-only) — the final assembly build posts against it and consumes the components. The SO carries the finish.` }
            : { flow: 'FLOW1', note: `No NetSuite assembly for ${p.finishedErp} (or its base) — the SALES ORDER is the NetSuite record; the /P convert work orders are the anchors.` };

        return { ...p, components, holds, nsPlan };
    });

    return { jobs: out, nsError: null, unitsKnown };
};

// Flatten a reviewed job's component actions into the executor's shapes, honoring operator
// choices: ASK components carry `chosen` (SHOP or PO); held/HOLD rows contribute nothing;
// skipped rows (covered by inbound, or the operator's soft-out) contribute nothing.
export const actionsOfReviewedJob = (job) => {
    const makeup = [], poLines = [];
    (job.components || []).forEach(c => {
        if (c.held && !c.overrideProceed) return;
        (c.actions || []).forEach(a => {
            if (a.skip) return;
            const kind = a.kind === 'ASK' ? (a.chosen || 'SHOP') : a.kind;
            if (kind === 'CONVERT') makeup.push({ kind: 'CONVERT', target: a.target, base: a.base, qty: a.qty, rawHave: a.rawHave });
            else if (kind === 'SHOP') makeup.push({ kind: 'SHOP', code: a.code, qty: a.qty, reason: a.reason });
            else if (kind === 'PO') poLines.push({ code: a.code, qty: Number(a.editQty ?? a.qty) || a.qty, vendorName: a.vendorName, part: a.part, reason: a.reason });
            // HOLD → nothing, by definition.
        });
    });
    return { makeup, poLines };
};
