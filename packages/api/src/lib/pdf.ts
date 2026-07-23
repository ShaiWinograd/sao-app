import { fileURLToPath } from 'node:url';
import type { CustomerReportPdfModel, WorkerReportPdfModel } from '@workforce/shared';
import { customerReportSummaryColumns } from '@workforce/shared';

// Hebrew-capable line-based PDF builder shared across report endpoints. pdfkit's
// built-in fonts have no Hebrew glyphs, so we embed a Hebrew font (Rubik, OFL).
// pdfkit (via fontkit) applies the bidi algorithm itself, so passing text in
// logical order and right-aligning it renders correctly right-to-left.

// Compiled to packages/api/dist/lib/pdf.js → font lives at packages/api/assets/…
const HEBREW_FONT_PATH = fileURLToPath(new URL('../../assets/fonts/Rubik.ttf', import.meta.url));

// fontkit's bidi reorders RTL runs correctly but drops the neutral space next to
// Hebrew ("דוח לקוח" → "לקוחדוח", "לקוח: דנה" → "לקוחדנה"). Convert a space to a
// non-breaking space whenever it touches Hebrew (directly or across punctuation)
// but NOT when it touches a digit — so numeric/date/time/amount runs keep their
// own left-to-right order and their digits are never reversed. Shared by every
// structured (cell-based) RTL renderer below.
function rtl(s: string): string {
  const isHeb = (c: string) => c >= '\u0590' && c <= '\u05FF';
  const isDigit = (c: string) => c >= '0' && c <= '9';
  let out = '';
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (c === ' ') {
      const l = s[i - 1] ?? '';
      const r = s[i + 1] ?? '';
      if ((isHeb(l) || isHeb(r)) && !isDigit(l) && !isDigit(r)) {
        out += '\u00A0';
        continue;
      }
    }
    out += c;
  }
  return out;
}

export async function buildLinesPdf(title: string, subtitle: string, lines: string[]): Promise<Buffer> {
  const PDFDocument = (await import('pdfkit')).default as any;
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  doc.registerFont('he', HEBREW_FONT_PATH);
  doc.font('he');
  const chunks: Buffer[] = [];

  return await new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(18).text(title, { align: 'right' });
    doc.moveDown(0.3);
    doc.fontSize(11).fillColor('#555555').text(subtitle, { align: 'right' });
    doc.moveDown(1);
    doc.fillColor('#111111').fontSize(11);

    for (const line of lines) {
      doc.text(line, { align: 'right' });
    }
    doc.end();
  });
}

/**
 * Customer-facing report PDF: a proper right-to-left Hebrew document with a
 * structured table (date / job type / workers / billable hours) and a totals
 * block. Each value sits in its own right-aligned cell so Hebrew text and
 * numeric/currency tokens never get reordered against each other.
 */
export async function renderCustomerReportPdf(model: CustomerReportPdfModel): Promise<Buffer> {
  const PDFDocument = (await import('pdfkit')).default as any;
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  doc.registerFont('he', HEBREW_FONT_PATH);
  doc.font('he');
  const chunks: Buffer[] = [];

  return await new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    const contentWidth = right - left;
    const pad = 6;
    const rowH = 24;

    // Header (right-aligned RTL).
    doc.fillColor('#0f172a').fontSize(20).text(rtl(model.title), left, doc.y, { width: contentWidth, align: 'right' });
    doc.moveDown(0.2);
    doc.fontSize(11).fillColor('#64748b');
    for (const s of model.subtitle) {
      doc.text(rtl(s), left, doc.y, { width: contentWidth, align: 'right' });
    }
    doc.moveDown(0.8);

    // Column widths (right-to-left): date, job type, workers, billable hours.
    const colWidths = [110, 150, 80, contentWidth - (110 + 150 + 80)];
    const xOf: number[] = [];
    let cursor = right;
    for (let i = 0; i < colWidths.length; i += 1) {
      xOf[i] = cursor - colWidths[i];
      cursor -= colWidths[i];
    }

    const drawRow = (cells: string[], y: number, opts: { bg?: string; color?: string; size?: number } = {}) => {
      if (opts.bg) {
        doc.save().rect(left, y, contentWidth, rowH).fill(opts.bg).restore();
      }
      doc.fillColor(opts.color ?? '#111111').fontSize(opts.size ?? 11);
      for (let i = 0; i < cells.length; i += 1) {
        doc.text(rtl(cells[i] ?? ''), xOf[i] + pad, y + 7, { width: colWidths[i] - pad * 2, align: 'right', lineBreak: false });
      }
      doc.save().moveTo(left, y + rowH).lineTo(right, y + rowH).lineWidth(0.5).strokeColor('#e2e8f0').stroke().restore();
    };

    let y = doc.y;
    drawRow(model.table.headers, y, { bg: '#f1f5f9', color: '#0f172a', size: 11.5 });
    y += rowH;
    model.table.rows.forEach((row, idx) => {
      drawRow(row, y, { bg: idx % 2 === 1 ? '#f8fafc' : undefined });
      y += rowH;
    });

    // Totals block (RTL): Hebrew label in the right-hand column, the isolated
    // numeric/currency value in the left-hand column.
    y += 16;
    const valueBoxW = 160;
    const labelBoxW = contentWidth - valueBoxW;
    for (const row of customerReportSummaryColumns(model.totals)) {
      const size = row.emphasis ? 13 : 11;
      doc.fontSize(size).fillColor(row.emphasis ? '#0f172a' : '#334155');
      // Label: right-hand column, hugging the right margin.
      doc.text(rtl(row.right), left + valueBoxW + pad, y, { width: labelBoxW - pad * 2, align: 'right', lineBreak: false });
      // Value: left-hand column, kept as one isolated run so bidi stays correct.
      doc.text(rtl(row.left), left + pad, y, { width: valueBoxW - pad * 2, align: 'left', lineBreak: false });
      y += row.emphasis ? 26 : 20;
    }

    doc.end();
  });
}

/**
 * Worker-facing monthly-report PDF: a right-to-left Hebrew document built from
 * the same structured cell approach as {@link renderCustomerReportPdf}. Each
 * date / customer / job type / role / clock-in / clock-out / hours / amount sits
 * in its own right-aligned cell so Hebrew text and numeric/time/currency tokens
 * never reorder against each other under the bidi algorithm. Rendered in
 * landscape to fit the nine columns comfortably. The model is produced by
 * `buildWorkerReportPdfModel`, which reads a stored snapshot verbatim — so a
 * published historical version always renders its own immutable stored values.
 */
export async function renderWorkerReportPdf(model: WorkerReportPdfModel): Promise<Buffer> {
  const PDFDocument = (await import('pdfkit')).default as any;
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 40 });
  doc.registerFont('he', HEBREW_FONT_PATH);
  doc.font('he');
  const chunks: Buffer[] = [];

  return await new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    const contentWidth = right - left;
    const pad = 5;
    const rowH = 26;

    // Header (right-aligned RTL).
    doc.fillColor('#0f172a').fontSize(20).text(rtl(model.title), left, doc.y, { width: contentWidth, align: 'right' });
    doc.moveDown(0.2);

    // Subtitle lines mix a Hebrew label with a month name / year / date. Passing
    // Hebrew and a number in one text run makes bidi either drop the separating
    // space or reverse the digits, and Unicode isolate marks render as tofu in
    // this font. Instead, lay each whitespace-separated token out as its own
    // single-direction text() call, positioned right-to-left — the same isolated
    // approach the table cells rely on — so words and numbers keep their order
    // and the spacing between them is explicit.
    doc.fontSize(11).fillColor('#64748b');
    const lineH = doc.currentLineHeight() + 3;
    const gap = Math.max(doc.widthOfString(' '), 3);
    let sy = doc.y;
    for (const s of model.subtitle) {
      let cursor = right;
      for (const tok of s.split(' ').filter(Boolean)) {
        const tw = doc.widthOfString(tok);
        doc.text(tok, cursor - tw, sy, { lineBreak: false });
        cursor -= tw + gap;
      }
      sy += lineH;
    }
    doc.y = sy;
    doc.moveDown(0.8);

    // Column widths (right-to-left): index 0 renders at the far right.
    // תאריך | לקוחה | סוג עבודה | תפקיד | כניסה | יציאה | שעות נוכחות | שעות לתשלום | סכום
    const fixed = [80, 112, 96, 90, 62, 62, 92, 92];
    const colWidths = [...fixed, contentWidth - fixed.reduce((a, b) => a + b, 0)];
    const xOf: number[] = [];
    let cursor = right;
    for (let i = 0; i < colWidths.length; i += 1) {
      xOf[i] = cursor - colWidths[i];
      cursor -= colWidths[i];
    }

    const drawRow = (cells: string[], y: number, opts: { bg?: string; color?: string; size?: number } = {}) => {
      if (opts.bg) {
        doc.save().rect(left, y, contentWidth, rowH).fill(opts.bg).restore();
      }
      doc.fillColor(opts.color ?? '#111111').fontSize(opts.size ?? 10);
      for (let i = 0; i < cells.length; i += 1) {
        doc.text(rtl(cells[i] ?? ''), xOf[i] + pad, y + 8, { width: colWidths[i] - pad * 2, align: 'right', lineBreak: false });
      }
      doc.save().moveTo(left, y + rowH).lineTo(right, y + rowH).lineWidth(0.5).strokeColor('#e2e8f0').stroke().restore();
    };

    let y = doc.y;
    drawRow(model.table.headers, y, { bg: '#f1f5f9', color: '#0f172a', size: 10.5 });
    y += rowH;
    model.table.rows.forEach((row, idx) => {
      drawRow(row, y, { bg: idx % 2 === 1 ? '#f8fafc' : undefined });
      y += rowH;
    });

    // Summary block (RTL): Hebrew label in the right-hand column, the isolated
    // numeric/currency value in the left-hand column.
    y += 16;
    const valueBoxW = 160;
    const labelBoxW = contentWidth - valueBoxW;
    for (const t of model.totals) {
      const size = t.emphasis ? 13 : 11;
      doc.fontSize(size).fillColor(t.emphasis ? '#0f172a' : '#334155');
      doc.text(rtl(t.label), left + valueBoxW + pad, y, { width: labelBoxW - pad * 2, align: 'right', lineBreak: false });
      doc.text(rtl(t.value), left + pad, y, { width: valueBoxW - pad * 2, align: 'left', lineBreak: false });
      y += t.emphasis ? 26 : 20;
    }

    doc.end();
  });
}

