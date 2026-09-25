export type CsvCell = string | number | null | undefined;

/** Texto CSV para Excel en español: separador ";", coma decimal y BOM para que respete los acentos. */
export function toCsv(rows: CsvCell[][]) {
  const cell = (v: CsvCell) => {
    if (v == null) return '';
    const s = typeof v === 'number' ? String(v).replace('.', ',') : v;
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + rows.map((r) => r.map(cell).join(';')).join('\r\n');
}

/** Baja la tabla como archivo .csv (se abre con Excel). */
export function downloadCsv(filename: string, rows: CsvCell[][]) {
  const url = URL.createObjectURL(new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
