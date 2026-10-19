// Shared/spanCoverage — which rods the CPQ flows sell, and which ones 6.5's item-code join does not list (2026-10-19).
//   node scripts/spanCoverage.test.mjs
// COVERAGE_MODULE=<path> runs the same assertions against a mutated copy (mutation check).
import { ASSEMBLY, PINS } from './hardwareAutoPicks.fixture.mjs';

const { spanCoverageOf } = await import(process.env.COVERAGE_MODULE || new URL('../src/components/Shared/spanCoverage.js', import.meta.url).href);

let pass = 0, fail = 0;
const eq = (n, got, want) => {
    const g = JSON.stringify(got), w = JSON.stringify(want);
    if (g === w) { pass++; return; }
    fail++; console.log(`✗ ${n}\n    got  ${String(g).slice(0, 400)}\n    want ${String(w).slice(0, 400)}`);
};

// The live H1-2TRV pins, the parts named as the pins name them (our number = the pin's code).
const parts = [...new Map(PINS.map(p => [p.partId, { id: p.partId, itemId: p.partId, legacyErpId: p.legacyErpId || p.partName, itemName: `Item ${p.legacyErpId || p.partName}` }])).values()];
const findPart = (id) => parts.find(p => [p.id, p.itemId, p.legacyErpId].map(x => String(x || '').toUpperCase()).includes(String(id || '').toUpperCase())) || null;
const flows = [{ id: 'FLOW-A', name: 'H1-2TRV — GENERATED', linkedAssemblyId: ASSEMBLY.id }, { id: 'FLOW-B', name: 'H1-2TRV copy', linkedAssemblyId: ASSEMBLY.id }];
const of = (spanMap, more = {}) => spanCoverageOf({ flows, assemblyFor: () => ASSEMBLY, pinsFor: () => PINS, findPart, spanMap, ...more });
const codes = (rows) => rows.map(r => r.code);

{
    const c = of({ 'H1-ALU2': 'H1-2RCTAR, H1-2RCTWR' });
    eq('every rod the flow offers, once, under the family that claims it — or none', [codes(c.listed), c.listed.map(r => r.family), codes(c.missing)],
        [['H1-2RCTAR', 'H1-2RCTWR'], ['H1-ALU2', 'H1-ALU2'], ['H1-2RCTACR', 'H1-2TRV']]);
    eq('…named as the library names it, with every flow that sells it (the generator\'s tail dropped)', [c.missing[0].name, c.missing[0].flows], ['Item H1-2RCTACR', ['H1-2TRV', 'H1-2TRV copy']]);
    eq('the join is read the way the configurator reads it: case, spacing and a finish suffix do not matter', codes(of({ 'H1-ALU2': ' h1-2rctar/P ; H1-2RCTWR,h1-2rctacr' }).missing), ['H1-2TRV']);
    eq('nothing listed: every rod is a gap', [codes(of({}).listed), codes(of({}).missing)], [[], ['H1-2RCTACR', 'H1-2RCTAR', 'H1-2RCTWR', 'H1-2TRV']]);
    eq('only rods — no bracket, ring or finial is ever listed', of({}).missing.every(r => /RCT|TRV$/.test(r.code)), true);
}
{
    // A hidden pin bills but is never offered (the adapter reads it as a rider — pin.isHiddenPart), and a parked pin is no choice
    // at all (pin.parked): neither is something a customer picks, and the advice never reads either, so neither is a gap.
    const acr = new Set(PINS.filter(p => (p.legacyErpId || p.partName) === 'H1-2RCTACR').map(p => p.id));
    const missingWith = (pins) => codes(spanCoverageOf({ flows: flows.slice(0, 1), assemblyFor: () => ASSEMBLY, pinsFor: () => pins, findPart, spanMap: { 'H1-ALU2': 'H1-2RCTAR, H1-2RCTWR' } }).missing);
    eq('the acrylic rod is offered on the live pins (the two cases below are about it)', [acr.size > 0, missingWith(PINS)], [true, ['H1-2RCTACR', 'H1-2TRV']]);
    eq('…hidden on every pin, or parked on every pin, it is not listed', [missingWith(PINS.map(p => (acr.has(p.id) ? { ...p, isHiddenPart: true } : p))), missingWith(PINS.map(p => (acr.has(p.id) ? { ...p, parked: true } : p)))],
        [['H1-2TRV'], ['H1-2TRV']]);
    eq('a flow with no assembly or no pins lists nothing', [codes(spanCoverageOf({ flows, assemblyFor: () => null, pinsFor: () => PINS, findPart, spanMap: {} }).missing), codes(spanCoverageOf({ flows, assemblyFor: () => ASSEMBLY, pinsFor: () => [], findPart, spanMap: {} }).missing)], [[], []]);
}

console.log(fail ? `❌  ${pass} passed, ${fail} failed` : `✅  ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
