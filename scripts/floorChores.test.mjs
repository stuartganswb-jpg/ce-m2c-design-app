// 🧰 Chores — work in between the steps (Stuart 2026-10-14).   node scripts/floorChores.test.mjs
import {
    CHORE_KINDS, CHORE_ACTION, CHORE_END_WHY, choreKeyOf, fieldOf, choreLabelOf, openChoresOf, openChoreFor,
    choreStartRefusal, choreRecordOf, choreLogOf, choreIntervalsOf,
} from '../src/components/Shared/floorChores.js';

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}`); };
const eq = (n, a, b) => ok(`${n} — got ${JSON.stringify(a)}`, JSON.stringify(a) === JSON.stringify(b));
const MIN = 60000;
const NOW = 1_800_000_000_000;

eq('the two chores Stuart named', Object.keys(CHORE_KINDS), ['paintPrep', 'setupPrep']);
eq('labels, in both languages', [CHORE_KINDS.paintPrep.label, CHORE_KINDS.setupPrep.es, choreLabelOf('paintPrep'), choreLabelOf('mystery')], ['Paint prep', 'Preparar montaje', 'Paint prep', 'mystery']);
eq('a person\'s slot is a safe key, however the name is written', [choreKeyOf('Sandra G'), choreKeyOf(' G Florida '), choreKeyOf('Rafa'), choreKeyOf('')], ['sandra_g', 'g_florida', 'rafa', '']);
eq('the field on the order', fieldOf('Sandra G'), 'chores.sandra_g');

const wos = [
    { id: 'A', nsWoTran: 'WO1', chores: { rafa: { kind: 'paintPrep', by: 'Rafa', startedAt: NOW - 10 * MIN } } },
    { id: 'B', nsWoTran: 'WO2', chores: { sandra_g: { kind: 'setupPrep', by: 'Sandra G', startedAt: NOW - 30 * MIN }, ghost: { kind: 'paintPrep', by: '' } } },
    { id: 'C', nsWoTran: 'WO3' },
];
eq('every chore open on the floor, oldest first (a slot with no one is no chore)', openChoresOf(wos).map(c => `${c.by}:${c.kind}:${c.wo.id}`), ['Sandra G:setupPrep:B', 'Rafa:paintPrep:A']);
eq('a person\'s open chore, wherever it is, case-blind', [openChoreFor(wos, 'sandra g').wo.id, openChoreFor(wos, 'RAFA').key, openChoreFor(wos, 'Anne'), openChoreFor(wos, '')], ['B', 'rafa', null, null]);

eq('a chore starts when nothing hands-on is open', choreStartRefusal({ actor: 'Rafa', kind: 'paintPrep', openStep: null }), null);
eq('…not while a step is running (a bake is never passed in — the oven does not count)', choreStartRefusal({ actor: 'Rafa', kind: 'paintPrep', openStep: { key: 'spinSpray' } }).why, 'STEP_OPEN');
ok('…said in English and in Spanish', /finish it first/.test(choreStartRefusal({ actor: 'Rafa', kind: 'paintPrep', openStep: {} }).text) && /termínelo primero/.test(choreStartRefusal({ actor: 'Rafa', kind: 'paintPrep', openStep: {} }).text));
eq('no PIN, or a chore that does not exist', [choreStartRefusal({ actor: '', kind: 'paintPrep' }).why, choreStartRefusal({ actor: 'Rafa', kind: 'sweep' }).why], ['NO_PIN', 'UNKNOWN']);

eq('the open chore as written on the order', choreRecordOf({ actor: ' Rafa ', kind: 'paintPrep', nowMs: NOW }), { kind: 'paintPrep', by: 'Rafa', startedAt: NOW });
const start = choreLogOf({ action: CHORE_ACTION.START, actor: 'Rafa', kind: 'paintPrep', wo: wos[0], nowMs: NOW });
eq('the start in the floor log', [start.action, start.u, start.woId, start.woRefNo, start.chore, start.task, start.at, start.msg], ['CHORE_START', 'Rafa', 'A', 'WO1', 'paintPrep', 'chore', NOW, '🧰 CHORE START · Paint prep · WO1 — Rafa']);
ok('a start carries no elapsed time', !('elapsedMs' in start));
const end = choreLogOf({ action: CHORE_ACTION.END, actor: 'Rafa', kind: 'paintPrep', wo: wos[0], nowMs: NOW, startedAt: NOW - 12 * MIN, why: CHORE_END_WHY.STEP });
eq('the end: how long, and why it ended', [end.action, end.elapsedMs, end.startedAtMs, end.endedWhy, end.msg], ['CHORE_END', 12 * MIN, NOW - 12 * MIN, 'step started', '🧰 CHORE END · Paint prep · WO1 — Rafa · 12.0m (step started)']);

const logs = [
    start, end,
    { ...end }, // logged twice
    choreLogOf({ action: CHORE_ACTION.END, actor: 'Anne', kind: 'setupPrep', wo: wos[1], nowMs: NOW + 5 * MIN, startedAt: NOW, why: CHORE_END_WHY.ENDED }),
    { action: 'CHORE_END', u: 'Anne', at: NOW, startedAtMs: null },
    { action: 'COMPLETE', u: 'Anne', at: NOW, startedAtMs: NOW - MIN },
];
eq('Floor Metrics: finished chores, once each, oldest first — no start, or not a chore, is left out', choreIntervalsOf(logs).map(c => `${c.who}:${c.kind}:${(c.endMs - c.startMs) / MIN}`), ['Rafa:paintPrep:12', 'Anne:setupPrep:5']);

console.log(`floorChores: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
