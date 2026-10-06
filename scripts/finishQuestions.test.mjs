// Harness for Shared/finishQuestions.js — what a finish asks of the order (the brass surface and coating,
// Stuart 2026-10-06), and how the answers ride the cart line every document and floor reads.
//   node scripts/finishQuestions.test.mjs
import { readFileSync } from 'fs';
import { questionsOf, parseQuestions, questionsText, unansweredOf, answersOf, answersText, finishTextWith } from '../src/components/Shared/finishQuestions.js';

const src = (f) => readFileSync(new URL(`../src/components/Shared/${f}`, import.meta.url), 'utf8');
const mod = async (f) => import(`data:text/javascript;base64,${Buffer.from(
    src(f).replace(/from '\.\/([\w.]+)\.js'/g, (m, n) => `from '${new URL(`../src/components/Shared/${n}.js`, import.meta.url)}'`)
).toString('base64')}`);
const { handoffItem } = await mod('hardwareHandoff.js');

let pass = 0, fail = 0;
const eq = (n, got, want) => {
    const g = JSON.stringify(got), w = JSON.stringify(want);
    if (g === w) { pass++; return; }
    fail++; console.log(`✗ ${n}\n    got  ${g}\n    want ${w}`);
};
const ok = (n, c) => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}`); };

const Q = [{ label: 'Surface', choices: ['Brushed', 'Polished'] }, { label: 'Coating', choices: ['Unlacquered', 'Lacquered'] }];
const LBR = { id: 'FIN-UBP', code: 'LBR', name: 'LIVE SOLID BRASS', material: 'BRASS', multiplier: 1, questions: Q,
    clientMapping: [{ customerId: 'FABRICUT', clientFinishName: 'Solid Brass' }] };
const EP2 = { id: 'F-EP2', code: 'EP2', name: 'POLISHED NICKEL', material: 'METAL', multiplier: 1 };

// ── THE EDITOR ───────────────────────────────────────────────────────────────────────────────────
{
    eq('typed text → questions', parseQuestions('Surface: Brushed, Polished\nCoating: Unlacquered , Lacquered\n'), Q);
    eq('questions → the editor text, and back', parseQuestions(questionsText(Q)), Q);
    eq('other separators are taken too', parseQuestions('Surface: Brushed / Polished'), [Q[0]]);
    eq('a line that is not a question is dropped', parseQuestions('just a note\n: no label\nOne choice: Only\nSurface: Brushed, Polished'), [Q[0]]);
    eq('a repeated label or choice counts once', parseQuestions('Surface: Brushed, brushed, Polished\nsurface: A, B'), [Q[0]]);
    eq('nothing typed, nothing asked', [parseQuestions(''), parseQuestions(null), questionsOf(EP2), questionsOf(null)], [[], [], [], []]);
    eq('a stored record is cleaned the same way', questionsOf({ questions: [{ label: ' Surface ', choices: ['Brushed', '', 'Polished'] }, { label: '', choices: ['a', 'b'] }, null] }), [Q[0]]);
}
// ── THE ANSWERS ──────────────────────────────────────────────────────────────────────────────────
{
    eq('every question is required', unansweredOf(LBR, {}), ['Surface', 'Coating']);
    eq('one answered, one open', unansweredOf(LBR, { Surface: 'Polished' }), ['Coating']);
    eq('all answered', unansweredOf(LBR, { Surface: 'Polished', Coating: 'Lacquered' }), []);
    eq('an answer the finish does not offer is not an answer', unansweredOf(LBR, { Surface: 'Hammered', Coating: 'Lacquered' }), ['Surface']);
    eq('a finish that asks nothing has nothing open', unansweredOf(EP2, {}), []);
    eq('answers come back in the finish\'s order and spelling', answersOf(LBR, { coating: 'lacquered', SURFACE: 'polished', Extra: 'x' }), { Surface: 'Polished', Coating: 'Lacquered' });
    eq('in words', [answersText(LBR, { Coating: 'Unlacquered', Surface: 'Brushed' }), answersText(LBR, { Surface: 'Polished' }), answersText(LBR, null), answersText(EP2, { Surface: 'Polished' })],
        ['Brushed · Unlacquered', 'Polished', '', '']);
    eq('the finish text with and without answers', [finishTextWith('LIVE SOLID BRASS  ', 'Polished · Lacquered'), finishTextWith('BLACK', '')], ['LIVE SOLID BRASS · Polished · Lacquered', 'BLACK']);
}
// ── THE LINE EVERY CONSUMER READS ────────────────────────────────────────────────────────────────
{
    const parts = {
        'CE-INV-62563': { id: 'CE-INV-62563', legacyErpId: 'H1-1BBS', itemName: '1" Brushed Brass Basic Bracket (3-5/8" P)', manufacturingSpecs: { partHandling: 'Small Parts', fabricut: { fabCodePainted: 'H3654F', cost: 35, wholesale: 64, retail: 128 } } },
        'CE-INV-70001': { id: 'CE-INV-70001', legacyErpId: 'H1-1DS', itemName: 'Decorative Bracket (3-5/8" P)', manufacturingSpecs: { basePrice: 30, partHandling: 'Small Parts' } },
    };
    const findPart = (k) => parts[String(k || '').toUpperCase()] || Object.values(parts).find(p => p.legacyErpId === String(k || '').toUpperCase()) || null;
    const model = { choices: [], bom: [
        { id: 'c1', partId: 'CE-INV-62563', name: 'H21BBS', qty: 2, role: 'BRACKET', position: 'LEFT' },
        { id: 'c2', partId: 'CE-INV-70001', name: 'H21DS', qty: 1, role: 'BRACKET', position: 'RIGHT' },
    ] };
    const ctx = (over = {}) => ({ findPart, findByCode: findPart, customerId: 'FABRICUT', customer: { id: 'FABRICUT', name: 'Fabricut' }, priceLevel: 'FAB_COST',
        outsourceCodes: ['LBR', 'EP2'], finishCode: 'EP2', finishFor: (c) => (c.id === 'c1' ? 'LBR' : 'EP2'), finishObjOf: (c) => ({ LBR, EP2 })[c] || null,
        assembly: { id: 'A1', itemName: 'H1-1' }, flow: { id: 'F1' }, finishes: [LBR, EP2], globalFinishes: { METAL: 'EP2', BRASS: 'LBR' }, ...over });

    const item = handoffItem(model, ctx({ finishAnswers: { LBR: { Surface: 'Polished', Coating: 'Lacquered' } } }));
    const b = item.pricingBreakdown.find(l => l.legacyErpId === 'H1-1BBS'), d = item.pricingBreakdown.find(l => l.legacyErpId === 'H1-1DS');
    eq('the brass line says how the brass is finished — in its finish, in words and by answer',
        [b.finishCode, b.finishLabel, b.finishDetail, b.finishOptions], ['LBR', 'LIVE SOLID BRASS · Polished · Lacquered', 'Polished · Lacquered', { Surface: 'Polished', Coating: 'Lacquered' }]);
    eq('…and in the customer\'s own word for the finish', b.clientFinishName, 'Solid Brass · Polished · Lacquered');
    eq('a line in a finish that asks nothing is exactly as before', [d.finishCode, d.finishLabel, d.finishDetail, d.finishOptions], ['EP2', 'POLISHED NICKEL', undefined, undefined]);
    eq('the answers are kept for Edit', item.engineConfig.finishAnswers, { LBR: { Surface: 'Polished', Coating: 'Lacquered' } });

    const plain = handoffItem(model, ctx({}));
    const pb = plain.pricingBreakdown.find(l => l.legacyErpId === 'H1-1BBS');
    eq('no answers given: the finish text is the finish\'s name, nothing invented', [pb.finishLabel, pb.finishDetail, 'finishAnswers' in plain.engineConfig], ['LIVE SOLID BRASS', undefined, false]);
    const odd = handoffItem(model, ctx({ finishAnswers: { LBR: { Surface: 'Hammered', Coating: 'Lacquered' } } })).pricingBreakdown.find(l => l.legacyErpId === 'H1-1BBS');
    eq('an answer the finish does not offer is not printed', [odd.finishLabel, odd.finishOptions], ['LIVE SOLID BRASS · Lacquered', { Coating: 'Lacquered' }]);
    ok('money is untouched by the answers', item.pricing.finalPrice === plain.pricing.finalPrice && item.pricing.finalPrice > 0);
}

console.log(`${fail ? '✗' : '✓'} finishQuestions: ${pass} passed${fail ? `, ${fail} FAILED` : ''}`);
process.exit(fail ? 1 : 0);
