import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WhatsappOtpForm } from '@/components/auth/whatsapp-otp-form';
import { renderWithProviders } from '@/lib/test/test-utils';
import { ApiError } from '@/lib/api/client';

const post = jest.fn();
jest.mock('@/lib/api/client', () => ({
  ...jest.requireActual('@/lib/api/client'),
  api: { post: (...args: unknown[]) => post(...args), get: jest.fn() },
}));

const tokens = { accessToken: 'a.b.c', refreshToken: 'r.r.r' };

function setup(props: Partial<React.ComponentProps<typeof WhatsappOtpForm>> = {}) {
  const onVerified = jest.fn();
  const onChangeNumber = jest.fn();
  render(
    renderWithProviders(
      <WhatsappOtpForm phone="0771234567" purpose="LOGIN" codeLength={6} resendAfterSeconds={30} onVerified={onVerified} onChangeNumber={onChangeNumber} {...props} />,
    ),
  );
  return { onVerified, onChangeNumber };
}
const codeInput = () => screen.getByLabelText('Verification code');
const verifyButton = () => screen.getByRole('button', { name: 'Verify' });

beforeEach(() => post.mockReset());

describe('WhatsappOtpForm', () => {
  it('keeps Verify disabled until the full code is typed, and strips non-digits', () => {
    setup();
    expect(verifyButton()).toBeDisabled();
    fireEvent.change(codeInput(), { target: { value: '12ab34' } });
    expect(codeInput()).toHaveValue('1234');
    expect(verifyButton()).toBeDisabled();
    fireEvent.change(codeInput(), { target: { value: '123456' } });
    expect(verifyButton()).toBeEnabled();
  });

  it('submits the number, purpose and code, and hands back the tokens on success', async () => {
    post.mockResolvedValueOnce(tokens);
    const { onVerified } = setup({ purpose: 'REGISTER' });
    fireEvent.change(codeInput(), { target: { value: '123456' } });
    fireEvent.click(verifyButton());

    await waitFor(() => expect(onVerified).toHaveBeenCalledWith(tokens));
    expect(post).toHaveBeenCalledWith('/auth/whatsapp/verify-otp', { phone: '0771234567', purpose: 'REGISTER', code: '123456' });
  });

  it('shows the server message for an invalid or expired code and does not sign in', async () => {
    post.mockRejectedValueOnce(new ApiError(401, 'This code is invalid or has expired. Request a new one and try again.'));
    const { onVerified } = setup();
    fireEvent.change(codeInput(), { target: { value: '000000' } });
    fireEvent.click(verifyButton());

    expect(await screen.findByRole('alert')).toHaveTextContent('invalid or has expired');
    expect(onVerified).not.toHaveBeenCalled();
    // the form stays usable for another try
    expect(codeInput()).toHaveValue('000000');
  });

  it('falls back to a generic message when the failure has no usable message', async () => {
    post.mockRejectedValueOnce(new Error('network down'));
    setup();
    fireEvent.change(codeInput(), { target: { value: '111111' } });
    fireEvent.click(verifyButton());
    expect(await screen.findByRole('alert')).toHaveTextContent("That code didn't work");
  });

  it('lets the user go back and change the number', () => {
    const { onChangeNumber } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Change number' }));
    expect(onChangeNumber).toHaveBeenCalled();
  });

  describe('resend', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('is locked during the cooldown, counts down, then requests a fresh code', async () => {
      post.mockResolvedValueOnce({ resendAfterSeconds: 45, devOtp: '654321' });
      setup({ resendAfterSeconds: 3 });

      const locked = screen.getByRole('button', { name: /Send a new code in 3s/ });
      expect(locked).toBeDisabled();

      // One tick at a time: each second re-arms the next timer only after React flushes the state change.
      for (let i = 0; i < 3; i++) {
        await act(async () => {
          jest.advanceTimersByTime(1000);
        });
      }
      const resend = screen.getByRole('button', { name: 'Send a new code' });
      expect(resend).toBeEnabled();

      fireEvent.change(codeInput(), { target: { value: '123456' } });
      await act(async () => {
        fireEvent.click(resend);
      });

      expect(post).toHaveBeenCalledWith('/auth/whatsapp/request-otp', { phone: '0771234567', purpose: 'LOGIN' });
      expect(codeInput()).toHaveValue(''); // old, now-invalid code cleared
      expect(screen.getByText('A new code has been requested.')).toBeInTheDocument();
      expect(screen.getByText('654321')).toBeInTheDocument(); // dev-console code surfaced
      expect(screen.getByRole('button', { name: /Send a new code in 45s/ })).toBeDisabled();
    });

    it('surfaces a rate-limit error from a resend', async () => {
      post.mockRejectedValueOnce(new ApiError(429, 'Please wait 30 seconds before requesting another code'));
      setup({ resendAfterSeconds: 0 });
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Send a new code' }));
      });
      expect(screen.getByRole('alert')).toHaveTextContent('Please wait 30 seconds');
    });
  });

  it('shows the development code only when the API supplied one', () => {
    setup({ devOtp: '246810' });
    expect(screen.getByText('246810')).toBeInTheDocument();
  });

  it('never shows a development code box otherwise', () => {
    setup();
    expect(screen.queryByText(/Development mode/)).not.toBeInTheDocument();
  });
});
