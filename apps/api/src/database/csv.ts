/**
 * Shared CSV reading for the seeders.
 *
 * The location CSVs come from an external source and are not as tidy as the
 * hand-written ones: line endings are CRLF, headers mix `district id` with
 * `province_id`, "no value" is spelled both `NULL` and ` NULL` (leading space),
 * and a handful of values are wrapped in literal single quotes. All of that is
 * handled here rather than in each loader, so the two cannot disagree about
 * what a field means.
 */

/**
 * Splits one CSV line into fields, honouring RFC-4180 double-quoting.
 * Tolerates a trailing CR so a CRLF file does not leak `\r` into the last value.
 */
export function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char !== '"') {
        current += char;
      } else if (line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = false;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      fields.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

/**
 * Collapses a header cell to a lookup key, so `district id`, `district_id` and
 * `District ID` all address the same column. The source files are not
 * internally consistent about this and are not ours to fix.
 */
export function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * A single cell's value, or null when the file means "empty".
 *
 * The two ways of spelling that are both in use: a bare `NULL` for postcodes,
 * and ` NULL` with a leading space for sub-names - hence trim first, then a
 * case-insensitive compare. Surrounding single quotes are stripped: the 16
 * sub-name values in cities.csv are written as `'Modara'`, and those quotes
 * are part of the data, not CSV quoting.
 */
export function cell(value: string | undefined): string | null {
  const trimmed = (value ?? '').trim();
  if (trimmed === '' || trimmed.toLowerCase() === 'null') return null;
  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/**
 * Reads a CSV into `{ headerKey: value }` records, with the first line treated
 * as the header. Blank lines are dropped; the row number in `where` and in
 * parse errors is 1-based *including* the header, matching what a spreadsheet
 * or `sed` would say, so an error is easy to find in the original file.
 */
export function readCsvRecords(raw: string, where: string): { header: string[]; rows: Record<string, string>[] } {
  const lines = raw.split(/\r?\n/).filter((line) => line.trim() !== '');
  if (!lines.length) throw new Error(`${where} is empty`);

  const header = parseCsvLine(lines[0]).map(normalizeHeader);
  return {
    header,
    rows: lines.slice(1).map((line, index) => {
      const fields = parseCsvLine(line);
      const row: Record<string, string> = {};
      header.forEach((key, i) => {
        row[key] = fields[i] ?? '';
      });
      if (fields.length !== header.length) {
        throw new Error(`${where} row ${index + 2}: expected ${header.length} fields, found ${fields.length}`);
      }
      return row;
    }),
  };
}

/** Throws with the file and row unless every named column is present. */
export function requireColumns(where: string, header: string[], required: string[]): void {
  const missing = required.filter((name) => !header.includes(name));
  if (missing.length) {
    throw new Error(`${where} is missing required column(s): ${missing.join(', ')}. Header was: ${header.join(', ')}`);
  }
}
