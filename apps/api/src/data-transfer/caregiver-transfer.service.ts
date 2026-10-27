import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, like, or, type SQL } from 'drizzle-orm';
import { randomUUID as uuid } from 'crypto';
import { DRIZZLE, type Database } from '../database/database.module';
import {
  caregivers,
  caregiverLanguages,
  caregiverSkills,
  civilStatusEnum,
  contactMethodEnum,
  experiences,
  genderEnum,
  languages,
  skills,
  users,
} from '../database/schema';
import { generateRegistrationNumber } from '../caregivers/caregiver-creation.util';
import { resolveLocationRefs } from '../common/utils/location.util';
import { normalizePhone, phoneVariants } from '../common/utils/phone.util';
import { WhatsappSettingsService } from '../whatsapp/whatsapp-settings.service';
import { parseDate, parseEnum, parseList, readCsv, sameText, toCsv, type CsvColumn } from './csv.util';
import {
  LocationMatcher,
  MAX_IMPORT_ROWS,
  textCell,
  type ColumnSpec,
  type ImportIssue,
  type ImportReport,
  type ImportRowResult,
} from './import-types';
import { headerKey } from './csv.util';
import type { CaregiverExportDto } from './dto/transfer.dto';

/**
 * The caregiver spreadsheet: one row per caregiver. The same columns are
 * written by the export and read by the import, so an exported file (or the
 * blank template) can be filled in and brought straight back; the export-only
 * columns (registration number, status, created...) are ignored on the way in.
 */
export const CAREGIVER_COLUMNS: ColumnSpec[] = [
  { key: 'registrationNumber', header: 'Registration number', exportOnly: true },
  { key: 'status', header: 'Status', exportOnly: true },
  { key: 'fullName', header: 'Full name', required: true, max: 255 },
  { key: 'nic', header: 'NIC', max: 20 },
  { key: 'passportNumber', header: 'Passport number', max: 20 },
  { key: 'dateOfBirth', header: 'Date of birth', required: true },
  { key: 'gender', header: 'Gender', required: true },
  { key: 'civilStatus', header: 'Civil status', required: true },
  { key: 'primaryPhone', header: 'Primary phone', required: true, max: 20 },
  { key: 'secondaryPhone', header: 'Secondary phone', max: 20 },
  { key: 'preferredContactMethod', header: 'Preferred contact' },
  { key: 'permanentAddress', header: 'Permanent address', required: true, max: 2000 },
  { key: 'district', header: 'District' },
  { key: 'city', header: 'City' },
  { key: 'postalCode', header: 'Postal code', exportOnly: true },
  { key: 'policeDivision', header: 'Police division', max: 100 },
  { key: 'policeStation', header: 'Police station', max: 100 },
  { key: 'emergencyContactName', header: 'Emergency contact name', required: true, max: 255 },
  { key: 'emergencyContactNumber', header: 'Emergency contact number', required: true, max: 20 },
  { key: 'emergencyContactRelationship', header: 'Emergency contact relationship', required: true, max: 100 },
  { key: 'heightIn', header: 'Height (inches)' },
  { key: 'weightKg', header: 'Weight (kg)' },
  { key: 'skills', header: 'Skills' },
  { key: 'languages', header: 'Languages' },
  { key: 'experienceYears', header: 'Experience (years)', exportOnly: true },
  { key: 'accountEmail', header: 'Sign-in email', exportOnly: true },
  { key: 'createdAt', header: 'Created', exportOnly: true },
];

const col = (key: string) => CAREGIVER_COLUMNS.find((c) => c.key === key)!;
const keyOf = (c: ColumnSpec) => headerKey(c.header);

/** The example row in the template: shows the formats without being a real person. */
const TEMPLATE_EXAMPLE: Record<string, string> = {
  fullName: 'Example Perera',
  nic: '199012345678',
  dateOfBirth: '1990-05-14',
  gender: 'FEMALE',
  civilStatus: 'MARRIED',
  primaryPhone: '0771234567',
  preferredContactMethod: 'WHATSAPP',
  permanentAddress: '12 Temple Road, Kandy',
  district: 'Kandy',
  city: 'Kandy',
  emergencyContactName: 'Sunil Perera',
  emergencyContactNumber: '0712345678',
  emergencyContactRelationship: 'Husband',
  heightIn: '62',
  weightKg: '58',
  skills: 'Bathing Assistance; Dementia Care',
  languages: 'Sinhala; English',
};

type ExportRow = Record<string, unknown>;

interface PreparedCaregiver {
  values: typeof caregivers.$inferInsert;
  skillIds: string[];
  languageIds: string[];
  phoneKeys: string[];
}

@Injectable()
export class CaregiverTransferService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly whatsappSettings: WhatsappSettingsService,
  ) {}

  template(): string {
    const columns = CAREGIVER_COLUMNS.filter((c) => !c.exportOnly);
    return toCsv<Record<string, string>>(
      columns.map((c) => ({ header: c.header, value: (r) => r[c.key] ?? '' })),
      [TEMPLATE_EXAMPLE],
    );
  }

  async export(filter: CaregiverExportDto): Promise<{ csv: string; count: number }> {
    const conditions: SQL[] = [isNull(caregivers.deletedAt)];
    if (filter.search) {
      const term = `%${filter.search}%`;
      conditions.push(or(like(caregivers.fullName, term), like(caregivers.registrationNumber, term), like(caregivers.primaryPhone, term), like(caregivers.nic, term))!);
    }
    if (filter.status) conditions.push(eq(caregivers.status, filter.status));
    if (filter.districtId) conditions.push(eq(caregivers.districtId, filter.districtId));

    const rows = await this.db
      .select({ c: caregivers, accountEmail: users.email })
      .from(caregivers)
      .leftJoin(users, eq(caregivers.userId, users.id))
      .where(and(...conditions))
      .orderBy(asc(caregivers.registrationNumber));
    const ids = rows.map((r) => r.c.id);

    const [skillRows, languageRows, experienceRows] = ids.length
      ? await Promise.all([
          this.db
            .select({ caregiverId: caregiverSkills.caregiverId, name: skills.name })
            .from(caregiverSkills)
            .innerJoin(skills, eq(caregiverSkills.skillId, skills.id))
            .where(inArray(caregiverSkills.caregiverId, ids)),
          this.db
            .select({ caregiverId: caregiverLanguages.caregiverId, name: languages.name })
            .from(caregiverLanguages)
            .innerJoin(languages, eq(caregiverLanguages.languageId, languages.id))
            .where(inArray(caregiverLanguages.caregiverId, ids)),
          this.db
            .select({ caregiverId: experiences.caregiverId, startDate: experiences.startDate, endDate: experiences.endDate })
            .from(experiences)
            .where(inArray(experiences.caregiverId, ids)),
        ])
      : [[], [], []];

    const group = (list: { caregiverId: string; name: string }[]) => {
      const map = new Map<string, string[]>();
      for (const r of list) map.set(r.caregiverId, [...(map.get(r.caregiverId) ?? []), r.name]);
      return map;
    };
    const skillMap = group(skillRows);
    const languageMap = group(languageRows);
    const monthsMap = new Map<string, number>();
    for (const e of experienceRows) {
      const start = new Date(e.startDate);
      const end = e.endDate ? new Date(e.endDate) : new Date();
      const months = Math.max(0, (end.getFullYear() - start.getFullYear()) * 12 + end.getMonth() - start.getMonth());
      monthsMap.set(e.caregiverId, (monthsMap.get(e.caregiverId) ?? 0) + months);
    }

    const day = (d: Date | string | null) => (d ? (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10) : '');
    const data: ExportRow[] = rows.map(({ c, accountEmail }) => ({
      ...c,
      dateOfBirth: day(c.dateOfBirth),
      skills: (skillMap.get(c.id) ?? []).sort().join('; '),
      languages: (languageMap.get(c.id) ?? []).sort().join('; '),
      experienceYears: monthsMap.has(c.id) ? Math.round((monthsMap.get(c.id)! / 12) * 10) / 10 : '',
      accountEmail: accountEmail ?? '',
      createdAt: c.createdAt ? new Date(c.createdAt).toISOString().replace('T', ' ').slice(0, 16) : '',
    }));
    const columns: CsvColumn<ExportRow>[] = CAREGIVER_COLUMNS.map((c) => ({ header: c.header, value: (r) => r[c.key] }));
    return { csv: toCsv(columns, data), count: data.length };
  }

  /**
   * Checks every row and - unless this is a dry run - creates the ones that
   * pass. Rows are independent: one bad row never stops the rest, and a row
   * that matches someone already on the platform (NIC, passport, phone or
   * registration number) is skipped rather than overwriting them. Imported
   * caregivers start as Draft, like a caregiver added by hand.
   */
  async import(text: string, dryRun: boolean): Promise<ImportReport> {
    const { headers, records } = readCsv(text);
    const known = new Set(CAREGIVER_COLUMNS.map(keyOf));
    const report: ImportReport = {
      dryRun,
      total: records.length,
      ready: 0,
      created: 0,
      duplicates: 0,
      errors: 0,
      ignoredColumns: headers.filter((h) => h && !known.has(h)),
      missingColumns: CAREGIVER_COLUMNS.filter((c) => c.required && !headers.includes(keyOf(c))).map((c) => c.header),
      rows: [],
    };
    if (report.missingColumns.length || records.length > MAX_IMPORT_ROWS) return report;

    const cc = await this.whatsappSettings.getDefaultCountryCode();
    const [locations, skillList, languageList] = await Promise.all([
      LocationMatcher.load(this.db),
      this.db.select({ id: skills.id, name: skills.name }).from(skills),
      this.db.select({ id: languages.id, name: languages.name, code: languages.code }).from(languages),
    ]);
    // Who appears in this file so far, so the second copy of a person is caught too.
    const seen = new Map<string, number>();

    for (const record of records) {
      const errors: ImportIssue[] = [];
      const warnings: ImportIssue[] = [];
      const v = record.values;
      const result: ImportRowResult = { row: record.rowNumber, name: v[keyOf(col('fullName'))] || '', outcome: 'READY', errors, warnings };
      report.rows.push(result);

      const prepared = this.prepare(v, errors, warnings, cc, locations, skillList, languageList);
      if (prepared) {
        const fileKeys = [
          prepared.values.nic && `nic:${prepared.values.nic.toUpperCase()}`,
          prepared.values.passportNumber && `passport:${prepared.values.passportNumber.toUpperCase()}`,
          ...prepared.phoneKeys.map((p) => `phone:${p}`),
        ].filter(Boolean) as string[];
        const earlier = fileKeys.map((k) => seen.get(k)).find((r) => r !== undefined);
        if (earlier !== undefined) errors.push({ code: 'duplicateFile', params: { row: earlier } });
        else fileKeys.forEach((k) => seen.set(k, record.rowNumber));

        const match = errors.length ? null : await this.findExisting(prepared, v[keyOf(col('registrationNumber'))]);
        if (match) {
          result.outcome = 'DUPLICATE';
          errors.push({ code: 'duplicate', column: match.column, params: { match: `${match.registrationNumber} · ${match.fullName}` } });
        }
      }

      if (result.outcome === 'DUPLICATE') {
        report.duplicates++;
        continue;
      }
      if (errors.length || !prepared) {
        result.outcome = 'ERROR';
        report.errors++;
        continue;
      }
      if (dryRun) {
        report.ready++;
        continue;
      }
      try {
        const created = await this.create(prepared);
        Object.assign(result, { outcome: 'CREATED', id: created.id, reference: created.registrationNumber });
        report.created++;
      } catch (err) {
        result.outcome = 'ERROR';
        errors.push({ code: 'failed', params: { message: (err as Error).message?.slice(0, 200) ?? '' } });
        report.errors++;
      }
    }
    return report;
  }

  private prepare(
    v: Record<string, string>,
    errors: ImportIssue[],
    warnings: ImportIssue[],
    cc: string,
    locations: LocationMatcher,
    skillList: { id: string; name: string }[],
    languageList: { id: string; name: string; code: string | null }[],
  ): PreparedCaregiver | null {
    const text = (key: string) => textCell(v, col(key), errors, keyOf);
    const fullName = text('fullName');
    const nic = text('nic')?.toUpperCase() ?? null;
    if (nic && !/^[0-9]{9}[VX]$|^[0-9]{12}$/i.test(nic)) errors.push({ code: 'invalid', column: col('nic').header, value: nic });
    const passportNumber = text('passportNumber')?.toUpperCase() ?? null;

    const dobRaw = text('dateOfBirth');
    const dateOfBirth = dobRaw ? parseDate(dobRaw) : null;
    if (dobRaw && (!dateOfBirth || dateOfBirth > new Date().toISOString().slice(0, 10))) errors.push({ code: 'invalid', column: col('dateOfBirth').header, value: dobRaw });

    const enumCell = <T extends string>(key: string, allowed: readonly T[]): T | null => {
      const raw = text(key);
      if (!raw) return null;
      const parsed = parseEnum(raw, allowed);
      if (!parsed) errors.push({ code: 'invalid', column: col(key).header, value: raw, params: { allowed: allowed.join(', ') } });
      return parsed;
    };
    const gender = enumCell('gender', genderEnum);
    const civilStatus = enumCell('civilStatus', civilStatusEnum);
    const preferredContactMethod = enumCell('preferredContactMethod', contactMethodEnum);
    if (preferredContactMethod === 'EMAIL') errors.push({ code: 'needsEmail', column: col('preferredContactMethod').header });

    const phoneCell = (key: string) => {
      let raw = text(key);
      if (!raw) return null;
      // A spreadsheet that reads 0771234567 as a number drops the 0.
      if (/^7\d{8}$/.test(raw)) {
        raw = `0${raw}`;
        warnings.push({ code: 'fixedPhone', column: col(key).header, value: raw });
      }
      if (raw.replace(/\D/g, '').length < 9) errors.push({ code: 'invalid', column: col(key).header, value: raw });
      return raw;
    };
    const primaryPhone = phoneCell('primaryPhone');
    const secondaryPhone = phoneCell('secondaryPhone');
    const emergencyContactNumber = phoneCell('emergencyContactNumber');

    const numberCell = (key: string, max: number, integer: boolean) => {
      const raw = text(key);
      if (!raw) return null;
      const n = Number(raw.replace(',', '.'));
      if (!Number.isFinite(n) || n <= 0 || n > max || (integer && !Number.isInteger(n))) {
        errors.push({ code: 'invalid', column: col(key).header, value: raw });
        return null;
      }
      return n;
    };
    const heightIn = numberCell('heightIn', 120, false);
    const weightKg = numberCell('weightKg', 300, true);

    const location = locations.resolve(v[keyOf(col('district'))] ?? '', v[keyOf(col('city'))] ?? '', warnings, { district: col('district').header, city: col('city').header });

    const pick = <T extends { id: string; name: string; code?: string | null }>(key: string, list: T[]) => {
      const ids: string[] = [];
      for (const name of parseList(v[keyOf(col(key))] ?? '')) {
        const found = list.find((x) => sameText(x.name, name) || sameText(x.code ?? null, name));
        if (found) {
          if (!ids.includes(found.id)) ids.push(found.id);
        } else warnings.push({ code: 'notFound', column: col(key).header, value: name });
      }
      return ids;
    };
    const skillIds = pick('skills', skillList);
    const languageIds = pick('languages', languageList);

    const values = {
      fullName,
      nic,
      passportNumber,
      dateOfBirth,
      gender,
      civilStatus,
      primaryPhone,
      secondaryPhone,
      preferredContactMethod,
      permanentAddress: text('permanentAddress'),
      policeDivision: text('policeDivision'),
      policeStation: text('policeStation'),
      emergencyContactName: text('emergencyContactName'),
      emergencyContactNumber,
      emergencyContactRelationship: text('emergencyContactRelationship'),
      heightIn,
      weightKg,
      districtId: location.districtId,
      cityId: location.cityId,
    };
    if (errors.length) return null;

    const e164 = normalizePhone(primaryPhone, cc);
    const phoneKeys = e164 ? phoneVariants(e164, cc) : [primaryPhone!];
    return {
      values: {
        id: '',
        publicId: '',
        registrationNumber: '',
        fullName: values.fullName!,
        permanentAddress: values.permanentAddress!,
        nic: values.nic,
        passportNumber: values.passportNumber,
        // 'YYYY-MM-DD' straight through, as CaregiversService.create does.
        dateOfBirth: values.dateOfBirth as unknown as Date,
        gender: values.gender!,
        civilStatus: values.civilStatus!,
        heightIn: values.heightIn,
        weightKg: values.weightKg,
        primaryPhone: values.primaryPhone!,
        secondaryPhone: values.secondaryPhone,
        emergencyContactName: values.emergencyContactName!,
        emergencyContactNumber: values.emergencyContactNumber!,
        emergencyContactRelationship: values.emergencyContactRelationship!,
        policeDivision: values.policeDivision,
        policeStation: values.policeStation,
        preferredContactMethod: values.preferredContactMethod,
        districtId: values.districtId,
        cityId: values.cityId,
        status: 'DRAFT',
        autoNotifyRequests: false,
      },
      skillIds,
      languageIds,
      phoneKeys: [...new Set([primaryPhone!, ...phoneKeys])],
    };
  }

  /** Someone already on the platform: the same registration number, NIC, passport or primary phone (any spelling). */
  private async findExisting(p: PreparedCaregiver, registrationNumber?: string) {
    const checks: [string, SQL | undefined][] = [
      [col('registrationNumber').header, registrationNumber ? and(eq(caregivers.registrationNumber, registrationNumber), isNull(caregivers.deletedAt)) : undefined],
      [col('nic').header, p.values.nic ? eq(caregivers.liveNic, p.values.nic) : undefined],
      [col('passportNumber').header, p.values.passportNumber ? eq(caregivers.livePassportNumber, p.values.passportNumber) : undefined],
      [col('primaryPhone').header, inArray(caregivers.livePrimaryPhone, p.phoneKeys)],
    ];
    for (const [column, where] of checks) {
      if (!where) continue;
      const [row] = await this.db.select({ registrationNumber: caregivers.registrationNumber, fullName: caregivers.fullName }).from(caregivers).where(where).limit(1);
      if (row) return { column, ...row };
    }
    return null;
  }

  private async create(p: PreparedCaregiver) {
    return this.db.transaction(async (tx) => {
      const txDb = tx as unknown as Database;
      const location = await resolveLocationRefs(txDb, { districtId: p.values.districtId, cityId: p.values.cityId });
      const id = uuid();
      const registrationNumber = await generateRegistrationNumber(txDb);
      await tx.insert(caregivers).values({
        ...p.values,
        id,
        publicId: uuid(),
        registrationNumber,
        district: location?.district ?? null,
        city: location?.city ?? null,
        postalCode: location?.postalCode ?? null,
      });
      if (p.skillIds.length) await tx.insert(caregiverSkills).values(p.skillIds.map((skillId) => ({ caregiverId: id, skillId })));
      if (p.languageIds.length) await tx.insert(caregiverLanguages).values(p.languageIds.map((languageId) => ({ caregiverId: id, languageId })));
      return { id, registrationNumber };
    });
  }
}
