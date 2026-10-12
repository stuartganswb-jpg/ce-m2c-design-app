// The curtain chart, pinned (M2C Studio, 2026-10-12): the reader against a chart built the way the
// workroom's workbook is laid out (three sheets, the same columns worded three ways), every refusal by
// sheet and row, the packed document and its lookup, the swatch file names — and then, when the real
// workbook is on this machine (`M2C Curtains/`, not in the repo: it carries the workroom's costs), every
// one of its lines looked up again and compared to the sheet to the cent.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    parseCurtainWorkbook, findCurtainHeader, chartOf, linesOfChart, curtainDocOf, chartBytesOf, chartDiffOf, CHART_MAX_BYTES,
    issueSummaryOf, rowRangesOf, widthsWordOf, widthRangeWordOf,
    hasCurtainChart, curtainStylesOf, curtainFabricsOf, curtainLiningsOf, curtainGroupsOf, curtainQuoteOf, workroomRefOf, curtainOrderTextOf,
    swatchNameOf, curtainSwatchesOf, swatchLoadPlanOf, swatchProductTypeOf, swatchQueryTypesOf, SWATCH_PRODUCT_TYPE, SWATCH_PRODUCT_TYPES, FABRIC_BY_WORKROOM,
} from '../src/components/Shared/curtainPricing.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; } else { fail++; console.error('  ✗', name, extra); } };
const codes = (p, level) => p.issues.filter(x => !level || x.level === level).map(x => x.code);

// ── a chart laid out as the workbook is ───────────────────────────────────────────────────────────
// Three header wordings, as on the three real sheets (a line break inside a header, "cost" / "PRICE").
const HEAD_PINCH = ['FABRIC', '# of FABRIC WIDTHS', 'CUTTABLE FABRIC/ WIDTH ', 'FINISHED PANEL\nLOW WIDTH', 'FINISHED PANEL\nHIGH WIDTH', 'LOW LENGTH', 'HIGH LENGTH', 'SIZE GROUPING', 'TOP STYLE', 'LINING', 'Cost', 'Retail', null];
const HEAD_GROMMET = ['FABRIC', '# of FABRIC WIDTHS', 'CUTTABLE FABRIC/ WIDTH ', 'FINISHED PANEL\nLOW WIDTH', 'FINISHED PANEL\nHIGH WIDTH', 'LOW\nLENGTH', 'HIGH LENGTH', 'SIZE\nGROUPING', 'TOP STYLE', 'LINING', 'cost', 'Retail', null];
const HEAD_RIPPLE = ['FABRIC', '# of FABRIC WIDTHS', 'CUTTABLE FABRIC/ WIDTH ', 'FINISHED PANEL\nLOW WIDTH', 'FINISHED PANEL\nHIGH WIDTH', 'LOW\nLENGTH', 'HIGH LENGTH', 'SIZE\nGROUPING', 'TOP STYLE', 'LINING', 'PRICE', 'Retail'];
const BANDS = [[12, 24, 'S'], [25, 36, 'S'], [37, 48, 'S']];
// rows for one fabric · lining: each width group × each band; cost = base + 10 per band + 50 per group
const rowsFor = (fabric, cut, style, lining, groups, base, skip = () => false) => {
    const out = [];
    groups.forEach(([n, lo, hi], gi) => BANDS.forEach(([a, b, size], bi) => {
        if (skip(n, a)) return;
        const cost = base + gi * 50 + bi * 10 + 0.4567;
        out.push([fabric, n, cut, lo, hi, a, b, size, style, lining, cost, cost * 4]);
    }));
    return out;
};
const G55 = [[0.5, 0, 15], [1, 20, 30], [1.5, 35, 45]];
const G115 = [[0.5, 0, 55], [1, 115, 110], [1.5, 170, 165]];   // the real sheet's ripple-fold mistake: low above high
const pinchRows = [
    ...rowsFor('Winters', 55, 'Pinch Pleat', 'Unlined', G55, 100),
    ...rowsFor('Winters', 55, 'Pinch Pleat', 'Cotton', G55, 120),
    ...rowsFor('Grange', 115, 'Pinch Pleat', 'Unlined', [[0.5, 0, 30], [1, 35, 65], [1.5, 70, 90]], 300, (n, a) => n === 1.5 && a === 12),
];
const rippleRows = [
    ...rowsFor('Winters', 55, 'Ripple Fold', 'Unlined', [[0.5, 0, 25], [1, 30, 50], [1.5, 55, 75]], 90),
    ...rowsFor('Grange', 115, 'Ripple Fold', 'Unlined', G115, 280),
];
const build = () => [
    { name: 'PINCH PLEAT', grid: [HEAD_PINCH.slice(), ...pinchRows.map(r => r.slice())] },
    { name: 'GROMMET PLEAT', grid: [HEAD_GROMMET.slice(), ...rowsFor('Winters', 55, 'Grommet Pleat', 'Unlined', G55, 110), [null, null, null, null, null, null, null, null, null, null, null, null, null]] },
    { name: 'RIPPLE FOLD', grid: [HEAD_RIPPLE.slice(), ...rippleRows.map(r => r.slice())] },
    { name: 'Notes', grid: [['anything'], ['else']] },
];

// ── reading ───────────────────────────────────────────────────────────────────────────────────────
ok('a header is found whichever way it is worded', [HEAD_PINCH, HEAD_GROMMET, HEAD_RIPPLE].every(h => { const f = findCurtainHeader([h]); return f && f.headerRow === 0 && ['fabric', 'n', 'cuttable', 'widthLow', 'widthHigh', 'lengthLow', 'lengthHigh', 'size', 'style', 'lining', 'cost', 'retail'].every(k => f.cols[k] !== undefined); }));
ok('the columns land where the sheet has them', (() => { const f = findCurtainHeader([HEAD_RIPPLE]); return f.cols.fabric === 0 && f.cols.n === 1 && f.cols.widthLow === 3 && f.cols.lengthHigh === 6 && f.cols.cost === 10 && f.cols.retail === 11; })());
ok('a sheet that is not a chart has no header', findCurtainHeader([['anything'], ['else']]) === null);
ok('a workbook with no chart is refused', parseCurtainWorkbook([{ name: 'x', grid: [['a', 'b']] }]).errors[0].code === 'NO_CHART');
const p = parseCurtainWorkbook(build());
ok('the chart parses', p.ok && p.errors.length === 0, JSON.stringify(p.errors));
ok('three sheets read, the notes sheet skipped', p.sheetsRead.map(s => s.name).join(',') === 'PINCH PLEAT,GROMMET PLEAT,RIPPLE FOLD' && p.sheetsSkipped.join(',') === 'Notes');
ok('a trailing blank row is not a line', p.sheetsRead[1].lines === 9);
ok('every line is loaded once', p.lines.length === 9 + 9 + 8 + 9 + 9 + 9, String(p.lines.length));
ok('a line keeps its sheet and its row number', (() => { const l = p.lines.find(x => x.sheet === 'PINCH PLEAT' && x.fabric === 'Winters' && x.lining === 'Unlined' && x.n === 1 && x.lengthLow === 25); return l && l.row === 6; })());
ok('styles in sheet order, keyed', p.chart.styles.map(s => `${s.key}:${s.label}:${s.sheet}`).join('|') === 'PINCH_PLEAT:Pinch Pleat:PINCH PLEAT|GROMMET_PLEAT:Grommet Pleat:GROMMET PLEAT|RIPPLE_FOLD:Ripple Fold:RIPPLE FOLD');
ok('fabrics with their cuttable width', p.chart.fabrics.map(f => `${f.name}${f.cuttable}`).join(',') === 'Winters55,Grange115');
ok('linings in the order met', p.chart.linings.map(l => l.name).join(',') === 'Unlined,Cotton');
ok('the bands once, with the size grouping', p.chart.bands.map(b => `${b.low}-${b.high}${b.size}`).join(',') === '12-24S,25-36S,37-48S');

// ── the issues, by sheet and row ──────────────────────────────────────────────────────────────────
ok('a width range that runs backwards is refused, row by row', codes(p, 'REFUSED').filter(c => c === 'WIDTH_BACKWARDS').length === 6);
ok('…and named with its sheet and row', p.issues.find(x => x.code === 'WIDTH_BACKWARDS').message.startsWith('RIPPLE FOLD row '));
ok('a line the chart does not carry is a GAP, named', (() => { const g = p.issues.filter(x => x.code === 'MISSING_LINE'); return g.length === 1 && g[0].level === 'GAP' && g[0].message === 'Pinch Pleat · Grange · Unlined · 1½ widths has no line for 12–24".'; })());
const mut = (fn) => { const s = build(); fn(s); return parseCurtainWorkbook(s); };
ok('a cost that is not a number refuses the line by row', (() => { const q = mut(s => { s[0].grid[3][10] = 'call'; }); const x = q.issues.find(i => i.code === 'BAD_CELL'); return x && x.row === 4 && x.message === 'PINCH PLEAT row 4: COST is "call" — not a number; the line is not loaded.' && q.lines.length === p.lines.length - 1; })());
ok('a $-formatted price still reads', mut(s => { s[0].grid[3][10] = '$1,120.46'; }).lines.find(l => l.sheet === 'PINCH PLEAT' && l.row === 4).cost === 1120.46);
ok('a blank fabric refuses the line', mut(s => { s[0].grid[2][0] = ' '; }).issues.some(i => i.code === 'BAD_CELL' && i.row === 3 && /FABRIC is blank/.test(i.message)));
ok('a line listed twice: the second is refused, naming the first', (() => { const q = mut(s => { s[0].grid.push(s[0].grid[1].slice()); }); const x = q.issues.find(i => i.code === 'DUPLICATE'); return x && x.row === s0len(q) && /the same line as PINCH PLEAT row 2/.test(x.message); })());
function s0len() { return 1 + pinchRows.length + 1; }
ok('a width group whose range changes mid-sheet refuses the odd line', (() => { const q = mut(s => { s[0].grid[2][4] = 18; }); const x = q.issues.find(i => i.code === 'GROUP_RANGE_MIXED'); return x && x.row === 3 && /0–18 here and 0–15 on PINCH PLEAT row 2/.test(x.message); })());
ok('a length that runs backwards refuses the line', mut(s => { s[0].grid[1][5] = 30; }).issues.some(i => i.code === 'LENGTH_BACKWARDS' && i.row === 2));
ok('two bands that overlap: the later is refused', (() => { const q = mut(s => { s[0].grid[2][5] = 20; }); const x = q.issues.find(i => i.code === 'BAND_OVERLAP'); return x && x.row === 3 && /20–36" overlap 12–24" on row 2/.test(x.message); })());
ok('retail below cost is a warning, the line still loads', (() => { const q = mut(s => { s[0].grid[1][11] = 1; }); return q.issues.some(i => i.level === 'WARN' && i.code === 'RETAIL_BELOW_COST' && i.row === 2) && q.lines.length === p.lines.length; })());
ok('a fabric with two cuttable widths is a warning', mut(s => { s[0].grid[5][2] = 60; }).issues.some(i => i.code === 'CUTTABLE_MIXED' && i.row === 6));
ok('a sheet missing a column blocks the apply, by name', (() => { const q = mut(s => { s[2].grid[0][11] = 'Sell'; }); return !q.ok && q.errors[0].code === 'NO_COLUMN' && /Sheet "RIPPLE FOLD" has no RETAIL column/.test(q.errors[0].message); })());
ok('row ranges read as ranges', rowRangesOf([5, 3, 4, 9, 11, 12]) === '3–5, 9, 11–12');
const sum = issueSummaryOf(p.issues);
ok('the summary: one entry per kind · sheet · fabric, refused first', sum.length === 2 && sum[0].code === 'WIDTH_BACKWARDS' && sum[0].count === 6 && sum[0].fabric === 'Grange' && sum[0].rowsWord === '14–19' && sum[1].level === 'GAP', JSON.stringify(sum));

// ── the document ──────────────────────────────────────────────────────────────────────────────────
const chart = p.chart;
ok('one block per fabric · style · lining', chart.blocks.length === 6 && chart.lineCount === p.lines.length);
ok('a group holds three arrays aligned to the bands', chart.blocks.every(b => b.groups.every(g => g.rows.length === 3 && g.cost.length === 3 && g.retail.length === 3)));
ok('the missing line is a null, never a zero', (() => { const b = chart.blocks.find(x => x.style === 'PINCH_PLEAT' && x.fabric === 'GRANGE'); const g = b.groups.find(x => x.n === 1.5); return g.rows[0] === null && g.cost[0] === null && g.retail[0] === null && g.rows[1] !== null; })());
ok('a backwards group is kept and flagged, not dropped', (() => { const b = chart.blocks.find(x => x.style === 'RIPPLE_FOLD' && x.fabric === 'GRANGE'); return b.groups.filter(g => g.bad === 'WIDTH_BACKWARDS').length === 2 && !b.groups.find(g => g.n === 0.5).bad; })());
const noNestedArrays = (v) => (Array.isArray(v) ? v.every(x => !Array.isArray(x) && noNestedArrays(x)) : (v && typeof v === 'object' ? Object.values(v).every(noNestedArrays) : true));
const noUndefined = (v) => (v === undefined ? false : (Array.isArray(v) ? v.every(noUndefined) : (v && typeof v === 'object' ? Object.values(v).every(noUndefined) : true)));
const docu = curtainDocOf({ chart, live: null, fileName: 'chart.xlsx', by: 'Stuart', at: 1760300000000 });
ok('the document is Firestore-shaped: no array directly inside an array, nothing undefined', noNestedArrays(docu) && noUndefined(docu));
ok('a first apply states the workroom supplies the fabric and leaves its name blank', docu.workroom.name === '' && docu.workroom.fabricSuppliedBy === FABRIC_BY_WORKROOM && docu.brandId === 'm2c' && docu.sourceFile === 'chart.xlsx' && docu.appliedBy === 'Stuart');
ok('a re-apply keeps the workroom typed on the tool', curtainDocOf({ chart, live: { workroom: { name: 'Airtex', fabricSuppliedBy: 'WORKROOM' } } }).workroom.name === 'Airtex');
ok('the chart round-trips through the document', (() => { const back = linesOfChart(JSON.parse(JSON.stringify(docu))); return back.length === p.lines.length && p.lines.every(l => back.some(b => b.sheet === l.sheet && b.row === l.row && b.cost === l.cost && b.retail === l.retail && b.fabric === l.fabric && b.lining === l.lining && b.n === l.n && b.lengthLow === l.lengthLow)); })());
ok('the diff: a first apply is all new', (() => { const d = chartDiffOf(null, chart); return d.firstApply && d.added.length === p.lines.length && d.removed.length === 0; })());
ok('the diff: same chart, nothing changes', (() => { const d = chartDiffOf(docu, chart); return !d.firstApply && d.added.length === 0 && d.removed.length === 0 && d.repriced.length === 0 && d.unchanged === p.lines.length; })());
const qd = mut(s => { s[0].grid[1][10] = 999; s[0].grid[1][11] = 3996; s[0].grid.splice(2, 1); s[1].grid.splice(1, 0, ['Winters', 2, 55, 50, 60, 12, 24, 'S', 'Grommet Pleat', 'Unlined', 5, 20, null]); });
const dd = chartDiffOf(docu, qd.chart);
ok('the diff: a repriced line, a new line and a dropped line', dd.repriced.length === 1 && dd.repriced[0].wasCost === pinchRows[0][10] && dd.repriced[0].cost === 999 && dd.removed.length === 1 && dd.removed[0].lengthLow === 25 && dd.added.length === 1 && dd.added[0].n === 2,
    JSON.stringify({ repriced: dd.repriced.map(l => [l.sheet, l.n, l.lengthLow, l.wasCost, l.cost]), removed: dd.removed.map(l => [l.sheet, l.n, l.lengthLow]), added: dd.added.map(l => [l.sheet, l.n, l.lengthLow]) }));
ok('a small chart is far inside one document', chartBytesOf(docu) < CHART_MAX_BYTES);

// ── the lookup ────────────────────────────────────────────────────────────────────────────────────
ok('no chart, no options', !hasCurtainChart(null) && curtainStylesOf(null).length === 0 && curtainFabricsOf({}).length === 0 && curtainGroupsOf(null, {}).length === 0);
ok('the styles and the fabrics a style carries', curtainStylesOf(docu).length === 3 && curtainFabricsOf(docu, { style: 'Grommet Pleat' }).map(f => f.name).join() === 'Winters' && curtainFabricsOf(docu).length === 2);
ok('only the linings a fabric is offered in', curtainLiningsOf(docu, { style: 'Pinch Pleat', fabric: 'Winters' }).map(l => l.name).join() === 'Unlined,Cotton' && curtainLiningsOf(docu, { style: 'Pinch Pleat', fabric: 'Grange' }).map(l => l.name).join() === 'Unlined');
const groups = curtainGroupsOf(docu, { style: 'pinch pleat', fabric: 'WINTERS', lining: 'unlined' });
ok('the width groups, said plainly (any case finds them)', groups.map(g => `${g.word} ${g.range}`).join(' | ') === '½ width up to 15" | 1 width 20–30" | 1½ widths 35–45"');
ok('a group knows the lengths it has lines for', groups[0].minLength === 12 && groups[0].maxLength === 48 && curtainGroupsOf(docu, { style: 'Pinch Pleat', fabric: 'Grange', lining: 'Unlined' })[2].minLength === 25);
ok('widths said: ½, 1, 1½, 2, 2½', [0.5, 1, 1.5, 2, 2.5].map(widthsWordOf).join(',') === '½ width,1 width,1½ widths,2 widths,2½ widths' && widthRangeWordOf(0, 15) === 'up to 15"');
const q1 = curtainQuoteOf(docu, { style: 'Pinch Pleat', fabric: 'Winters', lining: 'Cotton', n: 1, lengthIn: 30, panels: 2, colour: '01 White' });
ok('a line is found for a length to the inch', q1.ok && q1.line.sheet === 'PINCH PLEAT' && q1.line.band.low === 25 && q1.line.band.high === 36 && q1.line.lengthIn === 30, JSON.stringify(q1.errors));
ok('…at the row the sheet has it on', q1.line.row === 1 + 9 + 3 + 2);
ok('…its cost as the sheet has it, its price the retail to the cent, the total for the panels', q1.line.cost === 120 + 50 + 10 + 0.4567 && q1.line.price === 721.83 && q1.line.total === 1443.66);
ok('the band edges belong to their own band', curtainQuoteOf(docu, { style: 'Pinch Pleat', fabric: 'Winters', lining: 'Cotton', n: 1, lengthIn: 24 }).line.band.high === 24 && curtainQuoteOf(docu, { style: 'Pinch Pleat', fabric: 'Winters', lining: 'Cotton', n: 1, lengthIn: 25 }).line.band.low === 25);
ok('the workroom is quoted the sheet and the row', workroomRefOf(q1.line) === 'PINCH PLEAT row 15 · Winters · Pinch Pleat · Cotton · 1 width (20–30" finished) · 25–36" long');
ok('the order says the panel that is made', curtainOrderTextOf(q1.line) === 'Winters 01 White · Pinch Pleat · Cotton · 20–30" wide × 30" long');
const refuses = (args, code) => { const r = curtainQuoteOf(docu, { style: 'Pinch Pleat', fabric: 'Winters', lining: 'Unlined', n: 1, lengthIn: 30, panels: 1, ...args }); return !r.ok && r.errors[0].code === code && r.line === null; };
ok('refused: no chart', curtainQuoteOf(null, {}).errors[0].code === 'NO_CHART');
ok('refused: a fabric / style / lining not on the chart', refuses({ fabric: 'Velvet' }, 'NO_FABRIC') && refuses({ style: 'Tab Top' }, 'NO_STYLE') && refuses({ lining: 'Interlined' }, 'NO_LINING'));
ok('refused: a lining the fabric is not offered in', refuses({ fabric: 'Grange', lining: 'Cotton' }, 'NOT_OFFERED'));
ok('refused: a width group the chart has not', refuses({ n: 4 }, 'NO_WIDTH_GROUP') && refuses({ n: null }, 'NO_WIDTH_GROUP'));
ok('refused: a length off the chart, with the range it runs', (() => { const r = curtainQuoteOf(docu, { style: 'Pinch Pleat', fabric: 'Winters', lining: 'Unlined', n: 1, lengthIn: 60 }); return r.errors[0].code === 'LENGTH_OUT_OF_RANGE' && /runs 12"–48"/.test(r.errors[0].message); })());
ok('refused: the line the chart does not carry', (() => { const r = curtainQuoteOf(docu, { style: 'Pinch Pleat', fabric: 'Grange', lining: 'Unlined', n: 1.5, lengthIn: 18 }); return r.errors[0].code === 'LENGTH_OUT_OF_RANGE' && /runs 25"–48"/.test(r.errors[0].message); })());
ok('refused: a hole between two bands', (() => { const d = JSON.parse(JSON.stringify(docu)); const g = d.blocks[0].groups[0]; g.rows[1] = null; g.cost[1] = null; g.retail[1] = null; return curtainQuoteOf(d, { style: 'Pinch Pleat', fabric: 'Winters', lining: 'Unlined', n: 0.5, lengthIn: 30 }).errors[0].code === 'NO_LINE'; })());
ok('refused: a fraction of an inch', refuses({ lengthIn: 30.5 }, 'LENGTH_NOT_WHOLE') && refuses({ lengthIn: '' }, 'NO_LENGTH'));
ok('refused: no panels', refuses({ panels: 0 }, 'NO_PANELS') && refuses({ panels: 1.5 }, 'NO_PANELS'));
ok('refused: a backwards group, naming its rows on the sheet', (() => { const r = curtainQuoteOf(docu, { style: 'Ripple Fold', fabric: 'Grange', lining: 'Unlined', n: 1, lengthIn: 30 }); return r.errors[0].code === 'GROUP_BAD' && r.errors[0].message === 'RIPPLE FOLD rows 14–16: the finished width runs backwards on the sheet (115–110) — correct the sheet and apply it again.'; })());
ok('the half-width group beside a backwards one still sells', curtainQuoteOf(docu, { style: 'Ripple Fold', fabric: 'Grange', lining: 'Unlined', n: 0.5, lengthIn: 30 }).ok);

// ── the swatches ──────────────────────────────────────────────────────────────────────────────────
const REAL_NAMES = ['M2C DF Maeve Cloud.png', 'M2C DF Alize Sand Dollar.png', 'M2C DF UNIQ Winters Brown.png', 'M2C DF UNIQ Winters 01 White.png', 'M2C DF UNIQ Tasso 85 Light Grey.png', 'M2C DF Grange Gris Natural.png', 'M2C DF Conrad Ecrue.png'];
const six = chartOf(['Winters', 'Tasso', 'Conrad', 'Maeve', 'Grange', 'Alize'].flatMap((f, i) => rowsFor(f, 55, 'Pinch Pleat', 'Unlined', G55, 100 + i).map((r, k) => ({ style: 'PINCH_PLEAT', styleLabel: 'Pinch Pleat', sheet: 'PINCH PLEAT', row: 2 + i * 9 + k, fabric: r[0], fabricKey: r[0].toUpperCase(), lining: 'Unlined', liningKey: 'UNLINED', n: r[1], cuttable: 55, widthLow: r[3], widthHigh: r[4], lengthLow: r[5], lengthHigh: r[6], size: 'S', cost: r[10], retail: r[11] }))));
six.styles.push({ key: 'GROMMET_PLEAT', label: 'Grommet Pleat', sheet: 'GROMMET PLEAT' }, { key: 'RIPPLE_FOLD', label: 'Ripple Fold', sheet: 'RIPPLE FOLD' });
const named = REAL_NAMES.map(n => swatchNameOf(n, six));
ok('the real file names read as fabric + colour', named.every(r => r.ok && r.kind === 'COLOUR') && named.map(r => `${r.fabric}/${r.colour}`).join(' | ') === 'Maeve/Cloud | Alize/Sand Dollar | Winters/Brown | Winters/01 White | Tasso/85 Light Grey | Grange/Gris Natural | Conrad/Ecrue', JSON.stringify(named));
ok('underscores and hyphens between words still read', swatchNameOf('m2c_df_maeve_Storm_Blue.jpg', six).colour === 'Storm Blue' && swatchNameOf('M2C-DF-Tasso-99 Black.PNG', six).fabric === 'Tasso');
ok('a fabric name inside another word is not a match', !swatchNameOf('Wintersweet Rose.png', six).ok);
ok('a file that names a fabric and no colour is refused', !swatchNameOf('M2C DF Maeve.png', six).ok && /no colour/.test(swatchNameOf('M2C DF Maeve.png', six).error));
ok('a file that names nothing on the chart is refused, listing the fabrics', /names no fabric and no top style/.test(swatchNameOf('IMG_4411.png', six).error) && /Winters, Tasso/.test(swatchNameOf('IMG_4411.png', six).error));
ok('a pleat picture reads as its style', swatchNameOf('M2C DF Pinch Pleat.png', six).kind === 'STYLE' && swatchNameOf('M2C DF Pinch Pleat.png', six).styleKey === 'PINCH_PLEAT' && swatchNameOf('Ripplefold main.jpg', six).styleKey === 'RIPPLE_FOLD' && swatchNameOf('M2C Grommet.png', six).styleKey === 'GROMMET_PLEAT');
ok('before a chart is applied a file name cannot be read', !swatchNameOf('M2C DF Maeve Cloud.png', null).ok);
ok('the gallery type: the library\'s own "Curtain" when it has one', swatchProductTypeOf(['Finial', 'Curtain', 'Pole']) === 'Curtain' && swatchProductTypeOf(['CURTAINS']) === 'CURTAINS' && swatchProductTypeOf(['Finial']) === SWATCH_PRODUCT_TYPE && SWATCH_PRODUCT_TYPES.includes('Curtain') && SWATCH_PRODUCT_TYPES.includes(SWATCH_PRODUCT_TYPE));
ok('the gallery is asked for the known spellings and the library\'s own, once each', swatchQueryTypesOf(['CurTain']).includes('CurTain') && swatchQueryTypesOf(['Curtain']).length === SWATCH_PRODUCT_TYPES.length && swatchQueryTypesOf([]).length === SWATCH_PRODUCT_TYPES.length && swatchQueryTypesOf(['CurTain']).length <= 30);
const asset = (o) => ({ id: `A-${Math.random()}`, brandId: 'm2c', productType: 'CURTAIN SWATCH', thumbnailUrl: 'https://x/t.png', originalUrl: 'https://x/o.png', ...o });
const sw = curtainSwatchesOf([
    asset({ patternId: 'WINTERS', finishId: '01 WHITE', curtainSwatch: true, curtain: { fabric: 'Winters', colour: '01 White' } }),
    asset({ patternId: 'ALIZE', finishId: 'SAND DOLLAR', productType: 'Curtain' }),                // filed by hand on tab 14
    asset({ patternId: 'MAEVE', finishId: 'CLOUD', brandId: 'ALL' }),
    asset({ patternId: 'MAEVE', finishId: 'ASH', brandId: 'uniquity' }),                           // another brand's
    asset({ patternId: 'MAEVE', finishId: 'ASH', productType: 'Finial' }),                         // not a curtain picture
    asset({ patternId: 'PINCH PLEAT', finishId: '', curtain: { style: 'Pinch Pleat' } }),
    asset({ patternId: 'VELVET', finishId: 'RED' }),
    asset({ patternId: 'TASSO', finishId: '99 BLACK', thumbnailUrl: '', url: '', originalUrl: '' }),
], six);
ok('swatches: the brand\'s curtain pictures of a chart fabric, in chart order', sw.colours.map(c => `${c.fabric}/${c.colour}`).join(' | ') === 'Winters/01 White | Maeve/Cloud | Alize/Sand Dollar', JSON.stringify(sw.colours.map(c => c.key)));
ok('…a hand-filed one reads its colour from the finish, said in title case', sw.colours.find(c => c.fabric === 'Alize').colour === 'Sand Dollar');
ok('…the tile picture and the full one', sw.colours[0].url === 'https://x/t.png' && sw.colours[0].fullUrl === 'https://x/o.png' && !!sw.colours[0].asset);
ok('…a pleat picture lands on its style; a fabric off the chart is set aside', !!sw.styles.PINCH_PLEAT && sw.unmatched.length === 1 && sw.unmatched[0].patternId === 'VELVET');
const plan = swatchLoadPlanOf(['M2C DF UNIQ Winters 01 White.png', 'M2C DF Maeve Ash.png', 'M2C DF Maeve ash.jpg', 'IMG_1.png', 'M2C DF Pinch Pleat.png', 'M2C DF Grommet Pleat.png'], six, sw);
ok('the load plan: HAVE · NEW · the twin refused · unreadable refused · a style already there · a new style', plan.map(r => r.status).join(',') === 'HAVE,NEW,REFUSED,REFUSED,HAVE,NEW', plan.map(r => r.status).join(','));
ok('…a new row carries what will be filed', plan[1].fabric === 'Maeve' && plan[1].colour === 'Ash' && plan[5].kind === 'STYLE' && plan[5].style === 'Grommet Pleat');

// ── the real workbook, when it is on this machine ─────────────────────────────────────────────────
const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, '..', 'M2C Curtains');
const book = fs.existsSync(dir) ? fs.readdirSync(dir).find(f => /\.xlsx$/i.test(f) && !f.startsWith('~$')) : null;
if (!book) {
    console.log('  (the real workbook is not on this machine — its line-for-line check is skipped)');
} else {
    // THE APP'S OWN READER (Shared/customerControlFile.workbookFileToSheets), handed the file the way the tool hands it.
    const { workbookFileToSheets } = await import('../src/components/Shared/customerControlFile.js');
    const buf = fs.readFileSync(path.join(dir, book));
    const file = { name: book, arrayBuffer: async () => buf };
    // Without `cachedResults` a formula whose stored result is 0 arrives as the formula object — the chart's LOW WIDTH
    // on every half-width pinch-pleat line. Pinned, so the flag is never dropped from the tool by mistake.
    const plain = parseCurtainWorkbook(await workbookFileToSheets(file));
    ok('REAL: read WITHOUT cachedResults, the 224 half-width pinch-pleat lines are lost (why the tool sets the flag)', plain.issues.filter(i => i.code === 'BAD_CELL').length === 224 && plain.issues.find(i => i.code === 'BAD_CELL').message === 'PINCH PLEAT row 2: FINISHED PANEL LOW WIDTH is a formula with no stored value — not a number; the line is not loaded.', JSON.stringify(plain.issues.find(i => i.code === 'BAD_CELL')));
    const sheets = await workbookFileToSheets(file, { cachedResults: true });
    const real = parseCurtainWorkbook(sheets);
    ok('REAL: the workbook reads', real.ok, JSON.stringify(real.errors));
    ok('REAL: three sheets, 1,778 lines each', real.sheetsRead.map(s => `${s.name}:${s.lines}`).join(',') === 'PINCH PLEAT:1778,GROMMET PLEAT:1778,RIPPLE FOLD:1778', JSON.stringify(real.sheetsRead));
    ok('REAL: 5,334 lines, none dropped', real.lines.length === 5334 && real.chart.lineCount === 5334);
    ok('REAL: six fabrics with their cuttable widths', real.chart.fabrics.map(f => `${f.name}${f.cuttable}`).join(',') === 'Winters55,Tasso55,Conrad64,Maeve64,Grange115,Alize115');
    ok('REAL: three linings, sixteen bands 12–204', real.chart.linings.map(l => l.name).join(',') === 'Unlined,Cotton,Blackout' && real.chart.bands.length === 16 && real.chart.bands[0].low === 12 && real.chart.bands[15].high === 204);
    ok('REAL: 42 blocks of eight width groups', real.chart.blocks.length === 42 && real.chart.blocks.every(b => b.groups.length === 8));
    ok('REAL: Grange and Alize are unlined only', ['Grange', 'Alize'].every(f => real.chart.styles.every(s => curtainLiningsOf(real.chart, { style: s.label, fabric: f }).map(l => l.name).join() === 'Unlined')));
    const by = (code) => real.issues.filter(i => i.code === code);
    ok('REAL: 222 ripple-fold lines run backwards — Grange and Alize, 1 width and up', by('WIDTH_BACKWARDS').length === 222 && by('WIDTH_BACKWARDS').every(i => i.sheet === 'RIPPLE FOLD' && ['Grange', 'Alize'].includes(i.fabric) && i.n >= 1), String(by('WIDTH_BACKWARDS').length));
    ok('REAL: 42 missing lines — 4 widths × 12–24" for every fabric and lining', by('MISSING_LINE').length === 42 && by('MISSING_LINE').every(i => i.n === 4 && /has no line for 12–24"\.$/.test(i.message)), String(by('MISSING_LINE').length));
    ok('REAL: nothing else is refused or warned', real.issues.length === 222 + 42, JSON.stringify(issueSummaryOf(real.issues).map(e => `${e.code}:${e.count}`)));
    ok('REAL: retail is four times cost on every line', real.lines.every(l => Math.abs(l.retail - l.cost * 4) < 0.005));
    const realDoc = JSON.parse(JSON.stringify(curtainDocOf({ chart: real.chart, live: null, fileName: book, by: 'harness', at: 1 })));
    ok('REAL: the document is Firestore-shaped and inside one document', noNestedArrays(realDoc) && noUndefined(realDoc) && chartBytesOf(realDoc) < CHART_MAX_BYTES, String(chartBytesOf(realDoc)));
    // every line of the sheet, looked up again at both ends of its band, to the cent
    let wrong = 0, refused = 0, firstWrong = '';
    real.lines.forEach(l => {
        [l.lengthLow, l.lengthHigh].forEach(L => {
            const r = curtainQuoteOf(realDoc, { style: l.styleLabel, fabric: l.fabric, lining: l.lining, n: l.n, lengthIn: L, panels: 1 });
            if (l.bad) { if (!r.ok && r.errors[0].code === 'GROUP_BAD') refused++; else { wrong++; firstWrong = firstWrong || `${l.sheet} ${l.row} bad group sold`; } return; }
            if (!r.ok || r.line.sheet !== l.sheet || r.line.row !== l.row || r.line.cost !== l.cost || r.line.retail !== l.retail || r.line.price !== Math.round((l.retail + Number.EPSILON) * 100) / 100) { wrong++; firstWrong = firstWrong || `${l.sheet} ${l.row} @${L}: ${JSON.stringify(r.errors)}`; }
        });
    });
    ok('REAL: every line looks up as itself at both ends of its band — sheet, row, cost, retail, price', wrong === 0, firstWrong);
    ok('REAL: the 222 backwards lines refuse at both ends', refused === 444, String(refused));
    // the rows Stuart's workbook annotates with past orders
    const at = (sheet, row) => real.lines.find(l => l.sheet === sheet && l.row === row);
    ok('REAL: PINCH PLEAT row 56 = Winters · 2 widths · 50–60 · 85–96 · Unlined', (() => { const l = at('PINCH PLEAT', 56); return l && l.fabric === 'Winters' && l.n === 2 && l.widthLow === 50 && l.widthHigh === 60 && l.lengthLow === 85 && l.lengthHigh === 96 && l.lining === 'Unlined'; })());
    ok('REAL: GROMMET PLEAT row 405 = Tasso · 1 width · 20–30 · 85–96 · Unlined', (() => { const l = at('GROMMET PLEAT', 405); return l && l.fabric === 'Tasso' && l.n === 1 && l.widthLow === 20 && l.lengthLow === 85; })());
    ok('REAL: a 91" Winters pinch pleat, 2 widths, unlined = row 56 at $2,647.26', (() => { const r = curtainQuoteOf(realDoc, { style: 'Pinch Pleat', fabric: 'Winters', lining: 'Unlined', n: 2, lengthIn: 91, panels: 2, colour: '01 White' }); return r.ok && r.line.row === 56 && r.line.price === 2647.26 && r.line.total === 5294.52 && workroomRefOf(r.line) === 'PINCH PLEAT row 56 · Winters · Pinch Pleat · Unlined · 2 widths (50–60" finished) · 85–96" long'; })());
    ok('REAL: 4 widths at 18" is refused with the range it runs', (() => { const r = curtainQuoteOf(realDoc, { style: 'Pinch Pleat', fabric: 'Winters', lining: 'Unlined', n: 4, lengthIn: 18 }); return !r.ok && r.errors[0].code === 'LENGTH_OUT_OF_RANGE' && /runs 25"–204"/.test(r.errors[0].message); })());
    const imgDir = path.join(dir, 'images');
    if (fs.existsSync(imgDir)) {
        const files = fs.readdirSync(imgDir).filter(f => /\.(png|jpe?g)$/i.test(f));
        const rows = swatchLoadPlanOf(files, realDoc, null);
        ok('REAL: all 21 swatch files read as a fabric and a colour', files.length === 21 && rows.every(r => r.status === 'NEW' && r.kind === 'COLOUR'), JSON.stringify(rows.filter(r => r.status !== 'NEW')));
        const per = {}; rows.forEach(r => { per[r.fabric] = (per[r.fabric] || 0) + 1; });
        ok('REAL: Winters 4 · Tasso 4 · Conrad 4 · Maeve 3 · Grange 3 · Alize 3', per.Winters === 4 && per.Tasso === 4 && per.Conrad === 4 && per.Maeve === 3 && per.Grange === 3 && per.Alize === 3, JSON.stringify(per));
    }
    console.log(`  (real workbook: ${book} — ${real.lines.length} lines, document ≈ ${Math.round(chartBytesOf(realDoc) / 1024)} KB)`);
}

console.log(fail ? `\n❌  ${pass} passed, ${fail} failed` : `\n✅  ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
