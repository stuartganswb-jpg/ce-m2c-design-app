// WHICH RODS THE CPQ FLOWS SELL, AND WHICH ONES 6.5 DOES NOT LIST (Stuart 2026-10-19 — the recommendations work: "i added in
// all the poles from the collection"). The bracket recommendation is only as good as 6.5's item-code join: a rod no family
// claims gets no span guidance at all ("No span guidance — this rod is not listed against a family in 6.5"). This lists every
// rod the brand's CPQ flows offer and says which family each one is under — so a gap is seen on 6.5, not found on a quote.
//
// ⚠ IT DECIDES NOTHING. Each answer has an owner already:
//   • which parts a flow offers, and as what role → partLookup.buildLookupIndex (the pin index CPQ's part lookup reads)
//   • the number a rod is looked up by           → hardwareSession.ourNumberOf (what bracketAdviceOf looks it up by)
//   • which family claims it                      → bracketSpan.rodForItemCode (the join itself)
// Pure: no Firestore, no React — the caller owns the reads. Harness: scripts/spanCoverage.test.mjs.
import { buildLookupIndex } from './partLookup.js';
import { ourNumberOf } from './hardwareSession.js';
import { rodForItemCode } from './bracketSpan.js';
import { ROD_ROLES } from './hardwareModel.js';
import { flowLabelOf } from './flowItems.js';

/**
 * @returns {{ listed: Array<row>, missing: Array<row> }}  row = { code, name, family: rodId | null, flows: [flow label] }
 *          Rods only (the roles the advice reads: rod, fascia, track); parked and hidden pins are not offered, so not listed.
 */
export function spanCoverageOf({ flows = [], assemblyFor, pinsFor, findPart, spanMap = {} } = {}) {
    const rows = buildLookupIndex({ flows, assemblyFor, pinsFor, findPart });
    const byCode = new Map();
    rows.forEach(r => {
        if (!r.choice || r.choice.parked || r.hidden || !ROD_ROLES.includes(String(r.role || '').toUpperCase())) return;
        const code = ourNumberOf(r.part, r.choice.partId);
        if (!code) return;
        const key = code.toUpperCase();
        let row = byCode.get(key);
        if (!row) {
            const fam = rodForItemCode(code, spanMap);
            row = { code, name: String((r.part && r.part.itemName) || r.name || code), family: fam ? fam.id : null, flows: [] };
            byCode.set(key, row);
        }
        const label = flowLabelOf({ name: r.flowName, id: r.flowId });
        if (!row.flows.includes(label)) row.flows.push(label);
    });
    const all = [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true, sensitivity: 'base' }));
    return { listed: all.filter(r => r.family), missing: all.filter(r => !r.family) };
}
