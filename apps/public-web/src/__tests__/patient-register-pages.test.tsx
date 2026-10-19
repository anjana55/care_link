import type { ReactElement } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import RegisterPage from '@/app/register/page';
import RegisterWhatsappPage from '@/app/register/whatsapp/page';
import { I18nProvider } from '@/lib/i18n';

const get = jest.fn();
const post = jest.fn();

jest.mock('@/lib/api/auth-context', () => ({ useAuth: () => ({ user: null, logout: jest.fn(), applyTokens: jest.fn() }) }));
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn() }) }));
jest.mock('@/lib/api/client', () => ({
  ...jest.requireActual('@/lib/api/client'),
  api: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a) },
}));

const config = {
  enabled: true,
  caregiver: { register: true, login: true, recovery: true },
  customer: { register: true, login: true, recovery: true },
  otpLength: 6,
};
const TREE = [{ id: 1, name: 'Western Province', districts: [{ id: 1, name: 'Colombo' }] }];
const CITIES = [{ id: 340, name: 'Dehiwala', subName: null, postcode: '10350', latitude: 6.85, longitude: 79.86 }];

function renderPage(node: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider>{node}</I18nProvider>
    </QueryClientProvider>,
  );
}

const change = (label: RegExp | string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  get.mockImplementation((path: string) => {
    if (path === '/auth/whatsapp/config') return Promise.resolve(config);
    if (path.startsWith('/public/meta/locations/tree')) return Promise.resolve(TREE);
    if (path.startsWith('/public/meta/locations/cities')) return Promise.resolve(CITIES);
    return Promise.resolve(null);
  });
});

describe('client sign-up collects the care intake', () => {
  it('shows who/where/what to a new client on the email page', async () => {
    renderPage(<RegisterPage />);
    expect(screen.getByText('Who needs care?')).toBeInTheDocument();
    expect(screen.getByText('How should we contact you?')).toBeInTheDocument();
    expect(screen.getByText('Where is care needed?')).toBeInTheDocument();
    expect(screen.getByText('What care is needed?')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('option', { name: 'Colombo' })).toBeInTheDocument());
  });

  it('only asks about the person needing care once the registrant says it is someone else', () => {
    renderPage(<RegisterPage />);
    expect(screen.queryByLabelText(/Name of the person needing care/)).toBeNull();
    fireEvent.click(screen.getByLabelText("I'm arranging care for someone else"));
    expect(screen.getByLabelText(/Name of the person needing care/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('I need care myself'));
    expect(screen.queryByLabelText(/Name of the person needing care/)).toBeNull();
  });

  it('does not submit an incomplete form, and says what is missing', async () => {
    renderPage(<RegisterPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('Please choose who needs care')).toBeInTheDocument();
    expect(screen.getByText('Please choose a district')).toBeInTheDocument();
    expect(screen.getByText('Please describe the care needed')).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it('offers no email contact option to a WhatsApp sign-up (it has no email address)', async () => {
    renderPage(<RegisterWhatsappPage />);
    await waitFor(() => expect(screen.getByLabelText(/WhatsApp number/)).toBeInTheDocument());
    const method = screen.getByLabelText(/Preferred contact method/) as HTMLSelectElement;
    const labels = Array.from(method.options).map((o) => o.textContent);
    expect(labels).toContain('Phone call');
    expect(labels).toContain('WhatsApp');
    expect(labels).not.toContain('Email');
  });

  it('sends the whole intake with a complete WhatsApp registration', async () => {
    post.mockResolvedValue({ patientId: 'p1', message: 'ok', otpSent: true, resendAfterSeconds: 60 });
    renderPage(<RegisterWhatsappPage />);
    await waitFor(() => expect(screen.getByRole('option', { name: 'Colombo' })).toBeInTheDocument());

    change(/Full name/, 'Nadeesha Fernando');
    change(/WhatsApp number/, '0771234567');
    fireEvent.click(screen.getByLabelText("I'm arranging care for someone else"));
    change(/Name of the person needing care/, 'Sunil Fernando');
    change(/Who are they to you/, 'PARENT');
    change(/Their age/, '78');
    change(/Their gender/, 'MALE');
    change(/Preferred contact method/, 'WHATSAPP');
    change(/^District/, '1');
    await waitFor(() => expect(screen.getByRole('option', { name: 'Dehiwala' })).toBeInTheDocument());
    change(/^City/, '340');
    change(/Describe the care needed/, 'Needs help with bathing and meals.');
    change(/When is care needed/, 'DAY');
    change(/When should care start/, 'WITHIN_WEEK');
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    const [path, body] = post.mock.calls[0];
    expect(path).toBe('/auth/whatsapp/register-patient');
    expect(body).toMatchObject({
      fullName: 'Nadeesha Fernando',
      whatsappNumber: '0771234567',
      consentAccepted: true,
      registrantType: 'GUARDIAN',
      recipientName: 'Sunil Fernando',
      recipientRelationship: 'PARENT',
      recipientAge: 78,
      recipientGender: 'MALE',
      preferredContactMethod: 'WHATSAPP',
      preferredContactTime: 'ANYTIME',
      districtId: 1,
      cityId: 340,
      careNeeds: 'Needs help with bathing and meals.',
      careSchedule: 'DAY',
      careStart: 'WITHIN_WEEK',
      preferredCaregiverGender: 'NO_PREFERENCE',
    });
    // Blank optional answers are left out of the request, not sent as ''.
    const onTheWire = JSON.parse(JSON.stringify(body));
    expect(onTheWire).not.toHaveProperty('alternatePhone');
    expect(onTheWire).not.toHaveProperty('careAddress');
  });
});

describe('client sign-up after a search', () => {
  const PUBLIC_ID = '11111111-1111-4111-8111-111111111111';

  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(
      'care-platform-last-search',
      JSON.stringify({
        at: Date.now(),
        request: {
          patient: { age: 78, gender: 'FEMALE', medicalConditions: ['diabetes'] },
          location: { districtId: 1, cityId: 340 },
          shift: 'NIGHT',
          caregiverGenderPreference: 'FEMALE',
          // Today, whatever today is: "Immediately".
          desiredStartDate: new Date().toISOString().slice(0, 10),
        },
        skillNames: ['Dementia care'],
      }),
    );
    window.localStorage.setItem('care-platform-pending-contact', JSON.stringify({ publicId: PUBLIC_ID, at: Date.now() }));
  });

  it('goes straight to a shorter form and shows what the search already answered', async () => {
    renderPage(<RegisterPage />);

    expect(await screen.findByText(/You're contacting caregiver #11111111/)).toBeInTheDocument();
    expect(screen.queryByText('Find and hire the right caregiver for your family')).toBeNull();
    // Who needs care is still asked - a search never says who is registering.
    expect(screen.getByText('Who needs care?')).toBeVisible();
    expect(screen.getByText('Where is care needed?')).not.toBeVisible();
    expect(screen.getByText('What care is needed?')).not.toBeVisible();
    expect(screen.getByText('How should we contact you?')).not.toBeVisible();
    expect(await screen.findByText('Dehiwala, Colombo')).toBeInTheDocument();
    expect(screen.getByText('Caregiver preference: Female')).toBeInTheDocument();
    expect(screen.getByText('Phone call · Any time')).toBeInTheDocument();
    expect((screen.getByLabelText(/Your age/) as HTMLInputElement).value).toBe('78');
  });

  it('submits the carried-over answers with only identity and "who" typed in', async () => {
    post.mockResolvedValue({ patientId: 'p1', message: 'ok' });
    renderPage(<RegisterPage />);
    await screen.findByText('Dehiwala, Colombo');

    change(/Full name/, 'Kamala Perera');
    change(/Email address/, 'kamala@example.com');
    change(/Phone number/, '0771234567');
    change(/^Password/, 'longenough');
    change(/Confirm password/, 'longenough');
    fireEvent.click(screen.getByLabelText('I need care myself'));
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0][1]).toMatchObject({
      registrantType: 'SELF',
      recipientAge: 78,
      recipientGender: 'FEMALE',
      districtId: 1,
      cityId: 340,
      careSchedule: 'NIGHT',
      careStart: 'IMMEDIATELY',
      preferredCaregiverGender: 'FEMALE',
      preferredContactMethod: 'PHONE_CALL',
      preferredContactTime: 'ANYTIME',
      careNeeds: 'Help needed with: Dementia care\nHealth conditions: diabetes',
    });
    expect(await screen.findByText(/we'll take you back to the caregiver you chose/)).toBeInTheDocument();
  });

  it('unfolds everything for editing', async () => {
    renderPage(<RegisterPage />);
    await screen.findByText('Dehiwala, Colombo');
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByText('Where is care needed?')).toBeVisible();
    expect(screen.getByText('What care is needed?')).toBeVisible();
    expect((screen.getByLabelText(/Describe the care needed/) as HTMLTextAreaElement).value).toContain('Dementia care');
  });

  it('defaults a WhatsApp sign-up to being contacted on WhatsApp', async () => {
    renderPage(<RegisterWhatsappPage />);
    expect(await screen.findByText('WhatsApp · Any time')).toBeInTheDocument();
  });
});
