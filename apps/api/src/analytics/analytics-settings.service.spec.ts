import { BadRequestException } from '@nestjs/common';
import {
  analyticsAllowedOn,
  cleanAnalyticsPath,
  normalizeAnalyticsConfig,
  normalizeMeasurementId,
} from '@care-platform/shared';
import { AnalyticsSettingsService } from './analytics-settings.service';

/**
 * Google Analytics (Settings > Analytics).
 *
 * Under test: an untouched deployment sends nothing to Google, measurement
 * cannot be switched on without a real measurement ID, the ID is accepted in
 * whichever form Google showed it, and only the public signed-out pages are
 * measured - with no query strings.
 */

const GA = 'G-AB12CD34EF';

const DEFAULT_ROW = { enabled: false, measurementId: null, updatedBy: null };

function make(initial: Record<string, unknown> | null = null) {
  let row: Record<string, unknown> | null = initial
    ? { id: 'default', ...DEFAULT_ROW, createdAt: new Date(), updatedAt: new Date(), ...initial }
    : null;
  const query = { where: () => ({ limit: async () => (row ? [{ ...row }] : []) }) };
  const db: any = {
    select: () => ({ from: () => query }),
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        row = { ...DEFAULT_ROW, createdAt: new Date(), updatedAt: new Date(), ...v };
        return { onDuplicateKeyUpdate: async () => undefined };
      },
    }),
    update: () => ({ set: (v: Record<string, unknown>) => ({ where: async () => void Object.assign(row!, v) }) }),
  };
  return { service: new AnalyticsSettingsService(db), stored: () => row! };
}

describe('AnalyticsSettingsService', () => {
  it('sends nothing to Google on a deployment that never opened the page', async () => {
    const { service } = make();
    expect(await service.getPublic()).toEqual({ enabled: false, measurementId: null });
  });

  it('refuses to switch on without a measurement ID', async () => {
    const { service } = make();
    await expect(service.update({ enabled: true }, 'admin')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.update({ enabled: true, measurementId: ' ' }, 'admin')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts the ID in the forms Google shows it, and stores the canonical one', async () => {
    const { service, stored } = make();
    for (const input of [
      GA,
      ' g-ab12cd34ef ',
      '<script async src="https://www.googletagmanager.com/gtag/js?id=G-AB12CD34EF"></script>',
      "gtag('config', 'G-AB12CD34EF');",
    ]) {
      await service.update({ measurementId: input }, 'admin');
      expect(stored().measurementId).toBe(GA);
    }
  });

  it('rejects something that is not a GA4 measurement ID', async () => {
    const { service } = make();
    for (const input of ['UA-12345678-1', 'GTM-ABC1234', 'AW-123456789', 'G-', 'G-AB 12', 'ca-pub-0123456789012345']) {
      await expect(service.update({ measurementId: input }, 'admin')).rejects.toThrow(/measurement ID/);
    }
  });

  it('switches on, and the public config carries the ID', async () => {
    const { service } = make();
    expect(await service.update({ enabled: true, measurementId: GA }, 'admin-1')).toMatchObject({ enabled: true, measurementId: GA });
    expect(await service.getPublic()).toEqual({ enabled: true, measurementId: GA });
  });

  it('keeps the ID when only switched off, so switching back on is one click', async () => {
    const { service } = make({ enabled: true, measurementId: GA });
    await service.update({ enabled: false }, 'admin');
    expect(await service.getPublic()).toEqual({ enabled: false, measurementId: null });
    expect((await service.getForAdmin()).measurementId).toBe(GA);
  });

  it('never tells the public site to load a malformed stored ID', async () => {
    const { service } = make({ enabled: true, measurementId: 'G-bad"><script>' });
    expect((await service.getPublic()).enabled).toBe(false);
  });

  it('answers "no analytics" when the settings cannot be read', async () => {
    const service = new AnalyticsSettingsService({ select: () => { throw new Error('db down'); } } as any);
    expect((await service.getPublic()).enabled).toBe(false);
  });
});

describe('shared analytics helpers', () => {
  it('normalizes measurement IDs', () => {
    expect(normalizeMeasurementId('g-ab12cd34ef')).toBe(GA);
    expect(normalizeMeasurementId(42)).toBeNull();
    expect(normalizeMeasurementId('')).toBeNull();
  });

  it('measures the public signed-out pages only', () => {
    for (const p of [
      '/',
      '/find',
      '/find?q=nurse',
      '/caregivers/abc123',
      '/login',
      '/register/whatsapp',
      '/verify-email?token=x',
      '/caregiver/join',
      '/caregiver/login/',
    ]) {
      expect(analyticsAllowedOn(p)).toBe(true);
    }
    for (const p of [
      '/account',
      '/account/invoices/inv-1',
      '/caregiver/dashboard',
      '/caregiver/payments',
      '/caregiver/claim',
      '/caregiver/social/callback',
      '/caregivers',
      '/caregivers/abc/edit',
      null,
    ]) {
      expect(analyticsAllowedOn(p)).toBe(false);
    }
  });

  it('drops query strings and fragments from what is reported', () => {
    expect(cleanAnalyticsPath('/find?q=dementia%20care#results')).toBe('/find');
    expect(cleanAnalyticsPath('/caregivers/abc/')).toBe('/caregivers/abc');
    expect(cleanAnalyticsPath('/')).toBe('/');
  });

  it('turns anything malformed from the network into "no analytics"', () => {
    expect(normalizeAnalyticsConfig(null).enabled).toBe(false);
    expect(normalizeAnalyticsConfig({ enabled: true, measurementId: 'G-1"><x>' }).enabled).toBe(false);
    expect(normalizeAnalyticsConfig({ enabled: 'yes', measurementId: GA }).enabled).toBe(false);
    expect(normalizeAnalyticsConfig({ enabled: true, measurementId: GA })).toEqual({ enabled: true, measurementId: GA });
  });
});
