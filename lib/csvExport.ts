// Plain CSV rather than a real .xlsx: Excel opens .csv natively (no
// "unsupported format" prompt), and it avoids pulling in a spreadsheet
// library — the popular one for this (`xlsx`/SheetJS on npm) currently
// ships unfixed high-severity advisories.
export function downloadCsv(filename: string, rows: Record<string, string | number>[]) {
  if (rows.length === 0) return;

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
  const blob = new Blob(['﻿' + lines.join('\r\n')], {
    type: 'text/csv;charset=utf-8;',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
