import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { careTypeValues, colomboToday, type CareType, type GenderPreference, type SearchRequest } from '@care-platform/shared';
import { useTranslation } from '@/i18n';
import { useColors } from '@/theme';
import { Button } from '@/ui/controls';
import { Chips, SelectField } from '@/ui/choices';
import { Text } from '@/ui/Text';
import { useCities, useDistricts, useSkills } from './api';

/** YYYY-MM-DD plus `n` days, as dates (no time zone can shift it). */
export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The next two weeks as one-tap start dates - a date picker would need a native module this build doesn't have. */
const START_DAYS = 14;

/**
 * Normal Search, as on the website: the type of care, the district and the
 * start date are required; city, caregiver gender and must-have skills narrow it.
 */
export function NormalSearchForm({ initial, onSearch }: { initial?: SearchRequest | null; onSearch: (request: SearchRequest) => void }) {
  const { t, locale } = useTranslation();
  const colors = useColors();
  const today = colomboToday();
  const [careType, setCareType] = useState<CareType | null>(initial?.careType ?? null);
  const [districtId, setDistrictId] = useState<number | null>(initial?.location?.districtId ?? null);
  const [cityId, setCityId] = useState<number | null>(initial?.location?.cityId ?? null);
  const [startDate, setStartDate] = useState<string>(initial?.desiredStartDate ?? today);
  const [gender, setGender] = useState<GenderPreference>(initial?.caregiverGenderPreference ?? 'ANY');
  const [skillIds, setSkillIds] = useState<string[]>(initial?.mandatorySkillIds ?? []);
  const [tried, setTried] = useState(false);

  const districts = useDistricts(locale);
  const cities = useCities(districtId, locale);
  const { data: skills = [] } = useSkills();

  const dateLabel = (date: string) =>
    new Date(`${date}T00:00:00Z`).toLocaleDateString(locale === 'en' ? 'en-GB' : locale, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    });

  const submit = () => {
    setTried(true);
    if (!careType || !districtId) return;
    onSearch({
      careType,
      location: { districtId, ...(cityId ? { cityId } : {}) },
      desiredStartDate: startDate,
      caregiverGenderPreference: gender,
      ...(skillIds.length ? { mandatorySkillIds: skillIds } : {}),
    });
  };

  return (
    <View style={styles.form}>
      <Chips
        label={t('normalSearch.careType')}
        choices={careTypeValues.map((v) => ({ value: v, label: t(`careTypes.${v}`) }))}
        selected={careType ? [careType] : []}
        onToggle={setCareType}
        error={tried && !careType ? t('normalSearch.errors.careTypeRequired') : null}
      />

      {districts.isError ? <Text style={{ color: colors.danger }}>{t('normalSearch.locationsUnavailable')}</Text> : null}
      <SelectField
        label={t('normalSearch.district')}
        choices={(districts.data ?? []).map((d) => ({ value: d.id, label: d.name }))}
        value={districtId}
        onChange={(id) => {
          setDistrictId(id);
          setCityId(null);
        }}
        none={t('normalSearch.anyDistrict')}
        error={tried && !districtId ? t('normalSearch.errors.districtRequired') : null}
      />
      <SelectField
        label={t('normalSearch.city')}
        choices={(cities.data ?? []).map((c) => ({ value: c.id, label: c.subName ? `${c.name} (${c.subName})` : c.name }))}
        value={cityId}
        onChange={setCityId}
        none={t('normalSearch.anyCity')}
        disabled={!districtId}
      />

      <Chips
        label={t('normalSearch.startDate')}
        choices={Array.from({ length: START_DAYS }, (_, i) => {
          const date = addDays(today, i);
          return { value: date, label: dateLabel(date) };
        })}
        selected={[startDate]}
        onToggle={setStartDate}
      />

      <Chips
        label={t('normalSearch.preferredGender')}
        choices={[
          { value: 'ANY' as const, label: t('normalSearch.genderAny') },
          { value: 'FEMALE' as const, label: t('normalSearch.genderFemale') },
          { value: 'MALE' as const, label: t('normalSearch.genderMale') },
        ]}
        selected={[gender]}
        onToggle={setGender}
      />

      {skills.length ? (
        <Chips
          multiple
          label={t('normalSearch.mandatorySkills')}
          choices={skills.map((s) => ({ value: s.id, label: s.name }))}
          selected={skillIds}
          onToggle={(id) => setSkillIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id].slice(0, 15)))}
        />
      ) : null}

      <Button label={t('normalSearch.submit')} onPress={submit} />
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: 20 },
});
