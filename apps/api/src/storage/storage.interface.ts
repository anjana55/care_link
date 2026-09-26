export interface UploadFileParams {
  key: string;
  buffer: Buffer;
  mimeType: string;
}

export interface StorageService {
  upload(params: UploadFileParams): Promise<{ key: string }>;
  download(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  /**
   * Returns a URL or path the API can use to let an authorized caller
   * retrieve the file. For the local driver this is just an internal
   * route; a future S3/MinIO driver would return a signed URL here
   * without any caller-facing change.
   */
  getSignedUrl(key: string): Promise<string>;
}

export const STORAGE_SERVICE = 'STORAGE_SERVICE';
