import { render, screen, fireEvent } from '@testing-library/react';
import { LanguageSwitcher } from '@/components/common/language-switcher';
import { useTranslation } from '@/lib/i18n';
import { renderWithProviders } from '@/lib/test/test-utils';

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

    expect(screen.getByText('Find the right caregiver')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'සිං' }));
    expect(screen.getByText('සුදුසු සත්කාරකයෙකු සොයන්න')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'த' }));
    expect(screen.getByText('சரியான பராமரிப்பாளரைக் கண்டறியுங்கள்')).toBeInTheDocument();
  });

  it('persists the chosen locale to localStorage', () => {
    render(renderWithProviders(<LanguageSwitcher />));
    fireEvent.click(screen.getByRole('button', { name: 'සිං' }));
    expect(window.localStorage.getItem('care-platform-public-locale')).toBe('si');
  });
});
