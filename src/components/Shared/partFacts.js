// ── WHAT A FLOOR CARD CAN SAY ABOUT ITS PARTS — BY MATERIAL, AND BY SALES-ORDER LINE (Stuart 2026-10-07) ─────────
// "we are now processing orders that have the multi materials like the H1-138 flow … can we set the cards with
//  better information of how many parts on the order by material so that the handshake happens with wood parts
//  together, then metal parts together … when we have multi line sales orders, the cards really need to display
//  Line 1 of 5, Line 2 of 5."
// Two facts no floor document carried:
//   · MATERIAL. The split groups an order by FINISH; nothing said what a part is made of. Both handshake labels read
//     "item · N pcs · finish", and N mixed the shop's poles with the small parts. The item says it (the Library's
//     "Raw Mat", manufacturingSpecs.material — blank reads as METAL); the split now stamps it on every parts-list
//     and cut-list line, and the pair's count by material on both of its documents.
//   · THE LINE. One document covers every sales-order line in its finish (finishing paints a finish together — his
//     call 2026-10-07: "one per finish"). A CPQ quote's lines are its ▶ header rows, which the split drops — so a
//     part never knew its line. Each row is stamped with its line before the headers go; an Order Entry line is
//     its own line number on the sales order.
// LABELLING ONLY (his call): the documents, their ids and what is on each are exactly what they were.
// Pure. Harness: scripts/partFacts.test.mjs.
import { isPoleCategory } from './poleCut.js';

const U = (v) => String(v == null ? '' : v).trim().toUpperCase();
const N = (v) => Number(v) || 0;

// ── material ──────────────────────────────────────────────────────────────────────────────────────────────────
export const MATERIAL_BLANK = 'METAL';   // the Library's own rule: "Blank reads as METAL"
/**
 * What an item is made of, in one word: WOOD · METAL · CLEAR … — the item's own Raw Mat, less any note in brackets
 * ("CLEAR (NO FINISH)" → CLEAR). An item with a blank field is METAL; NO item record at all is unknown ('').
 */
export const materialOfPart = (part) => {
    if (!part) return '';
    const raw = U((part.manufacturingSpecs && part.manufacturingSpecs.material) || '').replace(/\s*\(.*$/, '').trim();
    return raw || MATERIAL_BLANK;
};
const materialWord = (m) => U(m) || 'OTHER';

/** Is this parts-list line a pole / rod (a straight wood rod finished with the small parts still counts as a rod)? */
export const isRodLine = (line) => !!line && (isPoleCategory(line.productType) || N(line.cutLength) > 0);
const pcsOf = (l) => N(l && l.pcs) || N(l && (l.quantity != null ? l.quantity : l.qty));

/**
 * THE PAIR'S PARTS BY MATERIAL — what both documents of a pair carry, and every card and label reads.
 * @param partsList  the finishing document's lines (each stamped `material`)
 * @param cutList    the shop document's lines (each stamped `material`; a rider — fabrication on a rod — is no part)
 * @returns Array<{ material, rods, small }> — rods = poles and rods by the piece, small = small parts by the piece;
 *          the material with the most pieces first.
 */
export function partsByMaterialOf({ partsList = [], cutList = [] } = {}) {
    const by = new Map();
    const row = (m) => { const k = materialWord(m); if (!by.has(k)) by.set(k, { material: k, rods: 0, small: 0 }); return by.get(k); };
    // A POLE COUNTS AS A POLE (Shared/splitPlan.customShopQtyOf, his rule of 2026-09-12): a cut-list line with a
    // length is a rod; one without (a return, a miter, a fee) is fabrication ON a rod and is no part. A shop job
    // with no rod at all (a bracket set) keeps its lines, as shop-made small parts.
    const cuts = (cutList || []).filter(c => c && !c.rider);
    const rodCuts = cuts.filter(c => N(c.cutLength) > 0 || N(c.feetPer) > 0);
    if (rodCuts.length) rodCuts.forEach(c => { row(c.material).rods += N(c.qty) || 1; });
    else cuts.forEach(c => { row(c.material).small += pcsOf(c) || 1; });
    (partsList || []).forEach(p => { if (!p) return; const r = row(p.material); if (isRodLine(p)) r.rods += pcsOf(p) || 1; else r.small += pcsOf(p) || 1; });
    return [...by.values()].filter(r => r.rods + r.small > 0).sort((a, b) => (b.rods + b.small) - (a.rods + a.small) || a.material.localeCompare(b.material));
}
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
/** "WOOD · 1 rod + 2 small parts" */
export const materialRowText = (r) => `${r.material} · ${[r.rods ? plural(r.rods, 'rod', 'rods') : '', r.small ? plural(r.small, 'small part', 'small parts') : ''].filter(Boolean).join(' + ')}`;
/** "WOOD · 1 rod + 2 small parts  |  METAL · 1 small part" — '' for a document from before the stamp. */
export const materialSummaryText = (rows = []) => (Array.isArray(rows) ? rows : []).map(materialRowText).join('  |  ');
/** The short form for a label: "WOOD 1 rod + 2 · METAL 1" */
export const materialLabelText = (rows = []) => (Array.isArray(rows) ? rows : [])
    .map(r => `${r.material} ${[r.rods ? plural(r.rods, 'rod', 'rods') : '', r.small ? `${r.small} pc${r.small === 1 ? '' : 's'}` : ''].filter(Boolean).join(' + ')}`).join(' · ');
/** One word for a pair that is all one material — "WOOD" — or "MIXED"; '' when unknown. */
export const materialHeadOf = (rows = []) => { const list = Array.isArray(rows) ? rows : []; return list.length === 1 ? list[0].material : (list.length > 1 ? 'MIXED' : ''); };

// ── the sales-order line ──────────────────────────────────────────────────────────────────────────────────────
const HEADER_TAG_RE = /\[([^\]]*)\]/;
/** A quote's CART-LINE header (▶ kit or assembly [room]) — not the "Add-ons & Fees" header, which is no line. */
export const isCartLineHeader = (row) => !!row && row.isHeader === true && /^\s*▶/.test(String(row.name || ''));
const headerTagOf = (h) => String((h && h.sidemark) || (String((h && h.name) || '').match(HEADER_TAG_RE) || [])[1] || '').trim();

/**
 * A CPQ quote's breakdown with every row stamped with ITS LINE (`lineNo`, 1-based, and `lineTag` — the Line Tag /
 * Room typed on it) — done BEFORE the header rows are dropped, since their position is the only thing that says
 * which line a part belongs to. Rows under any other header (add-ons, fees) belong to no line.
 * @returns {{ rows, lineCount, tags: Object<number,string> }} — `rows` are copies; the quote is not touched.
 */
export function withCartLines(breakdown = []) {
    let no = 0, cur = 0, tag = '';
    const tags = {};
    const rows = (breakdown || []).map(row => {
        if (!row) return row;
        if (row.isHeader) {
            if (isCartLineHeader(row)) { no += 1; cur = no; tag = headerTagOf(row); if (tag) tags[no] = tag; } else { cur = 0; tag = ''; }
            return row;
        }
        return cur ? { ...row, lineNo: cur, ...(tag ? { lineTag: tag } : {}) } : row;
    });
    return { rows, lineCount: no, tags };
}

/** The line fields a parts-list or cut-list entry carries: { material, lineNo?, lineTag? }. */
export const lineFactsOf = (line, part) => ({
    material: materialOfPart(part),
    ...(N(line && line.lineNo) > 0 ? { lineNo: N(line.lineNo), ...(line.lineTag ? { lineTag: String(line.lineTag) } : {}) } : {}),
});

/** The lines a document's parts and cuts belong to, in order: [1, 2, 5]. */
export const lineNosOf = ({ partsList = [], cutList = [] } = {}) =>
    [...new Set([...(partsList || []), ...(cutList || [])].map(l => N(l && l.lineNo)).filter(n => n > 0))].sort((a, b) => a - b);

/** "Line 2 of 5" · "Lines 1–3 of 5" · "Lines 1, 3, 5 of 5" — '' for a one-line order or an unstamped document. */
export const lineSpanText = (lineNos = [], lineCount = 0) => {
    const nos = [...new Set((lineNos || []).map(N).filter(n => n > 0))].sort((a, b) => a - b);
    const of = N(lineCount);
    if (!nos.length || of < 2) return '';
    if (nos.length === 1) return `Line ${nos[0]} of ${of}`;
    const run = nos.every((n, i) => i === 0 || n === nos[i - 1] + 1);
    return `Lines ${run ? `${nos[0]}–${nos[nos.length - 1]}` : nos.join(', ')} of ${of}`;
};
/** "Line 2 of 5 · Living Room" — the heading of one line's rows on a card. */
export const lineHeadText = (lineNo, lineCount, tag = '') => (N(lineNo) > 0 ? `Line ${N(lineNo)}${N(lineCount) > 1 ? ` of ${N(lineCount)}` : ''}${tag ? ` · ${tag}` : ''}` : '');

/**
 * A card's rows grouped under their line — only when the document covers MORE than one line of a multi-line order
 * (otherwise one group with no heading, the rows exactly as they were).
 * @returns Array<{ lineNo, head, rows }>
 */
export function rowsByLine(rows = [], lineCount = 0) {
    const list = (rows || []).filter(Boolean);
    const nos = [...new Set(list.map(r => N(r.lineNo)).filter(n => n > 0))];
    if (N(lineCount) < 2 || nos.length < 2) return [{ lineNo: 0, head: '', rows: list }];
    const by = new Map();
    list.forEach(r => { const k = N(r.lineNo); if (!by.has(k)) by.set(k, []); by.get(k).push(r); });
    return [...by.entries()].sort((a, b) => (a[0] || 1e9) - (b[0] || 1e9))
        .map(([k, rs]) => ({ lineNo: k, head: k ? lineHeadText(k, lineCount, (rs.find(r => r.lineTag) || {}).lineTag || '') : 'Whole order', rows: rs }));
}

// ── what a document carries, and what a card says ─────────────────────────────────────────────────────────────
/** The stamp both documents of a pair carry: { partsByMaterial, lineNos, lineCount }. */
export const pairFactsOf = ({ partsList = [], cutList = [], lineCount = 0 } = {}) => ({
    partsByMaterial: partsByMaterialOf({ partsList, cutList }),
    lineNos: lineNosOf({ partsList, cutList }),
    lineCount: N(lineCount),
});

/** The two sentences a card leads with: its parts by material, and the lines it covers. '' = from before the stamp. */
export const cardFactsOf = (doc) => ({
    materials: materialSummaryText(doc && doc.partsByMaterial),
    head: materialHeadOf(doc && doc.partsByMaterial),
    lines: lineSpanText(doc && doc.lineNos, doc && doc.lineCount),
});

/**
 * The order's OTHER documents, by material — so wood is staged with wood and metal with metal.
 * @param docs  the documents the screen already holds     @param refOf  (doc) → its reference
 * @returns Array<{ id, ref, finish, materials, head }>
 */
export function orderMatesOf(doc, docs = [], refOf = (d) => (d && d.id) || '') {
    if (!doc) return [];
    const keyOf = (d) => String((d && (d.orderKey || d.salesOrderId || d.soAppId)) || '');
    const k = keyOf(doc);
    if (!k) return [];
    return (docs || []).filter(d => d && d.id !== doc.id && !d.deleted && d.currentPhase !== 'Closed' && keyOf(d) === k && Array.isArray(d.partsByMaterial) && d.partsByMaterial.length)
        .map(d => ({ id: d.id, ref: refOf(d), finish: String(d.recipe || d.finishRecipe || ''), materials: materialSummaryText(d.partsByMaterial), head: materialHeadOf(d.partsByMaterial) }))
        .sort((a, b) => a.ref.localeCompare(b.ref));
}
