import type { ReactElement } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SHARED_PROFILE_CONSENT_VERSION, type PublicTalentProfile, type SharedProfileSettings } from '@care-platform/shared';
import { I18nProvider } from '@/lib/i18n';
import { EmployerEnquiryForm } from '@/components/international/employer-enquiry-form';
import TalentProfilePage from '@/app/talent/[slug]/page';
import WorkAbroadSectionPage from '@/app/caregiver/(portal)/work-abroad/page';
import { SiteHeader } from '@/components/layout/site-header';

/**
 * The international paths as their visitors meet them: the employer enquiry,
 * a shared caregiver profile, and the caregiver's own Work abroad section.
 * The API is replaced by recorded calls, so each test can check exactly what
 * would be sent - and, as importantly, what would never be shown.
 */

const get = jest.fn();
const post = jest.fn();
const put = jest.fn();
const del = jest.fn();
const fetchBlob = jest.fn();
let params: Record<string, string> = {};

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
  usePathname: () => '/',
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
jest.mock('@/lib/api/auth-context', () => ({
  useAuth: () => ({ user: { userId: 'u1', email: 'n@example.com', role: 'CAREGIVER', caregiverId: 'cg-1' }, loading: false, logout: jest.fn() }),
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
  fetchBlob: (...a: unknown[]) => fetchBlob(...a),
}));

function renderUi(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider>{ui}</I18nProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  [get, post, put, del, fetchBlob].forEach((m) => m.mockReset());
  params = {};
  window.localStorage.clear();
});

describe('top navigation', () => {
  it('links overseas employers to their page from every public page', () => {
    renderUi(<SiteHeader />);
    const link = screen.getByRole('link', { name: /hire from sri lanka/i });
    expect(link).toHaveAttribute('href', '/international');
  });
});

describe('employer enquiry form', () => {
  function fill() {
    fireEvent.change(screen.getByLabelText(/organisation or family name/i), { target: { value: 'Sakura Care' } });
    fireEvent.change(screen.getByLabelText(/type of employer/i), { target: { value: 'CARE_HOME' } });
    fireEvent.change(screen.getByLabelText(/country where they will work/i), { target: { value: 'JP' } });
    fireEvent.change(screen.getByLabelText(/your name/i), { target: { value: 'Aiko Tanaka' } });
    fireEvent.change(screen.getByLabelText(/^email/i), { target: { value: 'aiko@example.jp' } });
    fireEvent.click(screen.getByRole('button', { name: 'Nursing home for the elderly' }));
    fireEvent.change(screen.getByLabelText(/number of caregivers/i), { target: { value: '3' } });
  }

  it('will not send without a care setting and the consent tick', async () => {
    renderUi(<EmployerEnquiryForm />);
    fireEvent.click(screen.getByRole('button', { name: /send enquiry/i }));
    expect(await screen.findByText('Choose at least one care setting.')).toBeInTheDocument();
    expect(screen.getByText('Please tick this so we can contact you.')).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it('sends the enquiry, about a shared profile when it came from one, and shows the reference', async () => {
    post.mockResolvedValue({ reference: 'IE-7K2Q9M' });
    renderUi(<EmployerEnquiryForm talent={{ slug: 'abcdefgh2345', firstName: 'Nadeesha' }} />);
    expect(screen.getByText('Enquiring about Nadeesha')).toBeInTheDocument();
    fill();
    fireEvent.click(screen.getByRole('checkbox', { name: /agree to be contacted/i }));
    fireEvent.click(screen.getByRole('button', { name: /send enquiry/i }));

    await waitFor(() => expect(post).toHaveBeenCalled());
    const [path, body] = post.mock.calls[0];
    expect(path).toBe('/public/international/enquiries');
    expect(body).toMatchObject({
      organisationName: 'Sakura Care',
      organisationType: 'CARE_HOME',
      country: 'JP',
      email: 'aiko@example.jp',
      rolesCount: 3,
      careSettings: ['NURSING_HOME'],
      talentSlug: 'abcdefgh2345',
      consent: true,
    });
    expect(body.website2).toBeUndefined();
    expect(await screen.findByText(/Your reference is IE-7K2Q9M/)).toBeInTheDocument();
  });
});

describe('shared talent profile', () => {
  const profile: PublicTalentProfile = {
    slug: 'abcdefgh2345',
    firstName: 'Nadeesha',
    headline: 'Home carer for older people',
    bio: 'Eight years with older people.',
    photoUrl: '/public/talent/abcdefgh2345/photo?v=1234abcd',
    approxAge: 41,
    yearsExperience: 8,
    verified: true,
    hasVerifiedQualification: true,
    careTypes: ['LIVE_IN'],
    languages: [{ name: 'English', proficiency: 'FLUENT' }],
    skills: ['Dementia care'],
    qualifications: ['Certificate in Caregiving'],
    completedTraining: ['English for caregivers'],
    targetCountries: ['JP'],
    availableFrom: '2027-01-01',
  };

  it('shows what the caregiver chose to share and routes contact through staff', async () => {
    params = { slug: 'abcdefgh2345' };
    get.mockResolvedValue(profile);
    renderUi(<TalentProfilePage />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Nadeesha' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Nadeesha' })).toHaveAttribute('src', expect.stringContaining('/public/talent/abcdefgh2345/photo'));
    expect(screen.getByText('English for caregivers')).toBeInTheDocument();
    expect(screen.getByText(/Not an accredited qualification/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ask about Nadeesha' })).toHaveAttribute('href', '/international?talent=abcdefgh2345#enquiry');
    // No way to reach the caregiver directly.
    expect(document.querySelector('a[href^="tel:"], a[href^="mailto:"], a[href*="wa.me"]')).toBeNull();
  });

  it('says plainly when a profile is no longer shared', async () => {
    params = { slug: 'oldlinkabcde' };
    const { ApiError } = jest.requireActual('@/lib/api/client');
    get.mockRejectedValue(new ApiError(404, 'Profile not found'));
    renderUi(<TalentProfilePage />);
    expect(await screen.findByText(/stopped sharing it/)).toBeInTheDocument();
  });
});

describe("caregiver's Work abroad section", () => {
  const draft: SharedProfileSettings = {
    slug: null,
    isShared: false,
    firstName: 'Nadeesha',
    headline: null,
    bio: null,
    hasPhoto: false,
    status: 'DRAFT',
    reviewNote: null,
    consentAcceptedAt: null,
    consentVersion: null,
    isLive: false,
  };

  function api(shared: SharedProfileSettings) {
    get.mockImplementation((path: string) => {
      if (path.endsWith('/overseas')) return Promise.resolve({ openToOverseas: false, targetCountries: [], passportHeld: null, passportExpiry: null, availableFrom: null });
      if (path === '/public/training') return Promise.resolve([]);
      if (path.endsWith('/training')) return Promise.resolve([]);
      if (path.endsWith('/shared-profile')) return Promise.resolve(shared);
      return Promise.reject(new Error(`unexpected ${path}`));
    });
  }

  it('asks for consent before sharing, and sends the version the caregiver was shown', async () => {
    api(draft);
    post.mockResolvedValue({ ...draft, isShared: true, status: 'PENDING_REVIEW', slug: 'abcdefgh2345', consentAcceptedAt: '2026-10-26T09:00:00Z', consentVersion: SHARED_PROFILE_CONSENT_VERSION });
    renderUi(<WorkAbroadSectionPage />);

    const share = await screen.findByRole('button', { name: 'Share my profile' });
    expect(share).toBeDisabled();
    expect(screen.getByText(/surname, phone number, email, address, NIC, passport number and documents will never be shown/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: /agree to share my profile/i }));
    expect(share).toBeEnabled();
    fireEvent.click(share);

    await waitFor(() => expect(post).toHaveBeenCalledWith('/caregivers/cg-1/shared-profile/share', { consent: true, consentVersion: SHARED_PROFILE_CONSENT_VERSION }));
    expect(await screen.findByText('Waiting for review')).toBeInTheDocument();
  });

  it("shows staff's note when changes were asked for", async () => {
    api({ ...draft, status: 'REJECTED', reviewNote: 'Please use a clearer photo.', consentAcceptedAt: '2026-10-20T00:00:00Z', consentVersion: SHARED_PROFILE_CONSENT_VERSION, slug: 'abcdefgh2345' });
    renderUi(<WorkAbroadSectionPage />);
    const banner = await screen.findByText('Changes needed');
    expect(within(banner.closest('[role="status"]') as HTMLElement).getByText('Please use a clearer photo.')).toBeInTheDocument();
  });

  it('saves where the caregiver wants to work, without ever asking for a passport number', async () => {
    api(draft);
    put.mockImplementation((_p: string, body: unknown) => Promise.resolve(body));
    renderUi(<WorkAbroadSectionPage />);
    fireEvent.click(await screen.findByRole('checkbox', { name: /interested in working abroad/i }));
    fireEvent.change(screen.getByLabelText(/countries i would like to work in/i), { target: { value: 'JP' } });
    fireEvent.change(screen.getByLabelText(/do you have a passport/i), { target: { value: 'yes' } });
    fireEvent.change(screen.getByLabelText(/passport expiry date/i), { target: { value: '2030-05-01' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[0]);

    await waitFor(() =>
      expect(put).toHaveBeenCalledWith('/caregivers/cg-1/overseas', {
        openToOverseas: true,
        targetCountries: ['JP'],
        passportHeld: true,
        passportExpiry: '2030-05-01',
        availableFrom: null,
      }),
    );
    expect(screen.queryByLabelText(/passport number/i)).not.toBeInTheDocument();
  });
});
