// ── A PAINT-RUN PULL TAKES THE PIECES OUT OF THE BIN NETSUITE HOLDS THEM IN (Stuart 2026-10-14) ──────────────────────
// A "just for paint" job pulls finished or raw pieces off the shelf to repaint them; at pick confirm the WMS takes them
// out of NetSuite (an inventory adjustment, −qty at the bin), and packing puts the repainted pieces back in. Nine of
// those adjustments failed between 10-09 and 10-13, five ways — and the floor never knew:
//   · the scan was sent as typed and upper-cased — "PRODUCTION STOCK", "WANDS" — where NetSuite's bins are
//     "Production Stock" and "Wands", and NetSuite matches a bin's name exactly
//   · a line with no bin accepted any scan, so a typo ("UNASSIGND") went to NetSuite
//   · a pull with no bin went with no bin at all ("configure the inventory detail")
//   · NetSuite held fewer than were pulled (2 in the bin, 3 pulled)
//   · the item's NetSuite record was an INACTIVE KIT — nothing can be adjusted on it
// The WMS already reads each bin's NetSuite id and true name (fetchLiveBins). The rule: read the item's bins fresh at
// the moment of the pull, find the scanned bin among them, and send its ID. When NetSuite cannot take the pull — the
// bins could not be read, it holds none of the item here, none in the bin scanned, or fewer than were pulled — no
// adjustment is sent and the person is told what NetSuite is short. The pick itself always goes ahead.
// Pure. scripts/jfpPull.test.mjs asserts it.

const S = (v) => String(v == null ? '' : v).trim();
const U = (v) => S(v).toUpperCase();

/**
 * @param scanned  the bin the picker scanned or typed
 * @param qty      how many were pulled
 * @param live     the item's fresh read ({ bins: [{ bin (upper-cased), name, id, qty }], known }); null = the read failed
 * @returns { ok: true, bin: { id, name } } | { ok: false, why }
 */
export function jfpPullBinOf({ scanned = '', qty = 0, live = null } = {}) {
    const want = Number(qty) || 0;
    if (!(want > 0)) return { ok: false, why: 'nothing was pulled' };
    if (!live) return { ok: false, why: 'NetSuite\'s bins for this item could not be read just now' };
    const bins = Array.isArray(live.bins) ? live.bins.filter(b => b && Number(b.qty) > 0) : [];
    if (!live.known || !bins.length) return { ok: false, why: 'NetSuite shows none of this item in any bin here (it may be an inactive or kit record, or never received)' };
    const holds = bins.map(b => `${b.name || b.bin} ${b.qty}`).join(', ');
    const s = U(scanned);
    if (!s || s === 'UNASSIGNED') return { ok: false, why: `no bin was scanned — NetSuite holds it in ${holds}` };
    const hit = bins.find(b => U(b.bin) === s || U(b.name) === s);
    if (!hit) return { ok: false, why: `NetSuite shows none in "${S(scanned)}" — it holds ${holds}` };
    if (Number(hit.qty) < want) return { ok: false, why: `NetSuite holds only ${hit.qty} in ${hit.name || hit.bin}, ${want} were pulled` };
    return { ok: true, bin: { id: S(hit.id), name: S(hit.name || hit.bin) } };
}

/** The adjustment: −qty of the item at the location, out of the bin by its NetSuite id (its exact name only when no id was read). */
export const jfpAdjustmentOf = ({ nsId, qty, bin, subsidiary, location, memo = '' }) => ({
    account: { id: '254' }, subsidiary: { id: S(subsidiary) }, memo,
    inventory: { items: [{
        item: { id: S(nsId) }, location: { id: S(location) }, adjustQtyBy: -Number(qty),
        inventoryDetail: { quantity: -Number(qty), inventoryAssignment: { items: [{ binNumber: bin.id ? { id: S(bin.id) } : { refName: S(bin.name) }, quantity: -Number(qty) }] } },
    }] },
});

/** What the person is told when no adjustment is sent. `done` = what was recorded anyway ('Pick recorded', 'Scrap recorded'…). */
export const jfpSkipText = ({ code = '', qty = 0, ref = '', why = '', done = 'Pick recorded' }) =>
    `${done} — but NetSuite was NOT adjusted for −${qty} × ${code} (${ref}): ${why}.\n\nThe pieces are off the shelf; NetSuite still counts them. Tell the office — it needs a NetSuite adjustment by hand.`;

// ── THE SAME RULE FOR EVERY PULL OUT OF A BIN (Stuart 2026-10-14: "go ahead and fix the other bin issues") ──────────
// The packing scrap adjustment sent the library's stored home bin, upper-cased; the substitute pull sent the bin typed
// into a prompt, upper-cased — the same fault as the paint-run pull. Both now read fresh and send the bin's NetSuite id.
export const pullBinOf = jfpPullBinOf;
export const adjustmentOutOf = jfpAdjustmentOf;
export const notAdjustedText = jfpSkipText;
