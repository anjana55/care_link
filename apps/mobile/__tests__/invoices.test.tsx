import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';
import type { ClientBooking, ClientInvoice, MyIssueReport } from '@care-platform/shared';
import en from '../src/i18n/en.json';
import Invoices from '../app/(client)/invoices';
import InvoiceScreen from '../app/invoices/[id]';
import Bookings from '../app/(client)/bookings';
import { checkoutHtml, outcomeOf } from '../src/care/PayhereSheet';
import { screenFor } from '../src/push/notifications';
import { AppProviders, serveApi } from '../test-utils/app';
import { mockRouter } from '../test-utils/router';
import { tokensFor } from '../test-utils/helpers';
import { tokenStore } from '@/api';

jest.mock('expo-router', () => require('../test-utils/router').expoRouterMock());

// PayHere's page inside the app: the test plays PayHere, sending the person back.
const mockWebView: { props: Record<string, any> | null; available: boolean } = { props: null, available: true };
jest.mock('react-native-webview', () => {
  const { createElement } = require('react');
  const { View } = require('react-native');
  return {
    WebView: (props: Record<string, unknown>) => {
      mockWebView.props = props;
      return createElement(View, { testID: 'payhere' });
    },
  };
});
jest.mock('../src/care/PayhereSheet', () => ({
  ...jest.requireActual('../src/care/PayhereSheet'),
  webViewAvailable: () => mockWebView.available,
}));

const INV = '0a1b2c3d-1111-4222-8333-444455556666';
const RETURN = `https://find.caregivers.lk/account/invoices/${INV}?payment=return`;
const CANCEL = `https://find.caregivers.lk/account/invoices/${INV}?payment=cancelled`;
const CHECKOUT = {
  action: 'https://sandbox.payhere.lk/pay/checkout',
  fields: { merchant_id: '1211149', order_id: 'o-1', amount: '12500.00', currency: 'LKR', return_url: RETURN, cancel_url: CANCEL, hash: 'ABC', items: 'Invoice INV-7 "Nov"' },
};

const invoice = (over: Partial<ClientInvoice> = {}): ClientInvoice => ({
  id: INV,
  number: 'INV-0007',
  status: 'ISSUED',
  issueDate: '2026-11-01',
  dueDate: '2026-11-15',
  periodStart: '2026-10-01',
  periodEnd: '2026-10-31',
  bookingReference: 'BK-7Q2',
  seller: { name: 'Vivanti Health', address: 'Colombo 3', phone: '0112345678', email: 'billing@vivanti.lk', registrationNumber: 'PV 1234', taxRegistrationNumber: null } as never,
  billTo: { name: 'Amaya Perera', address: null, phone: '+94771234567', email: 'amaya@example.lk' },
  lines: [{ description: 'Day care', serviceDate: null, quantity: '5', unit: 'DAY', unitPrice: '2500.00', discount: '0', amount: '12500.00' } as never],
  subtotal: '12500.00',
  discount: '0',
  discountLabel: null,
  taxName: null,
  taxRate: null,
  tax: '0',
  total: '12500.00',
  amountPaid: '0',
  balance: '12500.00',
  overdue: false,
  notes: null,
  footer: null,
  payments: [],
  canPayOnline: true,
  ...over,
});

const client = (extra: Record<string, unknown> = { email: 'amaya@example.lk' }) => tokenStore.set(tokensFor('PATIENT_GUARDIAN', { patientId: 'p-1', ...extra }));
const show = (ui: React.ReactElement) => render(<AppProviders>{ui}</AppProviders>);

beforeEach(() => {
  mockRouter.reset();
  mockWebView.props = null;
  mockWebView.available = true;
});

describe('the invoices list', () => {
  it('puts what is still to pay first, with the total owing', async () => {
    await client();
    serveApi({
      'GET /me/invoices': () => ({
        status: 200,
        body: [invoice({ id: 'paid-1', number: 'INV-0001', status: 'PAID', balance: '0', canPayOnline: false }), invoice({ overdue: true }), invoice({ id: 'i-2', number: 'INV-0008', balance: '2500.00' })],
      }),
    });
    await show(<Invoices />);
    expect(await screen.findByText('LKR 15,000.00')).toBeTruthy();
    const rows = screen.getAllByRole('button', { name: /INV-000/ });
    expect(rows.map((r) => r.props.accessibilityLabel)).toEqual([
      `INV-0007, ${en.invoices.status.ISSUED}`,
      `INV-0008, ${en.invoices.status.ISSUED}`,
      `INV-0001, ${en.invoices.status.PAID}`,
    ]);
    expect(screen.getByText(en.invoices.overdue)).toBeTruthy();
    await fireEvent.press(rows[0]);
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/invoices/[id]', params: { id: INV } });
  });
});

describe('paying an invoice with PayHere', () => {
  it('opens PayHere’s checkout, then waits for PayHere to confirm before saying it’s paid', async () => {
    await client();
    let status: ClientInvoice['status'] = 'ISSUED';
    const calls = serveApi({
      [`GET /me/invoices/${INV}`]: () => ({ status: 200, body: invoice(status === 'PAID' ? { status, balance: '0', amountPaid: '12500.00', canPayOnline: false } : {}) }),
      [`POST /me/invoices/${INV}/payhere`]: () => ({ status: 200, body: CHECKOUT }),
    });
    mockRouter.params = { id: INV };
    await show(<InvoiceScreen />);

    expect(await screen.findByText(en.invoices.pay.title.replace('{amount}', 'LKR 12,500.00'))).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: en.invoices.pay.button }));
    expect(await screen.findByTestId('payhere')).toBeTruthy();
    expect(calls.find((c) => c.route === `POST /me/invoices/${INV}/payhere`)!.body).toEqual({});
    expect(mockWebView.props!.source.html).toContain('action="https://sandbox.payhere.lk/pay/checkout"');
    // From the website's domain, which PayHere has on record for the merchant.
    expect(mockWebView.props!.source.baseUrl).toBe('https://find.caregivers.lk');

    // PayHere's own pages load; then it sends the person back.
    expect(mockWebView.props!.onShouldStartLoadWithRequest({ url: 'https://sandbox.payhere.lk/pay/o-1' })).toBe(true);
    let allowed: boolean;
    await act(async () => void (allowed = mockWebView.props!.onShouldStartLoadWithRequest({ url: `${RETURN}&order_id=o-1` })));
    expect(allowed!).toBe(false);
    expect(screen.queryByTestId('payhere')).toBeNull();
    expect(await screen.findByText(en.invoices.pay.confirming)).toBeTruthy();

    // PayHere's notification reaches the API; the next check shows it.
    status = 'PAID';
    expect(await screen.findByText(en.invoices.pay.thanks, {}, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByText(en.invoices.doc.paidInFull)).toBeTruthy();
  });

  it('says nothing was charged when the payment is cancelled', async () => {
    await client();
    serveApi({
      [`GET /me/invoices/${INV}`]: () => ({ status: 200, body: invoice() }),
      [`POST /me/invoices/${INV}/payhere`]: () => ({ status: 200, body: CHECKOUT }),
    });
    mockRouter.params = { id: INV };
    await show(<InvoiceScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: en.invoices.pay.button }));
    await screen.findByTestId('payhere');
    await act(async () => void mockWebView.props!.onShouldStartLoadWithRequest({ url: CANCEL }));
    expect(await screen.findByText(en.invoices.pay.cancelled)).toBeTruthy();
  });

  it('asks for a receipt email when the account has none', async () => {
    await client({ email: null, phone: '+94771234567' });
    const calls = serveApi({
      [`GET /me/invoices/${INV}`]: () => ({ status: 200, body: invoice({ billTo: { name: 'Amaya', address: null, phone: null, email: null } }) }),
      [`POST /me/invoices/${INV}/payhere`]: () => ({ status: 200, body: CHECKOUT }),
    });
    mockRouter.params = { id: INV };
    await show(<InvoiceScreen />);
    const pay = await screen.findByRole('button', { name: en.invoices.pay.button });
    expect(pay).toBeDisabled();
    await fireEvent.changeText(screen.getByLabelText(en.invoices.pay.email), ' amaya@example.lk ');
    await fireEvent.press(screen.getByRole('button', { name: en.invoices.pay.button }));
    await screen.findByTestId('payhere');
    expect(calls.find((c) => c.route === `POST /me/invoices/${INV}/payhere`)!.body).toEqual({ email: 'amaya@example.lk' });
  });

  it('shows the API’s reason when a payment can’t start', async () => {
    await client();
    serveApi({
      [`GET /me/invoices/${INV}`]: () => ({ status: 200, body: invoice() }),
      [`POST /me/invoices/${INV}/payhere`]: () => ({ status: 400, body: { message: 'Online payment is not available right now - please contact us to pay' } }),
    });
    mockRouter.params = { id: INV };
    await show(<InvoiceScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: en.invoices.pay.button }));
    expect(await screen.findByText('Online payment is not available right now - please contact us to pay')).toBeTruthy();
    expect(screen.queryByTestId('payhere')).toBeNull();
  });

  it('pays on the website when this build has no in-app browser yet', async () => {
    await client();
    mockWebView.available = false;
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    const calls = serveApi({ [`GET /me/invoices/${INV}`]: () => ({ status: 200, body: invoice() }) });
    mockRouter.params = { id: INV };
    await show(<InvoiceScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: en.invoices.pay.button }));
    expect(open).toHaveBeenCalledWith(`https://find.caregivers.lk/account/invoices/${INV}`);
    expect(calls.some((c) => c.route.includes('payhere'))).toBe(false);
  });

  it('explains how to pay when online payment isn’t offered', async () => {
    await client();
    serveApi({ [`GET /me/invoices/${INV}`]: () => ({ status: 200, body: invoice({ canPayOnline: false }) }) });
    mockRouter.params = { id: INV };
    await show(<InvoiceScreen />);
    expect(await screen.findByText(en.invoices.pay.offline)).toBeTruthy();
    expect(screen.queryByRole('button', { name: en.invoices.pay.button })).toBeNull();
  });

  it('only ever posts to PayHere, with every value escaped', () => {
    const html = checkoutHtml(CHECKOUT, 'Opening PayHere…');
    expect(html).toContain('name="items" value="Invoice INV-7 &quot;Nov&quot;"');
    expect(html).toContain('document.forms[0].submit()');
    expect(() => checkoutHtml({ ...CHECKOUT, action: 'https://evil.example/pay' }, '')).toThrow();
    expect(() => checkoutHtml({ ...CHECKOUT, action: 'http://sandbox.payhere.lk/pay/checkout' }, '')).toThrow();
    expect(outcomeOf(`${RETURN}&x=1`, CHECKOUT)).toBe('return');
    expect(outcomeOf(CANCEL, CHECKOUT)).toBe('cancelled');
    expect(outcomeOf('https://www.payhere.lk/pay/o-1', CHECKOUT)).toBeNull();
  });

  it('opens the invoice a notification is about', () => {
    expect(screenFor(`/invoices/${INV}`)).toBe(`/invoices/${INV}`);
    expect(screenFor('/invoices/../../etc')).toBe('/home');
  });
});

describe('reporting a problem on a booking', () => {
  const booking = {
    id: 'b-1',
    reference: 'BK-7Q2',
    status: 'CONFIRMED',
    scheduleType: 'DAILY',
    startDate: '2026-11-01',
    endDate: '2026-11-30',
    rateType: null,
    rateAmount: null,
    caregiverPublicId: 'x',
    caregiver: null,
    shifts: [{ id: 's-1', startsAt: '2026-11-02T02:30:00.000Z', endsAt: '2026-11-02T14:30:00.000Z', status: 'COMPLETED', isCover: false }],
  } as unknown as ClientBooking;

  it('sends a report about one shift, and lists reports with our answer', async () => {
    await client();
    const reports: MyIssueReport[] = [
      {
        id: 'ir-1',
        bookingId: 'b-1',
        bookingReference: 'BK-7Q2',
        shiftId: null,
        shiftStartsAt: null,
        category: 'CHARGE',
        message: 'Charged twice',
        status: 'RESOLVED',
        resolutionNote: 'Refunded on 3 Nov',
        createdAt: '2026-11-01T00:00:00.000Z',
        closedAt: '2026-11-03T00:00:00.000Z',
      } as MyIssueReport,
    ];
    const calls = serveApi({
      'GET /me/bookings': () => ({ status: 200, body: [booking] }),
      'GET /me/care': () => ({ status: 200, body: { date: '2026-11-02', today: '2026-11-02', reminders: true, hasCarePlans: false, shifts: [] } }),
      'GET /me/issues': () => ({ status: 200, body: reports }),
      'POST /me/bookings/b-1/issues': (body) => ({ status: 201, body: { ...reports[0], id: 'ir-2', ...body, status: 'OPEN', resolutionNote: null } }),
    });
    await show(<Bookings />);

    expect(await screen.findByText(en.issues.ourAnswer.replace('{note}', 'Refunded on 3 Nov'))).toBeTruthy();
    await fireEvent.press(screen.getByRole('link', { name: en.issues.report }));
    const send = screen.getByRole('button', { name: en.issues.send });
    expect(send).toBeDisabled();

    await fireEvent.press(screen.getByRole('radio', { name: en.issues.category.TIMES }));
    await fireEvent.press(screen.getByRole('button', { name: en.issues.whichShift }));
    await fireEvent.press(await screen.findByRole('radio', { name: /08:00–20:00/ }));
    await fireEvent.changeText(screen.getByLabelText(en.issues.tellUs), 'abc');
    expect(screen.getByRole('button', { name: en.issues.send })).toBeDisabled();
    await fireEvent.changeText(screen.getByLabelText(en.issues.tellUs), '  She left at 4 pm, not 8 pm  ');
    await fireEvent.press(screen.getByRole('button', { name: en.issues.send }));

    expect(await screen.findByText(en.issues.sent)).toBeTruthy();
    expect(calls.find((c) => c.route === 'POST /me/bookings/b-1/issues')!.body).toEqual({ category: 'TIMES', message: 'She left at 4 pm, not 8 pm', shiftId: 's-1' });
    await waitFor(() => expect(calls.filter((c) => c.route === 'GET /me/issues').length).toBe(2));
  });
});
