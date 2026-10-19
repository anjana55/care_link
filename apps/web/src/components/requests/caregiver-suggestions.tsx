'use client';

import { useState } from 'react';
import Link from 'next/link';
import { BadgeCheck, Sparkles } from 'lucide-react';
import { useTranslation } from '@/lib/i18n/provider';
import { ApiError } from '@/lib/api/client';
import { useRequestSuggestions } from '@/lib/hooks/use-ai';
import { useSetCareRequestCaregiver } from '@/lib/hooks/use-care-requests';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { CareRequestDetail } from '@/lib/api/types';

/**
 * "Suggest caregivers" for an open request: active caregivers who fit the
 * client's location, shift and preferences (the same hard filters as the
 * public search), ranked - by the AI when Settings > AI has matching on, which
 * also reads the client's care-needs text and message. Fetched on demand,
 * because each lookup may cost a model call.
 */
export function CaregiverSuggestions({ request }: { request: CareRequestDetail }) {
  const { t } = useTranslation();
  const [asked, setAsked] = useState(false);
  const { data, isFetching, isError, error, refetch } = useRequestSuggestions(request.id, asked);
  const attach = useSetCareRequestCaregiver(request.id);

  return (
    <Card className="mt-4">
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2">
          <Sparkles size={16} className="text-accent" aria-hidden />
          {t('suggestions.title')}
        </CardTitle>
        {asked && !isFetching && (
          <Button variant="ghost" size="sm" onClick={() => refetch()}>
            {t('suggestions.refresh')}
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {!asked && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-ink/60">{t('suggestions.hint')}</p>
            <Button variant="secondary" size="sm" onClick={() => setAsked(true)}>
              {t('suggestions.find')}
            </Button>
          </div>
        )}
        {asked && isFetching && <p className="text-sm text-ink/50">{t('suggestions.loading')}</p>}
        {asked && isError && (
          <p role="alert" className="text-sm text-danger">
            {error instanceof ApiError ? error.message : t('suggestions.failed')}
          </p>
        )}
        {asked && data && !isFetching && (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-1.5 text-xs text-ink/60">
              <span>{data.aiRanked ? t('suggestions.aiRanked') : t('suggestions.ruleRanked')}</span>
              {data.criteria.map((c) => (
                <span key={c} className="rounded-full bg-paper px-2 py-0.5 text-ink/70">
                  {c}
                </span>
              ))}
            </div>
            {data.notice && <p className="mb-3 rounded bg-accent-light px-3 py-2 text-xs text-accent">{t('suggestions.notice', { reason: data.notice })}</p>}
            {data.items.length === 0 ? (
              <p className="text-sm text-ink/60">{t('suggestions.none')}</p>
            ) : (
              <ul className="divide-y divide-border">
                {data.items.map((c) => {
                  const attached = request.caregiver?.id === c.caregiverId;
                  const shifts = [c.dayDuty && t('suggestions.shift.day'), c.nightDuty && t('suggestions.shift.night'), c.liveIn24h && t('suggestions.shift.liveIn')].filter(Boolean);
                  return (
                    <li key={c.caregiverId} className="flex flex-wrap items-start justify-between gap-3 py-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link href={`/caregivers/${c.caregiverId}`} className="font-medium text-ink hover:underline">
                            {c.fullName}
                          </Link>
                          <span className="text-xs tabular-nums text-ink/50">{c.registrationNumber}</span>
                          {c.hasVerifiedQualification && (
                            <span className="inline-flex items-center gap-1 text-xs text-brand-dark">
                              <BadgeCheck size={13} aria-hidden />
                              {t('suggestions.verified')}
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 text-xs text-ink/60">
                          {[[c.city, c.district].filter(Boolean).join(', '), t('suggestions.years', { years: c.yearsExperience }), shifts.join(' / ')].filter(Boolean).join(' · ')}
                        </p>
                        {c.skills.length > 0 && <p className="mt-1 text-xs text-ink/70">{c.skills.slice(0, 6).join(', ')}</p>}
                        {c.aiReason ? (
                          <p className="mt-1 text-sm text-ink">{c.aiReason}</p>
                        ) : (
                          c.reasons.length > 0 && <p className="mt-1 text-xs text-ink/60">{c.reasons.slice(0, 3).join('; ')}</p>
                        )}
                      </div>
                      {request.canChangeCaregiver &&
                        (attached ? (
                          <span className="text-xs font-medium text-brand-dark">{t('suggestions.attached')}</span>
                        ) : (
                          <Button size="sm" variant="secondary" disabled={attach.isPending} onClick={() => attach.mutate(c.caregiverId)}>
                            {request.caregiver ? t('suggestions.swap') : t('suggestions.attach')}
                          </Button>
                        ))}
                    </li>
                  );
                })}
              </ul>
            )}
            {attach.isError && (
              <p role="alert" className="mt-2 text-sm text-danger">
                {attach.error instanceof ApiError ? attach.error.message : t('requests.detail.saveFailed')}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
