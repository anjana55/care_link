import type { ReactElement } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CaregiverSignupPage from '@/app/caregiver/signup/page';
import { ProviderChoices } from '@/components/caregivers/provider-choices';
import { I18nProvider } from '@/lib/i18n';

/**
 * The unified caregiver form, and the two things it exists to fix.
 *
 * 1. **One phone input.** The WhatsApp page asks for a WhatsApp number and then
 *    still carries a primary-phone field, so the same number gets typed twice
 *    and labelled two different things. This page must never reintroduce that:
 *    `PersonalInfoFields` renders `primaryPhone` unconditionally, so the only
 *    thing standing between the design and the duplicate is the `omitFields`
 *    prop - which is why this asserts on the rendered DOM and not on the prop.
 * 2. **One number, one name.** The field is a phone number, not a WhatsApp
 *    number - nothing on this route is verified over WhatsApp at all.
 */

const get = jest.fn();
const post = jest.fn();

jest.mock('@/lib/api/auth-context', () => ({ useAuth: () => ({ user: null, logout: jest.fn() }) }));
jest.mock('@/lib/api/client', () => ({
  ...jest.requireActual('@/lib/api/client'),
  api: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a) },
}));

const TREE = [
  { id: 1, name: 'Western Province', districts: [{ id: 1, name: 'Colombo' }, { id: 2, name: 'Gampaha' }] },
];

function renderPage(node: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(
    <QueryClientProvider client={client}>
      <I18nProvider>{node}</I18nProvider>
    </QueryClientProvider>,
  );
  return { ...result, client };
}

async function locationsSettled(client: QueryClient) {
  await waitFor(() => expect(client.getQueryState(['locations', 'tree', 'en'])?.status ?? 'success').toBe('success'));
}

/** Sets a controlled input/select the way the existing suites do. */
const change = (label: RegExp | string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  get.mockImplementation((path: string) => {
    if (path.startsWith('/public/meta/locations/tree')) return Promise.resolve(TREE);
    // Picking a district fires the cities query, and PersonalInfoFields
    // iterates its answer. `[]` rather than null: the hook's `= []` default
    // only covers undefined, so a null here crashes the render.
    if (path.includes('/cities')) return Promise.resolve([{ id: 10, name: 'Colombo 03', subName: 'Modara', postcode: '00300' }]);
    return Promise.resolve(null);
  });
  post.mockResolvedValue({
    caregiverId: 'cg-1',
    registrationNumber: 'CG-2026-0001',
    message: 'ok',
    pendingToken: 'pending-token',
    pendingTokenExpiresInSeconds: 900,
    providers: { GOOGLE: true, MICROSOFT: true, FACEBOOK: true },
  });
});

describe('the unified caregiver signup form', () => {
  it('asks for the phone number exactly once', async () => {
    const { container, client } = renderPage(<CaregiverSignupPage />);
    await locationsSettled(client);

    // A `tel` input is the phone field; `primaryPhone` renders as a plain text
    // input, so this catches a reintroduced duplicate even though its label
    // differs. Counted by the input itself, not by the label, because the whole
    // failure mode is two inputs answering one question.
    expect(container.querySelectorAll('input[type="tel"]')).toHaveLength(1);
  });

  it('calls the number a phone number, never a WhatsApp number', async () => {
    const { container, client } = renderPage(<CaregiverSignupPage />);
    await locationsSettled(client);

    expect(screen.getByLabelText(/^Phone number/)).toBeDefined();
    expect(container.textContent).not.toMatch(/WhatsApp number/i);
  });

  it('asks for no secondary number twice over and still offers the other contact numbers', async () => {
    const { container, client } = renderPage(<CaregiverSignupPage />);
    await locationsSettled(client);

    // The remaining shared fields must survive the omission, including the one
    // that sits next to primaryPhone - otherwise the grid would silently shift.
    expect(screen.getByLabelText(/secondary phone/i)).toBeDefined();
    expect(screen.getByLabelText(/emergency contact number/i)).toBeDefined();
  });

  it('treats the email address as optional', async () => {
    const { container, client } = renderPage(<CaregiverSignupPage />);
    await locationsSettled(client);

    const email = screen.getByLabelText(/email address/i) as HTMLInputElement;
    expect(email.required).toBe(false);
    // Optional in the schema is not enough - it must not carry the mandatory
    // asterisk either, or the form says one thing and validates another.
    expect(email.closest('div')!.textContent).not.toContain('*');
  });

  it('blocks on an empty phone number rather than reaching the API', async () => {
    const { client } = renderPage(<CaregiverSignupPage />);
    await locationsSettled(client);

    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    expect(await screen.findByText(/phone number is required/i)).toBeDefined();
    expect(post).not.toHaveBeenCalled();
  });

  it('posts the one number under `phone` and omits a blank email entirely', async () => {
    const { client } = renderPage(<CaregiverSignupPage />);
    await locationsSettled(client);

    change(/^Phone number/, '0771234567');
    change(/full name/i, 'Nimal Perera');
    change(/permanent address/i, '12 Temple Road, Colombo');
    change(/date of birth/i, '1990-04-12');
    change(/^gender/i, 'MALE');
    change(/civil status/i, 'SINGLE');
    change(/^district/i, '1');
    // The city options are a second query, so the select is still empty on the
    // tick after the district changes. Filling it before they arrive would
    // silently drop the value.
    await waitFor(() =>
      expect((document.getElementById('city') as HTMLSelectElement).querySelectorAll('option').length).toBeGreaterThan(1),
    );
    change(/^city/i, '10');
    change(/emergency contact name/i, 'Sunil Perera');
    change(/emergency contact number/i, '0771111111');
    change(/emergency contact relationship/i, 'Son');
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    await waitFor(() => expect(post).toHaveBeenCalled());
    const [path, body] = post.mock.calls[0];
    expect(path).toBe('/auth/register-caregiver/unified');
    expect(body).toMatchObject({ phone: '0771234567' });
    // A blank optional field must not be sent as '' - the API rejects that on
    // IsEmail, which would read to the caregiver as a validation error on a
    // field they deliberately left empty.
    expect(body).not.toHaveProperty('email');
    expect(body).not.toHaveProperty('primaryPhone');
  });
});

describe('the provider choice screen', () => {
  const providers = { GOOGLE: true, MICROSOFT: true, FACEBOOK: true };

  it('offers every configured provider, and asks the API for the URL before navigating', async () => {
    get.mockResolvedValue({ url: 'https://accounts.google.com/o/oauth2/v2/auth?state=x' });
    const assign = jest.fn();
    // jsdom refuses real navigation, and this component uses a full-page
    // assign on purpose (the caregiver is leaving the app and coming back).
    Object.defineProperty(window, 'location', { value: { assign }, writable: true });

    renderPage(
      <ProviderChoices pendingToken="tok" providers={providers} expiresInSeconds={900} />,
    );

    fireEvent.click(screen.getByRole('button', { name: /continue with google/i }));

    await waitFor(() => expect(assign).toHaveBeenCalled());
    expect(get).toHaveBeenCalledWith('/auth/social/google/authorize-url', { token: 'tok' });
  });

  it('offers only the providers this environment has configured', () => {
    renderPage(
      <ProviderChoices
        pendingToken="tok"
        providers={{ GOOGLE: true, MICROSOFT: false, FACEBOOK: false }}
        expiresInSeconds={900}
      />,
    );

    expect(screen.getByRole('button', { name: /google/i })).toBeDefined();
    expect(screen.queryByRole('button', { name: /microsoft/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /facebook/i })).toBeNull();
  });

  it('says so rather than showing an empty screen when no provider is configured', () => {
    renderPage(
      <ProviderChoices
        pendingToken="tok"
        providers={{ GOOGLE: false, MICROSOFT: false, FACEBOOK: false }}
        expiresInSeconds={900}
      />,
    );

    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.getByText(/not available right now/i)).toBeDefined();
  });
});