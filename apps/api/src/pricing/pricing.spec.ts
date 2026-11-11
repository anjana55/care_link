import { clientPriceFor, defaultPricing, rateProblem } from '@care-platform/shared';

/** The pricing rules every app shares: the client's price and whether a rate is acceptable. */
describe('pricing rules', () => {
  it('adds the fee and rounds to a whole rupee, halves up', () => {
    expect(clientPriceFor(3000, 0)).toBe(3000);
    expect(clientPriceFor(3000, 15)).toBe(3450);
    expect(clientPriceFor(2500, 12.5)).toBe(2813); // 2812.5
    expect(clientPriceFor(3333, 10)).toBe(3666); // 3666.3
    expect(clientPriceFor(85000, 17.5)).toBe(99875);
    expect(clientPriceFor(1.15, 100)).toBe(2); // 2.3
  });

  it('keeps own rates off for a care type until the admin sets it up', () => {
    expect(defaultPricing('HOME_SHIFT')).toEqual({ careType: 'HOME_SHIFT', enabled: false, rateType: 'DAILY', minRate: 0, maxRate: 0, feePercent: 0 });
    expect(defaultPricing('LIVE_IN').rateType).toBe('MONTHLY');
    expect(rateProblem(3000, defaultPricing('HOME_SHIFT'))).toBe('DISABLED');
  });

  it('accepts a rate inside the band, ends included, and nothing else', () => {
    const band = { enabled: true, minRate: 2500, maxRate: 6000 };
    expect(rateProblem(2500, band)).toBeNull();
    expect(rateProblem(6000, band)).toBeNull();
    expect(rateProblem(2499.99, band)).toBe('TOO_LOW');
    expect(rateProblem(6000.01, band)).toBe('TOO_HIGH');
    expect(rateProblem(0, band)).toBe('NOT_A_NUMBER');
    expect(rateProblem(Number.NaN, band)).toBe('NOT_A_NUMBER');
  });
});
