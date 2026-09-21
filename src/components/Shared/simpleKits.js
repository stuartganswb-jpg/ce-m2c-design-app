// SIMPLE APP KITS FROM A SHEET — one row, one kit, its components across the columns.
//
// Stuart 2026-09-21 (0903/H1-SimpleKits.xlsx): "it details all the items that need to be App Kits
// column A, along with the components." Fifty of them — the H1-138ILJL and H1-2RCT cuff+arm
// brackets, the H1-2TRV wall and ceiling brackets, the H1-138TRV V/H/C brackets, and the acrylic
// and wood finial pairs — each in a mill and a /P version.
//
// These are the BASIC kits: a holder part that carries the price, the customer's alias and the
// customer's pricing, with its pieces beneath it. Not the traverse SYSTEM kits, which carry a
// `kitAlign` and explode from the rules at order time. The distinction is made in exactly one
// place — hardwarePricing.isItemKit — and it is `kitAlign` ABSENT plus `kitComponents` PRESENT that
// makes a row here an item kit. So nothing in this module ever writes kitAlign.
//
// ⚠ WHAT THIS WRITES, AND WHAT IT MUST NOT TOUCH. A kit is an ordinary Approved_Designs record;
// `clientPricing[]`, the customer's `clientSku` aliases and `manufacturingSpecs.fabricut.*` live on
// that SAME record. They were never lost when these kits were re-classed as assemblies — only
// `partClass` changed — so this writes `partClass`, `routingType` and `kitComponents` and NOTHING
// else, with a merge so every sibling field survives untouched. Losing that pricing is the one
// outcome with no undo: the app keeps no version history of a library record.
//
// ⚠ NO NUT. The sheet originally listed H1-2TRVNUT in the twelve H1-2TRV kits. It is already placed
// by the tag engine as a rider on the brackets it belongs to, and tagged hidden in 1.6 — so listing
// it here as well would be a SECOND independent source for the same part, and the bill has no rule
// that drops one when the other fires (the only de-dup works by role, for the pinned carrier). It
// would have been built, picked and pushed to NetSuite twice. Stuart took it off the sheet; this
// module refuses it if it ever comes back.

const U = (v) => String(v == null ? '' : v).trim().toUpperCase();

// Placed by the tag engine, never by a kit. See the note above.
export const RIDER_CODES = ['H1-2TRVNUT'];

export const KIT_READY = 'READY';
export const KIT_NO_ITEM = 'NO_ITEM';
export const KIT_NO_COMPONENTS = 'NO_COMPONENTS';
export const KIT_MISSING = 'MISSING_COMPONENTS';
export const KIT_SELF = 'SELF_REFERENCE';
export const KIT_RIDER = 'RIDER_COMPONENT';
export const KIT_DUPLICATE = 'DUPLICATE_ROW';

/**
 * Sheet rows → kit rows. Header-matched, so a reordered or extra column cannot shift the data:
 * column "Item" is the kit, every "Kit Comp…" column is a component.
 * @param {{header: string, cells: string[]}} table  header row + body rows, already read from the file
 */
export const simpleKitRowsOf = (table) => {
    const head = (table && table.header) || [];
    const itemCol = head.findIndex(h => U(h) === 'ITEM');
    const compCols = head.map((h, i) => (/^KIT\s*COMP/i.test(String(h || '').trim()) ? i : -1)).filter(i => i >= 0);
    if (itemCol < 0 || !compCols.length) return { rows: [], error: 'The sheet needs an "Item" column and at least one "Kit Comp" column.' };
    const rows = ((table && table.cells) || []).map(r => ({
        item: U(r[itemCol]),
        components: compCols.map(i => U(r[i])).filter(Boolean),
    })).filter(r => r.item);
    return { rows, error: '' };
};

/** CODE → library records carrying it, over both identity fields. A list: two records on one code is a fault to SAY. */
export const buildKitCodeIndex = (parts = []) => {
    const m = new Map();
    (parts || []).forEach(p => {
        if (!p) return;
        [p.legacyErpId, p.itemId].forEach(k => {
            const key = U(k);
            if (!key) return;
            const cur = m.get(key);
            if (!cur) m.set(key, [p]);
            else if (!cur.some(x => x.id === p.id)) cur.push(p);
        });
    });
    return m;
};

/**
 * What the sheet would do, decided before anything is written. One result per row, in order.
 * A component named twice in a row becomes qty 2 rather than two lines — quantities multiply
 * through hardwarePricing.kitComponentLines, so two entries of one would double-count it.
 */
export const planSimpleKits = ({ rows = [], parts = [] }) => {
    const index = buildKitCodeIndex(parts);
    const one = (code) => { const hits = index.get(U(code)) || []; return hits.length === 1 ? hits[0] : null; };
    const seen = new Map();
    return (rows || []).map(r => {
        const out = { item: r.item, codes: r.components, kit: null, components: [], missing: [] };
        const kit = one(r.item);
        if (!kit) return { ...out, status: KIT_NO_ITEM, why: `no item carries the code ${r.item}` };
        if (seen.has(r.item)) return { ...out, kit, status: KIT_DUPLICATE, why: `${r.item} is on the sheet more than once` };
        seen.set(r.item, true);
        if (!r.components.length) return { ...out, kit, status: KIT_NO_COMPONENTS, why: 'the row lists no components' };
        if (r.components.some(c => U(c) === U(r.item))) return { ...out, kit, status: KIT_SELF, why: `${r.item} lists itself as a component` };
        const rider = r.components.find(c => RIDER_CODES.includes(U(c)));
        if (rider) return { ...out, kit, status: KIT_RIDER, why: `${rider} is placed by the tag engine — in the kit as well it would be counted twice` };
        const qty = new Map();
        const missing = [];
        r.components.forEach(code => {
            const p = one(code);
            if (!p) { if (!missing.includes(code)) missing.push(code); return; }
            qty.set(p.id, { partId: p.id, code, qty: (qty.get(p.id)?.qty || 0) + 1 });
        });
        if (missing.length) return { ...out, kit, missing, status: KIT_MISSING, why: `not in the library: ${missing.join(', ')}` };
        return { ...out, kit, components: [...qty.values()], status: KIT_READY, why: '' };
    });
};

/** Exactly the field pair a kit record needs. kitAlign is never written — that would make it a SYSTEM kit. */
export const kitPatchOf = (row) => ({
    partClass: 'Kit',
    routingType: '',
    manufacturingSpecs: { kitComponents: row.components.map(c => ({ partId: c.partId, qty: c.qty })) },
});

export const simpleKitSummary = (rows = []) => (rows || []).reduce((m, r) => {
    if (r && r.status) m[r.status] = (m[r.status] || 0) + 1;
    return m;
}, {});

/** The plan in words — every row accounted for, so nothing is skipped silently. */
export const simpleKitPlanText = (rows = []) => {
    const ready = rows.filter(r => r.status === KIT_READY);
    const rest = rows.filter(r => r.status !== KIT_READY);
    return [
        ready.length
            ? `${ready.length} kit(s) will be set:\n${ready.map(r => `  • ${r.item} → ${r.components.map(c => c.qty > 1 ? `${c.code} ×${c.qty}` : c.code).join(' + ')}`).join('\n')}`
            : 'Nothing to write.',
        rest.length ? `\n${rest.length} row(s) will be SKIPPED:\n${rest.map(r => `  • ${r.item} — ${r.why}`).join('\n')}` : '',
        '\npartClass, routingType and the component list are the ONLY fields written. Customer pricing and aliases on these records are not touched.',
    ].filter(Boolean).join('\n');
};
