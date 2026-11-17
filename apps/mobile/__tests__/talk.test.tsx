import { fireEvent, render, screen } from '@testing-library/react-native';
import en from '../src/i18n/en.json';
import Talk from '../app/talk';
import Account from '../app/(client)/account';
import Me from '../app/(caregiver)/me';
import { AppProviders, serveApi } from '../test-utils/app';
import { mockRouter } from '../test-utils/router';
import { tokensFor } from '../test-utils/helpers';
import { tokenStore } from '@/api';

jest.mock('expo-router', () => require('../test-utils/router').expoRouterMock());

const show = (ui: React.ReactElement) => render(<AppProviders>{ui}</AppProviders>);

beforeEach(() => mockRouter.reset());

describe('Talk to a person', () => {
  it('a client names a request, says how to be reached, and sees what they sent', async () => {
    await tokenStore.set(tokensFor('PATIENT_GUARDIAN', { patientId: 'p-1', email: 'amali@example.com' }));
    const sent: unknown[] = [];
    const calls = serveApi({
      'GET /me/care-requests': () => ({ status: 200, body: [{ id: 'r-1', reference: 'CR-TALK01', status: 'NEW' }] }),
      'GET /me/bookings': () => ({ status: 200, body: [] }),
      'GET /me/talk-to-a-person': () => ({ status: 200, body: sent }),
      'POST /me/talk-to-a-person': (body) => {
        sent.unshift({ id: 't-1', createdAt: '2026-11-17T05:00:00Z', message: (body as { message: string }).message, contact: 'CALL', status: 'OPEN', handledAt: null });
        return { status: 201, body: sent[0] };
      },
    });
    await show(<Talk />);
    const send = await screen.findByRole('button', { name: en.talk.send });
    expect(send).toBeDisabled();
    await fireEvent.changeText(screen.getByLabelText(en.talk.message), '  Please call about the start  ');
    await fireEvent.press(await screen.findByLabelText(en.talk.about));
    await fireEvent.press(await screen.findByText(en.talk.aboutRequest.replace('{ref}', 'CR-TALK01')));
    await fireEvent.press(screen.getByRole('button', { name: en.talk.send }));
    expect(await screen.findByText(en.talk.sentTitle)).toBeTruthy();
    expect(calls.find((c) => c.route === 'POST /me/talk-to-a-person')!.body).toEqual({ message: 'Please call about the start', contact: 'CALL', about: { type: 'REQUEST', id: 'r-1' } });
    expect(await screen.findByText(en.talk.status.OPEN)).toBeTruthy();
  });

  it('opens from My account and from Me', async () => {
    await tokenStore.set(tokensFor('PATIENT_GUARDIAN', { patientId: 'p-1', email: 'amali@example.com' }));
    serveApi({});
    const client = await show(<Account />);
    await fireEvent.press(await screen.findByRole('button', { name: en.talk.title }));
    expect(mockRouter.push).toHaveBeenCalledWith('/talk');
    client.unmount();

    mockRouter.reset();
    await tokenStore.set(tokensFor('CAREGIVER', { caregiverId: 'cg-1', phone: '+94771234567' }));
    serveApi({ 'GET /caregivers/cg-1': () => ({ status: 200, body: { id: 'cg-1', fullName: 'Nimali', registrationNumber: 'CG-1', status: 'ACTIVE', documents: [] } }) });
    await show(<Me />);
    await fireEvent.press(await screen.findByRole('button', { name: en.talk.title }));
    expect(mockRouter.push).toHaveBeenCalledWith('/talk');
  });
});
