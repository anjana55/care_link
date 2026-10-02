import en from '@/lib/i18n/dictionaries/en.json';
import si from '@/lib/i18n/dictionaries/si.json';
import ta from '@/lib/i18n/dictionaries/ta.json';

/**
 * Whole-dictionary parity.
 *
 * The WhatsApp test above only walked the `whatsapp` subtree, which is why the
 * landing page's ~45 new strings could have drifted without anything noticing:
 * a key present in en.json and missing from si.json renders as the raw key
 * ("landing.heroTitle") in that language, silently.
 */

function keys(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object' ? keys(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

const english = keys(en as Record<string, unknown>).sort();

describe('public-web dictionaries', () => {
  it('has a non-trivial English baseline', () => {
    expect(english.length).toBeGreaterThan(200);
  });

  it.each([
    ['Sinhala', si],
    ['Tamil', ta],
  ])('%s covers exactly the same keys as English', (_name, dict) => {
    expect(keys(dict as Record<string, unknown>).sort()).toEqual(english);
  });

  it.each([
    ['Sinhala', si],
    ['Tamil', ta],
  ])('%s leaves no value empty', (_name, dict) => {
    const flat = (o: Record<string, unknown>, prefix = ''): [string, string][] =>
      Object.entries(o).flatMap(([k, v]) =>
        v && typeof v === 'object'
          ? flat(v as Record<string, unknown>, `${prefix}${k}.`)
          : [[`${prefix}${k}`, String(v)]],
      );
    expect(flat(dict as Record<string, unknown>).filter(([, v]) => !v.trim()).map(([k]) => k)).toEqual([]);
  });
});