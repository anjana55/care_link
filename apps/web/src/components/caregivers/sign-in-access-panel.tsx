'use client';

import { useState } from 'react';
import { useTranslation } from '@/lib/i18n/provider';
import { ApiError } from '@/lib/api/client';
import { useCaregiverSignIn, useIssueClaimCode, useResetCaregiverSignIn } from '@/lib/hooks/use-caregivers';
import type { CaregiverSignInMethods, IssuedClaimCode, ResetSignInRequest, SocialProviderName } from '@/lib/api/types';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { FieldError } from '@/components/ui/input';

const PROVIDER_NAMES: Record<SocialProviderName, string> = { GOOGLE: 'Google', MICROSOFT: 'Microsoft', FACEBOOK: 'Facebook' };

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString() : null;
}

function MethodRow({ label, value, detail, ok }: { label: string; value: string; detail?: string | null; ok: boolean }) {
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

/**
 * The staff "Sign-in" tab: how a caregiver signs in, a reset for admins, and a
 * one-time code staff can give a caregiver whose account is not secured.
 */
export function SignInAccessPanel({
  caregiverId,
  registrationNumber,
  canReset,
}: {
  caregiverId: string;
  registrationNumber: string;
  /** Admins only - the API refuses resets from anyone else. */
  canReset: boolean;
}) {
  const { t } = useTranslation();
  const { data: methods, isLoading } = useCaregiverSignIn(caregiverId);
  const issueCode = useIssueClaimCode(caregiverId);
  const [issued, setIssued] = useState<IssuedClaimCode | null>(null);
  const [issueError, setIssueError] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);

  if (isLoading || !methods) {
    return <p className="text-sm text-ink/50">{t('common.loading')}</p>;
  }

  const onIssue = () => {
    setIssueError(null);
    issueCode.mutate(undefined, {
      onSuccess: (res) => setIssued(res),
      onError: (err) => setIssueError(err instanceof ApiError ? err.message : t('caregivers.signIn.issueError')),
    });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="py-5">
          {!methods.hasAccount ? (
            <p className="text-sm text-ink/70">{t('caregivers.signIn.noAccount')}</p>
          ) : (
            <div className="divide-y divide-border">
              {(['GOOGLE', 'MICROSOFT', 'FACEBOOK'] as SocialProviderName[]).map((p) => {
                const link = methods.providers.find((l) => l.provider === p);
                return (
                  <MethodRow
                    key={p}
                    label={PROVIDER_NAMES[p]}
                    ok={Boolean(link)}
                    value={link ? t('caregivers.signIn.linked') : t('caregivers.signIn.notLinked')}
                    detail={link ? `${link.providerEmail} · ${t('caregivers.signIn.linkedOn')} ${formatDate(link.linkedAt)}` : null}
                  />
                );
              })}
              <MethodRow
                label={t('caregivers.signIn.phone')}
                ok={Boolean(methods.phone && methods.phoneVerified)}
                value={
                  !methods.phone
                    ? t('caregivers.signIn.none')
                    : methods.phoneVerified
                      ? t('caregivers.signIn.verified')
                      : t('caregivers.signIn.unverified')
                }
                detail={methods.phone}
              />
              <MethodRow
                label={t('caregivers.signIn.email')}
                ok={Boolean(methods.email && methods.emailVerified)}
                value={
                  !methods.email
                    ? t('caregivers.signIn.none')
                    : methods.emailVerified
                      ? t('caregivers.signIn.verified')
                      : t('caregivers.signIn.unverified')
                }
                detail={methods.email}
              />
              <MethodRow
                label={t('caregivers.signIn.password')}
                ok={methods.hasPassword}
                value={methods.hasPassword ? t('caregivers.signIn.set') : t('caregivers.signIn.none')}
              />
            </div>
          )}
          {methods.lastLoginAt && (
            <p className="mt-4 text-xs text-ink/50">
              {t('caregivers.signIn.lastSignIn')} {formatDate(methods.lastLoginAt)}
            </p>
          )}
          {canReset && methods.hasAccount && (
            <div className="mt-5 border-t border-border pt-4">
              <Button variant="secondary" size="sm" onClick={() => setResetOpen(true)}>
                {t('caregivers.signIn.resetButton')}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {methods.claimable && (
        <Card>
          <CardContent className="py-5">
            <h3 className="text-sm font-semibold text-ink">{t('caregivers.signIn.unsecuredTitle')}</h3>
            <p className="mt-1 text-sm text-ink/60">
              {t('caregivers.signIn.unsecuredBody')} <span className="font-medium text-ink">{registrationNumber}</span>
            </p>

            {issued ? (
              <div className="mt-4 rounded border border-brand/30 bg-brand-light p-4">
                <div className="text-xs text-ink/60">{t('caregivers.signIn.codeLabel')}</div>
                <div className="mt-1 select-all font-semibold tracking-[0.2em] text-2xl text-brand-dark">{issued.code}</div>
                <p className="mt-2 text-xs text-ink/60">
                  {t('caregivers.signIn.codeExpires')} {formatDate(issued.expiresAt)}. {t('caregivers.signIn.codeShownOnce')}
                </p>
              </div>
            ) : (
              <>
                <p className="mt-3 text-xs text-ink/50">{t('caregivers.signIn.issueHint')}</p>
                {methods.staffClaimCodeExpiresAt && (
                  <p className="mt-1 text-xs text-ink/50">
                    {t('caregivers.signIn.existingCode')} {formatDate(methods.staffClaimCodeExpiresAt)}
                  </p>
                )}
                <Button className="mt-3" size="sm" disabled={issueCode.isPending} onClick={onIssue}>
                  {t('caregivers.signIn.issueButton')}
                </Button>
                <FieldError message={issueError ?? undefined} />
              </>
            )}
          </CardContent>
        </Card>
      )}

      {resetOpen && (
        <ResetSignInModal caregiverId={caregiverId} methods={methods} onClose={() => setResetOpen(false)} />
      )}
    </div>
  );
}

function ResetSignInModal({
  caregiverId,
  methods,
  onClose,
}: {
  caregiverId: string;
  methods: CaregiverSignInMethods;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const reset = useResetCaregiverSignIn(caregiverId);
  const [providers, setProviders] = useState<SocialProviderName[]>(methods.providers.map((p) => p.provider));
  const [password, setPassword] = useState(methods.hasPassword);
  const [phone, setPhone] = useState(false);
  const [email, setEmail] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleProvider = (p: SocialProviderName) =>
    setProviders((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));

  const nothingChosen = providers.length === 0 && !password && !phone && !email;

  const submit = () => {
    setError(null);
    const body: ResetSignInRequest = { providers, password, phone, email };
    reset.mutate(body, {
      onSuccess: onClose,
      onError: (err) => setError(err instanceof ApiError ? err.message : t('caregivers.signIn.resetError')),
    });
  };

  const Check = ({ checked, onChange, label, hint }: { checked: boolean; onChange: () => void; label: string; hint?: string }) => (
    <label className="flex cursor-pointer items-start gap-3 py-2">
      <input type="checkbox" className="mt-1 h-4 w-4 accent-brand" checked={checked} onChange={onChange} />
      <span>
        <span className="block text-sm text-ink">{label}</span>
        {hint && <span className="block text-xs text-ink/50">{hint}</span>}
      </span>
    </label>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-lg border border-border bg-white p-6">
        <h3 className="mb-1 text-base font-semibold text-ink">{t('caregivers.signIn.resetTitle')}</h3>
        <p className="mb-4 text-sm text-ink/60">{t('caregivers.signIn.resetBody')}</p>

        <div className="divide-y divide-border">
          {methods.providers.map((p) => (
            <Check
              key={p.provider}
              checked={providers.includes(p.provider)}
              onChange={() => toggleProvider(p.provider)}
              label={`${t('caregivers.signIn.unlink')} ${PROVIDER_NAMES[p.provider]}`}
              hint={p.providerEmail}
            />
          ))}
          {methods.hasPassword && (
            <Check checked={password} onChange={() => setPassword((v) => !v)} label={t('caregivers.signIn.removePassword')} />
          )}
          {methods.phone && (
            <Check
              checked={phone}
              onChange={() => setPhone((v) => !v)}
              label={t('caregivers.signIn.releasePhone')}
              hint={t('caregivers.signIn.releasePhoneHint')}
            />
          )}
          {methods.email && (
            <Check
              checked={email}
              onChange={() => setEmail((v) => !v)}
              label={t('caregivers.signIn.clearEmail')}
              hint={t('caregivers.signIn.clearEmailHint')}
            />
          )}
        </div>

        <p className="mt-4 text-xs text-ink/50">{t('caregivers.signIn.resetSessionsNote')}</p>
        <FieldError message={error ?? undefined} />

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" size="sm" disabled={nothingChosen || reset.isPending} onClick={submit}>
            {t('caregivers.signIn.resetConfirm')}
          </Button>
        </div>
      </div>
    </div>
  );
}
