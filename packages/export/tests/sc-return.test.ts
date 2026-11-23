import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { renderScReturnCsv, renderScReturnXlsx, type ScReturnRow } from '../src/index.js';

const row: ScReturnRow = {
  prison: 'Fictional Sample Jail',
  prisonerAlias: 'Fictional, "quoted" Alias',
  crimeNumberAndSections: '0007 Fictional',
  admissionOn: '2025-01-01',
  maximumSentence: '360 days',
  totalCustodyDays: 122,
  prisonApplicationToCourtOn: '2025-04-20',
  applicationCourt: 'Fictional Court',
  prisonReferralToDlsaOn: '2025-04-21',
  dlsaReferralToCourtOn: '2025-04-22',
  referralCourt: 'Fictional Court',
  releasedOn: '2025-04-23',
  remarks: '=fictional',
};
const headings = [
  'Serial no.', 'Prison', 'Prisoner identifier (alias)', 'Crime number and sections (police station and district)',
  'Date of jail admission', 'Maximum sentence', 'Total custody across prisons (days)',
  'Prison application to court (date and court)', 'Prison referral to DLSA (date)',
  'DLSA referral to court (date and court)', 'Date of release', 'Reasons if bail refused', 'Remarks',
];

describe('SC section 479 return', () => {
  it('writes a readable XLSX with the reporting columns and an annotated header', async () => {
    const xlsx = await renderScReturnXlsx([row]);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(xlsx.buffer.slice(xlsx.byteOffset, xlsx.byteOffset + xlsx.byteLength) as ArrayBuffer);
    const sheet = workbook.getWorksheet('BNSS s.479 return')!;
    expect(sheet.getRow(1).values).toEqual([, ...headings]);
    expect(sheet.getCell('A1').note).toBe('provisional format v0');
    expect(sheet.getCell('A2').value).toBe(1);
    expect(sheet.getCell('C2').value).toBe(row.prisonerAlias);
    expect(sheet.getCell('D2').value).toBe(row.crimeNumberAndSections);
    expect(sheet.getCell('G2').value).toBe(122);
    expect(sheet.getCell('J2').value).toBe('2025-04-22 — Fictional Court');
    expect(sheet.getCell('M2').value).toBe(row.remarks);
  });

  it('writes the same headings in CSV and quotes data safely', () => {
    const [note, header, data] = renderScReturnCsv([row]).split('\r\n');
    expect(note).toMatch(/^"provisional format v0",/);
    expect(header).toBe(headings.map((heading) => '"' + heading + '"').join(','));
    expect(data).toContain('"Fictional, ""quoted"" Alias"');
    expect(data).toContain('"0007 Fictional"');
    expect(data).toContain('"\'=fictional"');
  });
});
