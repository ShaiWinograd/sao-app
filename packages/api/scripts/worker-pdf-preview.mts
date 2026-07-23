// Throwaway preview: render the structured worker monthly-report PDF from a
// representative snapshot so the RTL layout can be eyeballed / screenshotted.
// Not part of the build. Run with: npx tsx scripts/worker-pdf-preview.mts
import { writeFileSync } from 'node:fs';
import { buildWorkerReportPdfModel, projectWorkerFacingReport } from '@workforce/shared';
import { renderWorkerReportPdf } from '../src/lib/pdf.js';

const projected = projectWorkerFacingReport({
  shifts: [
    { shiftId: 's1', date: '2026-07-02', customerName: 'משפחת כהן', shiftLabel: 'אריזה', roleLabel: 'עובדת', clockIn: '09:05', clockOut: '13:58', approvedHours: '4.88', paidHours: 5, pay: '450' },
    { shiftId: 's2', date: '2026-07-09', customerName: 'משפחת לוי', shiftLabel: 'פריקה', roleLabel: 'ראש צוות', clockIn: '08:00', clockOut: '12:15', approvedHours: '4.25', paidHours: 4, pay: '360' },
    { shiftId: 's3', date: '2026-07-16', customerName: 'משפחת מזרחי', shiftLabel: 'סידור', roleLabel: 'עובדת', clockIn: '10:00', clockOut: '15:30', approvedHours: '5.5', paidHours: 5.5, pay: '495' },
  ],
  summary: { shiftsCount: 3, totalApprovedHours: '14.63', totalPaidHours: 14.5, total: '1305' },
});

const model = buildWorkerReportPdfModel(
  { workerName: 'נועה וינוגרד', month: 7, year: 2026, version: 2, publishedAt: '2026-07-22T09:00:00.000Z' },
  projected,
);

const pdf = await renderWorkerReportPdf(model);
writeFileSync('/tmp/worker-report-preview.pdf', pdf);
console.log('wrote /tmp/worker-report-preview.pdf', pdf.length, 'bytes');
