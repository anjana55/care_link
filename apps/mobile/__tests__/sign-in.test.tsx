import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';
import en from '../src/i18n/en.json';
import SignIn from '../app/(auth)/sign-in';
import Verify from '../app/(auth)/verify';
import Home from '../app/home';
import Welcome from '../app/index';
import { AppProviders, serveApi } from '../test-utils/app';
import { mockRouter } from '../test-utils/router';
import { tokensFor } from '../test-utils/helpers';
import { tokenStore } from '@/api';

jest.mock('expo-router', () => require('../test-utils/router').expoRouterMock());

const whatsappConfig = (login: { caregiver: boolean; customer: boolean }) => ({
  enabled: true,
  caregiver: { register: true, login: login.caregiver, recovery: true },
  customer: { register: true, login: login.customer, recovery: true },
  otpLength: 6,
  otpTtlSeconds: 300,
  resendCooldownSeconds: 60,
  defaultCountryCode: '94',
});

const show = (ui: React.ReactElement) => render(<AppProviders>{ui}</AppProviders>);

beforeEach(() => mockRouter.reset());

describe('signing in with email', () => {
  it('signs a client in on the client portal and goes to their home', async () => {
    const tokens = tokensFor('PATIENT_GUARDIAN', { patientId: 'p-1' });
    const calls = serveApi({
      'GET /auth/whatsapp/config': () => ({ status: 200, body: { ...whatsappConfig({ caregiver: false, customer: false }), enabled: false } }),
      'POST /auth/login': () => ({ status: 200, body: tokens }),
    });
    mockRouter.params = { role: 'client' };
    await show(<SignIn />);

    // WhatsApp is off, so it's email straight away.
    await fireEvent.changeText(await screen.findByLabelText(en.signIn.email), ' amaya@example.lk ');
    await fireEvent.changeText(screen.getByLabelText(en.signIn.password), 'secret-pass');
    await fireEvent.press(screen.getByRole('button', { name: en.signIn.submit }));

    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/home'));
    const login = calls.find((c) => c.route === 'POST /auth/login')!;
    expect(login.body).toEqual({ email: 'amaya@example.lk', password: 'secret-pass', portal: 'customer' });
    expect(login.headers.Authorization).toBeUndefined();
    expect(tokenStore.get()).toEqual(tokens);
  });

  it('says "invalid email or password" for any refusal, and nobody is signed in', async () => {
    serveApi({
      'GET /auth/whatsapp/config': () => ({ status: 200, body: { enabled: false } }),
      'POST /auth/login': () => ({ status: 401, body: { message: 'Invalid credentials' } }),
    });
    mockRouter.params = { role: 'caregiver' };
    await show(<SignIn />);

    await fireEvent.changeText(await screen.findByLabelText(en.signIn.email), 'nimal@example.lk');
    await fireEvent.changeText(screen.getByLabelText(en.signIn.password), 'wrong');
    await fireEvent.press(screen.getByRole('button', { name: en.signIn.submit }));

    expect(await screen.findByText(en.signIn.emailError)).toBeTruthy();
    expect(screen.getByText(en.signIn.unverifiedHint)).toBeTruthy();
    expect(mockRouter.replace).not.toHaveBeenCalled();
    expect(tokenStore.get()).toBeNull();
  });
});

describe('the password box', () => {
  it('can show what was typed, and hide it again', async () => {
    serveApi({ 'GET /auth/whatsapp/config': () => ({ status: 200, body: { enabled: false } }) });
    mockRouter.params = { role: 'client' };
    await show(<SignIn />);
    const box = await screen.findByLabelText(en.signIn.password);
    await fireEvent.changeText(box, 'Secret-pass1');

    expect(box).toHaveProp('secureTextEntry', true);
    // The keyboard must never change what's typed.
    expect(box).toHaveProp('autoCapitalize', 'none');
    expect(box).toHaveProp('autoCorrect', false);
    await fireEvent.press(screen.getByRole('button', { name: en.common.showPassword }));
    expect(screen.getByLabelText(en.signIn.password)).toHaveProp('secureTextEntry', false);
    expect(screen.getByLabelText(en.signIn.password)).toHaveProp('value', 'Secret-pass1');
    await fireEvent.press(screen.getByRole('button', { name: en.common.hidePassword }));
    expect(screen.getByLabelText(en.signIn.password)).toHaveProp('secureTextEntry', true);
  });
});

describe('a refused email sign-in', () => {
  it('offers the other side’s sign-in, since the same refusal covers an account on that side', async () => {
    serveApi({
      'GET /auth/whatsapp/config': () => ({ status: 200, body: { enabled: false } }),
      'POST /auth/login': () => ({ status: 401, body: { message: 'Invalid credentials' } }),
    });
    mockRouter.params = { role: 'client' };
    await show(<SignIn />);
    await fireEvent.changeText(await screen.findByLabelText(en.signIn.email), 'nimal@example.lk');
    await fireEvent.changeText(screen.getByLabelText(en.signIn.password), 'right-password');
    await fireEvent.press(screen.getByRole('button', { name: en.signIn.submit }));

    await fireEvent.press(await screen.findByRole('link', { name: en.signIn.caregiver }));
    expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/sign-in', params: { role: 'caregiver' } });
  });

  it('recognises the refusal in Sinhala too', async () => {
    serveApi({
      'GET /auth/whatsapp/config': () => ({ status: 200, body: { enabled: false } }),
      'POST /auth/login': () => ({ status: 401, body: { message: 'පිවිසුම් අක්තපත්‍ර වලංගු නැත' } }),
    });
    mockRouter.params = { role: 'client' };
    await show(<SignIn />);
    await fireEvent.changeText(await screen.findByLabelText(en.signIn.email), 'nimal@example.lk');
    await fireEvent.changeText(screen.getByLabelText(en.signIn.password), 'whatever1');
    await fireEvent.press(screen.getByRole('button', { name: en.signIn.submit }));
    expect(await screen.findByText(en.signIn.unverifiedHint)).toBeTruthy();
  });

  it('shows the API’s own reason when the email isn’t verified yet', async () => {
    const reason = 'Please verify your email before logging in - check your inbox for the verification link.';
    serveApi({
      'GET /auth/whatsapp/config': () => ({ status: 200, body: { enabled: false } }),
      'POST /auth/login': () => ({ status: 401, body: { message: reason } }),
    });
    mockRouter.params = { role: 'caregiver' };
    await show(<SignIn />);
    await fireEvent.changeText(await screen.findByLabelText(en.signIn.email), 'nimal@example.lk');
    await fireEvent.changeText(screen.getByLabelText(en.signIn.password), 'right-password');
    await fireEvent.press(screen.getByRole('button', { name: en.signIn.submit }));

    expect(await screen.findByText(reason)).toBeTruthy();
    expect(screen.queryByText(en.signIn.emailError)).toBeNull();
  });
});

describe('signing in with WhatsApp', () => {
  it('offers WhatsApp first when it is on for this side, and sends the code on the caregiver portal', async () => {
    const calls = serveApi({
      'GET /auth/whatsapp/config': () => ({ status: 200, body: whatsappConfig({ caregiver: true, customer: false }) }),
      'POST /auth/whatsapp/request-otp': () => ({ status: 200, body: { resendAfterSeconds: 45, devOtp: '123456' } }),
    });
    mockRouter.params = { role: 'caregiver' };
    await show(<SignIn />);

    await fireEvent.changeText(await screen.findByLabelText(en.signIn.phone), '0771234567');
    await fireEvent.press(screen.getByRole('button', { name: en.signIn.sendCode }));

    await waitFor(() =>
      expect(mockRouter.push).toHaveBeenCalledWith({
        pathname: '/verify',
        params: { role: 'caregiver', phone: '0771234567', resendAfter: '45', devOtp: '123456' },
      }),
    );
    expect(calls.find((c) => c.route === 'POST /auth/whatsapp/request-otp')!.body).toEqual({
      phone: '0771234567',
      purpose: 'LOGIN',
      portal: 'caregiver',
    });
  });

  it('goes straight to email when WhatsApp sign-in is off for this side', async () => {
    serveApi({ 'GET /auth/whatsapp/config': () => ({ status: 200, body: whatsappConfig({ caregiver: true, customer: false }) }) });
    mockRouter.params = { role: 'client' };
    await show(<SignIn />);
    expect(await screen.findByLabelText(en.signIn.email)).toBeTruthy();
    expect(screen.queryByLabelText(en.signIn.phone)).toBeNull();
    expect(screen.queryByText(en.signIn.useWhatsapp)).toBeNull();
  });

  it('verifies the code, signs in and goes home', async () => {
    const tokens = tokensFor('CAREGIVER', { caregiverId: 'cg-1', phone: '+94771234567' });
    const calls = serveApi({
      'POST /auth/whatsapp/verify-otp': () => ({ status: 200, body: { tokens, userId: 'u-1', role: 'CAREGIVER' } }),
    });
    mockRouter.params = { role: 'caregiver', phone: '0771234567', resendAfter: '30', devOtp: '' };
    await show(<Verify />);

    await fireEvent.changeText(await screen.findByLabelText(en.otp.code), '12 34-56');
    await fireEvent.press(screen.getByRole('button', { name: en.otp.verify }));

    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/home'));
    expect(calls.find((c) => c.route === 'POST /auth/whatsapp/verify-otp')!.body).toEqual({
      phone: '0771234567',
      purpose: 'LOGIN',
      portal: 'caregiver',
      code: '123456',
    });
    expect(tokenStore.get()).toEqual(tokens);
  });

  it('shows the API’s message for a wrong code, and stays on the screen', async () => {
    serveApi({
      'POST /auth/whatsapp/verify-otp': () => ({
        status: 401,
        body: { message: 'This code is invalid or has expired. Request a new one and try again.' },
      }),
    });
    mockRouter.params = { role: 'client', phone: '0771234567', resendAfter: '30' };
    await show(<Verify />);
    await fireEvent.changeText(await screen.findByLabelText(en.otp.code), '000000');
    await fireEvent.press(screen.getByRole('button', { name: en.otp.verify }));
    expect(await screen.findByText(/invalid or has expired/)).toBeTruthy();
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it('lets a new code be requested only after the wait', async () => {
    jest.useFakeTimers();
    try {
      const calls = serveApi({
        'POST /auth/whatsapp/request-otp': () => ({ status: 200, body: { resendAfterSeconds: 60 } }),
      });
      mockRouter.params = { role: 'client', phone: '0771234567', resendAfter: '2' };
      await show(<Verify />);
      expect(screen.getByText(`${en.otp.resendIn} 2s`)).toBeTruthy();
      await fireEvent.press(screen.getByText(`${en.otp.resendIn} 2s`));
      expect(calls.some((c) => c.route === 'POST /auth/whatsapp/request-otp')).toBe(false);

      // One tick a second: each re-render schedules the next.
      for (const s of [1, 0]) {
        await act(async () => void jest.advanceTimersByTime(1000));
        if (s) expect(screen.getByText(`${en.otp.resendIn} ${s}s`)).toBeTruthy();
      }
      await fireEvent.press(screen.getByText(en.otp.resend));

      await waitFor(() => expect(screen.getByText(en.otp.resent)).toBeTruthy());
      expect(calls.at(-1)!.body).toEqual({ phone: '0771234567', purpose: 'LOGIN', portal: 'customer' });
      expect(screen.getByText(`${en.otp.resendIn} 60s`)).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('signed in', () => {
  it('opens on the home screen, and signs out back to the welcome screen', async () => {
    await tokenStore.set(tokensFor('CAREGIVER', { phone: '+94771234567' }));
    const calls = serveApi({ 'POST /auth/logout': () => ({ status: 200, body: { success: true } }) });

    await show(<Welcome />);
    expect(await screen.findByText('redirect:/home')).toBeTruthy();

    await act(async () => void (await show(<Home />)));
    expect(await screen.findByText('+94771234567')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: en.home.signOut }));

    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/'));
    expect(calls.some((c) => c.route === 'POST /auth/logout')).toBe(true);
    expect(tokenStore.get()).toBeNull();
  });

  it('sends a signed-out visitor from home back to the welcome screen', async () => {
    await show(<Home />);
    expect(await screen.findByText('redirect:/')).toBeTruthy();
  });

  it('opens registration on the website for now', async () => {
    serveApi({ 'GET /auth/whatsapp/config': () => ({ status: 200, body: { enabled: false } }) });
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    mockRouter.params = { role: 'caregiver' };
    await show(<SignIn />);
    await fireEvent.press(await screen.findByRole('link', { name: en.signIn.signUp }));
    expect(open).toHaveBeenCalledWith('https://find.caregivers.lk/caregiver/join');
  });
});
