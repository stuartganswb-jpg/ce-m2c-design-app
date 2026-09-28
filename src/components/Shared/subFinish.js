// ── A TRAVERSE ROW, BY CPQ'S RULES — on every door (Stuart 2026-09-27, SO60551 Row 2) ───────────────────────
// "traverse rules are already set, the track has cut reduction for manual and motorized, in these cases it is
//  manual, they are finished to either B or C, which is the sub finish associated to main finish in the mass
//  update, this is already set in cpq and you should use it" · "fclip needs cut as well 17"" · "yes /C the ep4
//  is a mistake … impossible to have miter cuts different finish than the pole" · "H1-2TRVTRK/C is correct".
//
// CPQ already knows all of it: the track wears the sub finish 4.5 aligns to the ROD's finish (HardwareConfigurator
// subFinishFor — S04 → TCP), the track and the F-clip are cut shorter than the fascia (Shared/traverseTags
// traverseCutLength: track −0.5" manual / −2" motorized, F-clip −1" / −3"), a part made in a stock colour is SOLD
// as that stocked item (Shared/finishVariant.stockColourVariantOf — H1-2TRV-WB + TCP → H1-2TRV-WB/C), and a fee
// cut into the rod wears the rod's finish. But the floor routes never read the sub finish: the CPQ split, 10.5's
// rows and tab 7 put a track with no finish of its own into the order's recipe (SO60551's EP4) or the rod's (S04),
// cut it at the fascia's length, and a quote from before 9/18 still named EP4 brackets.
//
// This module is those rules for ONE ROW of order lines, pure, called by every door: the Order Entry route
// (Shared/oeGenerate.oeLinePlansOf — RTG's automatic start, 10.5's ▶ Start row, the review), the CPQ split
// (HQ/RTGDispatchTab), ↻ Re-read lines (Shared/displayRelease) and tab 7's traverse kits (traverseOrderLinesOf).
// It calls CPQ's own functions; it holds no copy of a rule.
import { STOCK_COLOUR_SUFFIX, stockColourVariantOf } from './finishVariant.js';
import { TRAVERSE_FAMILY_PARTS } from './traverseExplode.js';
import { traverseCutLength } from './traverseTags.js';
import { isPoleCategory } from './poleCut.js';
import { isOutsourcedFinishCode } from './finishRouting.js';
import { speciesVariantOf } from './sizeMatrix.js';

const U = (v) => String(v == null ? '' : v).trim().toUpperCase();
const N = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const specsOf = (p) => (p && p.manufacturingSpecs) || {};
const codeOfPart = (p) => U(p && (p.legacyErpId && p.legacyErpId !== 'PENDING' ? p.legacyErpId : p.itemId));
const codeOfLine = (l) => U(l && (l.erp || l.legacyErpId || l.partId));
const baseOf = (code) => { const s = U(code); const i = s.lastIndexOf('/'); return i > 0 ? s.slice(0, i) : s; };
const isFeeOf = (line, part) => !!(line && (line.isFee || line.lineIsFee))
    || !!(part && (part.partClass === 'Fee' || U(specsOf(part).productType) === 'FEE'));
// The words a fee's fabrication is named by (the same test Shared/oeClassify.fabKindOf and CPQ's fee rule read).
const isFabFee = (text) => /MITER|\bMTR\b|MTR$|RETURN|\bBEN(D|T)\b|SPLICE/.test(U(text));

/** The sub finish 4.5 aligns to a finish (P06 → TCP, P14 → TBR, S04 → TCP). '' when it names none. */
export const subFinishOfFinish = (code, finishes = []) => {
    const c = U(code);
    if (!c) return '';
    const f = (finishes || []).find(x => x && U(x.code || x.name) === c);
    return U(f && f.subFinishCode);
};

/** A sub finish itself (TBR / TCP — the 4.5 finishes flagged isSubFinish). */
export const isSubFinishCode = (code, finishes = []) => {
    const c = U(code);
    return !!c && (!!STOCK_COLOUR_SUFFIX[c] || (finishes || []).some(f => f && f.isSubFinish && U(f.code || f.name) === c));
};

const STOCK_SUFFIXES = new Set(Object.values(STOCK_COLOUR_SUFFIX));
/** A stocked stock-colour item (H1-2TRV-WB/C, H1-2TRVBP/B) — a finished good on the shelf, like a plated one. */
export const isStockColourCode = (code) => {
    const s = U(code);
    const i = s.lastIndexOf('/');
    return i > 0 && STOCK_SUFFIXES.has(s.slice(i + 1));
};

/** The traverse cut role an item plays — the family's track or F-clip — else null. */
export const trvRoleOfCode = (code) => {
    const c = baseOf(code);
    if (!c) return null;
    for (const [family, P] of Object.entries(TRAVERSE_FAMILY_PARTS)) {
        if (P.rawTrack && U(P.rawTrack) === c) return { family, role: 'TRACK' };
        if (P.fclip && U(P.fclip) === c) return { family, role: 'FCLIP' };
    }
    return null;
};

/**
 * What a line IS once it is finished — the code the SO Pack, the labels and the gather read.
 * A sub finish names the stock colour (TCP → /C, TBR → /B); the family's track leaves the floor as its
 * finished track (H1-2TRV + TCP → H1-2TRVTRK/C). Everything else is <code>/<finish>, as it always was.
 */
export const finishedCodeOf = (erp, finish) => {
    const code = U(erp);
    const fin = U(finish);
    if (!code || !fin) return code;
    const sfx = STOCK_COLOUR_SUFFIX[fin];
    if (sfx) {
        const r = trvRoleOfCode(code);
        if (r && r.role === 'TRACK' && !code.includes('/')) return `${baseOf(TRAVERSE_FAMILY_PARTS[r.family].track)}/${sfx}`;
        const base = baseOf(code);
        return code.endsWith(`/${sfx}`) ? code : `${base}/${sfx}`;
    }
    return code.endsWith(`/${fin}`) ? code : `${code}/${fin}`;
};

/**
 * CPQ'S RULES FOR ONE ROW OF ORDER LINES — pure.
 *   · the TRACK and the F-CLIP (the family's cut parts): the sub finish 4.5 aligns to the row's rod finish, unless
 *     the line names its own (CPQ's paint-to-match upcharge); cut from the fascia's length by CPQ's deduction when
 *     the line still carries the fascia's length or none (a quote before 9/19; tab 7). The drive is the line's
 *     (`trvDrive`), MANUAL when it names none — CPQ's own default.
 *   · `swapIdentity` (↻ Re-read only — an explicit, shown step): a part CPQ makes in a stock colour, quoted in a
 *     finish other than its rod's (SO60551's EP4 brackets), becomes the stocked colour item (H1-2TRV-WB/C); a fee
 *     cut into the rod, quoted in another finish, takes the rod's.
 * The ROD is the row's pole line(s) that are not a traverse cut part and name a finish; its finish and cut must be
 * one each, or nothing is derived from them (and the line says why).
 * @param rows [{ idx, line, part }] — every line of the row; `line` carries erp|legacyErpId, finishCode,
 *             cutLength, subFinishCode, trvDrive; `part` the library record (base item)
 * @param finishes 4.5 finish records ([...master_finishes, ...hq_outsource_finishes])
 * @param findByCode UPPERCASE code → library record (the stock-colour item lookup)
 * @returns { patches: { [idx]: fields to set on the line }, changes: [{ idx, code, text }], notes: [{ idx, code, text }], rodFinish, fasciaCut }
 */
export const rowRestampOf = ({ rows = [], finishes = [], swapIdentity = false, findByCode = null } = {}) => {
    const out = { patches: {}, changes: [], notes: [], rodFinish: '', fasciaCut: 0 };
    const items = (rows || []).filter(r => r && r.line).map(r => ({
        ...r, code: codeOfLine(r.line), trv: trvRoleOfCode(codeOfLine(r.line)) || trvRoleOfCode(codeOfPart(r.part)),
        fee: isFeeOf(r.line, r.part),
    }));
    const rods = items.filter(r => !r.trv && !r.fee && U(r.line.finishCode)
        && (isPoleCategory(specsOf(r.part).productType || (r.part && r.part.productType)) || N(r.line.cutLength) > 0));
    const rodFinishes = [...new Set(rods.map(r => U(r.line.finishCode)))];
    const rodCuts = [...new Set(rods.map(r => N(r.line.cutLength)).filter(n => n > 0))];
    const rodFinish = rodFinishes.length === 1 ? rodFinishes[0] : '';
    const fasciaCut = rodCuts.length === 1 ? rodCuts[0] : 0;
    out.rodFinish = rodFinish;
    out.fasciaCut = fasciaCut;
    const alignedSub = subFinishOfFinish(rodFinish, finishes);
    const put = (idx, fields) => { out.patches[idx] = { ...(out.patches[idx] || {}), ...fields }; };
    items.forEach(r => {
        const l = r.line;
        const own = U(l.finishCode);
        if (r.trv) {
            // ── the colour ──
            const ownIsSub = !!own && isSubFinishCode(own, finishes);
            if (!own || ownIsSub) {
                const sub = U(l.subFinishCode) || (ownIsSub ? own : '') || alignedSub;
                if (sub) {
                    if (own !== sub || U(l.subFinishCode) !== sub || !l.toBeFinished)
                        put(r.idx, { finishCode: sub, subFinishCode: sub, finishLabel: `${sub} (sub finish)`, toBeFinished: true, finishOutsourced: false });
                    if (own !== sub) out.changes.push({ idx: r.idx, code: r.code, text: `${r.code}: finished ${sub} — the sub finish 4.5 aligns to ${rodFinish || 'its fascia'} (leaves the floor as ${finishedCodeOf(r.code, sub)})` });
                } else {
                    out.notes.push({ idx: r.idx, code: r.code, text: rodFinishes.length > 1
                        ? `${r.code}: the row's rods take ${rodFinishes.join(' and ')} — which one does the ${r.trv.role === 'TRACK' ? 'track' : 'F-clip'} match?`
                        : rodFinish ? `${r.code}: 4.5 aligns no sub finish to ${rodFinish} — set it on the finish in 4.5`
                            : `${r.code}: no finished fascia in its row to take a sub finish from` });
                }
            }
            // ── the cut ──
            const drive = U(l.trvDrive) || 'MANUAL';
            const cut = N(l.cutLength);
            if (fasciaCut > 0 && (!(cut > 0) || cut === fasciaCut)) {
                const c = traverseCutLength({ fasciaInches: fasciaCut, role: r.trv.role, drive });
                if (c && c !== cut) {
                    put(r.idx, { cutLength: c, trvCutFrom: fasciaCut, trvDrive: drive, trvRole: r.trv.role });
                    out.changes.push({ idx: r.idx, code: r.code, text: `${r.code}: cut ${c}" — the fascia's ${fasciaCut}" less the ${drive.toLowerCase()} ${r.trv.role === 'TRACK' ? 'track' : 'F-clip'} deduction${cut > 0 ? ` (was ${cut}")` : ''}` });
                }
            } else if (!(cut > 0)) {
                out.notes.push({ idx: r.idx, code: r.code, text: `${r.code}: no single fascia length in its row to cut the ${r.trv.role === 'TRACK' ? 'track' : 'F-clip'} from` });
            }
            if (!(out.patches[r.idx] && out.patches[r.idx].trvRole) && U(l.trvRole) !== r.trv.role) put(r.idx, { trvRole: r.trv.role });
            return;
        }
        if (!swapIdentity || !rodFinish) return;
        // ── a part made in the stock colour, quoted in another finish → the stocked colour item ──
        if (!r.fee && specsOf(r.part).usesSubFinish && !isStockColourCode(r.code) && own !== rodFinish && !isSubFinishCode(own, finishes)) {
            if (!alignedSub) { out.notes.push({ idx: r.idx, code: r.code, text: `${r.code}: made in a stock colour, but 4.5 aligns none to ${rodFinish}` }); return; }
            const variant = stockColourVariantOf(r.part, alignedSub, (c) => (typeof findByCode === 'function' ? findByCode(U(c)) : null));
            if (!variant) { out.notes.push({ idx: r.idx, code: r.code, text: `${r.code}: no ${baseOf(r.code)}/${STOCK_COLOUR_SUFFIX[alignedSub] || alignedSub} record in the library` }); return; }
            const vcode = codeOfPart(variant);
            const note = String(l.note || '').replace(/\s*·?\s*TO BE FINISHED\s*·\s*[A-Z0-9-]+/i, '').trim();
            put(r.idx, {
                erp: vcode, billedErp: vcode, partId: variant.id || vcode, finishCode: '', toBeFinished: false, finishOutsourced: false,
                subFinishCode: alignedSub, finishLabel: `${alignedSub} (sub finish)`, stockColour: true, note,
                identityFrom: l.billedErp || (own ? `${r.code}/${own}` : r.code),
            });
            out.changes.push({ idx: r.idx, code: r.code, text: `${l.billedErp || (own ? `${r.code}/${own}` : r.code)} → ${vcode}: made in the stock colour ${alignedSub} aligns to ${rodFinish}, picked from stock — change the NetSuite line to ${vcode} too`, netsuite: true });
            return;
        }
        // ── a fee cut into the rod wears the rod's finish ──
        if (r.fee && own && own !== rodFinish && isFabFee(`${(r.part && r.part.itemName) || ''} ${l.name || ''} ${r.code}`)) {
            put(r.idx, { finishCode: rodFinish, finishFromRod: true, ...(isOutsourcedFinishCode(rodFinish) ? {} : { finishOutsourced: false }) });
            out.changes.push({ idx: r.idx, code: r.code, text: `${r.code}: ${own} → ${rodFinish} — a cut into the rod wears the rod's finish` });
        }
    });
    return out;
};

/**
 * THE CPQ SPLIT'S LINES, BY ROW (HQ/RTGDispatchTab.autoSplitSalesOrder) — the job's breakdown walked in order, each
 * configuration header opening a row, the kept lines given CPQ's traverse rules (never an identity swap — the
 * sales order in NetSuite already carries what the quote named).
 * @param keep    (line) → is it a part (the split's own getJobLines filter)
 * @param partOf  (line) → its library record
 * @param drive   the job's drive (engineeringNotes.drive), MANUAL when it names none
 * @returns { lines, notes }
 */
export const restampBreakdownLines = ({ breakdown = [], keep = () => true, partOf = () => null, finishes = [], drive = '' } = {}) => {
    const rows = [];
    let cur = [];
    (breakdown || []).forEach(l => {
        if (!l) return;
        if (l.isHeader) { if (cur.length) rows.push(cur); cur = []; return; }
        if (keep(l)) cur.push(l);
    });
    if (cur.length) rows.push(cur);
    const lines = [];
    const notes = [];
    rows.forEach(row => {
        const withDrive = row.map(l => (U(drive) && !l.trvDrive ? { ...l, trvDrive: U(drive) } : l));
        const rs = rowRestampOf({ rows: withDrive.map((line, idx) => ({ idx, line, part: partOf(line) })), finishes });
        withDrive.forEach((l, idx) => lines.push(rs.patches[idx] ? { ...l, ...rs.patches[idx] } : l));
        rs.notes.forEach(n => notes.push(n.text));
    });
    return { lines, notes };
};

/**
 * TAB 7'S TRAVERSE KIT, AS ORDER LINES THE FLOOR READS — pure. The explosion (Shared/traverseExplode) says what
 * NetSuite consumes; this says what each consumed part IS on the floor, by the same rules as a CPQ row:
 *   · the fascia — cut at the system's length, finished in the kit's finish (a to-be-finished pole);
 *   · the fascia — the species the kit's stain consumes (S04 → H1-2RCTWR-O, CPQ's speciesVariantOf);
 *   · the track — the library's raw track (the family's rawTrack, what CPQ sells), cut by CPQ's deduction for the
 *     kit's drive, finished in the sub finish 4.5 aligns to the kit's finish; it leaves the floor as H1-2TRVTRK/<B|C>;
 *   · the F-clip — consumed by the foot like the track, cut by its own deduction (−1" / −3"), finished with it;
 *   · a part made in the base colours (the explosion's subFinish lines — the brackets) — the stocked colour item
 *     when the library has it (CPQ's stockColourVariantOf), a shelf pick;
 *   · everything else — a shelf pick, as before.
 * Quantities are NetSuite's (feet for a per-foot part); a per-foot cut part also says its pieces and feet per piece.
 * @param exploded  explodeTraverse(...).lines
 * @param family    the kit's family ('H1-2TRV')
 * @param finish    the kit's finish code (tab 7's trvFinish)
 * @param feet      the system's length in feet (what is cut; the explosion's feet are the billed minimum)
 * @param drive     the kit's drive (MANUAL / MOTORIZED)
 * @param setup     SINGLE / DOUBLE — a double with a track front cuts two tracks
 * @param resolve   (code) → { part, suffix } — tab 7's library resolver
 * @returns [{ code, consumeCode, part, qty, role, why, floor: {…line fields} , finishedCode }]
 */
export const traverseOrderLinesOf = ({ exploded = [], family = 'H1-2TRV', finish = '', feet = 0, drive = 'MANUAL', finishes = [], resolve = null, findByCode = null } = {}) => {
    const P = TRAVERSE_FAMILY_PARTS[family] || {};
    const fin = U(finish);
    const sub = subFinishOfFinish(fin, finishes);
    const finishObj = (finishes || []).find(f => f && U(f.code || f.name) === fin) || null;
    const inches = Math.round(N(feet) * 12 * 100) / 100;
    const res = (code) => (typeof resolve === 'function' ? resolve(code) : { part: (typeof findByCode === 'function' ? findByCode(U(code)) : null), suffix: '' }) || { part: null, suffix: '' };
    const exact = (x) => { const hit = res(x); return hit && hit.part && !hit.suffix ? hit.part : null; };
    // The track and the F-clip: cut from the fascia by CPQ's deduction for their role, finished in the sub finish.
    const cutPart = (c, code, trvRole, qty) => {
        const { part } = res(code);
        const pieces = /^two /i.test(String(c.why || '')) ? 2 : 1;
        const cut = inches > 0 ? traverseCutLength({ fasciaInches: inches, role: trvRole, drive: U(drive) || 'MANUAL' }) : null;
        return {
            ...c, consumeCode: codeOfPart(part) || U(code), part, qty,
            floor: {
                qty: pieces, perFoot: true, feetPer: qty / pieces, billedFeet: qty,
                ...(cut ? { cutLength: cut, trvCutFrom: inches } : {}),
                ...(sub ? { toBeFinished: true, finishCode: sub, subFinishCode: sub, finishLabel: `${sub} (sub finish)` } : {}),
                trvRole, trvDrive: U(drive) || 'MANUAL',
            },
            finishedCode: sub ? finishedCodeOf(code, sub) : U(code),
            ...(sub ? {} : { note: `${fin || 'the kit finish'} has no sub finish aligned in 4.5 — the ${trvRole === 'TRACK' ? 'track' : 'F-clip'} has no colour` }),
        };
    };
    return (exploded || []).map(c => {
        const role = String(c.role || '').toLowerCase();
        const qty = N(c.qty);
        if (role === 'fascia') {
            // THE SPECIES THE STAIN CONSUMES (Stuart 2026-09-28: "fix H1-2RCTWR needs -O") — CPQ's own rule
            // (Shared/sizeMatrix.speciesVariantOf, the finish's bomSuffix in 4.5): S04 → the oak H1-2RCTWR-O.
            const { part: base } = res(c.code);
            const part = speciesVariantOf(base, finishObj, exact) || base;
            const pieces = 1;
            return {
                ...c, consumeCode: codeOfPart(part) || U(c.code), part, qty,
                floor: {
                    qty: pieces, perFoot: true, feetPer: qty / pieces, billedFeet: qty,
                    ...(inches > 0 ? { cutLength: inches } : {}),
                    ...(fin ? { toBeFinished: true, finishCode: fin, ...(isOutsourcedFinishCode(fin) ? { finishOutsourced: true } : {}) } : {}),
                    trvRole: 'FASCIA', trvDrive: U(drive) || 'MANUAL',
                },
                finishedCode: fin ? finishedCodeOf(codeOfPart(part) || c.code, fin) : (codeOfPart(part) || U(c.code)),
            };
        }
        if (role === 'track' && P.rawTrack) return cutPart(c, P.rawTrack, 'TRACK', qty);
        if (role === 'fclip' && P.fclip) return cutPart(c, P.fclip, 'FCLIP', qty);
        const { part, suffix } = res(c.code);
        if (c.subFinish && part && sub) {
            const variant = stockColourVariantOf(part, sub, (x) => {
                const hit = res(x);
                return hit && hit.part && !hit.suffix ? hit.part : null;
            });
            if (variant) return { ...c, consumeCode: codeOfPart(variant), part: variant, qty, floor: { subFinishCode: sub, finishLabel: `${sub} (sub finish)`, stockColour: true }, finishedCode: codeOfPart(variant) };
        }
        return { ...c, consumeCode: codeOfPart(part) || U(c.code), part, qty, floor: {}, finishedCode: codeOfPart(part) || U(c.code), ...(suffix ? { suffix } : {}) };
    });
};
