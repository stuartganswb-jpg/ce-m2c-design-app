// Build a US-Letter plating-order PDF (pdf-lib) from a stored packingList snapshot, for emailing to a
// plater. Returns PDF bytes; downloadPlatingOrderPdf() saves it so the operator can attach it to an email
// (the app has no server-side mail, so sending is via the operator's mail client).
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

// Strip characters Helvetica's WinAnsi encoding can't draw (arrows, emoji, etc.) to avoid pdf-lib throwing.
const A = (v) => String(v == null ? '' : v).replace(/[^\x00-\xFF]/g, '');

export async function buildPlatingOrderPdf({ shipId, brand, vendor, poLabel, dateStr, operator, lines = [], pcs, total, finishSummary, expectedReceiveDate }) {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const W = 612, H = 792, M = 40;
    const totalPcs = pcs != null ? pcs : lines.reduce((s, l) => s + (parseInt(l.qty) || 0), 0);
    const ink = rgb(0, 0, 0), soft = rgb(0.4, 0.4, 0.4);
    let page = pdf.addPage([W, H]);
    let y = H - M;
    const text = (s, x, yy, size = 10, f = font, color = ink) => page.drawText(A(s), { x, y: yy, size, font: f, color });

    text('PLATING PACKING LIST', M, y - 6, 18, bold);
    text(`${A(brand)}  ->  ${A(vendor || 'Plater')}     ${A(dateStr)}`, M, y - 22, 10, font, soft);
    y -= 36;
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1.5, color: ink });
    y -= 22;

    const meta = [['Shipment', shipId], ['NetSuite PO', poLabel || '-'], ['Plater', vendor || '-'], ['Finish(es)', finishSummary || '-'], ['Lines / Pieces', `${lines.length} / ${totalPcs}`], ['Prepared by', operator || '-'], ['Plating Total', total != null ? `$${Number(total).toFixed(2)}` : '-'], ['Expected Back', expectedReceiveDate || '-']];
    let my = y;
    meta.forEach((m, i) => {
        const col = i % 2;
        const x = M + col * ((W - 2 * M) / 2);
        if (col === 0 && i > 0) my -= 32;
        text(m[0].toUpperCase(), x, my, 7, bold, soft);
        text(m[1], x, my - 13, 10, font, ink);
    });
    y = my - 34;

    // Unit Cost + Amount after Qty (Stuart 2026-08-13) — what we pay the vendor per piece/line.
    const cols = [{ k: '#', x: M }, { k: 'Item', x: M + 20 }, { k: 'Description', x: M + 92 }, { k: 'Finish', x: M + 212 }, { k: 'Returns As', x: M + 250 }, { k: 'Bin', x: M + 338 }, { k: 'WO#', x: M + 382 }, { k: 'Qty', x: M + 420 }, { k: 'Unit Cost', x: M + 448 }, { k: 'Amount', x: M + 494 }];
    const drawHeader = () => {
        page.drawRectangle({ x: M, y: y - 4, width: W - 2 * M, height: 16, color: rgb(0.93, 0.93, 0.93) });
        cols.forEach(c => text(c.k.toUpperCase(), c.x + 2, y, 7, bold, soft));
        y -= 18;
    };
    drawHeader();
    lines.forEach((l, i) => {
        if (y < M + 70) { page = pdf.addPage([W, H]); y = H - M; drawHeader(); }
        text(String(i + 1), cols[0].x + 2, y, 8.5);
        text(A(l.erpId).slice(0, 14), cols[1].x + 2, y, 8.5);
        text(A(l.itemName).slice(0, 27), cols[2].x + 2, y, 8.5);
        text(A(l.finishCode).slice(0, 7), cols[3].x + 2, y, 8.5);
        text(A(l.targetErpId).slice(0, 17), cols[4].x + 2, y, 8.5);
        text(A(l.platingBin).slice(0, 8), cols[5].x + 2, y, 8.5);
        text(A(l.woNum).slice(0, 7), cols[6].x + 2, y, 8.5);
        text(String(parseInt(l.qty) || 0), cols[7].x + 2, y, 8.5);
        const lineRate = parseFloat(l.rate) || 0;
        text(lineRate ? `$${lineRate.toFixed(2)}` : '-', cols[8].x + 2, y, 8.5);
        text(lineRate ? `$${(lineRate * (parseInt(l.qty) || 0)).toFixed(2)}` : '-', cols[9].x + 2, y, 8.5);
        y -= 14;
        page.drawLine({ start: { x: M, y: y + 4 }, end: { x: W - M, y: y + 4 }, thickness: 0.4, color: rgb(0.85, 0.85, 0.85) });
    });
    y -= 8;
    text(`TOTAL PIECES: ${totalPcs}`, W - M - 130, y, 10, bold);
    y -= 44;
    text('Shipped by / date: ___________________', M, y, 9, font, soft);
    text('Received by plater / date: ___________________', M + 270, y, 9, font, soft);

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
