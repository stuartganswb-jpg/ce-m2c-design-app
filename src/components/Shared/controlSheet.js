// Shared/controlSheet.js — the rules of tab 1.2, Control Sheets. Pure: no React, no Firestore.
//
// THE WORKING / HOLDING SHEET (Stuart 2026-10-07: "create a tab/page in the app that replaces the excel
// spreadsheet … a true working center where we store all our work until its ready to push into the app as
// final/approved"). A project named in tab 1 has ONE control sheet here; the sheet holds LINES (a part,
// entered once) and SHEETS (an assembly: which lines it uses, how many of each, the balloon number on its
// drawing). Nothing in the app reads this store — an item exists for CPQ, Order Entry, the floors, WMS and
// NetSuite only once its line is pushed into the Master Library (the last section of this file).
//
// What lives here: the ONE table of fields the grid is drawn from, the cost arithmetic of the Excel sheets
// (landed cost each, cost per assembly, sub-assemblies rolled into their parent), which project names tab 1
// offers, and the plan for importing a prepared workbook file (scripts/controlSheetBundle.py).
//
// The 1.6 tags are HELD here, never applied (Stuart 2026-10-07: "the sheet can just hold the placement tags,
// we can put them in actual place on the upload at 1.6") — so their choices are 1.6's own lists, imported,
// and a value held on a line reads exactly as the control the designer will tick.

import { TAG_CATEGORIES, TAG_POSITIONS, TAG_LOCATIONS, END_TREATMENTS } from './assemblyTags.js';
import { TRAVERSE_ROLES, DRIVE_TYPES, TRV_SETUPS, FRONT_LAYERS } from './traverseTags.js';
import { SOURCING, SOURCING_LABEL, sourcingPatch } from './sourcing.js';
import { canonicalCollection } from './collectionName.js';
import { sheetPinFor } from './sheetPins.js';

export const BUNDLE_FORMAT = 'control-sheet-bundle/1';
export const SHEET_KINDS = ['LIGHTING', 'HARDWARE'];
// PUSHED is not in this list on purpose: only the push writes it, never the status box.
export const LINE_STATUSES = ['DRAFT', 'SOURCING', 'SAMPLED', 'READY'];
export const PUSHED = 'PUSHED';
// The Master Library's record classes a LINE can become. "Master Assembly" is the product itself — the tab-1
// record — and is never a line.
export const RECORD_CLASSES = ['Inventory', 'Assembly', 'Kit', 'Fee', 'Non-Inventory'];
export const SECTION_KINDS = ['ASSEMBLY', 'PRODUCT'];

const str = (v) => (v === null || v === undefined ? '' : String(v));
export const numOf = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[$,\s]/g, ''));
    return Number.isFinite(n) ? n : null;
};

// ── THE FIELDS ──────────────────────────────────────────────────────────────────────────────────────────
// One table. The grid's columns, the cell editors, the import, the download and the push ticks all read it,
// so a field is added in one place. `key` is the path on the line document ('tags.category' sits under the
// line's tags).
//   type   text | long | url | num | money | pct | bool | pick (fixed choices) | list (a 4.5 dictionary list,
//          named by `list`; a value not on the list is kept and shown) | picture | quotes |
//          usd (worked out from Price × rate once an origin price is entered; typed until then) |
//          landed (worked out)
//   kinds  which sheets show it; absent = both
//   lib    WHERE THE COLUMN GOES IN THE MASTER LIBRARY: the path on the library record and the Library's own
//          name for the field. A column with no `lib` has no field there (Stuart 2026-10-07: "if we tick one
//          that does not exist add a prompt that the library has no associated field, set that up prior to
//          import") — see libraryTargetOf: a custom attribute added in 4.5 under the column's name becomes it.
//   always pushed whenever the line is: the three facts that make a library record a record.
// `sheetOnly: true` on a group: never pushed and never offered the tick — the 1.6 tags ("the sheet can just
// hold the placement tags") and the milling facts ("keep them on the sheet till we finish that tab").
const f = (key, label, type = 'text', extra = {}) => ({ key, label, type, width: 120, ...extra });
const HW = { kinds: ['HARDWARE'] };
const lib = (path, label) => ({ lib: { path, label } });
const spec = (name, label) => lib(`manufacturingSpecs.${name}`, label);
const cust = (name, label) => lib(`manufacturingSpecs.customData.${name}`, label);

// The currencies a vendor quotes in (Stuart 2026-10-07: "euro's and chinese rmb (yuan)"). Shared/fxRates
// turns each into the code the rate table knows.
export const CURRENCIES = ['USD', 'RMB', 'EUR'];
// The Library's three-way sourcing, by the words its own buttons carry (Shared/sourcing.SOURCING_LABEL).
export const SOURCING_CHOICES = [SOURCING_LABEL.IN, SOURCING_LABEL.OUT, SOURCING_LABEL.BOTH];
// A line written before the three-way column carried a plain in-house tick; it still reads.
const sourcingOfLine = (line) => str(line && line.sourcing) || (line && line.isInHouse === true ? SOURCING_LABEL.IN : line && line.isInHouse === false ? SOURCING_LABEL.OUT : '');

export const FIELD_GROUPS = [
    { key: 'IDENTITY', label: 'Identity', always: true, fields: [
        f('pictureUrl', 'Picture', 'picture', { width: 64, ...lib('finalImageUrl', 'Picture') }),
        f('itemCode', 'Item #', 'text', { width: 130, mono: true, always: true, ...lib('legacyErpId', 'ERP Legacy ID') }),
        f('name', 'Description', 'long', { width: 280, always: true, ...lib('itemName', 'Record Name / Description') }),
        f('recordClass', 'Class', 'pick', { options: RECORD_CLASSES, width: 118, always: true, ...lib('partClass', 'Record Class') }),
    ] },
    { key: 'DESIGN', label: 'Design', fields: [
        f('size', 'Size / dimensions', 'long', { width: 220 }),
        f('material', 'Material', 'list', { list: 'materials', width: 130, ...spec('material', 'Raw Mat') }),
        f('color', 'Colour / finish', 'text'),
        f('weight', 'Weight', 'text', { width: 80, ...spec('weight', 'Weight (lbs)') }),
        f('screws', 'Screws / hardware', 'long', { width: 220, ...HW }),
        f('itemNotes', 'Item notes', 'long', { width: 220, ...HW }),
        f('changes', 'Changes', 'long', { width: 220, ...HW }),
        f('cad', 'CAD', 'text', { width: 170, ...HW }),
        f('cam', 'CAM', 'text', { width: 80, ...HW }),
        f('programNum', 'Program #', 'text', { width: 100, mono: true, ...HW, ...spec('programNum', 'Program #') }),
    ] },
    { key: 'SOURCING', label: 'Sourcing & cost', fields: [
        f('vendor', 'Vendor', 'text', { width: 140, datalist: 'vendors', ...spec('vendorName', 'Vendor Name') }),
        f('vendorSku', 'Vendor part #', 'text', { width: 140, mono: true, ...spec('vendorId', 'Vendor Part # / SKU') }),
        f('vendorUrl', 'Link', 'url', { width: 150, ...spec('vendorUrl', 'Purchase Link (URL)') }),
        f('altVendorUrl', 'Alt link', 'url', { width: 150, ...spec('altVendorUrl', 'Alt Item Link (URL)') }),
        f('origin', 'Origin', 'text', { width: 110 }),
        f('quotes', 'Quotes', 'quotes', { width: 170 }),
        f('priceOrigin', 'Price', 'money', { width: 90 }),
        f('currency', 'Currency', 'pick', { options: CURRENCIES, width: 90 }),
        f('priceUsd', 'USD', 'usd', { width: 92 }),
        f('dutyPct', 'Duty / ship', 'pct', { width: 84 }),
        f('landed', 'Landed each', 'landed', { width: 96, ...spec('cost', 'Base Cost ($)') }),
        f('moq', 'MOQ', 'text', { width: 80, ...spec('moq', 'MOQ') }),
        f('orderQty', 'Order qty', 'text', { width: 84 }),
        f('leadTime', 'Lead time', 'text', { width: 90, ...spec('leadTime', 'Lead (Days)') }),
        f('sourcingStatus', 'Vendor status', 'text', { width: 130 }),
    ] },
    { key: 'MAKE', label: 'Milling (sheet only)', sheetOnly: true, ...HW, fields: [
        f('rawStock', 'Raw stock material', 'long', { width: 240 }),
        f('materialCode', 'Material item #', 'text', { width: 130, mono: true }),
        f('amountPer', 'Amount / ea (ft)', 'num', { width: 110 }),
        f('runTimeMin', 'Run time (min)', 'num', { width: 104 }),
        f('prodBin', 'Prod. bin', 'text', { width: 96, mono: true }),
        f('oldItemCode', 'Old item #', 'text', { width: 140, mono: true }),
    ] },
    { key: 'PRICING', label: 'Pricing', fields: [
        f('rollUpCost', 'Roll-up cost', 'long', { width: 200 }),
        f('basePrice', 'Base price', 'money', { width: 96, ...spec('basePrice', 'Base Price ($)') }),
        f('paintedPrice', 'Painted', 'money', { width: 84, ...HW }),
        f('platedPrice', 'Plated', 'money', { width: 84, ...HW }),
    ] },
    // EVERY FIELD THE MASTER LIBRARY'S DRAWER CARRIES AS A SINGLE VALUE (Stuart 2026-10-07: "make columns for
    // all library existing fields"). What is not a single value stays the Library's own to enter: client
    // pricing (4.6), twins, alias, kit contents, cross-brand sharing, the print, the model file, and the
    // pillow fields (no sheet of that kind exists). The custom attributes 4.5 defines are added to this group
    // by sheetGroupsFor.
    { key: 'LIBRARY', label: 'Library fields', fields: [
        f('collection', 'Collection', 'list', { list: 'collections', width: 150, ...spec('collections', 'Collections') }),
        f('productType', 'Category', 'list', { list: 'prodTypes', width: 140, ...spec('productType', 'Prod Type') }),
        f('routingType', 'Routing / inv. type', 'list', { list: 'routingTypes', width: 150, ...lib('routingType', 'Routing Classification / Inventory Category') }),
        f('uom', 'UOM', 'list', { list: 'uom', width: 76, ...spec('uom', 'UOM') }),
        f('partHandling', 'Part handling', 'list', { list: 'partHandling', width: 124, ...spec('partHandling', 'Part Handling') }),
        f('finishStream', 'Finish stream', 'pick', { options: ['POLES', 'SMALL'], width: 110, ...spec('finishStream', 'Finish Stream') }),
        f('paintSize', 'Paint size', 'pick', { options: ['S', 'M', 'L'], width: 86, ...spec('paintSize', 'Paint Size') }),
        f('watchList', 'Watchlist', 'list', { list: 'watchLists', width: 120, ...spec('watchList', 'Watchlist') }),
        f('sourcing', 'Sourcing', 'pick', { options: SOURCING_CHOICES, width: 110, read: sourcingOfLine, ...spec('sourcingMode', 'In-House / Outsourced / Both') }),
        f('outsourceAction', 'Outsource action', 'list', { list: 'outsourceActions', width: 140, ...spec('outsourceAction', 'Outsource Action') }),
        f('isStocked', 'Stocked', 'bool', { width: 72, ...spec('isStocked', 'Stocked finished assembly') }),
        f('binLocation', 'Bin', 'list', { list: 'bins', width: 110, ...spec('binLocation', 'Warehouse Bin Location') }),
        f('reorderPoint', 'Reorder pt', 'num', { width: 90, ...spec('reorderPoint', 'Reorder Pt (ROP)') }),
        f('bomRevision', 'BOM revision', 'text', { width: 100, ...spec('bomRevision', 'BOM Revision') }),
        f('shopInstruction', 'Shop instruction', 'long', { width: 240, ...spec('shopInstruction', 'Shop Instruction') }),
        f('unfinished', 'Unfinished', 'bool', { width: 86, ...cust('unfinished', 'Unfinished — never takes a finish') }),
        f('customOverrideFee', 'Custom override fee', 'bool', { width: 130, ...spec('customOverrideFee', 'Custom Override Fee') }),
        f('feeType', 'Fee type', 'list', { list: 'feeTypes', width: 130, ...cust('feeType', 'Service / Fee Type') }),
        f('trackLoaded', 'On the track', 'bool', { width: 92, ...HW, ...cust('trackLoaded', 'Loaded onto the track — traverse station') }),
        f('projection', 'Projection', 'list', { list: 'projections', width: 104, ...HW, ...cust('projection', 'Bracket Projection (Inches)') }),
        f('bracketType', 'Mount type', 'list', { list: 'bracketMounts', width: 130, ...HW, ...cust('bracketType', 'Bracket Mount Type') }),
        f('isReturnBracket', 'Return bracket', 'bool', { width: 108, ...HW, ...cust('isReturnBracket', 'Is Return Bracket') }),
        f('armThickness', 'Arm thickness', 'num', { width: 104, ...HW, ...cust('armThickness', 'Bracket Arm Thickness (in)') }),
        f('bpOrientation', 'Plate orientation', 'pick', { options: ['HORIZONTAL', 'VERTICAL', 'SQUARE', 'ROUND'], width: 140, ...HW, ...cust('bpOrientation', 'Backplate Orientation') }),
        f('bpLength', 'Plate L', 'num', { width: 74, ...HW, ...spec('parametric.length', 'Backplate Length') }),
        f('bpWidth', 'Plate W', 'num', { width: 74, ...HW, ...spec('parametric.width', 'Backplate Width') }),
        f('bpHeight', 'Plate H', 'num', { width: 74, ...HW, ...spec('parametric.height', 'Backplate Height') }),
        // The ids of Shared/plateRules.PLATE_ROLES (that module cannot be read from the harness).
        f('plateRole', 'Plate pricing role', 'pick', { options: ['INCLUDED', 'UPGRADE'], width: 140, ...HW, ...spec('plateRole', 'Plate Pricing Role') }),
        f('plateUpgradeOf', 'Upgrade over (plate #)', 'text', { width: 150, mono: true, ...HW, ...spec('plateUpgradeOf', 'Upgrade Over (Backplate #)') }),
        f('plateUpcharge', 'Upcharge $', 'money', { width: 90, ...HW, ...spec('plateUpcharge', 'Upcharge $') }),
        f('plateUpchargePremium', 'Premium upcharge $', 'money', { width: 130, ...HW, ...spec('plateUpchargePremium', 'Premium Upcharge $') }),
        f('wallMountPart', 'Wall mount part #', 'text', { width: 130, mono: true, ...HW, ...spec('wallMount.partId', 'Wall Mount Part #') }),
        f('wallMountDesc', 'Wall mount description', 'long', { width: 200, ...HW, ...spec('wallMount.desc', 'Wall Mount Description') }),
        f('isCutToSize', 'Cut to size', 'bool', { width: 84, ...HW, ...spec('parametric.isCutToSize', 'Cut To Size') }),
        f('layeringSequence', 'Render layer', 'num', { width: 96, ...HW, ...spec('layeringSequence', 'Z-Index / Render Layer') }),
    ] },
    { key: 'TAGS', label: '1.6 tags (held)', sheetOnly: true, ...HW, fields: [
        f('tags.category', 'Category', 'pick', { options: TAG_CATEGORIES, width: 116 }),
        f('tags.position', 'Position', 'pick', { options: TAG_POSITIONS, width: 104 }),
        f('tags.location', 'Location', 'pick', { options: TAG_LOCATIONS, width: 104 }),
        f('tags.endTreatment', 'End treatment', 'pick', { options: END_TREATMENTS, width: 150 }),
        f('tags.projInches', 'Projections', 'text', { width: 130 }),
        f('tags.materials', 'Materials', 'text', { width: 130 }),
        f('tags.mountType', 'Mount', 'list', { list: 'bracketMounts', width: 130 }),
        f('tags.isBasic', 'Basic', 'bool', { width: 64 }),
        f('tags.noBackplate', 'No plate', 'bool', { width: 78 }),
        f('tags.usesReturnPlates', 'Inline bracket', 'bool', { width: 104 }),
        f('tags.returnOnly', 'Return-only', 'bool', { width: 96 }),
        f('tags.inlineOnly', 'Inline plate', 'bool', { width: 92 }),
        f('tags.isReturnArm', 'Return arm', 'bool', { width: 90 }),
        f('tags.passing', 'Passing', 'pick', { options: ['STANDARD', 'PASSING'], width: 108 }),
        f('tags.tier', 'Rod', 'pick', { options: ['FRONT', 'BACK'], width: 86 }),
        f('tags.traverseRole', 'Traverse role', 'pick', { options: TRAVERSE_ROLES, width: 140 }),
        f('tags.driveType', 'Drive', 'pick', { options: DRIVE_TYPES, width: 116 }),
        f('tags.trvSetup', 'Setup', 'pick', { options: TRV_SETUPS, width: 96 }),
        f('tags.frontLayer', 'Front of a double', 'pick', { options: FRONT_LAYERS, width: 130 }),
        f('tags.alwaysShown', 'Always shown', 'bool', { width: 104 }),
        f('tags.isCollar', 'Collar', 'bool', { width: 68 }),
        f('tags.requiresCollar', 'Pairs with collar', 'text', { width: 130, mono: true }),
        f('tags.isFee', 'Fee', 'bool', { width: 56 }),
        f('tags.isHidden', 'Hidden', 'bool', { width: 68 }),
        f('tags.ridesWith', 'Rides with', 'pick', { options: ['RETURN', 'BRACKET'], width: 104 }),
        f('tags.note', 'Tag note', 'long', { width: 220 }),
    ] },
    { key: 'NOTES', label: 'Notes', fields: [
        f('notes', 'Notes', 'long', { width: 320 }),
    ] },
];

export const ALL_FIELDS = FIELD_GROUPS.flatMap(g => g.fields.map(x => ({ ...x, group: g.key, ...(g.sheetOnly ? { sheetOnly: true } : {}) })));
export const fieldByKey = (key) => ALL_FIELDS.find(x => x.key === key) || null;

const showsFor = (thing, kind) => !thing.kinds || !kind || thing.kinds.includes(kind);
// The groups a sheet of this kind offers, each with only the fields that kind shows.
export const groupsFor = (kind) => FIELD_GROUPS
    .filter(g => showsFor(g, kind))
    .map(g => ({ ...g, fields: g.fields.filter(x => showsFor(x, kind)).map(x => ({ ...x, group: g.key, ...(g.sheetOnly ? { sheetOnly: true } : {}) })) }));
// What opens ticked: the sheet as Excel showed it — costing for a light, pricing for hardware.
export const defaultGroupsFor = (kind) => (kind === 'HARDWARE' ? ['DESIGN', 'SOURCING', 'PRICING'] : ['DESIGN', 'SOURCING']);

// ── THE LIBRARY'S OWN CUSTOM ATTRIBUTES, AND WHERE A COLUMN GOES ───────────────────────────────────────
// 4.5 → Static Part Attributes → Add Attribute defines extra fields on every library record
// (system/master_schema.inventoryFields: { key, label, type, options }; stored at customData.<key>). Two things
// follow here. A sheet column with no field of its own TAKES one the moment an attribute is added under its
// name — that is how a column the Library "has no associated field" for is set up before the push. And an
// attribute no column answers to is a column of its own, in the Library group.
const nameKey = (s) => str(s).toLowerCase().replace(/[^a-z0-9]+/g, '');
const attributesOf = (customSchema) => (Array.isArray(customSchema) ? customSchema : [])
    .filter(a => a && /^[A-Za-z0-9_]+$/.test(str(a.key)) && str(a.label).trim() && str(a.type) !== 'file');
const attributeFor = (field, customSchema) => attributesOf(customSchema)
    .find(a => nameKey(a.label) === nameKey(field.label) || nameKey(a.key) === nameKey(field.key)) || null;

// { path, label, custom } — the Library field this column is pushed into — or null: the Library has none.
export function libraryTargetOf(field, customSchema) {
    if (!field || field.sheetOnly) return null;
    if (field.lib) return { ...field.lib, custom: false };
    const attr = attributeFor(field, customSchema);
    return attr ? { path: `manufacturingSpecs.customData.${attr.key}`, label: `${str(attr.label).trim()} (Custom)`, custom: true } : null;
}

// groupsFor, plus the custom attributes that answer to no column as columns of the Library group.
export function sheetGroupsFor(kind, customSchema) {
    const groups = groupsFor(kind);
    const taken = groups.flatMap(g => g.fields);
    const extra = attributesOf(customSchema)
        .filter(a => !taken.some(x => nameKey(a.label) === nameKey(x.label) || nameKey(a.key) === nameKey(x.key)))
        .map(a => f(`custom.${a.key}`, str(a.label).trim(), a.type === 'dropdown' ? 'pick' : a.type === 'number' ? 'num' : 'text', {
            width: 140, group: 'LIBRARY', custom: true,
            ...(a.type === 'dropdown' ? { options: str(a.options).split(',').map(o => o.trim()).filter(Boolean) } : {}),
            ...lib(`manufacturingSpecs.customData.${a.key}`, `${str(a.label).trim()} (Custom)`),
        }));
    return groups.map(g => (g.key === 'LIBRARY' ? { ...g, fields: [...g.fields, ...extra] } : g));
}

// THE "PUSH TO LIBRARY" TICK ON A COLUMN (Stuart 2026-10-07: "some of these columns are only necessary for
// working details in the beginning and some are intended to go into the final library items").
//   offered  the column carries the tick at all (never the 1.6 tags, never milling)
//   locked   always pushed — item #, description, class
//   on       ticked: the sheet's own choice when it has made one, else on for a column the Library has a field for
//   target   the Library field it goes to, or null
//   missing  ticked, and the Library has no field for it yet — to be set up before the push
// The tick is a CHOICE held on the sheet (project.pushColumns); nothing is pushed by it.
export function pushStateOf(field, pushColumns, customSchema) {
    const offered = !!field && !field.sheetOnly;
    if (!offered) return { offered: false, locked: false, on: false, target: null, missing: false };
    const target = libraryTargetOf(field, customSchema);
    if (field.always) return { offered: true, locked: true, on: true, target, missing: false };
    const chosen = valueAt(pushColumns || {}, field.key);
    const on = typeof chosen === 'boolean' ? chosen : !!target;
    return { offered: true, locked: false, on, target, missing: on && !target };
}

// What to tell someone who ticks a column the Library has nowhere to put.
export const noLibraryFieldText = (field) => `The Master Library has no field for "${field.label}".\n\nSet it up before the push: 4.5 Mass Update → Static Part Attributes → Add Attribute, and name it "${field.label}". The column takes that field by itself once it exists.\n\nUntil then the tick is kept and marked ⚠ — the column is wanted in the Library but has nowhere to go.`;

// ── READING AND WRITING A CELL ──────────────────────────────────────────────────────────────────────────
export const valueAt = (line, key) => {
    if (!line) return undefined;
    let v = line;
    for (const part of String(key).split('.')) { if (v === null || v === undefined) return undefined; v = v[part]; }
    return v;
};
// What a line holds for a field — by its path, or by the field's own reader where an older shape still reads.
export const cellRawOf = (field, line) => (field && typeof field.read === 'function' ? field.read(line) : valueAt(line, field && field.key));

// What the operator typed → what is stored. An emptied number is null (never '' — a blank is not a price).
// A percentage is typed as a percentage ("20") and stored as the fraction the Excel sheets carry (0.2).
export function cellValueOf(field, raw) {
    const type = field && field.type;
    if (type === 'bool') return raw === true || raw === 'true';
    if (type === 'num' || type === 'money' || type === 'usd') return numOf(raw);
    if (type === 'pct') { const n = numOf(str(raw).replace('%', '')); return n === null ? null : Math.round(n * 1e6) / 1e8; }
    return str(raw).trim();
}

const trim = (n, places) => String(Math.round(n * 10 ** places) / 10 ** places);
// What a stored value reads as in its box.
export function cellTextOf(field, value) {
    const type = field && field.type;
    if (value === null || value === undefined) return '';
    if (type === 'pct') { const n = numOf(value); return n === null ? '' : trim(n * 100, 4); }
    if (type === 'num' || type === 'money' || type === 'usd') { const n = numOf(value); return n === null ? '' : trim(n, 6); }
    return str(value);
}

export const moneyText = (n, places = 2) => (n === null || n === undefined || !Number.isFinite(n) ? '' : `$${n.toLocaleString('en-US', { minimumFractionDigits: places, maximumFractionDigits: places })}`);

// ── THE ARITHMETIC OF THE SHEET ─────────────────────────────────────────────────────────────────────────
// Exactly the Excel columns: Total cost each = USD × (1 + Dty/Shipping); Cost per assembly = that × qty per
// light; a product's sheet adds each sub-assembly's own total × how many it takes. Checked against the three
// workbooks' own totals in scripts/controlSheet.test.mjs.
export const landedEachOf = (line) => {
    const usd = numOf(line && line.priceUsd);
    if (usd === null) return null;
    return usd * (1 + (numOf(line.dutyPct) || 0));
};

export const placeOf = (line, sectionId) => (line && line.uses && sectionId && line.uses[sectionId]) || null;
export const linesOn = (lines, sectionId) => (lines || []).filter(l => !!placeOf(l, sectionId));

export const lineCostIn = (line, sectionId) => {
    const use = placeOf(line, sectionId);
    const each = landedEachOf(line);
    const qty = numOf(use && use.qty);
    return use && each !== null && qty !== null ? each * qty : null;
};

// { total, unpriced, parts, children: [{ section, name, qty, each, cost }] }
// `unpriced` counts what the total could NOT include — a line with no USD or no quantity, a sub-assembly that
// has gone — so a total is never read as complete when it is not.
export function sectionTotalOf(sectionId, sections, lines, seen = []) {
    const section = (sections || []).find(s => s.id === sectionId);
    const out = { total: 0, unpriced: 0, parts: 0, children: [] };
    if (!section) return out;
    for (const line of linesOn(lines, sectionId)) {
        out.parts += 1;
        const cost = lineCostIn(line, sectionId);
        if (cost === null) out.unpriced += 1; else out.total += cost;
    }
    for (const child of (section.children || [])) {
        const sub = (sections || []).find(s => s.id === child.section);
        const qty = numOf(child.qty);
        if (!sub || qty === null || seen.includes(child.section) || child.section === sectionId) {
            out.unpriced += 1;
            out.children.push({ section: child.section, name: sub ? sub.name : '(sheet removed)', qty, each: null, cost: null });
            continue;
        }
        const inner = sectionTotalOf(child.section, sections, lines, [...seen, sectionId]);
        out.unpriced += inner.unpriced;
        out.total += inner.total * qty;
        out.children.push({ section: child.section, name: sub.name, qty, each: inner.total, cost: inner.total * qty });
    }
    return out;
}

// The sheets that may be added to this one as a sub-assembly: not itself, not already on it, and not a
// sheet that (directly or through others) already contains this one.
export function childChoicesFor(sectionId, sections) {
    const list = sections || [];
    const contains = (holderId, targetId, seen = []) => {
        const holder = list.find(s => s.id === holderId);
        if (!holder || seen.includes(holderId)) return false;
        return (holder.children || []).some(c => c.section === targetId || contains(c.section, targetId, [...seen, holderId]));
    };
    const mine = list.find(s => s.id === sectionId);
    const already = new Set(((mine && mine.children) || []).map(c => c.section));
    return list.filter(s => s.id !== sectionId && !already.has(s.id) && !contains(s.id, sectionId));
}

// How many of this part the whole project takes, across every sheet it sits on (a sub-assembly used twice
// by its parent is NOT multiplied here — this is the count of its own rows).
export const usesListOf = (line, sections) => Object.keys((line && line.uses) || {})
    .map(id => ({ id, section: (sections || []).find(s => s.id === id), use: line.uses[id] }))
    .filter(u => !!u.section);

export const lineLabelOf = (line) => str(line && (line.itemCode || line.vendorSku || line.name)).trim() || '(unnamed line)';

export const quoteTextOf = (q) => {
    if (!q) return '';
    const price = numOf(q.price);
    return [str(q.label).trim(), price === null ? '' : `${str(q.currency).trim()} ${trim(price, 4)}`.trim(), str(q.qty).trim() ? `@ ${str(q.qty).trim()}` : ''].filter(Boolean).join(' ');
};

export const matchesSearch = (line, term) => {
    const t = str(term).trim().toLowerCase();
    if (!t) return true;
    return [line.itemCode, line.name, line.vendorSku, line.vendor, line.material, line.notes].some(v => str(v).toLowerCase().includes(t));
};

export const sortLines = (lines) => [...(lines || [])].sort((a, b) => (numOf(a.order) ?? 0) - (numOf(b.order) ?? 0) || str(a.id).localeCompare(str(b.id)));
// Balloon order on a sheet: "9, 16" sorts by its first number; a line with no balloon keeps its own place after.
export const sortOnSection = (lines, sectionId) => {
    const first = (l) => { const m = str(placeOf(l, sectionId) && placeOf(l, sectionId).balloon).match(/\d+(\.\d+)?/); return m ? parseFloat(m[0]) : Infinity; };
    return sortLines(lines).sort((a, b) => first(a) - first(b));
};
export const nextOrder = (lines) => (lines || []).reduce((m, l) => Math.max(m, numOf(l.order) ?? 0), 0) + 10;

// ── WHICH PROJECT ───────────────────────────────────────────────────────────────────────────────────────
// "tab 1 should just name a project, the project is the sheet name on the new tab" (Stuart 2026-10-07).
// Tab 1 has no project record — a project is a NAME: the Master Project a design is filed under, or a design
// whose record type is PROJECT. The name, upper-cased and single-spaced, is the key both tabs agree on.
export const projectNameKey = (name) => str(name).trim().toUpperCase().replace(/\s+/g, ' ');
export const projectIdOf = (brandId, name) => `${str(brandId).trim().toLowerCase()}__${projectNameKey(name).replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')}`;

const is3dUrl = (url) => /\.(glb|gltf)/i.test(str(url));

// [{ name, key, records, pictures: [{ url, label, recordId }] }] — every project tab 1 names, with the 2D
// pictures filed under it (a design's current image and its 2D revisions; a .glb is not a picture).
export function tab1ProjectsOf(records) {
    const byKey = new Map();
    const bucket = (name) => {
        const key = projectNameKey(name);
        if (!key) return null;
        if (!byKey.has(key)) byKey.set(key, { name: key, key, records: [], pictures: [] });
        return byKey.get(key);
    };
    for (const rec of (records || [])) {
        const group = str(rec.project).trim();
        const own = str(rec.recordType).toUpperCase() === 'PROJECT' ? str(rec.itemName).trim() : '';
        const proj = bucket(group || own);
        if (!proj) continue;
        proj.records.push(rec);
        const seen = new Set(proj.pictures.map(p => p.url));
        const add = (url, label) => {
            if (!url || is3dUrl(url) || seen.has(url)) return;
            seen.add(url);
            proj.pictures.push({ url, label: [str(rec.itemName).trim(), label].filter(Boolean).join(' · '), recordId: rec.id });
        };
        add(rec.finalImageUrl, 'current');
        for (const rev of (rec.revisions || [])) { if (rev && !rev.is3D) add(rev.url, str(rev.name).trim()); }
    }
    return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// ── A NEW LINE, A NEW SHEET ─────────────────────────────────────────────────────────────────────────────
export const blankLine = ({ id, projectId, brandId, order, user, nowIso }) => ({
    id, projectId, brandId, order, status: 'DRAFT',
    itemCode: '', name: '', recordClass: '', pictureUrl: '', quotes: [], uses: {}, tags: {},
    priceUsd: null, dutyPct: null, notes: '',
    createdAt: nowIso, createdBy: user || '', updatedAt: nowIso, updatedBy: user || '',
});

export const blankProject = ({ brandId, name, kind, user, nowIso }) => ({
    id: projectIdOf(brandId, name), brandId, name: projectNameKey(name),
    kind: SHEET_KINDS.includes(kind) ? kind : 'HARDWARE', sections: [],
    createdAt: nowIso, createdBy: user || '', updatedAt: nowIso, updatedBy: user || '',
});

// ── IMPORTING A PREPARED WORKBOOK FILE ──────────────────────────────────────────────────────────────────
// The database refuses anything that is not the signed-in app, so a workbook is prepared on the desk
// (scripts/controlSheetBundle.py → one .control-sheet.json, pictures inside) and written by the tab's
// IMPORT button. readBundle says whether a file is one of ours; planImport says exactly what would be
// written, before anything is.
export function readBundle(obj) {
    const errors = [];
    if (!obj || typeof obj !== 'object') return { ok: false, errors: ['This is not a control-sheet file.'], summary: null };
    if (obj.format !== BUNDLE_FORMAT) errors.push(`This file says "${str(obj.format) || 'no format'}" — the tab reads "${BUNDLE_FORMAT}".`);
    const project = obj.project || {};
    if (!projectNameKey(project.name)) errors.push('The file names no project.');
    if (!Array.isArray(obj.lines) || !obj.lines.length) errors.push('The file carries no lines.');
    const sections = Array.isArray(obj.sections) ? obj.sections : [];
    const images = obj.images && typeof obj.images === 'object' ? obj.images : {};
    const keys = new Set(sections.map(s => s.key));
    for (const line of (Array.isArray(obj.lines) ? obj.lines : [])) {
        for (const k of Object.keys(line.uses || {})) if (!keys.has(k)) errors.push(`Line "${lineLabelOf(line)}" sits on a sheet (${k}) the file does not carry.`);
        if (line.picture && !images[line.picture]) errors.push(`Line "${lineLabelOf(line)}" names a picture (${line.picture}) the file does not carry.`);
    }
    for (const s of sections) {
        for (const c of (s.children || [])) if (!keys.has(c.section)) errors.push(`Sheet "${s.name}" takes a sub-assembly (${c.section}) the file does not carry.`);
        for (const d of (s.drawings || [])) if (!images[d]) errors.push(`Sheet "${s.name}" names a drawing (${d}) the file does not carry.`);
    }
    const lines = Array.isArray(obj.lines) ? obj.lines : [];
    return {
        ok: errors.length === 0, errors,
        summary: {
            name: projectNameKey(project.name), kind: SHEET_KINDS.includes(project.kind) ? project.kind : 'HARDWARE',
            suggestedBrand: str(project.suggestedBrand).toLowerCase(), sourceFile: str(obj.sourceFile),
            sections: sections.length, lines: lines.length, withPicture: lines.filter(l => l.picture).length,
            pictures: Object.keys(images).length, report: Array.isArray(obj.report) ? obj.report.map(str) : [],
        },
    };
}

const IMPORT_FIELDS = ALL_FIELDS.filter(x => !['picture', 'landed'].includes(x.type) && !x.key.startsWith('tags.') && !x.read).map(x => x.key);

// { projectId, project, lines: [doc with pictureKey], images: [{ key, mime, data, path }] }
// Storage paths are decided here so two imports of one file land on the same objects; finishImport swaps the
// picture keys for the links once the pictures are up.
export function planImport(bundle, { brandId, projectName, user, nowIso }) {
    const name = projectNameKey(projectName || (bundle.project && bundle.project.name));
    const projectId = projectIdOf(brandId, name);
    const kind = SHEET_KINDS.includes(bundle.project && bundle.project.kind) ? bundle.project.kind : 'HARDWARE';
    const stamp = { createdAt: nowIso, createdBy: user || '', updatedAt: nowIso, updatedBy: user || '' };
    const source = str(bundle.sourceFile);
    const project = {
        id: projectId, brandId, name, kind, importedFrom: source, ...stamp,
        sections: (bundle.sections || []).map(s => ({
            id: s.key, name: str(s.name).trim(), kind: SECTION_KINDS.includes(s.kind) ? s.kind : 'ASSEMBLY',
            drawingKeys: [...(s.drawings || [])],
            children: (s.children || []).map(c => ({ section: c.section, qty: numOf(c.qty) ?? 1, balloon: str(c.balloon) })),
            importedTotal: numOf(s.sheetTotal),
        })),
    };
    const lines = (bundle.lines || []).map((src, i) => {
        const doc = { ...blankLine({ id: `${str(src.key) || 'L' + (i + 1)}`, projectId, brandId, order: (i + 1) * 10, user, nowIso }) };
        for (const key of IMPORT_FIELDS) {
            if (src[key] === undefined) continue;
            const field = fieldByKey(key);
            if (key === 'quotes') doc.quotes = (src.quotes || []).map(q => ({ label: str(q.label), price: numOf(q.price), currency: str(q.currency), qty: str(q.qty) }));
            else if (['num', 'money', 'pct', 'usd'].includes(field.type)) doc[key] = numOf(src[key]);
            else if (field.type === 'bool') doc[key] = src[key] === true;
            else doc[key] = str(src[key]).trim();
        }
        // THE WORKBOOK'S OWN CONVERSION. A row quoted in RMB with its USD typed beside it comes in as an origin
        // price at the rate the workbook itself used (USD ÷ RMB), marked WORKBOOK — so the sheet adds up on
        // arrival exactly as it did in Excel, and Update rates is what brings it to today. A row with only a
        // USD figure was quoted in dollars. Nothing is worked out for a row that says neither.
        if (numOf(doc.priceOrigin) === null && numOf(doc.priceUsd) !== null) {
            const q = doc.quotes.length === 1 ? doc.quotes[0] : null;
            const cur = q ? str(q.currency).trim().toUpperCase() : '';
            if (q && numOf(q.price) > 0 && CURRENCIES.includes(cur) && cur !== 'USD') Object.assign(doc, { priceOrigin: q.price, currency: cur, fxRate: doc.priceUsd / q.price, fxDate: '', fxSource: 'WORKBOOK' });
            else if (!doc.quotes.length) Object.assign(doc, { priceOrigin: doc.priceUsd, currency: 'USD', fxRate: 1, fxDate: '', fxSource: 'WORKBOOK' });
        }
        doc.uses = {};
        for (const [sec, use] of Object.entries(src.uses || {})) doc.uses[sec] = { qty: numOf(use.qty), balloon: str(use.balloon), note: str(use.note) };
        doc.source = { file: source, sheet: str(src.source && src.source.sheet), row: numOf(src.source && src.source.row) };
        doc.pictureKey = str(src.picture);
        return doc;
    });
    const images = Object.entries(bundle.images || {}).map(([key, img]) => ({
        key, mime: str(img.mime) || 'image/png', data: img.data,
        path: `control_sheets/${str(brandId).toLowerCase()}/${projectId}/${key}.png`,
    }));
    return { projectId, project, lines, images };
}

// The documents as they are written: every picture key replaced by its link. A picture that failed to go up
// leaves its cell empty — the line is still written, and the caller says which pictures are missing.
export function finishImport(plan, urlByKey) {
    const url = (key) => (key && urlByKey && urlByKey[key]) || '';
    const project = {
        ...plan.project,
        sections: plan.project.sections.map(({ drawingKeys, ...s }) => ({
            ...s, drawings: (drawingKeys || []).map(k => url(k)).filter(Boolean).map(u => ({ url: u, from: 'IMPORT', label: '' })),
        })),
    };
    const lines = plan.lines.map(({ pictureKey, ...doc }) => ({ ...doc, pictureUrl: url(pictureKey), ...(url(pictureKey) ? { pictureFrom: { kind: 'IMPORT' } } : {}) }));
    return { project, lines };
}

// ── DOWNLOADING A SHEET, AND BRINGING IT BACK ───────────────────────────────────────────────────────────
// Stuart 2026-10-07: "any rows checked we add a button to download sheet as xlsx. and we add a reimport button
// to bring back updates, this way we can download and upload working sheets to share with our vendors … i
// want to make this sheet live to communicate."
//
// The file is built and read by Shared/controlSheetXlsx; what goes in it and what may come back is decided
// here. Every row carries its line's id in a Ref column — that, not the row's position or its words, is how a
// returned row finds its line. What comes back is never applied by reading the file: planReimport lists each
// difference (what is here → what the file says) and only what is then ticked is written.
export const XLSX_FORMAT = 'control-sheet-xlsx/1';
export const REF_KEY = '__ref';
// Worked out here or not a value a cell can carry back: sent for reading, never read back.
const NOT_READ_BACK = ['picture', 'quotes', 'usd', 'landed'];
// Ours, not the vendor's: left out of a download unless ticked in.
export const OUR_MONEY = ['priceUsd', 'dutyPct', 'landed', 'rollUpCost', 'basePrice', 'paintedPrice', 'platedPrice', 'plateUpcharge', 'plateUpchargePremium'];

// The columns a download can carry, in the grid's own order. On an assembly's sheet the balloon number, the
// quantity and the note of THAT sheet travel too.
export function exportColumnsFor(fields, section) {
    const cols = [{ key: REF_KEY, label: 'Ref (do not change)', width: 120, back: false, fixed: true }];
    if (section) cols.push({ key: '__balloon', label: '#', width: 50, back: true, use: 'balloon' }, { key: '__qty', label: 'Qty', width: 60, back: true, use: 'qty' });
    for (const fd of (fields || [])) cols.push({ key: fd.key, label: fd.type === 'pct' ? `${fd.label} %` : fd.label, width: fd.width, field: fd, back: !NOT_READ_BACK.includes(fd.type) });
    if (section) cols.push({ key: '__note', label: 'Note on this sheet', width: 240, back: true, use: 'note' });
    return cols;
}
export const startsInDownload = (col) => !OUR_MONEY.includes(col.key);

// What one cell of the file holds: a number where the sheet holds a number (so the vendor's Excel can add
// it), a percentage as a percentage (20, not 0.2), a tick as Yes.
export function exportValueOf(col, line, sectionId) {
    if (col.key === REF_KEY) return str(line.id);
    if (col.use) { const place = placeOf(line, sectionId) || {}; return col.use === 'qty' ? (numOf(place.qty) ?? '') : str(place[col.use]); }
    const fd = col.field;
    if (!fd || fd.type === 'picture') return '';
    if (fd.type === 'landed') return landedEachOf(line) ?? '';
    if (fd.type === 'quotes') return (Array.isArray(line.quotes) ? line.quotes : []).map(quoteTextOf).filter(Boolean).join('\n');
    const raw = cellRawOf(fd, line);
    if (fd.type === 'bool') return raw === true ? 'Yes' : '';
    if (fd.type === 'pct') { const n = numOf(raw); return n === null ? '' : Math.round(n * 1e6) / 1e4; }
    if (['num', 'money', 'usd'].includes(fd.type)) return numOf(raw) ?? '';
    return str(raw);
}

const YES = /^(y|yes|true|x|1|✓)$/i;
// What a returned cell means for the line: the same reading a typed box gets.
export function backValueOf(col, raw) {
    if (col.use === 'qty') return numOf(raw);
    if (col.use) return str(raw).trim();
    if (col.field.type === 'bool') return raw === true || YES.test(str(raw).trim());
    return cellValueOf(col.field, raw);
}
const isBlank = (v) => v === null || v === undefined || v === '' || v === false;
const sameValue = (a, b) => {
    if (isBlank(a) && isBlank(b)) return true;
    if (typeof a === 'number' || typeof b === 'number') { const x = numOf(a), y = numOf(b); return x !== null && y !== null && Math.abs(x - y) < 1e-9; }
    return str(a).trim() === str(b).trim();
};
const shown = (col, v) => (isBlank(v) ? '(blank)' : v === true ? 'Yes' : col.field ? cellTextOf(col.field, v) + (col.field.type === 'pct' ? '%' : '') : str(v));

// { refused, changes, newRows, unknownRefs, locked, unchanged, ignored }
//   columns  the file's columns as the reader resolved them: [{ key, label }] — key null = a column the sheet
//            does not know (ignored, and named)
//   rows     [[raw, …]] in the file's order, one value per column
//   meta     what the download wrote about itself ({ projectId, sectionId, exportedAt }) or null when the
//            vendor's program dropped it
// changes: [{ lineId, label, stale, cells: [{ key, label, from, to, fromText, toText, clears }] }]
//   stale  the line was edited HERE after the file was downloaded — its "from" is newer than the vendor saw
//   clears the file is blank where the sheet has a value: shown, and left unticked — a blank never clears a
//          value unless someone says so
// newRows: rows with no Ref that carry something — a line the vendor added; offered, unticked.
export function planReimport({ meta, columns, rows, lines, projectId, sections, knownColumns }) {
    const out = { refused: '', changes: [], newRows: [], unknownRefs: [], locked: [], unchanged: 0, ignored: [] };
    if (meta && meta.projectId && projectId && meta.projectId !== projectId) { out.refused = `This file was downloaded from another sheet (${str(meta.projectName) || meta.projectId}). Open that sheet to bring it back.`; return out; }
    const byKey = new Map((knownColumns || []).map(c => [c.key, c]));
    const refAt = (columns || []).findIndex(c => c && c.key === REF_KEY);
    if (refAt < 0) { out.refused = 'This file has no Ref column, so its rows cannot be matched to lines. Download the sheet again and work in that file.'; return out; }
    const sectionId = meta && meta.sectionId && (sections || []).some(s => s.id === meta.sectionId) ? meta.sectionId : '';
    const usable = (columns || []).map((c, i) => {
        if (i === refAt) return null;
        const known = c && c.key ? byKey.get(c.key) : null;
        if (!known) { if (c && str(c.label).trim()) out.ignored.push(`${str(c.label).trim()} — not a column of this sheet`); return null; }
        if (!known.back) { out.ignored.push(`${known.label} — worked out here, not read back`); return null; }
        if (known.use && !sectionId) { out.ignored.push(`${known.label} — the assembly sheet it was downloaded from is no longer here`); return null; }
        return known;
    });
    const byId = new Map((lines || []).map(l => [str(l.id), l]));
    let matched = 0;
    (rows || []).forEach((row, index) => {
        const ref = str(row[refAt]).trim();
        const cellsOf = (line) => usable.map((col, i) => {
            if (!col) return null;
            const to = backValueOf(col, row[i]);
            const from = line ? (col.use ? (placeOf(line, sectionId) || {})[col.use] : cellRawOf(col.field, line)) : undefined;
            if (line ? sameValue(from, to) : isBlank(to)) return null;
            return { key: col.key, label: col.label, from: line ? from : undefined, to, fromText: line ? shown(col, from) : '', toText: shown(col, to), clears: !!line && isBlank(to) };
        }).filter(Boolean);
        if (!ref) {
            const cells = cellsOf(null);
            if (cells.length) out.newRows.push({ index, label: str((cells.find(c => c.key === 'itemCode') || cells.find(c => c.key === 'name') || cells[0]).to), cells });
            return;
        }
        const line = byId.get(ref);
        if (!line) { out.unknownRefs.push(ref); return; }
        matched += 1;
        if (line.status === PUSHED) { out.locked.push(lineLabelOf(line)); return; }
        const cells = cellsOf(line);
        if (!cells.length) { out.unchanged += 1; return; }
        const stale = !!(meta && meta.exportedAt && str(line.updatedAt) > str(meta.exportedAt));
        out.changes.push({ lineId: line.id, label: lineLabelOf(line), stale, staleBy: stale ? str(line.updatedBy) : '', cells });
    });
    if (!matched && !out.newRows.length) out.refused = (rows || []).length ? 'None of the rows in this file belong to this sheet.' : 'This file has no rows.';
    out.sectionId = sectionId;
    return out;
}

// The changes that start ticked: everything except a blank that would clear a value.
export const startsTicked = (cell) => !cell.clears;

// What is written for one line: the ticked cells only, each at its own place on the line.
export function patchForCells(cells, sectionId) {
    const patch = {};
    for (const c of (cells || [])) {
        if (c.key === '__balloon') patch[`uses.${sectionId}.balloon`] = c.to;
        else if (c.key === '__qty') patch[`uses.${sectionId}.qty`] = c.to;
        else if (c.key === '__note') patch[`uses.${sectionId}.note`] = c.to;
        else patch[c.key] = c.to;
    }
    return patch;
}

// A row the vendor added, as a new line: a draft carrying the ticked cells, on the sheet it was downloaded
// from when that was an assembly's.
export function lineFromNewRow(cells, { id, projectId, brandId, order, user, nowIso, sectionId }) {
    const line = blankLine({ id, projectId, brandId, order, user, nowIso });
    const place = { qty: null, balloon: '', note: '' };
    for (const c of (cells || [])) {
        if (c.key === '__balloon') place.balloon = c.to;
        else if (c.key === '__qty') place.qty = c.to;
        else if (c.key === '__note') place.note = c.to;
        else if (c.key.includes('.')) { const [a, b] = c.key.split('.'); line[a] = { ...(line[a] || {}), [b]: c.to }; }
        else line[c.key] = c.to;
    }
    if (sectionId) line.uses = { [sectionId]: place };
    return line;
}

// ── THE PUSH: A LINE BECOMES A MASTER LIBRARY RECORD ────────────────────────────────────────────────────
// Stuart 2026-10-07: "once the actual parts are worked out, then we would have a button on the right of each
// line and once all is aligned and correct we push the button and it pushes the item from this working/holding
// spreadsheet form into the master library."
//
// This is the first thing on the sheet that writes OUTSIDE its own store, so everything about it is decided
// here, pure, before the tab touches the database: whether a line may be pushed (readinessOf — it REFUSES on
// what it knows is wrong and only WARNS on what is merely empty), whether the Library already has the item
// (existingByCode), and exactly what is written (pushPlanOf — the record, and beside it the list a person
// reads before saying yes). Only the columns ticked "Library" travel; the 1.6 tags and the milling facts
// never do. After the push the Master Library owns the item and the line is the record of how it got there.
//
// His calls: required before a push — item #, description, class, category, UOM, part handling, sourcing;
// everything else warns · an item # the Library already has is refused, and the line may be LINKED to that
// record instead · manager or above · fees: "yes fees are good as we may need them".
//
// WHAT HAS PARTS (Stuart 2026-10-07: a simple assembly is "both an assembly with less than 5 parts and/or a
// kit"; "a complex assembly to me is what we call the file that we ultimately create a cpq flow from … we will
// load an fbx on 1.6, tag it and create the full flow"). So the sheet pushes a KIT and an ASSEMBLY — each
// with its parts, in one press, once those parts are in the Library — and never the thing a flow is built
// from: that is born in 1.6. A kit or an assembly is a LINE like any other (its number, price, picture) that
// OWNS A SHEET (section.itemLineId) listing its parts and how many of each.
//   Kit       → a Kit record with kit contents (manufacturingSpecs.kitComponents [{ partId, qty }], the shape
//               Shared/itemKit reads): sold as one number, made and picked as its parts, no NetSuite item.
//               Real items only — never a fee, never another kit (the Library's own rule for kit contents).
//   Assembly  → an Assembly record and one parts-list line per part (Shared/sheetPins): what the Library's
//               file cabinet shows and a work order pulls.
export const PUSH_CLASSES = ['Inventory', 'Fee', 'Non-Inventory', 'Kit', 'Assembly'];
export const HAS_PARTS = ['Kit', 'Assembly'];
// What every line needs, and what a thing that is made, stocked or bought needs besides — a fee, a $-holder
// and a kit are never routed to a floor or sourced as themselves, so they are not asked how.
const REQUIRED_ALWAYS = ['itemCode', 'name', 'recordClass', 'uom'];
const REQUIRED_FOR_A_PART = ['productType', 'partHandling', 'sourcing'];
export const requiredFor = (recordClass) => (recordClass === 'Inventory' || recordClass === 'Assembly' ? [...REQUIRED_ALWAYS, ...REQUIRED_FOR_A_PART] : REQUIRED_ALWAYS);
// A wrong word here mis-routes a part on a floor, so it must be one of the Library's own.
const MUST_BE_LISTED = ['productType', 'uom', 'partHandling'];
// Worth saying when empty; never a reason to refuse.
const WORTH_HAVING = ['basePrice', 'binLocation', 'material', 'pictureUrl'];

const codeKey = (v) => str(v).trim().toUpperCase();
const onList = (list, v) => (Array.isArray(list) ? list : []).some(o => str(o).trim().toUpperCase() === str(v).trim().toUpperCase());
const blankCell = (field, raw) => (field.type === 'bool' ? raw !== true : field.type === 'quotes' ? !(Array.isArray(raw) && raw.length) : raw === null || raw === undefined || str(raw).trim() === '');
const valueForLibrary = (field, line) => (field.type === 'landed' ? landedEachOf(line) : cellRawOf(field, line));
const textForLibrary = (field, raw) => (field.type === 'quotes' ? (raw || []).map(quoteTextOf).filter(Boolean).join(' · ') : field.type === 'bool' ? (raw === true ? 'Yes' : 'No') : field.type === 'landed' ? str(Math.round(raw * 1e4) / 1e4) : cellTextOf(field, raw) + (field.type === 'pct' ? '%' : ''));

// The ticked columns of the sheet that the Library has nowhere to put — set up before any push.
export const columnsWithoutField = (fields, pushColumns, customSchema) => (fields || []).filter(fd => pushStateOf(fd, pushColumns, customSchema).missing);

// The sheet that lists this line's parts — a kit's or an assembly's own sheet.
export const sheetOfLine = (line, sections) => (sections || []).find(sec => sec.itemLineId && line && sec.itemLineId === line.id) || null;

// [{ line, qty, balloon, sheet? }] — what a kit or an assembly is made of: every part on its sheet, and the
// item line of every sub-assembly sheet its sheet takes (`sheet` names it; `line` is null when that sheet has
// no line of its own yet). The line itself is never one of its own parts.
export function componentsOf(line, { sections, lines }) {
    const sheet = sheetOfLine(line, sections);
    if (!sheet) return [];
    const out = linesOn(lines, sheet.id).filter(l => l.id !== line.id).map(l => ({ line: l, qty: placeOf(l, sheet.id).qty, balloon: str(placeOf(l, sheet.id).balloon) }));
    for (const child of (sheet.children || [])) {
        const sub = (sections || []).find(sec => sec.id === child.section);
        if (!sub) continue;
        out.push({ line: (lines || []).find(l => l.id === sub.itemLineId) || null, qty: child.qty, balloon: str(child.balloon), sheet: sub.name });
    }
    return out;
}
const wholeQty = (q) => { const n = numOf(q); return n !== null && n >= 1 && Math.abs(n - Math.round(n)) < 1e-9; };

// { ok, blocks: [text], warnings: [text] } — may this line be pushed?
//   fields  the sheet's fields (sheetGroupsFor(kind, customSchema), flattened)
//   lists   the 4.5 dictionary lists by the names the fields use; an EMPTY list cannot refuse anyone
//           (a validator refuses only on what it knows) — it warns instead
//   lines   every line of the sheet, to catch a second line with the same item #
export function readinessOf(line, { fields, pushColumns, customSchema, lists, lines, sections }) {
    const blocks = [], warnings = [];
    const byKey = new Map((fields || []).map(fd => [fd.key, fd]));
    const state = (fd) => pushStateOf(fd, pushColumns, customSchema);
    if (line.status === PUSHED) return { ok: false, blocks: ['This line has already been pushed.'], warnings };
    const cls = str(line.recordClass).trim();
    if (cls && !PUSH_CLASSES.includes(cls)) blocks.push(`"${cls}" is not a class a line can be pushed as.`);
    // A KIT OR AN ASSEMBLY GOES WITH ITS PARTS: it needs its sheet, every part on it already in the Library,
    // and a whole number of each (a parts list is read in whole pieces — a 0.5 would be pulled as 1).
    if (HAS_PARTS.includes(cls)) {
        const what = cls === 'Kit' ? 'kit' : 'assembly';
        const sheet = sheetOfLine(line, sections);
        if (!sheet) blocks.push(`It has no sheet listing its parts — open the ${what}'s sheet (or add one) and choose this line under "Parts list of".`);
        else {
            if (placeOf(line, sheet.id)) blocks.push('It is listed as a part on its own sheet.');
            const parts = componentsOf(line, { sections, lines });
            if (!parts.length) blocks.push(`Its sheet "${sheet.name}" lists no parts.`);
            const noLine = parts.filter(c => !c.line).map(c => c.sheet);
            if (noLine.length) blocks.push(`Sub-assembly sheet${noLine.length === 1 ? '' : 's'} with no line of ${noLine.length === 1 ? 'its' : 'their'} own: ${noLine.join(', ')}.`);
            const real = parts.filter(c => c.line);
            const notIn = real.filter(c => !(c.line.status === PUSHED && c.line.pushedTo && c.line.pushedTo.docId)).map(c => lineLabelOf(c.line));
            if (notIn.length) blocks.push(`${notIn.length} of its parts ${notIn.length === 1 ? 'is' : 'are'} not in the Master Library yet — push ${notIn.length === 1 ? 'it' : 'them'} first: ${notIn.slice(0, 8).join(', ')}${notIn.length > 8 ? ` …and ${notIn.length - 8} more` : ''}.`);
            const badQty = real.filter(c => !wholeQty(c.qty)).map(c => `${lineLabelOf(c.line)} (${numOf(c.qty) === null ? 'blank' : numOf(c.qty)})`);
            if (badQty.length) blocks.push(`A parts list takes whole numbers of 1 or more — fix the quantity of: ${badQty.slice(0, 8).join(', ')}.`);
            const kits = real.filter(c => str(c.line.recordClass) === 'Kit').map(c => lineLabelOf(c.line));
            if (kits.length) blocks.push(`A kit cannot be a part of something else — list its parts instead: ${kits.join(', ')}.`);
            const fees = cls === 'Kit' ? real.filter(c => ['Fee', 'Non-Inventory'].includes(str(c.line.recordClass))).map(c => lineLabelOf(c.line)) : [];
            if (fees.length) blocks.push(`A kit holds real items only — not a fee or a non-inventory item: ${fees.join(', ')}.`);
        }
    }
    for (const key of requiredFor(cls)) {
        const fd = byKey.get(key);
        if (!fd) continue;
        const raw = cellRawOf(fd, line);
        if (blankCell(fd, raw)) { blocks.push(`${fd.label} is empty.`); continue; }
        if (!state(fd).on) { blocks.push(`${fd.label} is needed by the Master Library, but its column is not ticked for the Library.`); continue; }
        if (MUST_BE_LISTED.includes(key)) {
            const list = (lists && lists[fd.list]) || [];
            if (!list.length) warnings.push(`${fd.label} "${str(raw)}" could not be checked — the Library's list for it is empty.`);
            else if (!onList(list, raw)) blocks.push(`${fd.label} "${str(raw)}" is not on the Master Library's list.`);
        }
    }
    const noField = columnsWithoutField(fields, pushColumns, customSchema);
    if (noField.length) blocks.push(`${noField.length === 1 ? 'A column is' : `${noField.length} columns are`} ticked for the Library with no Library field to go to: ${noField.map(fd => fd.label).join(', ')}. Untick ${noField.length === 1 ? 'it' : 'them'}, or add the attribute in 4.5 first.`);
    const code = codeKey(line.itemCode);
    const twin = code ? (lines || []).find(l => l.id !== line.id && codeKey(l.itemCode) === code) : null;
    if (twin) blocks.push(`Another line on this sheet carries the same item # (${code}).`);

    for (const fd of (fields || [])) {
        const st = state(fd);
        if (!st.offered || !st.on || !st.target || requiredFor(cls).includes(fd.key)) continue;
        const raw = valueForLibrary(fd, line);
        if (WORTH_HAVING.includes(fd.key) && blankCell(fd, raw) && cls === 'Inventory') warnings.push(`${fd.label} is empty.`);
        if (fd.type === 'list' && !blankCell(fd, raw) && ((lists && lists[fd.list]) || []).length && !onList(lists[fd.list], raw)) warnings.push(`${fd.label} "${str(raw)}" is not on the Master Library's list — it goes in as typed.`);
    }
    const sourcing = str(cellRawOf(byKey.get('sourcing') || { key: 'sourcing' }, line));
    if (cls === 'Inventory' && (sourcing === SOURCING_LABEL.OUT || sourcing === SOURCING_LABEL.BOTH) && !str(line.vendor).trim()) warnings.push('It is bought, and no vendor is named.');
    if (cls === 'Inventory' && (sourcing === SOURCING_LABEL.IN || sourcing === SOURCING_LABEL.BOTH) && !str(line.paintSize).trim()) warnings.push('It is made here, and has no paint size.');
    if (cls === 'Inventory' && landedEachOf(line) === null) warnings.push('It has no cost — no USD on the line.');
    return { ok: blocks.length === 0, blocks, warnings };
}

// The record in the Library that already answers to this item # — by its ERP id or its own id, whatever the
// case. `records` are the division's records (and those shared into it) as read FROM THE SERVER.
export const existingByCode = (records, code) => {
    const key = codeKey(code);
    if (!key) return null;
    return (records || []).find(r => codeKey(r.legacyErpId) === key || codeKey(r.itemId) === key || codeKey(r.id) === key) || null;
};

const setPath = (obj, path, value) => {
    const parts = path.split('.');
    let at = obj;
    for (let i = 0; i < parts.length - 1; i++) { if (!at[parts[i]] || typeof at[parts[i]] !== 'object') at[parts[i]] = {}; at = at[parts[i]]; }
    at[parts[parts.length - 1]] = value;
};
const ID_PREFIX = { Inventory: 'INV', Fee: 'FEE', 'Non-Inventory': 'NIV', Kit: 'KIT', Assembly: 'ASM' };
// <DIVISION>-<INV|FEE|NIV|KIT|ASM>-<the clock> — the Library's own prefixes (an assembly the item sync brings
// in is an -ASM- record too), and a number that cannot meet an existing record's (the four random digits
// "+ New Record" draws can).
export const libraryIdFor = (brandId, recordClass, nowMs) => `${str(brandId).toUpperCase()}-${ID_PREFIX[recordClass] || 'INV'}-${nowMs}`;

// { record, written: [{ label, to, text }], kept: [label] }
//   record   the Master Library document, in the shape its own "+ New Record" saves: the identity at the top,
//            everything else under manufacturingSpecs, the dates as ISO text — plus where it came from
//   written  what a person is shown before saying yes: each column that travels, the Library's name for the
//            field it lands in, and the value
//   kept     the columns of this line that hold something and stay on the sheet
// Only a TICKED column with a Library field travels, and only when it holds something (a blank never
// overwrites the Library's own default). A value is written the way the Library keeps it: the item # and the
// category upper-cased, the collection under its one name, sourcing as the Library's two fields together.
// For a kit or an assembly the plan also carries its parts: `parts` (what a person is shown), and either the
// kit's contents ON the record or `pins` — the assembly's parts-list lines, written beside it.
export function pushPlanOf(line, { project, brandId, fields, pushColumns, customSchema, user, nowIso, id, sections, lines }) {
    const cls = str(line.recordClass).trim();
    const record = {
        id, itemId: id, brandId, sharedBrands: [brandId], partClass: cls,
        itemName: str(line.name).trim(), legacyErpId: codeKey(line.itemCode),
        clientPricing: [], project: str(project && project.name), routingType: '', productType: cls === 'Fee' ? 'FEE' : '',
        manufacturingSpecs: { uom: 'EA', productType: cls === 'Fee' ? 'FEE' : '', collections: [], watchList: 'NONE', binLocation: '', customData: {}, parametric: { isCutToSize: false, fixedDiameter: '', length: '', width: '', height: '' } },
        createdAt: nowIso, updatedAt: nowIso, createdBy: str(user),
        controlSheet: { projectId: str(project && project.id), projectName: str(project && project.name), lineId: str(line.id), pushedAt: nowIso, pushedBy: str(user) },
    };
    const written = [], kept = [];
    for (const fd of (fields || [])) {
        const raw = valueForLibrary(fd, line);
        if (blankCell(fd, raw)) continue;                     // an unticked box is the Library's own default too
        const st = pushStateOf(fd, pushColumns, customSchema);
        if (!st.offered || !st.on || !st.target) { kept.push(fd.label); continue; }
        const path = st.target.path;
        let value = raw;
        if (fd.key === 'itemCode') value = codeKey(raw);
        else if (fd.key === 'name' || fd.key === 'recordClass') value = str(raw).trim();
        else if (fd.key === 'collection') value = [canonicalCollection(raw)].filter(Boolean);
        else if (fd.key === 'productType' || fd.key === 'uom' || fd.key === 'routingType') value = str(raw).trim().toUpperCase();
        else if (fd.type === 'landed') value = Math.round(raw * 1e4) / 1e4;
        else if (st.target.custom || fd.type === 'quotes') value = textForLibrary(fd, raw);
        if (fd.key === 'sourcing') {
            const mode = Object.keys(SOURCING_LABEL).find(k => SOURCING_LABEL[k] === str(raw)) || SOURCING.IN;
            Object.assign(record.manufacturingSpecs, sourcingPatch(mode));
        } else if (fd.key === 'productType') { record.productType = value; record.manufacturingSpecs.productType = value; }
        else setPath(record, path, value);
        written.push({ label: fd.label, to: st.target.label, text: fd.key === 'collection' ? value.join(', ') : fd.type === 'picture' ? 'the picture' : textForLibrary(fd, fd.type === 'landed' ? value : raw) });
    }
    if (record.manufacturingSpecs.isInHouse === undefined) Object.assign(record.manufacturingSpecs, sourcingPatch(SOURCING.IN));
    let parts = [], pins = [];
    if (HAS_PARTS.includes(cls)) {
        const sheet = sheetOfLine(line, sections);
        const made = componentsOf(line, { sections, lines }).filter(c => c.line && c.line.pushedTo && c.line.pushedTo.docId);
        parts = made.map(c => ({ docId: str(c.line.pushedTo.docId), code: codeKey(c.line.pushedTo.code || c.line.itemCode), name: str(c.line.name).trim(), qty: Math.round(numOf(c.qty) || 0) }));
        if (cls === 'Kit') record.manufacturingSpecs.kitComponents = parts.map(c => ({ partId: c.docId, qty: c.qty }));
        else pins = parts.map(c => sheetPinFor({ assemblyId: id, component: c, qty: c.qty, origin: { projectId: project && project.id, sectionId: sheet && sheet.id, lineId: line.id }, user, nowIso }));
    }
    return { record, written, kept, parts, pins };
}

// What is stamped on the line by a push, by a link to a record the Library already had, and by an unlock.
export const pushedStamp = (record, { user, nowIso, linked = false }) => ({ status: PUSHED, pushedTo: { docId: str(record.id), code: codeKey(record.legacyErpId || record.itemId), at: nowIso, by: str(user), linked: !!linked } });
export const unlockStamp = (line, { user, nowIso }) => ({ status: 'READY', pushedTo: null, lastPush: { ...(line.pushedTo || {}), undoneAt: nowIso, undoneBy: str(user) } });

