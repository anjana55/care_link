import type { ReactElement } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { CaregiverPayout, ClientInvoice } from '@care-platform/shared';
import { I18nProvider } from '@/lib/i18n';
import MyInvoicesPage from '@/app/account/invoices/page';
import InvoicePage from '@/app/account/invoices/[id]/page';
import PaymentsPage from '@/app/caregiver/(portal)/payments/page';

/**
 * The client's invoices and online payment, and the caregiver's payments page.
 * The API is replaced by recorded calls; the money rules themselves (totals,
 * what may be paid, PayHere verification) are covered by apps/api's billing
 * tests.
 */

const get = jest.fn();
const post = jest.fn();
let params = new URLSearchParams();
let auth: { user: unknown; loading: boolean } = { user: null, loading: false };

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
  usePathname: () => '/account/invoices',
  useParams: () => ({ id: 'inv-1' }),
  useSearchParams: () => params,
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
  api: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

const CLIENT = { userId: 'u-client', email: 'amali@example.com', role: 'PATIENT_GUARDIAN', patientId: 'p-1' };

const invoice = (over: Partial<ClientInvoice> = {}): ClientInvoice => ({
  id: 'inv-1',
  number: 'INV-000042',
  status: 'ISSUED',
  issueDate: '2026-10-01',
  dueDate: '2026-10-08',
  periodStart: '2026-09-01',
  periodEnd: '2026-09-30',
  bookingReference: 'BK-7KX2PQ',
  seller: { name: 'CareLink (Pvt) Ltd', address: '12 Galle Road, Colombo 03', phone: '0112000000', email: 'billing@carelink.lk', registrationNumber: 'PV 12345', taxRegistrationNumber: null },
  billTo: { name: 'Amali Perera', address: 'Dehiwala', phone: '0771234567', email: 'amali@example.com' },
  lines: [
    { description: 'Care shift 08:00–20:00 (BK-7KX2PQ)', serviceDate: '2026-09-01', quantity: '1.00', unit: 'DAY', unitPrice: '3500.00', discount: '0.00', amount: '3500.00' },
    { description: 'Late start', serviceDate: null, quantity: '1.00', unit: 'ITEM', unitPrice: '-500.00', discount: '0.00', amount: '-500.00' },
  ],
  subtotal: '3000.00',
  discount: '0.00',
  discountLabel: null,
  taxName: null,
  taxRate: null,
  tax: '0.00',
  total: '3000.00',
  amountPaid: '0.00',
  balance: '3000.00',
  overdue: false,
  notes: 'Thank you for choosing CareLink.',
  footer: 'Bank: Sampath Bank, A/C 0000',
  payments: [],
  canPayOnline: true,
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
  get.mockReset();
  post.mockReset();
  params = new URLSearchParams();
  auth = { user: CLIENT, loading: false };
});

describe('client invoices', () => {
  it('lists invoices, unpaid first, with what is owed', async () => {
    get.mockResolvedValue([invoice({ id: 'paid', number: 'INV-000041', status: 'PAID', amountPaid: '3000.00', balance: '0.00' }), invoice({ overdue: true })]);
    renderUi(<MyInvoicesPage />);
    const links = await screen.findAllByRole('link');
    expect(links[0]).toHaveAttribute('href', '/account/invoices/inv-1');
    expect(links[1]).toHaveAttribute('href', '/account/invoices/paid');
    expect(screen.getByText('Overdue')).toBeInTheDocument();
    expect(screen.getByText('Total to pay:')).toBeInTheDocument();
    expect(screen.getAllByText('LKR 3,000.00').length).toBeGreaterThan(0);
    expect(get).toHaveBeenCalledWith('/me/invoices');
  });

  it('shows the invoice in full, credits included', async () => {
    get.mockResolvedValue(invoice());
    renderUi(<InvoicePage />);
    expect(await screen.findByText('INV-000042')).toBeInTheDocument();
    expect(screen.getByText('CareLink (Pvt) Ltd')).toBeInTheDocument();
    const table = within(screen.getByRole('table'));
    expect(table.getByText('Late start')).toBeInTheDocument();
    expect(table.getAllByText('-500.00')).toHaveLength(2); // the price and the amount
    // Phones get the same lines as a list.
    expect(screen.getAllByText('Late start')).toHaveLength(2);
    expect(screen.getByText('Bank: Sampath Bank, A/C 0000')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /print/i })).toBeInTheDocument();
  });

  it('starts a PayHere checkout and posts the form the API signed', async () => {
    get.mockResolvedValue(invoice());
    post.mockResolvedValue({ action: 'https://sandbox.payhere.lk/pay/checkout', fields: { merchant_id: '1211149', order_id: 'o-1', amount: '3000.00', hash: 'ABC' } });
    const submit = jest.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => undefined);
    renderUi(<InvoicePage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Pay now' }));
    await waitFor(() => expect(submit).toHaveBeenCalled());
    expect(post).toHaveBeenCalledWith('/me/invoices/inv-1/payhere', {});
    const form = document.querySelector('form[action="https://sandbox.payhere.lk/pay/checkout"]') as HTMLFormElement;
    expect(form.method.toLowerCase()).toBe('post');
    expect((form.elements.namedItem('hash') as HTMLInputElement).value).toBe('ABC');
    submit.mockRestore();
  });

  it('asks a WhatsApp-only client for a receipt email before paying', async () => {
    auth = { user: { ...CLIENT, email: null }, loading: false };
    get.mockResolvedValue(invoice({ billTo: { name: 'Amali Perera', address: null, phone: '0771234567', email: null } }));
    post.mockResolvedValue({ action: 'https://sandbox.payhere.lk/pay/checkout', fields: {} });
    const submit = jest.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => undefined);
    renderUi(<InvoicePage />);
    const pay = await screen.findByRole('button', { name: 'Pay now' });
    expect(pay).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Email for your receipt'), { target: { value: 'amali@example.com' } });
    expect(pay).toBeEnabled();
    fireEvent.click(pay);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/me/invoices/inv-1/payhere', { email: 'amali@example.com' }));
    submit.mockRestore();
  });

  it('waits for PayHere to confirm after the client comes back, rather than trusting the return', async () => {
    params = new URLSearchParams('payment=return');
    get.mockResolvedValue(invoice());
    renderUi(<InvoicePage />);
    expect(await screen.findByText(/confirming your payment/i)).toBeInTheDocument();
  });

  it('offers no online payment when the agency has not set it up', async () => {
    get.mockResolvedValue(invoice({ canPayOnline: false }));
    renderUi(<InvoicePage />);
    expect(await screen.findByText(/use the bank details on the invoice/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pay now' })).not.toBeInTheDocument();
  });
});

describe('caregiver payments', () => {
  it('lists approved and paid statements and opens one to its lines', async () => {
    auth = { user: { userId: 'u-cg', email: 'nimal@example.com', role: 'CAREGIVER', caregiverId: 'cg-1' }, loading: false };
    const payout: CaregiverPayout = {
      id: 'po-1',
      reference: 'PS-ABC234',
      status: 'PAID',
      periodStart: '2026-09-01',
      periodEnd: '2026-09-30',
      lines: [
        { description: 'BK-7KX2PQ · 08:00–20:00', serviceDate: '2026-09-01', quantity: '1.00', unit: 'DAY', unitPrice: '2500.00', discount: '0.00', amount: '2500.00' },
        { description: 'Uniform', serviceDate: null, quantity: '1.00', unit: 'ITEM', unitPrice: '-300.00', discount: '0.00', amount: '-300.00' },
      ],
      total: '2200.00',
      paidOn: '2026-10-03',
      paymentMethod: 'BANK_TRANSFER',
      paymentReference: 'TRF-88',
    };
    get.mockResolvedValue([payout]);
    renderUi(<PaymentsPage />);
    fireEvent.click(await screen.findByRole('button', { expanded: false }));
    expect(screen.getByText('Uniform')).toBeInTheDocument();
    expect(screen.getByText('Transfer reference: TRF-88')).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('/me/payouts');
  });
});
