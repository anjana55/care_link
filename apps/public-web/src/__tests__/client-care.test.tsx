import type { ReactElement } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nProvider } from '@/lib/i18n';
import { CaregiverActions } from '@/components/care/caregiver-actions';
import AccountLayout from '@/app/account/layout';
import MyRequestsPage from '@/app/account/requests/page';
import SavedCaregiversPage from '@/app/account/saved/page';
import MyBookingsPage from '@/app/account/bookings/page';

/**
 * Contact and Save on the public site, and the client's account pages. The API
 * is replaced by recorded calls; the server's own rules (who may do what, what
 * may never be shown) are covered by apps/api's care-requests e2e suite.
 */

const get = jest.fn();
const post = jest.fn();
const put = jest.fn();
const del = jest.fn();
const replace = jest.fn();
let pathname = '/caregivers/11111111-1111-4111-8111-111111111111';
let auth: { user: unknown; loading: boolean } = { user: null, loading: false };

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: jest.fn() }),
  usePathname: () => pathname,
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
    post: (...a: unknown[]) => post(...a),
    put: (...a: unknown[]) => put(...a),
    patch: jest.fn(),
    delete: (...a: unknown[]) => del(...a),
  },
}));

const PUBLIC_ID = '11111111-1111-4111-8111-111111111111';
const CLIENT = { userId: 'u-client', email: 'amali@example.com', role: 'PATIENT_GUARDIAN', patientId: 'p-1' };
const CAREGIVER = { userId: 'u-cg', email: 'nimal@example.com', role: 'CAREGIVER', caregiverId: 'cg-1' };

const profile = {
  publicId: PUBLIC_ID,
  gender: 'FEMALE',
  approxAge: 40,
  yearsExperience: 6,
  district: 'Colombo',
  city: 'Dehiwala',
  districtId: 1,
  cityId: 2,
  languages: [],
  skills: [],
  hasVerifiedQualification: true,
  preferredLocations: [],
  availability: { dayDuty: true, nightDuty: false, liveIn24h: false },
  relevantExperienceSummary: [],
  qualificationSummary: [],
};

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
  pathname = `/caregivers/${PUBLIC_ID}`;
});

describe('CaregiverActions', () => {
  it('sends a signed-out visitor to sign up, and remembers to bring them back to this caregiver', async () => {
    auth = { user: null, loading: false };
    get.mockImplementation((path: string) =>
      path === '/auth/whatsapp/config'
        ? Promise.resolve({ enabled: true, customer: { register: true, login: true }, caregiver: { register: true, login: true }, otpLength: 6 })
        : Promise.resolve([]),
    );
    renderUi(<CaregiverActions publicId={PUBLIC_ID} caregiverLabel="11111111" />);

    fireEvent.click(screen.getByRole('button', { name: 'Sign up to contact this caregiver' }));
    // WhatsApp first when it is switched on: one code, no password.
    fireEvent.click(await screen.findByRole('link', { name: 'Continue with WhatsApp' }));

    expect(JSON.parse(window.localStorage.getItem('care-platform-return-to')!).path).toBe(`/caregivers/${PUBLIC_ID}`);
    expect(JSON.parse(window.localStorage.getItem('care-platform-pending-contact')!).publicId).toBe(PUBLIC_ID);
    expect(screen.getByRole('link', { name: 'Continue with email' })).toHaveAttribute('href', '/register');
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
  });

  it('shows a signed-out visitor what their search already told us', async () => {
    auth = { user: null, loading: false };
    get.mockImplementation((path: string) => {
      if (path === '/auth/whatsapp/config') return Promise.resolve({ enabled: false, customer: { register: false, login: false }, caregiver: {}, otpLength: 6 });
      if (path.startsWith('/public/meta/locations/tree')) return Promise.resolve([{ id: 1, name: 'Western', districts: [{ id: 1, name: 'Colombo' }] }]);
      if (path.startsWith('/public/meta/locations/cities')) return Promise.resolve([{ id: 2, name: 'Dehiwala', subName: null, postcode: '10350' }]);
      return Promise.resolve([]);
    });
    window.localStorage.setItem(
      'care-platform-last-search',
      JSON.stringify({ at: Date.now(), request: { location: { districtId: 1, cityId: 2 }, shift: 'NIGHT', patient: { age: 78 } }, skillNames: ['Dementia care'] }),
    );
    renderUi(<CaregiverActions publicId={PUBLIC_ID} caregiverLabel="11111111" />);

    fireEvent.click(screen.getByRole('button', { name: 'Sign up to contact this caregiver' }));
    expect(await screen.findByText('Dehiwala, Colombo')).toBeInTheDocument();
    expect(screen.getByText('Age 78')).toBeInTheDocument();
    expect(screen.getByText('Help needed with: Dementia care')).toBeInTheDocument();
    // No WhatsApp sign-up configured: email is the main way in.
    expect(screen.queryByRole('link', { name: 'Continue with WhatsApp' })).not.toBeInTheDocument();
  });

  it('lets a signed-out visitor save a caregiver on this device without an account', () => {
    auth = { user: null, loading: false };
    get.mockResolvedValue(null);
    renderUi(<CaregiverActions publicId={PUBLIC_ID} caregiverLabel="11111111" />);

    fireEvent.click(screen.getByRole('button', { name: 'Save caregiver 11111111' }));

    expect(screen.getByRole('button', { name: /Remove caregiver 11111111/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/Saved on this device/)).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem('care-platform-device-shortlist')!)).toEqual([PUBLIC_ID]);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(put).not.toHaveBeenCalled();
  });

  it('opens the request dialog by itself when a client comes back from signing up', async () => {
    auth = { user: CLIENT, loading: false };
    window.localStorage.setItem('care-platform-pending-contact', JSON.stringify({ publicId: PUBLIC_ID, at: Date.now() }));
    get.mockResolvedValue([{ caregiverPublicId: PUBLIC_ID, saved: false, openRequest: null }]);
    renderUi(<CaregiverActions publicId={PUBLIC_ID} caregiverLabel="11111111" />);

    expect(await screen.findByLabelText(/anything we should know/i)).toBeInTheDocument();
    expect(window.localStorage.getItem('care-platform-pending-contact')).toBeNull();
  });

  it('does not open a second request for a returning client who already has one', async () => {
    auth = { user: CLIENT, loading: false };
    window.localStorage.setItem('care-platform-pending-contact', JSON.stringify({ publicId: PUBLIC_ID, at: Date.now() }));
    get.mockResolvedValue([{ caregiverPublicId: PUBLIC_ID, saved: false, openRequest: { id: 'r1', reference: 'CR-7K2QM9', status: 'NEW' } }]);
    renderUi(<CaregiverActions publicId={PUBLIC_ID} caregiverLabel="11111111" />);

    await screen.findByRole('link', { name: /Request sent · CR-7K2QM9/ });
    expect(screen.queryByLabelText(/anything we should know/i)).not.toBeInTheDocument();
    expect(window.localStorage.getItem('care-platform-pending-contact')).toBeNull();
  });

  it('tells a caregiver that contacting is for client accounts', () => {
    auth = { user: CAREGIVER, loading: false };
    renderUi(<CaregiverActions publicId={PUBLIC_ID} caregiverLabel="11111111" />);
    expect(screen.getByText(/signed in as a caregiver/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /contact/i })).not.toBeInTheDocument();
  });

  it('lets a client send a request with an optional note and shows the reference', async () => {
    auth = { user: CLIENT, loading: false };
    get.mockResolvedValue([{ caregiverPublicId: PUBLIC_ID, saved: false, openRequest: null }]);
    post.mockResolvedValue({ id: 'r1', reference: 'CR-7K2QM9', status: 'NEW', caregiverPublicId: PUBLIC_ID, caregiver: profile });
    renderUi(<CaregiverActions publicId={PUBLIC_ID} caregiverLabel="11111111" />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Contact this caregiver' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Contact this caregiver' }));
    fireEvent.change(screen.getByLabelText(/anything we should know/i), { target: { value: '  Evenings are best  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));

    await screen.findByText(/your reference is CR-7K2QM9/i);
    expect(post).toHaveBeenCalledWith('/me/care-requests', { caregiverPublicId: PUBLIC_ID, message: 'Evenings are best' });
  });

  it('shows the open request instead of a second Contact button', async () => {
    auth = { user: CLIENT, loading: false };
    get.mockResolvedValue([{ caregiverPublicId: PUBLIC_ID, saved: true, openRequest: { id: 'r1', reference: 'CR-7K2QM9', status: 'NEW' } }]);
    renderUi(<CaregiverActions publicId={PUBLIC_ID} caregiverLabel="11111111" />);

    expect(await screen.findByRole('link', { name: /Request sent · CR-7K2QM9/ })).toHaveAttribute('href', '/account/requests');
    expect(screen.queryByRole('button', { name: 'Contact this caregiver' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Remove caregiver 11111111/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('saves and unsaves through the API', async () => {
    auth = { user: CLIENT, loading: false };
    get.mockResolvedValue([{ caregiverPublicId: PUBLIC_ID, saved: false, openRequest: null }]);
    put.mockResolvedValue({ saved: true });
    renderUi(<CaregiverActions publicId={PUBLIC_ID} caregiverLabel="11111111" />);

    fireEvent.click(await screen.findByRole('button', { name: /Save caregiver 11111111/ }));
    await waitFor(() => expect(put).toHaveBeenCalledWith(`/me/saved-caregivers/${PUBLIC_ID}`, {}));
  });

  it('shows the API reason when a request is refused', async () => {
    auth = { user: CLIENT, loading: false };
    get.mockResolvedValue([{ caregiverPublicId: PUBLIC_ID, saved: false, openRequest: null }]);
    const { ApiError } = jest.requireActual('@/lib/api/client');
    post.mockRejectedValue(new ApiError(403, "Your account can't send requests right now. Please contact us for help."));
    renderUi(<CaregiverActions publicId={PUBLIC_ID} caregiverLabel="11111111" />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Contact this caregiver' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Contact this caregiver' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("Your account can't send requests right now");
  });
});

describe('client account', () => {
  it('sends a signed-out visitor to sign in and back again', () => {
    auth = { user: null, loading: false };
    pathname = '/account/saved';
    renderUi(
      <AccountLayout>
        <p>secret</p>
      </AccountLayout>,
    );
    expect(replace).toHaveBeenCalledWith('/login');
    expect(JSON.parse(window.localStorage.getItem('care-platform-return-to')!).path).toBe('/account/saved');
    expect(screen.queryByText('secret')).not.toBeInTheDocument();
  });

  it('sends a caregiver to their own area', () => {
    auth = { user: CAREGIVER, loading: false };
    pathname = '/account/requests';
    renderUi(
      <AccountLayout>
        <p>secret</p>
      </AccountLayout>,
    );
    expect(replace).toHaveBeenCalledWith('/caregiver/dashboard');
  });

  it('lists requests with their status and lets the client cancel an open one', async () => {
    auth = { user: CLIENT, loading: false };
    pathname = '/account/requests';
    get.mockResolvedValue([
      { id: 'r1', reference: 'CR-7K2QM9', status: 'NEW', createdAt: '2026-10-18T10:00:00Z', updatedAt: '2026-10-18T10:00:00Z', closedAt: null, caregiverPublicId: PUBLIC_ID, caregiver: profile },
      { id: 'r2', reference: 'CR-ABC234', status: 'INTRODUCED', createdAt: '2026-10-10T10:00:00Z', updatedAt: '2026-10-12T10:00:00Z', closedAt: null, caregiverPublicId: '22222222-2222-4222-8222-222222222222', caregiver: null },
      // Taken over the phone, no caregiver chosen yet.
      { id: 'r3', reference: 'CR-PHN234', status: 'IN_PROGRESS', createdAt: '2026-10-09T10:00:00Z', updatedAt: '2026-10-09T10:00:00Z', closedAt: null, caregiverPublicId: null, caregiver: null },
    ]);
    post.mockResolvedValue({});
    renderUi(<MyRequestsPage />);

    expect(await screen.findByText('Reference CR-7K2QM9')).toBeInTheDocument();
    expect(screen.getByText('Introduced')).toBeInTheDocument();
    expect(screen.getByText(/profile isn't shown online/)).toBeInTheDocument();
    expect(screen.getByText('Our team is finding a caregiver for you')).toBeInTheDocument();
    // Only the open requests can be cancelled.
    const cancels = screen.getAllByRole('button', { name: 'Cancel request' });
    expect(cancels).toHaveLength(2);
    fireEvent.click(cancels[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Yes, cancel it' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/me/care-requests/r1/cancel', {}));
  });

  it('lists saved caregivers and removes one', async () => {
    auth = { user: CLIENT, loading: false };
    pathname = '/account/saved';
    get.mockImplementation((path: string) =>
      Promise.resolve(
        path.startsWith('/me/saved-caregivers')
          ? [{ caregiverPublicId: PUBLIC_ID, savedAt: '2026-10-18T10:00:00Z', caregiver: profile }]
          : [{ caregiverPublicId: PUBLIC_ID, saved: true, openRequest: null }],
      ),
    );
    del.mockResolvedValue({ saved: false });
    renderUi(<SavedCaregiversPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(del).toHaveBeenCalledWith(`/me/saved-caregivers/${PUBLIC_ID}`));
    expect(screen.getByRole('link', { name: 'Contact this caregiver' })).toHaveAttribute('href', `/caregivers/${PUBLIC_ID}`);
  });

  it('shows confirmed bookings with their shifts in Sri Lanka time', async () => {
    auth = { user: CLIENT, loading: false };
    pathname = '/account/bookings';
    get.mockResolvedValue([
      {
        id: 'b1', reference: 'BK-7K2QM9', status: 'CONFIRMED', scheduleType: 'NIGHT', startDate: '2026-11-02', endDate: '2026-11-30',
        rateType: 'DAILY', rateAmount: '4000.00', caregiverPublicId: PUBLIC_ID, caregiver: profile,
        shifts: [
          // 20:00 Colombo -> 08:00 next day.
          { id: 's1', startsAt: '2026-11-02T14:30:00.000Z', endsAt: '2026-11-03T02:30:00.000Z', status: 'SCHEDULED', isCover: false },
          { id: 's2', startsAt: '2026-11-03T14:30:00.000Z', endsAt: '2026-11-04T02:30:00.000Z', status: 'SCHEDULED', isCover: true },
        ],
      },
    ]);
    renderUi(<MyBookingsPage />);

    expect(await screen.findByText('BK-7K2QM9')).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('/me/bookings');
    expect(screen.getAllByText(/20:00–08:00/)).toHaveLength(2);
    expect(screen.getAllByText('(+1)')).toHaveLength(2);
    expect(screen.getByText(/another caregiver covering/)).toBeInTheDocument();
    expect(screen.getByText(/LKR 4,000.00 per day/)).toBeInTheDocument();
  });

  it('lets a client report a problem on one shift, and shows where earlier reports stand', async () => {
    auth = { user: CLIENT, loading: false };
    pathname = '/account/bookings';
    const booking = {
      id: 'b1', reference: 'BK-7K2QM9', status: 'COMPLETED', scheduleType: 'DAY', startDate: '2026-10-05', endDate: '2026-10-09',
      rateType: 'HOURLY', rateAmount: '500.00', caregiverPublicId: PUBLIC_ID, caregiver: profile,
      shifts: [{ id: 's1', startsAt: '2026-10-06T02:30:00.000Z', endsAt: '2026-10-06T10:30:00.000Z', status: 'COMPLETED', isCover: false }],
    };
    const answered = {
      id: 'r0', bookingId: 'b1', bookingReference: 'BK-7K2QM9', shiftId: null, shiftStartsAt: null, category: 'CHARGE',
      message: 'Charged twice for Monday', status: 'RESOLVED', resolutionNote: 'Refunded - sorry about that.', createdAt: '2026-10-10T04:00:00.000Z', closedAt: '2026-10-11T04:00:00.000Z',
    };
    get.mockImplementation((path: string) => Promise.resolve(path === '/me/issues' ? [answered] : [booking]));
    post.mockResolvedValue({ ...answered, id: 'r1', status: 'OPEN', resolutionNote: null });
    renderUi(<MyBookingsPage />);

    // An earlier report, with our answer.
    expect(await screen.findByText('Charged twice for Monday')).toBeInTheDocument();
    expect(screen.getByText('Put right')).toBeInTheDocument();
    expect(screen.getByText('Our answer: Refunded - sorry about that.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: "Something's not right? Tell us" }));
    const send = screen.getByRole('button', { name: 'Send to our team' });
    expect(send).toBeDisabled();
    // Pay is the caregiver's to report, not the client's.
    expect(screen.queryByRole('option', { name: 'My pay is wrong' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/What is wrong/), { target: { value: 'TIMES' } });
    fireEvent.change(screen.getByLabelText('Which shift?'), { target: { value: 's1' } });
    fireEvent.change(screen.getByLabelText(/Tell us what happened/), { target: { value: 'She stayed until 7 pm, not 4 pm' } });
    fireEvent.click(send);

    await waitFor(() => expect(post).toHaveBeenCalledWith('/me/bookings/b1/issues', { category: 'TIMES', message: 'She stayed until 7 pm, not 4 pm', shiftId: 's1' }));
    expect(await screen.findByText(/your report has reached our team/)).toBeInTheDocument();
  });
});
