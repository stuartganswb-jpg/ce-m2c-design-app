// US-Letter plating PURCHASE ORDER PDF (pdf-lib) — the downloadable twin of the branded print
// form in platingPackingList.js (Stuart 2026-08-13: "the pdf button is stripped of some of the
// matching formatting?"). Same layout language as the tab-11 forms: serif display type (Times ≈
// Cormorant in pdf-lib's standard fonts), Courier for the mono labels/codes, the app palette,
// paper-2 shaded meta cells, brass Returns-As column, totals box, signature lines, shared footer.
// downloadPlatingOrderPdf() names the file "<Vendor> <NetSuite PO#>.pdf".
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { BRAND_NAMES, COMPANY_ADDRESS, BRAND_CONTACT } from './platingPackingList.js';

// Strip characters WinAnsi encoding can't draw (arrows, emoji, etc.) to avoid pdf-lib throwing.
const A = (v) => String(v == null ? '' : v).replace(/[^\x00-\xFF]/g, '');

// The app palette, as pdf-lib colors.
const INK = rgb(0.11, 0.102, 0.086);
const SOFT = rgb(0.322, 0.306, 0.275);
const BRASS = rgb(0.69, 0.553, 0.341);
const PAPER2 = rgb(0.949, 0.937, 0.91);
const HAIR = rgb(0.87, 0.86, 0.84);

export async function buildPlatingOrderPdf({ shipId, brand, vendor, poLabel, dateStr, operator, lines = [], pcs, total, finishSummary, expectedReceiveDate }) {
    const pdf = await PDFDocument.create();
    const serif = await pdf.embedFont(StandardFonts.TimesRoman);
    const serifBold = await pdf.embedFont(StandardFonts.TimesRomanBold);
    const mono = await pdf.embedFont(StandardFonts.Courier);
    const monoBold = await pdf.embedFont(StandardFonts.CourierBold);
    const sans = await pdf.embedFont(StandardFonts.Helvetica);
    const sansBold = await pdf.embedFont(StandardFonts.HelveticaBold);

    const W = 612, H = 792, M = 40;
    const totalPcs = pcs != null ? pcs : lines.reduce((s, l) => s + (parseInt(l.qty) || 0), 0);
    const brandKey = String(brand || '').toLowerCase();
    const company = BRAND_NAMES[brandKey] || String(brand || 'Company');
    const contact = BRAND_CONTACT[brandKey] || {};

    let page = pdf.addPage([W, H]);
    let y = H - M;
    const text = (s, x, yy, size = 9, f = sans, color = INK) => page.drawText(A(s), { x, y: yy, size, font: f, color });
    const rightText = (s, xRight, yy, size, f, color) => { const t = A(s); text(t, xRight - f.widthOfTextAtSize(t, size), yy, size, f, color); };

    // ── Company block (left) + document title (right) ─────────────────────────────────────────
    text(company.toUpperCase(), M, y - 14, 21, serifBold);
    text(COMPANY_ADDRESS, M, y - 27, 7, mono, SOFT);
    const contactLine = [contact.web, contact.phone].filter(Boolean).join('  ·  ');
    if (contactLine) text(contactLine, M, y - 37, 7, mono, SOFT);
    rightText('Plating Purchase Order', W - M, y - 12, 18, serif);
    rightText(poLabel || shipId || '', W - M, y - 27, 12, monoBold);
    rightText(dateStr || '', W - M, y - 38, 8, mono, SOFT);
    y -= 48;
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1.6, color: INK });
    y -= 14;

    // ── Meta cells (paper-2 boxes, 3 × 2 — same fields as the print form) ─────────────────────
    const meta = [
        ['Vendor / Plater', vendor || '—'], ['Shipment', shipId || '—'], ['Finish(es)', finishSummary || '—'],
        ['Lines / Pieces', `${lines.length} / ${totalPcs}`], ['Prepared By', operator || '—'], ['Expected Back', expectedReceiveDate || ' '],
    ];
    const cellW = (W - 2 * M - 16) / 3, cellH = 30;
    meta.forEach((m, i) => {
        const cx = M + (i % 3) * (cellW + 8);
        const cy = y - cellH - Math.floor(i / 3) * (cellH + 6);
        page.drawRectangle({ x: cx, y: cy, width: cellW, height: cellH, color: PAPER2, borderColor: HAIR, borderWidth: 0.6 });
        text(m[0].toUpperCase(), cx + 6, cy + cellH - 10, 6, mono, SOFT);
        text(String(m[1]).slice(0, 34), cx + 6, cy + 7, 9.5, sansBold);
    });
    y -= 2 * cellH + 6 + 16;

    // ── Line table — header band + hairline rows, brass Returns-As, money right-aligned ───────
    const cols = [
        { k: '#', x: M }, { k: 'Item', x: M + 20 }, { k: 'Description', x: M + 92 }, { k: 'Finish', x: M + 212 },
        { k: 'Returns As', x: M + 250 }, { k: 'Bin', x: M + 338 }, { k: 'WO#', x: M + 382 }, { k: 'Qty', x: M + 420 },
        { k: 'Unit Cost', x: M + 448 }, { k: 'Amount', x: M + 494 },
    ];
    const drawHeader = () => {
        page.drawRectangle({ x: M, y: y - 5, width: W - 2 * M, height: 17, color: PAPER2 });
        cols.forEach(c => text(c.k.toUpperCase(), c.x + 2, y, 6.5, mono, SOFT));
        y -= 19;
    };
    drawHeader();
    lines.forEach((l, i) => {
        if (y < M + 110) { page = pdf.addPage([W, H]); y = H - M; drawHeader(); }
        const qty = parseInt(l.qty) || 0;
        const rate = parseFloat(l.rate) || 0;
        text(String(i + 1), cols[0].x + 2, y, 8.5, sans);
        text(A(l.erpId).slice(0, 13), cols[1].x + 2, y, 8, mono);
        text(A(l.itemName).slice(0, 27), cols[2].x + 2, y, 8.5, sans);
        text(A(l.finishCode).slice(0, 6), cols[3].x + 2, y, 8, mono);
        text(A(l.targetErpId).slice(0, 16), cols[4].x + 2, y, 8, monoBold, BRASS);
        text(A(l.platingBin).slice(0, 8), cols[5].x + 2, y, 8, mono);
        text(A(l.woNum).slice(0, 7), cols[6].x + 2, y, 8, mono);
        rightText(String(qty), cols[8].x - 6, y, 8.5, sans);
        rightText(rate ? `$${rate.toFixed(2)}` : '-', cols[9].x - 6, y, 8.5, sans);
        rightText(rate ? `$${(rate * qty).toFixed(2)}` : '-', W - M - 2, y, 8.5, sans);
        y -= 14;
        page.drawLine({ start: { x: M, y: y + 4.5 }, end: { x: W - M, y: y + 4.5 }, thickness: 0.4, color: HAIR });
    });
    y -= 10;

    // ── Totals box (right), matching the print form's shaded block ────────────────────────────
    const tW = 210, tH = (total != null && Number(total) > 0) ? 44 : 26;
    page.drawRectangle({ x: W - M - tW, y: y - tH, width: tW, height: tH, color: PAPER2, borderColor: HAIR, borderWidth: 0.6 });
    text('TOTAL PIECES', W - M - tW + 8, y - 15, 7, mono, SOFT);
    rightText(String(totalPcs), W - M - 8, y - 15, 10, sansBold);
    if (total != null && Number(total) > 0) {
        page.drawLine({ start: { x: W - M - tW + 8, y: y - 22 }, end: { x: W - M - 8, y: y - 22 }, thickness: 0.6, color: HAIR });
        text('Plating Total', W - M - tW + 8, y - 36, 12, serifBold);
        rightText(`$${Number(total).toFixed(2)}`, W - M - 8, y - 36, 12, serifBold);
    }
    y -= tH + 34;

    // ── Signature lines + shared footer ───────────────────────────────────────────────────────
    const half = (W - 2 * M - 44) / 2;
    [['SHIPPED BY / DATE', M], ['RECEIVED BY PLATER / DATE', M + half + 44]].forEach(([label, x]) => {
        page.drawLine({ start: { x, y }, end: { x: x + half, y }, thickness: 0.8, color: INK });
        text(label, x, y - 10, 6.5, mono, SOFT);
    });
    const foot = [company, COMPANY_ADDRESS, contact.web, contact.phone].filter(Boolean).join('  ·  ');
    page.drawLine({ start: { x: M, y: M + 16 }, end: { x: W - M, y: M + 16 }, thickness: 0.5, color: HAIR });
    text(foot, (W - mono.widthOfTextAtSize(A(foot), 6.5)) / 2, M + 5, 6.5, mono, SOFT);

    return await pdf.save();
}

// Generate + download the order PDF. Returns the filename so the caller can tell the operator what to attach.
export async function downloadPlatingOrderPdf(data) {
    const bytes = await buildPlatingOrderPdf(data);
    // FILENAME = "<Vendor> <NetSuite PO#>" (Stuart 2026-08-13) — what the vendor's inbox reads.
    const fname = `${A(`${String(data.vendor || 'Plater').trim()} ${String(data.poLabel || data.shipId || '').trim()}`).replace(/[\\/:*?"<>|]/g, '-')}.pdf`;
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = fname;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 8000);
    return fname;
}
