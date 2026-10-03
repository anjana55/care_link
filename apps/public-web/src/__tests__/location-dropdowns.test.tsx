import { render, screen, fireEvent } from '@testing-library/react';
import { NormalSearchForm } from '@/components/search/normal-search-form';
import { LanguageSwitcher } from '@/components/common/language-switcher';
import { renderWithProviders } from '@/lib/test/test-utils';
import type { Locale } from '@/lib/i18n';

/**
 * The behaviour this whole task exists for: the district and city dropdowns
 * relabel themselves in the visitor's language, in place, without a reload.
 *
 * The hooks are stubbed at the module boundary, but - unlike the other form
 * tests - the stub picks its names from the `locale` argument it is given.
 * A stub returning fixed English names would let this file pass while the
 * feature was completely broken, because the component would then be
 * rendering whatever it was handed rather than anything language-dependent.
 */

const NAMES: Record<Locale, { district: string; city: string }> = {
  en: { district: 'Colombo', city: 'Dehiwala' },
  si: { district: 'කොළඹ', city: 'දෙහිවල' },
  ta: { district: 'கொழும்பு', city: 'தேவிவாலை' },
};

/** What the stub was last asked for, so a locale-blind component is visible. */
const asked: { tree: Locale[]; cities: Locale[] } = { tree: [], cities: [] };

jest.mock('@/lib/hooks/use-public-search', () => ({
  useMetaSkills: () => ({ data: [] }),
  useMetaLanguages: () => ({ data: [] }),
  useLocationTree: (locale: Locale) => {
    asked.tree.push(locale);
    return {
      data: [
        { id: 1, name: 'Western', districts: [{ id: 1, name: NAMES[locale].district }] },
      ],
    };
  },
  useCities: (districtId: number | null, locale: Locale) => {
    asked.cities.push(locale);
    return {
      data: districtId === 1
        ? [{ id: 340, name: NAMES[locale].city, subName: null, postcode: '10350', latitude: 6.8, longitude: 79.8 }]
        : [],
    };
  },
}));

/**
 * Selected by id, not by label text. The label is translated, so a
 * label-based lookup would itself break the moment the language changed -
 * which is the one thing this file is exercising.
 */
const districtSelect = () => document.getElementById('district') as HTMLSelectElement;
const citySelect = () => document.getElementById('city') as HTMLSelectElement;
const districtOptions = () => Array.from(districtSelect().querySelectorAll('option')).map((o) => o.textContent);

beforeEach(() => {
  asked.tree.length = 0;
  asked.cities.length = 0;
  // A locale left in localStorage by an earlier test would start the render
  // in Sinhala and make every assertion about the English state wrong.
  window.localStorage.clear();
});

describe('location dropdowns follow the site language', () => {
  const renderForm = () =>
    render(
      renderWithProviders(
        <>
          <LanguageSwitcher />
          <NormalSearchForm onSubmit={jest.fn()} />
        </>,
      ),
    );

  it('shows districts in English by default', () => {
    renderForm();
    expect(districtOptions()).toContain('Colombo');
  });

  it('relabels the districts in Sinhala when the language changes', () => {
    renderForm();

    fireEvent.click(screen.getByRole('button', { name: 'සිං' }));

    expect(districtOptions()).toContain('කොළඹ');
    expect(districtOptions()).not.toContain('Colombo');
  });

  it('relabels the districts in Tamil when the language changes', () => {
    renderForm();

    fireEvent.click(screen.getByRole('button', { name: 'த' }));

    expect(districtOptions()).toContain('கொழும்பு');
    expect(districtOptions()).not.toContain('Colombo');
  });

  it('relabels the cities too, once a district has been chosen', () => {
    // The city dropdown only exists for the selected district, so the
    // district is chosen first - and the choice has to survive the switch,
    // since changing the language is not a reason to lose the visitor's
    // place on the form.
    renderForm();
    fireEvent.change(districtSelect(), { target: { value: '1' } });
    expect(citySelect().querySelectorAll('option').length).toBeGreaterThan(1);

    fireEvent.click(screen.getByRole('button', { name: 'සිං' }));

    expect(screen.getByRole('option', { name: 'දෙහිවල' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Dehiwala' })).not.toBeInTheDocument();
  });

  it('keeps the chosen district and city selected across the switch', () => {
    renderForm();
    fireEvent.change(districtSelect(), { target: { value: '1' } });

    fireEvent.click(screen.getByRole('button', { name: 'සිං' }));

    expect(districtSelect()).toHaveValue('1');
  });

  it('asks the hooks for the active locale, so the API is asked in that language', () => {
    // The query key carries the locale as well as the path. Without it,
    // react-query would serve the previous language's rows from cache and
    // the dropdown would keep English names after the switch above.
    renderForm();
    expect(asked.tree.at(-1)).toBe('en');

    fireEvent.click(screen.getByRole('button', { name: 'සිං' }));

    expect(asked.tree.at(-1)).toBe('si');
  });

  it('requests cities again for the new locale rather than reusing the cached list', () => {
    renderForm();
    fireEvent.change(districtSelect(), { target: { value: '1' } });
    expect(asked.cities.at(-1)).toBe('en');

    fireEvent.click(screen.getByRole('button', { name: 'த' }));

    expect(asked.cities.at(-1)).toBe('ta');
  });
});