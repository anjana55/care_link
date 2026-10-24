'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { PAYMENT_METHODS_BY_TYPE, PAYMENT_TYPES, bankAccountLabel, type PaymentMethod, type PaymentType } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n/provider';
import { useAuth } from '@/lib/api/auth-context';
import { useBankAccounts } from '@/lib/hooks/use-billing';
import { Label, Select } from '@/components/ui/input';

/** How money moved: Cash, Bank or Online, an optional detail, and for Bank which business account. */
export interface PaymentHow {
  paymentType: PaymentType;
  method: PaymentMethod | '';
  bankAccountId: string;
}

export const DEFAULT_PAYMENT_HOW: PaymentHow = { paymentType: 'BANK', method: '', bankAccountId: '' };

/** The request body fields for a PaymentHow - blanks left out. */
export function paymentHowBody(v: PaymentHow) {
  return {
    paymentType: v.paymentType,
    ...(v.method ? { method: v.method } : {}),
    ...(v.paymentType === 'BANK' && v.bankAccountId ? { bankAccountId: v.bankAccountId } : {}),
  };
}

/** "Bank · Cheque · Commercial Bank - 1234 (CareLink)" - how a recorded payment reads. */
export function usePaymentHowLabel() {
  const { t } = useTranslation();
  return (p: { paymentType: PaymentType | null; method: PaymentMethod | null; bankAccount?: string | null }) =>
    [
      p.paymentType ? t(`billing.paymentType.${p.paymentType}`) : p.method ? t(`billing.method.${p.method}`) : null,
      p.method && p.method !== 'CASH' ? t(`billing.method.${p.method}`) : null,
      p.bankAccount ?? null,
    ]
      .filter(Boolean)
      .join(' · ');
}

/**
 * The payment-type part of a "record payment" or "mark paid" form, shared by
 * client payments (incoming) and caregiver payouts (outgoing). Bank accounts
 * come from Settings > Billing; the first active one is picked by default.
 */
export function PaymentHowFields({ idPrefix, value, onChange }: { idPrefix: string; value: PaymentHow; onChange: (v: PaymentHow) => void }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { data: accounts = [] } = useBankAccounts();
  const active = accounts.filter((a) => a.active);
  const details = PAYMENT_METHODS_BY_TYPE[value.paymentType].filter((m) => m !== 'PAYHERE');

  // Default to the first active account the first time Bank is shown with one available.
  useEffect(() => {
    if (value.paymentType === 'BANK' && !value.bankAccountId && active.length) onChange({ ...value, bankAccountId: active[0].id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.paymentType, active.length]);

  return (
    <>
      <div>
        <Label htmlFor={`${idPrefix}Type`} required>
          {t('billing.payments.type')}
        </Label>
        <Select
          id={`${idPrefix}Type`}
          value={value.paymentType}
          onChange={(e) => onChange({ paymentType: e.target.value as PaymentType, method: '', bankAccountId: '' })}
        >
          {PAYMENT_TYPES.map((type) => (
            <option key={type} value={type}>
              {t(`billing.paymentType.${type}`)}
            </option>
          ))}
        </Select>
      </div>
      {details.length > 0 && (
        <div>
          <Label htmlFor={`${idPrefix}Method`}>{t('billing.payments.detail')}</Label>
          <Select id={`${idPrefix}Method`} value={value.method} onChange={(e) => onChange({ ...value, method: e.target.value as PaymentMethod | '' })}>
            <option value="">{t('billing.payments.noDetail')}</option>
            {details.map((m) => (
              <option key={m} value={m}>
                {t(`billing.method.${m}`)}
              </option>
            ))}
          </Select>
        </div>
      )}
      {value.paymentType === 'BANK' && (
        <div className="col-span-2">
          <Label htmlFor={`${idPrefix}Account`}>{t('billing.payments.bankAccount')}</Label>
          {active.length > 0 ? (
            <Select id={`${idPrefix}Account`} value={value.bankAccountId} onChange={(e) => onChange({ ...value, bankAccountId: e.target.value })}>
              <option value="">{t('billing.payments.noAccount')}</option>
              {active.map((a) => (
                <option key={a.id} value={a.id}>
                  {bankAccountLabel(a)}
                </option>
              ))}
            </Select>
          ) : (
            <p className="text-xs text-ink/60">
              {t('billing.payments.noAccounts')}{' '}
              {user?.role === 'ADMIN' && (
                <Link href="/settings/billing" className="text-brand-dark hover:underline">
                  {t('billing.payments.addAccount')}
                </Link>
              )}
            </p>
          )}
        </div>
      )}
    </>
  );
}
