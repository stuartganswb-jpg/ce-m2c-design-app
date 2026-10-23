// 📦 What the floor made — pieces, orders, and what they took (Stuart 2026-10-22).   node scripts/floorOutput.test.mjs
import {
    CATEGORY, CATEGORIES, MODE, categoryOfType, categoryOfName, piecesOfOrder, finishedPiecesOf, finishedAtOf,
    outputBetween, periodsOf, outputPeriodsOf, workByPersonOf, ordersBetween, minutesPerPieceOf, ovenByDayOf,
    changeOf, outputByDayOf, codesToAskOf, typeOfCodeFrom, stationOf, stationsOf, stepWorthOf, spinPeriodsOf, piecesOfStep,
} from '../src/components/Shared/floorOutput.js';

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}`); };
const eq = (n, a, b) => ok(`${n} — got ${JSON.stringify(a)}`, JSON.stringify(a) === JSON.stringify(b));
const MIN = 60000;
const at = (d, h, mi = 0) => new Date(2026, 9, d, h, mi).getTime();

// ── categories ──────────────────────────────────────────────────────────────────────────────────────────────
eq('types, however spelled', ['RING', 'Ring', 'BRACKET', 'Bracket', 'BACKPLATE', 'FINIAL', 'FINIAL COLLAR', 'Finial Collar', 'FINIAL TOP', 'POLE', 'Pole', 'TRAVERSE', 'END CAP', 'ROSETTE', 'Joiner', 'Wood Disc', '', null].map(categoryOfType),
    ['rings', 'rings', 'brackets', 'brackets', 'brackets', 'finials', 'finials', 'finials', 'finials', 'poles', 'poles', 'poles', 'other', 'other', 'other', 'other', null, null]);
eq('names, the last resort', ['1.5" Ring (10 Pack) - Champagne (CP)', 'Metal Rings Iron', '1.5" Ext Brkt Iron Black', '3.5" Projection French Return for 1" Rod - Bronze', 'INSIDE MNT 1" Brushed Brass', '1" Mtl Std Arm Iron', 'Metal Ball Finial Iron', 'Collar F for 1" Rod Burnished Silver', 'Orb Finial Commodore', '8ft X 1.5" Rod Iron', 'METAL RD 4\' X 1.5"Brushd Brass', 'FL END CAP FOR 1.5" Champagne', 'MTL WAND 40" BLACK', 'Sample Chip - N90', ''].map(categoryOfName),
    ['rings', 'rings', 'brackets', 'brackets', 'brackets', 'brackets', 'finials', 'finials', 'finials', 'poles', 'poles', 'other', 'other', 'other', null]);

// ── an order's pieces ───────────────────────────────────────────────────────────────────────────────────────
const master = { HCUSR1: 'Ring', HCUMLB410: 'BRACKET', 'HCUSMBF1/CP': 'Finial', HCUMP610: 'POLE' };
const typeOfCode = (c) => master[c] || '';
eq('a line\'s own type first', piecesOfOrder({ partsList: [{ legacyErpId: 'X1', productType: 'BRACKET', quantity: 4 }] }, { typeOfCode }).map(p => `${p.category}:${p.qty}:${p.by}`), ['brackets:4:line']);
eq('then the item master — full code, or bare', piecesOfOrder({ partsList: [{ legacyErpId: 'HCUSR1/SG', quantity: 140 }, { legacyErpId: 'HCUSMBF1/CP', qty: 6 }] }, { typeOfCode }).map(p => `${p.category}:${p.qty}:${p.by}`), ['rings:140:master', 'finials:6:master']);
eq('then the order\'s own type, for a one-line order', piecesOfOrder({ productType: 'END CAP', partsList: [{ legacyErpId: 'HCUFEC1', quantity: 3 }] }, { typeOfCode }).map(p => `${p.category}:${p.by}`), ['other:order']);
eq('then the name — a repaint run the item master has no record of', piecesOfOrder({ type: '1.5" Ext Brkt Iron Black', partsList: [{ legacyErpId: 'HAPREBR15', partName: 'HAPREBR15 — pull 2 to repaint BL', quantity: 2 }] }, { typeOfCode }).map(p => `${p.category}:${p.by}`), ['brackets:name']);
eq('pieces by `pcs` first, then quantity, then qty', piecesOfOrder({ partsList: [{ legacyErpId: 'HCUMP610', pcs: 3, quantity: 24, uom: 'FT' }] }, { typeOfCode })[0].qty, 3);
eq('a pick-only line, a line not finished here, an outsourced finish: not the floor\'s', piecesOfOrder({ partsList: [{ legacyErpId: 'A', productType: 'RING', quantity: 5, pickOnly: true }, { legacyErpId: 'B', productType: 'RING', quantity: 5, noFinish: true }, { legacyErpId: 'C', productType: 'RING', quantity: 5, finishOutsourced: true }, { legacyErpId: 'D', productType: 'RING', quantity: 7 }] }, { typeOfCode }).map(p => p.code), ['D']);
eq('no lines: the order itself — a pole-only order is its poles', piecesOfOrder({ totalParts: 10, totalPoles: 10, type: 'HTA635/CP', stockErpId: 'HTA635/CP' }, { typeOfCode }).map(p => `${p.category}:${p.qty}`), ['poles:10']);
eq('no lines and no pieces: nothing', piecesOfOrder({ totalParts: 0 }), []);

// ── how it was finished ─────────────────────────────────────────────────────────────────────────────────────
const S = { app: 'Sprayed', color: 'x' }, H = { app: 'Hand Applied', color: 'y' };
const recipes = { SG: { steps: [S, S] }, CP: { steps: [S, S] }, 'CP-P': { steps: [S, H, S] }, AB: { steps: [S, H] } };
const mixed = { id: 'M', recipe: 'CP', totalParts: 30, totalPoles: 10, partsList: [{ legacyErpId: 'HCUSR1', quantity: 20 }, { legacyErpId: 'HCUMP610', quantity: 10 }] };
eq('small parts on CP spray only; the poles on CP-P have a hand coat', finishedPiecesOf(mixed, { recipes, typeOfCode }).map(p => `${p.category}:${p.mode}:${p.qty}`), ['rings:spray:20', 'poles:hand:10']);
eq('an order released with no recipe reads it off its item code, as the floor does', finishedPiecesOf({ id: 'R', stockErpId: 'HCUMLB410/AB', partsList: [{ legacyErpId: 'HCUMLB410/AB', quantity: 4 }] }, { recipes, typeOfCode })[0].mode, MODE.HAND);
eq('a recipe with a hand coat: hand-finished small parts', finishedPiecesOf({ id: 'H', recipe: 'AB', partsList: [{ legacyErpId: 'HCUMLB410', quantity: 12 }] }, { recipes, typeOfCode })[0].mode, MODE.HAND);

// ── done = signed off the floor ─────────────────────────────────────────────────────────────────────────────
eq('finished: its completion; a pick-only order never came to the floor; a Stitch & Sew document is not the floor\'s', [finishedAtOf({ completedAt: 5 }), finishedAtOf({ completedAt: 5, pickOnly: true }), finishedAtOf({ completedAt: 5, completedBy: 'split (pick only)' }), finishedAtOf({}), finishedAtOf({ completedAt: 5, division: 'SEW' })], [5, 0, 0, 0, 0]);

const wos = [
    { id: 'a', recipe: 'SG', completedAt: at(22, 10), partsList: [{ legacyErpId: 'HCUSR1/SG', quantity: 140 }] },                                  // today, rings, spray
    { id: 'b', recipe: 'AB', completedAt: at(22, 11), partsList: [{ legacyErpId: 'HCUMLB410', quantity: 12 }, { legacyErpId: 'HCUSMBF1/CP', quantity: 6 }] },  // today, brackets + finials, hand
    { ...mixed, id: 'c', completedAt: at(20, 9) },                                                                                                   // this week (Tue)
    { id: 'd', recipe: 'SG', completedAt: at(15, 9), partsList: [{ legacyErpId: 'HCUSR1/SG', quantity: 70 }] },                                   // last week
    { id: 'e', recipe: 'SG', completedAt: at(22, 12), pickOnly: true, partsList: [{ legacyErpId: 'HCUSR1', quantity: 9 }] },                     // never on the floor
    { id: 'f', recipe: 'SG', currentPhase: 'Painting', partsList: [{ legacyErpId: 'HCUSR1', quantity: 50 }] },                                    // still on the floor
];
const today = outputBetween({ workOrders: wos, recipes, typeOfCode, fromMs: at(22, 0), toMs: at(22, 23) });
eq('today, by category and finish', [today.total, today.orders, today.byCategory.rings, today.byCategory.brackets, today.byCategory.finials, today.byCategory.poles.total],
    [158, 2, { spray: 140, hand: 0, total: 140, orders: 1 }, { spray: 0, hand: 12, total: 12, orders: 1 }, { spray: 0, hand: 6, total: 6, orders: 1 }, 0]);
const NOW = at(22, 15);
eq('the periods: today, this week from Monday, last week, last week to this point', Object.values(periodsOf(NOW)).map(p => [new Date(p.fromMs).getDate(), p.label]), [[22, 'Today'], [19, 'This week'], [12, 'Last week'], [12, 'Last week, to this point']]);
eq('last week to this point ends this moment a week ago', periodsOf(NOW).lastWeekToDate.toMs, at(15, 15) + 1);
const P = outputPeriodsOf({ workOrders: wos, recipes, typeOfCode, nowMs: NOW });
eq('this week vs last', [P.today.total, P.week.total, P.week.byCategory.poles, P.lastWeek.total, P.lastWeek.byCategory.rings.total], [158, 188, { spray: 0, hand: 10, total: 10, orders: 1 }, 70, 70]);
eq('every category is always there', Object.keys(P.today.byCategory), CATEGORIES);
eq('last week to this point: Thursday 9 am is in', P.lastWeekToDate.total, 70);
eq('the change against last week to this point', [changeOf(188, 70), changeOf(5, 0), changeOf(0, 0)], [{ diff: 118, pct: 118 / 70 }, { diff: 5, pct: null }, { diff: 0, pct: null }]);
eq('day by day, every day in range', outputByDayOf({ workOrders: wos, recipes, typeOfCode, fromMs: at(19, 0), toMs: NOW }).map(d => [d.date.slice(8), d.total, d.orders, d.byCategory.poles]), [['19', 0, 0, 0], ['20', 30, 1, 10], ['21', 0, 0, 0], ['22', 158, 2, 0]]);

// ── the item master ─────────────────────────────────────────────────────────────────────────────────────────
eq('the codes to ask: finished lines with no type of their own, full and bare; not pick-only, not still on the floor', codesToAskOf([...wos, { id: 'g', completedAt: at(22, 9), partsList: [{ legacyErpId: 'TYPED', productType: 'RING', quantity: 3 }] }, { id: 'h', completedAt: at(22, 9), totalParts: 4, stockErpId: 'hta635/cp' }], { fromMs: at(19, 0) }).sort(),
    ['HCUMLB410', 'HCUMP610', 'HCUSMBF1', 'HCUSMBF1/CP', 'HCUSR1', 'HCUSR1/SG', 'HTA635', 'HTA635/CP']);
eq('the item records → a type by code, manufacturing spec first, case-blind', ['hcusr1', 'HCUMLB410', 'NOPE'].map(typeOfCodeFrom({ HCUSR1: { manufacturingSpecs: { productType: 'Ring' }, productType: 'X' }, HCUMLB410: { productType: 'BRACKET' } })), ['Ring', 'BRACKET', '']);
eq('pieces resting on a name are counted apart', outputBetween({ workOrders: [{ id: 'n', completedAt: 5, type: 'Metal Rings Iron', partsList: [{ legacyErpId: 'ZZZ', partName: 'Metal Rings Iron', quantity: 30 }] }], recipes, typeOfCode, fromMs: 0, toMs: 10 }).byName, 30);

// ── who did what ────────────────────────────────────────────────────────────────────────────────────────────
const step = (who, woId, task, s, e, o = {}) => ({ who, woId, task, startMs: s, endMs: e, ranMins: (e - s) / MIN, person: !/Bake/.test(task), oven: /Bake/.test(task), short: false, overrun: false, ...o });
const wosById = Object.fromEntries(wos.map(w => [w.id, w]));
const steps = [
    step('Pat', 'a', 'spinSetup', at(22, 7), at(22, 7, 15)), step('Pat', 'a', 'spinSpray', at(22, 7, 20), at(22, 7, 40)), step('Pat', 'a', 'spinBake', at(22, 7, 41), at(22, 7, 50)),
    step('Pat', 'a', 'spinSpray', at(22, 8), at(22, 8, 20)),                                         // a second coat: 140 more
    step('Ann', 'b', 'hand', at(22, 9), at(22, 10, 30)),
    step('Kim', 'c', 'poleSpray', at(20, 7), at(20, 7, 40)), step('Kim', 'c', 'poleHand', at(20, 8), at(20, 9)),
];
const who = workByPersonOf({ steps, wosById, typeOfCode, fromMs: at(22, 0), toMs: at(22, 23) });
eq('Pat today: set up 140, sprayed 2 coats × 140, baked 140, one order — 280 ring coats (a setup or a bake is not a coat)', [who.Pat.setup, who.Pat.sprayed, who.Pat.baked, who.Pat.orders, who.Pat.byCategory.rings], [140, 280, 140, 1, 280]);
eq('Ann hand-finished 18: 12 brackets and 6 finials', [who.Ann.handFinished, who.Ann.byCategory.brackets, who.Ann.byCategory.finials], [18, 12, 6]);
eq('not today is not counted', who.Kim, undefined);
const wk = workByPersonOf({ steps, wosById, typeOfCode, fromMs: at(19, 0), toMs: at(22, 23) });
eq('Kim this week: 10 poles sprayed, 10 hand-finished — poles', [wk.Kim.sprayed, wk.Kim.handFinished, wk.Kim.byCategory.poles], [10, 10, 20]);
const loads = { id: 'L', recipe: 'SG', sprayStation: 'SPIN', totalParts: 420, spinLoads: [{ n: 1, qty: 140, doneAt: at(22, 9) }], spinLoadQty: 140, partsList: [{ legacyErpId: 'HCUSR1', quantity: 420 }] };
eq('a spin job in loads: a coat covers its load, not the order', workByPersonOf({ steps: [step('Pat', 'L', 'spinSpray', at(22, 8), at(22, 8, 20))], wosById: { L: loads }, typeOfCode, fromMs: 0, toMs: at(23, 0) }).Pat.sprayed, 140);

// ── capacity ────────────────────────────────────────────────────────────────────────────────────────────────
const orders = ordersBetween({ workOrders: wos, steps, recipes, typeOfCode, fromMs: at(22, 0), toMs: at(22, 23), refOf: (w) => w.id.toUpperCase() });
eq('orders finished, newest first, each with what it took', orders.map(o => [o.ref, o.pieces, o.coats, Math.round(o.floorMins), Math.round(o.handsOnMins), Math.round(o.flow * 100)]), [['B', 18, 2, 120, 90, 75], ['A', 140, 2, 180, 55, 31]]);
eq('a step left running counts its standard, not the hours it sat', ordersBetween({ workOrders: [wos[0]], steps: [step('Pat', 'a', 'spinSpray', at(22, 7), at(22, 9, 40), { overrun: true, normalMins: 20 })], recipes, typeOfCode, fromMs: 0, toMs: at(23, 0) }).map(o => [o.handsOnMins, o.leftRunning]), [[20, 1]]);
const mpp = minutesPerPieceOf({ steps, wosById, typeOfCode, fromMs: at(19, 0), toMs: at(22, 23) });
ok('spray minutes a ring: 40 min over 280 ring-coats', Math.abs(mpp.sprayed.rings.perPiece - 40 / 280) < 1e-9);
eq('hand minutes a bracket-order piece: 90 over 18; poles apart', [mpp.handFinished.brackets.perPiece, mpp.handFinished.poles.perPiece], [5, 6]);
eq('a punch that was not real is left out of the time per piece', minutesPerPieceOf({ steps: [step('Pat', 'a', 'spinSpray', at(22, 7), at(22, 7, 0, 3), { short: true })], wosById, typeOfCode, fromMs: 0, toMs: at(23, 0) }).sprayed, {});
const oven = ovenByDayOf({ steps, fromMs: at(22, 0), toMs: at(22, 23) });
eq('the oven today: one load, 9 of the 210 minutes from first punch to last', [oven.length, oven[0].loads, Math.round(oven[0].busyMins), Math.round(oven[0].dayMins)], [1, 1, 9, 210]);
eq('a bake left running overnight neither counts nor stretches the day', ovenByDayOf({ steps: [...steps, step('Pat', 'a', 'spinBake', at(22, 16), at(23, 7), { overrun: true })], fromMs: at(22, 0), toMs: at(23, 23) }).map(d => [d.date.slice(8), d.loads, Math.round(d.dayMins)]), [['22', 1, 210]]);

// ── the stations (Stuart 2026-10-22: "whom ran it last week vs this week for each station") ─────────────────────
eq('a step\'s station: the hand bench for any hand coat, the poles for a pole spray, else the order\'s spray station', [stationOf('spinSpray', {}), stationOf('spinSetup', { sprayStation: 'BOOTH' }), stationOf('poleSpray', {}), stationOf('poleHand', {}), stationOf('hand', { sprayStation: 'BOOTH' })], ['spin', 'booth', 'poles', 'hand', 'hand']);
const late = step('Pat', 'a', 'spinSpray', at(22, 9, 30), at(22, 9, 50));
const st = stationsOf({ steps: [...steps, late], wosById, typeOfCode, fromMs: at(19, 0), toMs: at(22, 23) });
eq('who worked each station: set up and coats apart, real minutes, days — the oven is nobody\'s station', st.people.map(p => [p.station, p.who, p.steps, p.setUp, p.coats, Math.round(p.mins), p.days]),
    [['spin', 'Pat', 4, 140, 420, 75, 1], ['poles', 'Kim', 1, 0, 10, 40, 1], ['hand', 'Ann', 1, 0, 18, 90, 1], ['hand', 'Kim', 1, 0, 10, 60, 1]]);
eq('day by day, who coated what at each station', st.days.map(d => [d.date.slice(8), Object.fromEntries(Object.entries(d.stations).map(([k, l]) => [k, l.map(x => `${x.who} ${x.coats}/${x.steps}`).join(', ')]))]),
    [['20', { poles: 'Kim 10/1', hand: 'Kim 10/1' }], ['22', { spin: 'Pat 420/3', hand: 'Ann 18/1' }]]);
eq('the spin machine\'s day: its sprays, ring coats, spraying time, and the stretch of 45 min or more with no spray (8:20 → 9:30)', st.spin.map(d => [d.date.slice(8), d.sprays, d.coats, d.rings, Math.round(d.busyMins), d.operators, d.gaps.map(g => [Math.round(g.mins), g.before, g.after])]),
    [['22', 3, 420, 420, 60, ['Pat'], [[70, 'Pat', 'Pat']]]]);
const worth = stepWorthOf({ steps: [...steps, late], wosById, typeOfCode });
eq('what a step is worth: the crew\'s usual time for it, at that station, for a batch that size', worth.table.map(t => `${t.key}:${t.mins}:${t.n}`),
    ['hand|hand|6–20:90:1', 'poleHand|hand|6–20:60:1', 'poleSpray|poles|6–20:40:1', 'spinSetup|spin|61–150:15:1', 'spinSpray|spin|61–150:20:3']);
eq('three real punches make a worth; fewer, and the step counts the floor\'s own standard', [worth.worthOf(late), worth.worthOf({ ...steps[4], normalMins: 77 }), worth.worthOf(steps[2])], [20, 77, 0]);
eq('what the spin machine sprayed, by period — before any of it is signed off', spinPeriodsOf({ steps, wosById, typeOfCode, nowMs: NOW }), { today: { coats: 280, rings: 280 }, week: { coats: 280, rings: 280 }, lastWeek: { coats: 0, rings: 0 }, lastWeekToDate: { coats: 0, rings: 0 } });
eq('the pieces a step handled, exported for the score', [piecesOfStep('spinSpray', wosById.a, at(22, 8), typeOfCode), piecesOfStep('poleSpray', wosById.c, at(20, 8), typeOfCode)], [140, 10]);

console.log(`floorOutput: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
