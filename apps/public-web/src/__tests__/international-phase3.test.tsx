import type { ReactElement } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { CaregiverExpiringDocument, CaregiverVacancyApplication, EmployerAccount, EmployerPlacement, PlacementInvoice, PublicVacancy, Vacancy } from '@care-platform/shared';
import { I18nProvider } from '@/lib/i18n';
import type { AuthUser } from '@/lib/api/auth-context';

/**
 * Phase 3 of the international paths as each visitor meets it: the vacancy
 * board and applying, a caregiver's applications and expiring documents, and
 * an employer's vacancies, placements and invoices. The API is recorded
 * calls, so each test checks exactly what would be sent.
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

const vacancy = (over: Partial<PublicVacancy> = {}): PublicVacancy => ({
  reference: 'VC-7K2Q9M',
  title: 'Care assistant, dementia unit',
  organisationType: 'CARE_HOME',
  country: 'JP',
  city: 'Osaka',
  careSetting: 'NURSING_HOME',
  rolesCount: 2,
  description: 'Day and night shifts supporting residents with dementia.',
  requirements: null,
  minExperienceYears: 2,
  englishLevel: 'CONVERSATIONAL',
  salaryMin: 1800,
  salaryMax: 2200,
  salaryCurrency: 'USD',
  salaryPeriod: 'MONTH',
  contractMonths: 24,
  accommodationProvided: true,
  visaSponsorship: 'YES',
  startTimeframe: null,
  closesOn: null,
  publishedAt: '2026-10-20T08:00:00Z',
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

describe('the vacancy board', () => {
  it('lists vacancies with their terms, and filters by country', async () => {
    const { default: Board } = await import('@/app/work-abroad/vacancies/page');
    get.mockResolvedValue({ items: [vacancy()], page: 1, pageSize: 20, total: 1 });
    renderUi(<Board />);
    expect(await screen.findByRole('link', { name: 'Care assistant, dementia unit' })).toHaveAttribute('href', '/work-abroad/vacancies/VC-7K2Q9M');
    expect(screen.getByText('Vacancies: 1')).toBeInTheDocument();
    expect(screen.getByText(/a month$/)).toBeInTheDocument();
    expect(screen.getByText('24-month contract')).toBeInTheDocument();
    expect(screen.getByText('We never charge caregivers a fee')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Country'), { target: { value: 'JP' } });
    await waitFor(() => expect(get).toHaveBeenLastCalledWith('/public/vacancies', expect.objectContaining({ country: 'JP', page: 1 })));
  });
});

describe('applying for a vacancy', () => {
  it('asks a visitor to sign in as a caregiver, and remembers where they were', async () => {
    const { default: Page } = await import('@/app/work-abroad/vacancies/[reference]/page');
    params = { reference: 'vc-7k2q9m' };
    route({ '/public/vacancies/VC-7K2Q9M': vacancy() });
    renderUi(<Page />);
    const signIn = await screen.findByRole('link', { name: 'Sign in' });
    expect(signIn).toHaveAttribute('href', '/caregiver/login');
    fireEvent.click(signIn);
    expect(window.localStorage.getItem('care-platform-return-to')).toContain('/work-abroad/vacancies/VC-7K2Q9M');
    expect(screen.queryByRole('button', { name: /apply/i })).not.toBeInTheDocument();
  });

  it('tells an employer that only caregivers apply', async () => {
    const { default: Page } = await import('@/app/work-abroad/vacancies/[reference]/page');
    params = { reference: 'VC-7K2Q9M' };
    auth = { user: EMPLOYER, loading: false };
    route({ '/public/vacancies/VC-7K2Q9M': vacancy() });
    renderUi(<Page />);
    expect(await screen.findByText('Only caregivers can apply for vacancies.')).toBeInTheDocument();
  });

  it("sends a caregiver's application with their note, then shows it as sent", async () => {
    const { default: Page } = await import('@/app/work-abroad/vacancies/[reference]/page');
    params = { reference: 'VC-7K2Q9M' };
    auth = { user: CAREGIVER, loading: false };
    route({
      '/public/vacancies/VC-7K2Q9M': vacancy(),
      '/caregivers/cg-1/vacancy-applications': [],
      '/caregivers/cg-1/shared-profile': { isLive: false },
    });
    const sent: CaregiverVacancyApplication = {
      id: 'app-1',
      status: 'APPLIED',
      createdAt: '2026-10-26T08:00:00Z',
      vacancy: { reference: 'VC-7K2Q9M', title: 'Care assistant, dementia unit', country: 'JP', city: 'Osaka', organisationType: 'CARE_HOME', open: true },
    };
    post.mockResolvedValue([sent]);
    renderUi(<Page />);
    expect(await screen.findByText('Our team can only put you forward once your shared profile is live.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('A note for our team (optional)'), { target: { value: 'Four years in elder care' } });
    fireEvent.click(screen.getByRole('button', { name: /^apply/i }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/caregivers/cg-1/vacancies/VC-7K2Q9M/apply', { message: 'Four years in elder care' }));
    expect(await screen.findByText('Application sent - our team will reply')).toBeInTheDocument();
  });
});

describe("a caregiver's Work abroad status", () => {
  it('lists applications and lets one waiting for staff be withdrawn', async () => {
    const { MyApplicationsCard } = await import('@/components/international/overseas-status');
    auth = { user: CAREGIVER, loading: false };
    const applications: CaregiverVacancyApplication[] = [
      { id: 'a1', status: 'APPLIED', createdAt: '2026-10-26T08:00:00Z', vacancy: { reference: 'VC-AAAAAA', title: 'Night carer', country: 'JP', city: null, organisationType: 'CARE_HOME', open: true } },
      { id: 'a2', status: 'PUT_FORWARD', createdAt: '2026-10-20T08:00:00Z', vacancy: { reference: 'VC-BBBBBB', title: 'Live-in carer', country: 'GB', city: null, organisationType: 'PRIVATE_FAMILY', open: true } },
    ];
    route({ '/caregivers/cg-1/vacancy-applications': applications });
    del.mockResolvedValue([applications[1]]);
    renderUi(<MyApplicationsCard />);
    expect(await screen.findByText('Put forward to the employer')).toBeInTheDocument();
    const withdraw = screen.getAllByRole('button', { name: /withdraw/i });
    expect(withdraw).toHaveLength(1);
    fireEvent.click(withdraw[0]);
    await waitFor(() => expect(del).toHaveBeenCalledWith('/caregivers/cg-1/vacancy-applications/a1'));
  });

  it('warns about a passport running out', async () => {
    const { DatedDocumentsCard } = await import('@/components/international/overseas-status');
    auth = { user: CAREGIVER, loading: false };
    const docs: CaregiverExpiringDocument[] = [{ key: 'PASSPORT', documentType: 'PASSPORT', expiresOn: '2026-11-15', daysLeft: 20, state: 'EXPIRING' }];
    route({ '/caregivers/cg-1/overseas/documents': docs });
    renderUi(<DatedDocumentsCard />);
    expect(await screen.findByText('20 days left')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Upload a document' })).toHaveAttribute('href', '/caregiver/documents');
  });
});

describe("an employer's vacancies", () => {
  const account: EmployerAccount = {
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
  };

  it('posts a vacancy for review, with the salary as numbers in the chosen currency', async () => {
    const { default: NewVacancy } = await import('@/app/employer/(area)/vacancies/new/page');
    auth = { user: EMPLOYER, loading: false };
    route({ '/employer/me': account });
    post.mockResolvedValue({ ...vacancy(), id: 'v1', reference: 'VC-NEW123', status: 'PENDING_REVIEW' });
    renderUi(<NewVacancy />);
    fireEvent.change(await screen.findByLabelText(/job title/i), { target: { value: 'Care assistant' } });
    fireEvent.change(screen.getByLabelText(/care setting/i), { target: { value: 'NURSING_HOME' } });
    fireEvent.change(screen.getByLabelText(/about the job/i), { target: { value: 'Supporting older residents with daily care in a 60-bed home.' } });
    fireEvent.change(screen.getByLabelText('Salary from'), { target: { value: '2200' } });
    fireEvent.change(screen.getByLabelText('Salary up to'), { target: { value: '1800' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send for review' }));
    expect(await screen.findByText(/highest cannot be below the lowest/)).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Salary up to'), { target: { value: '2600' } });
    fireEvent.change(screen.getByLabelText('Currency'), { target: { value: 'JPY' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send for review' }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0]).toEqual([
      '/employer/vacancies',
      expect.objectContaining({ title: 'Care assistant', country: 'JP', careSetting: 'NURSING_HOME', salaryMin: 2200, salaryMax: 2600, salaryCurrency: 'JPY', salaryPeriod: 'MONTH' }),
    ]);
    expect(await screen.findByText(/VC-NEW123/)).toBeInTheDocument();
  });

  it('shows why a vacancy was sent back, and how many applied - never who', async () => {
    const { default: Vacancies } = await import('@/app/employer/(area)/vacancies/page');
    auth = { user: EMPLOYER, loading: false };
    const rejected: Vacancy = {
      ...vacancy(),
      id: 'v1',
      enquiryId: 'e1',
      enquiryReference: 'IE-7K2Q9M',
      status: 'REJECTED',
      reviewNote: 'Please remove the phone number from the description.',
      publishedAt: null,
      createdAt: '2026-10-20T08:00:00Z',
      updatedAt: '2026-10-20T08:00:00Z',
      applicationCount: 3,
    };
    route({ '/employer/me': account, '/employer/vacancies': [rejected] });
    renderUi(<Vacancies />);
    expect(await screen.findByText('Please remove the phone number from the description.')).toBeInTheDocument();
    expect(screen.getByText('Applications: 3')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /edit/i })).toHaveAttribute('href', '/employer/vacancies/v1');
  });
});

describe("an employer's placements and invoices", () => {
  it('shows each placement with its guarantee and invoices', async () => {
    const { default: Placements } = await import('@/app/employer/(area)/placements/page');
    auth = { user: EMPLOYER, loading: false };
    const placement: EmployerPlacement = {
      id: 'p1',
      enquiryReference: 'IE-7K2Q9M',
      talent: { firstName: 'Dilani', slug: null, photoUrl: null },
      country: 'JP',
      jobTitle: 'Care assistant',
      status: 'DEPLOYED',
      departureOn: '2026-11-01',
      arrivedOn: '2026-11-02',
      contractStartOn: '2026-11-02',
      contractEndsOn: '2028-11-02',
      guaranteeEndsOn: '2027-02-02',
      invoices: [{ id: 'i1', number: 'PF-2026-0001', status: 'ISSUED', currency: 'USD', amount: '2500.00', amountPaid: '0.00', balance: '2500.00', issueDate: '2026-11-02', dueDate: '2026-11-16', overdue: true }],
    };
    route({ '/employer/placements': [placement], '/employer/invoices': placement.invoices });
    renderUi(<Placements />);
    expect(await screen.findByText('Dilani')).toBeInTheDocument();
    expect(screen.getByText(/Free replacement if the placement ends before/)).toBeInTheDocument();
    const invoice = screen.getByRole('link', { name: /PF-2026-0001/ });
    expect(invoice).toHaveAttribute('href', '/employer/invoices/i1');
    expect(screen.getByText('Overdue')).toBeInTheDocument();
    expect(screen.queryByText('Other invoices')).not.toBeInTheDocument();
  });

  it('offers card payment only when the invoice allows it, and hands over to PayHere', async () => {
    const { default: InvoicePage } = await import('@/app/employer/(area)/invoices/[id]/page');
    auth = { user: EMPLOYER, loading: false };
    params = { id: 'i1' };
    const invoice: PlacementInvoice = {
      id: 'i1',
      number: 'PF-2026-0001',
      status: 'ISSUED',
      currency: 'USD',
      amount: '2500.00',
      amountPaid: '1000.00',
      balance: '1500.00',
      issueDate: '2026-11-02',
      dueDate: '2026-11-16',
      overdue: false,
      enquiryId: 'e1',
      enquiryReference: 'IE-7K2Q9M',
      placementId: 'p1',
      employerId: 'emp-1',
      description: 'Placement fee - Dilani',
      billToName: 'Sakura Care',
      billToEmail: 'aiko@example.jp',
      billToAddress: null,
      billToCountry: 'JP',
      seller: { name: 'CareLink', address: 'Colombo', phone: null, email: null, registrationNumber: 'PV 1234', taxRegistrationNumber: null },
      footer: 'Bank: Commercial Bank, A/C 1234',
      notes: null,
      voidReason: null,
      payments: [{ id: 'pay1', amount: '1000.00', method: 'BANK_TRANSFER', paidOn: '2026-11-05', reference: 'SWIFT 1', note: null, createdAt: '2026-11-05T08:00:00Z' }],
      payOnline: true,
      createdAt: '2026-11-02T08:00:00Z',
    };
    route({ '/employer/invoices/i1': invoice });
    post.mockResolvedValue({ action: 'https://sandbox.payhere.lk/pay/checkout', fields: { order_id: 'o1', amount: '1500.00', currency: 'USD' } });
    const submit = jest.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => {});
    renderUi(<InvoicePage />);
    expect(await screen.findByText('Placement fee - Dilani')).toBeInTheDocument();
    expect(screen.getByText('Bank: Commercial Bank, A/C 1234')).toBeInTheDocument();
    const article = screen.getByRole('article');
    expect(within(article).getByText(/Bank transfer · SWIFT 1/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /pay now/i }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/employer/invoices/i1/payhere'));
    await waitFor(() => expect(submit).toHaveBeenCalled());
    const form = document.body.querySelector('form[action="https://sandbox.payhere.lk/pay/checkout"]')!;
    expect((form.querySelector('input[name="amount"]') as HTMLInputElement).value).toBe('1500.00');
    submit.mockRestore();
  });
});
