// 🧰 A kit fills in its own brackets (Stuart 2026-10-01, H1-138TRV-4V/P).   node scripts/kitBracketPicks.test.mjs
import { kitBracketCodesOf, kitBracketPicksOf, kitBracketSummary } from '../src/components/Shared/kitBracketPicks.js';
import { resolve, reseatPicks } from '../src/components/Shared/hardwareModel.js';
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}`); };
const eq = (n, a, b) => ok(`${n} — got ${JSON.stringify(a)}`, JSON.stringify(a) === JSON.stringify(b));

const kit = (family, align) => ({ partClass: 'Kit', legacyErpId: 'KIT', manufacturingSpecs: { kitFamily: family, kitAlign: { mount: 'WALL', setup: 'SINGLE', drive: 'MANUAL', minFeet: 4, ...align } } });
const V = kit('H1-138TRV', { bracketStyle: 'V', rodKind: 'TRAVERSE', material: 'P' });   // H1-138TRV-4V/P, as it is in the library
const H = kit('H1-138TRV', { bracketStyle: 'H', rodKind: 'TRAVERSE', material: 'P' });

// ── what a kit is sold with ─────────────────────────────────────────────────────────────────
eq('4V at 4-5/8": the extended arm and the VERTICAL plate', kitBracketCodesOf({ kit: V, proj: 4.625 }), { arm: 'H1-138TRVEBA', plate: 'H1-138TRVBP-V' });
eq('4H at 3-5/8": the standard arm and the HORIZONTAL plate', kitBracketCodesOf({ kit: H, proj: '3.625' }), { arm: 'H1-138TRVSBA', plate: 'H1-138TRVBP-H' });
eq('at 6"', kitBracketCodesOf({ kit: V, proj: 6 }).arm, 'H1-138TRV6BA');
eq('the arm WAITS for the projection — the plate does not', kitBracketCodesOf({ kit: V }), { arm: '', plate: 'H1-138TRVBP-V' });
eq('a depth nobody sells names no arm', kitBracketCodesOf({ kit: V, proj: 5 }).arm, '');
eq('a double: one arm, whatever the depth', kitBracketCodesOf({ kit: kit('H1-138TRV', { setup: 'DOUBLE', bracketStyle: 'V' }) }), { arm: 'H1-138TRVDBA', plate: 'H1-138TRVBP-V' });
eq('a ceiling kit: the ceiling arm and the ceiling plate', kitBracketCodesOf({ kit: kit('H1-138TRV', { mount: 'CEILING', bracketStyle: 'V' }) }), { arm: 'H1-138TRVCBA', plate: 'H1-138TRVBP-C' });
eq('H1-2TRV: one-piece brackets by depth, no separate plate', kitBracketCodesOf({ kit: kit('H1-2TRV', {}), proj: 4.625 }), { arm: 'H1-2TRV-EWB', plate: '' });
eq('H1-2TRV double with rings in front', kitBracketCodesOf({ kit: kit('H1-2TRV', { setup: 'DOUBLE', frontRail: 'RING' }) }).arm, 'H1-2TRV-DRTWB');
eq('not a kit / no family table → nothing', [kitBracketCodesOf({ kit: { manufacturingSpecs: {} } }), kitBracketCodesOf({ kit: kit('H9-NOPE', {}) }), kitBracketCodesOf()], [{ arm: '', plate: '' }, { arm: '', plate: '' }, { arm: '', plate: '' }]);

// ── through the REAL engine: arms first, the plates once the arms hold them ─────────────────
const POS = ['LEFT', 'CENTER', 'RIGHT'];
const DEPTH = { '3.625': 'SBA', '4.625': 'EBA', '6': '6BA' };
const choices = [
    { id: 'ROD', partId: 'H1-138TRV', role: 'ROD', position: 'CENTER', nodes: ['rod'] },
    ...POS.flatMap(pos => Object.entries(DEPTH).map(([d, sfx]) => ({ id: `ARM-${pos}-${sfx}`, partId: `H1-138TRV${sfx}`, role: 'BRACKET', position: pos, proj: d, nodes: [`a${pos}${sfx}`] }))),
    ...POS.flatMap(pos => Object.keys(DEPTH).flatMap(d => ['H', 'V'].map(o => ({ id: `PL-${pos}-${d}-${o}`, partId: `H1-138TRVBP-${o}`, role: 'BACKPLATE', position: pos, proj: d, nodes: [`p${pos}${d}${o}`] })))),
];
const codeOf = (o) => o.partId;
const model = (picks, proj) => resolve({ choices, answers: { rodKind: 'SOLID', proj }, selectedIds: Object.values(picks) });
const fill = (picks, proj, done, k = V) => {
    const m = model(picks, proj);
    const live = reseatPicks(m, picks);
    const add = kitBracketPicksOf({ model: m, kit: k, answers: { proj }, livePicks: live, codeOf, done });
    Object.entries(add).forEach(([key, id]) => done.add(`${key}|${id}`));
    return { picks: { ...live, ...add }, add };
};
const partsOf = (picks) => Object.values(picks).map(id => choices.find(c => c.id === id).partId).sort();

let done = new Set();
let step = fill({ ROD: 'ROD' }, undefined, done);
eq('no projection answered yet: nothing is guessed', step.add, {});
const rod = Object.fromEntries(Object.entries({ ...step.picks }).filter(([, v]) => v));
step = fill(rod, 4.625, done);
eq('projection answered: the extended arm at every position — and no plate yet (no arm held it)', partsOf(step.add), ['H1-138TRVEBA', 'H1-138TRVEBA', 'H1-138TRVEBA']);
step = fill(step.picks, 4.625, done);
eq('the arms now hold the plates open: the VERTICAL plate at every position', partsOf(step.add), ['H1-138TRVBP-V', 'H1-138TRVBP-V', 'H1-138TRVBP-V']);
const full = step.picks;
step = fill(full, 4.625, done);
eq('settled: a third pass adds nothing', step.add, {});
eq('the configuration holds 3 arms + 3 vertical plates (+ the rod)', partsOf(full).filter(p => p !== 'H1-138TRV'), ['H1-138TRVBP-V', 'H1-138TRVBP-V', 'H1-138TRVBP-V', 'H1-138TRVEBA', 'H1-138TRVEBA', 'H1-138TRVEBA']);

// ── the operator's own choices stand ────────────────────────────────────────────────────────
const plateKey = Object.keys(full).find(key => full[key] === 'PL-LEFT-4.625-V');
const swapped = { ...full, [plateKey]: 'PL-LEFT-4.625-H' };
eq('a plate changed to horizontal by hand is left alone', fill(swapped, 4.625, done).add, {});
const cleared = { ...full }; delete cleared[plateKey];
eq('a plate CLEARED by hand is not put back', fill(cleared, 4.625, done).add, {});
const armKey = Object.keys(full).find(key => full[key] === 'ARM-CENTER-EBA');
const noCentre = { ...full }; delete noCentre[armKey];
eq('nor is an arm the operator removed', Object.keys(fill(noCentre, 4.625, done).add).includes(armKey), false);

// ── the projection changes: the new depth's arm is filled once, then its plates ─────────────
step = fill(full, 6, done);
eq('at 6" the kit names the 6" arm at every position', partsOf(step.add), ['H1-138TRV6BA', 'H1-138TRV6BA', 'H1-138TRV6BA']);
step = fill(step.picks, 6, done);
eq('…and the vertical plates cut for 6"', Object.values(step.add).sort(), ['PL-CENTER-6-V', 'PL-LEFT-6-V', 'PL-RIGHT-6-V']);

// ── the horizontal kit, a kit with no orientation, and the guards ───────────────────────────
done = new Set();
step = fill(fill({ ROD: 'ROD' }, 3.625, done, H).picks, 3.625, done, H);
eq('the 4H kit fills HORIZONTAL plates', partsOf(step.add), ['H1-138TRVBP-H', 'H1-138TRVBP-H', 'H1-138TRVBP-H']);
const bare = kit('H1-138TRV', { rodKind: 'TRAVERSE' });   // no bracketStyle on record
done = new Set();
step = fill(fill({ ROD: 'ROD' }, 4.625, done, bare).picks, 4.625, done, bare);
eq('a kit that names no orientation fills the arms and leaves the plate to the operator', step.add, {});
eq('no kit, no model, no code reader → nothing', [kitBracketPicksOf({ model: model({}, 4.625), codeOf }), kitBracketPicksOf({ kit: V, codeOf }), kitBracketPicksOf({ model: model({}, 4.625), kit: V })], [{}, {}, {}]);
ok('an option the assembly does not carry is simply not picked', Object.keys(kitBracketPicksOf({ model: model({ ROD: 'ROD' }, 4.625), kit: V, answers: { proj: 4.625 }, livePicks: {}, codeOf: () => 'SOMETHING-ELSE', done: new Set() })).length === 0);

// ── a short pole wants no centre bracket: the kit fills the ends and leaves the middle ──────
{
    const noCentreWanted = (slot) => String(slot.position || '').toUpperCase() !== 'CENTER';
    const m1 = model({ ROD: 'ROD' }, 4.625);
    const arms = kitBracketPicksOf({ model: m1, kit: V, answers: { proj: 4.625 }, livePicks: reseatPicks(m1, { ROD: 'ROD' }), codeOf, done: new Set(), wants: noCentreWanted });
    eq('4 ft: left and right arms only', Object.values(arms).sort(), ['ARM-LEFT-EBA', 'ARM-RIGHT-EBA']);
    const held = { ...reseatPicks(m1, { ROD: 'ROD' }), ...arms };
    const m2 = model(held, 4.625);
    const plates = kitBracketPicksOf({ model: m2, kit: V, answers: { proj: 4.625 }, livePicks: reseatPicks(m2, held), codeOf, done: new Set(), wants: noCentreWanted });
    eq('…and the plates follow the arms: no centre plate either', Object.values(plates).sort(), ['PL-LEFT-4.625-V', 'PL-RIGHT-4.625-V']);
    const later = kitBracketPicksOf({ model: m2, kit: V, answers: { proj: 4.625 }, livePicks: reseatPicks(m2, held), codeOf, done: new Set(Object.entries(plates).map(([k, v]) => `${k}|${v}`)), wants: () => true });
    eq('lengthen the pole so a centre IS wanted: the centre arm is filled then', Object.values(later), ['ARM-CENTER-EBA']);
}

// ── what the strip says ─────────────────────────────────────────────────────────────────────
eq('the strip, vertical single', kitBracketSummary({ kit: V }), 'brackets — the bracket arm for the projection you answer and the vertical backplates, at every position');
eq('the strip, ceiling', kitBracketSummary({ kit: kit('H1-138TRV', { mount: 'CEILING' }) }), 'brackets — the ceiling bracket arm and its ceiling plate, at every position');
eq('the strip, H1-2TRV double (no plates)', kitBracketSummary({ kit: kit('H1-2TRV', { setup: 'DOUBLE' }) }), 'brackets — the double bracket arm, at every position');
eq('no family table → no claim', kitBracketSummary({ kit: kit('H9-NOPE', {}) }), '');

console.log(`kitBracketPicks: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
