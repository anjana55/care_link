import { useState } from 'react';
import { View } from 'react-native';
import { careTypeValues, colomboToday, type CareType, type ClientCareRequest, type ClientRequestDetailsInput, type IntakeGap } from '@care-platform/shared';
import { ApiError } from '@/api';
import { useTranslation } from '@/i18n';
import { useColors } from '@/theme';
import { Button, FormError } from '@/ui/controls';
import { Chips, SelectField } from '@/ui/choices';
import { Text } from '@/ui/Text';
import { DateField } from '@/ui/Calendar';
import { useCities, useDistricts } from '@/search/api';
import { addDays } from '@/search/NormalSearchForm';
import { useAddRequestDetails } from './api';

type Schedule = NonNullable<ClientRequestDetailsInput['schedule']>;
const SCHEDULES: Schedule[] = ['DAY', 'NIGHT', 'LIVE_IN_24H'];

/** The few details we asked for on an open request; only those fields, all needed. */
export function RequestDetails({ request }: { request: ClientCareRequest }) {
  const { t, locale } = useTranslation();
  const colors = useColors();
  const save = useAddRequestDetails();
  const needs = (g: IntakeGap) => (request.detailsNeeded ?? []).includes(g);
  const [careType, setCareType] = useState<CareType | null>(null);
  const [districtId, setDistrictId] = useState<number | null>(null);
  const [cityId, setCityId] = useState<number | null>(null);
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [startDate, setStartDate] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const districts = useDistricts(locale);
  const cities = useCities(needs('AREA') ? districtId : null, locale);
  if (!request.detailsNeeded?.length) return null;

  const missing = (needs('CARE_TYPE') && !careType) || (needs('AREA') && !districtId) || (needs('SCHEDULE') && !schedule) || (needs('START_DATE') && !startDate);
  const send = () => {
    setTried(true);
    if (missing) return;
    save.mutate({
      id: request.id,
      body: {
        ...(needs('CARE_TYPE') ? { careType: careType! } : {}),
        ...(needs('AREA') ? { districtId: districtId!, ...(cityId ? { cityId } : {}) } : {}),
        ...(needs('SCHEDULE') ? { schedule: schedule! } : {}),
        ...(needs('START_DATE') ? { desiredStartDate: startDate! } : {}),
      },
    });
  };
  const error = save.error instanceof ApiError && save.error.message ? save.error.message : save.error ? t('care.actionError') : tried && missing ? t('account.requests.details.fillAll') : null;

  return (
    <View testID="request-details" style={{ gap: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12, marginTop: 4 }}>
      <Text style={{ fontSize: 16, fontWeight: '700', color: colors.ink }}>{t('account.requests.details.title')}</Text>
      <Text style={{ fontSize: 14, color: colors.muted }}>{t('account.requests.details.why')}</Text>
      {needs('CARE_TYPE') ? (
        <Chips label={t('account.requests.details.careType')} choices={careTypeValues.map((v) => ({ value: v, label: t(`careTypes.${v}`) }))} selected={careType ? [careType] : []} onToggle={setCareType} />
      ) : null}
      {needs('SCHEDULE') ? (
        <Chips label={t('account.requests.details.schedule')} choices={SCHEDULES.map((v) => ({ value: v, label: t(`account.requests.details.schedules.${v}`) }))} selected={schedule ? [schedule] : []} onToggle={setSchedule} />
      ) : null}
      {needs('AREA') ? (
        <>
          <SelectField
            label={t('normalSearch.district')}
            choices={(districts.data ?? []).map((d) => ({ value: d.id, label: d.name }))}
            value={districtId}
            onChange={(id) => {
              setDistrictId(id);
              setCityId(null);
            }}
            none={t('care.findDialog.choose')}
          />
          <SelectField
            label={t('normalSearch.city')}
            choices={(cities.data ?? []).map((c) => ({ value: c.id, label: c.subName ? `${c.name} (${c.subName})` : c.name }))}
            value={cityId}
            onChange={setCityId}
            none={t('normalSearch.anyCity')}
            disabled={!districtId}
          />
        </>
      ) : null}
      {needs('START_DATE') ? (
        <DateField label={t('normalSearch.startDate')} value={startDate} onChange={setStartDate} today={colomboToday()} min={colomboToday()} max={addDays(colomboToday(), 365)} none={t('calendar.choose')} />
      ) : null}
      <FormError message={error} />
      <Button label={t('account.requests.details.send')} busy={save.isPending} onPress={send} />
    </View>
  );
}
