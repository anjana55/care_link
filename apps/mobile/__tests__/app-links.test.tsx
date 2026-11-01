import { Text } from 'react-native';
import { Redirect, Stack } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import { config } from '../src/config';
import appConfig, { APP_LINK_PATHS } from '../app.config';
import { redirectSystemPath } from '../app/+native-intent';
import { appScreenFor, routeForIncoming } from '../src/links/app-links';
import { afterSignIn, caregiverOnly } from '../src/auth/sides';

/**
 * App links: a link to the website in an email or a WhatsApp message opens
 * the app (on Android, once the site vouches for it) at the screen showing
 * the same thing - and only the links the app has a screen for.
 */
jest.mock('@expo/vector-icons/Ionicons', () => Object.assign(() => null, { glyphMap: {} }));

const SITE = 'find.caregivers.lk';
const page = (name: string) => () => <Text>{name}</Text>;
const INVOICE_ID = '0f8fad5b-d9cb-469f-a165-70867728950e';

/** Every website link the API's emails, WhatsApp messages and payment returns contain, and where each lands. */
const SENT_BY_THE_API: [string, string][] = [
  ['/account/requests', '/requests'],
  ['/account/bookings', '/bookings'],
  ['/account/invoices', '/invoices'],
  [`/account/invoices/${INVOICE_ID}`, `/invoices/${INVOICE_ID}`],
  [`/account/invoices/${INVOICE_ID}?payment=return`, `/invoices/${INVOICE_ID}`],
  ['/caregiver/dashboard', '/home'],
  ['/caregiver/shifts', '/shifts'],
  ['/caregiver/payments', '/payments'],
];
/** Website pages people share or bookmark. */
const OTHERS: [string, string][] = [
  ['/account', '/account'],
  ['/account/', '/account'],
  ['/account/sign-in', '/account'],
  ['/account/saved', '/saved'],
  ['/caregiver/documents', '/documents'],
  ['/caregiver/profile', '/profile'],
  ['/caregivers/CG-00123', '/caregivers/CG-00123'],
  ['/find?district=3', '/find'],
];
/** Pages that must stay in the browser: the app has no screen for them, or they finish something started there. */
const STAY_ON_THE_WEBSITE = [
  '/verify-email?token=x',
  '/reset-password?token=x',
  '/social/callback?code=x',
  '/caregiver/social/callback?code=x',
  '/delete-account',
  '/register',
  '/caregiver/join',
  '/caregiver/login',
  '/caregiver/work-abroad',
  '/login',
  '/',
];

const filters = () => {
  const config = appConfig({ config: {} } as never);
  return config.android!.intentFilters!;
};
const dataOf = (f: ReturnType<typeof filters>[number]) => [f.data ?? []].flat();
const handledByTheApp = (pathAndQuery: string) =>
  filters().some((f) => f.autoVerify && dataOf(f).some((d) => d.scheme === 'https' && d.host === SITE && pathAndQuery.split('?')[0].startsWith(d.pathPrefix!)));

describe('which links open the app', () => {
  it('asks Android, with verification, for the website links the app has screens for', () => {
    expect(filters()).toHaveLength(1);
    expect(filters()[0]).toMatchObject({ action: 'VIEW', autoVerify: true, category: ['BROWSABLE', 'DEFAULT'] });
    expect(dataOf(filters()[0]).map((d) => d.pathPrefix)).toEqual(APP_LINK_PATHS);
    expect(appConfig({ config: {} } as never).extra!.appLinkHost).toBe(SITE);
  });

  it.each([...SENT_BY_THE_API, ...OTHERS])('%s opens the app at %s', (path, screenPath) => {
    expect(handledByTheApp(path)).toBe(true);
    expect(routeForIncoming(`https://${SITE}${path}`, SITE)).toBe(screenPath);
  });

  it.each(STAY_ON_THE_WEBSITE)('%s stays on the website', (path) => {
    expect(handledByTheApp(path)).toBe(false);
  });

  it('opens the start screen for a link under those paths it has no screen for', () => {
    expect(appScreenFor('/account/something-new')).toBe('/');
    expect(appScreenFor('/account/invoices/not-an-id')).toBe('/');
    expect(appScreenFor('/caregivers/a/b')).toBe('/');
  });

  it("leaves the app's own addresses, and other sites', as they came", () => {
    const callback = 'carelink://auth/callback?flow=login&nonce=n&code=c';
    expect(routeForIncoming(callback, SITE)).toBe(callback);
    expect(routeForIncoming('/bookings', SITE)).toBe('/bookings');
    expect(routeForIncoming(`http://${SITE}/account/bookings`, SITE)).toBe(`http://${SITE}/account/bookings`);
    expect(routeForIncoming('https://evil.example/account/bookings', SITE)).toBe('https://evil.example/account/bookings');
    expect(routeForIncoming(`https://${SITE}.evil.example/account/bookings`, SITE)).toBe(`https://${SITE}.evil.example/account/bookings`);
    expect(routeForIncoming(`https://${SITE}/account/bookings`, null)).toBe(`https://${SITE}/account/bookings`);
  });
});

describe('opening the app from a link', () => {
  beforeEach(() => {
    jest.replaceProperty(config, 'appLinkHost', SITE);
  });

  // expo-router hands every address the app is opened with to this, before routing.
  it('turns a website link into the screen it points to', () => {
    expect(redirectSystemPath({ path: `https://${SITE}/account/bookings`, initial: true })).toBe('/bookings');
    expect(redirectSystemPath({ path: `https://${SITE}/account/invoices/${INVOICE_ID}`, initial: false })).toBe(`/invoices/${INVOICE_ID}`);
  });

  it('passes the sign-in return through untouched', () => {
    expect(redirectSystemPath({ path: 'carelink://auth/callback?flow=login', initial: false })).toBe('carelink://auth/callback?flow=login');
  });

  it('never crashes over an address it cannot read', () => {
    expect(redirectSystemPath({ path: 'not a url', initial: true })).toBe('not a url');
  });
});

describe('arriving signed out, or on the other side', () => {
  it('sends a caregiver link to the caregiver sign-in, and back to it afterwards', () => {
    expect(caregiverOnly(null, '/shifts')).toEqual({ pathname: '/sign-in', params: { role: 'caregiver', returnTo: '/shifts' } });
    expect(afterSignIn({ role: 'CAREGIVER' }, '/shifts')).toBe('/shifts');
    expect(afterSignIn({ role: 'CAREGIVER' }, '/payments')).toBe('/payments');
    expect(caregiverOnly({ role: 'CAREGIVER' }, '/shifts')).toBeNull();
  });

  it('keeps each side to its own screens', () => {
    // A client who opens a caregiver link goes to their own area, and the reverse.
    expect(caregiverOnly({ role: 'PATIENT_GUARDIAN' }, '/shifts')).toBe('/find');
    expect(afterSignIn({ role: 'PATIENT_GUARDIAN' }, '/shifts')).toBe('/find');
    expect(afterSignIn({ role: 'CAREGIVER' }, '/bookings')).toBe('/home');
    expect(afterSignIn({ role: 'PATIENT_GUARDIAN' }, `/invoices/${INVOICE_ID}`)).toBe(`/invoices/${INVOICE_ID}`);
  });

  it('a guarded screen sends someone signed out to sign in, with the way back', async () => {
    const Guarded = () => {
      const gate = caregiverOnly(null, '/shifts');
      return gate ? <Redirect href={gate} /> : <Text>Shifts</Text>;
    };
    const r = await renderRouter(
      {
        _layout: () => <Stack screenOptions={{ headerShown: false }} />,
        '(caregiver)/shifts': Guarded,
        '(auth)/sign-in': page('Sign in'),
      },
      { initialUrl: '/shifts' },
    );
    expect(r.getPathname()).toBe('/sign-in');
    expect(r.getSearchParams()).toEqual({ role: 'caregiver', returnTo: '/shifts' });
  });

});
