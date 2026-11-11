import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { CaregiverCareOffer, CaregiverRateCard, CaregiverRateLine } from '@care-platform/shared';
import Offers from '../app/(caregiver)/offers';
import Rates from '../app/(caregiver)/rates';
import { appScreenFor } from '../src/links/app-links';
import { screenFor } from '../src/push/notifications';
import { AppProviders, serveApi } from '../test-utils/app';
import { mockRouter } from '../test-utils/router';
import { tokensFor } from '../test-utils/helpers';
import { tokenStore } from '@/api';

jest.mock('expo-router', () => require('../test-utils/router').expoRouterMock());

const CG = '11111111-1111-4111-8111-111111111111';
const caregiver = () => tokenStore.set(tokensFor('CAREGIVER', { caregiverId: CG, phone: '0711234567' }));
const show = (ui: React.ReactElement) => render(<AppProviders>{ui}</AppProviders>);
const none = { 'POST /me/notifications/read': () => ({ status: 200, body: {} }) };

const offer = (over: Partial<CaregiverCareOffer> = {}): CaregiverCareOffer => ({
  id: 'o0000000-0000-4000-8000-000000000001',
  reference: 'CR-64W76R',
  status: 'OFFERED',
  careType: 'HOME_SHIFT',
  district: { en: 'Colombo', si: 'කොළඹ', ta: 'கொழும்பு' },
  city: { en: 'Nugegoda', si: 'නුගේගොඩ', ta: 'நுகேகொடை' },
  desiredStartDate: '2026-11-16',
  rateType: 'DAILY',
  payRate: 3000,
  note: 'Day shifts, starting Monday',
  expiresAt: '2026-11-12T10:21:00.000Z',
  respondedAt: null,
  createdAt: '2026-11-11T10:21:00.000Z',
  ...over,
});

const line = (over: Partial<CaregiverRateLine> = {}): CaregiverRateLine => ({
  careType: 'HOME_SHIFT',
  offered: true,
  pricing: { careType: 'HOME_SHIFT', enabled: true, rateType: 'DAILY', minRate: 2500, maxRate: 6000, feePercent: 15 },
  amount: null,
  clientPrice: null,
  outOfBand: false,
  updatedAt: null,
  ...over,
});

beforeEach(() => mockRouter.reset());

describe('job offers in the app', () => {
  it('shows what the job is and until when, and accepts it', async () => {
    await caregiver();
    let current = offer();
    const calls = serveApi({
      ...none,
      'GET /me/care-offers': () => ({ status: 200, body: [current] }),
      [`POST /me/care-offers/${offer().id}/accept`]: () => ({ status: 200, body: [(current = offer({ status: 'ACCEPTED', respondedAt: '2026-11-11T10:30:00.000Z' }))] }),
    });
    await show(<Offers />);

    expect(await screen.findByText('Reference CR-64W76R')).toBeTruthy();
    expect(screen.getByText('Nugegoda, Colombo')).toBeTruthy();
    expect(screen.getByText('LKR 3,000 per day')).toBeTruthy();
    expect(screen.getByText('16 Nov 2026')).toBeTruthy();
    expect(screen.getByText('Day shifts, starting Monday')).toBeTruthy();
    // 10:21 UTC is 15:51 in Sri Lanka, whatever zone the phone is in.
    expect(screen.getByText(/Answer by .*12 Nov, 15:51/)).toBeTruthy();
    expect(screen.getByText("You will get the client's name and address once the booking is confirmed.")).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Accept this job' }));
    expect(await screen.findByText(/You accepted this job\./)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Accept this job' })).toBeNull();
    expect(calls.filter((c) => c.route.endsWith('/accept'))).toHaveLength(1);
  });

  it('declines with the reason chosen, or with none', async () => {
    await caregiver();
    let current = offer();
    const calls = serveApi({
      ...none,
      'GET /me/care-offers': () => ({ status: 200, body: [current] }),
      [`POST /me/care-offers/${offer().id}/decline`]: () => ({ status: 200, body: [(current = offer({ status: 'DECLINED' }))] }),
    });
    await show(<Offers />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Decline' }));
    expect(screen.getByText('Why are you declining?')).toBeTruthy();
    // Going back changes nothing.
    await fireEvent.press(screen.getByRole('button', { name: 'Go back' }));
    expect(calls.some((c) => c.route.endsWith('/decline'))).toBe(false);

    await fireEvent.press(screen.getByRole('button', { name: 'Decline' }));
    await fireEvent.press(screen.getByText('It is too far for me'));
    await fireEvent.press(screen.getByRole('button', { name: 'Decline the job' }));
    await waitFor(() => expect(calls.find((c) => c.route.endsWith('/decline'))).toBeTruthy());
    expect(calls.find((c) => c.route.endsWith('/decline'))!.body).toEqual({ reason: 'TOO_FAR' });
    expect(await screen.findByText('You declined')).toBeTruthy();
  });

  it('says so when someone else took the job first', async () => {
    await caregiver();
    serveApi({
      ...none,
      'GET /me/care-offers': () => ({ status: 200, body: [offer({ rateType: null, payRate: null, desiredStartDate: null, note: null })] }),
      [`POST /me/care-offers/${offer().id}/accept`]: () => ({ status: 409, body: { message: 'This job is no longer open' } }),
    });
    await show(<Offers />);
    expect(await screen.findByText('To be agreed with the office')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Accept this job' }));
    expect(await screen.findByText('This job is no longer open')).toBeTruthy();
  });

  it('says so when there are no offers', async () => {
    await caregiver();
    serveApi({ ...none, 'GET /me/care-offers': () => ({ status: 200, body: [] }) });
    await show(<Offers />);
    expect(await screen.findByText(/You have no job offers at the moment/)).toBeTruthy();
  });

  it('opens from its notification and from a link to the website', () => {
    expect(screenFor('/care-offers')).toBe('/offers');
    expect(appScreenFor('/caregiver/care-offers')).toBe('/offers');
  });
});

describe('your rates in the app', () => {
  const card = (lines: CaregiverRateLine[]): CaregiverRateCard => ({ caregiverId: CG, lines });

  it('shows the limits, what clients will see as you type, and saves only what changed', async () => {
    await caregiver();
    const liveIn = line({ careType: 'LIVE_IN', pricing: { careType: 'LIVE_IN', enabled: true, rateType: 'MONTHLY', minRate: 60000, maxRate: 150000, feePercent: 12.5 }, amount: 85000, clientPrice: 95625 });
    const calls = serveApi({
      [`GET /caregivers/${CG}/rates`]: () => ({ status: 200, body: card([line(), liveIn, line({ careType: 'HOSPITAL', pricing: { careType: 'HOSPITAL', enabled: false, rateType: 'DAILY', minRate: 0, maxRate: 0, feePercent: 0 } })]) }),
      [`PUT /caregivers/${CG}/rates`]: () => ({ status: 200, body: card([line({ amount: 3000, clientPrice: 3450 }), liveIn]) }),
    });
    await show(<Rates />);

    const home = await screen.findByLabelText('Care at home (shift basis) (Your rate (LKR), per day)');
    expect(screen.getByText('Between LKR 2,500 and 6,000 per day')).toBeTruthy();
    // Hospital care is priced by the office: no field for it, just the note.
    expect(screen.queryByLabelText(/Hospital/)).toBeNull();
    expect(screen.getByText('For other kinds of care the office agrees the rate with you for each job.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save rates' })).toBeDisabled();

    await fireEvent.changeText(home, '2000');
    expect(screen.getByText('This is below the lowest rate allowed')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save rates' })).toBeDisabled();
    await fireEvent.changeText(home, 'abc');
    expect(screen.getByText('Enter an amount in rupees')).toBeTruthy();

    await fireEvent.changeText(home, '3000');
    expect(screen.getByText('Clients see LKR 3,450 per day')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Save rates' }));
    await waitFor(() => expect(calls.find((c) => c.route.startsWith('PUT'))).toBeTruthy());
    expect(calls.find((c) => c.route.startsWith('PUT'))!.body).toEqual({ rates: [{ careType: 'HOME_SHIFT', amount: 3000 }] });
    expect(await screen.findByText('Your rates are saved')).toBeTruthy();
  });

  it('flags a rate left outside the limits', async () => {
    await caregiver();
    serveApi({ [`GET /caregivers/${CG}/rates`]: () => ({ status: 200, body: card([line({ amount: 2000, clientPrice: 2300, outOfBand: true })]) }) });
    await show(<Rates />);
    expect(await screen.findByText('The limits have changed and this rate is now outside them. Please set a new one.')).toBeTruthy();
  });

  it('says so when the office sets every rate', async () => {
    await caregiver();
    serveApi({ [`GET /caregivers/${CG}/rates`]: () => ({ status: 200, body: card([line({ pricing: { careType: 'HOME_SHIFT', enabled: false, rateType: 'DAILY', minRate: 0, maxRate: 0, feePercent: 0 } })]) }) });
    await show(<Rates />);
    expect(await screen.findByText('For other kinds of care the office agrees the rate with you for each job.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save rates' })).toBeNull();
  });
});
