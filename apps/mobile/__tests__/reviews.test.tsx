import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ClientBooking, ReviewableCaregiver } from '@care-platform/shared';
import RateCaregiver from '../app/bookings/[id]/rate/[publicId]';
import Bookings from '../app/(client)/bookings';
import Ratings from '../app/(caregiver)/ratings';
import { appScreenFor } from '../src/links/app-links';
import { AppProviders, serveApi } from '../test-utils/app';
import { mockRouter } from '../test-utils/router';
import { tokensFor } from '../test-utils/helpers';
import { tokenStore } from '@/api';

jest.mock('expo-router', () => require('../test-utils/router').expoRouterMock());

const BOOKING = 'b0000000-0000-4000-8000-000000000001';
const CG = '11111111-1111-4111-8111-111111111111';

const entry = (over: Partial<ReviewableCaregiver> = {}): ReviewableCaregiver => ({
  bookingId: BOOKING,
  bookingReference: 'BK-1001',
  caregiverPublicId: CG,
  caregiver: null,
  isCover: false,
  lastWorkedAt: '2026-11-01T11:30:00.000Z',
  reviewUntil: '2027-01-30T11:30:00.000Z',
  canReview: true,
  review: null,
  ...over,
});

const client = () => tokenStore.set(tokensFor('PATIENT_GUARDIAN', { patientId: 'p-1', email: 'amaya@example.lk' }));
const show = (ui: React.ReactElement) => render(<AppProviders>{ui}</AppProviders>);

beforeEach(() => mockRouter.reset());

describe('rating a caregiver in the app', () => {
  it('sends the stars and badges the client chose, offering badges only for 4-5 stars', async () => {
    await client();
    mockRouter.params = { id: BOOKING, publicId: CG };
    const calls = serveApi({
      [`GET /me/bookings/${BOOKING}/reviews/${CG}`]: () => ({ status: 200, body: entry() }),
      [`PUT /me/bookings/${BOOKING}/reviews/${CG}`]: () => ({ status: 200, body: entry() }),
    });
    await show(<RateCaregiver />);

    expect(await screen.findByText('Booking BK-1001')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Submit rating' }));
    expect(await screen.findByText('Choose how many stars.')).toBeTruthy();

    await fireEvent.press(screen.getByRole('radio', { name: '2 stars' }));
    expect(screen.getByText('Poor')).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Timekeeping' })).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: 'Always on time' })).toBeNull();

    await fireEvent.press(screen.getByRole('radio', { name: '5 stars' }));
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Kind and patient' }));
    expect(screen.getByRole('checkbox', { name: 'Kind and patient', checked: true })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Submit rating' }));

    await waitFor(() => expect(calls.find((c) => c.route.startsWith('PUT'))).toBeTruthy());
    expect(calls.find((c) => c.route.startsWith('PUT'))!.body).toEqual({ rating: 5, badges: ['KIND_PATIENT'], improvementTags: [], comment: null, privateNote: null });
    expect(await screen.findByText('Thank you - your rating has been saved.')).toBeTruthy();
  });

  it('keeps phone numbers out of the review before sending', async () => {
    await client();
    mockRouter.params = { id: BOOKING, publicId: CG };
    const calls = serveApi({ [`GET /me/bookings/${BOOKING}/reviews/${CG}`]: () => ({ status: 200, body: entry() }) });
    await show(<RateCaregiver />);
    await fireEvent.press(await screen.findByRole('radio', { name: '4 stars' }));
    await fireEvent.changeText(screen.getByLabelText('Write a review (optional)'), 'Lovely - call her on 0771234567');
    await fireEvent.press(screen.getByRole('button', { name: 'Submit rating' }));
    expect(await screen.findByText(/leave phone numbers, email addresses and links out/)).toBeTruthy();
    expect(calls.some((c) => c.route.startsWith('PUT'))).toBe(false);
  });

  it('shows "How was your care?" on Bookings, and each caregiver on a booking', async () => {
    await client();
    const booking = {
      id: BOOKING, reference: 'BK-1001', status: 'CONFIRMED', scheduleType: 'DAY', startDate: '2026-10-01', endDate: '2026-11-30', rateType: null, rateAmount: null,
      caregiverPublicId: CG, caregiver: null, shifts: [], reviews: [entry(), entry({ caregiverPublicId: '22222222-2222-4222-8222-222222222222', isCover: true, review: { id: 'r', bookingId: BOOKING, caregiverPublicId: '22222222-2222-4222-8222-222222222222', rating: 4, badges: [], improvementTags: [], comment: null, commentStatus: 'NONE', commentRejectReason: null, privateNote: null, hidden: false, createdAt: '', updatedAt: '' } })],
    } as unknown as ClientBooking;
    serveApi({
      'GET /me/bookings': () => ({ status: 200, body: [booking] }),
      'GET /me/reviews/pending': () => ({ status: 200, body: [entry()] }),
      'GET /me/issues': () => ({ status: 200, body: [] }),
      'GET /me/care': () => ({ status: 200, body: { date: '2026-11-04', today: '2026-11-04', reminders: true, hasCarePlans: false, shifts: [] } }),
    });
    await show(<Bookings />);
    expect(await screen.findByText('How was your care?')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Rate now' }));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/bookings/[id]/rate/[publicId]', params: { id: BOOKING, publicId: CG } });
    expect(await screen.findByRole('button', { name: 'Rate this caregiver' })).toBeTruthy();
    expect(screen.getByText(/Covered some shifts/)).toBeTruthy();
    expect(screen.getByRole('image', { name: '4 out of 5 stars' })).toBeTruthy();
  });
});

describe("a caregiver's ratings", () => {
  it('shows their average and when it goes public', async () => {
    await tokenStore.set(tokensFor('CAREGIVER', { caregiverId: 'cg-1' }));
    serveApi({
      'GET /me/reviews': () => ({
        status: 200,
        body: { summary: { average: 4.5, count: 2 }, shownPublicly: false, minRatingsToShow: 3, badgeCounts: [{ badge: 'PUNCTUAL', count: 2 }], reviews: [] },
      }),
    });
    await show(<Ratings />);
    expect(await screen.findByText('Your rating appears on your public profile once you have 3 ratings.')).toBeTruthy();
    expect(screen.getByText(/Always on time/)).toBeTruthy();
  });
});

describe('links and notifications', () => {
  it('opens the rate screen from the website link and the notification, and My ratings from praise', () => {
    const { screenFor } = jest.requireActual('../src/push/notifications');
    expect(appScreenFor(`/account/bookings/${BOOKING}/rate/${CG}`)).toBe(`/bookings/${BOOKING}/rate/${CG}`);
    expect(appScreenFor('/caregiver/ratings')).toBe('/ratings');
    expect(screenFor(`/bookings/${BOOKING}/rate/${CG}`)).toBe(`/bookings/${BOOKING}/rate/${CG}`);
    expect(screenFor('/me/ratings')).toBe('/ratings');
    expect(screenFor(`/bookings/${BOOKING}/rate/../../admin`)).toBe('/home');
  });
});
