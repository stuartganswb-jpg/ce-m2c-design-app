// The bracket recommendation, from 6.5's engineering — what the span depends on, which rod governs, which rod would need
// fewer supports, and a count short of the recommendation (Stuart 2026-10-19: "go ahead and yes use the 6.5 not in stud column").
//   node scripts/bracketAdvice.test.mjs
//
// SESSION_MODULE=<path> / SPAN_MODULE=<path> run the same assertions against a mutated copy (mutation check).

const SP = await import(process.env.SPAN_MODULE || new URL('../src/components/Shared/bracketSpan.js', import.meta.url).href);
const S = await import(process.env.SESSION_MODULE || new URL('../src/components/Shared/hardwareSession.js', import.meta.url).href);
const { spanTable, bracketAdviceFor, DEFAULT_DROP_FT } = SP;
const { spanAnswersOf, spanAnswersSavedOf, bracketAdviceOf, recommendedFor, quantitiesOf, rodOptionsAdviceOf, supportShortfallOf, DROP_FT_RANGE } = S;

let pass = 0, fail = 0;
const eq = (n, got, want) => {
    const g = JSON.stringify(got), w = JSON.stringify(want);
    if (g === w) { pass++; return; }
    fail++; console.log(`✗ ${n}\n    got  ${String(g).slice(0, 400)}\n    want ${String(w).slice(0, 400)}`);
};

// ── 6.5: WHAT BINDS THE NOT-IN-A-STUD SPAN ───────────────────────────────────────────────────────────────
{
    const row = (fab, drop, id, caps) => spanTable(fab, drop, 'H1', caps).find(r => r.id === id);
    eq('steel 1-3/8": our maximum in a stud, the drywall anchor off one', [row('PRINT', 8, 'H1-1.375').spanInches, row('PRINT', 8, 'H1-1.375').limitedBy, row('PRINT', 8, 'H1-1.375').noStudInches, row('PRINT', 8, 'H1-1.375').noStudLimitedBy], [72, 'MAX', 42, 'ANCHOR']);
    eq('acrylic: 36" either way — a stud buys nothing, so it is our maximum, not the anchor', [row('PRINT', 8, 'H1-ACR-1.375').noStudInches, row('PRINT', 8, 'H1-ACR-1.375').noStudLimitedBy], [36, 'MAX']);
    eq('a heavy, long curtain on acrylic: the fabric binds both spans', [row('BLACKOUT', 12, 'H1-ACR-1.375').spanInches, row('BLACKOUT', 12, 'H1-ACR-1.375').limitedBy, row('BLACKOUT', 12, 'H1-ACR-1.375').noStudInches, row('BLACKOUT', 12, 'H1-ACR-1.375').noStudLimitedBy], [29, 'LOAD', 29, 'LOAD']);
    eq('an edited not-in-a-stud cap above our maximum: our maximum binds', [row('PRINT', 8, 'H1-1.375', { 'H1-1.375': { noStud: 80 } }).noStudInches, row('PRINT', 8, 'H1-1.375', { 'H1-1.375': { noStud: 80 } }).noStudLimitedBy], [72, 'MAX']);
    const a = bracketAdviceFor({ itemCode: 'H1-138R/P', map: { 'H1-1.375': 'H1-138R' }, rodInches: 144, fabricId: 'PRINT', dropFt: 8 });
    eq('the advice says both reasons', [a.brackets, a.bracketsNoStud, a.why, a.whyNoStud], [3, 5, 'our maximum span', 'the limit for a drywall anchor']);
}

// ── THE THREE ANSWERS ────────────────────────────────────────────────────────────────────────────────────
eq('defaults: medium fabric, 8 ft, into studs — what was always assumed', spanAnswersOf({}), { fabricId: 'PRINT', dropFt: DEFAULT_DROP_FT, onStud: true });
eq('an answer is read as given; a fabric is case-blind; a length is a number', spanAnswersOf({ fabricId: 'blackout', dropFt: '10.5', onStud: false }), { fabricId: 'BLACKOUT', dropFt: 10.5, onStud: false });
eq('nonsense falls back to the defaults, never to a guess', [spanAnswersOf({ fabricId: 'VELVET', dropFt: 'tall', onStud: 'no' }), spanAnswersOf({ dropFt: DROP_FT_RANGE[1] + 1 }).dropFt, spanAnswersOf({ dropFt: 0 }).dropFt, spanAnswersOf({ dropFt: -4 }).dropFt],
    [{ fabricId: 'PRINT', dropFt: 8, onStud: true }, 8, 8, 8]);
eq('…and the ends of the range are answers', [spanAnswersOf({ dropFt: DROP_FT_RANGE[0] }).dropFt, spanAnswersOf({ dropFt: DROP_FT_RANGE[1] }).dropFt], DROP_FT_RANGE);
eq('a saved line keeps only what differs from the default', [spanAnswersSavedOf({}), spanAnswersSavedOf({ fabricId: 'PRINT', dropFt: 8, onStud: true }), spanAnswersSavedOf({ fabricId: 'SHEER', dropFt: 12, onStud: false }), spanAnswersSavedOf({ dropFt: 9 })],
    [{}, {}, { fabricId: 'SHEER', dropFt: 12, onStud: false }, { dropFt: 9 }]);

// ── A SMALL DOUBLE-ROD CONFIGURATION ─────────────────────────────────────────────────────────────────────
const choice = (id, role, partId, extra = {}) => ({ id, role, partId, name: partId, ...extra });
const STEEL = choice('c-steel', 'ROD', 'H1-138R'), ACR = choice('c-acr', 'ROD', 'H1-138AR'), WOOD = choice('c-wood', 'ROD', 'H1-138WR');
const STEEL_B = choice('c-steel-b', 'ROD', 'H1-138R'), ACR_B = choice('c-acr-b', 'ROD', 'H1-138AR');
const LEFT = choice('c-left', 'BRACKET', 'H1-138B', { position: 'LEFT' }), RIGHT = choice('c-right', 'BRACKET', 'H1-138B', { position: 'RIGHT' });
const CENTRE = choice('c-centre', 'BRACKET', 'H1-138CB', { position: 'CENTER' });
const SLOTS = [
    { key: 'ROD|FRONT|', kind: 'ROD', options: [STEEL, ACR, WOOD] },
    { key: 'ROD|BACK|', kind: 'ROD', options: [STEEL_B, ACR_B] },
    { key: 'BRACKET||LEFT', kind: 'BRACKET', position: 'LEFT', options: [LEFT] },
    { key: 'BRACKET||CENTER', kind: 'BRACKET', position: 'CENTER', options: [CENTRE] },
    { key: 'BRACKET||RIGHT', kind: 'BRACKET', position: 'RIGHT', options: [RIGHT] },
];
const model = { choices: [STEEL, ACR, WOOD, STEEL_B, ACR_B, LEFT, CENTRE, RIGHT], slots: SLOTS };
const MAP = { 'H1-1.375': 'H1-138R', 'H1-ACR-1.375': 'H1-138AR' };
const ourId = (id) => id;
const ends = { 'BRACKET||LEFT': 'c-left', 'BRACKET||RIGHT': 'c-right', 'BRACKET||CENTER': 'c-centre' };
const adv = (picks, more = {}) => bracketAdviceOf({ model, livePicks: { ...ends, ...picks }, lengthInches: 144, spanMap: MAP, spanCaps: {}, ourId, ...more });
const centreFor = (advice, picks) => recommendedFor({ slot: SLOTS[3], choice: CENTRE, advice, model, livePicks: { ...ends, ...picks }, lengthFeet: 12 });
{
    const a = adv({ 'ROD|FRONT|': 'c-steel' });
    eq('steel 1-3/8" at 144", into studs: a support every 72" — 3, the ends carry 2, so 1 in the centre',
        [a.supports, a.everyInches, a.whyApplies, a.otherSupports, a.fabricId, a.dropFt, a.onStud, centreFor(a, { 'ROD|FRONT|': 'c-steel' })], [3, 72, 'our maximum span', 5, 'PRINT', 8, true, 1]);
    const n = adv({ 'ROD|FRONT|': 'c-steel' }, { onStud: false });
    eq('…not into studs: the not-in-a-stud column — every 42", 5 supports, 3 in the centre', [n.supports, n.everyInches, n.whyApplies, n.otherSupports, centreFor(n, { 'ROD|FRONT|': 'c-steel' })], [5, 42, 'the limit for a drywall anchor', 3, 3]);
    const heavy = adv({ 'ROD|FRONT|': 'c-acr' }, { fabricId: 'BLACKOUT', dropFt: 12 });
    eq('the curtain length is used, not 8 ft: blackout at 12 ft on acrylic is every 29" — 6', [adv({ 'ROD|FRONT|': 'c-acr' }).supports, heavy.supports, heavy.everyInches, heavy.whyApplies, heavy.dropFt], [5, 6, 29, 'limited by fabric weight', 12]);
    eq('two different rods: the one that needs more supports governs, whichever step it is on',
        [adv({ 'ROD|FRONT|': 'c-acr', 'ROD|BACK|': 'c-steel-b' }).supports, adv({ 'ROD|FRONT|': 'c-steel', 'ROD|BACK|': 'c-acr-b' }).supports, adv({ 'ROD|FRONT|': 'c-steel', 'ROD|BACK|': 'c-acr-b' }).rod.id],
        [5, 5, 'H1-ACR-1.375']);
    eq('a rod 6.5 does not list does not hide the one it does — and is named beside the advice, never silently covered',
        [adv({ 'ROD|FRONT|': 'c-wood', 'ROD|BACK|': 'c-steel-b' }).supports, adv({ 'ROD|FRONT|': 'c-wood', 'ROD|BACK|': 'c-steel-b' }).unlisted, adv({ 'ROD|FRONT|': 'c-steel' }).unlisted], [3, ['H1-138WR'], []]);
    eq('nothing listed, no length, or no rod: no recommendation, honestly', [adv({ 'ROD|FRONT|': 'c-wood' }), bracketAdviceOf({ model, livePicks: { 'ROD|FRONT|': 'c-steel' }, lengthInches: null, spanMap: MAP, ourId }), adv({})], [null, null, null]);
}

// ── WHICH ROD WOULD NEED FEWER ───────────────────────────────────────────────────────────────────────────
{
    const opts = (picks, more = {}) => rodOptionsAdviceOf({ model, livePicks: { ...ends, ...picks }, lengthInches: 144, spanMap: MAP, spanCaps: {}, ourId, ...more });
    const one = opts({ 'ROD|FRONT|': 'c-acr' });
    eq('acrylic picked: steel would need 3, acrylic needs 5, wood is not listed — steel is the better rod here',
        [one.length, one[0].slotKey, one[0].options.map(o => [o.id, o.supports, o.picked]), one[0].better && one[0].better.id], [1, 'ROD|FRONT|', [['c-steel', 3, false], ['c-acr', 5, true], ['c-wood', null, false]], 'c-steel']);
    const two = opts({ 'ROD|FRONT|': 'c-steel', 'ROD|BACK|': 'c-acr-b' });
    eq('a double rod: changing the front cannot help while the back is acrylic; changing the back can',
        [two.map(r => [r.slotKey, r.options.map(o => o.supports), r.better && r.better.id]), two[0].options.map(o => o.ownSupports)],
        [[['ROD|FRONT|', [5, 5, null], null], ['ROD|BACK|', [3, 5], 'c-steel-b']], [3, 5, null]]);
    eq('the same supports either way is no recommendation; no length, no comparison', [opts({ 'ROD|FRONT|': 'c-acr' }, { onStud: false })[0].better, opts({ 'ROD|FRONT|': 'c-acr' }, { lengthInches: null })], [null, []]);
    eq('a step where only one rod is listed has nothing to compare', rodOptionsAdviceOf({ model, livePicks: { 'ROD|FRONT|': 'c-acr' }, lengthInches: 144, spanMap: { 'H1-ACR-1.375': 'H1-138AR' }, spanCaps: {}, ourId }), []);
}

// ── A COUNT SHORT OF THE RECOMMENDATION ──────────────────────────────────────────────────────────────────
{
    const short = (picks, stepQty = {}, slots = SLOTS, length = 144) => {
        const m = { ...model, slots };
        const livePicks = { ...picks };
        const advice = bracketAdviceOf({ model: m, livePicks, lengthInches: length, spanMap: MAP, spanCaps: {}, ourId });
        const recommendFor = (slot, ch) => recommendedFor({ slot, choice: ch, advice, model: m, livePicks, lengthFeet: Math.ceil(length / 12) });
        const quantities = quantitiesOf({ model: m, livePicks, stepQty, lengthFeet: Math.ceil(length / 12), recommendFor, trvRules: null, ourId });
        return supportShortfallOf({ model: m, livePicks, quantities, recommendFor });
    };
    const acr = { ...ends, 'ROD|FRONT|': 'c-acr' };
    eq('the recommended count (left empty): nothing to say', short(acr), []);
    eq('fewer typed than recommended: said, with both numbers', short(acr, { 'BRACKET||CENTER': '1' }), [{ slotKey: 'BRACKET||CENTER', chosen: 1, recommended: 3, picked: true }]);
    eq('no centre bracket chosen where the span wants 3: said too', short({ 'BRACKET||LEFT': 'c-left', 'BRACKET||RIGHT': 'c-right', 'ROD|FRONT|': 'c-acr' }), [{ slotKey: 'BRACKET||CENTER', chosen: 0, recommended: 3, picked: false }]);
    eq('more than recommended is the operator\'s call: nothing to say', short(acr, { 'BRACKET||CENTER': '4' }), []);
    eq('a centre the configuration does not ask for (suppressed), a pole the ends carry alone, or no span to go on: nothing to say',
        [short(acr, { 'BRACKET||CENTER': '1' }, SLOTS.map(s => (s.key === 'BRACKET||CENTER' ? { ...s, suppressedBy: 'KIT' } : s))), short({ ...ends, 'ROD|FRONT|': 'c-steel' }, {}, SLOTS, 60), short({ ...ends, 'ROD|FRONT|': 'c-wood' }, { 'BRACKET||CENTER': '1' })],
        [[], [], []]);
}

console.log(fail ? `❌  ${pass} passed, ${fail} failed` : `✅  ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
