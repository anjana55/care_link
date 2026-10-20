import { bucketOf, fold, median, periodFor, ratio } from './periods';

describe('insight periods', () => {
  const today = '2026-10-20';

  it('30d: thirty daily buckets ending today, compared with the 30 days before', () => {
    const p = periodFor('30d', today);
    expect(p.from).toBe('2026-09-21');
    expect(p.buckets).toHaveLength(30);
    expect(p.buckets.at(-1)).toEqual({ start: today, end: today });
    expect([p.prevFrom, p.prevTo]).toEqual(['2026-08-22', '2026-09-20']);
  });

  it('90d: thirteen weekly buckets, the last ending today', () => {
    const p = periodFor('90d', today);
    expect(p.buckets).toHaveLength(13);
    expect(p.buckets[0].start).toBe(p.from);
    expect(p.buckets.at(-1)).toEqual({ start: '2026-10-14', end: today });
    expect(p.prevTo).toBe('2026-07-21');
  });

  it('12m: twelve calendar months, compared with the same dates a year earlier', () => {
    const p = periodFor('12m', today);
    expect(p.from).toBe('2025-11-01');
    expect(p.buckets).toHaveLength(12);
    expect(p.buckets[1]).toEqual({ start: '2025-12-01', end: '2025-12-31' });
    expect(p.buckets.at(-1)).toEqual({ start: '2026-10-01', end: today });
    expect([p.prevFrom, p.prevTo]).toEqual(['2024-11-01', '2025-10-20']);
    expect(periodFor('12m', '2028-02-29').prevTo).toBe('2027-02-28');
  });

  it('places days in buckets and splits current from previous totals', () => {
    const p = periodFor('90d', today);
    expect(bucketOf(p, p.from)).toBe(0);
    expect(bucketOf(p, '2026-07-28')).toBe(0);
    expect(bucketOf(p, '2026-07-29')).toBe(1);
    expect(bucketOf(p, '2026-07-21')).toBe(-1);

    const f = fold(p, [
      { day: '2026-07-22', value: 2 },
      { day: today, value: 3.333 },
      { day: '2026-06-01', value: 10 },
      { day: '2020-01-01', value: 99 },
    ]);
    expect(f.series[0]).toBe(2);
    expect(f.series[12]).toBe(3.33);
    expect(f.total).toBe(5.33);
    expect(f.previous).toBe(10);
  });

  it('ratios and medians cope with nothing to measure', () => {
    expect(ratio(1, 0).value).toBeNull();
    expect(ratio(1, 4).value).toBe(0.25);
    expect(median([])).toBeNull();
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});
