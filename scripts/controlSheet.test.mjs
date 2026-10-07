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
    CURRENCIES, SOURCING_CHOICES, cellRawOf, sheetGroupsFor, libraryTargetOf, pushStateOf, noLibraryFieldText,
    PUSH_CLASSES, HAS_PARTS, requiredFor, sheetOfLine, componentsOf, columnsWithoutField, readinessOf, existingByCode, libraryIdFor, pushPlanOf, pushedStamp, unlockStamp,
    REF_KEY, OUR_MONEY, exportColumnsFor, startsInDownload, exportValueOf, backValueOf, planReimport, startsTicked, patchForCells, lineFromNewRow,
} from '../src/components/Shared/controlSheet.js';
import { isoOf, rateUrlFor, readRate, usdRateFor, forgetRates, usdOf, hasOriginPrice, originPricePatch, fxNoteOf, currenciesToRefresh, refreshPlan } from '../src/components/Shared/fxRates.js';
import { buildControlSheetXlsx, readControlSheetXlsx } from '../src/components/Shared/controlSheetXlsx.js';
import { sheetPinId, sheetPinFor, yieldsToNetSuiteBom } from '../src/components/Shared/sheetPins.js';
import { planFinishedRun, usablePin } from '../src/components/Shared/finishedGoodsRun.js';
import { isItemKit, kitComponentsOf } from '../src/components/Shared/itemKit.js';
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
ok('what the Master Library needs is all here', ['collection', 'productType', 'uom', 'partHandling', 'paintSize', 'watchList', 'sourcing', 'isStocked', 'binLocation', 'unfinished'].every(k => !!fieldByKey(k)));
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

// ── A COLUMN FOR EVERY LIBRARY FIELD, AND WHERE EACH GOES ──────────────────────────────────────────────
// The single-value fields of the Master Library's drawer, by the name the record stores them under.
const LIBRARY_PATHS = ['legacyErpId', 'itemName', 'partClass', 'finalImageUrl', 'routingType',
    ...['material', 'weight', 'programNum', 'vendorName', 'vendorId', 'vendorUrl', 'altVendorUrl', 'cost', 'moq', 'leadTime', 'basePrice', 'collections', 'productType', 'uom',
        'partHandling', 'finishStream', 'paintSize', 'watchList', 'sourcingMode', 'outsourceAction', 'isStocked', 'binLocation', 'reorderPoint', 'bomRevision', 'shopInstruction',
        'customOverrideFee', 'plateRole', 'plateUpgradeOf', 'plateUpcharge', 'plateUpchargePremium', 'wallMount.partId', 'wallMount.desc', 'parametric.length', 'parametric.width',
        'parametric.height', 'parametric.isCutToSize', 'layeringSequence'].map(n => `manufacturingSpecs.${n}`),
    ...['unfinished', 'feeType', 'trackLoaded', 'projection', 'bracketType', 'isReturnBracket', 'armThickness', 'bpOrientation'].map(n => `manufacturingSpecs.customData.${n}`)];
const paths = ALL_FIELDS.filter(x => x.lib).map(x => x.lib.path);
ok('there is a column for every single-value field the Library drawer carries', LIBRARY_PATHS.every(pth => paths.includes(pth)), LIBRARY_PATHS.filter(pth => !paths.includes(pth)).join(', '));
ok('…and no two columns go to one Library field', new Set(paths).size === paths.length);
ok('nothing held for 1.6 or for milling has a Library field', ALL_FIELDS.filter(x => x.sheetOnly).every(x => !x.lib) && ALL_FIELDS.filter(x => x.sheetOnly).length === 32);
ok('the three facts that make a record are always pushed', ALL_FIELDS.filter(x => x.always).map(x => x.key).join() === 'itemCode,name,recordClass');
ok('sourcing is the Library\'s three-way answer, in its own words', SOURCING_CHOICES.join() === 'In-House,Outsourced,Both');
ok('…and a line that carried the older in-house tick still reads', cellRawOf(F('sourcing'), { isInHouse: false }) === 'Outsourced' && cellRawOf(F('sourcing'), { isInHouse: true }) === 'In-House' && cellRawOf(F('sourcing'), { sourcing: 'Both', isInHouse: true }) === 'Both' && cellRawOf(F('sourcing'), {}) === '');
ok('a light keeps the general Library fields and none of the bracket ones', ['routingType', 'finishStream', 'bomRevision', 'shopInstruction', 'feeType', 'moq'].every(k => groupsFor('LIGHTING').some(g => g.fields.some(x => x.key === k))) && !groupsFor('LIGHTING').some(g => g.fields.some(x => ['plateRole', 'wallMountPart', 'isCutToSize'].includes(x.key))));

const sizeF = F('size'), weightF = F('weight'), tagF = F('tags.category');
ok('a column the Library has a field for goes there', libraryTargetOf(weightF, []).path === 'manufacturingSpecs.weight' && libraryTargetOf(weightF, []).label === 'Weight (lbs)' && libraryTargetOf(weightF, []).custom === false);
ok('a column it has none for goes nowhere', libraryTargetOf(sizeF, []) === null && libraryTargetOf(sizeF, null) === null);
const attrs = [{ key: 'sizeDimensions', label: 'Size / Dimensions', type: 'text' }, { key: 'countryOfOrigin', label: 'Country of origin', type: 'dropdown', options: 'China, USA , Italy' }, { key: 'testReport', label: 'Test report', type: 'file' }, { key: 'bad key', label: 'Bad', type: 'text' }, { key: 'uom', label: 'Unit', type: 'text' }];
ok('…until 4.5 adds an attribute under its name — then it takes it', libraryTargetOf(sizeF, attrs).path === 'manufacturingSpecs.customData.sizeDimensions' && libraryTargetOf(sizeF, attrs).custom === true && libraryTargetOf(sizeF, attrs).label === 'Size / Dimensions (Custom)');
ok('a built-in field is never re-pointed by an attribute of the same name', libraryTargetOf(F('uom'), attrs).path === 'manufacturingSpecs.uom');
ok('a 1.6 tag has no Library field whatever is added', libraryTargetOf(tagF, [{ key: 'category', label: 'Category', type: 'text' }]) === null);
const hwLib = sheetGroupsFor('HARDWARE', attrs).find(g => g.key === 'LIBRARY').fields;
ok('an attribute no column answers to is a column of its own', hwLib.some(x => x.key === 'custom.countryOfOrigin' && x.type === 'pick' && x.options.join('|') === 'China|USA|Italy' && x.lib.path === 'manufacturingSpecs.customData.countryOfOrigin'));
ok('…one a column already answers to is not doubled; a file attribute and a bad key are left out', !hwLib.some(x => ['custom.sizeDimensions', 'custom.testReport', 'custom.bad key', 'custom.uom'].includes(x.key)));
ok('no attributes, no change', sheetGroupsFor('HARDWARE', []).find(g => g.key === 'LIBRARY').fields.length === groupsFor('HARDWARE').find(g => g.key === 'LIBRARY').fields.length);

const PS = (field, cols, a = []) => pushStateOf(field, cols, a);
ok('a column with a Library field starts ticked', PS(weightF, {}).on && PS(weightF, {}).offered && !PS(weightF, {}).locked && !PS(weightF, {}).missing);
ok('a column without one starts unticked', !PS(sizeF, {}).on && PS(sizeF, {}).offered && PS(sizeF, {}).target === null);
ok('the sheet\'s own choice wins either way', !PS(weightF, { weight: false }).on && PS(sizeF, { size: true }).on);
ok('ticked with nowhere to go is MISSING — to be set up before the push', PS(sizeF, { size: true }).missing && !PS(sizeF, { size: true }, attrs).missing && PS(sizeF, { size: true }, attrs).target.custom);
ok('item #, description and class cannot be unticked', PS(F('itemCode'), { itemCode: false }).on && PS(F('itemCode'), {}).locked && PS(F('recordClass'), { recordClass: false }).on);
ok('the 1.6 tags and milling carry no tick at all', !PS(tagF, { tags: { category: true } }).offered && !PS(tagF, {}).on && !PS(F('rawStock'), { rawStock: true }).offered);
ok('a custom column\'s choice is read at its own place', !PS(hwLib.find(x => x.key === 'custom.countryOfOrigin'), { custom: { countryOfOrigin: false } }, attrs).on && PS(hwLib.find(x => x.key === 'custom.countryOfOrigin'), {}, attrs).on);
ok('the prompt names the column and where to set it up', noLibraryFieldText(sizeF).includes('no field for "Size / dimensions"') && noLibraryFieldText(sizeF).includes('Static Part Attributes'));

// ── THE ORIGIN PRICE AND ITS RATE ───────────────────────────────────────────────────────────────────────
ok('the currencies are dollars, RMB and euros', CURRENCIES.join() === 'USD,RMB,EUR' && isoOf('rmb') === 'CNY' && isoOf('EUR') === 'EUR' && isoOf('usd') === 'USD' && isoOf('GBP') === '' && isoOf('') === '');
ok('the rate is asked for by currency code and nothing else', rateUrlFor('RMB') === 'https://api.frankfurter.dev/v1/latest?base=CNY&symbols=USD' && rateUrlFor('USD') === '' && rateUrlFor('XYZ') === '');
ok('an answer is read only when it answers THIS currency', readRate({ base: 'CNY', date: '2026-10-07', rates: { USD: 0.14915 } }, 'RMB').rate === 0.14915 && readRate({ base: 'EUR', date: '2026-10-07', rates: { USD: 1.1 } }, 'RMB') === null && readRate({ base: 'CNY', rates: { USD: 0 } }, 'RMB') === null && readRate(null, 'RMB') === null && readRate({ base: 'CNY', rates: {} }, 'RMB') === null);
const fakeFetch = (answers, log = []) => async (url) => { log.push(url); const a = answers[url]; if (a === 'throw') throw new Error('offline'); return a ? { ok: true, json: async () => a } : { ok: false }; };
forgetRates();
const asked = [];
const net = fakeFetch({ [rateUrlFor('RMB')]: { base: 'CNY', date: '2026-10-07', rates: { USD: 0.14915 } }, [rateUrlFor('EUR')]: 'throw' }, asked);
const rmb = await usdRateFor('RMB', { fetchImpl: net, now: () => 1000 });
ok('today\'s rate comes with its date and its source', rmb.rate === 0.14915 && rmb.date === '2026-10-07' && rmb.source === 'ECB');
await usdRateFor('RMB', { fetchImpl: net, now: () => 2000 });
ok('…and is asked for once, not per line', asked.length === 1);
await usdRateFor('RMB', { fetchImpl: net, now: () => 2000, fresh: true });
ok('…unless Update rates asks afresh', asked.length === 2);
ok('dollars need no rate', (await usdRateFor('USD', { fetchImpl: net, now: () => Date.UTC(2026, 9, 7) })).rate === 1 && asked.length === 2);
ok('a rate that cannot be had is no rate — never a guess', (await usdRateFor('EUR', { fetchImpl: net })) === null && (await usdRateFor('GBP', { fetchImpl: net })) === null);

const p73 = originPricePatch({ priceOrigin: 73, currency: 'rmb' }, rmb);
ok('USD = the price × the day\'s rate, with the rate kept beside it', p73.priceUsd === 10.888 && p73.fxRate === 0.14915 && p73.fxDate === '2026-10-07' && p73.fxSource === 'ECB' && p73.currency === 'RMB' && usdOf(73, 0.14915) === 10.888);
ok('a price with no currency yet waits — the USD is blank, not kept from before', originPricePatch({ priceOrigin: 73, currency: '' }, null).priceUsd === null && originPricePatch({ priceOrigin: 73, currency: '' }, null).priceOrigin === 73);
ok('a price whose rate could not be had is PENDING, blank', originPricePatch({ priceOrigin: 73, currency: 'RMB' }, null).priceUsd === null && originPricePatch({ priceOrigin: 73, currency: 'RMB' }, null).fxSource === 'PENDING');
ok('clearing the price clears the dollars made from it', originPricePatch({ priceOrigin: '', currency: 'RMB' }, rmb).priceUsd === null && originPricePatch({ priceOrigin: null, currency: 'RMB' }, rmb).priceOrigin === null);
ok('a dollar quote is its own USD', originPricePatch({ priceOrigin: 8.25, currency: 'USD' }, { rate: 1, date: '2026-10-07', source: 'USD' }).priceUsd === 8.25);
ok('a line has an origin price only with both halves', hasOriginPrice({ priceOrigin: 73, currency: 'RMB' }) && !hasOriginPrice({ priceOrigin: 73, currency: '' }) && !hasOriginPrice({ priceOrigin: null, currency: 'RMB' }) && !hasOriginPrice({ priceUsd: 5 }));
ok('the note under the USD says what it was made from', fxNoteOf({ priceOrigin: 73, currency: 'RMB', ...p73 }) === 'RMB 73 × 0.14915 — ECB rate of 2026-10-07' && fxNoteOf({ priceOrigin: 73, currency: 'RMB', fxRate: 0.149041, fxSource: 'WORKBOOK' }).includes('the rate the workbook used') && fxNoteOf({ priceOrigin: 73, currency: '' }).startsWith('Choose the currency') && fxNoteOf({ priceUsd: 5 }) === '' && fxNoteOf({ priceOrigin: 73, currency: 'RMB', fxSource: 'PENDING', fxRate: null }).includes('could not be had'));

const sheetLines = [
    { id: 'A', priceOrigin: 73, currency: 'RMB', priceUsd: 10.88, fxRate: 10.88 / 73, fxSource: 'WORKBOOK', fxDate: '' },
    { id: 'B', priceOrigin: 20, currency: 'EUR', priceUsd: 21, fxRate: 1.05, fxSource: 'ECB', fxDate: '2026-09-01' },
    { id: 'C', priceOrigin: 8.25, currency: 'USD', priceUsd: 8.25 },
    { id: 'D', priceUsd: 5 },
    { id: 'E', priceOrigin: 10, currency: 'RMB', priceUsd: 1.4915, fxRate: 0.14915, fxSource: 'ECB', fxDate: '2026-10-07' },
    { id: 'P', priceOrigin: 73, currency: 'RMB', priceUsd: 10.88, status: 'PUSHED' },
];
ok('Update rates asks only for what is priced in something other than dollars', currenciesToRefresh(sheetLines).sort().join() === 'EUR,RMB');
const moved = refreshPlan(sheetLines, { RMB: rmb }, l => l.status === 'PUSHED');
ok('…moves each such line to today, and says from what to what', moved.length === 1 && moved[0].line.id === 'A' && moved[0].before === 10.88 && moved[0].after === 10.888 && moved[0].patch.fxSource === 'ECB');
ok('…leaves a line whose rate could not be had exactly as it is', !moved.some(m => m.line.id === 'B'));
ok('…and never a pushed line, a dollar line, a typed USD, or one already at today\'s rate', !moved.some(m => ['P', 'C', 'D', 'E'].includes(m.line.id)));

const withRmb = finishImport(planImport(bundle, { brandId: 'm2c', projectName: '', user: 'x', nowIso: stamp.nowIso }), {}).lines;
ok('a workbook row quoted in RMB comes in at the rate the workbook itself used', withRmb[2].priceOrigin === 480 && withRmb[2].currency === 'RMB' && Math.abs(withRmb[2].fxRate - 71.55 / 480) < 1e-12 && withRmb[2].fxSource === 'WORKBOOK' && withRmb[2].priceUsd === 71.55);
ok('…a row with only a USD figure was quoted in dollars', withRmb[0].priceOrigin === 0.05 && withRmb[0].currency === 'USD' && withRmb[0].fxRate === 1);
ok('…and a row with several quotes and no USD is left for a person to choose', planImport({ ...bundle, lines: [{ key: 'L9', name: 'finial', quotes: [{ label: 'Price 1 · BRASS', price: 66, currency: '', qty: '100' }, { label: 'Price 2 · BRASS', price: 64, currency: '', qty: '200' }], uses: {} }] }, { brandId: 'ce', projectName: 'X', user: '', nowIso: '' }).lines[0].priceOrigin === undefined);

// ── DOWNLOADING A SHEET AND BRINGING IT BACK ────────────────────────────────────────────────────────────
const hwFields = sheetGroupsFor('HARDWARE', attrs).flatMap(g => g.fields);
const secX = { id: 'SX', name: 'Bracket set' };
const allCols = exportColumnsFor(hwFields, secX);
ok('a download leads with the Ref, and on an assembly sheet carries its balloon, quantity and note', allCols[0].key === REF_KEY && allCols[1].key === '__balloon' && allCols[2].key === '__qty' && allCols[allCols.length - 1].key === '__note' && !exportColumnsFor(hwFields, null).some(c => c.use));
ok('our own money columns start out of the file; the vendor\'s price and currency start in', OUR_MONEY.every(k => !startsInDownload({ key: k })) && startsInDownload(allCols.find(c => c.key === 'priceOrigin')) && startsInDownload(allCols.find(c => c.key === 'currency')) && !startsInDownload(allCols.find(c => c.key === 'priceUsd')));
ok('what is worked out here is sent for reading and never read back', ['pictureUrl', 'quotes', 'priceUsd', 'landed', REF_KEY].every(k => allCols.find(c => c.key === k).back === false) && allCols.find(c => c.key === 'leadTime').back === true);
const colOf = (k) => allCols.find(c => c.key === k);
const L1 = { id: 'L1', itemCode: 'H3-75DF', name: '0.75IN DRUM FINIAL', size: '1.48in L', priceOrigin: 29, currency: 'RMB', priceUsd: 4.3254, dutyPct: 0.65, isStocked: true, leadTime: '', quotes: [{ label: 'Price 1 · ALUMINUM', price: 29, currency: '', qty: '100' }, { label: 'Price 2 · ALUMINUM', price: 27.5, currency: '', qty: '200' }], uses: { SX: { qty: 2, balloon: '4', note: 'left and right' } }, tags: { category: 'FINIAL' }, updatedAt: '2026-10-07T10:00:00.000Z', updatedBy: 'Stuart', status: 'DRAFT' };
ok('a cell goes out as a number where it is a number, a percentage as a percentage, a tick as Yes', exportValueOf(colOf('priceOrigin'), L1, 'SX') === 29 && exportValueOf(colOf('dutyPct'), L1, 'SX') === 65 && exportValueOf(colOf('isStocked'), L1, 'SX') === 'Yes' && exportValueOf(colOf('unfinished'), L1, 'SX') === '' && exportValueOf(colOf(REF_KEY), L1, 'SX') === 'L1');
ok('…its place on the sheet, its landed cost and its quotes as text', exportValueOf(colOf('__qty'), L1, 'SX') === 2 && exportValueOf(colOf('__balloon'), L1, 'SX') === '4' && exportValueOf(colOf('__note'), L1, 'SX') === 'left and right' && Math.abs(exportValueOf(colOf('landed'), L1, 'SX') - 4.3254 * 1.65) < 1e-9 && exportValueOf(colOf('quotes'), L1, 'SX').split('\n').length === 2 && exportValueOf(colOf('tags.category'), L1, 'SX') === 'FINIAL');
ok('a returned cell is read as a typed box is', backValueOf(colOf('dutyPct'), 65) === 0.65 && backValueOf(colOf('priceOrigin'), '31.5') === 31.5 && backValueOf(colOf('isStocked'), 'yes') === true && backValueOf(colOf('isStocked'), '') === false && backValueOf(colOf('__qty'), '3') === 3 && backValueOf(colOf('leadTime'), ' 30 days ') === '30 days');

const L2 = { id: 'L2', itemCode: 'H3-1DF', name: '1IN DRUM FINIAL', leadTime: '45 days', uses: { SX: { qty: 2, balloon: '5', note: '' } }, updatedAt: '2026-10-07T15:00:00.000Z', updatedBy: 'Leyla', status: 'DRAFT' };
const L3 = { id: 'L3', itemCode: 'H3-138DF', name: 'PUSHED ONE', status: 'PUSHED', uses: { SX: { qty: 1, balloon: '6', note: '' } } };
const lines3 = [L1, L2, L3];
const sent = ['__ref', '__balloon', '__qty', 'itemCode', 'name', 'size', 'priceOrigin', 'currency', 'priceUsd', 'leadTime', 'isStocked', '__note'].map(colOf);
const metaX = { projectId: 'ce__H3_CONTOURS', projectName: 'H3 CONTOURS', sectionId: 'SX', sectionName: 'Bracket set', exportedAt: '2026-10-07T12:00:00.000Z' };
const bytes = await buildControlSheetXlsx({ columns: sent, lines: lines3, sectionId: 'SX', meta: metaX, pictures: {} });
const backSame = await readControlSheetXlsx(bytes, allCols);
ok('the file says which sheet it came from, when, and which column is which', backSame.meta.projectId === 'ce__H3_CONTOURS' && backSame.meta.sectionId === 'SX' && backSame.meta.exportedAt === metaX.exportedAt && backSame.columns.map(c => c.key).join() === sent.map(c => c.key).join() && backSame.rows.length === 3);
const planSame = planReimport({ ...backSame, lines: lines3, projectId: 'ce__H3_CONTOURS', sections: [secX], knownColumns: allCols });
ok('a file sent back untouched changes nothing', !planSame.refused && planSame.changes.length === 0 && planSame.unchanged === 2 && planSame.locked.join() === 'H3-138DF' && planSame.newRows.length === 0);

// the vendor's reply: a price and currency on L1, its lead time; L2's lead time blanked and qty changed; L3 (pushed) edited; a row added; a column moved and one they made up
const ExcelJS = (await import('exceljs/dist/exceljs.min.js')).default;
const wbV = new ExcelJS.Workbook(); await wbV.xlsx.load(bytes);
const wsV = wbV.worksheets.find(w => w.name !== '_control_sheet');
const at = (k) => sent.findIndex(c => c.key === k) + 1;
wsV.getCell(4, at('priceOrigin')).value = 31.5; wsV.getCell(4, at('currency')).value = 'EUR'; wsV.getCell(4, at('leadTime')).value = '30 days'; wsV.getCell(4, at('priceUsd')).value = 999;
wsV.getCell(5, at('leadTime')).value = null; wsV.getCell(5, at('__qty')).value = 4;
wsV.getCell(6, at('name')).value = 'RENAMED BY VENDOR';
wsV.getCell(7, at('itemCode')).value = 'H3-NEW'; wsV.getCell(7, at('name')).value = 'A finial we also make'; wsV.getCell(7, at('priceOrigin')).value = 12;
wsV.getCell(3, sent.length + 1).value = 'Our internal code'; wsV.getCell(4, sent.length + 1).value = 'ZZ-1';
const reply = await readControlSheetXlsx(await wbV.xlsx.writeBuffer(), allCols);
const planV = planReimport({ ...reply, lines: lines3, projectId: 'ce__H3_CONTOURS', sections: [secX], knownColumns: allCols });
const c1 = planV.changes.find(c => c.lineId === 'L1'), c2 = planV.changes.find(c => c.lineId === 'L2');
ok('each difference is listed as what is here → what the file says', c1.cells.map(c => `${c.key}:${c.fromText}→${c.toText}`).join(' | ') === 'priceOrigin:29→31.5 | currency:RMB→EUR | leadTime:(blank)→30 days');
ok('a USD typed into the file is not read back — it is worked out here', !c1.cells.some(c => c.key === 'priceUsd') && planV.ignored.some(t => t.startsWith('USD')));
ok('a blank in the file is shown but does not clear a value by itself', c2.cells.find(c => c.key === 'leadTime').clears && !startsTicked(c2.cells.find(c => c.key === 'leadTime')) && startsTicked(c2.cells.find(c => c.key === '__qty')) && c2.cells.find(c => c.key === '__qty').to === 4);
ok('a line edited here after the download is flagged, with who', c2.stale && c2.staleBy === 'Leyla' && !c1.stale);
ok('a pushed line is never changed', planV.locked.join() === 'H3-138DF' && !planV.changes.some(c => c.lineId === 'L3'));
ok('a row the vendor added is offered as a new line, not applied', planV.newRows.length === 1 && planV.newRows[0].label === 'H3-NEW' && planV.newRows[0].cells.map(c => c.key).join() === 'itemCode,name,priceOrigin');
ok('a column the sheet does not know is ignored, and named', planV.ignored.some(t => t.startsWith('Our internal code')));
const patch1 = patchForCells(c1.cells.filter(startsTicked), planV.sectionId), patch2 = patchForCells(c2.cells.filter(startsTicked), planV.sectionId);
ok('only what is ticked is written, each cell at its own place on the line', JSON.stringify(patch1) === JSON.stringify({ priceOrigin: 31.5, currency: 'EUR', leadTime: '30 days' }) && JSON.stringify(patch2) === JSON.stringify({ 'uses.SX.qty': 4 }));
const added = lineFromNewRow([...planV.newRows[0].cells, { key: '__qty', to: 2 }, { key: 'tags.category', to: 'FINIAL' }], { id: 'LNEW', projectId: 'ce__H3_CONTOURS', brandId: 'ce', order: 40, user: 'Stuart', nowIso: stamp.nowIso, sectionId: 'SX' });
ok('a new row becomes a draft line on the sheet it was sent from', added.status === 'DRAFT' && added.itemCode === 'H3-NEW' && added.priceOrigin === 12 && added.uses.SX.qty === 2 && added.tags.category === 'FINIAL' && added.createdBy === 'Stuart');

ok('a file from another sheet is refused', planReimport({ ...reply, lines: lines3, projectId: 'm2c__STRATA_LIGHT', sections: [secX], knownColumns: allCols }).refused.includes('another sheet'));
ok('a file with no Ref column is refused', planReimport({ meta: null, columns: [{ key: 'name', label: 'Description' }], rows: [['x']], lines: lines3, projectId: 'p', sections: [], knownColumns: allCols }).refused.includes('no Ref column'));
ok('a file none of whose rows are ours is refused', planReimport({ meta: null, columns: [{ key: REF_KEY, label: 'Ref' }, { key: 'name', label: 'Description' }], rows: [['ZZ9', 'x']], lines: lines3, projectId: 'p', sections: [], knownColumns: allCols }).refused.includes('None of the rows'));
const noSheet = planReimport({ ...reply, lines: lines3, projectId: 'ce__H3_CONTOURS', sections: [], knownColumns: allCols });
ok('when the assembly sheet has gone, its balloon / quantity / note are left alone and that is said', !noSheet.changes.some(c => c.cells.some(x => x.key.startsWith('__'))) && noSheet.ignored.some(t => t.includes('no longer here')));

// a vendor's program that drops the hidden sheet, moves a column and leaves the headings
const wbN = new ExcelJS.Workbook(); await wbN.xlsx.load(await wbV.xlsx.writeBuffer());
wbN.removeWorksheet(wbN.getWorksheet('_control_sheet').id);
const wsN = wbN.worksheets[0];
const lt = at('leadTime'), st = at('isStocked');
for (let r = 3; r <= 7; r++) { const a = wsN.getCell(r, lt).value, b = wsN.getCell(r, st).value; wsN.getCell(r, lt).value = b; wsN.getCell(r, st).value = a; }
const bare = await readControlSheetXlsx(await wbN.xlsx.writeBuffer(), allCols);
ok('without the hidden sheet the columns are still known by their headings, wherever they were moved', bare.meta === null && bare.columns[lt - 1].key === 'isStocked' && bare.columns[st - 1].key === 'leadTime' && bare.columns[0].key === REF_KEY);
const planBare = planReimport({ ...bare, lines: lines3, projectId: 'ce__H3_CONTOURS', sections: [secX], knownColumns: allCols });
ok('…and the same differences are found (less the sheet\'s own balloon and quantity, which need the hidden sheet)', planBare.changes.find(c => c.lineId === 'L1').cells.map(c => c.key).join() === 'priceOrigin,currency,leadTime' && !planBare.changes.some(c => c.cells.some(x => x.key === '__qty')));
const dupHead = await readControlSheetXlsx(await (async () => { const w = new ExcelJS.Workbook(); const sh = w.addWorksheet('s'); ['Ref (do not change)', 'Category', 'Description'].forEach((h, i) => { sh.getCell(1, i + 1).value = h; }); ['L1', 'FINIAL', 'x'].forEach((h, i) => { sh.getCell(2, i + 1).value = h; }); return w.xlsx.writeBuffer(); })(), allCols);
ok('a heading two columns share (Category) is not guessed at', dupHead.columns[1].key === null && dupHead.columns[2].key === 'name');

// ── THE PUSH: A LINE BECOMES A MASTER LIBRARY RECORD ────────────────────────────────────────────────────
const LISTS = { prodTypes: ['FINIAL', 'BRACKET', 'POLE'], uom: ['EA', 'FT'], partHandling: ['Custom', 'Small Parts'], materials: ['METAL', 'WOOD', 'BRASS'], collections: ['H3 CONTOURS'], bins: ['A-01'], watchLists: [], projections: [], bracketMounts: [], outsourceActions: [], feeTypes: [], routingTypes: ['STANDARD'] };
const hw = sheetGroupsFor('HARDWARE', []).flatMap(g => g.fields);
const finial = { id: 'L1', status: 'READY', itemCode: 'h3-75df ', name: ' 0.75in Drum Finial', recordClass: 'Inventory', productType: 'Finial', uom: 'ea', partHandling: 'Small Parts', sourcing: 'Outsourced',
    pictureUrl: 'https://s/p1.png', size: '1.48in L x 1.24in Diam.', material: 'BRASS', weight: '0.4', vendor: 'Dong Li', vendorSku: 'DF-75', priceOrigin: 66, currency: 'RMB', priceUsd: 9.8439, dutyPct: 0.65, basePrice: 28, collection: 'h3  contours', binLocation: 'A-01',
    isStocked: true, unfinished: false, paintSize: 'S', leadTime: '45 days', quotes: [{ label: 'Price 1 · BRASS', price: 66, currency: 'RMB', qty: '100' }], rawStock: 'bar', tags: { category: 'FINIAL', position: 'LEFT' }, notes: 'sample approved' };
const ctx = (over = {}) => ({ fields: hw, pushColumns: {}, customSchema: [], lists: LISTS, lines: [finial], ...over });
const R = (line, over) => readinessOf(line, ctx(over));
ok('the sheet pushes a part, a fee, a $-holder — and a kit and an assembly, with their parts', PUSH_CLASSES.join() === 'Inventory,Fee,Non-Inventory,Kit,Assembly' && HAS_PARTS.join() === 'Kit,Assembly');
ok('a part needs the seven; a fee and a $-holder are not asked how they are routed or sourced', requiredFor('Inventory').join() === 'itemCode,name,recordClass,uom,productType,partHandling,sourcing' && requiredFor('Fee').join() === 'itemCode,name,recordClass,uom' && requiredFor('Non-Inventory').length === 4);
ok('a worked-out line is ready', R(finial).ok && R(finial).blocks.length === 0, JSON.stringify(R(finial)));
for (const [key, label] of [['itemCode', 'Item #'], ['name', 'Description'], ['recordClass', 'Class'], ['productType', 'Category'], ['uom', 'UOM'], ['partHandling', 'Part handling'], ['sourcing', 'Sourcing']]) {
    const r = R({ ...finial, [key]: '' });
    ok(`…without its ${label} it is refused, and told which`, !r.ok && r.blocks.some(b => b.startsWith(`${label} is empty`)), JSON.stringify(r.blocks));
}
ok('a needed column that is unticked for the Library stops the push', R(finial, { pushColumns: { uom: false } }).blocks.some(b => b.includes('UOM is needed by the Master Library, but its column is not ticked')));
ok('a category, unit or handling the Library does not list is refused — it would mis-route the part', R({ ...finial, productType: 'Knob' }).blocks.some(b => b.includes('Category "Knob" is not on the Master Library\'s list')) && R({ ...finial, uom: 'FOOT' }).blocks.length === 1 && R({ ...finial, partHandling: 'small' }).blocks.length === 1);
ok('…case does not matter', R({ ...finial, productType: 'finial', partHandling: 'small parts' }).ok);
ok('…and an EMPTY list refuses no one — it warns', R(finial, { lists: { ...LISTS, uom: [] } }).ok && R(finial, { lists: { ...LISTS, uom: [] } }).warnings.some(w => w.includes('could not be checked')));
ok('a column ticked for the Library with no field there stops every push, by name', R(finial, { pushColumns: { size: true } }).blocks.some(b => b.includes('Size / dimensions') && b.includes('4.5')) && columnsWithoutField(hw, { size: true, color: true }, []).map(fd => fd.key).join() === 'size,color');
ok('…until the attribute exists', R(finial, { pushColumns: { size: true }, customSchema: [{ key: 'size', label: 'Size / dimensions', type: 'text' }] }).ok);
ok('two lines with one item # cannot both go', R(finial, { lines: [finial, { id: 'L2', itemCode: 'H3-75DF' }] }).blocks.some(b => b.includes('same item # (H3-75DF)')) && R(finial, { lines: [finial, { id: 'L2', itemCode: 'H3-1DF' }] }).ok);
ok('an assembly and a kit are not pushed without a sheet of their parts', R({ ...finial, recordClass: 'Assembly' }).blocks.some(b => b.includes('no sheet listing its parts')) && R({ ...finial, recordClass: 'Kit' }).blocks.some(b => b.includes('no sheet listing its parts')) && !R({ ...finial, recordClass: 'Master Assembly' }).ok);
ok('a pushed line is not pushed again', !R({ ...finial, status: 'PUSHED' }).ok);
const fee = { id: 'F1', itemCode: 'CE-FEE-9001', name: 'Rush fee', recordClass: 'Fee', uom: 'EA', basePrice: 25 };
ok('a fee is ready on its number, words, class and unit', R(fee, { lines: [fee] }).ok && R({ ...fee, uom: '' }, { lines: [fee] }).blocks.join() === 'UOM is empty.');
const bareLine = { ...finial, vendor: '', basePrice: null, binLocation: '', material: 'Zamak', pictureUrl: '', priceUsd: null, priceOrigin: null };
ok('what is merely empty or off a list warns and does not stop', R(bareLine).ok && ['Base price is empty.', 'Bin is empty.', 'Picture is empty.', 'It is bought, and no vendor is named.', 'It has no cost — no USD on the line.'].every(w => R(bareLine).warnings.includes(w)) && R(bareLine).warnings.some(w => w.includes('Material "Zamak" is not on the Master Library\'s list — it goes in as typed')));
ok('a part made here with no paint size is told so', R({ ...finial, sourcing: 'In-House', paintSize: '' }).warnings.includes('It is made here, and has no paint size.') && !R(finial).warnings.some(w => w.includes('paint size')));
ok('a column that is not going to the Library is not warned about', !R({ ...bareLine }, { pushColumns: { basePrice: false, binLocation: false, material: false, pictureUrl: false } }).warnings.some(w => /Base price|Bin is|Material|Picture/.test(w)));

const lib = [{ id: 'CE-INV-62502', itemId: 'CE-INV-62502', legacyErpId: 'H1-138TRVEBA' }, { id: 'CE-INV-1', itemId: 'h3-75df', legacyErpId: 'PENDING' }, { id: 'CE-INV-2', legacyErpId: 'H3-1DF ' }];
ok('the Library already has the item when a record answers to its number — by ERP id or its own id, any case', existingByCode(lib, 'h1-138trveba').id === 'CE-INV-62502' && existingByCode(lib, 'H3-75DF').id === 'CE-INV-1' && existingByCode(lib, ' h3-1df').id === 'CE-INV-2' && existingByCode(lib, 'ce-inv-62502').id === 'CE-INV-62502');
ok('…and not otherwise', existingByCode(lib, 'H3-138DF') === null && existingByCode(lib, '') === null && existingByCode([], 'X') === null && existingByCode(null, 'X') === null);
ok('a new record takes the Library\'s own prefix and the clock, not four random digits', libraryIdFor('ce', 'Inventory', 1791400000000) === 'CE-INV-1791400000000' && libraryIdFor('m2c', 'Fee', 5) === 'M2C-FEE-5' && libraryIdFor('ce', 'Non-Inventory', 5) === 'CE-NIV-5');

const proj = { id: 'ce__H3_CONTOURS', name: 'H3 CONTOURS' };
const planP = pushPlanOf(finial, { project: proj, brandId: 'ce', fields: hw, pushColumns: {}, customSchema: [], user: 'Stuart', nowIso: '2026-10-07T20:00:00.000Z', id: 'CE-INV-1791400000000' });
const rec = planP.record, ms = rec.manufacturingSpecs;
ok('the record is a Library record: identity on top, the rest under manufacturingSpecs', rec.id === 'CE-INV-1791400000000' && rec.itemId === rec.id && rec.brandId === 'ce' && rec.sharedBrands.join() === 'ce' && rec.partClass === 'Inventory' && Array.isArray(rec.clientPricing) && rec.createdAt === '2026-10-07T20:00:00.000Z' && rec.updatedAt === rec.createdAt);
ok('its number upper-cased and trimmed, its words as typed', rec.legacyErpId === 'H3-75DF' && rec.itemName === '0.75in Drum Finial');
ok('its category in both places the Library keeps it, upper-cased; its unit upper-cased', rec.productType === 'FINIAL' && ms.productType === 'FINIAL' && ms.uom === 'EA');
ok('its collection under the one name', JSON.stringify(ms.collections) === '["H3 CONTOURS"]');
ok('sourcing as the Library\'s two fields, together', ms.isInHouse === false && ms.sourcingMode === 'OUT');
ok('its cost is the landed cost; its price, vendor, bin, lead time each in the Library\'s own field', Math.abs(ms.cost - 16.2424) < 1e-9 && ms.basePrice === 28 && ms.vendorName === 'Dong Li' && ms.vendorId === 'DF-75' && ms.binLocation === 'A-01' && ms.leadTime === '45 days' && ms.material === 'BRASS' && ms.weight === '0.4' && ms.partHandling === 'Small Parts' && ms.paintSize === 'S' && ms.isStocked === true);
ok('its picture is its picture', rec.finalImageUrl === 'https://s/p1.png' && rec.imageSource === undefined);
ok('it is filed under the sheet\'s project and remembers the line it came from', rec.project === 'H3 CONTOURS' && rec.controlSheet.lineId === 'L1' && rec.controlSheet.projectId === 'ce__H3_CONTOURS' && rec.controlSheet.pushedBy === 'Stuart' && rec.createdBy === 'Stuart');
ok('nothing held for 1.6 or for milling travels', !JSON.stringify(rec).includes('LEFT') && !JSON.stringify(rec).includes('bar') && rec.tags === undefined && ms.rawStock === undefined);
ok('nor the working detail: the size, the vendor\'s price, the duty, the quotes, the notes', ms.size === undefined && ms.priceOrigin === undefined && ms.dutyPct === undefined && ms.quotes === undefined && ms.notes === undefined && !('priceUsd' in ms));
ok('an unticked box writes nothing — the Library\'s own default stands', !('unfinished' in ms.customData) && ms.customOverrideFee === undefined);
ok('the record carries the keys the Library\'s readers expect, even when the line said nothing', ms.watchList === 'NONE' && ms.parametric.isCutToSize === false && typeof ms.customData === 'object');
ok('what a person is shown: each column, the Library\'s name for where it lands, the value', planP.written.find(w => w.label === 'Landed each').to === 'Base Cost ($)' && planP.written.find(w => w.label === 'Landed each').text === '16.2424' && planP.written.find(w => w.label === 'Collection').text === 'H3 CONTOURS' && planP.written.find(w => w.label === 'Sourcing').to === 'In-House / Outsourced / Both' && planP.written.find(w => w.label === 'Picture').text === 'the picture' && !planP.written.some(w => w.label === 'Unfinished'));
ok('…and what stays on the sheet', ['Size / dimensions', 'Quotes', 'Price', 'Currency', 'USD', 'Duty / ship', 'Notes', 'Raw stock material', 'Category', 'Position'].every(k => planP.kept.includes(k)) && !planP.kept.includes('Material'));
const planOff = pushPlanOf(finial, { project: proj, brandId: 'ce', fields: hw, pushColumns: { basePrice: false, landed: false, size: true }, customSchema: [{ key: 'sizeDimensions', label: 'Size / dimensions', type: 'text' }], user: 'S', nowIso: 'n', id: 'X' });
ok('an unticked column stays behind; a column given a custom attribute goes to it', planOff.record.manufacturingSpecs.basePrice === undefined && planOff.record.manufacturingSpecs.cost === undefined && planOff.kept.includes('Base price') && planOff.record.manufacturingSpecs.customData.sizeDimensions === '1.48in L x 1.24in Diam.' && planOff.written.find(w => w.label === 'Size / dimensions').to === 'Size / Dimensions (Custom)'.replace('Dimensions', 'dimensions'));
const feeRec = pushPlanOf(fee, { project: proj, brandId: 'ce', fields: hw, pushColumns: {}, customSchema: [], user: 'S', nowIso: 'n', id: 'CE-FEE-5' }).record;
ok('a fee is a FEE in the Library\'s own way, and in-house by its default', feeRec.partClass === 'Fee' && feeRec.productType === 'FEE' && feeRec.manufacturingSpecs.productType === 'FEE' && feeRec.manufacturingSpecs.basePrice === 25 && feeRec.manufacturingSpecs.isInHouse === true);
const bracket = { id: 'B1', itemCode: 'H9-1BE', name: 'Bracket', recordClass: 'Inventory', productType: 'BRACKET', uom: 'EA', partHandling: 'Small Parts', sourcing: 'Both', projection: '4.625', bpLength: 3.5, isCutToSize: true, wallMountPart: 'H1-BPWP5', unfinished: true };
const brRec = pushPlanOf(bracket, { project: proj, brandId: 'ce', fields: hw, pushColumns: {}, customSchema: [], user: 'S', nowIso: 'n', id: 'X' }).record.manufacturingSpecs;
ok('the bracket facts land where the Library reads them', brRec.customData.projection === '4.625' && brRec.customData.unfinished === true && brRec.parametric.length === 3.5 && brRec.parametric.isCutToSize === true && brRec.parametric.width === '' && brRec.wallMount.partId === 'H1-BPWP5' && brRec.isInHouse === true && brRec.sourcingMode === 'BOTH');

const stampP = pushedStamp(rec, { user: 'Stuart', nowIso: 'T1' });
ok('the line is stamped with the record it became', stampP.status === 'PUSHED' && stampP.pushedTo.docId === 'CE-INV-1791400000000' && stampP.pushedTo.code === 'H3-75DF' && stampP.pushedTo.linked === false && pushedStamp(lib[0], { user: 'S', nowIso: 'T', linked: true }).pushedTo.linked === true);
const un = unlockStamp({ ...finial, ...stampP }, { user: 'Leyla', nowIso: 'T2' });
ok('an unlock returns it to Ready and keeps what happened', un.status === 'READY' && un.pushedTo === null && un.lastPush.docId === 'CE-INV-1791400000000' && un.lastPush.undoneBy === 'Leyla' && un.lastPush.undoneAt === 'T2');

// ── A KIT AND AN ASSEMBLY GO WITH THEIR PARTS ───────────────────────────────────────────────────────────
ok('an assembly is asked everything a part is; a kit only its number, words, class and unit', requiredFor('Assembly').length === 7 && requiredFor('Kit').join() === 'itemCode,name,recordClass,uom');
const inLib = (id, code, more = {}) => ({ id, itemCode: code, name: `${code} part`, recordClass: 'Inventory', status: 'PUSHED', pushedTo: { docId: `CE-INV-${id}`, code }, ...more });
const arm = inLib('A', 'H9-ARM', { uses: { KS: { qty: 1, balloon: '1' }, AS: { qty: 2, balloon: '1' } } });
const plate = inLib('B', 'H9-PLT', { uses: { KS: { qty: 1, balloon: '2' }, AS: { qty: 1, balloon: '2' } } });
const screw = { id: 'C', itemCode: 'H9-SCR', name: 'screw', recordClass: 'Inventory', status: 'DRAFT', uses: { AS: { qty: 4, balloon: '3' } } };
const kitLine = { id: 'K', itemCode: 'H9-BRK-KIT', name: 'Bracket kit', recordClass: 'Kit', uom: 'EA', basePrice: 60, collection: 'H3 CONTOURS', status: 'READY', uses: {} };
const asmLine = { id: 'S', itemCode: 'H9-BRK', name: 'Bracket assembly', recordClass: 'Assembly', uom: 'EA', productType: 'BRACKET', partHandling: 'Small Parts', sourcing: 'In-House', paintSize: 'M', status: 'READY', uses: {} };
const subLine = inLib('U', 'H9-SUB', { recordClass: 'Assembly', uses: {} });
const secs = [
    { id: 'KS', name: 'Bracket kit', kind: 'ASSEMBLY', itemLineId: 'K', children: [] },
    { id: 'AS', name: 'Bracket assembly', kind: 'ASSEMBLY', itemLineId: 'S', children: [{ section: 'US', qty: 1, balloon: '9' }] },
    { id: 'US', name: 'Sub', kind: 'ASSEMBLY', itemLineId: 'U', children: [] },
];
const all = [arm, plate, screw, kitLine, asmLine, subLine];
const RP = (line, over = {}) => readinessOf(line, { fields: hw, pushColumns: {}, customSchema: [], lists: LISTS, lines: all, sections: secs, ...over });
ok('a kit or an assembly owns the sheet that lists its parts', sheetOfLine(kitLine, secs).id === 'KS' && sheetOfLine(arm, secs) === null && sheetOfLine(kitLine, []) === null);
ok('its parts are the lines on that sheet — and the line of each sub-assembly sheet it takes', componentsOf(kitLine, { sections: secs, lines: all }).map(c => `${c.line.itemCode}×${c.qty}`).join() === 'H9-ARM×1,H9-PLT×1' && componentsOf(asmLine, { sections: secs, lines: all }).map(c => `${c.line.itemCode}×${c.qty}`).join() === 'H9-ARM×2,H9-PLT×1,H9-SCR×4,H9-SUB×1');
ok('a kit whose parts are all in the Library is ready', RP(kitLine).ok, JSON.stringify(RP(kitLine).blocks));
ok('an assembly with one part still on the sheet is told which', !RP(asmLine).ok && RP(asmLine).blocks.some(b => b.includes('1 of its parts is not in the Master Library yet') && b.includes('H9-SCR')));
const screwIn = { ...screw, status: 'PUSHED', pushedTo: { docId: 'CE-INV-C', code: 'H9-SCR' } };
const allIn = [arm, plate, screwIn, kitLine, asmLine, subLine];
ok('…and is ready once that part is in', RP(asmLine, { lines: allIn }).ok, JSON.stringify(RP(asmLine, { lines: allIn }).blocks));
const withQty = (q) => allIn.map(l => (l.id === 'C' ? { ...l, uses: { AS: { qty: q, balloon: '3' } } } : l));
ok('a parts list takes whole numbers of 1 or more — a half, a nought and a blank are refused', [0.5, 0, null, 2.5].every(q => RP(asmLine, { lines: withQty(q) }).blocks.some(b => b.includes('whole numbers') && b.includes('H9-SCR'))) && RP(asmLine, { lines: withQty(3) }).ok);
ok('a sheet with nothing on it is not a parts list', RP(kitLine, { lines: [kitLine] }).blocks.some(b => b.includes('lists no parts')));
ok('a line cannot be a part of itself', RP({ ...kitLine, uses: { KS: { qty: 1 } } }).blocks.some(b => b.includes('on its own sheet')));
ok('a kit is never a part of something else', RP(asmLine, { lines: allIn.map(l => (l.id === 'B' ? { ...l, recordClass: 'Kit' } : l)) }).blocks.some(b => b.includes('A kit cannot be a part of something else') && b.includes('H9-PLT')));
ok('a kit holds real items only — a fee in it is refused; in an assembly it is not', RP(kitLine, { lines: all.map(l => (l.id === 'B' ? { ...l, recordClass: 'Fee' } : l)) }).blocks.some(b => b.includes('real items only')) && !RP(asmLine, { lines: allIn.map(l => (l.id === 'B' ? { ...l, recordClass: 'Fee' } : l)) }).blocks.some(b => b.includes('real items only')));
ok('a sub-assembly sheet with no line of its own stops the assembly that takes it', RP(asmLine, { lines: allIn, sections: secs.map(x => (x.id === 'US' ? { ...x, itemLineId: '' } : x)) }).blocks.some(b => b.includes('Sub-assembly sheet with no line of its own: Sub')));
ok('an assembly is still asked for its category, handling and sourcing', RP({ ...asmLine, partHandling: '' }, { lines: allIn }).blocks.includes('Part handling is empty.'));

const ctxP = { project: proj, brandId: 'ce', fields: hw, pushColumns: {}, customSchema: [], user: 'Stuart', nowIso: 'T', sections: secs, lines: allIn };
const kitPlan = pushPlanOf(kitLine, { ...ctxP, id: libraryIdFor('ce', 'Kit', 7) });
ok('a kit is a Kit record with its contents, by library record — the shape the kit rule reads', kitPlan.record.id === 'CE-KIT-7' && kitPlan.record.partClass === 'Kit' && kitPlan.record.routingType === '' && JSON.stringify(kitPlan.record.manufacturingSpecs.kitComponents) === '[{"partId":"CE-INV-A","qty":1},{"partId":"CE-INV-B","qty":1}]' && kitPlan.record.manufacturingSpecs.kitAlign === undefined);
ok('…which the app\'s own kit rule takes as an item kit', isItemKit(kitPlan.record) && kitComponentsOf(kitPlan.record).map(c => `${c.partId}×${c.per}`).join() === 'CE-INV-A×1,CE-INV-B×1');
ok('…with its price and collection like any item, and no parts-list lines of its own', kitPlan.record.manufacturingSpecs.basePrice === 60 && kitPlan.record.manufacturingSpecs.collections.join() === 'H3 CONTOURS' && kitPlan.pins.length === 0 && kitPlan.parts.map(c => `${c.code}×${c.qty}`).join() === 'H9-ARM×1,H9-PLT×1');
const asmPlan = pushPlanOf(asmLine, { ...ctxP, id: libraryIdFor('ce', 'Assembly', 8) });
ok('an assembly is an Assembly record — not the mainline a flow is built from', asmPlan.record.id === 'CE-ASM-8' && asmPlan.record.partClass === 'Assembly' && asmPlan.record.routingType === '' && asmPlan.record.recordType === undefined && asmPlan.record.approvals === undefined && asmPlan.record.manufacturingSpecs.kitComponents === undefined);
ok('…with one parts-list line per part, findable again', asmPlan.pins.map(p => `${p.id}|${p.legacyErpId}×${p.defaultQty}`).join(' ') === 'PIN-CE-ASM-8-CS-CE-INV-A|H9-ARM×2 PIN-CE-ASM-8-CS-CE-INV-B|H9-PLT×1 PIN-CE-ASM-8-CS-CE-INV-C|H9-SCR×4 PIN-CE-ASM-8-CS-CE-INV-U|H9-SUB×1' && sheetPinId('X', 'Y') === 'PIN-X-CS-Y');
const pin0 = asmPlan.pins[0];
ok('…each in the linked shape the parts-list readers resolve a part by, and marked as the sheet\'s', pin0.assemblyId === 'CE-ASM-8' && pin0.partId === 'CE-INV-A' && pin0.isExistingLibraryPart === true && pin0.status === 'SPECS_LOCKED' && pin0.fromControlSheet === true && pin0.controlSheet.lineId === 'S' && pin0.controlSheet.sectionId === 'AS' && pin0.author === 'Stuart' && usablePin(pin0));
// what a work order would pull for 10 of the assembly, from the lines the sheet wrote
const libraryNow = [{ id: 'CE-INV-A', legacyErpId: 'H9-ARM' }, { id: 'CE-INV-B', legacyErpId: 'H9-PLT' }, { id: 'CE-INV-C', legacyErpId: 'H9-SCR' }, { id: 'CE-INV-U', legacyErpId: 'H9-SUB' }, { ...asmPlan.record }];
const run = planFinishedRun({ part: asmPlan.record, qty: 10, pins: asmPlan.pins, inventory: libraryNow });
const pulled = run.lines.map(r => `${r.legacyErpId}×${r.quantity}`).sort().join();
ok('a work order for 10 pulls exactly the sheet\'s parts × 10', run.exploded && pulled === 'H9-ARM×20,H9-PLT×10,H9-SCR×40,H9-SUB×10', pulled);
// …and why the lines must step aside: NetSuite's own lines beside the sheet's would double it
const nsPins = [{ id: 'PIN-CE-ASM-8-501', assemblyId: 'CE-ASM-8', partId: 'H9-ARM', defaultQty: 2, syncedFromErp: true }, { id: 'PIN-CE-ASM-8-502', assemblyId: 'CE-ASM-8', partId: 'H9-PLT', defaultQty: 1, syncedFromErp: true }];
const doubled = planFinishedRun({ part: asmPlan.record, qty: 10, pins: [...asmPlan.pins, ...nsPins], inventory: libraryNow }).lines.find(r => r.legacyErpId === 'H9-ARM').quantity;
ok('left beside NetSuite\'s own lines the sheet\'s would double the pull (the reason for the rule)', doubled === 40);
const afterSync = [...asmPlan.pins, ...nsPins].filter(p => !yieldsToNetSuiteBom(p));
ok('so a sheet line steps aside when NetSuite sends the parts list — and only a sheet line', asmPlan.pins.every(yieldsToNetSuiteBom) && !nsPins.some(yieldsToNetSuiteBom) && !yieldsToNetSuiteBom({ id: 'hand', assemblyId: 'CE-ASM-8', partId: 'X' }) && !yieldsToNetSuiteBom(null) && planFinishedRun({ part: asmPlan.record, qty: 10, pins: afterSync, inventory: libraryNow }).lines.find(r => r.legacyErpId === 'H9-ARM').quantity === 20);
ok('a part line carries no parts', pushPlanOf(finial, { ...ctxP, id: 'X', lines: [finial] }).pins.length === 0 && pushPlanOf(finial, { ...ctxP, id: 'X', lines: [finial] }).parts.length === 0);
ok('the line of a parts list remembers where it came from', JSON.stringify(sheetPinFor({ assemblyId: 'A1', component: { docId: 'P1', code: 'x-1', name: 'n' }, qty: 3, origin: { projectId: 'pr', sectionId: 'se', lineId: 'li' }, user: 'u', nowIso: 't' }).controlSheet) === '{"projectId":"pr","sectionId":"se","lineId":"li"}');

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
