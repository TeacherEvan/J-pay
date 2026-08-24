export function sanitizeCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) {
    return `'${s}`;
  }
  return s;
}

function escapeQuoted(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export function toCsv(headers: string[], rows: (string | number | boolean | null | undefined)[][]): string {
  const lines = [headers.map((h) => escapeQuoted(sanitizeCell(h))).join(",")];
  for (const row of rows) {
    lines.push(row.map((cell) => escapeQuoted(sanitizeCell(cell))).join(","));
  }
  return lines.join("\r\n");
}
