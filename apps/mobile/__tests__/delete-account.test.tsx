import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import en from '../src/i18n/en.json';
import DeleteAccount from '../app/delete-account';
import Account from '../app/(client)/account';
import Me from '../app/(caregiver)/me';
import { AppProviders, serveApi } from '../test-utils/app';
import { mockRouter } from '../test-utils/router';
import { tokensFor } from '../test-utils/helpers';
import { tokenStore } from '@/api';

jest.mock('expo-router', () => require('../test-utils/router').expoRouterMock());

const show = (ui: React.ReactElement) => render(<AppProviders>{ui}</AppProviders>);
const deleteButton = () => screen.getByRole('button', { name: en.deleteAccount.delete });

beforeEach(() => mockRouter.reset());

describe('Delete my account', () => {
  it('closes the account once confirmed, forgets the session without calling the API again, and says when', async () => {
    await tokenStore.set(tokensFor('PATIENT_GUARDIAN', { patientId: 'p-1', email: 'amali@example.com' }));
    const calls = serveApi({ 'POST /me/account/deletion': () => ({ status: 200, body: { eraseAfter: '2026-11-15T03:30:00.000Z' } }) });
    await show(<DeleteAccount />);

    expect(await screen.findByText(en.deleteAccount.steps.erased)).toBeTruthy();
    expect(screen.getByText(en.deleteAccount.steps.kept)).toBeTruthy();
    expect(screen.getByText('Signed in as amali@example.com')).toBeTruthy();
    expect(deleteButton().props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(deleteButton());
    expect(calls.some((c) => c.route === 'POST /me/account/deletion')).toBe(false);

    await fireEvent.press(screen.getByRole('checkbox', { name: en.deleteAccount.confirm }));
    await fireEvent.press(deleteButton());
    expect(await screen.findByText(en.deleteAccount.done.replace('{date}', '15 Nov 2026'))).toBeTruthy();
    expect(calls.map((c) => c.route).filter((r) => r !== 'GET /branding')).toEqual(['POST /me/account/deletion']);
    // The session is gone from the phone; the API already ended it, so no sign-out call.
    await waitFor(() => expect(tokenStore.get()).toBeNull());

    await fireEvent.press(screen.getByRole('button', { name: en.deleteAccount.doneOk }));
    expect(mockRouter.replace).toHaveBeenCalledWith('/');
  });

  it("shows the API's reason, and keeps the session, when it refuses", async () => {
    await tokenStore.set(tokensFor('CAREGIVER', { caregiverId: 'cg-1', phone: '+94771234567' }));
    serveApi({ 'POST /me/account/deletion': () => ({ status: 500, body: { message: 'Something went wrong' } }) });
    await show(<DeleteAccount />);
    await fireEvent.press(await screen.findByRole('checkbox', { name: en.deleteAccount.confirm }));
    await fireEvent.press(deleteButton());
    expect(await screen.findByText('Something went wrong')).toBeTruthy();
    expect(tokenStore.get()).not.toBeNull();
  });

  it('opens from My account and from Me', async () => {
    await tokenStore.set(tokensFor('PATIENT_GUARDIAN', { patientId: 'p-1', email: 'amali@example.com' }));
    serveApi({});
    const client = await show(<Account />);
    await fireEvent.press(await screen.findByRole('link', { name: en.deleteAccount.title }));
    expect(mockRouter.push).toHaveBeenCalledWith('/delete-account');
    client.unmount();

    mockRouter.reset();
    await tokenStore.set(tokensFor('CAREGIVER', { caregiverId: 'cg-1', phone: '+94771234567' }));
    serveApi({ 'GET /caregivers/cg-1': () => ({ status: 200, body: { id: 'cg-1', fullName: 'Nimali', registrationNumber: 'CG-1', status: 'ACTIVE', documents: [] } }) });
    await show(<Me />);
    await fireEvent.press(await screen.findByRole('link', { name: en.deleteAccount.title }));
    expect(mockRouter.push).toHaveBeenCalledWith('/delete-account');
  });
});
