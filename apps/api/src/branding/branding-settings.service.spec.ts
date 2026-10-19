import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BrandingSettingsService, inspectLogo } from './branding-settings.service';

/**
 * White-label branding (Settings > Branding).
 *
 * Under test: an untouched deployment keeps the CareLink identity, colours an
 * operator picks must be readable with white text, the language set always
 * contains the default, and a logo is accepted by what its bytes are - an SVG
 * that could run script on the API's origin never is.
 */

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 '), Buffer.alloc(16)]);
const svg = (body: string) => Buffer.from(`<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">${body}</svg>`);

function make(initial: Record<string, unknown> = {}) {
  let row: Record<string, unknown> | null = Object.keys(initial).length
    ? {
        id: 'default',
        companyName: 'CareLink',
        shortName: 'CL',
        tagline: null,
        primaryColor: '#5F6952',
        accentColor: '#2F7A84',
        logoKey: null,
        logoMimeType: null,
        logoVersion: null,
        defaultLocale: 'en',
        enabledLocales: 'en,si,ta',
        updatedBy: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...initial,
      }
    : null;
  const query = { where: () => ({ limit: async () => (row ? [{ ...row }] : []) }) };
  const db: any = {
    select: () => ({ from: () => query }),
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        row = {
          companyName: 'CareLink',
          shortName: 'CL',
          tagline: null,
          primaryColor: '#5F6952',
          accentColor: '#2F7A84',
          logoKey: null,
          logoMimeType: null,
          logoVersion: null,
          defaultLocale: 'en',
          enabledLocales: 'en,si,ta',
          updatedBy: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...v,
        };
        return { onDuplicateKeyUpdate: async () => undefined };
      },
    }),
    update: () => ({ set: (v: Record<string, unknown>) => ({ where: async () => void Object.assign(row!, v) }) }),
  };
  const files = new Map<string, Buffer>();
  const storage: any = {
    upload: jest.fn(async ({ key, buffer }: { key: string; buffer: Buffer }) => (files.set(key, buffer), { key })),
    download: jest.fn(async (key: string) => files.get(key)!),
    delete: jest.fn(async (key: string) => void files.delete(key)),
  };
  return { service: new BrandingSettingsService(db, storage), stored: () => row!, files, storage };
}

describe('BrandingSettingsService', () => {
  it('starts as the shipped CareLink identity with every language on', async () => {
    const { service } = make();
    expect(await service.getPublic()).toEqual({
      companyName: 'CareLink',
      shortName: 'CL',
      tagline: null,
      primaryColor: '#5F6952',
      accentColor: '#2F7A84',
      logoVersion: null,
      defaultLocale: 'en',
      enabledLocales: ['en', 'si', 'ta'],
    });
  });

  it('saves a new identity and fills a blank short name from the company name', async () => {
    const { service } = make({ companyName: 'CareLink' });
    const out = await service.update(
      { companyName: '  Golden Years Care ', shortName: '', tagline: 'Care close to home', primaryColor: '#1a5fb4', accentColor: '#8F3B76' },
      'admin-1',
    );
    expect(out).toMatchObject({ companyName: 'Golden Years Care', shortName: 'GY', tagline: 'Care close to home', primaryColor: '#1A5FB4', accentColor: '#8F3B76' });
    expect(await service.companyName()).toBe('Golden Years Care');
  });

  it.each([
    ['primaryColor', '#F4B400'],
    ['accentColor', '#9AD0F5'],
  ])('refuses a %s too light for white text', async (field, color) => {
    const { service, stored } = make({ companyName: 'CareLink' });
    await expect(service.update({ [field]: color }, 'admin-1')).rejects.toThrow(/too light for white text/);
    expect(stored()[field]).not.toBe(color);
  });

  it('keeps the default language among those offered', async () => {
    const { service } = make({ companyName: 'CareLink' });
    expect((await service.update({ defaultLocale: 'si', enabledLocales: ['si', 'en'] }, 'a')).enabledLocales).toEqual(['en', 'si']);
    // Changing only the default switches that language on rather than failing.
    expect((await service.update({ defaultLocale: 'ta' }, 'a')).enabledLocales).toEqual(['en', 'si', 'ta']);
    await expect(service.update({ enabledLocales: ['en'] }, 'a')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('stores a logo under a new version and deletes the one it replaces', async () => {
    const { service, files, storage } = make({ companyName: 'CareLink' });
    const first = await service.setLogo({ buffer: PNG }, 'a');
    expect(first.logoMimeType).toBe('image/png');
    expect(first.logoVersion).toMatch(/^[0-9a-f]{12}$/);
    const second = await service.setLogo({ buffer: svg('<rect width="10" height="10" fill="#123456"/>') }, 'a');
    expect(second.logoVersion).not.toBe(first.logoVersion);
    expect(files.size).toBe(1);
    expect(storage.delete).toHaveBeenCalledTimes(1);
    expect((await service.getLogo()).mimeType).toBe('image/svg+xml');

    const removed = await service.removeLogo('a');
    expect(removed.logoVersion).toBeNull();
    expect(files.size).toBe(0);
    await expect(service.getLogo()).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('inspectLogo', () => {
  it('names the format from the bytes', () => {
    expect(inspectLogo(PNG)).toBe('image/png');
    expect(inspectLogo(JPEG)).toBe('image/jpeg');
    expect(inspectLogo(WEBP)).toBe('image/webp');
    expect(inspectLogo(svg('<path d="M0 0h10v10z"/>'))).toBe('image/svg+xml');
  });

  it.each([
    ['a script', '<script>alert(1)</script>'],
    ['an event handler', '<rect onload="alert(1)"/>'],
    ['a javascript: link', '<a href="javascript:alert(1)"><rect/></a>'],
    ['embedded HTML', '<foreignObject><div/></foreignObject>'],
    ['an external image', '<image href="https://tracker.example/x.png"/>'],
  ])('refuses an SVG with %s', (_, body) => {
    expect(() => inspectLogo(svg(body))).toThrow(BadRequestException);
  });

  it('allows an SVG that references its own parts or an embedded raster', () => {
    expect(inspectLogo(svg('<defs><linearGradient id="g"/></defs><use href="#g"/><image href="data:image/png;base64,AAAA"/>'))).toBe('image/svg+xml');
  });

  it('refuses anything that is not an image, and anything over 1 MB', () => {
    expect(() => inspectLogo(Buffer.from('%PDF-1.7'))).toThrow(/PNG, JPEG, WebP or SVG/);
    expect(() => inspectLogo(Buffer.alloc(0))).toThrow(BadRequestException);
    expect(() => inspectLogo(Buffer.concat([PNG, Buffer.alloc(1024 * 1024)]))).toThrow(/1 MB/);
  });
});
