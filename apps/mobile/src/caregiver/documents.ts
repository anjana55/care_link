import type { CaregiverDocument, DocumentType, VerificationStatus } from '@care-platform/shared';

/**
 * The rules of the caregiver's document upload, as on the website's
 * /caregiver/documents page. Kept apart from the camera and file code so they
 * can be checked without a phone. The API checks everything again - including
 * that the bytes really are the type they claim - so nothing here is relied on
 * for safety; it only catches the common mistakes before a slow upload.
 */

/** The API's limit (STORAGE_MAX_FILE_SIZE_BYTES, 10 MB by default). */
export const MAX_BYTES = 10 * 1024 * 1024;

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};
const EXTENSION_BY_MIME: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
/** What the file picker offers: the four types the API accepts. */
export const PICKABLE_TYPES = Object.keys(EXTENSION_BY_MIME);

/** What staff look for before they can verify a registration. */
export const CORE: { label: 'identity' | 'police' | 'gn'; anyOf: DocumentType[] }[] = [
  { label: 'identity', anyOf: ['NIC', 'PASSPORT'] },
  { label: 'police', anyOf: ['POLICE_CLEARANCE'] },
  { label: 'gn', anyOf: ['GRAMA_NILADHARI_CERTIFICATE'] },
];

/**
 * What the caregiver picks when uploading: the documents staff need, plus
 * "Other". "Proof of identity" then asks which ID it is, so a passport is
 * never filed as an NIC.
 */
export const CHOICES = ['identity', 'police', 'gn', 'other'] as const;
export type Choice = (typeof CHOICES)[number];
export const ID_KINDS = ['NIC', 'PASSPORT'] as const;
export type IdKind = (typeof ID_KINDS)[number];

export function documentTypeFor(choice: Choice, idKind: IdKind): DocumentType {
  switch (choice) {
    case 'identity':
      return idKind;
    case 'police':
      return 'POLICE_CLEARANCE';
    case 'gn':
      return 'GRAMA_NILADHARI_CERTIFICATE';
    case 'other':
      return 'OTHER';
  }
}

/** Passports, police clearances and "other" documents can run out; we remind the caregiver before they do. */
export const asksExpiry = (choice: Choice, idKind: IdKind) => (choice === 'identity' && idKind === 'PASSPORT') || choice === 'police' || choice === 'other';

/** The core documents not uploaded yet (a rejected one still counts as uploaded - it is listed with its own message). */
export function missingCore(documents: { documentType: string }[]): (typeof CORE)[number]['label'][] {
  return CORE.filter((item) => !documents.some((d) => (item.anyOf as string[]).includes(d.documentType))).map((item) => item.label);
}

/** A caregiver may withdraw a document staff have not started on (the API enforces it). */
export const isWithdrawable = (status: VerificationStatus) => status === 'PENDING' || status === 'REJECTED';

/** A file the person photographed or chose, ready to upload. */
export interface PickedFile {
  uri: string;
  /** Always ends in the extension of its type, which the API checks. */
  name: string;
  mimeType: string;
  /** Bytes; 0 when the phone couldn't say. */
  size: number;
}

/**
 * The picked file's name and type made consistent: a type worked out from the
 * name when the phone gave none, and the type's extension added to a name
 * without one (camera photos often come back unnamed or as ".heic").
 */
export function normaliseFile({ uri, name, mimeType, size }: { uri: string; name?: string | null; mimeType?: string | null; size?: number | null }): PickedFile {
  const base = (name || uri.split(/[/?#]/).filter(Boolean).pop() || 'document').trim();
  const ext = base.includes('.') ? base.split('.').pop()!.toLowerCase() : '';
  const type = (mimeType || MIME_BY_EXTENSION[ext] || '').toLowerCase();
  const wanted = EXTENSION_BY_MIME[type];
  const fixed = wanted && MIME_BY_EXTENSION[ext] !== type ? `${base.replace(/\.[^.]*$/, '') || 'document'}.${wanted}` : base;
  return { uri, name: fixed, mimeType: type, size: size && size > 0 ? size : 0 };
}

/** Why this file can't be uploaded, or null. */
export function problemWith(file: PickedFile): 'badType' | 'tooLarge' | null {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (!EXTENSION_BY_MIME[file.mimeType] || MIME_BY_EXTENSION[ext] !== file.mimeType) return 'badType';
  if (file.size > MAX_BYTES) return 'tooLarge';
  return null;
}

export const extensionFor = (mimeType: string) => EXTENSION_BY_MIME[mimeType] ?? 'bin';

export const fileSize = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/**
 * The expiry date from the day, month and year pickers: null when none is
 * chosen, 'partial' when only some are, 'invalid' for a day the month doesn't
 * have (31 April), otherwise YYYY-MM-DD.
 */
export function expiryFrom(year: number | null, month: number | null, day: number | null): string | null | 'partial' | 'invalid' {
  if (year === null && month === null && day === null) return null;
  if (year === null || month === null || day === null) return 'partial';
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return 'invalid';
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** True when a YYYY-MM-DD date is before today in Sri Lanka. */
export function hasExpired(expiresOn: string, now = new Date()): boolean {
  const colombo = new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
  return expiresOn < colombo;
}

export type { CaregiverDocument };
