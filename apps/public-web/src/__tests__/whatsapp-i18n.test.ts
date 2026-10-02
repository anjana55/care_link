import en from '@/lib/i18n/dictionaries/en.json';
import si from '@/lib/i18n/dictionaries/si.json';
import ta from '@/lib/i18n/dictionaries/ta.json';

function keys(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object' ? keys(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}
const leaves = (d: Record<string, unknown>) => (d as { whatsapp: Record<string, unknown> }).whatsapp;

describe('WhatsApp sign-in translations', () => {
  const english = keys(leaves(en)).sort();

  it('exist for the English baseline', () => {
    expect(english.length).toBeGreaterThan(30);
  });

  it.each([
    ['Sinhala', si],
    ['Tamil', ta],
  ])('%s covers exactly the same keys as English', (_name, dict) => {
    expect(keys(leaves(dict)).sort()).toEqual(english);
  });

  it.each([
    ['Sinhala', si],
    ['Tamil', ta],
  ])('%s strings are real translations, not copies of the English', (_name, dict) => {
    const t = (d: any, path: string) => path.split('.').reduce((o, k) => o[k], d.whatsapp);
    const untranslated = english.filter((k) => t(dict, k) === t(en, k) && /[a-z]{4,}/i.test(t(en, k) as string));
    expect(untranslated).toEqual([]);
  });
});
