import type { ReactElement } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PublicReviewsPage, ReviewableCaregiver } from '@care-platform/shared';
import { I18nProvider } from '@/lib/i18n';
import RateCaregiverPage from '@/app/account/bookings/[id]/rate/[publicId]/page';
import { PendingReviewsBanner, BookingReviews } from '@/components/reviews/booking-reviews';
import { CaregiverReviews } from '@/components/reviews/caregiver-reviews';
import { MyRatings } from '@/components/reviews/my-ratings';

/**
 * Rating a caregiver on the public site, and reading ratings. The API is
 * replaced by recorded calls; who may rate whom, and what may never be shown,
 * is covered by apps/api's reviews e2e suite.
 */

const get = jest.fn();
const put = jest.fn();
const del = jest.fn();
let auth: { user: unknown; loading: boolean } = { user: null, loading: false };

const BOOKING = 'b0000000-0000-4000-8000-000000000001';
const PUBLIC_ID = '11111111-1111-4111-8111-111111111111';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
  usePathname: () => `/account/bookings/${BOOKING}/rate/${PUBLIC_ID}`,
  useParams: () => ({ id: BOOKING, publicId: PUBLIC_ID }),
  useSearchParams: () => new URLSearchParams(),
}));
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
jest.mock('@/lib/api/auth-context', () => ({ useAuth: () => ({ ...auth, logout: jest.fn() }) }));
jest.mock('@/lib/api/client', () => ({
  ...jest.requireActual('@/lib/api/client'),
  api: {
    get: (...a: unknown[]) => get(...a),
    post: jest.fn(),
    put: (...a: unknown[]) => put(...a),
    patch: jest.fn(),
    delete: (...a: unknown[]) => del(...a),
  },
}));

const CLIENT = { userId: 'u-client', email: 'amali@example.com', role: 'PATIENT_GUARDIAN', patientId: 'p-1' };
const CAREGIVER = { userId: 'u-cg', email: 'nimal@example.com', role: 'CAREGIVER', caregiverId: 'cg-1' };

const entry = (over: Partial<ReviewableCaregiver> = {}): ReviewableCaregiver => ({
  bookingId: BOOKING,
  bookingReference: 'BK-1001',
  caregiverPublicId: PUBLIC_ID,
  caregiver: null,
  isCover: false,
  lastWorkedAt: '2026-11-01T11:30:00.000Z',
  reviewUntil: '2027-01-30T11:30:00.000Z',
  canReview: true,
  review: null,
  ...over,
});

function renderUi(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider>{ui}</I18nProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  auth = { user: CLIENT, loading: false };
});

describe('rating a caregiver', () => {
  it('sends stars and praise badges, and offers badges only for 4-5 stars', async () => {
    get.mockResolvedValue(entry());
    put.mockResolvedValue(entry({ review: { id: 'r1', bookingId: BOOKING, caregiverPublicId: PUBLIC_ID, rating: 5, badges: ['PUNCTUAL'], improvementTags: [], comment: null, commentStatus: 'NONE', commentRejectReason: null, privateNote: null, hidden: false, createdAt: '', updatedAt: 'x' } }));
    renderUi(<RateCaregiverPage />);

    expect(await screen.findByRole('heading', { name: 'How was the care?' })).toBeInTheDocument();
    expect(screen.getByText('Booking BK-1001')).toBeInTheDocument();
    // No stars yet: asked for them, nothing sent.
    fireEvent.click(screen.getByRole('button', { name: 'Submit rating' }));
    expect(await screen.findByText('Choose how many stars.')).toBeInTheDocument();
    expect(put).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('radio', { name: '2 stars' }));
    expect(screen.getByText('Poor')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Timekeeping' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Always on time' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Report a problem/ })).toHaveAttribute('href', `/account/bookings#booking-${BOOKING}`);

    fireEvent.click(screen.getByRole('radio', { name: '5 stars' }));
    const badge = screen.getByRole('button', { name: 'Always on time' });
    fireEvent.click(badge);
    expect(badge).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Submit rating' }));

    await waitFor(() =>
      expect(put).toHaveBeenCalledWith(`/me/bookings/${BOOKING}/reviews/${PUBLIC_ID}`, { rating: 5, badges: ['PUNCTUAL'], improvementTags: [], comment: null, privateNote: null }),
    );
    expect(await screen.findByText('Thank you - your rating has been saved.')).toBeInTheDocument();
  });

  it('keeps phone numbers out of the written review before sending', async () => {
    get.mockResolvedValue(entry());
    renderUi(<RateCaregiverPage />);
    fireEvent.click(await screen.findByRole('radio', { name: '4 stars' }));
    fireEvent.change(screen.getByLabelText('Write a review (optional)'), { target: { value: 'Lovely - call her on 0771234567' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit rating' }));
    expect(await screen.findByText(/leave phone numbers, email addresses and links out/)).toBeInTheDocument();
    expect(put).not.toHaveBeenCalled();
  });

  it('shows a given rating with the state of its written review, and can delete it', async () => {
    get.mockResolvedValue(
      entry({
        review: { id: 'r1', bookingId: BOOKING, caregiverPublicId: PUBLIC_ID, rating: 4, badges: ['KIND_PATIENT'], improvementTags: [], comment: 'Kind and gentle every day.', commentStatus: 'REJECTED', commentRejectReason: 'It names another person', privateNote: null, hidden: false, createdAt: '', updatedAt: 'y' },
      }),
    );
    del.mockResolvedValue(undefined);
    renderUi(<RateCaregiverPage />);
    expect(await screen.findByRole('img', { name: '4 out of 5 stars' })).toBeInTheDocument();
    expect(screen.getByText('Our team did not publish your written review: It names another person')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete rating' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, delete' }));
    await waitFor(() => expect(del).toHaveBeenCalledWith(`/me/bookings/${BOOKING}/reviews/${PUBLIC_ID}`));
  });

  it('says when the time to rate has passed', async () => {
    get.mockResolvedValue(entry({ canReview: false }));
    renderUi(<RateCaregiverPage />);
    expect(await screen.findByText('The time to rate this caregiver has passed.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Submit rating' })).not.toBeInTheDocument();
  });
});

describe('on the bookings page', () => {
  it('invites the client to rate, and lists each caregiver on a booking - covers marked', async () => {
    get.mockResolvedValue([entry(), entry({ caregiverPublicId: '22222222-2222-4222-8222-222222222222', isCover: true })]);
    renderUi(<PendingReviewsBanner />);
    expect(await screen.findByText('You can rate 2 caregivers who cared for you.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Rate now' })).toHaveAttribute('href', `/account/bookings/${BOOKING}/rate/${PUBLIC_ID}`);

    renderUi(<BookingReviews reviews={[entry(), entry({ caregiverPublicId: '22222222-2222-4222-8222-222222222222', isCover: true, canReview: false })]} />);
    expect(screen.getByRole('link', { name: 'Rate this caregiver' })).toBeInTheDocument();
    expect(screen.getByText(/Covered some shifts/)).toBeInTheDocument();
    expect(screen.getByText('Rating closed')).toBeInTheDocument();
  });
});

describe('reading ratings', () => {
  const page: PublicReviewsPage = {
    summary: { average: 4.7, count: 12, topBadges: [{ badge: 'KIND_PATIENT', count: 9 }] },
    badgeCounts: [{ badge: 'KIND_PATIENT', count: 9 }, { badge: 'PUNCTUAL', count: 4 }],
    items: [{ id: 'r1', rating: 5, badges: ['PUNCTUAL'], comment: 'Always early and cheerful.', commentLanguage: 'en', reviewerDistrict: 'Kandy', month: '2026-10' }],
    total: 1,
    page: 1,
    pageSize: 10,
  };

  it('shows the profile summary, badge counts and reviews as "Client · district"', async () => {
    auth = { user: null, loading: false };
    get.mockResolvedValue(page);
    renderUi(<CaregiverReviews publicId={PUBLIC_ID} />);
    expect(await screen.findByRole('heading', { name: 'Ratings and reviews' })).toBeInTheDocument();
    expect(screen.getByText('4.7')).toBeInTheDocument();
    expect(screen.getByText(/12 ratings/)).toBeInTheDocument();
    expect(screen.getAllByText('Kind and patient').length).toBeGreaterThan(0);
    expect(screen.getByText('Client · Kandy')).toBeInTheDocument();
    expect(screen.getByText('Always early and cheerful.')).toBeInTheDocument();
  });

  it('shows nothing when there are not enough ratings yet', async () => {
    auth = { user: null, loading: false };
    get.mockResolvedValue({ ...page, summary: null, badgeCounts: [], items: [], total: 0 });
    const { container } = renderUi(<CaregiverReviews publicId={PUBLIC_ID} />);
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("tells a caregiver their average and when it will show publicly", async () => {
    auth = { user: CAREGIVER, loading: false };
    get.mockResolvedValue({ summary: { average: 5, count: 2 }, shownPublicly: false, minRatingsToShow: 3, badgeCounts: [{ badge: 'TRUSTWORTHY', count: 2 }], reviews: [] });
    renderUi(<MyRatings />);
    expect(await screen.findByText('Your rating appears on your public profile once you have 3 ratings.')).toBeInTheDocument();
    expect(screen.getByText('Honest and trustworthy')).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('/me/reviews');
  });
});
