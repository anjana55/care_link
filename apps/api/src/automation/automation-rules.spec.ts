import {
  AUTOMATION_ACTIONS,
  AUTOMATION_ACTION_KEYS,
  AUTOMATION_FUNCTIONS,
  AUTOMATION_MODES,
  DEFAULT_PROMOTION_BAR,
  RISK_TIERS,
  agreementPercent,
  effectiveMode,
  meetsPromotionBar,
  resolveGate,
} from '@care-platform/shared';

/**
 * The rules of the rail, with no database: what an agent may do for every
 * combination of dial, tier and driver; and when an action has earned acting
 * alone. These are the promises the Automation page makes to an admin.
 */
describe('automation rules', () => {
  describe('resolveGate', () => {
    it('does nothing at all in Manual, whatever the tier or permission', () => {
      for (const tier of RISK_TIERS) {
        expect(resolveGate({ mode: 'MANUAL', tier, autoAllowed: true })).toBe('NONE');
      }
    });

    it('only logs in Shadow - nothing is shown or done, even reading and drafting', () => {
      for (const tier of RISK_TIERS) {
        expect(resolveGate({ mode: 'SHADOW', tier, autoAllowed: true })).toBe('SHADOW');
      }
    });

    it('in Assist reads and drafts, and proposes everything else', () => {
      expect(resolveGate({ mode: 'ASSIST', tier: 0, autoAllowed: false })).toBe('EXECUTE');
      expect(resolveGate({ mode: 'ASSIST', tier: 1, autoAllowed: true })).toBe('PROPOSE');
      expect(resolveGate({ mode: 'ASSIST', tier: 2, autoAllowed: true })).toBe('PROPOSE');
      expect(resolveGate({ mode: 'ASSIST', tier: 3, autoAllowed: true })).toBe('PROPOSE');
    });

    it('in Auto does reversible steps alone, and commitments only once earned', () => {
      expect(resolveGate({ mode: 'AUTO', tier: 0, autoAllowed: false })).toBe('EXECUTE');
      expect(resolveGate({ mode: 'AUTO', tier: 1, autoAllowed: false })).toBe('EXECUTE');
      expect(resolveGate({ mode: 'AUTO', tier: 2, autoAllowed: false })).toBe('PROPOSE');
      expect(resolveGate({ mode: 'AUTO', tier: 2, autoAllowed: true })).toBe('EXECUTE');
    });

    it('never lets a human-only action run alone, in any mode, with any permission', () => {
      for (const mode of AUTOMATION_MODES) {
        expect(resolveGate({ mode, tier: 3, autoAllowed: true })).not.toBe('EXECUTE');
      }
    });

    it('stops completely on a case a person has taken over', () => {
      for (const mode of AUTOMATION_MODES) {
        for (const tier of RISK_TIERS) {
          expect(resolveGate({ mode, tier, autoAllowed: true, driver: 'STAFF' })).toBe('NONE');
        }
      }
      expect(resolveGate({ mode: 'AUTO', tier: 1, autoAllowed: false, driver: 'AGENT' })).toBe('EXECUTE');
    });
  });

  describe('effectiveMode', () => {
    it('is Manual under the master switch or after a trip, and the dial otherwise', () => {
      expect(effectiveMode('AUTO', { masterManual: true, tripped: false })).toBe('MANUAL');
      expect(effectiveMode('AUTO', { masterManual: false, tripped: true })).toBe('MANUAL');
      expect(effectiveMode('ASSIST', { masterManual: false, tripped: false })).toBe('ASSIST');
    });
  });

  describe('the promotion bar', () => {
    const bar = DEFAULT_PROMOTION_BAR;

    it('is 50 judged decisions at 90% agreement, demoting after 3 reversals in a day', () => {
      expect(bar).toEqual({ cases: 50, agreementPercent: 90, demoteAfterReversals: 3 });
    });

    it('needs enough cases, however good the agreement', () => {
      expect(meetsPromotionBar({ judged: 49, agreed: 49, serious: 0 }, bar)).toBe(false);
      expect(meetsPromotionBar({ judged: 50, agreed: 50, serious: 0 }, bar)).toBe(true);
    });

    it('needs the agreement, however many cases', () => {
      expect(meetsPromotionBar({ judged: 50, agreed: 44, serious: 0 }, bar)).toBe(false);
      expect(meetsPromotionBar({ judged: 50, agreed: 45, serious: 0 }, bar)).toBe(true);
      expect(meetsPromotionBar({ judged: 200, agreed: 179, serious: 0 }, bar)).toBe(false);
    });

    it('is blocked by a single serious miss', () => {
      expect(meetsPromotionBar({ judged: 500, agreed: 499, serious: 1 }, bar)).toBe(false);
    });

    it('reports agreement as a whole percentage, or nothing before the first verdict', () => {
      expect(agreementPercent({ judged: 0, agreed: 0, serious: 0 })).toBeNull();
      expect(agreementPercent({ judged: 3, agreed: 2, serious: 0 })).toBe(67);
    });
  });

  describe('the action catalogue', () => {
    it('gives every action a known function, a tier and a label', () => {
      for (const key of AUTOMATION_ACTION_KEYS) {
        const def = AUTOMATION_ACTIONS[key];
        expect(AUTOMATION_FUNCTIONS).toContain(def.function);
        expect(RISK_TIERS).toContain(def.tier);
        expect(def.label.length).toBeGreaterThan(5);
        expect(key.length).toBeLessThanOrEqual(64);
        expect(key.startsWith(`${def.function.toLowerCase()}.`)).toBe(true);
      }
    });

    it('keeps the agreed human-only list at tier 3', () => {
      const humanOnly = [
        'onboarding.set_verification',
        'onboarding.suspend_caregiver',
        'billing.refund',
        'billing.approve_large_payout',
        'billing.change_bank_details',
        'billing.amend_billed_booking',
        'live_care.close_safety_report',
      ] as const;
      for (const key of humanOnly) expect(AUTOMATION_ACTIONS[key].tier).toBe(3);
    });

    it('gives every function at least one action', () => {
      for (const fn of AUTOMATION_FUNCTIONS) {
        expect(AUTOMATION_ACTION_KEYS.some((k) => AUTOMATION_ACTIONS[k].function === fn)).toBe(true);
      }
    });
  });
});
