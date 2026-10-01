// ⏱ A punch that does not match the work (Stuart 2026-10-01, WO-SO60712).   node scripts/punchCheck.test.mjs
import { normalMinutesOf, minHonestMinutes, punchCheckOf, catchUpRunOf, punchWarning, punchFlagText, PUNCH_FLAG } from '../src/components/Shared/punchCheck.js';
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}`); };
const eq = (n, a, b) => ok(`${n} — got ${JSON.stringify(a)}`, JSON.stringify(a) === JSON.stringify(b));
const MIN = 60000;

// The floor's timers as they are set (Finishing settings defaults).
const cfg = { spinSetupMins: 10, spinPaintMins: 3, ovenMins: 10, poleMins: 5, handPoleMins: 10, handSmallMins: 1.35 };
const wo = { id: 'WO-SO60712', totalParts: 25, totalPoles: 1, poles: { qty: 1 } };

// ── how long a step normally takes ──────────────────────────────────────────────────────────
eq('the normal times, per step', ['spinSetup', 'spinSpray', 'spinBake', 'poleSpray', 'poleBake', 'poleHand'].map(k => normalMinutesOf(k, wo, cfg)), [10, 3, 10, 5, 10, 10]);
eq('small-parts hand: per piece', normalMinutesOf('hand', wo, cfg), 33.75);
eq('three poles take three times as long to spray and to hand finish', [normalMinutesOf('poleSpray', { totalPoles: 3 }, cfg), normalMinutesOf('poleHand', { poles: { qty: 3 } }, cfg)], [15, 30]);
eq('an unknown step, or no timers, has no normal', [normalMinutesOf('qc', wo, cfg), normalMinutesOf('spinBake', wo, {})], [0, 0]);
eq('the shortest honest run: a quarter of normal, never under a minute', [10, 3, 33.75, 0].map(minHonestMinutes), [2.5, 1, 8.4375, 1]);

// ── one completion ──────────────────────────────────────────────────────────────────────────
const at = (startMin, endMin, normal) => punchCheckOf({ startedMs: startMin == null ? null : 1000 + startMin * MIN, completedMs: 1000 + endMin * MIN, normalMins: normal });
eq('the pole hand coat on SO60712: started and completed inside the same minute', [at(0, 0.5, 10).flag, at(0, 0.5, 10).minMins], [PUNCH_FLAG.TOO_SHORT, 2.5]);
eq('a 10-minute bake logged at 2 min is off; at 3 min it is not', [at(0, 2, 10).flag, at(0, 3, 10).flag], [PUNCH_FLAG.TOO_SHORT, null]);
eq('a 3-minute spray: the one-minute floor decides', [at(0, 0.5, 3).flag, at(0, 1, 3).flag], [PUNCH_FLAG.TOO_SHORT, null]);
eq('a full-length step is fine, and so is a long one', [at(0, 10, 10).flag, at(0, 45, 10).flag], [null, null]);
eq('completed with no start punch at all', [at(null, 5, 10).flag, at(null, 5, 10).ranMins], [PUNCH_FLAG.NO_START, null]);
eq('no timer for the step: only the one-minute floor applies', [at(0, 0.2, 0).flag, at(0, 2, 0).flag], [PUNCH_FLAG.TOO_SHORT, null]);
eq('what ran, in minutes', Math.round(at(0, 7.5, 10).ranMins * 10) / 10, 7.5);

// ── a catch-up run: SO60712, 2:11 → 2:13 by Rafa ────────────────────────────────────────────
const t0 = 1790878260000;   // 2:11:00
const done = (minsAfter, by = 'Rafa') => ({ status: 'Complete', completedAt: t0 + minsAfter * MIN, completedBy: by });
let tasks = { spinSetup: done(0), spinSpray: { status: 'Running' } };
eq('the second step in a minute is not a run yet', catchUpRunOf({ wo: { tasks }, actor: 'Rafa', taskKey: 'spinSpray', nowMs: t0 + 0.4 * MIN }), null);
tasks = { spinSetup: done(0), spinSpray: done(0.4), spinBake: { status: 'Running' } };
eq('the third is', catchUpRunOf({ wo: { tasks }, actor: 'Rafa', taskKey: 'spinBake', nowMs: t0 + 0.8 * MIN }), { count: 3, keys: ['spinBake', 'spinSetup', 'spinSpray'] });
tasks = { spinSetup: done(0), spinSpray: done(0.4), spinBake: done(0.8), poleHand: done(1.5), poleSpray: done(2), poleBake: {} };
eq('by the sixth it says six', catchUpRunOf({ wo: { tasks }, actor: 'Rafa', taskKey: 'poleBake', nowMs: t0 + 2.4 * MIN }).count, 6);
eq('steps somebody ELSE completed do not count', catchUpRunOf({ wo: { tasks: { spinSetup: done(0, 'Anne'), spinSpray: done(0.4, 'Anne') } }, actor: 'Rafa', taskKey: 'spinBake', nowMs: t0 + MIN }), null);
eq('steps from earlier in the day do not count', catchUpRunOf({ wo: { tasks: { spinSetup: done(-90), spinSpray: done(-45) } }, actor: 'Rafa', taskKey: 'spinBake', nowMs: t0 }), null);
eq('five minutes is the window: at 5:00 it counts, at 5:01 it does not', [catchUpRunOf({ wo: { tasks: { a: done(0), b: done(0) } }, actor: 'Rafa', taskKey: 'c', nowMs: t0 + 5 * MIN })?.count, catchUpRunOf({ wo: { tasks: { a: done(0), b: done(0) } }, actor: 'Rafa', taskKey: 'c', nowMs: t0 + 5 * MIN + 1000 })], [3, null]);
eq('nobody named, nothing to count', [catchUpRunOf({ wo: { tasks }, actor: '', taskKey: 'poleBake', nowMs: t0 }), catchUpRunOf()], [null, null]);

// ── what the operator reads ─────────────────────────────────────────────────────────────────
let msg = punchWarning({ who: 'Rafa', order: 'SO60712', step: 'Pole Hand Finish', stepEs: 'Acabado a mano (barras)', check: at(0, 0.5, 10), catchUp: { count: 4 } });
ok('English: the step, what was logged, what is normal', /CHECK YOUR PUNCHES — Rafa/.test(msg) && /Pole Hand Finish · SO60712/.test(msg) && /logged as under 1 min — it normally takes about 10 min/.test(msg));
ok('English: the run, what to do, and that it is logged', /4 steps on this order were completed within 5 minutes/.test(msg) && /Press START when the work starts and COMPLETE when it is done/.test(msg) && /This punch has been logged\./.test(msg));
ok('Spanish: the same', /REVISE SUS REGISTROS — Rafa/.test(msg) && /Acabado a mano \(barras\) · SO60712/.test(msg) && /se registró con menos de 1 min — normalmente toma unos 10 min/.test(msg) && /Se completaron 4 pasos de este pedido en menos de 5 minutos/.test(msg) && /Presione EMPIEZA cuando comience el trabajo y COMPLETADO cuando termine/.test(msg) && /Este registro ha sido anotado\./.test(msg));
ok('English first, then Spanish', msg.indexOf('CHECK YOUR PUNCHES') < msg.indexOf('REVISE SUS REGISTROS'));
msg = punchWarning({ who: 'Jhonaton', order: 'WO-1', step: 'Sled Bake', check: at(null, 3, 10) });
ok('no start punch, in both', /completed without ever being started \(it normally takes about 10 min\)/.test(msg) && /se completó sin haberse iniciado \(normalmente toma unos 10 min\)/.test(msg));
msg = punchWarning({ who: 'Rafa', order: 'WO-1', step: 'Sled Bake', check: at(0, 10, 10), catchUp: { count: 3 } });
ok('a run of honest-length steps says only the run', /3 steps on this order/.test(msg) && !/logged as/.test(msg) && !/without ever being started/.test(msg));

// ── the stamp on the order window's tile ────────────────────────────────────────────────────
eq('too short', punchFlagText({ punchFlag: 'TOO_SHORT', punchRanMs: 20000, punchNormalMins: 10 }), '⚠ ran under 1 min (normal ~10 min)');
eq('a few minutes short', punchFlagText({ punchFlag: 'TOO_SHORT', punchRanMs: 2 * MIN, punchNormalMins: 10 }), '⚠ ran 2 min (normal ~10 min)');
eq('no start', punchFlagText({ punchFlag: 'NO_START', punchNormalMins: 5 }), '⚠ no start punch (normal ~5 min)');
eq('nothing flagged, nothing said', [punchFlagText({}), punchFlagText(null), punchFlagText({ punchFlag: '' })], ['', '', '']);

console.log(`punchCheck: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
