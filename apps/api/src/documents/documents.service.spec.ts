import { BadRequestException } from '@nestjs/common';
import { DocumentsService } from './documents.service';

/**
 * Upload validation. The declared type and the file name come from the
 * uploader, so what protects staff who later open a file is that its first
 * bytes really are what it claims to be.
 */
describe('DocumentsService.validateUpload', () => {
  const service = new DocumentsService({} as never, {} as never, { get: () => undefined } as never, {} as never);
  const file = (mimetype: string, originalname: string, head: number[] | string, size = 100) => ({
    mimetype,
    originalname,
    size,
    buffer: typeof head === 'string' ? Buffer.from(head) : Buffer.from([...head, 0, 0, 0, 0, 0, 0, 0, 0]),
  });

  const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([1, 2, 3, 4]), Buffer.from('WEBPVP8 ')]);

  it('accepts a real file of each allowed type', () => {
    expect(() => service.validateUpload(file('application/pdf', 'a.pdf', '%PDF-1.7'))).not.toThrow();
    expect(() => service.validateUpload(file('image/jpeg', 'a.jpg', [0xff, 0xd8, 0xff, 0xe0]))).not.toThrow();
    expect(() => service.validateUpload(file('image/png', 'a.png', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).not.toThrow();
    expect(() => service.validateUpload({ mimetype: 'image/webp', originalname: 'a.webp', size: 100, buffer: webp })).not.toThrow();
  });

  it('refuses a file whose content is not what it claims', () => {
    expect(() => service.validateUpload(file('application/pdf', 'a.pdf', '<html>'))).toThrow(/does not match/);
    expect(() => service.validateUpload(file('image/png', 'a.png', '%PDF-1.7'))).toThrow(/does not match/);
    // A RIFF container that is not WebP (a WAV, say) must not pass as an image.
    const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.from([1, 2, 3, 4]), Buffer.from('WAVEfmt ')]);
    expect(() => service.validateUpload({ mimetype: 'image/webp', originalname: 'a.webp', size: 100, buffer: wav })).toThrow(/does not match/);
  });

  it('still refuses by name and declared type first', () => {
    expect(() => service.validateUpload(file('application/pdf', 'a.exe', '%PDF-1.7'))).toThrow(BadRequestException);
    expect(() => service.validateUpload(file('text/html', 'a.pdf', '%PDF-1.7'))).toThrow(/Unsupported/);
  });

  it('refuses an oversized file', () => {
    expect(() => service.validateUpload(file('application/pdf', 'a.pdf', '%PDF-1.7', 11 * 1024 * 1024))).toThrow(/maximum/);
  });
});
