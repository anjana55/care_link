import type { ReactElement } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PortalLayout from '@/app/caregiver/(portal)/layout';
import DashboardPage from '@/app/caregiver/(portal)/dashboard/page';
import ShiftsPage from '@/app/caregiver/(portal)/shifts/page';
import DocumentsPage from '@/app/caregiver/(portal)/documents/page';
import ProfilePage from '@/app/caregiver/(portal)/profile/page';
import { I18nProvider } from '@/lib/i18n';
import { LanguageSwitcher } from '@/components/common/language-switcher';
import en from '@/lib/i18n/dictionaries/en.json';
import si from '@/lib/i18n/dictionaries/si.json';
import ta from '@/lib/i18n/dictionaries/ta.json';

/**
 * The signed-in caregiver's area: who may see it, and what each page does with
 * the API. The API is replaced by recorded calls, so each test can say exactly
 * what was sent - which is the part that matters, because the server's own rules
 * are covered by its end-to-end suite.
 */

const get = jest.fn();
const post = jest.fn();
const put = jest.fn();
const patch = jest.fn();
const del = jest.fn();
const fetchBlob = jest.fn();
const replace = jest.fn();
let pathname = '/caregiver/dashboard';
let auth: { user: unknown; loading: boolean } = { user: null, loading: false };
const logout = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: jest.fn() }),
  usePathname: () => pathname,
}));
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
jest.mock('@/lib/api/auth-context', () => ({ useAuth: () => ({ ...auth, logout }) }));
jest.mock('@/lib/api/client', () => ({
  ...jest.requireActual('@/lib/api/client'),
  api: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
    put: (...a: unknown[]) => put(...a),
    patch: (...a: unknown[]) => patch(...a),
    delete: (...a: unknown[]) => del(...a),
  },
  fetchBlob: (...a: unknown[]) => fetchBlob(...a),
}));

const CAREGIVER_USER = { userId: 'u1', email: 'nimal@example.com', role: 'CAREGIVER', caregiverId: 'cg-1' };

const caregiver = (over: Record<string, unknown> = {}) => ({
  id: 'cg-1',
  registrationNumber: 'CG-2026-0001',
  status: 'DRAFT',
  fullName: 'Nimal Perera',
  permanentAddress: '12 Temple Road, Colombo',
  nic: '199012345678',
  passportNumber: null,
  dateOfBirth: '1990-04-12T00:00:00.000Z',
  gender: 'MALE',
  civilStatus: 'SINGLE',
  heightIn: null,
  weightKg: null,
  primaryPhone: '0771234567',
  secondaryPhone: null,
  emergencyContactName: 'Sunil Perera',
  emergencyContactNumber: '0771111111',
  emergencyContactRelationship: 'Brother',
  policeDivision: null,
  policeStation: null,
  districtId: 1,
  cityId: 10,
  skills: [],
  languages: [],
  documents: [],
  ...over,
});

const doc = (over: Record<string, unknown> = {}) => ({
  id: 'd1',
  documentType: 'NIC',
  originalFilename: 'nic.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 20480,
  verificationStatus: 'PENDING',
  verifiedAt: null,
  createdAt: '2026-10-01T10:00:00.000Z',
  ...over,
});

const TREE = [{ id: 1, name: 'Western Province', districts: [{ id: 1, name: 'Colombo' }, { id: 2, name: 'Gampaha' }] }];

/** What the API would answer; a test overrides only the parts it cares about. */
function serve(data: Partial<Record<'caregiver' | 'documents' | 'availability' | 'qualifications' | 'experiences', unknown>> = {}) {
  const state = { caregiver: caregiver(), documents: [], availability: null, qualifications: [], experiences: [], ...data };
  get.mockImplementation((path: string) => {
    if (path === '/caregivers/cg-1') return Promise.resolve(state.caregiver);
    if (path === '/caregivers/cg-1/documents') return Promise.resolve(state.documents);
    if (path === '/caregivers/cg-1/availability') return Promise.resolve(state.availability);
    if (path === '/caregivers/cg-1/qualifications') return Promise.resolve(state.qualifications);
    if (path === '/caregivers/cg-1/experiences') return Promise.resolve(state.experiences);
    if (path === '/skills') return Promise.resolve([{ id: 's1', name: 'Dementia care' }, { id: 's2', name: 'Wound dressing' }]);
    if (path === '/languages') return Promise.resolve([{ id: 'l1', name: 'Sinhala' }, { id: 'l2', name: 'English' }]);
    if (path.startsWith('/public/meta/locations/tree')) return Promise.resolve(TREE);
    if (path.includes('/cities')) return Promise.resolve([{ id: 10, name: 'Colombo 03', subName: 'Modara', postcode: '00300' }]);
    return Promise.resolve(null);
  });
}

function renderPage(node: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider>{node}</I18nProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  // The language choice is remembered between renders, so a test that switches
  // to Tamil must not leave the next one reading Tamil.
  window.localStorage.removeItem('care-platform-public-locale');
  [get, post, put, patch, del, fetchBlob, replace, logout].forEach((m) => m.mockReset());
  pathname = '/caregiver/dashboard';
  auth = { user: CAREGIVER_USER, loading: false };
  post.mockResolvedValue({});
  put.mockResolvedValue({});
  patch.mockResolvedValue(caregiver());
  del.mockResolvedValue({ success: true });
  serve();
});

describe('who may see the area', () => {
  it('sends an anonymous visitor to sign in, without flashing the page', async () => {
    auth = { user: null, loading: false };
    renderPage(<PortalLayout><p>secret page</p></PortalLayout>);

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/caregiver/login'));
    expect(screen.queryByText('secret page')).toBeNull();
  });

  it('sends a signed-in patient home - this area is for caregivers', async () => {
    auth = { user: { userId: 'p1', email: 'p@example.com', role: 'PATIENT_GUARDIAN' }, loading: false };
    renderPage(<PortalLayout><p>secret page</p></PortalLayout>);

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'));
    expect(screen.queryByText('secret page')).toBeNull();
  });

  it('waits while the session is still being read instead of redirecting', () => {
    auth = { user: null, loading: true };
    renderPage(<PortalLayout><p>secret page</p></PortalLayout>);

    expect(replace).not.toHaveBeenCalled();
  });

  it('shows a caregiver the four sections and marks the current one', () => {
    pathname = '/caregiver/documents';
    renderPage(<PortalLayout><p>inside</p></PortalLayout>);

    const nav = screen.getByRole('navigation');
    expect(within(nav).getAllByRole('link').map((l) => l.getAttribute('href'))).toEqual([
      '/caregiver/dashboard', '/caregiver/profile', '/caregiver/documents', '/caregiver/shifts',
    ]);
    expect(within(nav).getByRole('link', { name: 'Documents' }).getAttribute('aria-current')).toBe('page');
    expect(within(nav).getByRole('link', { name: 'Profile' }).getAttribute('aria-current')).toBeNull();
    expect(screen.getByText('inside')).toBeDefined();
  });

  it('lets the caregiver switch language, and the whole area follows', () => {
    pathname = '/caregiver/profile';
    renderPage(<PortalLayout><p>inside</p></PortalLayout>);
    const nav = () => within(screen.getByRole('navigation'));

    expect(nav().getByRole('link', { name: en.portal.nav.documents })).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'සිං' }));
    expect(nav().getAllByRole('link').map((l) => l.textContent)).toEqual([
      si.portal.nav.overview, si.portal.nav.profile, si.portal.nav.documents, si.portal.nav.shifts,
    ]);
    expect(screen.getByRole('button', { name: si.caregiverDashboard.signOut })).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'த' }));
    expect(nav().getByRole('link', { name: ta.portal.nav.shifts })).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'EN' }));
    expect(nav().getByRole('link', { name: en.portal.nav.shifts })).toBeDefined();
  });

  it('signs out and returns to the sign-in page', () => {
    const assign = jest.fn();
    Object.defineProperty(window, 'location', { value: { assign }, writable: true });
    renderPage(<PortalLayout><p>inside</p></PortalLayout>);

    fireEvent.click(screen.getByRole('button', { name: /sign out/i }));

    expect(logout).toHaveBeenCalled();
    expect(assign).toHaveBeenCalledWith('/caregiver/login');
  });
});

describe('overview', () => {
  it('greets the caregiver and says where the registration stands', async () => {
    renderPage(<DashboardPage />);

    expect(await screen.findByRole('heading', { name: 'Nimal Perera' })).toBeDefined();
    expect(screen.getByText('Draft')).toBeDefined();
    expect(screen.getByText(/CG-2026-0001/)).toBeDefined();
    expect(screen.getByText(/not submitted yet/i)).toBeDefined();
  });

  it('keeps submit disabled until skills, a document and shifts are all in place', async () => {
    renderPage(<DashboardPage />);

    const submit = await screen.findByRole('button', { name: /submit for review/i });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getAllByRole('link', { name: /start/i })).toHaveLength(3);
  });

  it('submits the registration once everything is done, then stops offering to', async () => {
    serve({
      caregiver: caregiver({ skills: [{ skillId: 's1', name: 'x' }], languages: [{ languageId: 'l1', name: 'y' }] }),
      documents: [doc()],
      availability: { id: 'a1', dayDuty: true, nightDuty: false, liveIn24h: false, preferredShift: 'DAY' },
    });
    renderPage(<DashboardPage />);

    const submit = await screen.findByRole('button', { name: /submit for review/i });
    await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(submit);

    await waitFor(() => expect(patch).toHaveBeenCalledWith('/caregivers/cg-1/status', { status: 'REGISTERED' }));
  });

  it('offers no submit button once the registration has been submitted', async () => {
    serve({ caregiver: caregiver({ status: 'UNDER_VERIFICATION' }) });
    renderPage(<DashboardPage />);

    expect(await screen.findByText('Being verified')).toBeDefined();
    expect(screen.queryByRole('button', { name: /submit for review/i })).toBeNull();
  });

  it('says so, rather than showing a blank page, when the record cannot be loaded', async () => {
    get.mockRejectedValue(new Error('boom'));
    renderPage(<DashboardPage />);

    expect(await screen.findByRole('alert')).toBeDefined();
  });
});

describe('shifts', () => {
  it('shows what is saved', async () => {
    serve({
      availability: {
        id: 'a1', dayDuty: true, nightDuty: false, liveIn24h: true, preferredShift: 'NIGHT',
        availableFrom: '2026-11-01T00:00:00.000Z', expectedDailyRate: '6500.00', expectedMonthlyRate: null,
        expectedLeaveDays: 4, preferredLeavePattern: 'Weekends',
      },
    });
    renderPage(<ShiftsPage />);

    await waitFor(() => expect((screen.getByLabelText('Day shifts', { exact: false }) as HTMLInputElement).checked).toBe(true));
    expect((screen.getByLabelText(/Night shifts/) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText(/24-hour live-in/) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('Preferred shift') as HTMLSelectElement).value).toBe('NIGHT');
    expect((screen.getByLabelText('Available from') as HTMLInputElement).value).toBe('2026-11-01');
    expect((screen.getByLabelText(/Expected daily rate/) as HTMLInputElement).value).toBe('6500.00');
    expect((screen.getByLabelText(/Leave days/) as HTMLInputElement).value).toBe('4');
  });

  it('warns that nobody can find a caregiver with no shift selected', async () => {
    renderPage(<ShiftsPage />);

    expect(await screen.findByText(/no shift is selected/i)).toBeDefined();
    fireEvent.click(screen.getByLabelText(/Day shifts/));
    await waitFor(() => expect(screen.queryByText(/no shift is selected/i)).toBeNull());
  });

  it('saves with PUT and leaves out the fields that were not filled in', async () => {
    renderPage(<ShiftsPage />);
    fireEvent.click(await screen.findByLabelText(/Day shifts/));
    fireEvent.change(screen.getByLabelText('Preferred shift'), { target: { value: 'DAY' } });
    fireEvent.change(screen.getByLabelText(/Expected daily rate/), { target: { value: '7000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put).toHaveBeenCalledWith('/caregivers/cg-1/availability', {
      dayDuty: true, nightDuty: false, liveIn24h: false, preferredShift: 'DAY', expectedDailyRate: '7000',
    });
    expect(await screen.findByText('Saved')).toBeDefined();
  });

  it('refuses an amount or day count the API would reject, without sending anything', async () => {
    renderPage(<ShiftsPage />);
    fireEvent.change(await screen.findByLabelText(/Expected daily rate/), { target: { value: 'lots' } });
    fireEvent.change(screen.getByLabelText(/Leave days/), { target: { value: '2.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText(/digits only/i)).toBeDefined();
    expect(screen.getByText(/whole number of days/i)).toBeDefined();
    expect(put).not.toHaveBeenCalled();
  });

  it('shows the server\'s reason when a save fails', async () => {
    put.mockRejectedValue(Object.assign(new (jest.requireActual('@/lib/api/client').ApiError)(400, 'Available from is not a valid date')));
    renderPage(<ShiftsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Available from is not a valid date');
  });
});

describe('documents', () => {
  const file = (name: string, size = 1000, type = 'application/pdf') => {
    const f = new File(['x'], name, { type });
    Object.defineProperty(f, 'size', { value: size });
    return f;
  };
  const pick = (f: File) => fireEvent.change(screen.getByLabelText('File'), { target: { files: [f] } });

  it('lists each document with where it stands, and only lets unchecked ones be removed', async () => {
    serve({
      documents: [
        doc({ id: 'd1', documentType: 'NIC', verificationStatus: 'PENDING' }),
        doc({ id: 'd2', documentType: 'POLICE_CLEARANCE', originalFilename: 'police.pdf', verificationStatus: 'VERIFIED' }),
        doc({ id: 'd3', documentType: 'CV', originalFilename: 'cv.pdf', verificationStatus: 'REJECTED' }),
        doc({ id: 'd4', documentType: 'OTHER', originalFilename: 'other.pdf', verificationStatus: 'IN_PROGRESS' }),
      ],
    });
    renderPage(<DocumentsPage />);

    await screen.findByText('police.pdf');
    expect(screen.getByText('Verified')).toBeDefined();
    expect(screen.getByText('Rejected')).toBeDefined();
    expect(screen.getByText(/was not accepted/i)).toBeDefined();
    // Remove is offered for pending and rejected only.
    expect(screen.getAllByRole('button', { name: /^Remove/ })).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /Remove police\.pdf/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Remove other\.pdf/ })).toBeNull();
  });

  it('shows which of the documents staff need are still missing', async () => {
    serve({ documents: [doc({ documentType: 'PASSPORT' })] });
    renderPage(<DocumentsPage />);
    await screen.findAllByText(/nic\.pdf/); // the list has loaded

    // The checklist, not the picker: the same names appear in both.
    const checklist = within(screen.getByText('What we need').closest('section')!);
    const identity = checklist.getByText(/Proof of identity/).closest('li')!;
    expect(within(identity).getByText('Uploaded')).toBeDefined();
    const police = checklist.getByText(/Police clearance report/).closest('li')!;
    expect(within(police).getByText('Not uploaded yet')).toBeDefined();
  });

  it('uploads the chosen file with its type as multipart form data', async () => {
    renderPage(<DocumentsPage />);
    await screen.findByText(/have not uploaded anything/i);

    fireEvent.change(screen.getByLabelText('Document type'), { target: { value: 'police' } });
    pick(file('police.pdf'));
    fireEvent.click(screen.getByRole('button', { name: 'Upload' }));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    const [path, body] = post.mock.calls[0];
    expect(path).toBe('/caregivers/cg-1/documents');
    expect(body).toBeInstanceOf(FormData);
    expect((body as FormData).get('documentType')).toBe('POLICE_CLEARANCE');
    expect(((body as FormData).get('file') as File).name).toBe('police.pdf');
    expect(await screen.findByText('Document uploaded.')).toBeDefined();
  });

  it('turns away the wrong file type or an oversized file before sending anything', async () => {
    renderPage(<DocumentsPage />);
    await screen.findByText(/have not uploaded anything/i);

    pick(file('virus.exe', 100, 'application/x-msdownload'));
    expect(await screen.findByText(/not supported/i)).toBeDefined();
    pick(file('scan.pdf', 11 * 1024 * 1024));
    expect(await screen.findByText(/larger than 10 MB/i)).toBeDefined();

    expect((screen.getByRole('button', { name: 'Upload' }) as HTMLButtonElement).disabled).toBe(true);
    expect(post).not.toHaveBeenCalled();
  });

  describe('choosing what is being uploaded', () => {
    const optionsOf = (select: HTMLElement) => within(select).getAllByRole('option').map((o) => o.textContent);

    it('offers exactly proof of identity, police clearance, Grama Niladhari certificate and Other', async () => {
      renderPage(<DocumentsPage />);
      await screen.findByText(/have not uploaded anything/i);

      expect(optionsOf(screen.getByLabelText('Document type'))).toEqual([
        'Proof of identity (NIC or passport)',
        'Police clearance report',
        'Grama Niladhari certificate',
        'Other',
      ]);
    });

    const uploadAs = async (choose: (() => void) | null, expected: string) => {
      renderPage(<DocumentsPage />);
      await screen.findByText(/have not uploaded anything/i);
      choose?.();
      pick(file('scan.pdf'));
      fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
      await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
      expect((post.mock.calls[0][1] as FormData).get('documentType')).toBe(expected);
    };
    const choosing = (value: string) => () => fireEvent.change(screen.getByLabelText('Document type'), { target: { value } });

    it('files proof of identity as an NIC unless the caregiver says it is a passport', async () => {
      await uploadAs(null, 'NIC');
    });

    it('asks which ID it is, and files a passport as a passport', async () => {
      await uploadAs(() => fireEvent.change(screen.getByLabelText('Which ID is it?'), { target: { value: 'PASSPORT' } }), 'PASSPORT');
    });

    it('files each of the other choices under its own type', async () => {
      await uploadAs(choosing('police'), 'POLICE_CLEARANCE');
    });

    it('files a Grama Niladhari certificate under its own type', async () => {
      await uploadAs(choosing('gn'), 'GRAMA_NILADHARI_CERTIFICATE');
    });

    it('files Other as other', async () => {
      await uploadAs(choosing('other'), 'OTHER');
    });

    it('shows the ID-kind pick only for proof of identity', async () => {
      renderPage(<DocumentsPage />);
      await screen.findByText(/have not uploaded anything/i);

      expect(screen.getByLabelText('Which ID is it?')).toBeDefined();
      for (const value of ['police', 'gn', 'other']) {
        fireEvent.change(screen.getByLabelText('Document type'), { target: { value } });
        expect(screen.queryByLabelText('Which ID is it?')).toBeNull();
      }
    });

    it('still names documents of types the picker no longer offers, such as ones staff attached', async () => {
      serve({ documents: [doc({ id: 'd9', documentType: 'CAREGIVER_CERTIFICATE', originalFilename: 'cert.pdf' })] });
      renderPage(<DocumentsPage />);

      await screen.findAllByText(/cert\.pdf/);
      expect(screen.getAllByText('Caregiver certificate').length).toBeGreaterThan(0);
    });

    describe.each([
      ['en', en, 'සිං', false],
      ['si', si, 'සිං', true],
      ['ta', ta, 'த', true],
    ] as const)('in %s', (code, dict, switchLabel, needsSwitch) => {
      it('shows the picker, the ID-kind pick and the document names in that language', async () => {
        renderPage(<><LanguageSwitcher /><DocumentsPage /></>);
        await screen.findByText(/have not uploaded anything/i);
        if (needsSwitch) fireEvent.click(screen.getByRole('button', { name: switchLabel }));

        const docs = (dict as typeof en).portal.documents;
        const picker = await screen.findByLabelText(docs.type);
        expect(optionsOf(picker)).toEqual([docs.pick.identity, docs.pick.police, docs.pick.gn, docs.pick.other]);

        const kind = screen.getByLabelText(docs.idKind);
        expect(optionsOf(kind)).toEqual([docs.idKinds.NIC, docs.idKinds.PASSPORT]);
        // And it is genuinely translated, not English left in place.
        if (code !== 'en') {
          expect(docs.pick.other).not.toBe(en.portal.documents.pick.other);
          expect(docs.pick.police).not.toBe(en.portal.documents.pick.police);
        }
      });
    });
  });

  it('shows the server\'s reason when it rejects the upload', async () => {
    post.mockRejectedValue(new (jest.requireActual('@/lib/api/client').ApiError)(400, 'The file content does not match its type.'));
    renderPage(<DocumentsPage />);
    await screen.findByText(/have not uploaded anything/i);

    pick(file('fake.pdf'));
    fireEvent.click(screen.getByRole('button', { name: 'Upload' }));

    expect(await screen.findByText(/does not match its type/i)).toBeDefined();
  });

  it('removes a document only after confirmation', async () => {
    serve({ documents: [doc()] });
    const confirm = jest.spyOn(window, 'confirm');
    renderPage(<DocumentsPage />);
    const remove = await screen.findByRole('button', { name: /Remove nic\.pdf/ });

    confirm.mockReturnValueOnce(false);
    fireEvent.click(remove);
    expect(del).not.toHaveBeenCalled();

    confirm.mockReturnValueOnce(true);
    fireEvent.click(remove);
    await waitFor(() => expect(del).toHaveBeenCalledWith('/caregivers/cg-1/documents/d1'));
    confirm.mockRestore();
  });

  it('opens a file through the authenticated fetch, not a bare link', async () => {
    serve({ documents: [doc()] });
    fetchBlob.mockResolvedValue(new Blob(['pdf']));
    const open = jest.fn();
    window.open = open;
    URL.createObjectURL = jest.fn(() => 'blob:abc');
    URL.revokeObjectURL = jest.fn();
    renderPage(<DocumentsPage />);

    fireEvent.click(await screen.findByRole('button', { name: /View nic\.pdf/ }));

    await waitFor(() => expect(open).toHaveBeenCalledWith('blob:abc', '_blank', 'noopener'));
    expect(fetchBlob).toHaveBeenCalledWith('/caregivers/cg-1/documents/d1/file');
  });
});

describe('profile', () => {
  const settled = async () => {
    await screen.findByText('Personal details');
    await waitFor(() => expect((screen.getByLabelText(/^District/) as HTMLSelectElement).value).toBe('1'));
  };

  it('fills the form from the saved record and shows the login number as fixed', async () => {
    renderPage(<ProfilePage />);
    await settled();

    expect((screen.getByLabelText(/Full name/) as HTMLInputElement).value).toBe('Nimal Perera');
    expect((screen.getByLabelText(/Date of birth/) as HTMLInputElement).value).toBe('1990-04-12');
    expect(screen.getByText('0771234567')).toBeDefined();
    // The login number is shown, not offered as an input.
    expect(screen.queryByLabelText(/Primary phone/i)).toBeNull();
    expect(screen.queryByText(/identity details are locked/i)).toBeNull();
  });

  it('saves changed details through the profile endpoint, never the staff one', async () => {
    renderPage(<ProfilePage />);
    await settled();

    const save = screen.getAllByRole('button', { name: 'Save' })[0] as HTMLButtonElement;
    expect(save.disabled).toBe(true); // nothing changed yet
    fireEvent.change(screen.getByLabelText(/Permanent address/), { target: { value: '99 New Road, Kandy' } });
    await waitFor(() => expect(save.disabled).toBe(false));
    fireEvent.click(save);

    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    const [path, body] = patch.mock.calls[0];
    expect(path).toBe('/caregivers/cg-1/profile');
    expect(body).toMatchObject({ permanentAddress: '99 New Road, Kandy', fullName: 'Nimal Perera' });
    // Never the login number or anything about status.
    expect(body).not.toHaveProperty('primaryPhone');
    expect(body).not.toHaveProperty('status');
    expect(await screen.findByText('Saved')).toBeDefined();
  });

  it('validates before sending, with the same messages as the registration form', async () => {
    renderPage(<ProfilePage />);
    await settled();

    fireEvent.change(screen.getByLabelText(/Permanent address/), { target: { value: 'x' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[0]);

    expect(await screen.findByText(/address of at least 5 characters/i)).toBeDefined();
    expect(patch).not.toHaveBeenCalled();
  });

  it('shows the identity details as fixed, and does not send them, once verification has started', async () => {
    serve({ caregiver: caregiver({ status: 'UNDER_VERIFICATION' }) });
    renderPage(<ProfilePage />);
    await screen.findByText(/identity details are locked|name, date of birth, gender and ID numbers are locked/i);

    expect(screen.queryByLabelText(/Full name/)).toBeNull();
    expect(screen.queryByLabelText(/Date of birth/)).toBeNull();
    expect(screen.getByText('Nimal Perera')).toBeDefined();
    // Contact details are still editable.
    await waitFor(() => expect(screen.getByLabelText(/Permanent address/)).toBeDefined());

    fireEvent.change(screen.getByLabelText(/Permanent address/), { target: { value: '5 Moved Lane, Galle' } });
    await waitFor(() => expect((screen.getAllByRole('button', { name: 'Save' })[0] as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[0]);

    await waitFor(() => expect(patch).toHaveBeenCalled());
    const body = patch.mock.calls[0][1];
    for (const identity of ['fullName', 'dateOfBirth', 'gender', 'nic', 'passportNumber']) {
      expect(body).not.toHaveProperty(identity);
    }
  });

  it('shows the server\'s reason when a save is refused', async () => {
    patch.mockRejectedValue(new (jest.requireActual('@/lib/api/client').ApiError)(403, 'Your identity details are locked'));
    renderPage(<ProfilePage />);
    await settled();

    fireEvent.change(screen.getByLabelText(/Permanent address/), { target: { value: '99 New Road, Kandy' } });
    await waitFor(() => expect((screen.getAllByRole('button', { name: 'Save' })[0] as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[0]);

    expect(await screen.findByText('Your identity details are locked')).toBeDefined();
  });

  describe('skills and languages', () => {
    it('ticks what the caregiver already has and saves each change at once', async () => {
      serve({ caregiver: caregiver({ skills: [{ skillId: 's1', name: 'Dementia care' }] }) });
      renderPage(<ProfilePage />);

      const dementia = (await screen.findByLabelText('Dementia care')) as HTMLInputElement;
      expect(dementia.checked).toBe(true);
      expect((screen.getByLabelText('Wound dressing') as HTMLInputElement).checked).toBe(false);

      fireEvent.click(screen.getByLabelText('Wound dressing'));
      await waitFor(() => expect(post).toHaveBeenCalledWith('/caregivers/cg-1/skills', { skillId: 's2' }));

      fireEvent.click(dementia);
      await waitFor(() => expect(del).toHaveBeenCalledWith('/caregivers/cg-1/skills/s1'));

      fireEvent.click(screen.getByLabelText('Sinhala'));
      await waitFor(() => expect(post).toHaveBeenCalledWith('/caregivers/cg-1/languages', { languageId: 'l1' }));
    });
  });

  describe('qualifications and experience', () => {
    const qualification = (over: Record<string, unknown> = {}) => ({
      id: 'q1', name: 'NVQ Level 3', type: 'NVQ', institution: 'VTA', certificateNumber: null,
      issueDate: null, expiryDate: null, verificationStatus: 'PENDING', ...over,
    });

    it('adds a qualification, asking only for what the API requires', async () => {
      renderPage(<ProfilePage />);
      fireEvent.click(await screen.findByRole('button', { name: 'Add a qualification' }));
      const section = within(screen.getByRole('region', { name: 'Qualifications' }));

      fireEvent.click(section.getByRole('button', { name: 'Save' }));
      expect((await screen.findAllByText(/this field is required/i)).length).toBeGreaterThanOrEqual(2);
      expect(post).not.toHaveBeenCalled();

      fireEvent.change(screen.getByRole('textbox', { name: /^Qualification/ }), { target: { value: 'NVQ Level 3' } });
      fireEvent.change(screen.getByLabelText(/^Institution/), { target: { value: 'VTA' } });
      fireEvent.click(section.getByRole('button', { name: 'Save' }));

      await waitFor(() => expect(post).toHaveBeenCalledWith('/caregivers/cg-1/qualifications', { name: 'NVQ Level 3', type: 'NVQ', institution: 'VTA' }));
    });

    it('lets an unchecked entry be removed but not a verified one', async () => {
      serve({
        qualifications: [
          qualification({ id: 'q1', name: 'First aid', verificationStatus: 'PENDING' }),
          qualification({ id: 'q2', name: 'Diploma in elder care', verificationStatus: 'VERIFIED' }),
        ],
      });
      renderPage(<ProfilePage />);

      await screen.findAllByText('Diploma in elder care');
      expect(screen.getByRole('button', { name: /Remove First aid/ })).toBeDefined();
      expect(screen.queryByRole('button', { name: /Remove Diploma in elder care/ })).toBeNull();
    });

    it('warns before a verified entry is edited, and sends the change as a patch', async () => {
      serve({ qualifications: [qualification({ verificationStatus: 'VERIFIED' })] });
      renderPage(<ProfilePage />);

      fireEvent.click(await screen.findByRole('button', { name: /Edit NVQ Level 3/ }));
      expect(screen.getByText(/sends it back to staff to be checked again/i)).toBeDefined();

      fireEvent.change(screen.getByLabelText(/^Institution/), { target: { value: 'Another Institute' } });
      fireEvent.click(within(screen.getByRole('region', { name: 'Qualifications' })).getByRole('button', { name: 'Save' }));

      await waitFor(() => expect(patch).toHaveBeenCalledWith('/caregivers/cg-1/qualifications/q1', expect.objectContaining({ institution: 'Another Institute' })));
    });

    it('adds work experience', async () => {
      renderPage(<ProfilePage />);
      fireEvent.click(await screen.findByRole('button', { name: 'Add experience' }));

      fireEvent.change(screen.getByLabelText(/^Employer or client/), { target: { value: 'Private household' } });
      fireEvent.change(screen.getByLabelText(/^Role/), { target: { value: 'Elder care' } });
      fireEvent.change(screen.getByLabelText(/^Country/), { target: { value: 'Sri Lanka' } });
      fireEvent.change(screen.getByLabelText(/^Started/), { target: { value: '2022-01-01' } });
      fireEvent.click(within(screen.getByRole('region', { name: 'Work experience' })).getByRole('button', { name: 'Save' }));

      await waitFor(() =>
        expect(post).toHaveBeenCalledWith('/caregivers/cg-1/experiences', {
          employerOrClient: 'Private household', role: 'Elder care', country: 'Sri Lanka', startDate: '2022-01-01',
        }),
      );
    });

    it('shows the server\'s reason when an entry is refused', async () => {
      post.mockRejectedValue(new (jest.requireActual('@/lib/api/client').ApiError)(400, 'name must be a string'));
      renderPage(<ProfilePage />);
      fireEvent.click(await screen.findByRole('button', { name: 'Add a qualification' }));
      fireEvent.change(screen.getByRole('textbox', { name: /^Qualification/ }), { target: { value: 'x' } });
      fireEvent.change(screen.getByLabelText(/^Institution/), { target: { value: 'y' } });
      fireEvent.click(within(screen.getByRole('region', { name: 'Qualifications' })).getByRole('button', { name: 'Save' }));

      expect(await screen.findByText('name must be a string')).toBeDefined();
    });
  });
});

describe('every page speaks the chosen language', () => {
  type Dict = typeof en;
  // One string that only appears once the page has loaded, per page.
  const pages: [string, ReactElement, (d: Dict) => string][] = [
    ['overview', <DashboardPage key="o" />, (d) => d.portal.checklist.title],
    ['profile', <ProfilePage key="p" />, (d) => d.portal.profile.title],
    ['documents', <DocumentsPage key="d" />, (d) => d.portal.documents.title],
    ['shifts', <ShiftsPage key="s" />, (d) => d.portal.shifts.title],
  ];

  describe.each(pages)('%s', (_name, page, heading) => {
    it.each([['සිං', si], ['த', ta]] as const)('shows its translated heading and no raw keys (%s)', async (label, dict) => {
      renderPage(<><LanguageSwitcher />{page}</>);
      fireEvent.click(screen.getByRole('button', { name: label }));

      expect(await screen.findByText(heading(dict as Dict))).toBeDefined();
      // A raw key on screen means a string was used that no dictionary defines.
      expect(document.body.textContent).not.toMatch(/\b(portal|common|caregiverDashboard|personalInfo)\.[a-zA-Z]+/);
      // And it really is not the English heading left in place.
      expect(heading(dict as Dict)).not.toBe(heading(en));
    });
  });
});
