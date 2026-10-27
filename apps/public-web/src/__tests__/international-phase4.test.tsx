import type { ReactElement } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { CaregiverJobOffer, CaregiverPlacement, EmployerAccount, EmployerJobOffer, EmployerOwnEnquiry, OfferTerms } from '@care-platform/shared';
import { I18nProvider } from '@/lib/i18n';
import type { AuthUser } from '@/lib/api/auth-context';

/**
 * Phase 4 of the international paths as each visitor meets it: a caregiver
 * answering a job offer, getting help while abroad, and adding a test result;
 * an employer's interviews and offers; and anyone checking a certificate.
 * The API is recorded calls, so each test checks exactly what would be sent.
 */

const get = jest.fn();
const post = jest.fn();
const put = jest.fn();
const del = jest.fn();
let params: Record<string, string> = {};
let search = '';
let auth: { user: Partial<AuthUser> | null; loading: boolean } = { user: null, loading: false };

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
  usePathname: () => '/',
  useParams: () => params,
  useSearchParams: () => new URLSearchParams(search),
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
    patch: jest.fn(),
    delete: (...a: unknown[]) => del(...a),
  },
}));
jest.mock('@/lib/api/auth-context', () => ({
  ...jest.requireActual('@/lib/api/auth-context'),
  useAuth: () => ({ ...auth, logout: jest.fn(), login: jest.fn(), applyTokens: jest.fn() }),
}));
jest.mock('@/components/layout/site-header', () => ({ SiteHeader: () => null }));
jest.mock('@/components/layout/site-footer', () => ({ SiteFooter: () => null }));

const CAREGIVER = { userId: 'u-cg', email: 'dilani@example.lk', role: 'CAREGIVER' as const, caregiverId: 'cg-1' };
const EMPLOYER = { userId: 'u-emp', email: 'aiko@example.jp', role: 'EMPLOYER' as const, employerId: 'emp-1' };


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
    for (const [prefix, value] of Object.entries(map)) if (path === prefix) return Promise.resolve(value);
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
}

beforeEach(() => {
  [get, post, put, del].forEach((m) => m.mockReset());
  params = {};
  search = '';
  auth = { user: null, loading: false };
  window.localStorage.clear();
});

const TERMS: OfferTerms = {
  jobTitle: 'Care assistant, dementia unit',
  country: 'JP',
  city: 'Osaka',
  startDate: '2027-02-01',
  contractMonths: 24,
  hoursPerWeek: 40,
  salaryAmount: 2100,
  salaryCurrency: 'USD',
  salaryPeriod: 'MONTH',
  accommodation: 'PROVIDED_FREE',
  mealsProvided: true,
  flightsPaidBy: 'EMPLOYER',
  annualLeaveDays: 14,
  probationMonths: 3,
  otherTerms: 'Visa fees paid by the employer.',
};

const caregiverOffer = (over: Partial<CaregiverJobOffer> = {}): CaregiverJobOffer => ({
  ...TERMS,
  id: 'of-1',
  reference: 'OF-7K2Q9M',
  candidateId: 'cand-1',
  status: 'SENT',
  expired: false,
  expiresOn: '2026-11-10',
  employerSignature: { name: 'Aiko Tanaka', signedAt: '2026-10-27T03:00:00Z' },
  caregiverSignature: null,
  termsHash: 'abc',
  declineReason: null,
  sentAt: '2026-10-27T04:00:00Z',
  respondedAt: null,
  createdAt: '2026-10-27T03:00:00Z',
  updatedAt: '2026-10-27T04:00:00Z',
  organisationType: 'CARE_HOME',
  ...over,
});

const placement = (over: Partial<CaregiverPlacement> = {}): CaregiverPlacement => ({
  id: 'pl-1',
  country: 'AE',
  organisationType: 'HOME_CARE_PROVIDER',
  jobTitle: 'Home carer',
  status: 'DEPLOYED',
  departureOn: '2026-09-01',
  arrivedOn: '2026-09-01',
  contractStartOn: '2026-09-02',
  contractEndsOn: '2028-09-02',
  journey: { checklist: [], departureDetails: null, addressAbroad: null, phoneAbroad: null },
  ...over,
});

describe('a caregiver answering a job offer', () => {
  it('shows the terms and the employer by kind and country only', async () => {
    const { MyOffersCard } = await import('@/components/international/caregiver-journey');
    auth = { user: CAREGIVER, loading: false };
    route({ '/caregivers/cg-1/overseas/offers': [caregiverOffer()] });
    renderUi(<MyOffersCard />);
    expect(await screen.findByRole('heading', { name: 'Care assistant, dementia unit' })).toBeInTheDocument();
    expect(screen.getByText(/in Japan · OF-7K2Q9M/)).toBeInTheDocument();
    expect(screen.queryByText(/Sakura/)).not.toBeInTheDocument();
    expect(screen.getByText('24 months')).toBeInTheDocument();
    expect(screen.getByText('Provided, free')).toBeInTheDocument();
    expect(screen.getByText('Visa fees paid by the employer.')).toBeInTheDocument();
    expect(screen.getByText('Aiko Tanaka')).toBeInTheDocument();
  });

  it('only signs once the caregiver has read the terms and typed their name', async () => {
    const { MyOffersCard } = await import('@/components/international/caregiver-journey');
    auth = { user: CAREGIVER, loading: false };
    route({ '/caregivers/cg-1/overseas/offers': [caregiverOffer()] });
    post.mockResolvedValue([caregiverOffer({ status: 'ACCEPTED', caregiverSignature: { name: 'Dilani Perera', signedAt: '2026-10-27T05:00:00Z' } })]);
    renderUi(<MyOffersCard />);
    fireEvent.click(await screen.findByRole('button', { name: 'Accept the offer' }));
    const sign = screen.getByRole('button', { name: 'Sign and accept' });
    expect(sign).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Type your full name to sign/), { target: { value: 'Dilani Perera' } });
    expect(sign).toBeDisabled(); // not read yet
    fireEvent.click(screen.getByLabelText(/I have read the terms/));
    expect(sign).toBeEnabled();
    fireEvent.click(sign);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/caregivers/cg-1/overseas/offers/of-1/respond', { action: 'ACCEPT', signatureName: 'Dilani Perera' }));
    expect(await screen.findByText('Accepted')).toBeInTheDocument();
  });

  it('does not offer to accept once the answer date has passed', async () => {
    const { MyOffersCard } = await import('@/components/international/caregiver-journey');
    auth = { user: CAREGIVER, loading: false };
    route({ '/caregivers/cg-1/overseas/offers': [caregiverOffer({ expired: true })] });
    renderUi(<MyOffersCard />);
    expect(await screen.findByText('Answer date passed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Accept the offer' })).not.toBeInTheDocument();
  });
});

describe('help while abroad', () => {
  it('shows local emergency numbers, and sends an SOS in two taps with no typing', async () => {
    const { WelfareCard } = await import('@/components/international/caregiver-journey');
    auth = { user: CAREGIVER, loading: false };
    route({ '/caregivers/cg-1/overseas/placements': [placement()], '/caregivers/cg-1/overseas/welfare': [] });
    post.mockResolvedValue([]);
    renderUi(<WelfareCard />);
    expect(await screen.findByText(/police in United Arab Emirates on 999, or an ambulance on 998/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'SOS - I need help now' }));
    expect(post).not.toHaveBeenCalled(); // the first tap only asks
    fireEvent.click(screen.getByRole('button', { name: 'Yes, send SOS' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/caregivers/cg-1/overseas/placements/pl-1/welfare', { severity: 'SOS', category: 'SAFETY' }));
    expect(await screen.findByText(/Your SOS has been sent/)).toBeInTheDocument();
  });

  it('keeps the SOS button for when the caregiver is actually abroad', async () => {
    const { WelfareCard } = await import('@/components/international/caregiver-journey');
    auth = { user: CAREGIVER, loading: false };
    route({ '/caregivers/cg-1/overseas/placements': [placement({ status: 'PRE_DEPARTURE', arrivedOn: null })], '/caregivers/cg-1/overseas/welfare': [] });
    renderUi(<WelfareCard />);
    expect(await screen.findByText('Help while you are abroad')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'SOS - I need help now' })).not.toBeInTheDocument();
  });
});

describe('the departure checklist', () => {
  it('counts the steps done and lets the caregiver keep their contact abroad up to date', async () => {
    const { DepartureCard } = await import('@/components/international/caregiver-journey');
    auth = { user: CAREGIVER, loading: false };
    const checklist = [
      { item: 'OFFER_ACCEPTED' as const, done: true, doneOn: '2026-10-01', dueOn: null, note: null },
      { item: 'MEDICAL' as const, done: false, doneOn: null, dueOn: '2026-11-05', note: 'Bring your passport' },
    ];
    route({ '/caregivers/cg-1/overseas/placements': [placement({ status: 'PRE_DEPARTURE', journey: { checklist, departureDetails: 'UL 454, 08:40', addressAbroad: null, phoneAbroad: null } })] });
    put.mockResolvedValue([placement()]);
    renderUi(<DepartureCard />);
    expect(await screen.findAllByText('1 of 2 done')).not.toHaveLength(0);
    expect(screen.getByText('Bring your passport')).toBeInTheDocument();
    expect(screen.getByText('UL 454, 08:40')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Phone number abroad'), { target: { value: '+971 50 123 4567' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(put).toHaveBeenCalledWith('/caregivers/cg-1/overseas/placements/pl-1/contact', { addressAbroad: null, phoneAbroad: '+971 50 123 4567' }));
  });
});

describe('checking a certificate', () => {
  it('shows the first name and programme of a genuine certificate', async () => {
    const { default: Page } = await import('@/app/verify/[code]/page');
    params = { code: 'abcdefghjk23' };
    route({ '/public/certificates/abcdefghjk23': { number: 'TC-2026-K7Q2M9', firstName: 'Dilani', programmeTitle: 'English for caregivers', issuedOn: '2026-09-01', status: 'VALID' } });
    renderUi(<Page />);
    expect(await screen.findByText('This certificate is genuine')).toBeInTheDocument();
    expect(screen.getByText('Dilani')).toBeInTheDocument();
    expect(screen.getByText('TC-2026-K7Q2M9')).toBeInTheDocument();
  });

  it('does not even ask the server about a code that cannot exist', async () => {
    const { default: Page } = await import('@/app/verify/[code]/page');
    params = { code: 'NOT-A-CODE' };
    renderUi(<Page />);
    expect(await screen.findByText('We could not find this certificate')).toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
  });
});

describe("an employer's interviews and offers", () => {
  const account = (): EmployerAccount =>
    ({ id: 'emp-1', organisationName: 'Sakura Care', organisationType: 'CARE_HOME', country: 'JP', status: 'VERIFIED' }) as unknown as EmployerAccount;
  const enquiry = (candidate: Partial<EmployerOwnEnquiry['candidates'][number]> = {}): EmployerOwnEnquiry => ({
    id: 'enq-1',
    reference: 'IE-7K2Q9M',
    status: 'INTRODUCED',
    country: 'JP',
    rolesCount: 1,
    careSettings: ['NURSING_HOME'],
    createdAt: '2026-10-20T08:00:00Z',
    candidates: [
      {
        id: 'cand-1',
        status: 'INTERVIEW_SCHEDULED',
        interviewAt: null,
        messageToEmployer: null,
        talent: { slug: 'dilani2026abc', firstName: 'Dilani', headline: null, photoUrl: null, yearsExperience: 4, verified: true, languages: [], completedTraining: [], targetCountries: ['JP'] },
        interviews: [],
        offer: null,
        ...candidate,
      },
    ],
  });

  it('lets them add feedback after an interview, and make an offer', async () => {
    const { default: Overview } = await import('@/app/employer/(area)/page');
    auth = { user: EMPLOYER, loading: false };
    const past = { id: 'iv-1', candidateId: 'cand-1', round: 1, scheduledAt: '2026-10-20T04:00:00Z', durationMinutes: 30, mode: 'VIDEO' as const, meetingLink: 'https://meet.example/x', location: null, instructions: null, status: 'SCHEDULED' as const, cancelReason: null, feedback: null };
    route({ '/employer/me': account(), '/employer/enquiries': [enquiry({ interviews: [past] })] });
    renderUi(<Overview />);
    expect(await screen.findByRole('link', { name: /Make an offer/ })).toHaveAttribute('href', '/employer/offers/new?candidate=cand-1');
    fireEvent.click(screen.getByRole('button', { name: 'Add your feedback' }));
    expect(screen.getByText('Only our team reads this. The caregiver does not see it.')).toBeInTheDocument();
  });

  it('shows an offer in progress instead of offering to make another', async () => {
    const { default: Overview } = await import('@/app/employer/(area)/page');
    auth = { user: EMPLOYER, loading: false };
    route({ '/employer/me': account(), '/employer/enquiries': [enquiry({ status: 'SELECTED', offer: { id: 'of-1', reference: 'OF-7K2Q9M', status: 'PENDING_REVIEW', expired: false } as unknown as EmployerJobOffer })] });
    renderUi(<Overview />);
    expect(await screen.findByRole('link', { name: 'Offer OF-7K2Q9M' })).toHaveAttribute('href', '/employer/offers/of-1');
    expect(screen.getByText('With our team')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Make an offer/ })).not.toBeInTheDocument();
  });
});
