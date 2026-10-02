// ── THE HARDWARE THAT COMES WITH SOMETHING — NEVER THE CUSTOMER'S CHOICE (Stuart 2026-10-02) ────────
// QUO188: "the hidden parts like the fclip hanger and such should not be reflected on the quote, ok on Bom but
// not the quote, it becomes confusing for customers." Decided the same day: drop the CLIPS, the PLUGS and the
// STOPPERS; keep the CARRIERS ("they need to see/confirm selection"); keep a kit's included brackets and plates
// (his 09-03 rule — "all included components of kit at $0.00").
//
// Which lines those are is a fact the SAVE knows and the paperwork does not: on a saved order a line carries
// no role, so an F-clip reads exactly like a part somebody chose. So the save marks them (`autoPart`,
// Shared/hardwareHandoff) and the money documents leave a marked line off while it bills nothing
// (Shared/lineClassification.customerDocLines). The BOM, the router, the packing slip, the pick, the floors and
// NetSuite read every line as before.
//   · an F-clip hanger — the track's hanger (role FCLIP: "never chosen, always built")
//   · a traverse end PLUG — the manual end the drive answer settles (role TRV_END, an end plug). A motorised end
//     is a real choice with a price, so it is not on this list.
//   · an END STOPPER, a traverse chart component (and a plug, should the chart carry one)
// Pure. Harness: scripts/autoParts.test.mjs.

const U = (v) => String(v == null ? '' : v).trim().toUpperCase();
const codeOf = (l) => U((l && (l.legacyErpId || l.billedId || l.code || l.partId)) || '');

export function isAutoPartLine(l) {
    if (!l) return false;
    const role = U(l.role);
    const code = codeOf(l);
    if (role === 'FCLIP') return true;
    if (role === 'TRV_END' && /PLUG/.test(code)) return true;
    if (l.trvComponent && /ENDSTOP|PLUG/.test(code)) return true;
    return false;
}

/** May a customer's money document leave this line off? Only while it bills nothing. */
export const leftOffCustomerPaper = (l) => !!(l && l.autoPart === true) && !(Number(l.total) > 0);
