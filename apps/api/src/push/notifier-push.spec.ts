import { ConfigService } from '@nestjs/config';
import { BillingNotifier } from '../billing/billing-notifier.service';
import type { PushLanguage, PushText } from './push.service';

/** Each select answers with the next queued rows, however the query is built. */
function fakeDb(selects: unknown[][]) {
  const query = (): any => {
    const q: any = {
      from: () => q,
      innerJoin: () => q,
      leftJoin: () => q,
      where: () => q,
      limit: () => Promise.resolve(selects.shift() ?? []),
    };
    return q;
  };
  return { select: query };
}

function notifier(selects: unknown[][]) {
  const email = { sendNotificationEmail: jest.fn(async () => undefined) };
  const whatsappSettings = { getResolved: async () => ({}), getDefaultCountryCode: async () => '94' };
  const whatsapp = { canSendUpdates: () => false, sendUpdate: jest.fn() };
  const push = { notify: jest.fn() };
  const n = new BillingNotifier(fakeDb(selects) as never, new ConfigService({}), email as never, whatsappSettings as never, whatsapp as never, push as never);
  return { n, email, push };
}

const pushed = (push: { notify: jest.Mock }) => {
  const [userIds, build, path] = push.notify.mock.calls[0] as [string[], (l: PushLanguage) => PushText, string];
  return { userIds, path, en: build('en'), si: build('si') };
};

describe('notifiers send push in addition to their message', () => {
  it('a client hears about an invoice by email and on the app, in the app’s language', async () => {
    const { n, email, push } = notifier([
      [{ number: 'INV-7', total: '12500.00', dueDate: '2026-11-15', language: 'en', billToEmail: null, patientUserId: 'u-client', patientPhone: null, preferred: 'EMAIL' }],
      [{ email: 'amaya@example.lk', phone: null }],
    ]);
    expect(await n.invoiceIssued('inv-1')).toBe(true);

    expect(email.sendNotificationEmail).toHaveBeenCalledTimes(1);
    const p = pushed(push);
    expect(p.userIds).toEqual(['u-client']);
    expect(p.path).toBe('/invoices/inv-1');
    expect(p.en.body).toContain('INV-7');
    expect(p.si.body).toContain('INV-7');
    expect(p.si.body).not.toBe(p.en.body);
  });

  it('a caregiver hears about a payout on the app even when no other channel can reach them', async () => {
    const { n, email, push } = notifier([
      [{ reference: 'PO-3', total: '40000.00', periodStart: '2026-10-01', periodEnd: '2026-10-31', paidOn: '2026-11-02', userId: 'u-cg', phone: null, preferred: null }],
      [{ email: null, phone: null }],
    ]);
    expect(await n.payoutPaid('po-1')).toBe(false); // no email or WhatsApp: the message isn't sent...
    expect(email.sendNotificationEmail).not.toHaveBeenCalled();
    const p = pushed(push); // ...but the app still gets the push
    expect(p.userIds).toEqual(['u-cg']);
    expect(p.path).toBe('/payments');
    expect(p.en.body).toContain('PO-3');
  });
});
