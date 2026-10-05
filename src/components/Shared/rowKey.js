// The row a sales-order line belongs to, and the key its record is written under — a leaf, so the display
// rules (Shared/displayRelease), the release counts (Shared/rowRelease) and the WMS readers (Shared/pickLines)
// all read ONE definition without importing each other. Pure.

const U = (v) => String(v == null ? '' : v).trim().toUpperCase();

/** "Row 2" → "ROW_2": the field key a row's run is recorded under on the sales order. */
export const rowKeyOf = (label) => U(label).replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');

/** The row a sales-order line belongs to. `row` when it was written with one (a CPQ display
 *  order); otherwise the memo the operator typed on an Order Entry line ("Row 2"). */
export const rowOfLine = (line) => String((line && (line.row || line.memo)) || '').trim();
