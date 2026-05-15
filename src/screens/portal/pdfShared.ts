// Shared formatting helpers and PDF style tokens, used by both the
// CorporateStatementPDF and the new InvoicePDF.

export const pdfGreen = '#2A9A47';
export const pdfHoneydew = '#E6F4EA';
export const pdfSlate = '#5B6B7A';
export const pdfBorder = '#EBEBEB';
export const pdfBorderW = 1;

export const bRight = { borderRightWidth: pdfBorderW, borderRightColor: pdfBorder, borderRightStyle: 'solid' as const };
export const bBottom = { borderBottomWidth: pdfBorderW, borderBottomColor: pdfBorder, borderBottomStyle: 'solid' as const };
export const bAll = { borderWidth: pdfBorderW, borderColor: pdfBorder, borderStyle: 'solid' as const };

export function fmtMonthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-SG', { month: 'long', year: 'numeric' });
}

// Normalize any ISO 8601 / Supabase timestamptz → "YYYY-MM-DD HH:MM:SS"
export function fmtDateTime(s: string): string {
  if (!s) return '';
  return s
    .replace('T', ' ')
    .replace(/\.\d+/, '')
    .replace(/[Zz]$/, '')
    .replace(/[+-]\d{2}:\d{2}$/, '')
    .slice(0, 19);
}

export function fmtKwh(n: number): string {
  return n.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtAmt(n: number): string {
  return `$${n.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function fmtRate(n: number): string {
  return `$${Number(n).toFixed(3)}`;
}
