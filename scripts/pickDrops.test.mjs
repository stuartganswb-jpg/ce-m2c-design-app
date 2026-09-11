// Harness for Shared/pickDrops — what a later choice removed, and why (Stuart 2026-09-10:
// "never a silent clear" … "refuse add until acknowledged").
//
//   node scripts/pickDrops.test.mjs
//
// Shapes are the H1-138 / H1-75 ones read from the live pins on 2026-09-10: a return picked at
// 4-5/8", a rod, then the projection changed to 6" — the return leaves; a bracket change re-seats
// its plate on the same code (kept); the operator's own un-pick is not a removal.

import { droppedPicks, mergeDrops, unacknowledged } from '../src/components/Shared/pickDrops.js';
import { resolve, reseatPicks } from '../src/components/Shared/hardwareModel.js';

let pass = 0, fail = 0;
const eq = (name, got, want) => { const g = JSON.stringify(got), w = JSON.stringify(want); if (g === w) { pass++; return; } fail++; console.log(`✗ ${name}\n    got  ${g}\n    want ${w}`); };
const ok = (name, cond, extra = '') => { if (cond) { pass++; return; } fail++; console.log(`✗ ${name} ${extra}`); };
const C = (o) => o;
const settle = (cs, answers, picks) => {
    let sel = Object.values(picks).filter(Boolean); let m = resolve({ choices: cs, answers, selectedIds: sel });
    for (let i = 0; i < 4; i++) { const next = Object.values(reseatPicks(m, picks)); if (next.length === sel.length && next.every(x => sel.includes(x))) break; sel = next; m = resolve({ choices: cs, answers, selectedIds: sel }); }
    return { m, live: reseatPicks(m, picks) };
};
const labelOf = (s) => [s.tier, s.position, s.kind].filter(Boolean).join(' ');

// Fixture A — an untiered single (H1-75 before its rods were tagged): projection narrows the brackets.
const RAW_SINGLE = [
    C({ id: 'R', partId: 'H1-75R', role: 'ROD', rodKind: 'SOLID', position: 'CENTER', nodes: ['r'] }),
    C({ id: 'FIN', partId: 'H1-75KF', name: 'Knob Finial', role: 'FINIAL', position: 'LEFT', nodes: ['fin'] }),
    C({ id: 'BK6', partId: 'H1-75B6', name: 'Bracket 6"', role: 'BRACKET', proj: '6', position: 'LEFT', nodes: ['bk6'] }),
    C({ id: 'BKE', partId: 'H1-75BE', name: 'Bracket 4-5/8"', role: 'BRACKET', proj: '4-5/8', position: 'LEFT', nodes: ['bke'] }),
    C({ id: 'PL-6', partId: 'H1-75BP-R', role: 'BACKPLATE', proj: '6', position: 'LEFT', nodes: ['pl6'] }),
    C({ id: 'PL-E', partId: 'H1-75BP-R', role: 'BACKPLATE', proj: '4-5/8', position: 'LEFT', nodes: ['ple'] }),
];
const single = RAW_SINGLE;   // resolve() normalizes — feeding it normalized rows would lose the projections
const kA = (() => { const m = resolve({ choices: single, answers: { proj: 4.625 }, selectedIds: [] }); return { rod: m.slots.find(s => s.kind === 'ROD').key, bk: m.slots.find(s => s.kind === 'BRACKET').key, pl: m.slots.find(s => s.kind === 'BACKPLATE').key }; })();
// (rod + two brackets alone: the projection answer narrows the bracket step — with plates and a
//  finial in the same fixture the engine reads the bracket as the projection question and does not;
//  which is the engine's business — this reader reports whatever it removes.)
const singleBk = RAW_SINGLE.filter(c => ['R', 'BK6', 'BKE'].includes(c.id));
{
    const raw = { [kA.bk]: 'BKE', [kA.rod]: 'R' };
    const single = singleBk;
    const s1 = settle(single, { proj: 4.625 }, raw);
    eq('nothing removed while the answers fit', droppedPicks(s1.m, raw, s1.live, { labelOf }), []);
    const s2 = settle(single, { proj: 6 }, raw);
    const d2 = droppedPicks(s2.m, raw, s2.live, { labelOf });
    eq('projection → 6": the 4-5/8" bracket is reported as removed, on its step', d2.map(d => [d.step, d.partCode]), [['LEFT BRACKET', 'H1-75BE']]);
    ok('…with the engine\'s own reason', d2.length && /projection/.test(d2[0].reason) && /4\.625/.test(d2[0].reason), d2[0] && d2[0].reason);
    ok('the rod, still offered, is not reported', !d2.some(d => d.partCode === 'H1-75R'));
    const s3 = settle(single, { proj: 4.625 }, raw);
    eq('projection back to 4-5/8": the bracket is back and nothing is reported', droppedPicks(s3.m, raw, s3.live, { labelOf }), []);
}
{
    // the operator's own un-pick is not a removal; a bracket change keeps the plate (twin) — not a removal
    const s0 = settle(single, { proj: 6 }, { [kA.bk]: 'BK6', [kA.pl]: 'PL-6' });
    eq('bracket + plate: nothing removed', droppedPicks(s0.m, { [kA.bk]: 'BK6', [kA.pl]: 'PL-6' }, s0.live, { labelOf }), []);
    const s1 = settle(single, { proj: 6 }, { [kA.bk]: 'BKE', [kA.pl]: 'PL-6' });
    eq('bracket changed, plate re-seated on the same code: not a removal', droppedPicks(s1.m, { [kA.bk]: 'BKE', [kA.pl]: 'PL-6' }, s1.live, { labelOf }).map(d => d.partCode).filter(c => c === 'H1-75BP-R'), []);
    // a return-only plate whose return was un-picked leaves with it (build 3) — the operator's own
    // doing, so it is NOT reported; the strip is for what a LATER answer took, not for consequences of an un-pick.
    const withRtn = [...RAW_SINGLE, C({ id: 'RET', partId: 'H1-75R6', role: 'RETURN', proj: '6', position: 'LEFT', nodes: ['ret'] }), C({ id: 'PL-RTN', partId: 'H1-75RBP-R', role: 'BACKPLATE', returnOnly: true, proj: '6', position: 'LEFT', nodes: ['plr'] })];
    const kR = (() => { const m = resolve({ choices: withRtn, answers: { proj: 6 }, selectedIds: [] }); return { end: m.slots.find(s => s.kind === 'END').key, pl: m.slots.find(s => s.kind === 'BACKPLATE').key }; })();
    const s2 = settle(withRtn, { proj: 6 }, { [kR.pl]: 'PL-RTN' });
    ok('the return plate is gone once its return is un-picked (build 3)…', !Object.values(s2.live).includes('PL-RTN'), JSON.stringify(s2.live));
    eq('…and that is NOT reported — the operator un-picked the arm it followed', droppedPicks(s2.m, { [kR.pl]: 'PL-RTN' }, s2.live, { labelOf }), []);
    eq('an un-picked slot (raw undefined) is never a removal', droppedPicks(s2.m, { [kA.bk]: undefined }, s2.live, { labelOf }), []);
}
// Fixture B — a tiered double with a traverse world (H1-138 shape): Rod Type and Single/Double changes.
const dbl = [
    C({ id: 'R', partId: 'H1-138R', role: 'ROD', rodKind: 'SOLID', position: 'CENTER', tier: 'FRONT', nodes: ['r'] }),
    C({ id: 'RB', partId: 'H1-138R', role: 'ROD', rodKind: 'SOLID', position: 'CENTER', tier: 'BACK', setup: 'DOUBLE', nodes: ['rb'] }),
    C({ id: 'FA', partId: 'H1-138TRV', role: 'FASCIA', rodKind: 'TRAVERSE', nodes: ['fa'] }),
    C({ id: 'FIN', partId: 'H1-138KF', name: 'Knob Finial', role: 'FINIAL', position: 'LEFT', tier: 'FRONT', nodes: ['fin'] }),
    C({ id: 'FIN-B', partId: 'H1-138KF', name: 'Knob Finial', role: 'FINIAL', position: 'LEFT', tier: 'BACK', setup: 'DOUBLE', nodes: ['finb'] }),
    C({ id: 'BK6', partId: 'H1-138B6', name: 'Bracket 6"', role: 'BRACKET', fits: ['SOLID'], proj: '6', position: 'LEFT', nodes: ['bk6'] }),
];
const kB = (() => { const m = resolve({ choices: dbl, answers: { rodKind: 'SOLID', setup: 'DOUBLE', proj: 6 }, selectedIds: [] }); return { end: m.slots.find(s => s.kind === 'END' && s.tier === 'FRONT').key, endB: m.slots.find(s => s.kind === 'END' && s.tier === 'BACK').key, rod: m.slots.find(s => s.kind === 'ROD' && s.tier === 'FRONT').key, bk: m.slots.find(s => s.kind === 'BRACKET').key }; })();
{
    const raw = { [kB.bk]: 'BK6', [kB.rod]: 'R', [kB.end]: 'FIN' };
    const s = settle(dbl, { rodKind: 'TRAVERSE', setup: 'SINGLE', proj: 6 }, raw);
    const d = droppedPicks(s.m, raw, s.live, { labelOf });
    ok('Rod Type → traverse: the solid rod and the solid bracket are both reported', ['H1-138B6', 'H1-138R'].every(c => d.some(x => x.partCode === c)), JSON.stringify(d.map(x => x.partCode)));
    ok('each carries a reason', d.every(x => x.reason && x.reason.length > 8), JSON.stringify(d.map(x => x.reason)));
}
{
    const raw = { [kB.end]: 'FIN', [kB.endB]: 'FIN-B', [kB.rod]: 'R' };
    const s = settle(dbl, { rodKind: 'SOLID', setup: 'SINGLE', proj: 6 }, raw);
    const d = droppedPicks(s.m, raw, s.live, { labelOf });
    eq('Single or Double → single: the back finial is reported once; the front one (same part, its own step) is not', d.map(x => x.choiceId), ['FIN-B']);
    ok('…on the back step, by name, though the step is no longer asked', /BACK/.test(d[0].step) && /not asked|no longer/.test(d[0].reason), d[0] && (d[0].step + ' / ' + d[0].reason));
}
{
    // acknowledgements survive a re-pass; a pick that comes back clears its entry
    const a = [{ key: 'END|LEFT|RET-E', acked: true }, { key: 'X|Y', acked: false }];
    const merged = mergeDrops(a, [{ key: 'END|LEFT|RET-E' }, { key: 'NEW|Z' }]);
    eq('acked stays acked, new arrives un-acked, the returned pick is gone', merged.map(d => [d.key, d.acked]), [['END|LEFT|RET-E', true], ['NEW|Z', false]]);
    eq('unacknowledged = the ones that block an add', unacknowledged(merged).map(d => d.key), ['NEW|Z']);
}

console.log(fail ? `\n❌  ${pass} passed, ${fail} failed` : `\n✅  ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
