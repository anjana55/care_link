import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID as uuid } from 'crypto';
import { and, eq, sql } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../database/database.module';
import { caregiverDocuments, type DocumentType } from '../database/schema';
import { STORAGE_SERVICE, type StorageService } from '../storage/storage.interface';
import { AuditService } from '../audit/audit.service';

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
]);
const ALLOWED_EXTENSIONS = new Set(['.pdf', '.jpg', '.jpeg', '.png', '.webp']);

/**
 * Per-caregiver ceiling. Registration is public, so without it anyone could
 * create an account and fill storage 10 MB at a time.
 */
export const MAX_DOCUMENTS_PER_CAREGIVER = 20;

/**
 * A caregiver may withdraw a document staff have not accepted or started on.
 * Once it is being checked or verified, removing it would erase evidence the
 * verification relied on, so that stays an admin action.
 */
const CAREGIVER_REMOVABLE: ReadonlySet<string> = new Set(['PENDING', 'REJECTED']);

/**
 * The first bytes of each allowed type. The declared MIME type and extension
 * come from the uploader, so on their own they only prove the file was *named*
 * like a PDF; this checks it actually starts like one. Matters now that
 * caregivers upload for themselves and staff then open the result.
 */
function matchesSignature(mimeType: string, head: Buffer): boolean {
  const startsWith = (...bytes: number[]) => bytes.every((b, i) => head[i] === b);
  switch (mimeType) {
    case 'application/pdf':
      return startsWith(0x25, 0x50, 0x44, 0x46, 0x2d); // %PDF-
    case 'image/jpeg':
      return startsWith(0xff, 0xd8, 0xff);
    case 'image/png':
      return startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    case 'image/webp':
      return startsWith(0x52, 0x49, 0x46, 0x46) && head.subarray(8, 12).toString('ascii') === 'WEBP';
    default:
      return false;
  }
}

@Injectable()
export class DocumentsService {
  private readonly maxFileSizeBytes: number;

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
    private readonly config: ConfigService,
    private readonly auditService: AuditService,
  ) {
    this.maxFileSizeBytes = Number(this.config.get('STORAGE_MAX_FILE_SIZE_BYTES') ?? 10 * 1024 * 1024);
  }

  validateUpload(file: { mimetype: string; originalname: string; size: number; buffer?: Buffer }) {
    const ext = ('.' + file.originalname.split('.').pop()!.toLowerCase());
    if (!ALLOWED_MIME_TYPES.has(file.mimetype) || !ALLOWED_EXTENSIONS.has(ext)) {
      throw new BadRequestException('Unsupported file type. Only PDF, JPG, PNG and WEBP files are allowed.');
    }
    if (file.size > this.maxFileSizeBytes) {
      throw new BadRequestException(`File exceeds the maximum allowed size of ${this.maxFileSizeBytes} bytes.`);
    }
    if (file.buffer && !matchesSignature(file.mimetype, file.buffer.subarray(0, 12))) {
      throw new BadRequestException('The file content does not match its type. Upload a real PDF, JPG, PNG or WEBP file.');
    }
  }

  async upload(
    caregiverId: string,
    documentType: DocumentType,
    file: { buffer: Buffer; mimetype: string; originalname: string; size: number },
    uploadedByUserId: string,
  ) {
    if (!file) throw new BadRequestException('Choose a file to upload.');
    this.validateUpload(file);

    const [{ total }] = await this.db
      .select({ total: sql<number>`count(*)` })
      .from(caregiverDocuments)
      .where(eq(caregiverDocuments.caregiverId, caregiverId));
    if (Number(total) >= MAX_DOCUMENTS_PER_CAREGIVER) {
      throw new BadRequestException(`You can keep at most ${MAX_DOCUMENTS_PER_CAREGIVER} documents. Remove one first.`);
    }

    const ext = '.' + file.originalname.split('.').pop()!.toLowerCase();
    // The storage key is always server-generated - never derived from the
    // caller-supplied filename - so it can never be used to traverse or
    // guess another caregiver's document path.
    const documentId = uuid();
    const storageKey = `${caregiverId}/${documentId}/original-file${ext}`;
    const checksum = createHash('sha256').update(file.buffer).digest('hex');

    await this.storage.upload({ key: storageKey, buffer: file.buffer, mimeType: file.mimetype });

    await this.db.insert(caregiverDocuments).values({
      id: documentId,
      caregiverId,
      documentType,
      storageKey,
      originalFilename: file.originalname,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      checksum,
      uploadedByUserId,
    });

    return this.findOne(caregiverId, documentId);
  }

  findAllForCaregiver(caregiverId: string) {
    return this.db
      .select({
        id: caregiverDocuments.id,
        documentType: caregiverDocuments.documentType,
        originalFilename: caregiverDocuments.originalFilename,
        mimeType: caregiverDocuments.mimeType,
        sizeBytes: caregiverDocuments.sizeBytes,
        verificationStatus: caregiverDocuments.verificationStatus,
        verifiedAt: caregiverDocuments.verifiedAt,
        createdAt: caregiverDocuments.createdAt,
      })
      .from(caregiverDocuments)
      .where(eq(caregiverDocuments.caregiverId, caregiverId));
  }

  async findOne(caregiverId: string, id: string) {
    const [row] = await this.db
      .select()
      .from(caregiverDocuments)
      .where(and(eq(caregiverDocuments.id, id), eq(caregiverDocuments.caregiverId, caregiverId)))
      .limit(1);
    if (!row) throw new NotFoundException('Document not found');
    return row;
  }

  async getFile(caregiverId: string, id: string, requestedByUserId: string, ipAddress?: string) {
    const document = await this.findOne(caregiverId, id);
    const buffer = await this.storage.download(document.storageKey);

    // Document access is audited separately from the generic @Audit()
    // interceptor because it needs the resolved document row first.
    await this.auditService.record({
      userId: requestedByUserId,
      action: 'ACCESS_DOCUMENT_FILE',
      entityType: 'CaregiverDocument',
      entityId: id,
      ipAddress,
    });

    return { buffer, mimeType: document.mimeType, filename: document.originalFilename };
  }

  async setVerificationStatus(
    caregiverId: string,
    id: string,
    status: 'PENDING' | 'IN_PROGRESS' | 'VERIFIED' | 'REJECTED',
    verifiedByUserId: string,
  ) {
    await this.findOne(caregiverId, id);
    await this.db
      .update(caregiverDocuments)
      .set({
        verificationStatus: status,
        verifiedByUserId,
        verifiedAt: status === 'VERIFIED' || status === 'REJECTED' ? new Date() : null,
      })
      .where(and(eq(caregiverDocuments.id, id), eq(caregiverDocuments.caregiverId, caregiverId)));
    return this.findOne(caregiverId, id);
  }

  async remove(caregiverId: string, id: string, requesterRole?: string) {
    const document = await this.findOne(caregiverId, id);
    if (requesterRole === 'CAREGIVER' && !CAREGIVER_REMOVABLE.has(document.verificationStatus)) {
      throw new ForbiddenException('This document is being verified or has been verified, so only staff can remove it.');
    }
    await this.storage.delete(document.storageKey);
    await this.db.delete(caregiverDocuments).where(and(eq(caregiverDocuments.id, id), eq(caregiverDocuments.caregiverId, caregiverId)));
    return { success: true };
  }
}
