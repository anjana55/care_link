import { BadRequestException } from '@nestjs/common';
import { appUpdateStatus, compareAppVersions, normalizeAppConfig } from '@care-platform/shared';
import { AppSettingsService } from './app-settings.service';

/**
 * Mobile app version control (Settings > Mobile app).
 *
 * Under test: an untouched deployment never blocks or nags anyone; a typo can
 * never lock people out; nobody is blocked without a store link to update from;
 * and old builds are told to update exactly when they are older.
 */

const EMPTY_ROW = {
  iosMinimumVersion: null,
  iosLatestVersion: null,
  iosStoreUrl: null,
  androidMinimumVersion: null,
  androidLatestVersion: null,
  androidStoreUrl: null,
  updatedBy: null,
};
const IOS_STORE = 'https://apps.apple.com/app/carelink/id1234567890';
const PLAY_STORE = 'https://play.google.com/store/apps/details?id=com.vivantihealth.carelink';

function make(initial: Record<string, unknown> | null = null, opts: { broken?: boolean } = {}) {
  let row: Record<string, unknown> | null = initial ? { id: 'default', ...EMPTY_ROW, createdAt: new Date(), updatedAt: new Date(), ...initial } : null;
  const query = {
    where: () => ({
      limit: async () => {
        if (opts.broken) throw new Error('db down');
        return row ? [{ ...row }] : [];
      },
    }),
  };
  const db: any = {
    select: () => ({ from: () => query }),
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        row = { ...EMPTY_ROW, createdAt: new Date(), updatedAt: new Date(), ...v };
        return { onDuplicateKeyUpdate: async () => undefined };
      },
    }),
    update: () => ({ set: (v: Record<string, unknown>) => ({ where: async () => void Object.assign(row!, v) }) }),
  };
  return { service: new AppSettingsService(db), stored: () => row! };
}

describe('mobile app version control', () => {
  describe('the settings', () => {
    it('start empty, so a deployment that never sets them never blocks or nags anyone', async () => {
      const { service } = make();
      expect(await service.getPublic()).toEqual({
        ios: { minimumVersion: null, latestVersion: null, storeUrl: null },
        android: { minimumVersion: null, latestVersion: null, storeUrl: null },
      });
    });

    it('never stop the app when they can’t be read', async () => {
      const { service } = make(null, { broken: true });
      const config = await service.getPublic();
      expect(config.ios.minimumVersion).toBeNull();
      expect(config.android.minimumVersion).toBeNull();
    });

    it('save each platform separately, and an empty field clears it', async () => {
      const { service, stored } = make({ iosLatestVersion: '1.1.0', iosStoreUrl: IOS_STORE });
      const saved = await service.update(
        { android: { minimumVersion: ' 1.0 ', latestVersion: '1.2.0', storeUrl: PLAY_STORE }, ios: { latestVersion: '' } },
        'admin-1',
      );
      expect(saved.android).toEqual({ minimumVersion: '1.0', latestVersion: '1.2.0', storeUrl: PLAY_STORE });
      expect(saved.ios).toEqual({ minimumVersion: null, latestVersion: null, storeUrl: IOS_STORE });
      expect(stored().updatedBy).toBe('admin-1');
    });

    it.each([
      [{ ios: { latestVersion: 'v1.2' } }, /numbers separated by dots/],
      [{ ios: { minimumVersion: '2.0', latestVersion: '1.9.9', storeUrl: IOS_STORE } }, /can't be newer than the latest/],
      [{ ios: { storeUrl: 'https://example.com/app' } }, /apps\.apple\.com/],
      [{ android: { storeUrl: 'http://play.google.com/store/apps/details?id=x' } }, /play\.google\.com/],
      [{ android: { storeUrl: IOS_STORE } }, /play\.google\.com/],
      [{ android: { minimumVersion: '1.0' } }, /add the store link before setting a minimum/],
    ])('refuse %j', async (dto, message) => {
      const { service, stored } = make({});
      await expect(service.update(dto as never, 'admin-1')).rejects.toThrow(BadRequestException);
      await expect(service.update(dto as never, 'admin-1')).rejects.toThrow(message);
      expect(stored().updatedBy).toBeNull();
    });
  });

  describe('which builds must or may update', () => {
    const config = { minimumVersion: '1.2', latestVersion: '1.4.0', storeUrl: PLAY_STORE };

    it('compares versions number by number, not as text', () => {
      expect(compareAppVersions('1.10.0', '1.9.0')).toBe(1);
      expect(compareAppVersions('1.4', '1.4.0')).toBe(0);
      expect(compareAppVersions('2', '10')).toBe(-1);
      expect(compareAppVersions('1.x', '1.0')).toBeNull();
    });

    it('blocks below the minimum, suggests below the latest, and leaves the rest alone', () => {
      expect(appUpdateStatus('1.1.9', config)).toBe('required');
      expect(appUpdateStatus('1.2.0', config)).toBe('available');
      expect(appUpdateStatus('1.3.10', config)).toBe('available');
      expect(appUpdateStatus('1.4', config)).toBe('current');
      expect(appUpdateStatus('2.0.0', config)).toBe('current');
    });

    it('treats anything it can’t read as current, rather than locking anyone out', () => {
      expect(appUpdateStatus(null, config)).toBe('current');
      expect(appUpdateStatus('1.0.0-beta', config)).toBe('current');
      expect(appUpdateStatus('1.0.0', { minimumVersion: null, latestVersion: null, storeUrl: null })).toBe('current');
    });

    it('drops whatever doesn’t parse in a config it receives', () => {
      expect(
        normalizeAppConfig({ ios: { minimumVersion: '1.0', latestVersion: 'soon', storeUrl: 'javascript:alert(1)' }, android: 'nope' }),
      ).toEqual({
        ios: { minimumVersion: '1.0', latestVersion: null, storeUrl: null },
        android: { minimumVersion: null, latestVersion: null, storeUrl: null },
      });
      expect(normalizeAppConfig(null).ios.minimumVersion).toBeNull();
    });
  });
});
