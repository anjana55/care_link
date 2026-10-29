/**
 * @jest-environment node
 */
import { browserLocaleStorage, setDocumentLang } from '@care-platform/shared/i18n';

/**
 * The defaults must be harmless where there is no browser. Two such places
 * matter: server rendering (no `window`, no `document`) and React Native, which
 * defines a global `window` but gives it no localStorage. Before the storage
 * option existed the engine called window.localStorage directly; on a phone
 * that is a TypeError, not a missing value.
 */
describe('shared i18n defaults outside a browser', () => {
  const g = globalThis as { window?: unknown };
  afterEach(() => {
    delete g.window;
  });

  it('remembers nothing and does not throw without a window (server rendering)', () => {
    expect(typeof window).toBe('undefined');
    expect(browserLocaleStorage.getItem('k')).toBeNull();
    expect(() => browserLocaleStorage.setItem('k', 'si')).not.toThrow();
  });

  it('remembers nothing and does not throw with a window that has no localStorage (React Native)', () => {
    g.window = {};
    expect(browserLocaleStorage.getItem('k')).toBeNull();
    expect(() => browserLocaleStorage.setItem('k', 'si')).not.toThrow();
  });

  it('leaves <html lang> alone when there is no document', () => {
    expect(typeof document).toBe('undefined');
    expect(() => setDocumentLang('ta')).not.toThrow();
  });
});
