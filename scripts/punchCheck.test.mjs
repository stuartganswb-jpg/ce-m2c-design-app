// ⏱ A punch that does not match the work (Stuart 2026-10-01, WO-SO60712).   node scripts/punchCheck.test.mjs
import { normalMinutesOf, minHonestMinutes, punchCheckOf, catchUpRunOf, punchWarning, punchFlagText, PUNCH_FLAG, doublePunchSecsOf, doublePunchWords, DOUBLE_PUNCH_SECS } from '../src/components/Shared/punchCheck.js';
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

// ── a booth coat is the booth's standard, per load (Stuart 2026-10-14: "yes on the 15min standard") ───────────
const booth = (pcs, extra = {}) => ({ id: 'B', totalParts: pcs, sprayStation: 'BOOTH', ...extra });
eq('booth spray: 15 min a load of up to 30 — 6, 30, 31 and 70 pieces', [6, 30, 31, 70].map(n => normalMinutesOf('spinSpray', booth(n), cfg)), [15, 15, 30, 45]);
eq('booth spray: Production Times\' booth settings win', normalMinutesOf('spinSpray', booth(40), { ...cfg, boothCoatMins: 12, boothLoadPcs: 20 }), 24);
eq('booth spray: a booth document of poles and small parts counts only its small parts', normalMinutesOf('spinSpray', booth(70, { totalPoles: 10 }), cfg), 30);
eq('the spin machine keeps its own spray time', [normalMinutesOf('spinSpray', { totalParts: 70, sprayStation: 'SPIN' }, cfg), normalMinutesOf('spinSpray', { totalParts: 70 }, cfg)], [3, 3]);
eq('booth: setup and bake are unchanged', [normalMinutesOf('spinSetup', booth(70), cfg), normalMinutesOf('spinBake', booth(70), cfg)], [10, 10]);
eq('booth: a coat punched in 3 minutes is now under a quarter of 15', punchCheckOf({ startedMs: 1e12, completedMs: 1e12 + 3 * 60000, normalMins: normalMinutesOf('spinSpray', booth(12), cfg) }).flag, PUNCH_FLAG.TOO_SHORT);
eq('booth: a coat of 4 minutes passes', punchCheckOf({ startedMs: 1e12, completedMs: 1e12 + 4 * 60000, normalMins: normalMinutesOf('spinSpray', booth(12), cfg) }).flag, null);

// ── 🌲 a wood coat's dry slot is the 20-minute air dry, not the oven (2026-10-19 · Shared/airDry) ──
{
    const FIN = [{ code: 'SM04', material: 'WOOD' }, { code: 'P16', material: 'METAL' }];
    const cfg = { ovenMins: 30 };
    eq('normal time of the dry slot: wood 20, paint the oven', [normalMinutesOf('spinBake', { recipe: 'SM04' }, cfg, FIN), normalMinutesOf('poleBake', { recipe: 'SM04' }, cfg, FIN), normalMinutesOf('spinBake', { recipe: 'P16' }, cfg, FIN)], [20, 20, 30]);
    eq('a CE stain is wood even with no list (the S-code fallback)', normalMinutesOf('spinBake', { recipe: 'S04' }, cfg), 20);
    eq('a 12-minute air dry is honest (a quarter of 20 is 5)', punchCheckOf({ startedMs: 1_000_000, completedMs: 1_000_000 + 12 * 60000, normalMins: 20 }).flag || '', '');
}

// ── the double punch (Stuart 2026-10-21 — WO11718: pole spray started and completed at 2:14:02) ────────────────────
const T0 = 1_800_000_000_000;
eq('the line: under a minute', DOUBLE_PUNCH_SECS, 60);
eq('Rafa\'s pole spray, 0 and 6 seconds apart: a double punch, with the seconds', [doublePunchSecsOf({ taskKey: 'poleSpray', startedMs: T0, completedMs: T0 }), doublePunchSecsOf({ taskKey: 'spinSpray', startedMs: T0, completedMs: T0 + 6000 })], [0, 6]);
eq('a minute or more is not (the short-punch warning still judges it)', [doublePunchSecsOf({ taskKey: 'spinSpray', startedMs: T0, completedMs: T0 + 60000 }), doublePunchSecsOf({ taskKey: 'hand', startedMs: T0, completedMs: T0 + 300000 })], [null, null]);
eq('a hand coat completed at once is one too', doublePunchSecsOf({ taskKey: 'poleHand', startedMs: T0, completedMs: T0 + 2000 }), 2);
eq('a bake is not asked here — its own stop refuses it', [doublePunchSecsOf({ taskKey: 'spinBake', startedMs: T0, completedMs: T0 + 1000 }), doublePunchSecsOf({ taskKey: 'poleBake', startedMs: T0, completedMs: T0 + 1000 })], [null, null]);
eq('never started is not a double punch (it is NO_START)', doublePunchSecsOf({ taskKey: 'spinSpray', startedMs: null, completedMs: T0 }), null);
const dw = doublePunchWords({ who: 'Rafa', order: 'WO11718', step: 'Pole Spray', stepEs: 'Pintura de barras', secs: 0 });
eq('the words, in both languages', [dw.title, dw.titleEs, dw.rule, dw.ruleEs], ['STOP — THAT IS NOT CORRECT', 'ALTO — ESO NO ES CORRECTO', 'Press ONCE to START when you begin the step. Press AGAIN when the step is COMPLETE.', 'Presione UNA VEZ para EMPEZAR cuando comience el paso. Presione OTRA VEZ cuando el paso esté TERMINADO.']);
eq('who, what, how far apart', [dw.detail, dw.detailEs], ['Rafa · Pole Spray on WO11718 — started and completed 0 seconds apart. This is logged.', 'Rafa · Pintura de barras en WO11718 — empezado y terminado con 0 segundos de diferencia. Esto queda registrado.']);

console.log(`punchCheck: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
