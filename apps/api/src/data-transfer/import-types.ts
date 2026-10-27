import { asc } from 'drizzle-orm';
import type { Database } from '../database/database.module';
import { cities, districts } from '../database/schema';
import { sameText } from './csv.util';

/** The largest file and number of rows one import takes. */
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 2000;

/**
 * Problems are codes plus the column they concern, not sentences: the staff
 * app words them in the reader's language (en/si/ta), and the column is shown
 * as it appears in the spreadsheet header.
 *
 *  required      - a required column is empty
 *  invalid       - the value can't be read (a bad date, an unknown option, too long...)
 *  tooLong       - longer than the column allows (param: max)
 *  duplicate     - already on the platform (param: match = the record it matches)
 *  duplicateFile - the same person appears earlier in this file (param: row)
 *  notFound      - a district, city, skill or language that doesn't exist (a warning: left blank)
 *  needsEmail    - "Email" chosen as the preferred contact without an email address
 *  needsContact  - neither an email nor a phone for a client
 *  fixedPhone    - a phone number that lost its leading 0 in a spreadsheet, restored (warning)
 *  failed        - the database refused the row at import time
 */
export type IssueCode =
  | 'required'
  | 'invalid'
  | 'tooLong'
  | 'duplicate'
  | 'duplicateFile'
  | 'notFound'
  | 'needsEmail'
  | 'needsContact'
  | 'fixedPhone'
  | 'failed';

export interface ImportIssue {
  code: IssueCode;
  column?: string;
  value?: string;
  params?: Record<string, string | number>;
}

export type ImportRowOutcome = 'READY' | 'CREATED' | 'DUPLICATE' | 'ERROR';

export interface ImportRowResult {
  row: number;
  name: string;
  outcome: ImportRowOutcome;
  errors: ImportIssue[];
  warnings: ImportIssue[];
  /** The new record, once created. */
  id?: string;
  reference?: string;
}

export interface ImportReport {
  dryRun: boolean;
  total: number;
  ready: number;
  created: number;
  duplicates: number;
  errors: number;
  /** Columns in the file that aren't part of the template and were ignored. */
  ignoredColumns: string[];
  /** Required columns the header doesn't have at all. */
  missingColumns: string[];
  rows: ImportRowResult[];
}

export interface ColumnSpec {
  key: string;
  header: string;
  required?: boolean;
  /** Written on export, ignored on import (status, created date...). */
  exportOnly?: boolean;
  max?: number;
}

/** District and city names, in any of the three languages, to their ids. */
export class LocationMatcher {
  private constructor(
    private readonly districtRows: { id: number; nameEn: string; nameSi: string; nameTa: string }[],
    private readonly cityRows: { id: number; districtId: number; nameEn: string; nameSi: string; nameTa: string }[],
  ) {}

  static async load(db: Database) {
    const [d, c] = await Promise.all([
      db.select({ id: districts.id, nameEn: districts.nameEn, nameSi: districts.nameSi, nameTa: districts.nameTa }).from(districts).orderBy(asc(districts.id)),
      db.select({ id: cities.id, districtId: cities.districtId, nameEn: cities.nameEn, nameSi: cities.nameSi, nameTa: cities.nameTa }).from(cities).orderBy(asc(cities.id)),
    ]);
    return new LocationMatcher(d, c);
  }

  private static named(row: { nameEn: string; nameSi: string; nameTa: string }, name: string) {
    // "Colombo District" and "Colombo" are the same district.
    const bare = name.replace(/\s+district$/i, '');
    return [row.nameEn, row.nameSi, row.nameTa].some((n) => sameText(n, name) || sameText(n, bare));
  }

  /**
   * Resolves the pair the way the forms do: a city must belong to its
   * district; a city alone is enough when its name is unique. Anything that
   * can't be matched becomes a warning and the location is left blank.
   */
  resolve(districtName: string, cityName: string, warnings: ImportIssue[], headers: { district: string; city: string }) {
    let districtId: number | null = null;
    let cityId: number | null = null;
    if (districtName) {
      districtId = this.districtRows.find((d) => LocationMatcher.named(d, districtName))?.id ?? null;
      if (!districtId) warnings.push({ code: 'notFound', column: headers.district, value: districtName });
    }
    if (cityName) {
      const matches = this.cityRows.filter((c) => LocationMatcher.named(c, cityName) && (!districtId || c.districtId === districtId));
      if (matches.length === 1 || (matches.length > 1 && districtId)) {
        cityId = matches[0].id;
        districtId = districtId ?? matches[0].districtId;
      } else {
        warnings.push({ code: 'notFound', column: headers.city, value: cityName });
      }
    }
    return { districtId, cityId };
  }
}

/** Checks a text cell against its column; empty optional cells become null. */
export function textCell(values: Record<string, string>, col: ColumnSpec, errors: ImportIssue[], keyOf: (c: ColumnSpec) => string): string | null {
  const v = values[keyOf(col)] ?? '';
  if (!v) {
    if (col.required) errors.push({ code: 'required', column: col.header });
    return null;
  }
  if (col.max && v.length > col.max) {
    errors.push({ code: 'tooLong', column: col.header, params: { max: col.max } });
    return null;
  }
  return v;
}
