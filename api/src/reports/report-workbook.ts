import ExcelJS from 'exceljs';
import { REPORT_EXPORT_COLUMNS, REPORT_EXPORT_SHEET, reportExportRows, type Report } from '@app/shared';

export const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Classeur de l'export Excel du Rapport (contenu fixé par `shared/`, E22). */
export async function buildReportWorkbook(report: Report): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(REPORT_EXPORT_SHEET);
  sheet.columns = REPORT_EXPORT_COLUMNS.map(({ header, width }) => ({ header, width }));
  sheet.addRows(reportExportRows(report));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
