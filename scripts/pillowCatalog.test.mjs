// The Uniquity catalog read from its own codes, pinned (S7 quick sell step 1, 2026-10-12): one code
// grammar for pillows / throws / fabrics / samples; a colourway's group is the chart column its
// pillow prices sit in; the plan writes the group onto the fabric and the throws, links the fabric
// to its throw, proposes the fill inserts, and NAMES the colourways with no yardage item.
import {
    parseUniquityCode, colourwaysOf, groupFromPillowPrices, catalogTagPlanOf, catalogTagPatchesOf,
    sizesWithFillItems, insertForSize, missingYardageRowsOf, pillowCodeOf, fabricCodeOf, KINDS,
} from '../src/components/Shared/pillowCatalog.js';
import { DEFAULT_PILLOW_PRICING } from '../src/components/Shared/pillowPricing.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; } else { fail++; console.error('  ✗', name, extra); } };

// ── the grammar ──────────────────────────────────────────────────────────────────────────────
const P = (c) => parseUniquityCode(c);
ok('Bell/10P19x19 = pillow, Bell, colour 10, 19x19', (() => { const p = P('Bell/10P19x19'); return p.ok && p.kind === KINDS.PILLOW && p.pattern === 'BELL' && p.patternRaw === 'Bell' && p.colour === '10' && p.sizeKey === '19x19'; })());
ok('CASSIAN/10P19X19 reads the same size (upper X)', P('CASSIAN/10P19X19').sizeKey === '19x19');
ok('Bell/10T = the throw, standard', (() => { const p = P('Bell/10T'); return p.ok && p.kind === KINDS.THROW && p.variant === ''; })());
ok('Bell/10T-XL, CASSIAN/10TXL, Coburn/72T-XXL = the XL / XXL throws', P('Bell/10T-XL').variant === 'XL' && P('CASSIAN/10TXL').variant === 'XL' && P('Coburn/72T-XXL').variant === 'XXL');
ok('Bell/10F = the fabric yardage', (() => { const p = P('Bell/10F'); return p.ok && p.kind === KINDS.FABRIC; })());
ok('SWA/Bell10 and SWAL/Bell10 = the samples', P('SWA/Bell10').kind === KINDS.SAMPLE && P('SWA/Bell10').pattern === 'BELL' && P('SWA/Bell10').colour === '10' && P('SWAL/Bell10').kind === KINDS.SAMPLE_L);
ok("Bridget's / Special / inserts / zippers / CUSTOM PILLOW are not colourway codes", !P('BP-FW24-1').ok && !P('Special Pillow #1 - 36"x20"').ok && !P('Insert-PC-19x19').ok && !P('Zipper/10in').ok && !P('Custom Pillow').ok && !P('').ok);
ok('a pillow code with a bad size is refused', !P('Bell/10P19').ok && !P('Bell/10Pxx').ok);
ok('a pattern with a space and an apostrophe parses', P("S'more Bay/12P23x23").pattern === "S'MORE BAY" && P("S'more Bay/12P23x23").ok);
ok('the codes compose back', pillowCodeOf({ patternRaw: 'Bell', colour: '10', sizeKey: '19x19' }) === 'Bell/10P19x19' && fabricCodeOf({ patternRaw: 'Bell', colour: '10' }) === 'Bell/10F');

// ── the chart (Stuart's, five groups × ten sizes) ────────────────────────────────────────────
const SIZES = ['20x12', '24x15', '19x19', '23x23', '36x20', '45x15', '20x20', '22x22', '24x24', '52x28'];
const CHART = { A: [300, 350, 375, 475, 575, 575, 650, 650, 650, 650], B: [350, 400, 450, 500, 650, 650, 775, 775, 775, 775], C: [375, 475, 500, 575, 725, 725, 875, 875, 875, 875], D: [500, 550, 575, 675, 875, 875, 1025, 1025, 1025, 1025], E: [575, 650, 675, 825, 1025, 1025, 1650, 1650, 1650, 1650] };
const config = { ...DEFAULT_PILLOW_PRICING, sizeOrder: SIZES, prices: Object.fromEntries(SIZES.map((s, i) => [s, Object.fromEntries(Object.keys(CHART).map(g => [g, CHART[g][i]]))])), fabricGroups: { A: { rank: 1 }, B: { rank: 2 }, C: { rank: 3 }, D: { rank: 4 }, E: { rank: 5 } }, sizes: {} };

// ── a library: Bell/10 (group C by price, fabric + throw), Bell/22 (no fabric), Nash/01 (B, split prices), Savery/05 (fabric tagged A already)
const item = (code, extra = {}) => ({ id: `ID-${code}`, legacyErpId: code, itemName: extra.name || code, manufacturingSpecs: { ...(extra.specs || {}) }, ...(extra.top || {}) });
const pillow = (pat, col, size, price, name) => item(`${pat}/${col}P${size}`, { name: name || `${pat} Pillow color ${col} Natural ${size.replace('x', '" x ')}"`, specs: { basePrice: price, partClass: 'Assembly' } });
const lib = [
    ...['20x12', '24x15', '19x19', '23x23', '36x20', '45x15'].map(s => pillow('Bell', '10', s, CHART.C[SIZES.indexOf(s)])),
    item('Bell/10T', { name: 'Bell color 10 Natural & Cream 71" x 51"', top: { finalImageUrl: 'https://x/bell10t.jpg' } }),
    item('Bell/10T-XL', { name: 'Bell color 10 Natural & Cream XL 106" x 55"' }),
    item('Bell/10F', { name: 'Bell fabric color 10', specs: { productType: 'FABRIC' } }),
    item('SWA/Bell10', { name: 'Bell- Natural #10 Small Sample' }),
    ...['19x19', '23x23'].map(s => pillow('Bell', '22', s, CHART.C[SIZES.indexOf(s)], `Bell Pillow color 22 Yellow ${s}`)),
    item('Bell/22T', { name: 'Bell color 22 Natural & Yellow 71" x 51"' }),
    // Nash/01: four at B, one typed wrong (19x19 at 475 = nothing), one at C's 23x23 — MOST = B
    pillow('Nash', '01', '20x12', 350), pillow('Nash', '01', '24x15', 400), pillow('Nash', '01', '36x20', 650), pillow('Nash', '01', '45x15', 650), pillow('Nash', '01', '19x19', 475), pillow('Nash', '01', '23x23', 575),
    item('Nash/01F', { specs: { productType: 'FABRIC', priceGroup: 'A', customData: { convertedFrom: 'Nash/01T' } } }),
    item('Nash/01T'),
    // Savery/05: fabric already A, pillows agree; no throw
    pillow('Savery', '05', '19x19', 375), pillow('Savery', '05', '23x23', 475),
    item('Savery/05F', { specs: { productType: 'FABRIC', priceGroup: 'A' } }),
    // Winters/90: a throw and no pillow, no fabric — missing yardage, no group
    item('Winters/90T'),
    // Tie: two sizes whose prices sit in BOTH A (36x20 575) and D (19x19 575)? A 36x20 = 575, D 19x19 = 575 → candidates {A:1, D:1}
    pillow('Tie', '01', '36x20', 575), pillow('Tie', '01', '19x19', 575),
    // not catalog
    item('Insert-PC-19x19'), item('Insert-PC- 18"x18"'), item('INSERT-PC-20x20-DWALL'), item('Insert-PC-OD-23X23'), item('Insert-PC-23X23'), item('Zipper/10in'), item('Custom Pillow'), item('BP-FW24-1'),
    item('Retired/01P19x19', { specs: { basePrice: 500, isRetired: true } }),
];

// ── colourways ───────────────────────────────────────────────────────────────────────────────
const cat = colourwaysOf(lib);
ok('six colourways in five patterns; the retired record and the non-catalog items are not among them', cat.list.length === 6 && cat.patterns.length === 5 && !cat.byKey.has('RETIRED/01'));
const bell10 = cat.byKey.get('BELL/10');
ok('Bell/10 carries six pillows by size, the throw + XL, the fabric, the sample', Object.keys(bell10.pillows).length === 6 && bell10.pillows['19x19'].legacyErpId === 'Bell/10P19x19' && bell10.throws.STD && bell10.throws.XL && bell10.fabric && bell10.samples.S);
ok('its label is the throw\'s name and its colour name reads from it', bell10.label.startsWith('Bell color 10') && bell10.colourName === 'Natural & Cream');
ok('its picture is the throw\'s (the fabric has none)', bell10.picture === 'https://x/bell10t.jpg' && bell10.pictureFrom === 'THROW');
ok('a colourway with no tagged fabric or throw knows no group yet; Nash/01 knows A from its fabric', bell10.group === '' && cat.byKey.get('NASH/01').group === 'A' && cat.byKey.get('NASH/01').groupFrom === 'FABRIC');
ok('sizes seen come from the pillow codes', cat.sizesSeen.includes('45x15') && cat.sizesSeen.length === 6);

// ── the group from the prices ────────────────────────────────────────────────────────────────
const gB = groupFromPillowPrices({ pillows: bell10.pillows, config });
ok('Bell/10: six prices, all in column C and only C → ONE', gB.group === 'C' && gB.reason === 'ONE' && gB.priced === 6 && gB.agree === 6 && gB.mismatches.length === 0);
const gN = groupFromPillowPrices({ pillows: cat.byKey.get('NASH/01').pillows, config });
ok('Nash/01: four of six fit B, one fits C, one fits nothing → MOST = B with two mismatches named', gN.group === 'B' && gN.reason === 'MOST' && gN.agree === 4 && gN.mismatches.length === 2 && gN.mismatches.find(m => m.sizeKey === '19x19').expected === 450 && gN.mismatches.find(m => m.sizeKey === '23x23').price === 575);
const gT = groupFromPillowPrices({ pillows: cat.byKey.get('TIE/01').pillows, config });
ok('a tie between two columns chooses nothing', gT.group === '' && gT.reason === 'TIE');
ok('no priced pillow → NO_PRICES; a price fitting no column → NO_FIT', groupFromPillowPrices({ pillows: {}, config }).reason === 'NO_PRICES' && groupFromPillowPrices({ pillows: { '19x19': pillow('X', '1', '19x19', 999) }, config }).reason === 'NO_FIT');
ok('a size the table does not price is ignored', groupFromPillowPrices({ pillows: { '18x18': pillow('X', '1', '18x18', 500), '19x19': pillow('X', '1', '19x19', 500) }, config }).priced === 1);

// ── the plan ─────────────────────────────────────────────────────────────────────────────────
const plan = catalogTagPlanOf({ items: lib, config });
const row = (p) => plan.rows.find(r => r.pattern === p);
ok('one row per pattern, in code order', plan.rows.map(r => r.pattern).join(',') === 'BELL,NASH,SAVERY,TIE,WINTERS');
ok('Bell: both colourways derive C → the pattern agrees', row('BELL').group === 'C' && row('BELL').agree === 'ALL');
ok('Bell/10 writes C onto the fabric, the throw and the XL throw, and links the fabric to its throw', (() => { const w = row('BELL').colourways[0].writes; return w.length === 4 && w.filter(x => x.path === 'manufacturingSpecs.priceGroup').map(x => x.code).join(',') === 'Bell/10F,Bell/10T,Bell/10T-XL' && w.find(x => x.path === 'manufacturingSpecs.customData.convertedFrom').to === 'Bell/10T'; })());
ok('Bell/22 (no fabric) writes C onto its throw only, and is NAMED as missing yardage with the throw and the proposed fabric code', (() => { const c = row('BELL').colourways[1]; const m = plan.missing.find(x => x.key === 'BELL/22'); return c.writes.length === 1 && c.writes[0].code === 'Bell/22T' && m && m.throwCode === 'Bell/22T' && m.fabricCode === 'Bell/22F' && m.group === 'C' && m.pillows === 2; })());
ok('Nash/01: the fabric moves A → B (the prices win, the mismatch shown), the throw gets B, the link is kept', (() => { const w = row('NASH').colourways[0].writes; return w.length === 2 && w.find(x => x.code === 'Nash/01F').from === 'A' && w.find(x => x.code === 'Nash/01F').to === 'B' && w.find(x => x.code === 'Nash/01T').to === 'B' && !w.find(x => x.path.endsWith('convertedFrom')); })());
ok('Savery/05: already A, nothing to write; no throw → no link', row('SAVERY').colourways[0].writes.length === 0 && row('SAVERY').group === 'A');
ok('Tie and Winters derive nothing (NONE); Winters/90 is missing yardage with no group', row('TIE').agree === 'NONE' && row('WINTERS').agree === 'NONE' && plan.missing.find(x => x.key === 'WINTERS/90').group === '');
ok('Tie/01 has pillows but no fabric and no throw → still missing its yardage item (bought by the yard), with no throw code', (() => { const m = plan.missing.find(x => x.key === 'TIE/01'); return m && m.throwCode === '' && m.fabricCode === 'Tie/01F'; })());
ok('the counts', plan.counts.patterns === 5 && plan.counts.colourways === 6 && plan.counts.derived === 4 && plan.counts.writes === 7 && plan.counts.missing === 3 && plan.counts.tagged === 2);
ok('the fill inserts: 19x19 and 23x23 proposed from Insert-PC-19x19 / Insert-PC-23X23 (not the outdoor one), 20x20 skips the down-wall code', (() => { const f = plan.fill; return f.length === 2 && f.find(x => x.sizeKey === '19x19').code === 'Insert-PC-19x19' && f.find(x => x.sizeKey === '23x23').code === 'Insert-PC-23X23'; })());
ok('a size whose fill is already set is not proposed', catalogTagPlanOf({ items: lib, config: { ...config, sizes: { '19x19': { fillItem: 'X' } } } }).fill.length === 1);
ok('insertForSize reads the spaced, quoted spelling too', insertForSize('18x18', lib).legacyErpId === 'Insert-PC- 18"x18"' && insertForSize('52x28', lib) === null);

// ── the writes ───────────────────────────────────────────────────────────────────────────────
const patches = catalogTagPatchesOf(plan.writes, { by: 'stuart', at: 1000 });
ok('one patch per item; the fabric\'s two writes merge into one', patches.length === 6 && patches.find(p => p.code === 'Bell/10F').patch['manufacturingSpecs.priceGroup'] === 'C' && patches.find(p => p.code === 'Bell/10F').patch['manufacturingSpecs.customData.convertedFrom'] === 'Bell/10T' && patches[0].patch.catalogTagBy === 'stuart' && patches[0].patch.catalogTagAt === 1000);
const sizes = sizesWithFillItems({ sizes: { '19x19': { label: '19x19', minCut: { lengthIn: 20, widthIn: 20 } }, '36x20': { fillItem: 'KEEP' } } }, plan.fill);
ok('the fill proposals land beside the stored min cut and never overwrite a set fill', sizes['19x19'].fillItem === 'Insert-PC-19x19' && sizes['19x19'].minCut.lengthIn === 20 && sizes['23x23'].fillItem === 'Insert-PC-23X23' && sizes['36x20'].fillItem === 'KEEP');
const rows = missingYardageRowsOf(plan.missing);
ok('the yardage-to-create rows follow the fabric sheet columns: code, throw, name, FABRIC, group, width blank, pattern, colour', rows[0][0] === 'Bell/22F' && rows[0][1] === 'Bell/22T' && rows[0][3] === 'FABRIC' && rows[0][4] === 'C' && rows[0][5] === '' && rows[0][7] === 'Bell' && rows[0][8] === 'Natural & Yellow' && rows[1][0] === 'Tie/01F' && rows[2][0] === 'Winters/90F');

console.log(fail ? `\n❌  ${pass} passed, ${fail} failed` : `\n✅  ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
