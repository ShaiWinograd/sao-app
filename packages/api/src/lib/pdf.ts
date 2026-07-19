import { fileURLToPath } from 'node:url';

// Hebrew-capable line-based PDF builder shared across report endpoints. pdfkit's
// built-in fonts have no Hebrew glyphs, so we embed a Hebrew font (Rubik, OFL).
// pdfkit (via fontkit) applies the bidi algorithm itself, so passing text in
// logical order and right-aligning it renders correctly right-to-left.

// Compiled to packages/api/dist/lib/pdf.js → font lives at packages/api/assets/…
const HEBREW_FONT_PATH = fileURLToPath(new URL('../../assets/fonts/Rubik.ttf', import.meta.url));

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
