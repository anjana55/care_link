import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ProviderChoices } from '@/components/caregivers/provider-choices';
import { I18nProvider } from '@/lib/i18n';
import { ApiError } from '@/lib/api/client';
import en from '@/lib/i18n/dictionaries/en.json';

/**
 * Finishing caregiver sign-up with an email address and password instead of
 * Google, Microsoft or Facebook: the address from the form is offered, the
 * password rules are the registration form's, and the answer says to confirm
 * the address before signing in.
 */

const post = jest.fn();
jest.mock('@/lib/navigation', () => ({ hardNavigate: jest.fn() }));
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
jest.mock('@/lib/api/client', () => ({
  ...jest.requireActual('@/lib/api/client'),
  api: { get: jest.fn(), post: (...a: unknown[]) => post(...a) },
}));

const show = (props: Partial<React.ComponentProps<typeof ProviderChoices>> = {}) =>
  render(
    <I18nProvider>
      <ProviderChoices pendingToken="tok" providers={{ GOOGLE: true, MICROSOFT: false, FACEBOOK: false }} expiresInSeconds={900} {...props} />
    </I18nProvider>,
  );
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const open = () => fireEvent.click(screen.getByRole('button', { name: en.caregiverSignup.emailPasswordButton }));
const create = () => fireEvent.click(screen.getByRole('button', { name: en.caregiverSignup.createSignIn }));

beforeEach(() => post.mockReset());

it('offers email and password alongside the providers, with the address from the form', () => {
  show({ email: 'nadee@example.com' });
  expect(screen.getByRole('button', { name: /google/i })).toBeDefined();
  expect(screen.queryByLabelText(en.login.password)).toBeNull();
  open();
  expect((screen.getByLabelText(en.login.email) as HTMLInputElement).value).toBe('nadee@example.com');
});

it('sets the password with the sign-up token and says to confirm the address', async () => {
  post.mockResolvedValue({ email: 'nadee@example.com', verificationSent: true });
  show();
  open();
  type(en.login.email, ' nadee@example.com ');
  type(en.login.password, 'CaregiverPass123');
  type(en.register.confirmPassword, 'CaregiverPass123');
  create();
  expect(await screen.findByText(en.caregiverSignup.checkEmailTitle)).toBeDefined();
  expect(screen.getByText(en.caregiverSignup.checkEmailBody.replace('{email}', 'nadee@example.com'))).toBeDefined();
  expect(post).toHaveBeenCalledWith('/auth/register-caregiver/unified/password', { pendingToken: 'tok', email: 'nadee@example.com', password: 'CaregiverPass123' });
  expect(screen.getByRole('link', { name: en.caregiverSignup.goToSignIn }).getAttribute('href')).toBe('/caregiver/login');
});

it('says the password is set when the address was already confirmed', async () => {
  post.mockResolvedValue({ email: 'nadee@example.com', verificationSent: false });
  show({ email: 'nadee@example.com' });
  open();
  type(en.login.password, 'CaregiverPass123');
  type(en.register.confirmPassword, 'CaregiverPass123');
  create();
  expect(await screen.findByText(en.caregiverSignup.passwordSet.replace('{email}', 'nadee@example.com'))).toBeDefined();
});

it("checks the address and password first, and shows the API's reason when it refuses", async () => {
  show();
  open();
  type(en.login.email, 'not-an-email');
  create();
  expect(screen.getByText(en.register.validation.email)).toBeDefined();
  type(en.login.email, 'nadee@example.com');
  type(en.login.password, 'short');
  create();
  expect(screen.getByText(en.register.validation.password)).toBeDefined();
  type(en.login.password, 'CaregiverPass123');
  type(en.register.confirmPassword, 'CaregiverPass124');
  create();
  expect(screen.getByText(en.register.validation.passwordMismatch)).toBeDefined();
  expect(post).not.toHaveBeenCalled();

  post.mockRejectedValue(new ApiError(409, 'An account with this email already exists'));
  type(en.register.confirmPassword, 'CaregiverPass123');
  create();
  expect(await screen.findByText('An account with this email already exists')).toBeDefined();
});

it('closes once the link has expired', () => {
  show({ expiresInSeconds: 0 });
  expect((screen.getByRole('button', { name: en.caregiverSignup.emailPasswordButton }) as HTMLButtonElement).disabled).toBe(true);
});
