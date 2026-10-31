import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ClientCareRequest, PublicCaregiverProfile } from '@care-platform/shared';
import en from '../src/i18n/en.json';
import CaregiverProfile from '../app/caregivers/[publicId]';
import Requests from '../app/(client)/requests';
import Saved from '../app/(client)/saved';
import SignIn from '../app/(auth)/sign-in';
import { rememberSearch } from '../src/care/last-search';
import { afterSignIn } from '../src/auth/sides';
import { AppProviders, serveApi } from '../test-utils/app';
import { mockRouter } from '../test-utils/router';
import { tokensFor } from '../test-utils/helpers';
import { tokenStore } from '@/api';

jest.mock('expo-router', () => require('../test-utils/router').expoRouterMock());

const ID = '11111111-2222-4333-8444-555555555555';
const TREE = [{ id: 1, name: 'Western', districts: [{ id: 5, name: 'Colombo' }] }];

const profile: PublicCaregiverProfile = {
  publicId: ID,
  gender: 'FEMALE',
  approxAge: 45,
  yearsExperience: 8,
  district: 'Colombo',
  city: 'Dehiwala',
  districtId: 5,
  cityId: 50,
  preferredLocations: [],
  languages: [],
  skills: [],
  availability: { dayDuty: true, nightDuty: false, liveIn24h: false, preferredShift: 'DAY', availableFrom: null },
  hasVerifiedQualification: false,
  verified: true,
  careTypes: ['HOME_SHIFT'],
  qualificationSummary: [],
  relevantExperienceSummary: [],
  homeLocation: null,
  distanceKm: null,
  serviceArea: [],
};

const request = (over: Partial<ClientCareRequest>): ClientCareRequest =>
  ({
    id: 'r-1',
    reference: 'CR-AB12CD',
    status: 'NEW',
    createdAt: '2026-10-30T08:00:00.000Z',
    updatedAt: '2026-10-30T08:00:00.000Z',
    closedAt: null,
    caregiverPublicId: ID,
    caregiver: profile,
    careType: 'HOME_SHIFT',
    district: 'Colombo',
    city: null,
    desiredStartDate: '2026-11-03',
    ...over,
  }) as ClientCareRequest;

const show = (ui: React.ReactElement) => render(<AppProviders>{ui}</AppProviders>);

/** The profile's buttons wait for the client's saved/requested state to load, as a person would. */
async function pressWhenReady(name: string) {
  await waitFor(() => expect(screen.getByRole('button', { name })).toBeEnabled());
  await fireEvent.press(screen.getByRole('button', { name }));
}
const client = () => tokenStore.set(tokensFor('PATIENT_GUARDIAN', { patientId: 'p-1' }));

beforeEach(() => {
  mockRouter.reset();
  rememberSearch(null);
});

describe('contacting and saving a caregiver', () => {
  it('asks someone without an account to sign in, and brings them back to this caregiver', async () => {
    serveApi({ [`GET /public/caregivers/${ID}`]: () => ({ status: 200, body: profile }) });
    mockRouter.params = { publicId: ID };
    await show(<CaregiverProfile />);
    await fireEvent.press(await screen.findByRole('button', { name: en.profile.contactCta }));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/sign-in', params: { role: 'client', returnTo: `/caregivers/${ID}` } });
  });

  it('tells a caregiver’s account it can’t contact or save', async () => {
    await tokenStore.set(tokensFor('CAREGIVER'));
    serveApi({ [`GET /public/caregivers/${ID}`]: () => ({ status: 200, body: profile }) });
    mockRouter.params = { publicId: ID };
    await show(<CaregiverProfile />);
    expect(await screen.findByText(en.care.caregiverAccountNote)).toBeTruthy();
    expect(screen.queryByRole('button', { name: en.care.contactCta })).toBeNull();
  });

  it('saves and unsaves for a signed-in client', async () => {
    await client();
    let saved = false;
    const calls = serveApi({
      [`GET /public/caregivers/${ID}`]: () => ({ status: 200, body: profile }),
      'GET /me/caregiver-relations': () => ({ status: 200, body: [{ caregiverPublicId: ID, saved, openRequest: null }] }),
      [`PUT /me/saved-caregivers/${ID}`]: () => ((saved = true), { status: 200, body: {} }),
      [`DELETE /me/saved-caregivers/${ID}`]: () => ((saved = false), { status: 200, body: {} }),
    });
    mockRouter.params = { publicId: ID };
    await show(<CaregiverProfile />);

    await pressWhenReady(`♡ ${en.care.save}`);
    expect(await screen.findByRole('button', { name: `♥ ${en.care.saved}` })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: `♥ ${en.care.saved}` }));
    expect(await screen.findByRole('button', { name: `♡ ${en.care.save}` })).toBeTruthy();
    expect(calls.map((c) => c.route).filter((r) => r.includes('saved-caregivers'))).toEqual([`PUT /me/saved-caregivers/${ID}`, `DELETE /me/saved-caregivers/${ID}`]);
    expect(calls.find((c) => c.route === 'GET /me/caregiver-relations')!.headers.Authorization).toMatch(/^Bearer /);
  });

  it('sends a request through our team, with what they last searched for', async () => {
    await client();
    rememberSearch({ careType: 'LIVE_IN', location: { districtId: 5, cityId: 50 }, desiredStartDate: '2026-11-03' });
    let open = false;
    const calls = serveApi({
      [`GET /public/caregivers/${ID}`]: () => ({ status: 200, body: profile }),
      'GET /me/caregiver-relations': () => ({
        status: 200,
        body: [{ caregiverPublicId: ID, saved: false, openRequest: open ? { id: 'r-1', reference: 'CR-AB12CD', status: 'NEW' } : null }],
      }),
      'POST /me/care-requests': () => ((open = true), { status: 201, body: request({}) }),
    });
    mockRouter.params = { publicId: ID };
    await show(<CaregiverProfile />);

    await pressWhenReady(en.care.contactCta);
    expect(screen.getByText(en.care.dialog.intro)).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText(en.care.dialog.messageLabel), '  Mornings are best  ');
    await fireEvent.press(screen.getByRole('button', { name: en.care.dialog.send }));

    expect(await screen.findByText(en.care.dialog.successBody.replace('{reference}', 'CR-AB12CD'))).toBeTruthy();
    expect(calls.find((c) => c.route === 'POST /me/care-requests')!.body).toEqual({
      caregiverPublicId: ID,
      message: 'Mornings are best',
      careType: 'LIVE_IN',
      districtId: 5,
      cityId: 50,
      desiredStartDate: '2026-11-03',
    });

    await fireEvent.press(screen.getByRole('button', { name: en.care.dialog.close }));
    // The profile now says a request is open instead of offering another.
    expect(await screen.findByRole('link', { name: `✓ ${en.care.requestSent.replace('{reference}', 'CR-AB12CD')}` })).toBeTruthy();
    expect(screen.queryByRole('button', { name: en.care.contactCta })).toBeNull();
  });

  it('shows the API’s reason when a request can’t be sent', async () => {
    await client();
    serveApi({
      [`GET /public/caregivers/${ID}`]: () => ({ status: 200, body: profile }),
      'GET /me/caregiver-relations': () => ({ status: 200, body: [{ caregiverPublicId: ID, saved: false, openRequest: null }] }),
      'POST /me/care-requests': () => ({ status: 409, body: { message: 'You already have an open request for this caregiver' } }),
    });
    mockRouter.params = { publicId: ID };
    await show(<CaregiverProfile />);
    await pressWhenReady(en.care.contactCta);
    await fireEvent.press(screen.getByRole('button', { name: en.care.dialog.send }));
    expect(await screen.findByText('You already have an open request for this caregiver')).toBeTruthy();
  });
});

describe('my requests', () => {
  it('shows where each request stands, and cancels one that is still open', async () => {
    await client();
    let status: ClientCareRequest['status'] = 'IN_PROGRESS';
    const calls = serveApi({
      'GET /me/care-requests': () => ({
        status: 200,
        body: [request({ status }), request({ id: 'r-2', reference: 'CR-ZZ99', status: 'CLOSED', caregiverPublicId: null, caregiver: null })],
      }),
      'POST /me/care-requests/r-1/cancel': () => ((status = 'CANCELLED'), { status: 200, body: {} }),
    });
    await show(<Requests />);

    expect(await screen.findByText(en.account.requests.status.IN_PROGRESS)).toBeTruthy();
    expect(screen.getByText(en.account.requests.statusHelp.IN_PROGRESS)).toBeTruthy();
    expect(screen.getByText(en.account.requests.matching)).toBeTruthy();
    // Only the open one can be cancelled.
    expect(screen.getAllByRole('link', { name: en.account.requests.cancel })).toHaveLength(1);

    await fireEvent.press(screen.getByRole('link', { name: en.account.requests.cancel }));
    expect(screen.getByText(en.account.requests.cancelConfirm)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: en.account.requests.cancelYes }));
    expect(await screen.findByText(en.account.requests.status.CANCELLED)).toBeTruthy();
    expect(calls.some((c) => c.route === 'POST /me/care-requests/r-1/cancel')).toBe(true);
  });

  it('asks our team to find a caregiver: the type of care and the district are needed', async () => {
    await client();
    rememberSearch({ careType: 'HOSPITAL', desiredStartDate: '2026-11-05' });
    const calls = serveApi({
      'GET /me/care-requests': () => ({ status: 200, body: [] }),
      'GET /public/meta/locations/tree': () => ({ status: 200, body: TREE }),
      'POST /me/care-requests': () => ({ status: 201, body: request({ caregiverPublicId: null, caregiver: null }) }),
    });
    await show(<Requests />);
    expect(await screen.findByText(en.account.requests.empty)).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: en.account.requests.newRequest }));
    // Prefilled from the last search; the district still has to be chosen.
    expect(screen.getByRole('radio', { name: en.careTypes.HOSPITAL }).props.accessibilityState.selected).toBe(true);
    await fireEvent.press(screen.getByRole('button', { name: en.care.findDialog.send }));
    expect(screen.getByText(en.care.findDialog.districtRequired)).toBeTruthy();
    expect(calls.some((c) => c.route === 'POST /me/care-requests')).toBe(false);

    await fireEvent.press(screen.getByRole('button', { name: en.normalSearch.district }));
    await fireEvent.press(await screen.findByRole('radio', { name: 'Colombo' }));
    await fireEvent.press(screen.getByRole('button', { name: en.care.findDialog.send }));
    expect(await screen.findByText(en.care.findDialog.successTitle)).toBeTruthy();
    expect(calls.find((c) => c.route === 'POST /me/care-requests')!.body).toEqual({
      careType: 'HOSPITAL',
      districtId: 5,
      desiredStartDate: '2026-11-05',
    });
  });

  it('asks someone without an account to sign in', async () => {
    serveApi({});
    await show(<Requests />);
    expect(await screen.findByRole('button', { name: en.signIn.client })).toBeTruthy();
    expect(screen.queryByRole('button', { name: en.account.requests.newRequest })).toBeNull();
  });
});

describe('saved caregivers', () => {
  it('lists them, removes one, and says when one is no longer listed', async () => {
    await client();
    let items = [
      { caregiverPublicId: ID, savedAt: '2026-10-29T10:00:00.000Z', caregiver: profile },
      { caregiverPublicId: '99999999-2222-4333-8444-555555555555', savedAt: '2026-10-28T10:00:00.000Z', caregiver: null },
    ];
    const calls = serveApi({
      'GET /me/saved-caregivers': () => ({ status: 200, body: items }),
      [`DELETE /me/saved-caregivers/${ID}`]: () => ((items = items.slice(1)), { status: 200, body: {} }),
    });
    await show(<Saved />);
    expect(await screen.findByText(en.profile.anonymousId.replace('{id}', ID.slice(0, 8)))).toBeTruthy();
    expect(screen.getByText(en.account.saved.unavailable)).toBeTruthy();

    await fireEvent.press(screen.getAllByRole('link', { name: en.account.saved.remove })[0]);
    await waitFor(() => expect(screen.queryByText(en.profile.anonymousId.replace('{id}', ID.slice(0, 8)))).toBeNull());
    expect(calls.some((c) => c.route === `DELETE /me/saved-caregivers/${ID}`)).toBe(true);
  });
});

describe('coming back after signing in', () => {
  it('returns a client to the caregiver they were looking at, closing the sign-in screens', async () => {
    serveApi({
      'GET /auth/whatsapp/config': () => ({ status: 200, body: { enabled: false } }),
      'POST /auth/login': () => ({ status: 200, body: tokensFor('PATIENT_GUARDIAN') }),
    });
    mockRouter.params = { role: 'client', returnTo: `/caregivers/${ID}` };
    await show(<SignIn />);
    await fireEvent.changeText(await screen.findByLabelText(en.signIn.email), 'amaya@example.lk');
    await fireEvent.changeText(screen.getByLabelText(en.signIn.password), 'secret-pass');
    await fireEvent.press(screen.getByRole('button', { name: en.signIn.submit }));
    await waitFor(() => expect(mockRouter.dismissTo).toHaveBeenCalledWith(`/caregivers/${ID}`));
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it('only ever goes back to a screen inside the app, and caregivers always go home', () => {
    const clientUser = { role: 'PATIENT_GUARDIAN' };
    expect(afterSignIn(clientUser, '/requests')).toBe('/requests');
    expect(afterSignIn(clientUser, '//evil.example/x')).toBe('/find');
    expect(afterSignIn(clientUser, 'https://evil.example')).toBe('/find');
    expect(afterSignIn(clientUser, undefined)).toBe('/find');
    expect(afterSignIn({ role: 'CAREGIVER' }, `/caregivers/${ID}`)).toBe('/home');
  });
});
