import { render, screen, fireEvent } from '@testing-library/react';
import { LanguageSwitcher } from '@/components/common/language-switcher';
import { useTranslation } from '@/lib/i18n';
import { renderWithProviders } from '@/lib/test/test-utils';
import en from '@/lib/i18n/dictionaries/en.json';
import si from '@/lib/i18n/dictionaries/si.json';
import ta from '@/lib/i18n/dictionaries/ta.json';

const dictionaries = { en, si, ta };

/**
 * The expected strings are read from the dictionaries rather than pasted in.
 * Hardcoding them made this test a tripwire for any translation correction -
 * rewording `hero.title` broke a test that has nothing to do with switching,
 * which is how a genuine regression would get lost in the noise.
 */
function heroTitle(locale: 'en' | 'si' | 'ta'): string {
  const dict = dictionaries[locale] as { hero: { title: string } };
  return dict.hero.title;
}

function Probe() {
  const { t } = useTranslation();
  return <p>{t('hero.title')}</p>;
}

describe('LanguageSwitcher', () => {
  it('switches the rendered dictionary without a page reload', () => {
    render(
      renderWithProviders(
        <>
          <LanguageSwitcher />
          <Probe />
        </>,
      ),
    );

    expect(screen.getByText(heroTitle('en'))).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'සිං' }));
    expect(screen.getByText(heroTitle('si'))).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'த' }));
    expect(screen.getByText(heroTitle('ta'))).toBeInTheDocument();
  });

  // Guards the guard: if all three locales ever held identical copy, the
  // assertions above would pass without anything having switched.
  it('each locale renders distinct copy', () => {
    const titles = [heroTitle('en'), heroTitle('si'), heroTitle('ta')];
    expect(new Set(titles).size).toBe(3);
  });

  it('persists the chosen locale to localStorage', () => {
    render(renderWithProviders(<LanguageSwitcher />));
    fireEvent.click(screen.getByRole('button', { name: 'සිං' }));
    expect(window.localStorage.getItem('care-platform-public-locale')).toBe('si');
  });
});
