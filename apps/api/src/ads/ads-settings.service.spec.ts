import { BadRequestException } from '@nestjs/common';
import { adsAllowedOn, adsTxtLine, normalizeAdsConfig, normalizePublisherId } from '@care-platform/shared';
import { AdsSettingsService } from './ads-settings.service';

/**
 * Google AdSense (Settings > Ads).
 *
 * Under test: an untouched deployment shows no ads, ads cannot be switched on
 * without a real publisher ID, the ID is accepted in whichever form AdSense
 * showed it, and the public site only ever gets a well-formed config - and only
 * puts ads on the public marketing and search pages.
 */

const PUB = 'ca-pub-0123456789012345';

const DEFAULT_ROW = {
  enabled: false,
  publisherId: null,
  slotHome: null,
  slotSearch: null,
  slotProfile: null,
  updatedBy: null,
};

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
  return { service: new AdsSettingsService(db), stored: () => row! };
}

describe('AdsSettingsService', () => {
  it('shows no ads on a deployment that never opened the page', async () => {
    const { service } = make();
    expect(await service.getPublic()).toEqual({ enabled: false, publisherId: null, slots: { home: null, search: null, profile: null } });
    expect((await service.getForAdmin()).adsTxt).toBeNull();
  });

  it('refuses to switch ads on without a publisher ID', async () => {
    const { service } = make();
    await expect(service.update({ enabled: true }, 'admin')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.update({ enabled: true, publisherId: '' }, 'admin')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts the publisher ID in the forms AdSense shows it, and stores the canonical one', async () => {
    const { service, stored } = make();
    for (const input of [
      PUB,
      'pub-0123456789012345',
      ' 0123456789012345 ',
      '<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-0123456789012345" crossorigin="anonymous"></script>',
    ]) {
      await service.update({ publisherId: input }, 'admin');
      expect(stored().publisherId).toBe(PUB);
    }
  });

  it('rejects something that is not a publisher ID', async () => {
    const { service } = make();
    for (const input of ['ca-pub-123', 'pub-01234567890123456789', 'G-ABC123', 'ca-pub-01234567890123ab']) {
      await expect(service.update({ publisherId: input }, 'admin')).rejects.toThrow(/publisher ID/);
    }
  });

  it('switches on with slots, and the public config carries them', async () => {
    const { service } = make();
    const admin = await service.update({ enabled: true, publisherId: PUB, slotSearch: ' 1234567890 ' }, 'admin-1');
    expect(admin).toMatchObject({ enabled: true, publisherId: PUB, slotSearch: '1234567890', slotHome: null });
    expect(admin.adsTxt).toBe('google.com, pub-0123456789012345, DIRECT, f08c47fec0942fa0');
    expect(await service.getPublic()).toEqual({ enabled: true, publisherId: PUB, slots: { home: null, search: '1234567890', profile: null } });
  });

  it('rejects a slot ID that is not the digits from data-ad-slot, and clears one sent empty', async () => {
    const { service, stored } = make({ slotHome: '1111111111' });
    await expect(service.update({ slotHome: 'abc' }, 'admin')).rejects.toThrow(/landing page ad unit/);
    await service.update({ slotHome: '' }, 'admin');
    expect(stored().slotHome).toBeNull();
  });

  it('keeps the publisher ID when only switched off, so switching back on is one click', async () => {
    const { service } = make({ enabled: true, publisherId: PUB });
    await service.update({ enabled: false }, 'admin');
    expect(await service.getPublic()).toMatchObject({ enabled: false, publisherId: null });
    expect((await service.getForAdmin()).publisherId).toBe(PUB);
  });

  it('never tells the public site to show ads for a malformed stored ID', async () => {
    const { service } = make({ enabled: true, publisherId: 'ca-pub-bad' });
    expect((await service.getPublic()).enabled).toBe(false);
  });

  it('answers "no ads" when the settings cannot be read', async () => {
    const service = new AdsSettingsService({ select: () => { throw new Error('db down'); } } as any);
    expect((await service.getPublic()).enabled).toBe(false);
  });
});

describe('shared ads helpers', () => {
  it('normalizes publisher IDs', () => {
    expect(normalizePublisherId('CA-PUB-0123456789012345')).toBe(PUB);
    expect(normalizePublisherId(42)).toBeNull();
    expect(adsTxtLine(PUB)).toBe('google.com, pub-0123456789012345, DIRECT, f08c47fec0942fa0');
  });

  it('only puts ads on the landing page, search and public caregiver profiles', () => {
    for (const p of ['/', '/find', '/find?q=nurse', '/caregivers/abc123', '/caregivers/abc123/']) expect(adsAllowedOn(p)).toBe(true);
    for (const p of [
      '/login',
      '/register',
      '/login/whatsapp',
      '/verify-email',
      '/account',
      '/account/invoices',
      '/caregiver/login',
      '/caregiver/join',
      '/caregivers',
      '/caregivers/abc/edit',
      null,
    ]) {
      expect(adsAllowedOn(p)).toBe(false);
    }
  });

  it('turns anything malformed from the network into "no ads"', () => {
    expect(normalizeAdsConfig(null).enabled).toBe(false);
    expect(normalizeAdsConfig({ enabled: true, publisherId: 'ca-pub-1"><script>' }).enabled).toBe(false);
    expect(normalizeAdsConfig({ enabled: true, publisherId: PUB, slots: { home: '12"34', search: '1234567890' } })).toEqual({
      enabled: true,
      publisherId: PUB,
      slots: { home: null, search: '1234567890', profile: null },
    });
  });
});
