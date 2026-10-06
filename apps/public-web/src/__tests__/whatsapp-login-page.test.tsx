import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import WhatsappLoginPage from '@/app/login/whatsapp/page';
import { I18nProvider } from '@/lib/i18n';
import { ApiError } from '@/lib/api/client';

const post = jest.fn();
const get = jest.fn();
const push = jest.fn();
const applyTokens = jest.fn();
let search = '';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams(search),
}));
jest.mock('@/lib/api/auth-context', () => ({ useAuth: () => ({ applyTokens }) }));
jest.mock('@/lib/api/client', () => ({
  ...jest.requireActual('@/lib/api/client'),
  api: { post: (...a: unknown[]) => post(...a), get: (...a: unknown[]) => get(...a) },
}));

const config = (over: object = {}) => ({
  enabled: true,
  caregiver: { register: true, login: true, recovery: true },
  customer: { register: true, login: true, recovery: true },
  otpLength: 6,
  otpTtlSeconds: 300,
  resendCooldownSeconds: 60,
  defaultCountryCode: '94',
  ...over,
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider>
        <WhatsappLoginPage />
      </I18nProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  post.mockReset();
  get.mockReset();
  push.mockReset();
  applyTokens.mockReset();
  search = '';
});

describe('WhatsApp login page (customers)', () => {
  it('asks for the number, then the code, then signs the customer in', async () => {
    get.mockResolvedValue(config());
    post.mockResolvedValueOnce({ resendAfterSeconds: 60 }).mockResolvedValueOnce({ accessToken: 'a', refreshToken: 'r' });
    renderPage();

    const phone = await screen.findByLabelText('WhatsApp number');
    expect(screen.getByRole('button', { name: 'Send code' })).toBeDisabled();
    fireEvent.change(phone, { target: { value: '0771234567' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send code' }));

    expect(await screen.findByLabelText('Verification code')).toBeInTheDocument();
    expect(post).toHaveBeenNthCalledWith(1, '/auth/whatsapp/request-otp', { phone: '0771234567', purpose: 'LOGIN', portal: 'customer' });

    fireEvent.change(screen.getByLabelText('Verification code'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));

    await waitFor(() => expect(applyTokens).toHaveBeenCalledWith({ accessToken: 'a', refreshToken: 'r' }));
    expect(post).toHaveBeenNthCalledWith(2, '/auth/whatsapp/verify-otp', { phone: '0771234567', purpose: 'LOGIN', portal: 'customer', code: '123456' });
    expect(push).toHaveBeenCalledWith('/');
  });

  it('does not sign in on an invalid or expired code', async () => {
    get.mockResolvedValue(config());
    post.mockResolvedValueOnce({ resendAfterSeconds: 60 }).mockRejectedValueOnce(new ApiError(401, 'This code is invalid or has expired. Request a new one and try again.'));
    renderPage();

    fireEvent.change(await screen.findByLabelText('WhatsApp number'), { target: { value: '0771234567' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send code' }));
    fireEvent.change(await screen.findByLabelText('Verification code'), { target: { value: '999999' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('invalid or has expired');
    expect(applyTokens).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it('uses the recovery purpose for ?mode=recover', async () => {
    search = 'mode=recover';
    get.mockResolvedValue(config());
    post.mockResolvedValueOnce({ resendAfterSeconds: 60 });
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Recover your account' })).toBeInTheDocument();
    // the heading renders immediately; the form appears once the config has loaded
    fireEvent.change(await screen.findByLabelText('WhatsApp number'), { target: { value: '0771234567' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send code' }));
    await screen.findByLabelText('Verification code');
    expect(post).toHaveBeenCalledWith('/auth/whatsapp/request-otp', { phone: '0771234567', purpose: 'RECOVERY', portal: 'customer' });
  });

  it('shows an error if the code cannot be requested', async () => {
    get.mockResolvedValue(config());
    post.mockRejectedValueOnce(new ApiError(400, 'Enter a valid WhatsApp number, including the country code if it is not a local number'));
    renderPage();
    fireEvent.change(await screen.findByLabelText('WhatsApp number'), { target: { value: '0771234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send code' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a valid WhatsApp number');
    expect(screen.queryByLabelText('Verification code')).not.toBeInTheDocument();
  });

  it.each([
    ['the master switch is off', config({ enabled: false, customer: { register: false, login: false, recovery: false } })],
    ['customer login is switched off', config({ customer: { register: true, login: false, recovery: true } })],
  ])('offers no form when %s', async (_name, cfg) => {
    get.mockResolvedValue(cfg);
    renderPage();
    expect(await screen.findByText(/WhatsApp sign-in is not available right now/)).toBeInTheDocument();
    expect(screen.queryByLabelText('WhatsApp number')).not.toBeInTheDocument();
  });

  it('offers no form when the config cannot be loaded', async () => {
    get.mockRejectedValue(new ApiError(500, 'boom'));
    renderPage();
    expect(await screen.findByText(/WhatsApp sign-in is not available right now/)).toBeInTheDocument();
  });

  it('always links back to email sign-in', async () => {
    get.mockResolvedValue(config());
    renderPage();
    expect(await screen.findByRole('link', { name: 'Sign in with email instead' })).toHaveAttribute('href', '/login');
  });
});
