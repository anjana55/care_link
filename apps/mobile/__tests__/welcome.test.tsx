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
    expect(screen.queryByText(en.welcome.tagline)).toBeNull();
    expect(screen.queryByText(si.welcome.tagline)).toBeNull();
    expect(SplashScreen.hideAsync).not.toHaveBeenCalled();

    await act(async () => release('si'));

    expect(await screen.findByText(si.welcome.tagline)).toBeTruthy();
    expect(SplashScreen.hideAsync).toHaveBeenCalledTimes(1);
    expect(currentLanguage()).toBe('si');
  });

  it('starts in English, under the build’s brand name, with no saved language and no signal', async () => {
    await render(<RootLayout />);
    expect(await screen.findByText(en.welcome.tagline)).toBeTruthy();
    expect(screen.getByText('CareLink')).toBeTruthy();
  });

  it('takes the name, colours and languages from the deployment’s branding', async () => {
    serveBranding(GOLDEN);
    await render(<RootLayout />);

    expect(await screen.findByText('Golden Years Care')).toBeTruthy();
    expect(screen.getByRole('button', { name: en.welcome.findCare })).toHaveStyle({ backgroundColor: '#7A3E00' });
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
    await screen.findByText(en.welcome.tagline);

    await fireEvent.press(screen.getByText('தமிழ்'));

    expect(screen.getByText(ta.welcome.tagline)).toBeTruthy();
    expect(await AsyncStorage.getItem(LOCALE_KEY)).toBe('ta');
    expect(currentLanguage()).toBe('ta');
    expect(screen.getByRole('radio', { name: 'தமிழ்' })).toHaveProp('accessibilityState', { selected: true });
  });

  it('writes Sinhala and Tamil in the bundled Noto fonts, and English in the system font', async () => {
    await renderWelcome();
    await screen.findByText(en.welcome.tagline);
    expect(screen.getByText(en.welcome.tagline)).not.toHaveStyle({ fontFamily: expect.anything() });
    // Each language's own name, in its own font, whatever the reading language.
    expect(screen.getByText('සිංහල')).toHaveStyle({ fontFamily: 'NotoSansSinhala_400Regular' });
    expect(screen.getByText('தமிழ்')).toHaveStyle({ fontFamily: 'NotoSansTamil_400Regular' });

    await fireEvent.press(screen.getByText('සිංහල'));
    expect(screen.getByText(si.welcome.tagline)).toHaveStyle({ fontFamily: 'NotoSansSinhala_400Regular' });
    // Bold text uses the bold file, not a synthesised bold.
    expect(screen.getByText(si.welcome.findCare)).toHaveStyle({ fontFamily: 'NotoSansSinhala_700Bold', fontWeight: 'normal' });
  });

  it('offers both sides of the app, each going to sign-in with its role', async () => {
    await renderWelcome();
    await screen.findByText(en.welcome.tagline);

    expect(screen.getByTestId('link:/sign-in?role=client')).toHaveTextContent(en.welcome.findCare);
    expect(screen.getByTestId('link:/sign-in?role=caregiver')).toHaveTextContent(en.welcome.joinAsCaregiver);
  });
});

