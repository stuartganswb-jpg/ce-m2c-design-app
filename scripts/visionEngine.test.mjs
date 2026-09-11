// Harness for Shared/visionEngine — Vision's pickers from the engine's own walk (Phase 1).
//
//   node scripts/visionEngine.test.mjs
//
// The rules Vision used to copy by hand must now come out of the engine untouched: a return greys
// the bracket, a decorative end keeps it, the plate follows the arm holding the rod, a basic bracket
// takes no plate, a drive end is never an End Style, a double asks the rear places too.

import { visionPickers, engDataFromPickers, enginePicksForDraft, endStyleOf, chosenRods, engineEndSettled } from '../src/components/Shared/visionEngine.js';
import { visionPartIds } from '../src/components/Shared/visionBridge.js';

let pass = 0, fail = 0;
const eq = (name, got, want) => { const g = JSON.stringify(got), w = JSON.stringify(want); if (g === w) { pass++; return; } fail++; console.log(`✗ ${name}\n    got  ${g}\n    want ${w}`); };
const ok = (name, cond, extra = '') => { if (cond) { pass++; return; } fail++; console.log(`✗ ${name} ${extra}`); };
const C = (o) => o;

// An H1-138-shaped single/double family, raw rows as the adapter emits them.
const FAM = [
    C({ id: 'RF', partId: 'H1-138R', name: '1-3/8" Rod', role: 'ROD', rodKind: 'SOLID', tier: 'FRONT', nodes: ['rf'] }),
    C({ id: 'RB', partId: 'H1-138R', name: '1-3/8" Rod', role: 'ROD', rodKind: 'SOLID', tier: 'BACK', setup: 'DOUBLE', nodes: ['rb'] }),
    C({ id: 'FIN-L', partId: 'H1-138KF', name: 'Knob Finial', role: 'FINIAL', endTreatment: 'FINIAL', tier: 'FRONT', position: 'LEFT', nodes: ['fl'] }),
    C({ id: 'FIN-R', partId: 'H1-138KF', name: 'Knob Finial', role: 'FINIAL', endTreatment: 'FINIAL', tier: 'FRONT', position: 'RIGHT', nodes: ['fr'] }),
    C({ id: 'FIN-BL', partId: 'H1-138KF', name: 'Knob Finial', role: 'FINIAL', endTreatment: 'FINIAL', tier: 'BACK', setup: 'DOUBLE', position: 'LEFT', nodes: ['fbl'] }),
    C({ id: 'MTR-L', partId: 'H1-MRPF', name: 'Miter Return', role: 'RETURN', endTreatment: 'MITER_RETURN', isFee: true, proj: '6', tier: 'FRONT', position: 'LEFT', nodes: ['ml'] }),
    C({ id: 'FR-L', partId: 'H1-FRPF', name: 'French Return', role: 'RETURN', endTreatment: 'FRENCH_RETURN', isFee: true, proj: '6', tier: 'FRONT', position: 'LEFT', nodes: ['frl'] }),
    C({ id: 'IM-L', partId: 'H1-138IM', name: 'Inside Mount', role: 'INSIDE_MOUNT', endTreatment: 'INSIDE_MOUNT', tier: 'FRONT', position: 'LEFT', nodes: ['iml'] }),
    C({ id: 'DEC-R', partId: 'H1-138ERA', name: 'End Arm (decorative)', role: 'RETURN', endTreatment: 'MITER_RETURN', isReturnArm: true, noBackplate: true, proj: '6', tier: 'FRONT', position: 'RIGHT', nodes: ['der'] }),
    C({ id: 'BK-L', partId: 'H1-138B6', name: 'Bracket 6"', role: 'BRACKET', proj: '6', position: 'LEFT', nodes: ['bl'] }),
    C({ id: 'BK-R', partId: 'H1-138B6', name: 'Bracket 6"', role: 'BRACKET', proj: '6', position: 'RIGHT', nodes: ['br'] }),
    C({ id: 'BK-C', partId: 'H1-138B6', name: 'Bracket 6"', role: 'BRACKET', proj: '6', position: 'CENTER', nodes: ['bc'] }),
    C({ id: 'BAS-C', partId: 'H1-138BB', name: 'Basic Bracket', role: 'BRACKET', isBasic: true, proj: '6', position: 'CENTER', nodes: ['bbc'] }),
    C({ id: 'PL-L', partId: 'H1-138BP-R', name: 'Round Backplate', role: 'BACKPLATE', proj: '6', position: 'LEFT', nodes: ['pl'] }),
    C({ id: 'PL-R', partId: 'H1-138BP-R', name: 'Round Backplate', role: 'BACKPLATE', proj: '6', position: 'RIGHT', nodes: ['pr'] }),
    C({ id: 'PL-C', partId: 'H1-138BP-R', name: 'Round Backplate', role: 'BACKPLATE', proj: '6', position: 'CENTER', nodes: ['pc'] }),
    C({ id: 'RG', partId: 'H1-138BR', name: 'Ring', role: 'RING', tier: 'FRONT', nodes: ['rg'] }),
];
const SINGLE = { rodKind: 'SOLID', setup: 'SINGLE', proj: 6 };
const nameOf = (id) => ({ 'H1-MRPF': 'MITER RETURN - H1-MRPF' })[id] || null;

{
    const pk = visionPickers({ choices: FAM, answers: SINGLE, picks: {}, nameOf });
    const endL = pk.at('END', 'LEFT');
    ok('the left end is asked, with finial, returns and the inside mount', endL && ['FIN-L', 'MTR-L', 'FR-L', 'IM-L'].every(id => endL.options.some(o => o.id === id)), endL && endL.options.map(o => o.id).join());
    eq('the option carries the drawing\'s end style', endL.options.map(o => [o.id, o.endStyle]), [['FIN-L', 'FINIAL'], ['MTR-L', 'RETURN_MITER'], ['FR-L', 'RETURN_BEND'], ['IM-L', 'FLUSH']].sort((a, b) => endL.options.findIndex(o => o.id === a[0]) - endL.options.findIndex(o => o.id === b[0])));
    eq('the caller names the part (Vision\'s "name - code" label)', endL.options.find(o => o.id === 'MTR-L').name, 'MITER RETURN - H1-MRPF');
    ok('a single asks no rear places', !pk.at('END', 'LEFT', 'BACK') && !pk.at('ROD', '', 'BACK'));
    ok('nothing is locked with nothing chosen', pk.pickers.every(p => !p.locked));
}
{
    // a miter return at LEFT greys the left bracket (the engine's rule), and the plate follows the return
    const pk = visionPickers({ choices: FAM, answers: SINGLE, picks: { 'END|FRONT|LEFT': 'MTR-L' } });
    const bkL = pk.at('BRACKET', 'LEFT');
    ok('a return greys the bracket at its end', bkL && bkL.locked && /return|carries/i.test(bkL.lockedReason), bkL && bkL.lockedReason);
    ok('…and the right bracket is untouched', !pk.at('BRACKET', 'RIGHT').locked);
    eq('the drawing reads RETURN_MITER on the left', engDataFromPickers(pk).endStyle, 'RETURN_MITER');
    eq('…and a locked bracket place clears its id', engDataFromPickers(pk).bracketId, '');
}
{
    // a decorative end arm keeps its bracket
    const pk = visionPickers({ choices: FAM, answers: SINGLE, picks: { 'END|FRONT|RIGHT': 'DEC-R' } });
    ok('a decorative end arm does not grey the bracket', !pk.at('BRACKET', 'RIGHT').locked);
    ok('…and reads as decorative on the option', pk.at('END', 'RIGHT').options.find(o => o.id === 'DEC-R').decorative);
}
{
    // a basic bracket takes no plate
    const pk = visionPickers({ choices: FAM, answers: SINGLE, picks: { 'BRACKET||CENTER': 'BAS-C', 'BACKPLATE||CENTER': 'PL-C' } });
    const plC = pk.at('BACKPLATE', 'CENTER');
    ok('the centre plate is locked under a basic bracket', plC && plC.locked && /one piece|basic/i.test(plC.lockedReason), plC && plC.lockedReason);
    eq('…and the plate pick is not live', pk.live['BACKPLATE||CENTER'] || '', '');
}
{
    // a double asks the rear places; the inside mount reads as INSIDE
    const pk = visionPickers({ choices: FAM, answers: { rodKind: 'SOLID', setup: 'DOUBLE', proj: 6 }, picks: { 'END|FRONT|LEFT': 'IM-L', 'END|BACK|LEFT': 'FIN-BL' } });
    ok('a double asks the back left end', !!pk.at('END', 'LEFT', 'BACK'));
    const ed = engDataFromPickers(pk);
    eq('inside mount → FLUSH + INSIDE', [ed.endStyle, ed.mountLeft], ['FLUSH', 'INSIDE']);
    eq('the rods the drawing draws', chosenRods(visionPickers({ choices: FAM, answers: { rodKind: 'SOLID', setup: 'DOUBLE', proj: 6 }, picks: { 'ROD|FRONT|': 'RF', 'ROD|BACK|': 'RB' } })).map(c => c.id).sort(), ['RB', 'RF']);
}
{
    // what a saved line carries, and that the bridge reads it without a flow
    const pk = visionPickers({ choices: FAM, answers: SINGLE, picks: { 'END|FRONT|LEFT': 'FR-L', 'BRACKET||RIGHT': 'BK-R', 'BACKPLATE||RIGHT': 'PL-R', 'ROD|FRONT|': 'RF' } });
    const ep = enginePicksForDraft(pk);
    eq('enginePicks name part, kind and position per chosen slot', ep.map(p => [p.partId, p.kind, p.position]).sort(), [['H1-138B6', 'BRACKET', 'RIGHT'], ['H1-138BP-R', 'BACKPLATE', 'RIGHT'], ['H1-138R', 'ROD', ''], ['H1-FRPF', '', 'LEFT']].sort());
    const ids = visionPartIds({ specs: { enginePicks: ep }, spatialData: {} }, null);
    ok('visionPartIds reads enginePicks with no flow at all', ids.some(x => x.partId === 'H1-FRPF' && x.position === 'LEFT') && ids.some(x => x.partId === 'H1-138B6' && x.kind === 'BRACKET'), JSON.stringify(ids));
}
{
    eq('endStyleOf on a bare choice', [endStyleOf({ role: 'RETURN', endTreatment: 'FRENCH_RETURN' }), endStyleOf({ role: 'FINIAL' }), endStyleOf(null)], ['RETURN_BEND', 'FINIAL', '']);
}

{
    // THE SAVE LINE GATE ON THE ENGINE (Stuart 2026-09-11, QUO142 re-entered in Vision with miter
    // returns: "it keeps asking to make a bracket selection")
    eq('nothing chosen → the left end is not settled', engineEndSettled(visionPickers({ choices: FAM, answers: SINGLE, picks: {} })), false);
    eq('a miter return at LEFT locks the bracket → settled', engineEndSettled(visionPickers({ choices: FAM, answers: SINGLE, picks: { 'END|FRONT|LEFT': 'MTR-L' } })), true);
    eq('a french return → settled', engineEndSettled(visionPickers({ choices: FAM, answers: SINGLE, picks: { 'END|FRONT|LEFT': 'FR-L' } })), true);
    eq('an inside mount → settled', engineEndSettled(visionPickers({ choices: FAM, answers: SINGLE, picks: { 'END|FRONT|LEFT': 'IM-L' } })), true);
    eq('a bracket picked → settled', engineEndSettled(visionPickers({ choices: FAM, answers: SINGLE, picks: { 'BRACKET||LEFT': 'BK-L' } })), true);
    eq('a finial alone leaves the bracket open → not settled', engineEndSettled(visionPickers({ choices: FAM, answers: SINGLE, picks: { 'END|FRONT|LEFT': 'FIN-L' } })), false);
    eq('the right end is asked separately', engineEndSettled(visionPickers({ choices: FAM, answers: SINGLE, picks: { 'END|FRONT|LEFT': 'MTR-L' } }), 'RIGHT'), false);
    eq('no pickers → false', engineEndSettled(null), false);
}

console.log(fail ? `\n❌  ${pass} passed, ${fail} failed` : `\n✅  ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
