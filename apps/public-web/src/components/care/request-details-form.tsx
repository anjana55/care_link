'use client';

import { useMemo, useState } from 'react';
import { careTypeValues, type ClientCareRequest, type ClientRequestDetailsInput, type IntakeGap } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n';
import { ApiError } from '@/lib/api/client';
import { useAddRequestDetails } from '@/lib/hooks/use-client-care';
import { useCities, useLocationTree } from '@/lib/hooks/use-public-search';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/input';

const SCHEDULES = ['DAY', 'NIGHT', 'LIVE_IN_24H'] as const;

/**
 * The few details we asked the client for, so matching and the booking can go
 * ahead. Only the asked-for fields are shown, and all of them are needed.
 */
export function RequestDetailsForm({ request }: { request: ClientCareRequest }) {
  const { t, locale } = useTranslation();
  const save = useAddRequestDetails();
  const needs = (g: IntakeGap) => (request.detailsNeeded ?? []).includes(g);
  const [careType, setCareType] = useState('');
  const [districtId, setDistrictId] = useState('');
  const [cityId, setCityId] = useState('');
  const [schedule, setSchedule] = useState('');
  const [startDate, setStartDate] = useState('');
  const [tried, setTried] = useState(false);
  const { data: tree = [] } = useLocationTree(locale);
  const districts = useMemo(() => tree.flatMap((p) => p.districts).sort((a, b) => a.name.localeCompare(b.name, locale)), [tree, locale]);
  const { data: cities = [] } = useCities(needs('AREA') && districtId ? Number(districtId) : null, locale);
  if (!request.detailsNeeded?.length) return null;

  const missing = (needs('CARE_TYPE') && !careType) || (needs('AREA') && !districtId) || (needs('SCHEDULE') && !schedule) || (needs('START_DATE') && !startDate);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (missing) return;
    const body: ClientRequestDetailsInput = {
      ...(needs('CARE_TYPE') ? { careType: careType as ClientRequestDetailsInput['careType'] } : {}),
      ...(needs('AREA') ? { districtId: Number(districtId), ...(cityId ? { cityId: Number(cityId) } : {}) } : {}),
      ...(needs('SCHEDULE') ? { schedule: schedule as ClientRequestDetailsInput['schedule'] } : {}),
      ...(needs('START_DATE') ? { desiredStartDate: startDate } : {}),
    };
    save.mutate({ id: request.id, body });
  };
  const error = save.error instanceof ApiError && save.error.message ? save.error.message : save.error ? t('care.actionError') : tried && missing ? t('account.requests.details.fillAll') : null;
  const id = (f: string) => `details-${request.id}-${f}`;

  return (
    <form onSubmit={submit} className="mt-3 rounded-DEFAULT border border-accent/30 bg-accent-light p-3" data-testid="request-details">
      <p className="text-sm font-medium text-ink">{t('account.requests.details.title')}</p>
      <p className="mt-0.5 text-xs text-ink/60">{t('account.requests.details.why')}</p>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {needs('CARE_TYPE') && (
          <div>
            <Label htmlFor={id('care')} required>{t('account.requests.details.careType')}</Label>
            <Select id={id('care')} value={careType} onChange={(e) => setCareType(e.target.value)}>
              <option value="">{t('care.findDialog.choose')}</option>
              {careTypeValues.map((c) => <option key={c} value={c}>{t(`careTypes.${c}`)}</option>)}
            </Select>
          </div>
        )}
        {needs('SCHEDULE') && (
          <div>
            <Label htmlFor={id('schedule')} required>{t('account.requests.details.schedule')}</Label>
            <Select id={id('schedule')} value={schedule} onChange={(e) => setSchedule(e.target.value)}>
              <option value="">{t('care.findDialog.choose')}</option>
              {SCHEDULES.map((s) => <option key={s} value={s}>{t(`patientIntake.options.careSchedule.${s}`)}</option>)}
            </Select>
          </div>
        )}
        {needs('AREA') && (
          <>
            <div>
              <Label htmlFor={id('district')} required>{t('normalSearch.district')}</Label>
              <Select id={id('district')} value={districtId} onChange={(e) => { setDistrictId(e.target.value); setCityId(''); }}>
                <option value="">{t('care.findDialog.choose')}</option>
                {districts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </Select>
            </div>
            <div>
              <Label htmlFor={id('city')}>{t('normalSearch.city')}</Label>
              <Select id={id('city')} value={cityId} onChange={(e) => setCityId(e.target.value)} disabled={!districtId}>
                <option value="">{t('normalSearch.anyCity')}</option>
                {cities.map((c) => <option key={c.id} value={c.id}>{c.subName ? `${c.name} - ${c.subName}` : c.name}</option>)}
              </Select>
            </div>
          </>
        )}
        {needs('START_DATE') && (
          <div>
            <Label htmlFor={id('start')} required>{t('normalSearch.startDate')}</Label>
            <Input id={id('start')} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
        )}
      </div>
      {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
      <Button type="submit" size="sm" className="mt-3" disabled={save.isPending}>{t('account.requests.details.send')}</Button>
    </form>
  );
}
