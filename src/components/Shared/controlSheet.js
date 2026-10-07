// Shared/controlSheet.js — the rules of tab 1.2, Control Sheets. Pure: no React, no Firestore.
//
// THE WORKING / HOLDING SHEET (Stuart 2026-10-07: "create a tab/page in the app that replaces the excel
// spreadsheet … a true working center where we store all our work until its ready to push into the app as
// final/approved"). A project named in tab 1 has ONE control sheet here; the sheet holds LINES (a part,
// entered once) and SHEETS (an assembly: which lines it uses, how many of each, the balloon number on its
// drawing). Nothing in the app reads this store — an item exists for CPQ, Order Entry, the floors, WMS and
// NetSuite only once its line is pushed into the Master Library, and that push is not in this file yet.
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
// One table. The grid's columns, the cell editors and the import all read it, so a field is added in one
// place. `key` is the path on the line document ('tags.category' sits under the line's tags).
//   type   text | long | url | num | money | pct | bool | pick (fixed choices) | list (a 4.5 dictionary list,
//          named by `list`; a value not on the list is kept and shown) | picture | quotes | landed (worked out)
//   kinds  which sheets show it; absent = both
// `sheetOnly: true` marks what stays on the sheet when a line is pushed (the 1.6 tags; the milling facts —
// Stuart 2026-10-07: "milling we are still refining this keep them on the sheet").
const f = (key, label, type = 'text', extra = {}) => ({ key, label, type, width: 120, ...extra });
const HW = { kinds: ['HARDWARE'] };

export const FIELD_GROUPS = [
    { key: 'IDENTITY', label: 'Identity', always: true, fields: [
        f('pictureUrl', 'Picture', 'picture', { width: 64 }),
        f('itemCode', 'Item #', 'text', { width: 130, mono: true }),
        f('name', 'Description', 'long', { width: 280 }),
        f('recordClass', 'Class', 'pick', { options: RECORD_CLASSES, width: 118 }),
    ] },
    { key: 'DESIGN', label: 'Design', fields: [
        f('size', 'Size / dimensions', 'long', { width: 220 }),
        f('material', 'Material', 'list', { list: 'materials', width: 130 }),
        f('color', 'Colour / finish', 'text'),
        f('weight', 'Weight', 'text', { width: 80 }),
        f('screws', 'Screws / hardware', 'long', { width: 220, ...HW }),
        f('itemNotes', 'Item notes', 'long', { width: 220, ...HW }),
        f('changes', 'Changes', 'long', { width: 220, ...HW }),
        f('cad', 'CAD', 'text', { width: 170, ...HW }),
        f('cam', 'CAM', 'text', { width: 80, ...HW }),
        f('programNum', 'Program #', 'text', { width: 100, mono: true, ...HW }),
    ] },
    { key: 'SOURCING', label: 'Sourcing & cost', fields: [
        f('vendor', 'Vendor', 'text', { width: 140, datalist: 'vendors' }),
        f('vendorSku', 'Vendor part #', 'text', { width: 140, mono: true }),
        f('vendorUrl', 'Link', 'url', { width: 150 }),
        f('origin', 'Origin', 'text', { width: 110 }),
        f('quotes', 'Quotes', 'quotes', { width: 170 }),
        f('priceUsd', 'USD', 'money', { width: 84 }),
        f('dutyPct', 'Duty / ship', 'pct', { width: 84 }),
        f('landed', 'Landed each', 'landed', { width: 96 }),
        f('orderQty', 'Order qty', 'text', { width: 84 }),
        f('leadTime', 'Lead time', 'text', { width: 90 }),
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
        f('basePrice', 'Base price', 'money', { width: 96 }),
        f('paintedPrice', 'Painted', 'money', { width: 84, ...HW }),
        f('platedPrice', 'Plated', 'money', { width: 84, ...HW }),
    ] },
    { key: 'LIBRARY', label: 'Library fields', fields: [
        f('collection', 'Collection', 'list', { list: 'collections', width: 150 }),
        f('productType', 'Category', 'list', { list: 'prodTypes', width: 140 }),
        f('uom', 'UOM', 'list', { list: 'uom', width: 76 }),
        f('partHandling', 'Part handling', 'list', { list: 'partHandling', width: 124 }),
        f('paintSize', 'Paint size', 'pick', { options: ['S', 'M', 'L'], width: 86 }),
        f('watchList', 'Watchlist', 'list', { list: 'watchLists', width: 120 }),
        f('isInHouse', 'In-house', 'bool', { width: 78 }),
        f('outsourceAction', 'Outsource action', 'list', { list: 'outsourceActions', width: 140 }),
        f('isStocked', 'Stocked', 'bool', { width: 72 }),
        f('binLocation', 'Bin', 'list', { list: 'bins', width: 110 }),
        f('reorderPoint', 'Reorder pt', 'num', { width: 90 }),
        f('unfinished', 'Unfinished', 'bool', { width: 86 }),
        f('trackLoaded', 'On the track', 'bool', { width: 92, ...HW }),
        f('projection', 'Projection', 'list', { list: 'projections', width: 104, ...HW }),
        f('bracketType', 'Mount type', 'list', { list: 'bracketMounts', width: 130, ...HW }),
        f('bpOrientation', 'Plate orientation', 'pick', { options: ['HORIZONTAL', 'VERTICAL', 'SQUARE', 'ROUND'], width: 140, ...HW }),
        f('isReturnBracket', 'Return bracket', 'bool', { width: 108, ...HW }),
        f('bpLength', 'Plate L', 'num', { width: 74, ...HW }),
        f('bpWidth', 'Plate W', 'num', { width: 74, ...HW }),
        f('bpHeight', 'Plate H', 'num', { width: 74, ...HW }),
        f('armThickness', 'Arm thickness', 'num', { width: 104, ...HW }),
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

export const ALL_FIELDS = FIELD_GROUPS.flatMap(g => g.fields.map(x => ({ ...x, group: g.key })));
export const fieldByKey = (key) => ALL_FIELDS.find(x => x.key === key) || null;

const showsFor = (thing, kind) => !thing.kinds || !kind || thing.kinds.includes(kind);
// The groups a sheet of this kind offers, each with only the fields that kind shows.
export const groupsFor = (kind) => FIELD_GROUPS
    .filter(g => showsFor(g, kind))
    .map(g => ({ ...g, fields: g.fields.filter(x => showsFor(x, kind)) }));
// What opens ticked: the sheet as Excel showed it — costing for a light, pricing for hardware.
export const defaultGroupsFor = (kind) => (kind === 'HARDWARE' ? ['DESIGN', 'SOURCING', 'PRICING'] : ['DESIGN', 'SOURCING']);

// ── READING AND WRITING A CELL ──────────────────────────────────────────────────────────────────────────
export const valueAt = (line, key) => {
    if (!line) return undefined;
    let v = line;
    for (const part of String(key).split('.')) { if (v === null || v === undefined) return undefined; v = v[part]; }
    return v;
};

// What the operator typed → what is stored. An emptied number is null (never '' — a blank is not a price).
// A percentage is typed as a percentage ("20") and stored as the fraction the Excel sheets carry (0.2).
export function cellValueOf(field, raw) {
    const type = field && field.type;
    if (type === 'bool') return raw === true || raw === 'true';
    if (type === 'num' || type === 'money') return numOf(raw);
    if (type === 'pct') { const n = numOf(str(raw).replace('%', '')); return n === null ? null : Math.round(n * 1e6) / 1e8; }
    return str(raw).trim();
}

const trim = (n, places) => String(Math.round(n * 10 ** places) / 10 ** places);
// What a stored value reads as in its box.
export function cellTextOf(field, value) {
    const type = field && field.type;
    if (value === null || value === undefined) return '';
    if (type === 'pct') { const n = numOf(value); return n === null ? '' : trim(n * 100, 4); }
    if (type === 'num' || type === 'money') { const n = numOf(value); return n === null ? '' : trim(n, 6); }
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

const IMPORT_FIELDS = ALL_FIELDS.filter(x => !['picture', 'landed'].includes(x.type) && !x.key.startsWith('tags.')).map(x => x.key);

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
            else if (['num', 'money', 'pct'].includes(field.type)) doc[key] = numOf(src[key]);
            else if (field.type === 'bool') doc[key] = src[key] === true;
            else doc[key] = str(src[key]).trim();
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
