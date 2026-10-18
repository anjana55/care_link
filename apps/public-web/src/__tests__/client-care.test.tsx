import type { ReactElement } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nProvider } from '@/lib/i18n';
import { CaregiverActions } from '@/components/care/caregiver-actions';
import AccountLayout from '@/app/account/layout';
import MyRequestsPage from '@/app/account/requests/page';
import SavedCaregiversPage from '@/app/account/saved/page';

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
  it('sends a signed-out visitor to sign up, and remembers to bring them back', () => {
    auth = { user: null, loading: false };
    renderUi(<CaregiverActions publicId={PUBLIC_ID} caregiverLabel="11111111" />);

    fireEvent.click(screen.getByRole('button', { name: 'Sign up to contact this caregiver' }));
    fireEvent.click(screen.getByRole('link', { name: 'Sign up' }));

    expect(JSON.parse(window.localStorage.getItem('care-platform-return-to')!).path).toBe(`/caregivers/${PUBLIC_ID}`);
    expect(get).not.toHaveBeenCalled();
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
});
