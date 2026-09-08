// ── REPAINT: FINDING THE PIECES YOU ALREADY OWN IN THE WRONG COLOUR ────────────────────────────
//
// Stuart 2026-09-08: "we do have the ability to paint M3 in house from another color … it is
// easier, faster, cleaner to just pull another color reduce stock and when completed increase
// stock of the painted color."
//
// THE ENGINE ALREADY EXISTED. A "Just For Paint" run with its Pull Pieces From field set does
// exactly this and has since Eric asked for it on 2026-08-12: the Setup Queue pulls the SOURCE
// code, the WMS pick posts −qty of it at pick confirm, and put-away posts +qty of the TARGET into
// the scanned bin. What was missing was never the mechanism — it was that the form lived only on
// the JFP template record and demanded both codes from memory. This module is the missing half:
// given the item you are standing on, which of its own colours could be repainted into it, and how
// many of each are actually on the shelf.
//
// WHY IT IS NOT GATED ON THE SOURCING TAG. The two items that prompted this disagree: HCUMSBF15 is
// tagged in-house (and waits forever on milling we do not do) and HHRMBF75/M3 is tagged outsourced
// (correctly — but we can still paint it here). Both need this. A repaint is a statement about
// what is physically possible on our own paint line, not about how the item is normally procured,
// so reading the procurement tag would refuse the exact cases it exists for.

/** The finish suffix of a code, and the mill base under it. 'HHRMBF75/M3' → { base, finish }. */
export const splitFinish = (erp) => {
    const s = String(erp || '').trim().toUpperCase();
    const i = s.lastIndexOf('/');
    return i > 0 ? { base: s.slice(0, i), finish: s.slice(i + 1) } : { base: s, finish: '' };
};

const esc = (v) => String(v || '').replace(/'/g, "''");

/**
 * Every NetSuite item sharing this mill base — the item's own colours.
 *
 * LIKE '<base>/%' rather than a prefix match on the bare base: 'HHRMBF75' must not drag in
 * 'HHRMBF750'. The base itself is included separately because the unfinished mill item is a
 * legitimate thing to paint from.
 */
export const siblingsQuery = (millBase) => {
    const b = esc(String(millBase || '').toUpperCase());
    return `SELECT Item.id AS id, Item.itemid AS itemid, Item.displayname AS displayname, ` +
        `Item.isinactive AS inactive ` +
        `FROM Item WHERE UPPER(Item.itemid) LIKE '${b}/%' OR UPPER(Item.itemid) = '${b}' ` +
        `ORDER BY Item.itemid`;
};

/** One named item, for the free-entry box. */
export const oneItemQuery = (code) =>
    `SELECT Item.id AS id, Item.itemid AS itemid, Item.displayname AS displayname, Item.isinactive AS inactive ` +
    `FROM Item WHERE UPPER(Item.itemid) = '${esc(String(code || '').toUpperCase())}'`;

/**
 * Shape the rows for the picker: the target itself is never offered as its own source, inactive
 * items are dropped, and each row carries the live available quantity the caller read.
 *
 * SORTED BY WHAT IS ACTUALLY THERE. The only question being answered is "which colour can I take
 * eight of today", so the colours that can answer it sort first; everything else follows
 * alphabetically and is shown greyed rather than hidden — knowing a colour exists but is empty is
 * worth more than a shorter list.
 */
export const shapeSources = ({ rows = [], targetCode = '', availByCode = {}, need = 0 }) => {
    const target = String(targetCode || '').toUpperCase();
    const want = Math.max(0, Math.floor(Number(need) || 0));
    return rows
        .filter(r => r && r.itemid)
        .map(r => ({
            code: String(r.itemid).toUpperCase(),
            nsId: String(r.id),
            name: String(r.displayname || ''),
            inactive: String(r.inactive || '') === 'T',
            finish: splitFinish(r.itemid).finish,
            available: Math.max(0, Number(availByCode[String(r.itemid).toUpperCase()]) || 0),
        }))
        .filter(r => r.code !== target && !r.inactive)
        .map(r => ({ ...r, enough: want > 0 && r.available >= want }))
        .sort((a, b) => (b.enough - a.enough) || (b.available - a.available) || a.code.localeCompare(b.code));
};

/**
 * Is this repaint describable and stockable? Returns { ok, error }.
 *
 * STOCK IS A REFUSAL, NOT A WARNING (Stuart 2026-09-08: allow a free-typed item "if it returns
 * back as valid netsuite part (with sufficient stock)"). A repaint against stock that is not there
 * is the same class of defect as the pole gate that parked on material nobody had ordered — the
 * pick would simply fail, two weeks later, in front of somebody holding a scanner.
 */
export const validateRepaint = ({ sourceCode, targetCode, qty, available, sourceKnown = true }) => {
    const src = String(sourceCode || '').trim().toUpperCase();
    const tgt = String(targetCode || '').trim().toUpperCase();
    const n = Number(qty);
    if (!src) return { ok: false, error: 'Choose the colour the pieces come from, or type a NetSuite item #.' };
    if (!sourceKnown) return { ok: false, error: `NetSuite has no item called "${src}". Check the spelling — the pick adjusts this item out of stock, so it has to be right.` };
    if (!tgt) return { ok: false, error: 'No target item — this is the code the painted pieces are adjusted into.' };
    if (src === tgt) return { ok: false, error: 'The source and the target are the same item. Pick a different colour to paint from.' };
    if (!Number.isFinite(n) || n <= 0 || Math.floor(n) !== n) return { ok: false, error: 'Enter a whole quantity of 1 or more.' };
    const have = Math.max(0, Number(available) || 0);
    if (have < n) return { ok: false, error: `${src} has ${have} available — not enough for ${n}. Pick a colour with the stock, or lower the quantity.` };
    return { ok: true, error: '' };
};

/** The sentence every screen shows for one of these. */
export const repaintDescription = ({ sourceCode, targetCode, finishLabel, qty }) => {
    const parts = [`${Math.max(1, Math.floor(Number(qty) || 1))} × ${String(sourceCode || '').toUpperCase()} → ${String(targetCode || '').toUpperCase()}`];
    if (String(finishLabel || '').trim()) parts.push(String(finishLabel).trim());
    return parts.join(' · ');
};

export const REPAINT_BADGE = 'REPAINT';
