import { CAREGIVER_STATUS_TRANSITIONS } from './caregivers.schema';

describe('CAREGIVER_STATUS_TRANSITIONS', () => {
  it('allows DRAFT to move only to REGISTERED', () => {
    expect(CAREGIVER_STATUS_TRANSITIONS.DRAFT).toEqual(['REGISTERED']);
  });

  it('does not allow skipping straight from DRAFT to ACTIVE', () => {
    expect(CAREGIVER_STATUS_TRANSITIONS.DRAFT).not.toContain('ACTIVE');
  });

  it('allows ACTIVE caregivers to become INACTIVE or SUSPENDED', () => {
    expect(CAREGIVER_STATUS_TRANSITIONS.ACTIVE).toEqual(expect.arrayContaining(['INACTIVE', 'SUSPENDED']));
  });

  it('treats REJECTED as a terminal state', () => {
    expect(CAREGIVER_STATUS_TRANSITIONS.REJECTED).toEqual([]);
  });

  it('defines a transition list for every status', () => {
    const statuses = Object.keys(CAREGIVER_STATUS_TRANSITIONS);
    expect(statuses).toEqual(
      expect.arrayContaining([
        'DRAFT',
        'REGISTERED',
        'DOCUMENTS_PENDING',
        'UNDER_VERIFICATION',
        'VERIFIED',
        'ACTIVE',
        'INACTIVE',
        'SUSPENDED',
        'REJECTED',
      ]),
    );
  });
});
