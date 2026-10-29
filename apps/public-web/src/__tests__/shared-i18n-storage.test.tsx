import { act, render, screen } from '@testing-library/react';
import { createI18n, type Locale, type LocaleStorage } from '@care-platform/shared/i18n';

/**
 * The shared i18n engine outside a browser. The mobile app gives it
 * AsyncStorage (promises, not values) and its own language hook (there is no
 * <html lang> to set), so these drive it the same way: with a storage whose
 * reads resolve when the test says so, and a spy in place of the document.
 *
 * Tiny dictionaries rather than the app's own, so a wording change elsewhere
 * can't break a test about storage.
 */
const dictionaries = {
  en: { hello: 'Hello' },
  si: { hello: 'ආයුබෝවන්' },
  ta: { hello: 'வணக்கம்' },
} as Record<Locale, Record<string, unknown>>;

const KEY = 'test-locale';

/** AsyncStorage-shaped: every call returns a promise; reads wait until `resolveRead`. */
function deferredStorage(saved: string | null) {
  let resolveRead: (value: string | null) => void = () => undefined;
  const read = new Promise<string | null>((resolve) => {
    resolveRead = resolve;
  });
  const storage: LocaleStorage & { setItem: jest.Mock } = {
    getItem: jest.fn(() => read),
    setItem: jest.fn(() => Promise.resolve()),
  };
  return { storage, release: () => act(async () => resolveRead(saved)) };
}

function setup(storage: LocaleStorage, enabledLocales?: Locale[]) {
  const onLocaleChange = jest.fn();
  const { I18nProvider, useTranslation } = createI18n(dictionaries, KEY, {}, { storage, onLocaleChange });

  let api: ReturnType<typeof useTranslation> | undefined;
  function Probe() {
    api = useTranslation();
    return (
      <p data-testid="probe" data-ready={String(api.ready)}>
        {api.t('hello')}
      </p>
    );
  }
  render(
    <I18nProvider enabledLocales={enabledLocales}>
      <Probe />
    </I18nProvider>,
  );
  return { onLocaleChange, api: () => api!, probe: () => screen.getByTestId('probe') };
}

describe('shared i18n engine with asynchronous storage (mobile)', () => {
  let localGet: jest.SpyInstance;
  let localSet: jest.SpyInstance;

  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.lang = '';
    localGet = jest.spyOn(Storage.prototype, 'getItem');
    localSet = jest.spyOn(Storage.prototype, 'setItem');
  });
  afterEach(() => jest.restoreAllMocks());

  it('shows the default and is not ready until the saved language has loaded', async () => {
    const { storage, release } = deferredStorage('si');
    const { probe, onLocaleChange } = setup(storage);

    expect(probe()).toHaveTextContent('Hello');
    expect(probe()).toHaveAttribute('data-ready', 'false');
    expect(onLocaleChange).not.toHaveBeenCalled();

    await release();

    expect(probe()).toHaveTextContent('ආයුබෝවන්');
    expect(probe()).toHaveAttribute('data-ready', 'true');
    expect(onLocaleChange).toHaveBeenLastCalledWith('si');
  });

  it('uses only the storage and hook it was given - no localStorage, no <html lang>', async () => {
    const { storage, release } = deferredStorage('ta');
    const { api } = setup(storage);
    await release();
    act(() => api().setLocale('si'));

    expect(storage.getItem).toHaveBeenCalledWith(KEY);
    expect(storage.setItem).toHaveBeenCalledWith(KEY, 'si');
    expect(localGet).not.toHaveBeenCalled();
    expect(localSet).not.toHaveBeenCalled();
    expect(document.documentElement.lang).toBe('');
  });

  it('saves a change and reports it to the app', async () => {
    const { storage, release } = deferredStorage(null);
    const { api, probe, onLocaleChange } = setup(storage);
    await release();
    expect(onLocaleChange).toHaveBeenLastCalledWith('en');

    act(() => api().setLocale('ta'));

    expect(probe()).toHaveTextContent('வணக்கம்');
    expect(storage.setItem).toHaveBeenLastCalledWith(KEY, 'ta');
    expect(onLocaleChange).toHaveBeenLastCalledWith('ta');
  });

  it('keeps a language chosen while the saved one was still loading', async () => {
    const { storage, release } = deferredStorage('si');
    const { api, probe, onLocaleChange } = setup(storage);

    act(() => api().setLocale('ta'));
    await release(); // the saved 'si' arrives late

    expect(probe()).toHaveTextContent('வணக்கம்');
    expect(probe()).toHaveAttribute('data-ready', 'true');
    expect(onLocaleChange).toHaveBeenLastCalledWith('ta');
    expect(onLocaleChange).not.toHaveBeenCalledWith('si');
  });

  it('falls back to the default, and forgets the saved language, when it is no longer offered', async () => {
    const { storage, release } = deferredStorage('ta');
    const { probe } = setup(storage, ['en', 'si']);
    await release();

    expect(probe()).toHaveTextContent('Hello');
    expect(storage.setItem).toHaveBeenCalledWith(KEY, 'en');
  });

  it('treats a failed read or write as nothing saved', async () => {
    const storage: LocaleStorage = {
      getItem: () => Promise.reject(new Error('storage unavailable')),
      setItem: () => Promise.reject(new Error('disk full')),
    };
    const { api, probe } = setup(storage);
    await act(async () => undefined);

    expect(probe()).toHaveTextContent('Hello');
    expect(probe()).toHaveAttribute('data-ready', 'true');

    act(() => api().setLocale('si'));
    await act(async () => undefined);
    expect(probe()).toHaveTextContent('ආයුබෝවන්');
  });

  it('copes with a storage that throws instead of rejecting', () => {
    const storage: LocaleStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    const { api, probe } = setup(storage);
    expect(probe()).toHaveAttribute('data-ready', 'true');
    act(() => api().setLocale('ta'));
    expect(probe()).toHaveTextContent('வணக்கம்');
  });
});

describe('shared i18n engine with its defaults (web)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.lang = '';
  });

  it('reads localStorage and sets <html lang> in the first effect, as before', () => {
    window.localStorage.setItem(KEY, 'si');
    const { I18nProvider, useTranslation } = createI18n(dictionaries, KEY);
    function Probe() {
      const { t, ready } = useTranslation();
      return <p data-ready={String(ready)}>{t('hello')}</p>;
    }
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );

    // Synchronous storage settles inside render's act() - no extra tick, so
    // existing web tests and pages behave exactly as they did.
    expect(screen.getByText('ආයුබෝවන්')).toHaveAttribute('data-ready', 'true');
    expect(document.documentElement.lang).toBe('si');
  });
});
