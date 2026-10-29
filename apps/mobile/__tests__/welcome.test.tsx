import type { ReactElement } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import * as SplashScreen from 'expo-splash-screen';
import en from '../src/i18n/en.json';
import si from '../src/i18n/si.json';
import ta from '../src/i18n/ta.json';
import { I18nProvider, currentLanguage } from '@/i18n';
import RootLayout from '../app/_layout';
import Welcome from '../app/index';
import SignIn from '../app/(auth)/sign-in';

/**
 * The welcome flow on the real screens, with the shared i18n engine running on
 * AsyncStorage as it does on a phone. Only native-only pieces are stood in for:
 * the splash screen, and the router (Link records where it would go; Stack
 * shows the first screen).
 */
jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: jest.fn(() => Promise.resolve(true)),
  hideAsync: jest.fn(() => Promise.resolve()),
}));

let mockParams: { role?: string } = {};
jest.mock('expo-router', () => {
  const React = require('react');
  return {
    Link: ({ href, children }: { href: string | { pathname: string; params?: { role?: string } }; children: ReactElement }) =>
      React.cloneElement(children, {
        testID: typeof href === 'string' ? `link:${href}` : `link:${href.pathname}?role=${href.params?.role}`,
      }),
    Stack: () => React.createElement(require('../app/index').default),
    useLocalSearchParams: () => mockParams,
  };
});

const KEY = 'carelink-locale';

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  mockParams = {};
});

describe('launch', () => {
  it('keeps the splash screen up until the saved language has loaded, then shows it', async () => {
    await AsyncStorage.setItem(KEY, 'si');
    let release: (value: string | null) => void = () => undefined;
    jest.spyOn(AsyncStorage, 'getItem').mockImplementationOnce(
      () => new Promise<string | null>((resolve) => (release = resolve)),
    );

    await render(<RootLayout />);
    // Still loading: nothing is drawn (so no English flash) and the splash stays.
    expect(screen.queryByText(en.welcome.tagline)).toBeNull();
    expect(screen.queryByText(si.welcome.tagline)).toBeNull();
    expect(SplashScreen.hideAsync).not.toHaveBeenCalled();

    await act(async () => release('si'));

    expect(screen.getByText(si.welcome.tagline)).toBeTruthy();
    expect(SplashScreen.hideAsync).toHaveBeenCalledTimes(1);
    expect(currentLanguage()).toBe('si');
  });

  it('starts in English when nothing is saved', async () => {
    await render(<RootLayout />);
    expect(await screen.findByText(en.welcome.tagline)).toBeTruthy();
    expect(screen.getByText('CareLink')).toBeTruthy();
  });
});

describe('welcome screen', () => {
  const renderWelcome = () =>
    render(
      <I18nProvider>
        <Welcome />
      </I18nProvider>,
    );

  it('switches language, saves the choice, and tells the API client', async () => {
    await renderWelcome();
    await screen.findByText(en.welcome.tagline);

    await fireEvent.press(screen.getByText('தமிழ்'));

    expect(screen.getByText(ta.welcome.tagline)).toBeTruthy();
    expect(await AsyncStorage.getItem(KEY)).toBe('ta');
    expect(currentLanguage()).toBe('ta');
    expect(screen.getByRole('radio', { name: 'தமிழ்' })).toHaveProp('accessibilityState', { selected: true });
  });

  it('offers both sides of the app, each going to sign-in with its role', async () => {
    await renderWelcome();
    await screen.findByText(en.welcome.tagline);

    expect(screen.getByTestId('link:/sign-in?role=client')).toHaveTextContent(en.welcome.findCare);
    expect(screen.getByTestId('link:/sign-in?role=caregiver')).toHaveTextContent(en.welcome.joinAsCaregiver);
  });
});

describe('sign-in placeholder', () => {
  it.each([
    ['caregiver', en.signIn.caregiver],
    ['client', en.signIn.client],
  ])('shows the %s title', async (role, title) => {
    mockParams = { role };
    await render(
      <I18nProvider>
        <SignIn />
      </I18nProvider>,
    );
    expect(await screen.findByText(title)).toBeTruthy();
    expect(screen.getByTestId('link:/')).toHaveTextContent(en.signIn.back);
  });
});
