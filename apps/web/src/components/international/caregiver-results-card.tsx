'use client';

import { useState } from 'react';
import { ASSESSMENT_LIMITS, assessmentKindValues, assessmentProviderValues, cefrLevelValues, type AssessmentInput } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n/provider';
import { useAssessmentActions, useAssessments } from '@/lib/hooks/use-international';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Select } from '@/components/ui/input';
import { ResultRow } from './results-tab';

const EMPTY: AssessmentInput = { kind: 'ENGLISH', provider: 'PLATFORM', title: '', score: '', cefrLevel: null, takenOn: '', validUntil: '', note: '' };

/**
 * A caregiver's test results, on their profile. Staff record results here -
 * verified at once, since they are looking at the original - and verify the
 * ones the caregiver added.
 */
export function CaregiverResultsCard({ caregiverId }: { caregiverId: string }) {
  const { t } = useTranslation();
  const { data = [], isLoading } = useAssessments({ status: 'all', caregiverId });
  const { record } = useAssessmentActions();
  const [adding, setAdding] = useState(false);
  const [v, setV] = useState<AssessmentInput>(EMPTY);
  const set = (patch: Partial<AssessmentInput>) => setV((x) => ({ ...x, ...patch }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('international.results.cardTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading && <p className="text-sm text-ink/50">{t('common.loading')}</p>}
        {!isLoading && data.length === 0 && <p className="text-sm text-ink/50">{t('international.results.noneForCaregiver')}</p>}
        {data.length > 0 && (
          <ul className="divide-y divide-border rounded border border-border">
            {data.map((a) => (
              <ResultRow key={a.id} result={a} showCaregiver={false} />
            ))}
          </ul>
        )}
        {!adding ? (
          <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
            {t('international.results.record')}
          </Button>
        ) : (
          <form
            className="space-y-3 rounded border border-dashed border-brand/40 p-3"
            onSubmit={(e) => {
              e.preventDefault();
              record.mutate(
                { caregiverId, body: { ...v, score: v.score || null, cefrLevel: v.cefrLevel || null, validUntil: v.validUntil || null, note: v.note || null } },
                { onSuccess: () => (setV(EMPTY), setAdding(false)) },
              );
            }}
          >
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <Label htmlFor="ra-kind">{t('international.results.kindLabel')}</Label>
                <Select id="ra-kind" value={v.kind} onChange={(e) => set({ kind: e.target.value as AssessmentInput['kind'] })}>
                  {assessmentKindValues.map((k) => (
                    <option key={k} value={k}>
                      {t(`international.results.kind.${k}`)}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="ra-prov">{t('international.results.providerLabel')}</Label>
                <Select id="ra-prov" value={v.provider} onChange={(e) => set({ provider: e.target.value as AssessmentInput['provider'] })}>
                  {assessmentProviderValues.map((p) => (
                    <option key={p} value={p}>
                      {t(`international.results.provider.${p}`)}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="ra-title">{t('international.results.title')}</Label>
                <Input id="ra-title" value={v.title} onChange={(e) => set({ title: e.target.value })} maxLength={ASSESSMENT_LIMITS.title} required />
              </div>
              <div>
                <Label htmlFor="ra-score">{t('international.results.score')}</Label>
                <Input id="ra-score" value={v.score ?? ''} onChange={(e) => set({ score: e.target.value })} maxLength={ASSESSMENT_LIMITS.score} />
              </div>
              <div>
                <Label htmlFor="ra-cefr">{t('international.results.cefr')}</Label>
                <Select id="ra-cefr" value={v.cefrLevel ?? ''} onChange={(e) => set({ cefrLevel: (e.target.value || null) as AssessmentInput['cefrLevel'] })}>
                  <option value="">-</option>
                  {cefrLevelValues.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="ra-taken">{t('international.results.takenOn')}</Label>
                <Input id="ra-taken" type="date" value={v.takenOn} onChange={(e) => set({ takenOn: e.target.value })} required />
              </div>
              <div>
                <Label htmlFor="ra-valid">{t('international.results.validUntil')}</Label>
                <Input id="ra-valid" type="date" value={v.validUntil ?? ''} onChange={(e) => set({ validUntil: e.target.value })} />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="ra-note">{t('international.results.note')}</Label>
                <Input id="ra-note" value={v.note ?? ''} onChange={(e) => set({ note: e.target.value })} maxLength={ASSESSMENT_LIMITS.note} />
              </div>
            </div>
            {record.isError && <p className="text-xs text-danger">{record.error instanceof Error ? record.error.message : t('common.actionFailed')}</p>}
            <div className="flex gap-2">
              <Button size="sm" type="submit" disabled={record.isPending || !v.title.trim() || !v.takenOn}>
                {t('common.save')}
              </Button>
              <Button size="sm" type="button" variant="ghost" onClick={() => setAdding(false)}>
                {t('common.cancel')}
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
