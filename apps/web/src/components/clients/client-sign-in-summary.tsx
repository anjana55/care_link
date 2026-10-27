'use client';

import { useTranslation } from '@/lib/i18n/provider';
import type { Client } from '@/lib/api/types';
import { Card, CardContent } from '@/components/ui/card';

function Row({ label, value, detail, ok }: { label: string; value: string; detail?: string | null; ok: boolean }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 py-3 first:pt-0 last:pb-0">
      <div>
        <div className="text-sm font-medium text-ink">{label}</div>
        {detail && <div className="text-xs text-ink/50">{detail}</div>}
      </div>
      <span className={ok ? 'text-sm text-brand-dark' : 'text-sm text-ink/40'}>{value}</span>
    </div>
  );
}

/** How a client signs in - the same rows the caregiver Sign-in tab shows. */
export function ClientSignInSummary({ client }: { client: Client }) {
  const { t, locale } = useTranslation();
  const state = (value: string | null, verified: boolean) => (!value ? t('caregivers.signIn.none') : verified ? t('caregivers.signIn.verified') : t('caregivers.signIn.unverified'));
  return (
    <Card>
      <CardContent className="py-5">
        <div className="divide-y divide-border">
          <Row label={t('caregivers.signIn.phone')} ok={Boolean(client.accountPhone && client.phoneVerifiedAt)} value={state(client.accountPhone, Boolean(client.phoneVerifiedAt))} detail={client.accountPhone} />
          <Row label={t('caregivers.signIn.email')} ok={Boolean(client.email && client.emailVerifiedAt)} value={state(client.email, Boolean(client.emailVerifiedAt))} detail={client.email} />
          <Row label={t('caregivers.signIn.password')} ok={Boolean(client.hasPassword)} value={client.hasPassword ? t('caregivers.signIn.set') : t('caregivers.signIn.none')} />
        </div>
        {!client.isActive && <p className="mt-4 text-xs text-danger">{t('passwordHelp.accountInactive')}</p>}
        {client.lastLoginAt && (
          <p className="mt-4 text-xs text-ink/50">
            {t('caregivers.signIn.lastSignIn')} {new Date(client.lastLoginAt).toLocaleString(locale)}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
