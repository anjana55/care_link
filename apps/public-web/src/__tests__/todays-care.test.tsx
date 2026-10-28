import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { CareChecklistShift, ClientCareDay } from '@care-platform/shared';
import { I18nProvider } from '@/lib/i18n';
import { TodaysCare } from '@/components/care/todays-care';

/**
 * Today's care on the client's bookings page: what it shows, what a tick
 * sends, and that a closed day is read-only.
 */

const get = jest.fn();
const put = jest.fn();
jest.mock('@/lib/api/auth-context', () => ({ useAuth: () => ({ user: { userId: 'u1', role: 'PATIENT_GUARDIAN', patientId: 'p1' }, loading: false }) }));
jest.mock('@/lib/api/client', () => ({
  ...jest.requireActual('@/lib/api/client'),
  api: { get: (...a: unknown[]) => get(...a), put: (...a: unknown[]) => put(...a), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

const item = (over: Partial<CareChecklistShift['items'][number]> = {}): CareChecklistShift['items'][number] => ({
  activityId: 'a1',
  dueKey: '09:00',
  dueAt: '2026-11-02T03:30:00.000Z',
  category: 'MEDICATION',
  title: 'Morning tablets',
  instructions: 'With breakfast',
  timing: 'AT_TIMES',
  slot: null,
  isCritical: true,
  status: null,
  source: null,
  reason: null,
  recordedAt: null,
  recordedBy: null,
  ...over,
});
const shift = (over: Partial<CareChecklistShift> = {}): CareChecklistShift => ({
  shiftId: 's1',
  bookingId: 'b1',
  bookingReference: 'BK-ABC123',
  startsAt: '2026-11-02T02:30:00.000Z',
  endsAt: '2026-11-02T11:30:00.000Z',
  shiftStatus: 'SCHEDULED',
  cutOffAt: '2026-11-02T18:30:00.000Z',
  locked: false,
  canMark: true,
  isCover: false,
  caregiverName: null,
  planNotes: 'Allergic to penicillin',
  items: [item()],
  ...over,
});
const day = (over: Partial<ClientCareDay> = {}): ClientCareDay => ({ date: '2026-11-02', today: '2026-11-02', reminders: false, hasCarePlans: true, shifts: [shift()], ...over });

function renderIt() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <I18nProvider>
        <TodaysCare />
      </I18nProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  get.mockReset();
  put.mockReset();
});

it('shows nothing for a client with no care plans', async () => {
  get.mockResolvedValue(day({ hasCarePlans: false, shifts: [] }));
  const { container } = renderIt();
  await waitFor(() => expect(get).toHaveBeenCalledWith('/me/care'));
  expect(container).toBeEmptyDOMElement();
});

it('lists the day, the plan notes and how many are left, and sends a tick', async () => {
  get.mockResolvedValue(day());
  put.mockResolvedValue(shift({ items: [item({ status: 'DONE', source: 'CLIENT' })] }));
  renderIt();
  expect(await screen.findByText('Morning tablets')).toBeInTheDocument();
  expect(screen.getByText('Allergic to penicillin')).toBeInTheDocument();
  expect(screen.getByText(/Left to review before midnight: 1/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /^Done$/ }));
  await waitFor(() => expect(put).toHaveBeenCalledWith('/me/care/records', { shiftId: 's1', activityId: 'a1', dueKey: '09:00', status: 'DONE', reason: null }));
  await waitFor(() => expect(screen.getByRole('button', { name: /^Done$/ })).toHaveAttribute('aria-pressed', 'true'));
});

it('asks for an optional reason when something was not done', async () => {
  get.mockResolvedValue(day());
  put.mockResolvedValue(shift({ items: [item({ status: 'NOT_DONE', source: 'CLIENT' })] }));
  renderIt();
  fireEvent.click(await screen.findByRole('button', { name: /Not done/ }));
  await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
  fireEvent.change(await screen.findByPlaceholderText(/What happened/), { target: { value: 'Refused them' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(put).toHaveBeenLastCalledWith('/me/care/records', expect.objectContaining({ status: 'NOT_DONE', reason: 'Refused them' })));
});

it('shows a closed day read-only, telling auto-filled items apart', async () => {
  get.mockResolvedValue(day({ shifts: [shift({ locked: true, canMark: false, items: [item({ status: 'DONE', source: 'AUTO' })] })] }));
  renderIt();
  expect(await screen.findByText('Done (not reviewed)')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /^Done$/ })).not.toBeInTheDocument();
});
