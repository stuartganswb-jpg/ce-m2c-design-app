// ── ASSEMBLY BUILD ON THE WMS — STOCK AN ASSEMBLY THE WAY NETSUITE MAKES ONE (Stuart 2026-09-30) ──────────────
// "i want to put in the H1-TTB1 but realize on wms we only have bin count which does adjustments and the proper way to
//  put these in stock is with an assembly build, can you add a tab for that, should look just like the bin count but
//  do an assembly build."
//
// A bin count ADJUSTS: it says the stock is there and moves nothing else. An assembly build CONSUMES the components
// from their bins and RECEIVES the assembly into its bin — the same record NetSuite's own "Build Assembly" makes. The
// tab posts through the CE Convert RESTlet (netsuite/ce_convert_build_restlet.js, script 2848) that the Convert tab
// already proves: NetSuite sources the component list from the assembly's BOM, each component is consumed from the
// bin it really sits in, the assembly is received into the scanned bin. Its CHECK mode (diag) returns what NetSuite
// WOULD consume without saving — the review shows exactly that, never a guess. Pure. scripts/assemblyBuild.test.mjs.

const U = (v) => String(v == null ? '' : v).trim().toUpperCase();
const N = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const codeOfPart = (p) => U(p && (p.legacyErpId || p.itemId));

/** The items that can be built: Assembly-class library records with a NetSuite id, matching the search. */
export const buildablePartsOf = (parts = [], search = '') => {
    const q = String(search || '').trim().toLowerCase();
    return (parts || []).filter(p => p && p.partClass === 'Assembly' && p.netSuiteInternalId && !p.isRetired && !p.retired
        && (!q || codeOfPart(p).toLowerCase().includes(q) || String(p.itemName || '').toLowerCase().includes(q)));
};

/**
 * NetSuite's answer to a CHECK, as the review shows it: one row per component line it will consume.
 * @param diag        the RESTlet's diag lines ({ item, qtyUsed, useBinId, srcOnhand, detailed, error, cancelled })
 * @param findByNsId  NetSuite internal id → library record
 * @param binsByCode  code → [{ id, name|bin, qty }] (the WMS live bin read)
 * @returns [{ code, name, qty, bin, onHand, ok, why }]
 */
export const buildPreviewOf = ({ diag = [], findByNsId = () => null, binsByCode = {} } = {}) => (diag || [])
    .filter(l => l && N(l.qtyUsed) > 0 && !l.cancelled)
    .map(l => {
        const part = findByNsId(String(l.item));
        const code = part ? codeOfPart(part) : `NetSuite item ${l.item}`;
        const bins = binsByCode[code] || [];
        const b = l.useBinId ? bins.find(x => String(x.id) === String(l.useBinId)) : null;
        const onHand = l.srcOnhand == null ? null : N(l.srcOnhand);
        const qty = N(l.qtyUsed);
        // A line that takes no bin (a service/charge line NetSuite lists on the BOM) consumes no stock: it is fine.
        const binless = !l.useBinId && l.detailed !== true && !l.error;
        const short = !binless && (onHand == null || onHand < qty);
        return {
            code, name: (part && part.itemName) || '', qty,
            bin: b ? (b.name || b.bin) : (l.useBinId ? `bin ${l.useBinId}` : (binless ? '—' : 'no stock found')),
            onHand, ok: !short && !l.error,
            why: l.error ? String(l.error) : (short ? (onHand == null ? 'no stock of it at this location' : `only ${onHand} in that bin`) : ''),
        };
    });

/** The memo NetSuite carries: who built it, and the note — the whole text also goes to the app log. */
export const buildMemoOf = ({ by = '', note = '' } = {}) => `Assembly build by ${by || 'WMS'}${String(note || '').trim() ? ` — ${String(note).trim()}` : ''}`;

/** A row the operator may post: a whole number above 0 and a bin to receive into. */
export const buildRowError = (row) => {
    const q = Number(row && row.qty);
    if (!(Number.isInteger(q) && q > 0)) return 'enter how many to build (a whole number)';
    if (!String((row && row.toBin) || '').trim()) return 'scan the bin the built pieces go into';
    return '';
};
