import { render, screen, fireEvent } from '@testing-library/react';
import { PasswordInput } from '@/components/ui/password-input';
import { renderWithProviders } from '@/lib/test/test-utils';
import en from '@/lib/i18n/dictionaries/en.json';

const { showPassword, hidePassword } = en.common;

describe('PasswordInput', () => {
  it('starts hidden and toggles between hidden and visible', () => {
    render(renderWithProviders(<PasswordInput aria-label="pw" defaultValue="secret123" />));
    const input = screen.getByLabelText('pw');
    expect(input).toHaveAttribute('type', 'password');

    fireEvent.click(screen.getByRole('button', { name: showPassword }));
    expect(input).toHaveAttribute('type', 'text');
    expect(input).toHaveValue('secret123');

    fireEvent.click(screen.getByRole('button', { name: hidePassword }));
    expect(input).toHaveAttribute('type', 'password');
  });

  it('does not submit the surrounding form when toggled', () => {
    const onSubmit = jest.fn((e: React.FormEvent) => e.preventDefault());
    render(
      renderWithProviders(
        <form onSubmit={onSubmit}>
          <PasswordInput aria-label="pw" />
        </form>,
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: showPassword }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('toggles each field independently', () => {
    render(
      renderWithProviders(
        <>
          <PasswordInput aria-label="new" />
          <PasswordInput aria-label="confirm" />
        </>,
      ),
    );
    fireEvent.click(screen.getAllByRole('button', { name: showPassword })[0]);
    expect(screen.getByLabelText('new')).toHaveAttribute('type', 'text');
    expect(screen.getByLabelText('confirm')).toHaveAttribute('type', 'password');
  });
});
