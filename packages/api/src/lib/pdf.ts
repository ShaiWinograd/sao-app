// Minimal line-based PDF builder shared across report endpoints. Mirrors the
// approach already used for management reports (pdfkit, default font).
export async function buildLinesPdf(title: string, subtitle: string, lines: string[]): Promise<Buffer> {
  const PDFDocument = (await import('pdfkit')).default as any;
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  const chunks: Buffer[] = [];

  return await new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(18).text(title);
    doc.moveDown(0.3);
    doc.fontSize(11).fillColor('#555555').text(subtitle);
    doc.moveDown(1);
    doc.fillColor('#111111').fontSize(11);

    for (const line of lines) {
      doc.text(line);
    }
    doc.end();
  });
}
