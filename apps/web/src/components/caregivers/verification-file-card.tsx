'use client';

import { useQuery } from '@tanstack/react-query';
import type { OnboardingCheckState, OnboardingFileView, OnboardingRecommendation } from '@care-platform/shared';
import { api } from '@/lib/api/client';
import { useTranslation } from '@/lib/i18n/provider';
import { fmtDateTime } from '@/lib/colombo-time';
import { Card, CardContent } from '@/components/ui/card';

const TONE: Record<OnboardingRecommendation, string> = {
  READY: 'border-brand/40 bg-brand-light text-brand-dark',
  NOT_READY: 'border-border bg-paper text-ink',
  CONCERNS: 'border-danger/40 bg-red-50 text-danger',
};
const STATE_TONE: Record<OnboardingCheckState, string> = {
  OK: 'text-brand-dark',
  TO_CHECK: 'text-ink',
  MISSING: 'text-amber-700',
  EXPIRED: 'text-amber-700',
  REJECTED: 'text-danger',
  WAITING: 'text-ink/60',
  CONCERN: 'text-danger',
};

/**
 * The onboarding agent's verification file: what is in, what is missing, what
 * referees said, and its recommendation. Staff still decide - this card has
 * no verify button on purpose.
 */
export function VerificationFileCard({ caregiverId }: { caregiverId: string }) {
  const { t, locale } = useTranslation();
  const { data } = useQuery({
    queryKey: ['onboarding-file', caregiverId],
    queryFn: () => api.get<{ file: OnboardingFileView | null }>(`/caregivers/${caregiverId}/onboarding-file`),
    enabled: Boolean(caregiverId),
  });
  const file = data?.file;
  if (!file) return null;

  return (
    <section className="mb-6" data-testid="verification-file">
      <h3 className="mb-3 text-sm font-semibold text-ink">{t('caregivers.verificationFile.title')}</h3>
      <Card>
        <CardContent className="space-y-4 py-5">
          <div className={`rounded border px-3 py-2 text-sm ${TONE[file.recommendation]}`}>
            <p className="font-medium">{t(`caregivers.verificationFile.recommendation.${file.recommendation}`)}</p>
            <p className="text-xs opacity-80">{t('caregivers.verificationFile.staffDecide', { when: fmtDateTime(file.assembledAt, locale) })}</p>
          </div>
          <ul className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
            {file.checks.map((c) => (
              <li key={c.key} className="flex justify-between gap-3 rounded border border-border px-3 py-2">
                <span className="text-ink/70">{t(`caregivers.verificationFile.checks.${c.key}`)}</span>
                <span className={`text-right font-medium ${STATE_TONE[c.state]}`}>
                  {c.key === 'PROFILE' && c.state === 'OK' ? t('caregivers.verificationFile.profileComplete') : t(`caregivers.verificationFile.states.${c.state}`)}
                  {c.key === 'REFERENCES' && ` · ${c.confirmed}/${c.wanted}`}
                  {c.gaps?.length ? <span className="block text-xs font-normal text-ink/60">{c.gaps.map((g) => t(`caregivers.verificationFile.gaps.${g}`)).join(', ')}</span> : null}
                </span>
              </li>
            ))}
          </ul>
          {file.documentsRequested && (
            <p className="text-xs text-ink/60">
              {t('caregivers.verificationFile.documentsAsked', {
                what: file.documentsRequested.documents.map((d) => t(`caregivers.verificationFile.documents.${d}`)).join(', '),
                when: fmtDateTime(file.documentsRequested.at, locale),
              })}
            </p>
          )}
          {file.references.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink/50">{t('caregivers.verificationFile.referees')}</p>
              <ul className="space-y-2 text-sm">
                {file.references.map((r) => (
                  <li key={r.id} className="rounded border border-border px-3 py-2" data-testid="referee-answer">
                    <p className="font-medium text-ink">
                      {r.name} <span className="font-normal text-ink/60">· {r.relationship}</span>
                    </p>
                    {r.answer ? (
                      <>
                        <p className="text-ink/80">
                          {r.answer.knowsThem
                            ? t('caregivers.verificationFile.answer', {
                                years: t(`caregivers.verificationFile.years.${r.answer.years}`),
                                trust: t(`caregivers.verificationFile.trust.${r.answer.wouldTrust}`),
                              })
                            : t('caregivers.verificationFile.doesNotKnow')}
                        </p>
                        {r.answer.comment && <p className="mt-1 whitespace-pre-line text-ink/70">“{r.answer.comment}”</p>}
                      </>
                    ) : (
                      <p className="text-ink/60">
                        {r.sentAt ? t('caregivers.verificationFile.waiting', { channel: t(`caregivers.verificationFile.channel.${r.channel ?? 'EMAIL'}`), when: fmtDateTime(r.sentAt, locale) }) : t('caregivers.verificationFile.notAsked')}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
