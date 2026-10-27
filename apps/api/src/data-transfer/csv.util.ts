/**
 * CSV reading and writing for staff import/export.
 *
 * Files go to and come from spreadsheets (Excel, Google Sheets, LibreOffice),
 * so this is deliberately forgiving on the way in and conservative on the way
 * out:
 *  - written as UTF-8 with a byte-order mark, which is what makes Excel show
 *    Sinhala and Tamil names instead of mojibake;
 *  - read with or without the BOM, with CRLF or LF, with quoted fields that
 *    span lines, and with `;` as the separator (what Excel writes in locales
 *    that use a decimal comma).
 */

export const BOM = '﻿';

/**
 * A cell a spreadsheet would run as a formula (`=`, `@`, or `+`/`-` followed
 * by something that isn't a number) gets a leading apostrophe, so an exported
 * name like `=HYPERLINK(...)` is shown as text instead of executed. Phone
 * numbers (`+94 77…`) and negative numbers are left alone.
 */
function neutraliseFormula(value: string): string {
  if (/^[=@\t\r]/.test(value) || /^[+-](?![\d\s(])/.test(value)) return `'${value}`;
  return value;
}

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = neutraliseFormula(value instanceof Date ? value.toISOString() : String(value));
  return /[",\r\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => unknown;
}

export function toCsv<T>(columns: CsvColumn<T>[], rows: T[]): string {
  const lines = [columns.map((c) => csvCell(c.header)).join(',')];
  for (const row of rows) lines.push(columns.map((c) => csvCell(c.value(row))).join(','));
  return BOM + lines.join('\r\n') + '\r\n';
}

/** `Full name`, `full_name` and `FullName` all address the same column. */
export function headerKey(header: string): string {
  return header.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Picks `;` only when the header line clearly uses it, as Excel does in some locales. */
function detectSeparator(text: string): ',' | ';' {
  const firstLine = text.slice(0, text.search(/\r?\n|$/));
  const count = (ch: string) => firstLine.split(ch).length - 1;
  return count(';') > count(',') ? ';' : ',';
}

/** RFC 4180, including quoted fields that contain separators, quotes or newlines. */
export function parseCsv(input: string): string[][] {
  const text = input.startsWith(BOM) ? input.slice(1) : input;
  const sep = detectSeparator(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"' && field === '') {
      inQuotes = true;
    } else if (ch === sep) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  // Blank lines (and spreadsheet rows that are only separators) carry nothing.
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

export interface CsvRecord {
  /** 1-based line in the spreadsheet, counting the header as row 1. */
  rowNumber: number;
  values: Record<string, string>;
}

/** Reads the file into records keyed by headerKey(). Unknown columns are kept, and ignored by the caller. */
export function readCsv(input: string): { headers: string[]; records: CsvRecord[] } {
  const rows = parseCsv(input);
  if (!rows.length) return { headers: [], records: [] };
  const headers = rows[0].map(headerKey);
  const records = rows.slice(1).map((cells, i) => {
    const values: Record<string, string> = {};
    headers.forEach((h, j) => {
      if (h) values[h] = (cells[j] ?? '').trim();
    });
    return { rowNumber: i + 2, values };
  });
  return { headers, records };
}

/**
 * A date as a spreadsheet may have written it: 2024-03-09, 2024/3/9 or
 * 9/3/2024 (day first, as in Sri Lanka). Returns YYYY-MM-DD, or null when it
 * is not a real calendar date.
 */
export function parseDate(value: string): string | null {
  const v = value.trim();
  let y: number, m: number, d: number;
  let match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ].*)?$/.exec(v);
  if (match) [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else {
    match = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(v);
    if (!match) return null;
    [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

/**
 * Matches a cell against an enum, accepting the code itself (`PHONE_CALL`) or
 * the words a person would type (`Phone call`, `phone-call`, `whatsapp`).
 */
export function parseEnum<T extends string>(value: string, allowed: readonly T[]): T | null {
  const key = value.trim().toUpperCase().replace(/[\s-]+/g, '_');
  const squashed = key.replace(/_/g, '');
  return allowed.find((a) => a === key || a.replace(/_/g, '') === squashed) ?? null;
}

/** A list cell: `English; Sinhala` or `English, Sinhala`. */
export function parseList(value: string): string[] {
  return value
    .split(/[;,|]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function sameText(a: string | null | undefined, b: string | null | undefined): boolean {
  return Boolean(a && b) && a!.trim().toLowerCase() === b!.trim().toLowerCase();
}
