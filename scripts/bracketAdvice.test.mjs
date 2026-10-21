// The bracket recommendation, from 6.5's engineering — what the span depends on, which rod governs, which rod would need
// fewer supports, and a count short of the recommendation (Stuart 2026-10-19: "go ahead and yes use the 6.5 not in stud column").
//   node scripts/bracketAdvice.test.mjs
//
// SESSION_MODULE=<path> / SPAN_MODULE=<path> run the same assertions against a mutated copy (mutation check).

const SP = await import(process.env.SPAN_MODULE || new URL('../src/components/Shared/bracketSpan.js', import.meta.url).href);
const S = await import(process.env.SESSION_MODULE || new URL('../src/components/Shared/hardwareSession.js', import.meta.url).href);
const { spanTable, bracketAdviceFor, DEFAULT_DROP_FT } = SP;
const { spanAnswersOf, spanAnswersSavedOf, bracketAdviceOf, recommendedFor, quantitiesOf, rodOptionsAdviceOf, supportShortfallOf, DROP_FT_RANGE,
    centreCountForSplices, spliceInfoOf, spliceCentreMissingOf, spanRiskKeyOf } = S;

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
    eq('the advice says both reasons', [a.brackets, a.bracketsNoStud, a.why, a.whyNoStud], [3, 5, 'our maximum span', 'the limit for drywall toggles']);
}

// ── THE WOOD ROW (Stuart 2026-10-20: "wood make it 46" for both" · the 2" × 3/4" wood fascia "yes same") ──────────────────────────────
{
    const wood = (fab, drop) => spanTable(fab, drop, 'H1').find(r => r.id === 'H1-WOOD');
    eq('one wood row in H1, the 1-3/8" round and the 2" × 3/4" fascia both', [wood('PRINT', 8).material, /1-3\/8" round/.test(wood('PRINT', 8).label) && /2" × 3\/4"/.test(wood('PRINT', 8).label)], ['Wood', true]);
    eq('46" in a stud and on drywall alike, for every fabric at the standard 8 ft — our maximum binds both',
        ['SHEER', 'PRINT', 'LINED', 'BLACKOUT'].map(f => [wood(f, 8).spanInches, wood(f, 8).limitedBy, wood(f, 8).noStudInches, wood(f, 8).noStudLimitedBy]),
        [[46, 'MAX', 46, 'MAX'], [46, 'MAX', 46, 'MAX'], [46, 'MAX', 46, 'MAX'], [46, 'MAX', 46, 'MAX']]);
    eq('only a long, heavy curtain brings the beam under the cap — and the row says so', [wood('BLACKOUT', 12).spanInches, wood('BLACKOUT', 12).limitedBy, wood('BLACKOUT', 12).noStudInches], [41, 'LOAD', 41]);
    const w = bracketAdviceFor({ itemCode: 'H1-138WR/W01', map: { 'H1-WOOD': 'H1-138WR' }, rodInches: 120, fabricId: 'PRINT', dropFt: 8 });
    const asAcrylic = bracketAdviceFor({ itemCode: 'H1-138WR/W01', map: { 'H1-ACR-1.375': 'H1-138WR' }, rodInches: 120, fabricId: 'PRINT', dropFt: 8 });
    eq('a 10 ft wood pole joined to it: 4 supports either way (joined under acrylic it was held to 5)', [w.brackets, w.bracketsNoStud, asAcrylic.brackets, asAcrylic.bracketsNoStud], [4, 4, 5, 5]);
}

// ── THE THREE ANSWERS ────────────────────────────────────────────────────────────────────────────────────
eq('defaults: medium fabric, 8 ft, into studs — what was always assumed', spanAnswersOf({}), { fabricId: 'PRINT', dropFt: DEFAULT_DROP_FT, onStud: true });
eq('an answer is read as given; a fabric is case-blind; a length is a number', spanAnswersOf({ fabricId: 'blackout', dropFt: '10.5', onStud: false }), { fabricId: 'BLACKOUT', dropFt: 10.5, onStud: false });
eq('nonsense falls back to the defaults, never to a guess', [spanAnswersOf({ fabricId: 'VELVET', dropFt: 'tall', onStud: 'no' }), spanAnswersOf({ dropFt: DROP_FT_RANGE[1] + 1 }).dropFt, spanAnswersOf({ dropFt: 0 }).dropFt, spanAnswersOf({ dropFt: -4 }).dropFt],
    [{ fabricId: 'PRINT', dropFt: 8, onStud: true }, 8, 8, 8]);
eq('…and the ends of the range are answers', [spanAnswersOf({ dropFt: DROP_FT_RANGE[0] }).dropFt, spanAnswersOf({ dropFt: DROP_FT_RANGE[1] }).dropFt], DROP_FT_RANGE);
eq('a saved line keeps the fabric and the curtain length where they differ from the default — and the wall fixing always (absent = a line from before 2026-10-19, worked in a stud)',
    [spanAnswersSavedOf({}), spanAnswersSavedOf({ fabricId: 'PRINT', dropFt: 8, onStud: false }), spanAnswersSavedOf({ fabricId: 'SHEER', dropFt: 12, onStud: false }), spanAnswersSavedOf({ dropFt: 9, onStud: true })],
    [{ onStud: true }, { onStud: false }, { fabricId: 'SHEER', dropFt: 12, onStud: false }, { dropFt: 9, onStud: true }]);

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
    eq('…not into studs: the not-in-a-stud column — every 42", 5 supports, 3 in the centre', [n.supports, n.everyInches, n.whyApplies, n.otherSupports, centreFor(n, { 'ROD|FRONT|': 'c-steel' })], [5, 42, 'the limit for drywall toggles', 3, 3]);
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

// ── A BRACKET AT EVERY SPLICE (Stuart 2026-10-19: "if a splice is selected center brackets must be odd amount either 1,3,5" ·
//    "automatically, i can not think if a situation where with a splice we would want 2 or 4 brackets") ──
{
    const one = { count: 1, drawn: false }, two = { count: 2, drawn: false }, drawnTwo = { count: 2, drawn: true };
    eq('no splice: the count stands', [0, 1, 2, 3, 4].map(n => centreCountForSplices(n, { count: 0 })), [0, 1, 2, 3, 4]);
    eq('one splice: rounded UP to odd, at least one — 1, 3, 5', [0, 1, 2, 3, 4, 5, 6].map(n => centreCountForSplices(n, one)), [1, 1, 3, 3, 5, 5, 7]);
    eq('two splices (at the thirds): a bracket on each — 2, 5, 8', [0, 1, 2, 3, 4, 5, 6].map(n => centreCountForSplices(n, two)), [2, 2, 2, 5, 5, 5, 8]);
    eq('splices drawn where they go (Vision): no pattern, at least one per splice', [0, 1, 3, 4].map(n => centreCountForSplices(n, drawnTwo)), [2, 2, 3, 4]);
    const same = (a, b) => String(a).toUpperCase() === String(b).toUpperCase();
    const info = (extras, more = {}) => spliceInfoOf({ extras, spliceCodes: ['H1-138JNR'], sameItemCode: same, lengthInches: 150, spliceOverIn: 120, ...more });
    eq('spliced or not: a joiner on the line (any spelling the item answers to, or the traverse\'s tick); none, or typed to nothing — not spliced',
        [info([{ code: 'h1-138jnr', qty: '1' }, { code: 'RING', qty: '20' }]), info([], { trvJoiners: 1 }), info([{ code: 'H1-138JNR', qty: '0' }]), info([{ code: 'RING', qty: '2' }])],
        [{ count: 1, drawn: false }, { count: 1, drawn: false }, { count: 0, drawn: false }, { count: 0, drawn: false }]);
    eq('HOW MANY splices is the pole, not the joiner count: a double rod\'s two joiners on 150" are one splice; 263" over a 120" limit is three pieces, two splices; a joiner under the limit is one, at the centre',
        [info([{ code: 'H1-138JNR', qty: '2' }]), info([{ code: 'H1-138JNR', qty: '2' }], { lengthInches: 263 }), info([{ code: 'H1-138JNR', qty: '1' }], { lengthInches: 96.25 }), info([{ code: 'H1-138JNR', qty: '1' }], { lengthInches: 240 })],
        [{ count: 1, drawn: false }, { count: 2, drawn: false }, { count: 1, drawn: false }, { count: 1, drawn: false }]);
    eq('splices Vision drew are counted where drawn (no pattern); a drawn mark with no place is not one',
        [info([{ code: 'H1-138JNR', qty: '1' }], { drawnSplices: [{ distInches: 60, ref: 'START' }, { distInches: 30, ref: 'END' }] }), info([{ code: 'H1-138JNR', qty: '1' }], { drawnSplices: [{ distInches: null }] })],
        [{ count: 2, drawn: true }, { count: 1, drawn: false }]);
    // through the recommendation and the counts (the small double-rod configuration above)
    const live = (picks) => ({ ...ends, ...picks });
    const rec = (picks, more = {}, splice = one) => { const advice = adv(picks, more); return recommendedFor({ slot: SLOTS[3], choice: CENTRE, advice, model, livePicks: live(picks), lengthFeet: 12, splice }); };
    eq('the recommendation at the splice: steel in a stud wants 1 — odd already; on drywall toggles 3; at 120.5" on drywall 2 → 3; with no span to go on, the splice still wants 1',
        [rec({ 'ROD|FRONT|': 'c-steel' }, { onStud: true }), rec({ 'ROD|FRONT|': 'c-steel' }, { onStud: false }), rec({ 'ROD|FRONT|': 'c-steel' }, { onStud: false, lengthInches: 120.5 }), rec({ 'ROD|FRONT|': 'c-wood' })],
        [1, 3, 3, 1]);
    const counts = (typed, splice = one) => { const picks = live({ 'ROD|FRONT|': 'c-steel' }); const advice = bracketAdviceOf({ model, livePicks: picks, lengthInches: 144, spanMap: MAP, spanCaps: {}, ourId, onStud: false });
        const recommendFor = (sl, ch) => recommendedFor({ slot: sl, choice: ch, advice, model, livePicks: picks, lengthFeet: 12, splice });
        return quantitiesOf({ model, livePicks: picks, stepQty: typed === null ? {} : { 'BRACKET||CENTER': String(typed) }, lengthFeet: 12, recommendFor, trvRules: null, ourId, splice })['c-centre']; };
    eq('a typed centre count on a spliced pole is rounded up — 2 → 3, 4 → 5, 1 stays; with no splice 2 stays 2; left empty, the recommendation', [counts(2), counts(4), counts(1), counts(2, { count: 0 }), counts(null)], [3, 5, 1, 2, 3]);
    const sh = (typed) => { const picks = live({ 'ROD|FRONT|': 'c-acr' }); const advice = bracketAdviceOf({ model, livePicks: picks, lengthInches: 144, spanMap: MAP, spanCaps: {}, ourId, onStud: false });
        const recommendFor = (sl, ch) => recommendedFor({ slot: sl, choice: ch, advice, model, livePicks: picks, lengthFeet: 12, splice: one });
        const quantities = quantitiesOf({ model, livePicks: picks, stepQty: { 'BRACKET||CENTER': String(typed) }, lengthFeet: 12, recommendFor, trvRules: null, ourId, splice: one });
        return supportShortfallOf({ model, livePicks: picks, quantities, recommendFor }); };
    eq('a short count is judged after the rounding: a spliced acrylic pole wanting 3 in the centre — 2 typed becomes 3 (not short), 1 typed is short of 3', [sh(2), sh(1)], [[], [{ slotKey: 'BRACKET||CENTER', chosen: 1, recommended: 3, picked: true }]]);
    eq('a spliced pole whose centre step offers a bracket must have one chosen; picked, suppressed, or no splice — nothing to refuse',
        [spliceCentreMissingOf({ model, livePicks: { 'ROD|FRONT|': 'c-steel' }, splice: one }), spliceCentreMissingOf({ model, livePicks: live({ 'ROD|FRONT|': 'c-steel' }), splice: one }),
         spliceCentreMissingOf({ model: { ...model, slots: SLOTS.map(x => (x.key === 'BRACKET||CENTER' ? { ...x, suppressedBy: 'KIT' } : x)) }, livePicks: {}, splice: one }), spliceCentreMissingOf({ model, livePicks: {}, splice: { count: 0 } })],
        [true, false, false, false]);
}

// ── THE ONE SHORT COUNT A CONFIRM ANSWERS (the risk window) ──
eq('the key: the count, the recommendation, the wall fixing and the length — a change of any asks again',
    [spanRiskKeyOf({ chosen: 2, recommended: 5, onStud: false, lengthInches: 144 }), spanRiskKeyOf({ chosen: 2, recommended: 5, onStud: true, lengthInches: 144 }), spanRiskKeyOf({ chosen: '3', recommended: 5, onStud: false, lengthInches: 144 }), spanRiskKeyOf({})],
    ['2|5|DRYWALL|144', '2|5|STUD|144', '3|5|DRYWALL|144', '0|0|DRYWALL|0']);

console.log(fail ? `❌  ${pass} passed, ${fail} failed` : `✅  ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
