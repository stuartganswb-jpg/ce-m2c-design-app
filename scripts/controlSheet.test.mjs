// Harness for Shared/controlSheet.js — the rules of tab 1.2, Control Sheets.
//   node scripts/controlSheet.test.mjs
//
// Stuart 2026-10-07: "create a tab/page in the app that replaces the excel spreadsheet" — so the first thing
// proved here is that the page adds up the way the spreadsheets do. The figures below are the workbooks' own
// (Inception/M2C_Strata Light.xlsx, M2CCapa Floor Lamp.xlsx); when the prepared import files are on this
// machine (Inception/import/*.control-sheet.json) every sheet total in them is checked against the workbook's.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
    BUNDLE_FORMAT, FIELD_GROUPS, ALL_FIELDS, LINE_STATUSES, PUSHED, groupsFor, defaultGroupsFor, fieldByKey,
    valueAt, cellValueOf, cellTextOf, moneyText, numOf,
    landedEachOf, lineCostIn, sectionTotalOf, childChoicesFor, usesListOf, linesOn, sortOnSection, nextOrder,
    lineLabelOf, quoteTextOf, matchesSearch,
    projectNameKey, projectIdOf, tab1ProjectsOf, blankLine, blankProject,
    readBundle, planImport, finishImport,
} from '../src/components/Shared/controlSheet.js';
import { TAG_CATEGORIES } from '../src/components/Shared/assemblyTags.js';
import { TRAVERSE_ROLES } from '../src/components/Shared/traverseTags.js';

let pass = 0, fail = 0;
const ok = (n, c, extra = '') => { if (c) { pass++; return; } fail++; console.log(`✗ ${n} ${extra}`); };
const near = (n, got, want, tol = 0.005) => ok(n, got !== null && Math.abs(got - want) < tol, `got ${got}, want ${want}`);

// ── THE FIELD TABLE ─────────────────────────────────────────────────────────────────────────────────────
const keys = ALL_FIELDS.map(f => f.key);
ok('every field key is its own', new Set(keys).size === keys.length);
ok('a fixed-choice field carries its choices', ALL_FIELDS.filter(f => f.type === 'pick').every(f => Array.isArray(f.options) && f.options.length > 0));
ok('a dictionary field names its list', ALL_FIELDS.filter(f => f.type === 'list').every(f => !!f.list));
ok('the 1.6 tags are 1.6\'s own lists, not a copy', fieldByKey('tags.category').options === TAG_CATEGORIES && fieldByKey('tags.traverseRole').options === TRAVERSE_ROLES);
ok('the tags and the milling facts stay on the sheet', FIELD_GROUPS.filter(g => g.sheetOnly).map(g => g.key).join() === 'MAKE,TAGS');
ok('what the Master Library needs is all here', ['collection', 'productType', 'uom', 'partHandling', 'paintSize', 'watchList', 'isInHouse', 'isStocked', 'binLocation', 'unfinished'].every(k => !!fieldByKey(k)));
ok('a light is not shown the hardware tags', !groupsFor('LIGHTING').some(g => g.key === 'TAGS' || g.key === 'MAKE'));
ok('…nor the plate fields inside a group it does show', !groupsFor('LIGHTING').find(g => g.key === 'LIBRARY').fields.some(f => f.key === 'bpOrientation'));
ok('hardware is shown everything', groupsFor('HARDWARE').length === FIELD_GROUPS.length && groupsFor('HARDWARE').find(g => g.key === 'LIBRARY').fields.some(f => f.key === 'bpOrientation'));
ok('the sheet opens the way the workbook read', defaultGroupsFor('LIGHTING').includes('SOURCING') && defaultGroupsFor('HARDWARE').includes('PRICING'));
ok('PUSHED is never offered in the status box', !LINE_STATUSES.includes(PUSHED));

// ── A CELL ──────────────────────────────────────────────────────────────────────────────────────────────
const F = fieldByKey;
ok('a percentage is typed as a percentage, stored as the sheet\'s fraction', cellValueOf(F('dutyPct'), '20') === 0.2 && cellValueOf(F('dutyPct'), '65%') === 0.65);
ok('…and reads back as typed', cellTextOf(F('dutyPct'), 0.2) === '20' && cellTextOf(F('dutyPct'), 0.65) === '65' && cellTextOf(F('dutyPct'), 0.125) === '12.5');
ok('an emptied price is no price, never an empty string', cellValueOf(F('priceUsd'), '') === null && cellValueOf(F('priceUsd'), '  ') === null);
ok('money takes a $ and a comma', cellValueOf(F('priceUsd'), '$1,250.50') === 1250.5);
ok('zero is a price', cellValueOf(F('priceUsd'), '0') === 0 && cellTextOf(F('priceUsd'), 0) === '0');
ok('text is trimmed', cellValueOf(F('itemCode'), '  H3-75DF ') === 'H3-75DF');
ok('a tick is a tick', cellValueOf(F('isStocked'), true) === true && cellValueOf(F('isStocked'), false) === false);
ok('a tag is read by its path', valueAt({ tags: { category: 'FINIAL' } }, 'tags.category') === 'FINIAL' && valueAt({}, 'tags.category') === undefined && valueAt(null, 'name') === undefined);
ok('money prints to the cent, thousands marked', moneyText(217.97207142857144) === '$217.97' && moneyText(2248.3316428571425) === '$2,248.33' && moneyText(null) === '' && moneyText(0.055, 3) === '$0.055');

// ── THE ARITHMETIC — Strata Center, as the workbook carries it ──────────────────────────────────────────
const part = (id, priceUsd, dutyPct, uses, more = {}) => ({ id, order: 0, priceUsd, dutyPct, uses, ...more });
const center = [
    part('nipple12', 2.05, 0.1, { C: { qty: 1, balloon: '1' } }),
    part('nut', 0.05, 0.1, { C: { qty: 3, balloon: '2' }, O1: { qty: 4, balloon: '2' } }),
    part('washer', 0.06, 0.1, { C: { qty: 3, balloon: '3' }, O1: { qty: 4, balloon: '3' } }),
    part('standoff', 2.6, 0.1, { C: { qty: 1, balloon: '4' } }),
    part('cup', 10.88, 0.65, { C: { qty: 2, balloon: '5' } }),
    part('cupEnd', null, null, { C: { qty: null, balloon: '6' } }),
    part('ccon', 2.39, 0.65, { C: { qty: 1, balloon: '7' } }),
    part('ccap', 1.64, 0.65, { C: { qty: 2, balloon: '8' } }),
    part('m4', 29.5, 0.65, { C: { qty: 1, balloon: '9' } }),
    part('soc', 4.32, 0.65, { C: { qty: 1, balloon: '10' } }),
    part('e26', 7.85, 0.1, { C: { qty: 1, balloon: '11' } }),
    part('bulb', 38, 0.1, { C: { qty: 1, balloon: '12' } }),
];
near('landed each = USD × (1 + duty / shipping)', landedEachOf(center[4]), 17.952);
near('…a part with no duty lands at its price', landedEachOf(part('x', 12, null, {})), 12);
ok('…a part with no price has no landed cost', landedEachOf(center[5]) === null && landedEachOf({}) === null && landedEachOf(null) === null);
near('cost on a sheet = landed × quantity there', lineCostIn(center[4], 'C'), 35.904);
ok('…and nothing on a sheet it is not on', lineCostIn(center[4], 'O1') === null);
ok('one part, a quantity of its own on each sheet', lineCostIn(center[1], 'C') !== lineCostIn(center[1], 'O1'));

const sectionsA = [
    { id: 'C', name: 'Strata Center', kind: 'ASSEMBLY', children: [] },
    { id: 'O1', name: 'Strata Outer 1', kind: 'ASSEMBLY', children: [] },
    { id: 'FM', name: 'Flush Mount Assembly', kind: 'PRODUCT', children: [{ section: 'C', qty: 1, balloon: '10' }, { section: 'O1', qty: 2, balloon: '11' }] },
];
const tC = sectionTotalOf('C', sectionsA, center);
near('Strata Center adds up to the workbook\'s 156.9755', tC.total, 156.9755);
ok('…and says one line could not be costed (the end disc has no price)', tC.unpriced === 1 && tC.parts === 12);
const tO1 = sectionTotalOf('O1', sectionsA, center);
near('a second sheet counts only its own rows', tO1.total, (0.05 * 1.1 * 4) + (0.06 * 1.1 * 4));
const withPlate = [...center, part('plate', 71.55, 0.65, { FM: { qty: 1, balloon: '1' } })];
const tFM = sectionTotalOf('FM', sectionsA, withPlate);
near('a product rolls up its own parts and each sub-assembly × how many it takes', tFM.total, 118.0575 + tC.total + 2 * tO1.total);
ok('…lists each sub-assembly with its cost', tFM.children.length === 2 && Math.abs(tFM.children[1].cost - 2 * tO1.total) < 1e-9 && tFM.children[0].name === 'Strata Center');
ok('…and carries the sub-assembly\'s uncosted line up with it', tFM.unpriced === 1);
ok('a sheet that is not there totals nothing', sectionTotalOf('ZZ', sectionsA, center).total === 0);
const gone = sectionTotalOf('P', [{ id: 'P', name: 'P', children: [{ section: 'DELETED', qty: 1 }] }], []);
ok('a sub-assembly that was removed is counted as uncosted, not as zero', gone.unpriced === 1 && gone.children[0].cost === null && gone.children[0].name === '(sheet removed)');
const loop = [{ id: 'A', name: 'A', children: [{ section: 'B', qty: 1 }] }, { id: 'B', name: 'B', children: [{ section: 'A', qty: 1 }] }];
ok('two sheets that name each other do not hang the page', sectionTotalOf('A', loop, []).unpriced >= 1);

ok('a sheet may take any sheet that does not already contain it', childChoicesFor('O1', sectionsA).map(s => s.id).join() === 'C');
ok('…never itself, never what it already takes', childChoicesFor('FM', sectionsA).length === 0);
ok('…never its own parent', !childChoicesFor('C', sectionsA).some(s => s.id === 'FM'));

ok('the sheets a part is on', usesListOf(center[1], sectionsA).map(u => u.id).join() === 'C,O1' && linesOn(center, 'O1').length === 2);
ok('…a sheet that was removed is not listed', usesListOf({ uses: { GONE: { qty: 1 } } }, sectionsA).length === 0);
ok('a sheet reads in balloon order — "9, 16" sorts as 9', sortOnSection([
    { id: 'a', order: 10, uses: { S: { balloon: '10' } } }, { id: 'b', order: 20, uses: { S: { balloon: '9, 16' } } }, { id: 'c', order: 30, uses: { S: { balloon: '' } } }, { id: 'd', order: 40, uses: { S: { balloon: '2' } } },
], 'S').map(l => l.id).join('') === 'dbac');
ok('a new line goes to the foot', nextOrder([{ order: 10 }, { order: 250 }]) === 260 && nextOrder([]) === 10);

ok('a line is called by its number, else the vendor\'s, else its words', lineLabelOf({ itemCode: 'H3-75DF', vendorSku: 'X' }) === 'H3-75DF' && lineLabelOf({ vendorSku: 'NU233WZ', name: 'nut' }) === 'NU233WZ' && lineLabelOf({ name: 'Wood Top' }) === 'Wood Top' && lineLabelOf({}) === '(unnamed line)');
ok('a quote reads on one line', quoteTextOf({ label: 'Price 1 · BRASS', price: 66, currency: '', qty: '100' }) === 'Price 1 · BRASS 66 @ 100' && quoteTextOf({ label: '', price: 73, currency: 'RMB', qty: '100' }) === 'RMB 73 @ 100');
ok('search finds a line by number, words or vendor', matchesSearch({ itemCode: 'H3-75DF', name: 'drum finial', vendor: 'M2C' }, 'drum') && matchesSearch({ vendorSku: 'NU233WZ' }, 'nu233') && !matchesSearch({ name: 'nut' }, 'bolt') && matchesSearch({}, ''));

// ── WHICH PROJECT ───────────────────────────────────────────────────────────────────────────────────────
ok('a project is its name, upper-cased and single-spaced', projectNameKey('  strata   light ') === 'STRATA LIGHT');
ok('…and its sheet is filed by division and name', projectIdOf('M2C', 'Strata Light') === 'm2c__STRATA_LIGHT' && projectIdOf('ce', 'H3 — Contours!') === 'ce__H3_CONTOURS');
ok('the same name in two divisions is two sheets', projectIdOf('ce', 'X') !== projectIdOf('m2c', 'X'));
const tab1 = [
    { id: 'A1', itemName: 'STRATA OUTER DRAWING', project: 'Strata Light', finalImageUrl: 'https://x/outer.png', revisions: [{ id: 'R1', name: 'Sketch 2', url: 'https://x/outer2.png', is3D: false }, { id: 'R2', name: '3D', url: 'https://x/m.glb', is3D: true }] },
    { id: 'A2', itemName: 'STRATA CANOPY', project: 'STRATA  LIGHT', finalImageUrl: 'https://x/canopy.png', manufacturingSpecs: { cadUrl: 'https://x/c.glb' } },
    { id: 'A3', itemName: 'H3 CONTOURS', recordType: 'PROJECT', project: '', finalImageUrl: 'https://x/contours.png' },
    { id: 'A4', itemName: 'A PRODUCT WITH NO PROJECT', recordType: 'PRODUCT', project: '' },
    { id: 'A5', itemName: 'GLB ONLY', project: 'Strata Light', finalImageUrl: 'https://x/assemblies/a.glb?alt=media' },
];
const projs = tab1ProjectsOf(tab1);
ok('tab 1 names its projects: the Master Project, or a design of type PROJECT', projs.map(p => p.name).join('|') === 'H3 CONTOURS|STRATA LIGHT');
ok('…two spellings of one name are one project', projs[1].records.length === 3);
ok('…a product filed under no project names none', !projs.some(p => p.records.some(r => r.id === 'A4')));
ok('a project\'s pictures: each design\'s image and its 2D revisions, never a model', projs[1].pictures.map(p => p.url).join() === 'https://x/outer.png,https://x/outer2.png,https://x/canopy.png');
ok('…each named for its design', projs[1].pictures[1].label === 'STRATA OUTER DRAWING · Sketch 2' && projs[1].pictures[0].recordId === 'A1');
ok('no designs, no projects', tab1ProjectsOf([]).length === 0 && tab1ProjectsOf(null).length === 0);

const stamp = { brandId: 'm2c', user: 'Stuart', nowIso: '2026-10-07T12:00:00.000Z' };
const bl = blankLine({ id: 'L1', projectId: 'm2c__X', order: 10, ...stamp });
ok('a new line starts as a draft with nothing assumed', bl.status === 'DRAFT' && bl.priceUsd === null && bl.recordClass === '' && Object.keys(bl.uses).length === 0 && bl.createdBy === 'Stuart');
const bp = blankProject({ name: 'capa floor lamp', kind: 'LIGHTING', ...stamp });
ok('a new sheet is named for its project', bp.id === 'm2c__CAPA_FLOOR_LAMP' && bp.name === 'CAPA FLOOR LAMP' && bp.kind === 'LIGHTING' && bp.sections.length === 0);
ok('…a kind the page does not know is hardware', blankProject({ name: 'x', kind: 'PILLOW', ...stamp }).kind === 'HARDWARE');

// ── IMPORTING A PREPARED FILE ───────────────────────────────────────────────────────────────────────────
const bundle = {
    format: BUNDLE_FORMAT, sourceFile: 'M2C_Strata Light.xlsx', project: { name: 'Strata Light', kind: 'LIGHTING', suggestedBrand: 'm2c' },
    sections: [
        { key: 'S1', name: 'Strata Center', kind: 'ASSEMBLY', drawings: ['d1'], children: [], sheetTotal: 2.42 },
        { key: 'S6', name: 'Flush Mount Assembly', kind: 'PRODUCT', drawings: [], children: [{ section: 'S1', qty: 1, balloon: '10' }], sheetTotal: 120.4775 },
    ],
    lines: [
        { key: 'L1', itemCode: '', name: 'nut. 1/8 ips', material: 'STEEL', vendor: 'GRANDBRASS', vendorSku: 'NU233WZ', priceUsd: 0.05, dutyPct: 0.1, quotes: [], picture: 'p1', uses: { S1: { qty: 3, balloon: '2', note: '' } }, source: { sheet: 'Strata Center', row: 4 } },
        { key: 'L2', name: 'nipple', vendorSku: 'NI12-0X18', priceUsd: 2.05, dutyPct: 0.1, quotes: [], picture: '', uses: { S1: { qty: 1, balloon: '1', note: 'cut to 21in' } }, source: { sheet: 'Strata Center', row: 3 } },
        { key: 'L3', name: 'mount plate', vendorSku: 'MP-1575', priceUsd: 71.55, dutyPct: 0.65, quotes: [{ label: '', price: 480, currency: 'RMB', qty: '1' }], picture: 'p2', uses: { S6: { qty: 1, balloon: '1', note: '' } }, source: { sheet: 'Flush Mount Assembly', row: 3 } },
    ],
    images: { p1: { mime: 'image/png', data: 'AAAA' }, p2: { mime: 'image/png', data: 'BBBB' }, d1: { mime: 'image/png', data: 'CCCC' } },
    report: ['one thing to check'],
};
const read = readBundle(bundle);
ok('a prepared file is read', read.ok && read.summary.name === 'STRATA LIGHT' && read.summary.lines === 3 && read.summary.sections === 2 && read.summary.withPicture === 2 && read.summary.pictures === 3 && read.summary.report.length === 1);
ok('a file of another kind is refused', !readBundle({ format: 'something-else/9', project: { name: 'X' }, lines: [{}] }).ok && !readBundle(null).ok && !readBundle('text').ok);
ok('a file with no lines is refused', !readBundle({ ...bundle, lines: [] }).ok);
ok('a line on a sheet the file does not carry is refused, and named', readBundle({ ...bundle, sections: [bundle.sections[0]] }).errors.some(e => e.includes('mount plate') || e.includes('MP-1575')));
ok('a picture the file does not carry is refused', !readBundle({ ...bundle, images: { p1: bundle.images.p1, d1: bundle.images.d1 } }).ok);

const plan = planImport(bundle, { brandId: 'm2c', projectName: '', user: 'Stuart', nowIso: stamp.nowIso });
ok('the plan files the sheet under the division and the project', plan.projectId === 'm2c__STRATA_LIGHT' && plan.project.name === 'STRATA LIGHT' && plan.project.kind === 'LIGHTING' && plan.project.importedFrom === 'M2C_Strata Light.xlsx');
ok('…or under the tab-1 name it is imported INTO', planImport(bundle, { brandId: 'm2c', projectName: 'Strata 5', user: '', nowIso: '' }).projectId === 'm2c__STRATA_5');
ok('every line is a draft, in the workbook\'s order', plan.lines.map(l => l.id).join() === 'L1,L2,L3' && plan.lines.every(l => l.status === 'DRAFT') && plan.lines[2].order === 30);
ok('…with its facts, its quantity and balloon on each sheet, and where it came from', plan.lines[0].vendorSku === 'NU233WZ' && plan.lines[0].uses.S1.qty === 3 && plan.lines[1].uses.S1.note === 'cut to 21in' && plan.lines[0].source.row === 4 && plan.lines[2].quotes[0].currency === 'RMB');
ok('…and nothing the file did not say', plan.lines[0].recordClass === '' && plan.lines[0].basePrice === undefined && Object.keys(plan.lines[0].tags).length === 0);
ok('each picture has one home in storage', plan.images.length === 3 && plan.images[0].path === 'control_sheets/m2c/m2c__STRATA_LIGHT/p1.png');
const done = finishImport(plan, { p1: 'https://s/p1', d1: 'https://s/d1' });
ok('a picture that went up is on its line; one that did not leaves the cell empty', done.lines[0].pictureUrl === 'https://s/p1' && done.lines[0].pictureFrom.kind === 'IMPORT' && done.lines[2].pictureUrl === '' && done.lines[2].pictureFrom === undefined);
ok('…the working keys are not written', done.lines.every(l => !('pictureKey' in l)) && done.project.sections.every(s => !('drawingKeys' in s)));
ok('a sheet keeps its drawing, its sub-assemblies and the workbook\'s own total', done.project.sections[0].drawings[0].url === 'https://s/d1' && done.project.sections[1].children[0].section === 'S1' && done.project.sections[1].importedTotal === 120.4775);
near('the imported sheet adds up as the workbook did', sectionTotalOf('S6', done.project.sections, done.lines).total, 71.55 * 1.65 + (0.05 * 1.1 * 3 + 2.05 * 1.1));

// ── THE REAL FILES, when they are on this machine ───────────────────────────────────────────────────────
const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'Inception', 'import');
const files = existsSync(dir) ? readdirSync(dir).filter(n => n.endsWith('.control-sheet.json')) : [];
let checked = 0;
for (const name of files) {
    const b = JSON.parse(readFileSync(join(dir, name), 'utf8'));
    const r = readBundle(b);
    ok(`${name} is a file the tab reads`, r.ok, r.errors.join(' | '));
    if (!r.ok) continue;
    const p = finishImport(planImport(b, { brandId: r.summary.suggestedBrand || 'ce', projectName: '', user: 'test', nowIso: stamp.nowIso }), Object.fromEntries(Object.keys(b.images).map(k => [k, `https://s/${k}`])));
    ok(`${name}: every line has a home and no two share one`, new Set(p.lines.map(l => l.id)).size === p.lines.length);
    ok(`${name}: every picture reached its line`, p.lines.filter(l => l.pictureUrl).length === r.summary.withPicture);
    for (const s of p.project.sections) {
        if (numOf(s.importedTotal) === null) continue;
        near(`${name} · ${s.name} adds up to the workbook's ${s.importedTotal.toFixed(2)}`, sectionTotalOf(s.id, p.project.sections, p.lines).total, s.importedTotal);
        checked++;
    }
}

console.log(`controlSheet: ${pass} passed, ${fail} failed${files.length ? ` · ${files.length} prepared file(s), ${checked} sheet total(s) checked against the workbooks` : ' · no prepared files on this machine (the workbook totals were not re-checked)'}`);
process.exit(fail ? 1 : 0);
