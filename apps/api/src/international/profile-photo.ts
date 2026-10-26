import { BadRequestException } from '@nestjs/common';
import sharp, { type Sharp } from 'sharp';

/** Larger than any phone photo needs to be once it is a 640 px portrait. */
export const MAX_PHOTO_UPLOAD_BYTES = 8 * 1024 * 1024;
/** The longest side of the stored photo. */
export const PHOTO_SIZE_PX = 640;

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp']);

/**
 * A caregiver's photo, ready to publish.
 *
 * The upload is never stored as sent. It is decoded and re-encoded as a
 * square-cropped WebP, which:
 *  - drops every metadata block - phone photos carry the GPS position they
 *    were taken at in EXIF, and a public profile photo must not say where a
 *    caregiver lives;
 *  - applies the EXIF orientation first, so the photo is the right way up;
 *  - means whatever bytes are served are bytes this process produced, not
 *    a file that merely claimed to be an image.
 */
export async function preparePublicPhoto(file: { mimetype: string; size: number; buffer: Buffer }): Promise<{ buffer: Buffer; mimeType: string }> {
  if (!ALLOWED.has(file.mimetype)) throw new BadRequestException('The photo must be a JPG, PNG or WEBP image.');
  if (file.size > MAX_PHOTO_UPLOAD_BYTES) throw new BadRequestException('The photo must be 8 MB or smaller.');

  let image: Sharp;
  let width = 0;
  let height = 0;
  try {
    image = sharp(file.buffer, { failOn: 'error', limitInputPixels: 50_000_000 });
    const meta = await image.metadata();
    width = meta.width ?? 0;
    height = meta.height ?? 0;
    if (!meta.format || !['jpeg', 'png', 'webp'].includes(meta.format)) throw new Error('format');
  } catch {
    throw new BadRequestException('That file could not be read as a photo.');
  }
  if (Math.min(width, height) < 200) throw new BadRequestException('The photo is too small - please use one at least 200 pixels wide and tall.');

  const buffer = await image
    .rotate() // apply EXIF orientation before the metadata is dropped
    .resize(PHOTO_SIZE_PX, PHOTO_SIZE_PX, { fit: 'cover', position: 'attention' })
    .webp({ quality: 82 })
    .toBuffer(); // sharp writes no metadata unless asked (withMetadata)
  return { buffer, mimeType: 'image/webp' };
}
