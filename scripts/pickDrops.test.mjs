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
    // ── THE SAME PART IN THE SAME STEP IS KEPT, WHATEVER TIER ITS PINS CARRY (Stuart 2026-10-13) ──
    // H1-75 and H1-1 pin a return plate once per depth, and the 3-5/8" copies carry rod: front while
    // the 4-5/8" and 6" ones carry none. A line saved on one copy and re-seated by the engine on the
    // copy at the return's depth was named "Removed by a later choice" — and the plate was on the
    // bill the whole time. (The portal session replayed 983 saved configurations: 6 false notices.)
    const model = {
        slots: [{ key: 'BACKPLATE||LEFT', kind: 'BACKPLATE', tier: '', position: 'LEFT', options: [], rejected: [] }],
        choices: [
            { id: 'RET', partId: 'CE-FEE-6294', role: 'RETURN', position: 'LEFT', tier: '' },
            { id: 'PL-46', partId: 'H1-75RCP-H', name: 'Horizontal Cover Plate for Returns', role: 'BACKPLATE', position: 'LEFT', tier: '' },
            { id: 'PL-36', partId: 'H1-75RCP-H', name: 'Horizontal Cover Plate for Returns', role: 'BACKPLATE', position: 'LEFT', tier: 'FRONT' },
            { id: 'PL-OTHER', partId: 'H1-75RBP-R', name: 'Round Backplate for Returns', role: 'BACKPLATE', position: 'LEFT', tier: 'FRONT' },
        ],
    };
    const raw = { 'END||LEFT': 'RET', 'BACKPLATE||LEFT': 'PL-46' };
    eq("a plate re-seated on another pin of the same part, in the same step, is kept — the pins' tier tags do not matter",
        droppedPicks(model, raw, { 'END||LEFT': 'RET', 'BACKPLATE||LEFT': 'PL-36' }, { labelOf }).map(x => x.choiceId), []);
    eq('…a DIFFERENT part seated in that step is still a removal',
        droppedPicks(model, raw, { 'END||LEFT': 'RET', 'BACKPLATE||LEFT': 'PL-OTHER' }, { labelOf }).map(x => x.choiceId), ['PL-46']);
    eq('…and so is the step left empty while its return is still there',
        droppedPicks(model, raw, { 'END||LEFT': 'RET' }, { labelOf }).map(x => x.choiceId), ['PL-46']);
}
{
    // The same thing through the engine itself: a line saved before 2026-10-13 holds the FIRST copy
    // of its return plate (the 4-5/8" one); the engine now seats the copy pinned at the return's
    // depth, which on H1-75 and H1-1 carries rod: front. Kept, and nothing to acknowledge.
    const parts = ['H1-75RBP-R', 'H1-75RCP-H'];
    const set = (slot, proj, extra = {}) => parts.map(p => C({ id: `#${slot}·${p}`, partId: p, role: 'BACKPLATE', position: 'LEFT', proj, mount: 'WALL', returnOnly: true, nodes: [`n${slot}${p}`], ...extra }));
    const cs = [
        C({ id: 'ROD', partId: 'H1-75R', role: 'ROD', rodKind: 'SOLID', position: 'CENTER', nodes: ['rc'] }),
        C({ id: 'ROD-L', partId: 'H1-75R', role: 'ROD', rodKind: 'SOLID', position: 'LEFT', nodes: ['rl'] }),
        C({ id: 'B3', partId: 'H1-75BS', role: 'BRACKET', position: 'CENTER', proj: '3.625', setup: 'SINGLE', mount: 'WALL', nodes: ['b3'] }),
        C({ id: 'B4', partId: 'H1-75BE', role: 'BRACKET', position: 'CENTER', proj: '4.625', setup: 'SINGLE', mount: 'WALL', nodes: ['b4'] }),
        C({ id: 'MT3', partId: 'CE-FEE-6294', role: 'RETURN', position: 'LEFT', proj: '3.625', setup: 'SINGLE', nodes: ['mt3'] }),
        ...set(24, '4.625'), ...set(61, '3.625', { setup: 'SINGLE', tier: 'FRONT' }),
    ];
    const answers = { setup: 'SINGLE', proj: 3.625 };
    const m0 = resolve({ choices: cs, answers, selectedIds: ['ROD', 'MT3'] });
    const k = { rod: m0.slots.find(s => s.kind === 'ROD').key, end: m0.slots.find(s => s.kind === 'END' && s.position === 'LEFT').key, bp: m0.slots.find(s => s.kind === 'BACKPLATE' && s.position === 'LEFT').key };
    const raw = { [k.rod]: 'ROD', [k.end]: 'MT3', [k.bp]: '#24·H1-75RCP-H' };
    const s = settle(cs, answers, raw);
    eq("a line saved on the first copy re-seats on the copy pinned at the return's depth", s.live[k.bp], '#61·H1-75RCP-H');
    eq('…and nothing is named as removed', droppedPicks(s.m, raw, s.live, { labelOf }).map(x => x.choiceId), []);
}
{
    // ── A SAVED PICK THAT IS NOT AMONG THE CHOICES ANY MORE (Stuart 2026-10-13: "fix both") ─────────────────
    // The line was saved with a knob finial and the 6" bracket. Since then the finial's tag was given a new item
    // number in 1.6 — which re-makes the pin (FIN → FIN-N, H1-75KF → H1-75KFN). Reopened, the finial is not among
    // the choices: the engine lets the pick go, and until today nothing said so.
    const finialOnly = (extra) => [...RAW_SINGLE.filter(c => c.id !== 'FIN'), ...extra];
    const renumbered = finialOnly([C({ id: 'FIN-N', partId: 'H1-75KFN', name: 'Knob Finial, new number', role: 'FINIAL', position: 'LEFT', nodes: ['fin'] })]);
    const k = (() => { const m = resolve({ choices: RAW_SINGLE, answers: { proj: 6 }, selectedIds: [] }); return { rod: m.slots.find(s => s.kind === 'ROD').key, end: m.slots.find(s => s.kind === 'END').key }; })();
    const raw = { [k.rod]: 'R', [k.end]: 'FIN' };
    const s = settle(renumbered, { proj: 6 }, raw);
    eq('the engine lets go of a pick whose pin is gone', [s.live[k.rod], s.live[k.end]], ['R', undefined]);
    eq('not told every choice the assembly pins, the reader passes such a pick over — as it always has (Vision still calls it so)', droppedPicks(s.m, raw, s.live, { labelOf }), []);
    const named = droppedPicks(s.m, raw, s.live, { labelOf, everyChoice: renumbered });
    eq('told every choice, it NAMES it — by its step alone where the line did not record the part', named.map(x => [x.key, x.step, x.partName, x.partCode]), [[`${k.end}|FIN`, 'LEFT END', 'the part saved on this line', '']]);
    ok('…and says why', /no longer on this assembly — its tag in 1\.6 was changed or removed since this line was saved$/.test(named[0].reason), named[0].reason);
    const withPart = droppedPicks(s.m, raw, s.live, { labelOf, everyChoice: renumbered, savedParts: { [k.end]: { partId: 'CE-INV-1', code: 'H1-75KF', name: 'Knob Finial' }, [k.rod]: { partId: 'H1-75R', code: 'H1-75R', name: 'Rod' } } });
    eq('a line saved from today on recorded the part beside the pick: it is named by the part', withPart.map(x => [x.step, x.partName, x.partCode]), [['LEFT END', 'Knob Finial', 'H1-75KF']]);
    // a tag taken off and put back: a new pin of the SAME part
    const repinned = finialOnly([C({ id: 'FIN-2', partId: 'H1-75KF', name: 'Knob Finial', role: 'FINIAL', position: 'LEFT', nodes: ['fin'] })]);
    const s2 = settle(repinned, { proj: 6 }, raw);
    const again = droppedPicks(s2.m, raw, s2.live, { labelOf, everyChoice: repinned, savedParts: { [k.end]: { partId: 'H1-75KF', code: 'H1-75KF', name: 'Knob Finial' } } });
    eq('the same part under a re-made pin is named too — and the line says it is still offered there', again.map(x => [x.partName, /still offered on this step: pick it again$/.test(x.reason)]), [['Knob Finial', true]]);
    eq('…picked again, the entry is gone', droppedPicks(s2.m, { ...raw, [k.end]: 'FIN-2' }, settle(repinned, { proj: 6 }, { ...raw, [k.end]: 'FIN-2' }).live, { labelOf, everyChoice: repinned }), []);
    // a step the engine fills itself: the line that cannot say which part it held is not asked about it
    const seatedModel = { slots: [{ key: 'TRACK|FRONT|', kind: 'TRACK', tier: 'FRONT', position: '', options: [{ id: 'T-NEW', partId: 'TRK', name: 'Track' }] }], choices: [{ id: 'T-NEW', partId: 'TRK', name: 'Track', role: 'TRACK' }] };
    const autoLive = { 'TRACK|FRONT|': 'T-NEW' };
    eq('a pick whose pin is gone, in a step the engine has filled itself: not named where the line cannot say what it held', droppedPicks(seatedModel, { 'TRACK|FRONT|': 'T-OLD' }, autoLive, { labelOf, everyChoice: seatedModel.choices }), []);
    eq('…nor where it held the same part', droppedPicks(seatedModel, { 'TRACK|FRONT|': 'T-OLD' }, autoLive, { labelOf, everyChoice: seatedModel.choices, savedParts: { 'TRACK|FRONT|': { partId: 'trk', code: 'TRK', name: 'Track' } } }), []);
    eq('…named where it held ANOTHER part, with what the step holds now', droppedPicks(seatedModel, { 'TRACK|FRONT|': 'T-OLD' }, autoLive, { labelOf, everyChoice: seatedModel.choices, savedParts: { 'TRACK|FRONT|': { partId: 'TRK-OLD', code: 'TRK-OLD', name: 'Old track' } } }).map(x => [x.partName, x.partCode, / \(the step now holds Track\)$/.test(x.reason)]), [['Old track', 'TRK-OLD', true]]);
    // a flow that asks the size: the pin is on the assembly, the part is not made at the size now chosen
    const sized = RAW_SINGLE.filter(c => c.id !== 'FIN');           // what is offered at the size chosen: every choice but the finial
    const s3 = settle(sized, { proj: 6 }, raw);
    eq('a part still pinned on the assembly but not offered at the size now chosen is named by its part', droppedPicks(s3.m, raw, s3.live, { labelOf, everyChoice: RAW_SINGLE }).map(x => [x.step, x.partName, x.partCode, x.reason]), [['LEFT END', 'Knob Finial', 'H1-75KF', 'not made in the size now chosen']]);
    eq('a step that is no longer asked at all is still named, by what its key says', droppedPicks(s3.m, { 'RING|BACK|': 'RING-GONE' }, s3.live, { labelOf, everyChoice: RAW_SINGLE }).map(x => [x.step, x.partName]), [['BACK RING', 'the part saved on this line']]);
    eq('the operator\'s own un-pick is still no removal', droppedPicks(s3.m, { [k.end]: '', [k.rod]: 'R' }, s3.live, { labelOf, everyChoice: RAW_SINGLE }), []);
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
