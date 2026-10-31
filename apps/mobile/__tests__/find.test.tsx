import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { colomboToday, type PublicCaregiverSummary } from '@care-platform/shared';
import en from '../src/i18n/en.json';
import Find from '../app/(client)/find';
import Account from '../app/(client)/account';
import CaregiverProfile from '../app/caregivers/[publicId]';
import Home from '../app/(caregiver)/home';
import Welcome from '../app/index';
import { AppProviders, serveApi } from '../test-utils/app';
import { mockRouter } from '../test-utils/router';
import { tokensFor } from '../test-utils/helpers';
import { tokenStore } from '@/api';

jest.mock('expo-router', () => require('../test-utils/router').expoRouterMock());

const TREE = [{ id: 1, name: 'Western', districts: [{ id: 6, name: 'Gampaha' }, { id: 5, name: 'Colombo' }] }];
const CITIES = [{ id: 50, name: 'Dehiwala', subName: null, postcode: null, latitude: 6.85, longitude: 79.86 }];

function caregiver(n: number, extra: Partial<PublicCaregiverSummary> = {}): PublicCaregiverSummary {
  return {
    publicId: `cg${n}abcdef-0000`,
    gender: 'FEMALE',
    approxAge: 40 + n,
    yearsExperience: 5,
    district: 'Colombo',
    city: 'Dehiwala',
    districtId: 5,
    cityId: 50,
    preferredLocations: [],
    languages: [{ name: 'Sinhala', proficiency: 'Fluent' }],
    skills: [{ id: 's1', name: 'Bathing' }],
    availability: { dayDuty: true, nightDuty: false, liveIn24h: false, preferredShift: 'DAY', availableFrom: null },
    hasVerifiedQualification: false,
    verified: true,
    careTypes: ['HOME_SHIFT'],
    qualificationSummary: [],
    relevantExperienceSummary: [],
    homeLocation: null,
    distanceKm: 3,
    serviceArea: [],
    ...extra,
  };
}

const page = (items: PublicCaregiverSummary[], p = 1, totalPages = 1) => ({ items, page: p, pageSize: 20, total: totalPages * 20, totalPages });

function reference(extra: Record<string, (body: Record<string, unknown>) => { status: number; body?: unknown }> = {}, ai = false) {
  return serveApi({
    'GET /public/meta/search-config': () => ({ status: 200, body: { aiSearchEnabled: ai } }),
    'GET /public/meta/skills': () => ({ status: 200, body: [] }),
    'GET /public/meta/locations/tree': () => ({ status: 200, body: TREE }),
    'GET /public/meta/locations/cities': () => ({ status: 200, body: CITIES }),
    ...extra,
  });
}

const show = (ui: React.ReactElement) => render(<AppProviders>{ui}</AppProviders>);

/** Opens a list field and picks a row. */
async function pick(field: string, row: string) {
  await fireEvent.press(await screen.findByRole('button', { name: field }));
  await fireEvent.press(await screen.findByRole('radio', { name: row }));
}

beforeEach(() => mockRouter.reset());

describe('normal search', () => {
  it('needs the type of care and a district before it searches', async () => {
    const calls = reference();
    await show(<Find />);
    await fireEvent.press(await screen.findByRole('button', { name: en.normalSearch.submit }));
    expect(screen.getByText(en.normalSearch.errors.careTypeRequired)).toBeTruthy();
    expect(screen.getByText(en.normalSearch.errors.districtRequired)).toBeTruthy();
    expect(calls.some((c) => c.route === 'POST /public/search')).toBe(false);

    // A district alone isn't enough either.
    await pick(en.normalSearch.district, 'Colombo');
    await fireEvent.press(screen.getByRole('button', { name: en.normalSearch.submit }));
    expect(screen.getByText(en.normalSearch.errors.careTypeRequired)).toBeTruthy();
    expect(calls.some((c) => c.route === 'POST /public/search')).toBe(false);
  });

  it('searches as the website does, without the session, and opens a caregiver’s profile', async () => {
    // Signed in, but the search goes without the session: an expired one can never block searching.
    await tokenStore.set(tokensFor('PATIENT_GUARDIAN'));
    const calls = reference({ 'POST /public/search': () => ({ status: 200, body: page([caregiver(1), caregiver(2)]) }) });
    await show(<Find />);

    await fireEvent.press(await screen.findByRole('radio', { name: en.careTypes.LIVE_IN }));
    await pick(en.normalSearch.district, 'Colombo');
    await pick(en.normalSearch.city, 'Dehiwala');
    await fireEvent.press(screen.getByRole('radio', { name: en.normalSearch.genderFemale }));
    await fireEvent.press(screen.getByRole('button', { name: en.normalSearch.submit }));

    expect(await screen.findByText(`${en.profile.anonymousId.replace('{id}', 'cg1abcde')}`)).toBeTruthy();
    const search = calls.find((c) => c.route === 'POST /public/search')!;
    expect(search.body).toEqual({
      careType: 'LIVE_IN',
      location: { districtId: 5, cityId: 50 },
      desiredStartDate: colomboToday(),
      caregiverGenderPreference: 'FEMALE',
      locale: 'en',
      page: 1,
      pageSize: 20,
    });
    expect(search.headers.Authorization).toBeUndefined();
    expect(screen.getAllByText('3 km away', { exact: false }).length).toBe(2);

    await fireEvent.press(screen.getAllByRole('button', { name: new RegExp(en.results.viewProfile) })[0]);
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/caregivers/[publicId]', params: { publicId: 'cg1abcdef-0000' } });
  });

  it('shows more matches a page at a time', async () => {
    const calls = reference({
      'POST /public/search': (body) => ({ status: 200, body: body.page === 1 ? page([caregiver(1)], 1, 2) : page([caregiver(2)], 2, 2) }),
    });
    await show(<Find />);
    await fireEvent.press(await screen.findByRole('radio', { name: en.careTypes.HOME_SHIFT }));
    await pick(en.normalSearch.district, 'Gampaha');
    await fireEvent.press(screen.getByRole('button', { name: en.normalSearch.submit }));

    await fireEvent.press(await screen.findByRole('button', { name: en.results.next }));
    expect(await screen.findByText(en.profile.anonymousId.replace('{id}', 'cg2abcde'))).toBeTruthy();
    expect(screen.getByText(en.profile.anonymousId.replace('{id}', 'cg1abcde'))).toBeTruthy();
    expect(calls.filter((c) => c.route === 'POST /public/search').map((c) => c.body.page)).toEqual([1, 2]);
    expect(screen.queryByRole('button', { name: en.results.next })).toBeNull();
  });

  it('says when nothing matches, and offers a retry when the search fails', async () => {
    let fail = false;
    reference({ 'POST /public/search': () => (fail ? { status: 500, body: {} } : { status: 200, body: page([]) }) });
    await show(<Find />);
    await fireEvent.press(await screen.findByRole('radio', { name: en.careTypes.HOME_SHIFT }));
    await pick(en.normalSearch.district, 'Colombo');
    await fireEvent.press(screen.getByRole('button', { name: en.normalSearch.submit }));
    expect(await screen.findByText(en.empty.title)).toBeTruthy();

    fail = true;
    await fireEvent.press(screen.getByRole('radio', { name: en.careTypes.LIVE_IN }));
    await fireEvent.press(screen.getByRole('button', { name: en.normalSearch.submit }));
    expect(await screen.findByText(en.error.title)).toBeTruthy();
    fail = false;
    await fireEvent.press(screen.getByRole('button', { name: en.error.retry }));
    expect(await screen.findByText(en.empty.title)).toBeTruthy();
  });
});

describe('AI search', () => {
  it('asks for the type of care and the area it couldn’t work out, then searches with everything said', async () => {
    const calls = reference(
      {
        'POST /public/ai/extract': () => ({
          status: 200,
          body: {
            requirements: { patient: { age: 80 }, desiredStartDate: colomboToday() },
            summary: { patient: ['80 years old'], location: [], care: [], preferences: [] },
            missing: ['careType', 'location'],
            assumed: ['desiredStartDate'],
          },
        }),
        'POST /public/ai/search': () => ({ status: 200, body: { ...page([caregiver(1, { aiReason: 'Cares for older people' })]), aiRanked: true } }),
      },
      true,
    );
    await show(<Find />);

    await fireEvent.changeText(await screen.findByLabelText(en.aiSearch.label), 'Care for my father, 80');
    await fireEvent.press(screen.getByRole('button', { name: en.aiSearch.findCaregivers }));

    expect(await screen.findByText(en.aiSearch.askCareType)).toBeTruthy();
    expect(screen.getByText('80 years old')).toBeTruthy();
    await fireEvent.press(screen.getByRole('radio', { name: en.careTypes.HOME_SHIFT }));
    expect(await screen.findByText(en.aiSearch.askLocation)).toBeTruthy();
    await pick(en.aiSearch.orPickDistrict, 'Colombo');

    expect(await screen.findByText('Cares for older people')).toBeTruthy();
    expect(screen.getByText(en.results.aiRankedNote)).toBeTruthy();
    expect(calls.find((c) => c.route === 'POST /public/ai/extract')!.body).toEqual({ query: 'Care for my father, 80', locale: 'en' });
    const search = calls.find((c) => c.route === 'POST /public/ai/search')!;
    expect(search.body.query).toBe(`Care for my father, 80\n${en.careTypes.HOME_SHIFT}\nColombo`);
    expect(search.body.request).toMatchObject({ careType: 'HOME_SHIFT', location: { districtId: 5 }, page: 1, pageSize: 20, locale: 'en' });
  });

  it('offers Normal Search when AI isn’t available', async () => {
    reference({ 'POST /public/ai/extract': () => ({ status: 503, body: { message: 'AI search is unavailable' } }) }, true);
    await show(<Find />);
    await fireEvent.changeText(await screen.findByLabelText(en.aiSearch.label), 'Night care in Galle');
    await fireEvent.press(screen.getByRole('button', { name: en.aiSearch.findCaregivers }));
    expect(await screen.findByText(en.aiSearch.unavailable)).toBeTruthy();

    await fireEvent.press(screen.getByRole('link', { name: en.aiSearch.useNormalSearch }));
    expect(await screen.findByRole('button', { name: en.normalSearch.submit })).toBeTruthy();
  });

  it('only offers AI Search when it is switched on', async () => {
    reference({}, false);
    await show(<Find />);
    expect(await screen.findByRole('button', { name: en.normalSearch.submit })).toBeTruthy();
    expect(screen.queryByRole('tab', { name: en.searchMode.ai })).toBeNull();
  });
});

describe('a caregiver’s profile', () => {
  it('shows what the website shows, in the app’s language', async () => {
    const calls = serveApi({
      'GET /public/caregivers/cg1abcdef-0000': () => ({
        status: 200,
        body: caregiver(1, { qualificationSummary: ['NVQ Level 3 Caregiving'], availability: { dayDuty: true, nightDuty: true, liveIn24h: false, preferredShift: 'DAY', availableFrom: null } }),
      }),
    });
    mockRouter.params = { publicId: 'cg1abcdef-0000' };
    await show(<CaregiverProfile />);
    expect(await screen.findByText('• NVQ Level 3 Caregiving')).toBeTruthy();
    expect(screen.getByText(`${en.profile.availabilityDay} · ${en.profile.availabilityNight}`)).toBeTruthy();
    expect(screen.getByText(en.careTypes.HOME_SHIFT)).toBeTruthy();
    expect(calls[0].route).toBe('GET /public/caregivers/cg1abcdef-0000');
  });

  it('says so when the profile isn’t available', async () => {
    serveApi({ 'GET /public/caregivers/gone': () => ({ status: 404, body: { message: 'Not found' } }) });
    mockRouter.params = { publicId: 'gone' };
    await show(<CaregiverProfile />);
    expect(await screen.findByText(en.profile.notFound)).toBeTruthy();
  });
});

describe('where people land', () => {
  it('a signed-in client opens on Find, a caregiver on their home', async () => {
    await tokenStore.set(tokensFor('PATIENT_GUARDIAN'));
    await show(<Welcome />);
    expect(await screen.findByText('redirect:/find')).toBeTruthy();
    screen.unmount();

    await tokenStore.set(tokensFor('CAREGIVER'));
    await show(<Welcome />);
    expect(await screen.findByText('redirect:/home')).toBeTruthy();
  });

  it('a client who reaches the caregiver home is sent to Find', async () => {
    await tokenStore.set(tokensFor('PATIENT_GUARDIAN'));
    await show(<Home />);
    expect(await screen.findByText('redirect:/find')).toBeTruthy();
  });
});

describe('the Account tab', () => {
  it('offers sign-in and sign-up to someone browsing without an account', async () => {
    serveApi({});
    await show(<Account />);
    await fireEvent.press(await screen.findByRole('button', { name: en.signIn.client }));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/sign-in', params: { role: 'client' } });
    expect(screen.getByRole('link', { name: en.signIn.signUp })).toBeTruthy();
    expect(screen.queryByRole('button', { name: en.nav.signOut })).toBeNull();
  });

  it('shows who is signed in, and signs them out', async () => {
    await tokenStore.set(tokensFor('PATIENT_GUARDIAN', { phone: '+94771234567' }));
    const calls = serveApi({ 'POST /auth/logout': () => ({ status: 200, body: { success: true } }) });
    await show(<Account />);
    expect(await screen.findByText('+94771234567')).toBeTruthy();
    expect(screen.getByText(en.common.language)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: en.nav.signOut }));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/'));
    expect(calls.some((c) => c.route === 'POST /auth/logout')).toBe(true);
  });
});
