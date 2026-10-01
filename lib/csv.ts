// Plain CSV rather than a real .xlsx: Excel opens .csv natively (no
// "unsupported format" prompt), and it avoids pulling in a spreadsheet
// library — the popular one for this (`xlsx`/SheetJS on npm) currently
// ships unfixed high-severity advisories. Pure string-building, so it
// works both in the browser (lib/csvExport.ts) and in a server-side route
// (e.g. an emailed report attachment).
export function buildCsvString(rows: Record<string, string | number>[]): string {
  if (rows.length === 0) return '';

  const headers = Object.keys(rows[0]);

  function escapeCell(value: string | number) {
    const str = String(value);
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  }

  const lines = [
    headers.join(','),
    ...rows.map((row) => headers.map((h) => escapeCell(row[h])).join(',')),
  ];

  // Leading BOM so Excel detects UTF-8 correctly instead of mangling
  // non-ASCII characters like the peso sign.
  return '﻿' + lines.join('\r\n');
}
