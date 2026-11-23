import ExcelJS from 'exceljs';
import type { ISODate } from '@courtplus/contracts';

export interface ScReturnRow {
  prison: string;
  prisonerAlias: string;
  crimeNumberAndSections: string;
  admissionOn?: ISODate;
  maximumSentence?: string;
  totalCustodyDays?: number;
  prisonApplicationToCourtOn?: ISODate;
  applicationCourt?: string;
  prisonReferralToDlsaOn?: ISODate;
  dlsaReferralToCourtOn?: ISODate;
  referralCourt?: string;
  releasedOn?: ISODate;
  refusalReasons?: string;
  remarks?: string;
}

const note = 'provisional format v0';
// Supreme Court order of 19 November 2024, paragraph 10, with aliases.
const columns = [
  'Serial no.',
  'Prison',
  'Prisoner identifier (alias)',
  'Crime number and sections (police station and district)',
  'Date of jail admission',
  'Maximum sentence',
  'Total custody across prisons (days)',
  'Prison application to court (date and court)',
  'Prison referral to DLSA (date)',
  'DLSA referral to court (date and court)',
  'Date of release',
  'Reasons if bail refused',
  'Remarks',
];

function courtStep(date: ISODate | undefined, court: string | undefined): string {
  return [date, court].filter(Boolean).join(' — ');
}

function rowValues(row: ScReturnRow, index: number): (string | number | undefined)[] {
  return [
    index + 1, row.prison, row.prisonerAlias, row.crimeNumberAndSections, row.admissionOn,
    row.maximumSentence, row.totalCustodyDays, courtStep(row.prisonApplicationToCourtOn, row.applicationCourt),
    row.prisonReferralToDlsaOn, courtStep(row.dlsaReferralToCourtOn, row.referralCourt), row.releasedOn,
    row.refusalReasons, row.remarks,
  ];
}

export async function renderScReturnXlsx(rows: readonly ScReturnRow[]): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('BNSS s.479 return', { views: [{ state: 'frozen', ySplit: 1 }] });
  const header = sheet.addRow(columns);
  header.font = { bold: true };
  header.alignment = { wrapText: true, vertical: 'middle' };
  header.height = 34;
  header.getCell(1).note = note;
  sheet.columns.forEach((column, index) => {
    column.width = index === 0 ? 12 : 26;
  });
  for (const [index, row] of rows.entries()) sheet.addRow(rowValues(row, index));
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

function csvCell(value: string | number | undefined): string {
  if (typeof value !== 'string') return value === undefined ? '' : String(value);
  // Spreadsheet programs may execute formula-like strings even in quoted fields.
  const text = /^[\s\u0000-\u001f]*[=+\-@]|^[\t\r\n]/.test(value) ? "'" + value : value;
  return '"' + text.replace(/"/g, '""') + '"';
}

export function renderScReturnCsv(rows: readonly ScReturnRow[]): string {
  const noteRow = [note, ...columns.slice(1).map(() => undefined)];
  const records = [noteRow, columns, ...rows.map(rowValues)];
  return records.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
