'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { clientPriceFor, pricingRateTypeValues, type CareTypePricing, type PricingRateType } from '@care-platform/shared';
import { useAuth } from '@/lib/api/auth-context';
import { useTranslation } from '@/lib/i18n/provider';
import { ApiError } from '@/lib/api/client';
import { usePricing, useUpdatePricing } from '@/lib/hooks/use-pricing';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input, Label, Select } from '@/components/ui/input';

const money = (n: number) => n.toLocaleString('en-LK');
const isAmount = (v: string) => /^\d+(\.\d{1,2})?$/.test(v.trim());

/**
 * Settings > Rates and fees (admin): per kind of care, whether caregivers set
 * their own rate, the unit, the band, and the fee added for the client. Each
 * kind of care saves on its own.
 */
export default function PricingSettingsPage() {
  const { t } = useTranslation();
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const isAdmin = user?.role === 'ADMIN';
  const { data, isLoading } = usePricing(isAdmin);

  useEffect(() => {
    if (authLoading) return;
    if (user && !isAdmin) router.replace('/dashboard');
  }, [authLoading, user, isAdmin, router]);

  if (authLoading || !user || !isAdmin || isLoading || !data) {
    return <div className="flex min-h-[40vh] items-center justify-center text-sm text-ink/50">{t('common.loading')}</div>;
  }

  return (
    <div className="max-w-3xl">
      <h2 className="mb-1 text-lg font-semibold text-ink">{t('pricing.title')}</h2>
      <p className="mb-4 text-sm text-ink/60">{t('pricing.subtitle')}</p>
      <div className="space-y-4">
        {data.map((p) => (
          <CareTypeCard key={p.careType} pricing={p} />
        ))}
      </div>
    </div>
  );
}

function CareTypeCard({ pricing }: { pricing: CareTypePricing }) {
  const { t } = useTranslation();
  const update = useUpdatePricing();
  const toDraft = (p: CareTypePricing) => ({ enabled: p.enabled, rateType: p.rateType, minRate: String(p.minRate), maxRate: String(p.maxRate), feePercent: String(p.feePercent) });
  const [draft, setDraft] = useState(() => toDraft(pricing));
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) => (setSaved(false), setError(null), setDraft({ ...draft, [key]: value }));

  const valid = isAmount(draft.minRate) && isAmount(draft.maxRate) && isAmount(draft.feePercent) && Number(draft.maxRate) >= Number(draft.minRate) && Number(draft.feePercent) <= 100;
  const id = (f: string) => `${pricing.careType}-${f}`;
  const unit = t(`pricing.units.${draft.rateType}`);
  const sample = valid ? Number(draft.minRate) : null;

  const submit = () =>
    update.mutate(
      { careType: pricing.careType, values: { enabled: draft.enabled, rateType: draft.rateType, minRate: Number(draft.minRate), maxRate: Number(draft.maxRate), feePercent: Number(draft.feePercent) } },
      {
        onSuccess: (all) => {
          setDraft(toDraft(all.find((p) => p.careType === pricing.careType)!));
          setSaved(true);
        },
        onError: (err) => setError(err instanceof ApiError && err.message ? err.message : t('pricing.error')),
      },
    );

  return (
    <Card>
      <CardContent className="space-y-3 pt-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-ink">{t(`careTypes.${pricing.careType}`)}</h3>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" className="h-4 w-4 accent-brand" checked={draft.enabled} onChange={(e) => set('enabled', e.target.checked)} />
            {t('pricing.enabled')}
          </label>
        </div>
        <div className="grid gap-4 sm:grid-cols-4">
          <div>
            <Label htmlFor={id('unit')}>{t('pricing.unit')}</Label>
            <Select id={id('unit')} value={draft.rateType} onChange={(e) => set('rateType', e.target.value as PricingRateType)}>
              {pricingRateTypeValues.map((r) => (
                <option key={r} value={r}>
                  {t(`pricing.units.${r}`)}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor={id('min')}>{t('pricing.min')}</Label>
            <Input id={id('min')} inputMode="decimal" value={draft.minRate} aria-invalid={!isAmount(draft.minRate)} onChange={(e) => set('minRate', e.target.value)} />
          </div>
          <div>
            <Label htmlFor={id('max')}>{t('pricing.max')}</Label>
            <Input id={id('max')} inputMode="decimal" value={draft.maxRate} aria-invalid={!isAmount(draft.maxRate) || Number(draft.maxRate) < Number(draft.minRate)} onChange={(e) => set('maxRate', e.target.value)} />
          </div>
          <div>
            <Label htmlFor={id('fee')}>{t('pricing.fee')}</Label>
            <Input id={id('fee')} inputMode="decimal" value={draft.feePercent} aria-invalid={!isAmount(draft.feePercent) || Number(draft.feePercent) > 100} onChange={(e) => set('feePercent', e.target.value)} />
          </div>
        </div>
        {sample !== null && sample > 0 && (
          <p className="text-xs text-ink/60">{t('pricing.example', { rate: money(sample), unit, price: money(clientPriceFor(sample, Number(draft.feePercent))) })}</p>
        )}
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <div className="flex items-center gap-3">
          <Button size="sm" onClick={submit} disabled={update.isPending || !valid}>
            {update.isPending ? t('common.loading') : t('pricing.save')}
          </Button>
          {saved && (
            <span role="status" className="text-sm text-brand-dark">
              {t('pricing.saved')}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
