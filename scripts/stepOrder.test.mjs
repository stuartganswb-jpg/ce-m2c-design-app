// 🪜 The steps of a coat run in order, and a bake runs its time (Stuart 2026-10-13).   node scripts/stepOrder.test.mjs
import { startStopOf, bakeStopOf, stepStopReason, stepStopText, stepOverrideText, stepStopLogText, STEP_STOP, STEPS_BEFORE, BAKE_KEYS } from '../src/components/Shared/stepOrder.js';
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}`); };
const eq = (n, a, b) => ok(`${n} — got ${JSON.stringify(a)}`, JSON.stringify(a) === JSON.stringify(b));
const MIN = 60000;
const NOW = 1_800_000_000_000;
const T = (status, startedMinsAgo) => ({ status, ...(startedMinsAgo != null ? { startTime: NOW - startedMinsAgo * MIN } : {}) });
const wo = (tasks) => ({ id: 'WO11688', tasks });

// ── the order inside a coat ────────────────────────────────────────────────────────────────────
eq('the order, as written down', [STEPS_BEFORE.spinSetup, STEPS_BEFORE.spinSpray, STEPS_BEFORE.spinBake, STEPS_BEFORE.poleSpray, STEPS_BEFORE.poleBake, STEPS_BEFORE.hand, STEPS_BEFORE.poleHand],
    [[], ['spinSetup'], ['spinSetup', 'spinSpray'], [], ['poleSpray'], [], []]);
eq('the bakes', BAKE_KEYS, ['spinBake', 'poleBake']);

// ── a step starts only after the one before it ─────────────────────────────────────────────────
const fresh = wo({ spinSetup: T('Pending'), spinSpray: T('Pending'), spinBake: T('Pending'), poleSpray: T('Pending'), poleBake: T('Pending') });
eq('setup is the first step — nothing stops it', startStopOf({ wo: fresh, taskKey: 'spinSetup' }), null);
eq('spray before setup is stopped, and says setup', startStopOf({ wo: fresh, taskKey: 'spinSpray' }), { kind: 'OUT_OF_ORDER', taskKey: 'spinSpray', waitsOn: 'spinSetup', running: false });
eq('bake before setup is stopped at the FIRST open step', startStopOf({ wo: fresh, taskKey: 'spinBake' }).waitsOn, 'spinSetup');
eq('setup running is not setup done', startStopOf({ wo: wo({ spinSetup: T('Running', 2) }), taskKey: 'spinSpray' }), { kind: 'OUT_OF_ORDER', taskKey: 'spinSpray', waitsOn: 'spinSetup', running: true });
eq('setup done → spray may start', startStopOf({ wo: wo({ spinSetup: T('Complete') }), taskKey: 'spinSpray' }), null);
eq('setup done, spray not → bake waits on the spray', startStopOf({ wo: wo({ spinSetup: T('Complete'), spinSpray: T('Running', 1) }), taskKey: 'spinBake' }).waitsOn, 'spinSpray');
eq('setup and spray done → bake may start', startStopOf({ wo: wo({ spinSetup: T('Complete'), spinSpray: T('Complete') }), taskKey: 'spinBake' }), null);
// WO11688, load 2 (live 2026-10-13): the bake completed, setup and spray never touched.
eq('WO11688: with the bake already ticked, spray still waits on setup', startStopOf({ wo: wo({ spinSetup: T('Pending', 1600), spinSpray: T('Pending', 1600), spinBake: T('Complete', 1300) }), taskKey: 'spinSpray' }).waitsOn, 'spinSetup');
eq('poles: spray is first', startStopOf({ wo: fresh, taskKey: 'poleSpray' }), null);
eq('poles: bake waits on the pole spray', startStopOf({ wo: fresh, taskKey: 'poleBake' }), { kind: 'OUT_OF_ORDER', taskKey: 'poleBake', waitsOn: 'poleSpray', running: false });
eq('poles: sprayed → bake may start', startStopOf({ wo: wo({ poleSpray: T('Complete') }), taskKey: 'poleBake' }), null);
eq('the two tracks do not hold each other — a pole bake never waits on the sled', startStopOf({ wo: wo({ poleSpray: T('Complete'), spinSetup: T('Pending') }), taskKey: 'poleBake' }), null);
eq('a hand coat is one step — nothing before it', [startStopOf({ wo: fresh, taskKey: 'hand' }), startStopOf({ wo: fresh, taskKey: 'poleHand' })], [null, null]);
eq('a step this rule does not know is never stopped', [startStopOf({ wo: fresh, taskKey: 'somethingElse' }), startStopOf({}), startStopOf()], [null, null, null]);
eq('a document with no tasks yet: setup starts, spray does not', [startStopOf({ wo: { id: 'x' }, taskKey: 'spinSetup' }), startStopOf({ wo: { id: 'x' }, taskKey: 'spinSpray' }).waitsOn], [null, 'spinSetup']);

// ── a bake runs its time ───────────────────────────────────────────────────────────────────────
const bake = (task, ovenMins = 6, taskKey = 'spinBake') => bakeStopOf({ taskKey, task, nowMs: NOW, ovenMins });
eq('two minutes into a six-minute oven → too soon, four left', (({ kind, started, ranMins, ovenMins, leftMins }) => [kind, started, ranMins, ovenMins, leftMins])(bake(T('Running', 2))), ['BAKE_TOO_SOON', true, 2, 6, 4]);
eq('the full oven time → it may be completed', bake(T('Running', 6)), null);
eq('past the oven time → it may be completed', bake(T('Running', 45)), null);
eq('twelve seconds (the median pole bake, live) → too soon', bake(T('Running', 0.2), 6, 'poleBake').kind, STEP_STOP.BAKE_TOO_SOON);
eq('a bake never started has not baked', (({ started, ranMins, leftMins }) => [started, ranMins, leftMins])(bake(T('Pending'))), [false, 0, 6]);
// The floor leaves a step's last start time on it when the coat advances — it is another coat's, never this one's.
eq('a start time left by an earlier coat is not this coat\'s bake', bake(T('Pending', 180)).started, false);
eq('a completed bake asked again is not a running one', bake(T('Complete', 30)).started, false);
eq('only bakes are held to the oven — a spray is the punch notice\'s', [bakeStopOf({ taskKey: 'spinSpray', task: T('Running', 0.1), nowMs: NOW, ovenMins: 6 }), bakeStopOf({ taskKey: 'hand', task: T('Running', 0.1), nowMs: NOW, ovenMins: 6 })], [null, null]);
eq('no oven time set → nothing to hold it to', [bake(T('Running', 0.1), 0), bake(T('Running', 0.1), null), bakeStopOf({ taskKey: 'spinBake', task: T('Running', 0.1), nowMs: NOW }), bakeStopOf()], [null, null, null, null]);

// ── the words ──────────────────────────────────────────────────────────────────────────────────
{
    const order = startStopOf({ wo: fresh, taskKey: 'spinBake' });
    const r = stepStopReason(order);
    ok('out of order, English: names the open step, this step and the line', /^Setup has not been completed on this coat — Bake comes after it \(Setup → Spray → Bake\)\.$/.test(r.en));
    ok('out of order, Spanish', /^Preparación no se ha completado en esta capa — Horno va después \(Preparación → Pintura → Horno\)\.$/.test(r.es));
    ok('a running step reads "still running"', /is still running/.test(stepStopReason(startStopOf({ wo: wo({ spinSetup: T('Running', 1) }), taskKey: 'spinSpray' })).en));
    ok('poles spell their own line', /\(Pole Spray → Pole Bake\)/.test(stepStopReason(startStopOf({ wo: fresh, taskKey: 'poleBake' })).en));
    const txt = stepStopText({ stop: order, who: 'Rafa', order: 'WO11688', step: 'Sled Bake', stepEs: 'Horno' });
    ok('the stop: both languages, the order, who, the override, the log', /NOT YET — THE STEPS RUN IN ORDER — Rafa/.test(txt) && /Sled Bake · WO11688/.test(txt) && /A manager can override this with their own PIN\./.test(txt)
        && /This stop has been logged\./.test(txt) && /TODAVÍA NO — LOS PASOS VAN EN ORDEN — Rafa/.test(txt) && /Horno · WO11688/.test(txt) && /Un gerente puede autorizarlo/.test(txt));
    const soon = bake(T('Running', 2.4));
    ok('too soon, English: ran, of, left', stepStopReason(soon).en === 'This bake has run 2 min of 6 — about 4 min left. It is too soon to PIN it complete.');
    ok('too soon, Spanish', stepStopReason(soon).es === 'Este horneado lleva 2 min de 6 — faltan unos 4 min. Es demasiado pronto para marcarlo como completado.');
    ok('seconds in reads "under 1 min"', /has run under 1 min of 6 — about 6 min left/.test(stepStopReason(bake(T('Running', 0.2))).en));
    ok('never started says so, and what to press', /was never started on this coat — the oven time is 6 min\. Press START/.test(stepStopReason(bake(T('Pending'))).en) && /Presione EMPIEZA/.test(stepStopReason(bake(T('Pending'))).es));
    const bt = stepStopText({ stop: soon, who: 'Jhonaton', order: 'WO11721', step: 'Pole Bake', stepEs: 'Horno de barras' });
    ok('the bake stop is headed TOO SOON in both languages', /^⏱ TOO SOON — THE BAKE HAS NOT RUN ITS TIME — Jhonaton/.test(bt) && /DEMASIADO PRONTO — EL HORNO NO HA CUMPLIDO SU TIEMPO — Jhonaton/.test(bt));
    const ov = stepOverrideText({ stop: soon, who: 'Grace', order: 'WO11721', step: 'Pole Bake' });
    ok('the manager is asked, by name, with the same reason — Cancel holds, OK is logged', /^⚠ MANAGER OVERRIDE — Grace/.test(ov) && /This bake has run 2 min of 6/.test(ov) && /Press Cancel to hold \(normal\)\./.test(ov) && /logged under your name/.test(ov));
    eq('the log lines', [stepStopLogText(order), stepStopLogText(soon), stepStopLogText(bake(T('Pending'))), stepStopLogText(null)],
        ['spinSetup not complete on this coat', 'bake ran 2.4m of 6m', 'bake never started (oven 6m)', '']);
    eq('nothing to say for no stop', stepStopReason(null), { en: '', es: '' });
}

console.log(`stepOrder: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
