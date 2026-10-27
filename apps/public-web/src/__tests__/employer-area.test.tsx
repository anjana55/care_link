import type { ReactElement } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { EmployerAccount, EmployerOwnEnquiry, PublicTalentProfile, ReadinessReport } from '@care-platform/shared';
import { I18nProvider } from '@/lib/i18n';
import { AuthProvider, postLoginPath, useAuth, type AuthUser } from '@/lib/api/auth-context';
import { accountHome } from '@/lib/account-home';

/**
 * Phase 2 of the international paths, as each visitor meets it: an overseas
 * employer signing up and working their enquiries, the shared profile seen
 * by a signed-in employer, and a caregiver's readiness checklist. The API is
 * recorded calls, so each test can check exactly what would be sent.
 */

const get = jest.fn();
const post = jest.fn();
const put = jest.fn();
const patch = jest.fn();
const del = jest.fn();
const replace = jest.fn();
let params: Record<string, string> = {};
let auth: { user: Partial<AuthUser> | null; loading: boolean } = { user: null, loading: false };

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: jest.fn() }),
  usePathname: () => '/employer',
  useParams: () => params,
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
jest.mock('@/lib/api/client', () => ({
  ...jest.requireActual('@/lib/api/client'),
  api: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
    put: (...a: unknown[]) => put(...a),
    patch: (...a: unknown[]) => patch(...a),
    delete: (...a: unknown[]) => del(...a),
  },
}));
// Swapped per test: most tests want a fixed signed-in user; the token tests want the real provider.
jest.mock('@/lib/api/auth-context', () => {
  const actual = jest.requireActual('@/lib/api/auth-context');
  return { ...actual, useAuth: () => (useRealAuth ? actual.useAuth() : { ...auth, logout: jest.fn(), login: jest.fn(), applyTokens: jest.fn() }) };
});
let useRealAuth = false;

const EMPLOYER_USER = { userId: 'u-emp', email: 'aiko@example.jp', role: 'EMPLOYER' as const, employerId: 'emp-1' };

const account = (over: Partial<EmployerAccount> = {}): EmployerAccount => ({
  id: 'emp-1',
  email: 'aiko@example.jp',
  organisationName: 'Sakura Care',
  organisationType: 'CARE_HOME',
  country: 'JP',
  contactName: 'Aiko Tanaka',
  phone: null,
  website: null,
  companyRegistrationNumber: null,
  status: 'VERIFIED',
  reviewNote: null,
  canEditOrganisation: false,
  ...over,
});

const talentCard = { slug: 'abcdefgh2345', firstName: 'Nadeesha', headline: 'Home carer', photoUrl: null, yearsExperience: 8, verified: true, languages: [], completedTraining: [], targetCountries: ['JP'] };

const enquiry = (over: Partial<EmployerOwnEnquiry> = {}): EmployerOwnEnquiry => ({
  id: 'enq-1',
  reference: 'IE-7K2Q9M',
  status: 'INTRODUCED',
  country: 'JP',
  rolesCount: 2,
  careSettings: ['NURSING_HOME'],
  createdAt: '2026-10-20T08:00:00Z',
  candidates: [{ id: 'c1', status: 'PROPOSED', interviewAt: null, messageToEmployer: 'Strong English', talent: talentCard, interviews: [], offer: null }],
  ...over,
});

function renderUi(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider>{ui}</I18nProvider>
    </QueryClientProvider>,
  );
}

function route(map: Record<string, unknown>) {
  get.mockImplementation((path: string) => {
    for (const [prefix, value] of Object.entries(map)) if (path === prefix || path.startsWith(`${prefix}?`)) return Promise.resolve(value);
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
}

beforeEach(() => {
  [get, post, put, patch, del, replace].forEach((m) => m.mockReset());
  params = {};
  auth = { user: EMPLOYER_USER, loading: false };
  useRealAuth = false;
  window.localStorage.clear();
});

describe('employer sign-in', () => {
  function tokenWith(payload: Record<string, unknown>) {
    return ['e30', btoa(JSON.stringify(payload)), 'sig'].join('.');
  }

  it('accepts an EMPLOYER token on the public site and sends them to their own area', () => {
    useRealAuth = true;
    let ctx: ReturnType<typeof useAuth> | null = null;
    function Probe() {
      ctx = useAuth();
      return null;
    }
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    let user: AuthUser | null = null;
    act(() => {
      user = ctx!.applyTokens({ accessToken: tokenWith({ sub: 'u-emp', email: 'aiko@example.jp', role: 'EMPLOYER', employerId: 'emp-1' }), refreshToken: 'r' });
    });
    expect(user).toMatchObject({ role: 'EMPLOYER', employerId: 'emp-1' });
    expect(postLoginPath(user!)).toBe('/employer');
    expect(accountHome(user!)).toBe('/employer');
  });
});

describe('employer registration', () => {
  it('needs the consent tick, then sends the organisation and contact details', async () => {
    const { default: Register } = await import('@/app/employer/register/page');
    post.mockResolvedValue({ message: 'ok' });
    renderUi(<Register />);
    fireEvent.change(screen.getByLabelText(/organisation or family name/i), { target: { value: 'Sakura Care' } });
    fireEvent.change(screen.getByLabelText(/type of employer/i), { target: { value: 'CARE_HOME' } });
    fireEvent.change(screen.getByLabelText(/^country/i), { target: { value: 'JP' } });
    fireEvent.change(screen.getByLabelText(/your name/i), { target: { value: 'Aiko Tanaka' } });
    fireEvent.change(screen.getByLabelText(/^email/i), { target: { value: 'aiko@example.jp' } });
    fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: 'correct-horse' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('Please tick this to create the account.')).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('checkbox', { name: /terms of use/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0]).toEqual([
      '/auth/register-employer',
      expect.objectContaining({ organisationName: 'Sakura Care', organisationType: 'CARE_HOME', country: 'JP', email: 'aiko@example.jp', consent: true }),
    ]);
    expect(await screen.findByText('Check your email')).toBeInTheDocument();
  });
});

describe('employer area', () => {
  it('sends anyone who is not an employer away', async () => {
    const { default: Layout } = await import('@/app/employer/(area)/layout');
    auth = { user: { userId: 'u', role: 'CAREGIVER', caregiverId: 'cg-1', email: null }, loading: false };
    renderUi(<Layout>secret</Layout>);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'));
    expect(screen.queryByText('secret')).not.toBeInTheDocument();
  });

  it('shows candidates put forward and lets a verified employer ask for an interview', async () => {
    const { default: Overview } = await import('@/app/employer/(area)/page');
    route({ '/employer/me': account(), '/employer/enquiries': [enquiry()] });
    patch.mockResolvedValue([enquiry({ candidates: [{ ...enquiry().candidates[0], status: 'INTERVIEW_REQUESTED' }] })]);
    renderUi(<Overview />);
    expect(await screen.findByText('Nadeesha')).toBeInTheDocument();
    expect(screen.getByText('Strong English')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('A note for our team'), { target: { value: 'Mornings JST' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask for an interview' }));
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith('/employer/candidates/c1?locale=en', { action: 'REQUEST_INTERVIEW', message: 'Mornings JST' }),
    );
    expect(await screen.findByText('Interview requested')).toBeInTheDocument();
  });

  it('keeps interview requests switched off until the organisation is verified', async () => {
    const { default: Overview } = await import('@/app/employer/(area)/page');
    route({ '/employer/me': account({ status: 'PENDING_REVIEW' }), '/employer/enquiries': [enquiry()] });
    renderUi(<Overview />);
    expect(await screen.findByText('Waiting for verification')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Ask for an interview' })).toBeDisabled();
  });

  it('says a caregiver who stopped sharing is no longer available, without showing them', async () => {
    const { default: Overview } = await import('@/app/employer/(area)/page');
    route({ '/employer/me': account(), '/employer/enquiries': [enquiry({ candidates: [{ id: 'c1', status: 'PROPOSED', interviewAt: null, messageToEmployer: null, talent: null, interviews: [], offer: null }] })] });
    renderUi(<Overview />);
    expect(await screen.findByText('This caregiver is no longer available.')).toBeInTheDocument();
    expect(screen.queryByText('Nadeesha')).not.toBeInTheDocument();
  });
});

describe('shared profile, seen by a signed-in employer', () => {
  const profile: PublicTalentProfile = {
    ...talentCard,
    certificates: [],
    assessments: [],
    bio: null,
    approxAge: 41,
    hasVerifiedQualification: false,
    careTypes: [],
    skills: [],
    qualifications: [],
    availableFrom: null,
  };

  it('offers the shortlist and an interview request on one of their open enquiries', async () => {
    const { default: Profile } = await import('@/app/talent/[slug]/page');
    params = { slug: 'abcdefgh2345' };
    route({ '/public/talent/abcdefgh2345': profile, '/employer/me': account(), '/employer/enquiries': [enquiry({ candidates: [] })], '/employer/shortlist': [] });
    put.mockResolvedValue([talentCard]);
    post.mockResolvedValue([enquiry()]);
    renderUi(<Profile />);

    fireEvent.click(await screen.findByRole('button', { name: 'Save to shortlist' }));
    await waitFor(() => expect(put).toHaveBeenCalledWith('/employer/shortlist/abcdefgh2345?locale=en'));
    expect(await screen.findByRole('button', { name: 'On your shortlist' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Ask for an interview' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/employer/candidates?locale=en', { enquiryId: 'enq-1', talentSlug: 'abcdefgh2345' }));
    expect(screen.getByRole('link', { name: /download pdf/i })).toHaveAttribute('href', '/talent/abcdefgh2345/card');
    // Still never a way to reach the caregiver directly.
    expect(document.querySelector('a[href^="tel:"], a[href^="mailto:"]')).toBeNull();
  });
});

describe("caregiver's readiness checklist", () => {
  it('shows what is done and where to fix the rest', async () => {
    const { ReadinessChecklist } = await import('@/components/international/readiness-checklist');
    auth = { user: { userId: 'u1', email: 'n@example.com', role: 'CAREGIVER', caregiverId: 'cg-1' }, loading: false };
    const report: ReadinessReport = {
      items: [
        { key: 'registrationVerified', done: true },
        { key: 'openToOverseas', done: true },
        { key: 'passportValid', done: false },
        { key: 'policeClearance', done: false },
        { key: 'english', done: true },
        { key: 'caregiving', done: false },
        { key: 'sharedProfile', done: false },
      ],
      done: 3,
      total: 7,
    };
    route({ '/caregivers/cg-1/overseas/checklist': report });
    renderUi(<ReadinessChecklist />);
    expect(await screen.findByText('3 of 7 done')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Upload your police clearance' })).toHaveAttribute('href', '/caregiver/documents');
    expect(screen.queryByRole('link', { name: 'Join the English course' })).not.toBeInTheDocument();
  });
});
