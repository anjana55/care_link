import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as fs } from 'fs';
import * as path from 'path';
import { StorageService, UploadFileParams } from './storage.interface';

/**
 * Stores caregiver documents on a protected local directory. Never exposed
 * directly via a static file server - every read goes through the
 * documents controller's own auth + authorization checks.
 *
 * Swapping this for MinIO/S3/Azure Blob later means implementing the same
 * StorageService interface; no caller in the caregiver domain changes.
 */
@Injectable()
export class LocalFileStorageService implements StorageService {
  private readonly root: string;

  constructor(config: ConfigService) {
    this.root = path.resolve(process.cwd(), config.get<string>('STORAGE_LOCAL_ROOT') ?? './storage/caregiver-documents');
  }

  private resolvePath(key: string): string {
    // Defend against path traversal: keys are always generated server-side
    // (uuid-based), but this stays cheap insurance.
    const normalized = path.normalize(key).replace(/^(\.\.(\/|\\|$))+/, '');
    return path.join(this.root, normalized);
  }

  async upload({ key, buffer }: UploadFileParams): Promise<{ key: string }> {
    const filePath = this.resolvePath(key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, buffer, { mode: 0o600 });
    return { key };
  }

  async download(key: string): Promise<Buffer> {
    try {
      return await fs.readFile(this.resolvePath(key));
    } catch {
      throw new NotFoundException('Document file not found on disk');
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await fs.unlink(this.resolvePath(key));
    } catch {
      // Already gone - deletion is idempotent from the caller's perspective.
    }
  }

  async getSignedUrl(key: string): Promise<string> {
    // Local driver has no signed-URL concept; documents are always served
    // through the authenticated /caregivers/:id/documents/:documentId/file route.
    return `/caregivers/documents/${key}/file`;
  }
}
