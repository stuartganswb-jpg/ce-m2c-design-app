// portal/src/configAnswers + configBasket — the Configure screen's answers and the request being built (step 4, 2026-10-14).
//   node scripts/portalConfigure.test.mjs
// The screen's own clicks are proved on real data outside the repo (every recorded H1 walk replayed by clicks against the
// real Cloud Functions); this holds the pieces a change could quietly break: the answers sent, the answers restored, CPQ's
// second-click rule, the length as typed, and the request kept in the browser per login.
import { FRACTIONS, blankAnswers, wireOf, answersOf, toggled } from '../portal/src/configAnswers.js';
import { readBasket, writeBasket, shownOf, lineId } from '../portal/src/configBasket.js';
import { lengthInchesOf } from '../src/components/Shared/hardwareSession.js';
let pass = 0, fail = 0;
const eq = (n, got, want) => { const g = JSON.stringify(got), w = JSON.stringify(want); if (g === w) { pass++; return; } fail++; console.log(`✗ ${n}\n    got  ${g}\n    want ${w}`); };
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), clear: () => store.clear() };

eq('CPQ\'s click: a second click on the same choice takes it off; another choice replaces it', [toggled({}, 'a', 1), toggled({ a: 1 }, 'a', 1), toggled({ a: 1 }, 'a', 2), toggled({ a: 1, b: 2 }, 'b', 2)], [{ a: 1 }, {}, { a: 2 }, { a: 1 }]);
const a = { ...blankAnswers(), answers: { setup: 'SINGLE' }, picks: { 'ROD||': 'PIN-1' }, poleIn: '96', poleFrac: '1/2', stepQty: { RING: '12' }, globalFinishes: { METAL: 'P07' }, partFinish: { 'PIN-2': 'P01' }, memo: 'Den', qty: '2', acks: ['K1', 'K2'] };
const w = wireOf(a);
eq('what is sent: the answers, the length as typed, the number of sets as a number, the Understoods as acknowledged removals', [w.poleIn, w.poleFrac, w.qty, w.drops, 'acks' in w], ['96', '1/2', 2, [{ key: 'K1', acked: true }, { key: 'K2', acked: true }], false]);
eq('a line opened again comes back as it was sent', answersOf(w), { ...a });
eq('a number of sets that is not a number is one set', [wireOf({ ...a, qty: '' }).qty, wireOf({ ...a, qty: '0' }).qty, wireOf({ ...a, qty: 'x' }).qty], [1, 1, 1]);
eq('nothing to open: a fresh configuration', answersOf(null), blankAnswers());
// what the span is worked from (2026-10-19): the curtain length as typed and the stud answer travel, and come back
const spanned = { ...a, fabricId: 'BLACKOUT', dropFt: '12.5', onStud: false };
eq('the curtain length and the stud answer are sent, and a line opened again comes back with them', [wireOf(spanned).dropFt, wireOf(spanned).onStud, answersOf(wireOf(spanned))], ['12.5', false, { ...spanned }]);
eq('…a fresh configuration: no curtain length typed (8 ft is assumed), drywall with toggles (Stuart 2026-10-19: "make the default for all screens drywall"), nothing confirmed', [blankAnswers().dropFt, blankAnswers().onStud, wireOf(blankAnswers()).onStud, blankAnswers().riskConfirmed, wireOf(blankAnswers()).riskConfirmed], ['', false, false, '', '']);
eq('…a line saved in this browser in a stud opens in a stud; what the customer confirmed in the risk window travels with the line', [answersOf(wireOf({ ...blankAnswers(), onStud: true })).onStud, wireOf({ ...blankAnswers(), riskConfirmed: '2|5|DRYWALL|144' }).riskConfirmed], [true, '2|5|DRYWALL|144']);
eq('every fraction the screen offers is a length the engine reads (sixteenths)', FRACTIONS.filter(Boolean).every((f) => { const [n, d] = f.split('/').map(Number); return lengthInchesOf('10', f) === 10 + n / d && 16 % d === 0; }), true);
// the request in this browser, per login
eq('nothing kept yet: an empty request', readBasket('u1'), { lines: [], sidemark: '', note: '' });
writeBasket('u1', { lines: [{ id: lineId(), flowId: 'F1', state: w, shown: {} }, { id: 'x' }], sidemark: 'Smith', note: 'n' });
eq('a request is kept per login, and a line with no product or answers is dropped on reading', [readBasket('u1').lines.length, readBasket('u1').sidemark, readBasket('u2').lines.length], [1, 'Smith', 0]);
store.set('portal_config_request_v1:u3', '{not json');
eq('a damaged store reads as an empty request', readBasket('u3'), { lines: [], sidemark: '', note: '' });
eq('what a line was shown: the money at the level shown, or nothing', [shownOf({ price: { total: 10, totalForAll: 20, level: 'FAB_RETAIL', hasReview: true, lines: [1, 2] } }), shownOf(null)],
    [{ total: 10, totalForAll: 20, level: 'FAB_RETAIL', onReview: true, parts: 2 }, { total: null, totalForAll: null, level: '', onReview: false, parts: 0 }]);
console.log(fail ? `❌  ${pass} passed, ${fail} failed` : `✅  ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
