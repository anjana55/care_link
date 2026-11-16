import { requestGaps } from '@care-platform/shared';

const full = { careType: 'ELDERLY_CARE', districtId: 5, schedule: 'DAY', desiredStartDate: '2026-12-01', urgency: 'WITHIN_WEEK' };

describe('requestGaps', () => {
  it('is empty for a complete request', () => {
    expect(requestGaps(full)).toEqual([]);
  });

  it('names each missing piece, in a fixed order', () => {
    expect(requestGaps({ ...full, careType: null, districtId: null, schedule: null, desiredStartDate: null })).toEqual(['CARE_TYPE', 'AREA', 'SCHEDULE', 'START_DATE']);
    expect(requestGaps({ ...full, desiredStartDate: null })).toEqual(['START_DATE']);
  });

  it('treats "not sure" about the time of day as missing', () => {
    expect(requestGaps({ ...full, schedule: 'NOT_SURE' })).toEqual(['SCHEDULE']);
  });

  it('does not chase a client who is just exploring', () => {
    expect(requestGaps({ ...full, urgency: 'JUST_EXPLORING', careType: null, desiredStartDate: null })).toEqual([]);
  });

  it('does not count district 0 as missing only by being falsy', () => {
    expect(requestGaps({ ...full, districtId: 0 })).toEqual([]);
  });
});
