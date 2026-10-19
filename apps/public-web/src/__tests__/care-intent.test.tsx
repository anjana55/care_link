import { render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  careStartFromDate,
  intakeDefaultsFromSearch,
  loadSearch,
  peekPendingContact,
  readDeviceShortlist,
  rememberPendingContact,
  rememberSearch,
  setDeviceSaved,
} from '@/lib/care-intent';
import { rememberReturnTo, takeReturnTo } from '@/lib/return-to';
import { DeviceShortlistSync } from '@/components/care/device-shortlist-sync';

const put = jest.fn();
let auth: { user: unknown } = { user: null };
jest.mock('@/lib/api/auth-context', () => ({ useAuth: () => auth }));
jest.mock('@/lib/api/client', () => ({
  ...jest.requireActual('@/lib/api/client'),
  api: { put: (...a: unknown[]) => put(...a), get: jest.fn(), post: jest.fn(), delete: jest.fn() },
}));

const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';
// Same shape as the real translator, enough to see what was composed.
const t = (key: string, vars?: Record<string, string | number>) => `${key}${vars ? JSON.stringify(vars) : ''}`;

beforeEach(() => {
  window.localStorage.clear();
  put.mockReset();
});

describe('search -> sign-up intake', () => {
  it('carries over only what the search actually answered', () => {
    const defaults = intakeDefaultsFromSearch(
      {
        request: {
          patient: { age: 78, gender: 'FEMALE', medicalConditions: ['diabetes'] },
          location: { districtId: 1, cityId: 2 },
          shift: 'TWENTY_FOUR_HOUR_LIVE_IN',
          caregiverGenderPreference: 'ANY',
          desiredStartDate: '2026-10-22',
        },
        skillNames: ['Dementia care'],
      },
      t,
      '2026-10-19',
    );
    expect(defaults).toEqual({
      recipientAge: 78,
      recipientGender: 'FEMALE',
      districtId: 1,
      cityId: 2,
      careSchedule: 'LIVE_IN_24H',
      careStart: 'WITHIN_WEEK',
      preferredCaregiverGender: 'NO_PREFERENCE',
      careNeeds: 'careIntent.needs.help{"list":"Dementia care"}\ncareIntent.needs.conditions{"list":"diabetes"}',
    });
  });

  it('guesses nothing for a bare search', () => {
    expect(intakeDefaultsFromSearch({ request: { location: { districtId: 3 } } }, t, '2026-10-19')).toEqual({ districtId: 3 });
  });

  it('uses what was typed into AI Search as the care description', () => {
    const defaults = intakeDefaultsFromSearch({ request: {}, aiQuery: 'Night nurse for my father after a stroke' }, t, '2026-10-19');
    expect(defaults.careNeeds).toBe('Night nurse for my father after a stroke');
  });

  it('turns a start date into the intake buckets, and leaves far-off dates to the client', () => {
    expect(careStartFromDate('2026-10-19', '2026-10-19')).toBe('IMMEDIATELY');
    expect(careStartFromDate('2026-10-01', '2026-10-19')).toBe('IMMEDIATELY');
    expect(careStartFromDate('2026-10-26', '2026-10-19')).toBe('WITHIN_WEEK');
    expect(careStartFromDate('2026-11-15', '2026-10-19')).toBe('WITHIN_MONTH');
    expect(careStartFromDate('2027-02-01', '2026-10-19')).toBeUndefined();
    expect(careStartFromDate(undefined, '2026-10-19')).toBeUndefined();
  });

  it('forgets a search after a day', () => {
    rememberSearch({ request: { location: { districtId: 1 } } });
    expect(loadSearch()?.request.location?.districtId).toBe(1);
    const stored = JSON.parse(window.localStorage.getItem('care-platform-last-search')!);
    window.localStorage.setItem('care-platform-last-search', JSON.stringify({ ...stored, at: Date.now() - 25 * 60 * 60 * 1000 }));
    expect(loadSearch()).toBeNull();
  });
});

describe('coming back to the caregiver', () => {
  it('returns to the remembered page first', () => {
    rememberPendingContact(ID_A);
    rememberReturnTo('/caregivers/somewhere-else');
    expect(takeReturnTo('/')).toBe('/caregivers/somewhere-else');
  });

  it('falls back to the caregiver being contacted when the return path has expired', () => {
    rememberPendingContact(ID_A);
    window.localStorage.setItem('care-platform-return-to', JSON.stringify({ path: '/x', at: Date.now() - 2 * 60 * 60 * 1000 }));
    expect(takeReturnTo('/')).toBe(`/caregivers/${ID_A}`);
  });

  it('ignores anything that is not a caregiver id', () => {
    rememberPendingContact('../../admin');
    expect(peekPendingContact()).toBeNull();
    expect(takeReturnTo('/')).toBe('/');
  });
});

describe('device shortlist', () => {
  it('saves and unsaves on the device', () => {
    setDeviceSaved(ID_A, true);
    setDeviceSaved(ID_B, true);
    setDeviceSaved(ID_A, false);
    expect(readDeviceShortlist()).toEqual([ID_B]);
  });

  function renderSync() {
    const client = new QueryClient();
    return render(
      <QueryClientProvider client={client}>
        <DeviceShortlistSync />
      </QueryClientProvider>,
    );
  }

  it('copies the device shortlist to a client account on sign-in and keeps any that failed', async () => {
    setDeviceSaved(ID_A, true);
    setDeviceSaved(ID_B, true);
    put.mockImplementation((path: string) => (path.includes(ID_A) ? Promise.resolve({ saved: true }) : Promise.reject(new Error('gone'))));
    auth = { user: { userId: 'u1', role: 'PATIENT_GUARDIAN', patientId: 'p1' } };

    renderSync();

    await waitFor(() => expect(readDeviceShortlist()).toEqual([ID_B]));
    expect(put).toHaveBeenCalledWith(`/me/saved-caregivers/${ID_A}`, {});
    expect(put).toHaveBeenCalledWith(`/me/saved-caregivers/${ID_B}`, {});
  });

  it('leaves the shortlist alone for anyone who is not a client', () => {
    setDeviceSaved(ID_A, true);
    auth = { user: { userId: 'u2', role: 'CAREGIVER', caregiverId: 'c1' } };
    renderSync();
    expect(put).not.toHaveBeenCalled();
    expect(readDeviceShortlist()).toEqual([ID_A]);
  });
});
