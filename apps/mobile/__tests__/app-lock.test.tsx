import { AppState, Text } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import en from '../src/i18n/en.json';
import Account from '../app/(client)/account';
import { AppProviders } from '../test-utils/app';
import { mockRouter } from '../test-utils/router';

jest.mock('expo-router', () => require('../test-utils/router').expoRouterMock());
import { tokensFor } from '../test-utils/helpers';
import { tokenStore } from '@/api';
import { useAuth } from '@/auth/AuthProvider';
import { LOCK_AFTER_MS, lockClock, readLockChoice, saveLockChoice } from '@/auth/app-lock';

const auth = LocalAuthentication as jest.Mocked<typeof LocalAuthentication>;

/** A phone with a fingerprint set up; `answers` are what the prompt returns, in turn (then success). */
function phoneWithFingerprint(answers: { success: boolean; error?: string }[] = []) {
  auth.hasHardwareAsync.mockResolvedValue(true);
  auth.isEnrolledAsync.mockResolvedValue(true);
  auth.supportedAuthenticationTypesAsync.mockResolvedValue([LocalAuthentication.AuthenticationType.FINGERPRINT]);
  auth.authenticateAsync.mockReset();
  for (const answer of answers) auth.authenticateAsync.mockResolvedValueOnce(answer as never);
  auth.authenticateAsync.mockResolvedValue({ success: true } as never);
}

/** Who is signed in, and a way to sign in - standing in for the app's screens. */
function Probe({ sub = 'u-1' }: { sub?: string }) {
  const { user, signIn } = useAuth();
  return (
    <>
      <Text>{user ? `signed in as ${user.userId}` : 'signed out'}</Text>
      <Text onPress={() => void signIn(tokensFor('PATIENT_GUARDIAN', { sub }))}>sign in</Text>
    </>
  );
}

let appStateListeners: ((state: string) => void)[] = [];
const appGoes = (state: string) => appStateListeners.forEach((listener) => listener(state));
beforeEach(async () => {
  mockRouter.reset();
  await tokenStore.clear();
  appStateListeners = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((type: string, listener: (state: string) => void) => {
    if (type === 'change') appStateListeners.push(listener);
    return { remove: () => void (appStateListeners = appStateListeners.filter((l) => l !== listener)) };
  }) as never);
  Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true });
});

afterEach(() => {
  jest.restoreAllMocks();
  auth.hasHardwareAsync.mockResolvedValue(false);
  auth.isEnrolledAsync.mockResolvedValue(false);
  auth.supportedAuthenticationTypesAsync.mockResolvedValue([]);
});

const show = (ui = <Probe />) => render(<AppProviders>{ui}</AppProviders>);

describe('face / fingerprint unlock', () => {
  it('on a phone without face or fingerprint: never offered, no switch, never locked', async () => {
    await tokenStore.set(tokensFor('PATIENT_GUARDIAN'));
    await saveLockChoice('u-1', 'on');
    await show(<Account />);
    expect(await screen.findByText(en.nav.signOut)).toBeTruthy();
    expect(screen.queryByTestId('app-lock')).toBeNull();
    expect(screen.queryByText('Unlock with your fingerprint')).toBeNull();
  });

  it('offers it once after signing in; "Yes" checks the fingerprint and turns it on', async () => {
    phoneWithFingerprint();
    await show();
    await fireEvent.press(await screen.findByText('sign in'));

    expect(await screen.findByText('Open CareLink with your fingerprint?')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: en.appLock.offerYes }));
    expect(auth.authenticateAsync).toHaveBeenCalledWith(expect.objectContaining({ promptMessage: en.appLock.confirmPrompt, disableDeviceFallback: false }));
    expect(screen.queryByTestId('app-lock-offer')).toBeNull();
    expect(await readLockChoice('u-1')).toBe('on');
    // Just signed in: not locked straight after.
    expect(screen.queryByTestId('app-lock')).toBeNull();
  });

  it('"Not now" is remembered: not asked again on the next sign-in', async () => {
    phoneWithFingerprint();
    await show();
    await fireEvent.press(await screen.findByText('sign in'));
    await fireEvent.press(await screen.findByRole('button', { name: en.appLock.offerNo }));
    expect(await readLockChoice('u-1')).toBe('off');
    expect(auth.authenticateAsync).not.toHaveBeenCalled();
  });

  it('is asked of each account on the phone separately', async () => {
    phoneWithFingerprint();
    await saveLockChoice('u-1', 'off');
    await show(<Probe sub="u-2" />);
    await fireEvent.press(await screen.findByText('sign in'));
    expect(await screen.findByTestId('app-lock-offer')).toBeTruthy();
  });

  it('when on, locks on opening the app and asks straight away; a cancel leaves it locked with a button', async () => {
    phoneWithFingerprint([{ success: false, error: 'user_cancel' }]);
    await tokenStore.set(tokensFor('PATIENT_GUARDIAN'));
    await saveLockChoice('u-1', 'on');
    await show();

    expect(await screen.findByTestId('app-lock')).toBeTruthy();
    expect(screen.getByText('CareLink is locked')).toBeTruthy();
    expect(auth.authenticateAsync).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(en.appLock.notUnlocked)).toBeTruthy();
    // The screens underneath are hidden from screen readers while locked.
    expect(screen.queryByText('signed in as u-1')).toBeNull();

    await fireEvent.press(screen.getByRole('button', { name: en.appLock.unlock }));
    expect(screen.queryByTestId('app-lock')).toBeNull();
    expect(screen.getByText('signed in as u-1')).toBeTruthy();
  });

  it('locks again after 5 minutes in the background, not after a quick switch away', async () => {
    phoneWithFingerprint();
    await tokenStore.set(tokensFor('PATIENT_GUARDIAN'));
    await saveLockChoice('u-1', 'on');
    await show();
    expect(await screen.findByText('signed in as u-1')).toBeTruthy(); // unlocked by the first prompt
    const base = 1_000_000;
    const now = jest.spyOn(lockClock, 'now');

    now.mockReturnValue(base);
    await act(async () => appGoes('background'));
    now.mockReturnValue(base + 60_000);
    await act(async () => appGoes('active'));
    expect(screen.queryByTestId('app-lock')).toBeNull();

    await act(async () => appGoes('background'));
    now.mockReturnValue(base + 60_000 + LOCK_AFTER_MS);
    auth.authenticateAsync.mockResolvedValueOnce({ success: false, error: 'user_cancel' } as never);
    await act(async () => appGoes('active'));
    expect(await screen.findByTestId('app-lock')).toBeTruthy();
  });

  it('"Sign in another way" signs out and turns the lock off', async () => {
    phoneWithFingerprint([{ success: false, error: 'user_cancel' }]);
    await tokenStore.set(tokensFor('PATIENT_GUARDIAN'));
    await saveLockChoice('u-1', 'on');
    await show();
    await fireEvent.press(await screen.findByRole('link', { name: en.appLock.signInAnotherWay }));

    expect(await screen.findByText('signed out')).toBeTruthy();
    expect(screen.queryByTestId('app-lock')).toBeNull();
    expect(tokenStore.get()).toBeNull();
    expect(await readLockChoice('u-1')).toBe('off');
    expect(mockRouter.replace).toHaveBeenCalledWith('/');
  });

  it('never traps the owner: a phone that can no longer check opens and stops asking', async () => {
    phoneWithFingerprint([{ success: false, error: 'passcode_not_set' }]);
    await tokenStore.set(tokensFor('PATIENT_GUARDIAN'));
    await saveLockChoice('u-1', 'on');
    await show();
    expect(await screen.findByText('signed in as u-1')).toBeTruthy();
    expect(screen.queryByTestId('app-lock')).toBeNull();
    expect(await readLockChoice('u-1')).toBe('off');
  });

  it('has a switch in My account: on after a fingerprint check, off without one', async () => {
    phoneWithFingerprint();
    await tokenStore.set(tokensFor('PATIENT_GUARDIAN'));
    await saveLockChoice('u-1', 'off');
    await show(<Account />);

    const toggle = await screen.findByLabelText('Unlock with your fingerprint');
    expect(toggle).toHaveProp('value', false);
    await fireEvent(toggle, 'valueChange', true);
    expect(auth.authenticateAsync).toHaveBeenCalledTimes(1);
    expect(await readLockChoice('u-1')).toBe('on');
    expect(screen.getByLabelText('Unlock with your fingerprint')).toHaveProp('value', true);

    await fireEvent(screen.getByLabelText('Unlock with your fingerprint'), 'valueChange', false);
    expect(auth.authenticateAsync).toHaveBeenCalledTimes(1);
    expect(await readLockChoice('u-1')).toBe('off');
  });

  it('stays off if the check to turn it on is cancelled', async () => {
    phoneWithFingerprint([{ success: false, error: 'user_cancel' }]);
    await tokenStore.set(tokensFor('PATIENT_GUARDIAN'));
    await saveLockChoice('u-1', 'off');
    await show(<Account />);
    await fireEvent(await screen.findByLabelText('Unlock with your fingerprint'), 'valueChange', true);
    expect(await readLockChoice('u-1')).toBe('off');
    expect(screen.getByLabelText('Unlock with your fingerprint')).toHaveProp('value', false);
  });
});
