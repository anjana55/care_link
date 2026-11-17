import { paymentReminderStage } from '@care-platform/shared';

const inv = (dueDate: string, over: { issueDate?: string; advance?: boolean } = {}) => ({ issueDate: over.issueDate ?? '2026-11-01', dueDate, advance: over.advance ?? false });
const TODAY = '2026-11-17';

describe('payment reminder stage', () => {
  it('reminds a few days before, on the day, and a few days late', () => {
    expect(paymentReminderStage(inv('2026-11-21'), TODAY, [])).toBeNull(); // 4 days out
    expect(paymentReminderStage(inv('2026-11-20'), TODAY, [])).toBe('BEFORE');
    expect(paymentReminderStage(inv('2026-11-18'), TODAY, [])).toBe('BEFORE');
    expect(paymentReminderStage(inv('2026-11-17'), TODAY, [])).toBe('DUE');
    expect(paymentReminderStage(inv('2026-11-16'), TODAY, [])).toBeNull(); // 1 day late
    expect(paymentReminderStage(inv('2026-11-14'), TODAY, [])).toBe('OVERDUE');
    expect(paymentReminderStage(inv('2026-10-17'), TODAY, [])).toBeNull(); // 31 days late: too long ago
  });

  it('sends each stage once, and never "before" after "due"', () => {
    expect(paymentReminderStage(inv('2026-11-19'), TODAY, ['BEFORE'])).toBeNull();
    expect(paymentReminderStage(inv('2026-11-17'), TODAY, ['BEFORE'])).toBe('DUE');
    expect(paymentReminderStage(inv('2026-11-17'), TODAY, ['DUE'])).toBeNull();
    expect(paymentReminderStage(inv('2026-11-13'), TODAY, ['OVERDUE'])).toBeNull();
  });

  it('does not remind on the day an invoice is issued, nor late about a month billed in advance', () => {
    expect(paymentReminderStage(inv('2026-11-19', { issueDate: TODAY }), TODAY, [])).toBeNull();
    expect(paymentReminderStage(inv('2026-11-17', { issueDate: TODAY }), TODAY, [])).toBe('DUE');
    expect(paymentReminderStage(inv('2026-11-13', { advance: true }), TODAY, [])).toBeNull();
    expect(paymentReminderStage(inv('2026-11-17', { advance: true }), TODAY, [])).toBe('DUE');
  });
});
