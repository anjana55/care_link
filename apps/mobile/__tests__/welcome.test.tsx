import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import * as SplashScreen from 'expo-splash-screen';
import { DEFAULT_BRANDING, type PublicBranding } from '@care-platform/shared';
import en from '../src/i18n/en.json';
import si from '../src/i18n/si.json';
import ta from '../src/i18n/ta.json';
import { currentLanguage } from '@/i18n';
import RootLayout from '../app/_layout';
import Welcome from '../app/index';
import GetStarted from '../app/get-started';
import { json } from '../test-utils/helpers';
import { mockRouter } from '../test-utils/router';
import { AppProviders } from '../test-utils/app';

/**
 * The welcome flow on the real screens and the real root layout: the shared
 * i18n engine on AsyncStorage, branding from GET /branding, the session from
 * secure storage. Only native-only pieces are stood in for: the splash screen,
 * and the router (Link records where it would go; Stack shows the first screen).
 */
jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: jest.fn(() => Promise.resolve(true)),
  hideAsync: jest.fn(() => Promise.resolve()),
}));

jest.mock('expo-router', () => require('../test-utils/router').expoRouterMock());

const LOCALE_KEY = 'carelink-locale';
const BRANDING_KEY = 'carelink.branding';

const GOLDEN: PublicBranding = {
  ...DEFAULT_BRANDING,
  companyName: 'Golden Years Care',
  shortName: 'GY',
  primaryColor: '#7A3E00',
  enabledLocales: ['en', 'si'],
};

/** Answers GET /branding; everything else has no network. */
function serveBranding(branding: PublicBranding) {
  globalThis.fetch = jest.fn(async (url: string) =>
    String(url).endsWith('/branding') ? json(200, branding) : Promise.reject(new TypeError('Network request failed')),
  ) as never;
}

let restoreGetItem: (() => void) | null = null;
afterEach(() => {
  restoreGetItem?.();
  restoreGetItem = null;
});

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  mockRouter.reset();
});

describe('launch', () => {
  it('keeps the splash screen up until the saved language has loaded, then shows it', async () => {
    await AsyncStorage.setItem(LOCALE_KEY, 'si');
    let release: (value: string | null) => void = () => undefined;
    // getItem is already the library's mock: hold back only the saved language.
    const getItem = jest.mocked(AsyncStorage.getItem);
    const realGetItem = getItem.getMockImplementation()!;
    getItem.mockImplementation((key: string) =>
      key === LOCALE_KEY ? new Promise<string | null>((resolve) => (release = resolve)) : realGetItem(key),
    );
    restoreGetItem = () => getItem.mockImplementation(realGetItem);

    await render(<RootLayout />);
    // Still loading: nothing is drawn (so no English flash) and the splash stays.
    expect(screen.queryByText(en.welcome.headline)).toBeNull();
    expect(screen.queryByText(si.welcome.headline)).toBeNull();
    expect(SplashScreen.hideAsync).not.toHaveBeenCalled();

    await act(async () => release('si'));

    expect(await screen.findByText(si.welcome.headline)).toBeTruthy();
    expect(SplashScreen.hideAsync).toHaveBeenCalledTimes(1);
    expect(currentLanguage()).toBe('si');
  });

  it('starts in English, under the build’s brand name, with no saved language and no signal', async () => {
    await render(<RootLayout />);
    expect(await screen.findByText(en.welcome.headline)).toBeTruthy();
    expect(screen.getByText('CareLink')).toBeTruthy();
  });

  it('takes the name, colours and languages from the deployment’s branding', async () => {
    serveBranding(GOLDEN);
    await render(<RootLayout />);

    expect(await screen.findByText('Golden Years Care')).toBeTruthy();
    expect(screen.getByTestId('welcome-band')).toHaveStyle({ backgroundColor: '#7A3E00' });
    // Tamil is switched off for this deployment, so it isn't offered.
    expect(screen.getByText('සිංහල')).toBeTruthy();
    expect(screen.queryByText('தமிழ்')).toBeNull();
    // Kept for the next launch.
    expect(JSON.parse((await AsyncStorage.getItem(BRANDING_KEY))!)).toMatchObject({ companyName: 'Golden Years Care' });
  });

  it('uses the branding it saved last time when there is no signal', async () => {
    await AsyncStorage.setItem(BRANDING_KEY, JSON.stringify(GOLDEN));
    await render(<RootLayout />);
    expect(await screen.findByText('Golden Years Care')).toBeTruthy();
  });
});

describe('welcome screen', () => {
  const renderWelcome = () =>
    render(
      <AppProviders>
        <Welcome />
      </AppProviders>,
    );

  it('switches language, saves the choice, and tells the API client', async () => {
    await renderWelcome();
    await screen.findByText(en.welcome.headline);

    await fireEvent.press(screen.getByText('தமிழ்'));

    expect(screen.getByText(ta.welcome.headline)).toBeTruthy();
    expect(await AsyncStorage.getItem(LOCALE_KEY)).toBe('ta');
    expect(currentLanguage()).toBe('ta');
    expect(screen.getByRole('radio', { name: 'தமிழ்' })).toHaveProp('accessibilityState', { selected: true });
  });

  it('writes Sinhala and Tamil in the bundled Noto fonts, and English in the system font', async () => {
    await renderWelcome();
    await screen.findByText(en.welcome.headline);
    expect(screen.getByText(en.welcome.headline)).not.toHaveStyle({ fontFamily: expect.anything() });
    // Each language's own name, in its own font, whatever the reading language.
    expect(screen.getByText('සිංහල')).toHaveStyle({ fontFamily: 'NotoSansSinhala_400Regular' });
    expect(screen.getByText('தமிழ்')).toHaveStyle({ fontFamily: 'NotoSansTamil_400Regular' });

    await fireEvent.press(screen.getByText('සිංහල'));
    expect(screen.getByText(si.welcome.subline)).toHaveStyle({ fontFamily: 'NotoSansSinhala_400Regular' });
    // Bold text uses the bold file, not a synthesised bold.
    expect(screen.getByText(si.welcome.getStarted)).toHaveStyle({ fontFamily: 'NotoSansSinhala_700Bold', fontWeight: 'normal' });
    expect(screen.getByText(si.welcome.headline)).toHaveStyle({ fontFamily: 'NotoSansSinhala_700Bold', fontWeight: 'normal' });
  });

  it('shows the caregivers picture, one Get started button, and sign-in for people with an account', async () => {
    await renderWelcome();
    await screen.findByText(en.welcome.headline);

    expect(screen.getByLabelText(en.welcome.pictureLabel)).toBeTruthy();
    expect(screen.getByTestId('link:/get-started')).toHaveTextContent(en.welcome.getStarted);
    expect(screen.getByText(en.welcome.haveAccount)).toBeTruthy();
    expect(screen.getByTestId('link:/sign-in?role=client')).toHaveTextContent(en.signIn.client);
    expect(screen.getByTestId('link:/sign-in?role=caregiver')).toHaveTextContent(en.signIn.caregiver);
    // The first screen has nowhere to go back to.
    expect(screen.queryByRole('button', { name: en.nav.back })).toBeNull();
  });
});

describe('get started', () => {
  it('asks which side of the app this is: care goes to the client home (no account needed), caregivers to sign-in', async () => {
    await render(
      <AppProviders>
        <GetStarted />
      </AppProviders>,
    );
    expect(await screen.findByRole('header', { name: en.start.title })).toBeTruthy();
    expect(screen.getByTestId('link:/start')).toHaveTextContent(en.start.needCare, { exact: false });
    expect(screen.getByTestId('link:/sign-in?role=caregiver')).toHaveTextContent(en.start.caregiver, { exact: false });

    // Back, and Home - the welcome screen, for someone not signed in.
    await fireEvent.press(screen.getByRole('button', { name: en.nav.back }));
    expect(mockRouter.replace).toHaveBeenLastCalledWith('/');
    await fireEvent.press(screen.getByRole('button', { name: en.nav.home }));
    expect(mockRouter.replace).toHaveBeenLastCalledWith('/');
  });
});

