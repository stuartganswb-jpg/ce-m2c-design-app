// A French return is bent from the rod — only a rod made in a material that can be bent takes one (Stuart 2026-10-22, H1-138 with
// the wood pole: "the french return option is shown even [when] wood pole is selected, this should only be available for metal, we
// need a check box of when what materials can be bent as one day we may add french return acrylic" · "go on all 3").
//   node scripts/frenchReturnBend.test.mjs
// The shape is H1-138's, by tag: three rods (metal, wood, acrylic), each end offering a finial, a French return (a fee, endTreatment
// FRENCH_RETURN) and a miter return. The list of materials that bend is 4.5's ticks (system/master_lists.bendableMaterials).
import { resolve, slots, withBendable, bendableListOf, BENDABLE_DEFAULT, normalizeChoice } from '../src/components/Shared/hardwareModel.js';

let pass = 0, fail = 0;
const eq = (n, got, want) => { const g = JSON.stringify(got), w = JSON.stringify(want); if (g === w) { pass++; return; } fail++; console.log(`✗ ${n}\n    got  ${g}\n    want ${w}`); };

const rods = [
    { id: 'R-METAL', partId: 'H1-138R', name: 'H1-138R', role: 'ROD', rodKind: 'SOLID', materials: 'METAL', nodes: ['rod-m'] },
    { id: 'R-WOOD', partId: 'H1-138WR', name: 'H1-138WR', role: 'ROD', rodKind: 'SOLID', materials: 'WOOD', nodes: ['rod-w'] },
    { id: 'R-ACR', partId: 'H1-138AR', name: 'H1-138AR', role: 'ROD', rodKind: 'SOLID', materials: 'CLEAR (NO FINISH)', noFinish: true, nodes: ['rod-a'] },
    { id: 'R-BLANK', partId: 'H1-138X', name: 'H1-138X', role: 'ROD', rodKind: 'SOLID', nodes: ['rod-x'] },   // no material tagged = metal
];
const ends = ['LEFT', 'RIGHT'].flatMap(pos => [
    { id: `FIN-${pos}`, partId: 'H1-138CC', name: 'End cap', role: 'FINIAL', position: pos, nodes: [`fin-${pos}`] },
    { id: `FR-${pos}`, partId: 'H1-FRPF', name: 'French return', role: 'RETURN', endTreatment: 'FRENCH_RETURN', isFee: true, position: pos, nodes: [`fr-${pos}`] },
    { id: `MR-${pos}`, partId: 'H1-MRPF', name: 'Miter return', role: 'RETURN', endTreatment: 'MITER_RETURN', isFee: true, position: pos, nodes: [`mr-${pos}`] },
]);
const base = [...rods, ...ends];
const endOptions = (choices, rodId) => {
    const m = resolve({ choices, answers: { rodKind: 'SOLID' }, selectedIds: rodId ? [rodId] : [] });
    return Object.fromEntries(m.slots.filter(s => s.kind === 'END').map(s => [s.position, s.options.map(o => o.id)]));
};
const all = (pos) => [`FIN-${pos}`, `FR-${pos}`, `MR-${pos}`];
const noFrench = (pos) => [`FIN-${pos}`, `MR-${pos}`];

// ── 1. nobody handed a list: metal bends, nothing else does ─────────────────────────────────────────────────────────────────
eq('the default is metal only', BENDABLE_DEFAULT, ['METAL']);
eq('a metal rod keeps its French returns', endOptions(base, 'R-METAL'), { LEFT: all('LEFT'), RIGHT: all('RIGHT') });
eq('a rod tagged with no material reads as metal and keeps them', endOptions(base, 'R-BLANK'), { LEFT: all('LEFT'), RIGHT: all('RIGHT') });
eq('a WOOD rod (H1-138WR): the French return leaves both ends; the finial and the miter return stand', endOptions(base, 'R-WOOD'), { LEFT: noFrench('LEFT'), RIGHT: noFrench('RIGHT') });
eq('an acrylic rod: the same', endOptions(base, 'R-ACR'), { LEFT: noFrench('LEFT'), RIGHT: noFrench('RIGHT') });
eq('before a rod is chosen nothing is hidden', endOptions(base, null), { LEFT: all('LEFT'), RIGHT: all('RIGHT') });
{
    const m = resolve({ choices: base, answers: { rodKind: 'SOLID' }, selectedIds: ['R-WOOD'] });
    const why = m.slots.find(s => s.kind === 'END' && s.position === 'LEFT').rejected.find(r => r.choice.id === 'FR-LEFT');
    eq('…and it says why, naming the rod and its material', [why && why.rule, why && why.detail], ['material', 'H1-138WR is made in wood, which cannot be bent — a French return is bent from the rod']);
}

// ── 2. 4.5's ticks decide: the day acrylic bends, it is ticked and offered ─────────────────────────────────────────────────
eq('ticks are read in capitals; an empty list means nothing bends; no list means metal', [bendableListOf(['metal', ' Clear (No Finish) ']), bendableListOf([]), bendableListOf(undefined), bendableListOf(null)],
    [['METAL', 'CLEAR (NO FINISH)'], [], ['METAL'], ['METAL']]);
const withAcrylic = withBendable(base, ['METAL', 'CLEAR (NO FINISH)']);
eq('acrylic ticked: an acrylic rod takes a French return', endOptions(withAcrylic, 'R-ACR'), { LEFT: all('LEFT'), RIGHT: all('RIGHT') });
eq('…wood still does not', endOptions(withAcrylic, 'R-WOOD'), { LEFT: noFrench('LEFT'), RIGHT: noFrench('RIGHT') });
const nothing = withBendable(base, []);
eq('nothing ticked: not even metal takes one', endOptions(nothing, 'R-METAL'), { LEFT: noFrench('LEFT'), RIGHT: noFrench('RIGHT') });
eq('withBendable marks every part from what it is made in (blank = metal, clear-only = clear)', withBendable(rods, ['METAL']).map(c => [c.id, c.bendable]),
    [['R-METAL', true], ['R-WOOD', false], ['R-ACR', false], ['R-BLANK', true]]);
eq('…a caller that hands no list changes nothing', withBendable(base, undefined) === base, true);
eq('…and the mark survives the engine\'s normalising (resolve normalises every choice)', [normalizeChoice(withBendable([rods[1]], ['METAL'])[0]).bendable, 'bendable' in normalizeChoice(rods[1])], [false, false]);

// ── 3. a French return already picked, then the rod changed to wood: it is dropped, not kept ───────────────────────────────
{
    const sel = ['R-WOOD', 'FR-LEFT'];
    const m = resolve({ choices: base, answers: { rodKind: 'SOLID' }, selectedIds: sel });
    const left = m.slots.find(s => s.kind === 'END' && s.position === 'LEFT');
    eq('a French return picked before the rod went wood is no longer an option at that end', left.options.some(o => o.id === 'FR-LEFT'), false);
}

// ── 4. a double: the rule follows the rod at each tier ──────────────────────────────────────────────────────────────────────
{
    const dbl = [
        { id: 'RF-METAL', partId: 'H1-138R', name: 'H1-138R', role: 'ROD', rodKind: 'SOLID', tier: 'FRONT', materials: 'METAL', nodes: ['f-m'] },
        { id: 'RB-WOOD', partId: 'H1-138WR', name: 'H1-138WR', role: 'ROD', rodKind: 'SOLID', tier: 'BACK', materials: 'WOOD', nodes: ['b-w'] },
        ...['FRONT', 'BACK'].flatMap(tier => [
            { id: `FR-L-${tier}`, partId: 'H1-DBLFR', name: 'French return', role: 'RETURN', endTreatment: 'FRENCH_RETURN', isFee: true, position: 'LEFT', tier, nodes: [`fr-l-${tier}`] },
            { id: `FIN-L-${tier}`, partId: 'H1-138CC', name: 'End cap', role: 'FINIAL', position: 'LEFT', tier, nodes: [`fin-l-${tier}`] },
        ]),
    ];
    const sl = slots(dbl.map(normalizeChoice), { rodKind: 'SOLID', setup: 'DOUBLE' }, ['RF-METAL', 'RB-WOOD']);
    const at = (tier) => (sl.find(s => s.kind === 'END' && s.position === 'LEFT' && s.tier === tier) || { options: [] }).options.map(o => o.id);
    eq('front rod metal: its end keeps the French return; rear rod wood: its end does not', [at('FRONT'), at('BACK')], [['FR-L-FRONT', 'FIN-L-FRONT'], ['FIN-L-BACK']]);
}

console.log(fail ? `❌  ${pass} passed, ${fail} failed` : `✅  ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
