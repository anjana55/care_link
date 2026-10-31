import { useState } from 'react';
import { Linking, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Redirect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Experience, OwnCaregiver, Qualification, VerificationStatus } from '@care-platform/shared';
import { ApiError } from '@/api';
import { useAuth } from '@/auth/AuthProvider';
import { useCatalog, useMyRecords, useOwnCaregiver, useToggleAssignment, useUpdateOwnProfile } from '@/caregiver/api';
import { changesBetween, CONTACT_METHODS, contactDetailsOf, identityLocked, problemsIn, type ContactDetails } from '@/caregiver/profile';
import { config } from '@/config';
import { useTranslation } from '@/i18n';
import { useCities, useDistricts } from '@/search/api';
import { useColors } from '@/theme';
import { Chips, SelectField } from '@/ui/choices';
import { Button, Field } from '@/ui/controls';
import { formatDate } from '@/ui/dates';
import { Text } from '@/ui/Text';

/** The caregiver's profile on the website, for what the app only shows. */
const websiteProfile = () => `${config.siteUrl}/caregiver/profile`;

/**
 * The caregiver's profile, as on the website: their details, skills and
 * languages, qualifications and work history. In the app they change their
 * contact details, address and emergency contact, and tick skills and
 * languages; identity and the qualification and work records are shown, with
 * a link to the website to change them.
 */
export default function Profile() {
  const { t } = useTranslation();
  const colors = useColors();
  const { user } = useAuth();
  const record = useOwnCaregiver();

  if (!user) return <Redirect href="/" />;
  if (user.role !== 'CAREGIVER') return <Redirect href="/find" />;

  const c = record.data;
  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        contentContainerStyle={styles.page}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={record.isRefetching} onRefresh={() => void record.refetch()} />}
      >
        <View style={{ gap: 6 }}>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>
            {t('portal.profile.title')}
          </Text>
          <Text style={{ fontSize: 15, lineHeight: 22, color: colors.muted }}>{t('portal.profile.subtitle')}</Text>
        </View>
        {record.isLoading ? <Text style={{ color: colors.muted }}>{t('common.loading')}</Text> : null}
        {record.isError ? (
          <View style={{ gap: 8 }}>
            <Text style={{ color: colors.danger }}>{t('portal.loadError')}</Text>
            <Button variant="secondary" label={t('common.retry')} onPress={() => void record.refetch()} />
          </View>
        ) : null}
        {c ? (
          <>
            <Identity caregiver={c} />
            <ContactForm key={c.id} caregiver={c} />
            <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
              <Catalog kind="skills" selected={c.skills.map((s) => s.skillId)} />
              <Catalog kind="languages" selected={c.languages.map((l) => l.languageId)} />
            </View>
            <Records />
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  const colors = useColors();
  return (
    <View style={{ gap: 2 }}>
      <Text style={{ fontSize: 13, color: colors.muted }}>{label}</Text>
      <Text style={{ fontSize: 16, color: colors.ink }}>{value}</Text>
      {hint ? <Text style={{ fontSize: 13, lineHeight: 18, color: colors.muted }}>{hint}</Text> : null}
    </View>
  );
}

/** Who the caregiver is: shown, never edited here. */
function Identity({ caregiver: c }: { caregiver: OwnCaregiver }) {
  const { t, locale } = useTranslation();
  const colors = useColors();
  const locked = identityLocked(c.status);
  return (
    <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
      <Text accessibilityRole="header" style={[styles.section, { color: colors.ink }]}>
        {t('portal.profile.personal')}
      </Text>
      <Row label={t('portal.profile.loginPhone')} value={c.primaryPhone} hint={t('portal.profile.loginPhoneHint')} />
      <Row label={t('personalInfo.fields.fullName')} value={c.fullName} />
      <Row label={t('personalInfo.fields.dateOfBirth')} value={formatDate(String(c.dateOfBirth).slice(0, 10), locale)} />
      <Row label={t('personalInfo.fields.gender')} value={t(`personalInfo.options.gender.${c.gender}`)} />
      {c.nic ? <Row label={t('personalInfo.fields.nic')} value={c.nic} /> : null}
      {c.passportNumber ? <Row label={t('personalInfo.fields.passportNumber')} value={c.passportNumber} /> : null}
      <Text style={{ fontSize: 14, lineHeight: 20, color: colors.muted }}>{t(locked ? 'portal.profile.identityLocked' : 'portal.profile.identityOnWebsite')}</Text>
      {locked ? null : <Button variant="link" label={t('portal.profile.openWebsite')} onPress={() => void Linking.openURL(websiteProfile())} />}
    </View>
  );
}

/** Contact details, address and emergency contact - always the caregiver's to change. */
function ContactForm({ caregiver }: { caregiver: OwnCaregiver }) {
  const { t, locale } = useTranslation();
  const colors = useColors();
  const update = useUpdateOwnProfile();
  // What the API holds: what "changed" is measured against, renewed by each save.
  const [before, setBefore] = useState(() => contactDetailsOf(caregiver));
  const [form, setForm] = useState<ContactDetails>(before);
  const [checked, setChecked] = useState(false);
  const [saved, setSaved] = useState(false);
  const districts = useDistricts(locale);
  const cities = useCities(form.districtId, locale);

  const set = <K extends keyof ContactDetails>(field: K, value: ContactDetails[K]) => {
    setSaved(false);
    setForm((f) => ({ ...f, [field]: value }));
  };
  const problems = problemsIn(form);
  const changes = changesBetween(before, form);
  const problem = (field: keyof typeof problems) => (checked && problems[field] ? t(`personalInfo.validation.${field}.${problems[field]}`) : null);

  const onSave = () => {
    setChecked(true);
    if (Object.keys(problems).length || !Object.keys(changes).length) return;
    update.mutate(changes, {
      onSuccess: (record) => {
        const now = contactDetailsOf(record);
        setBefore(now);
        setForm(now);
        setChecked(false);
        setSaved(true);
      },
    });
  };

  return (
    <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
      <Field
        label={t('personalInfo.fields.permanentAddress')}
        value={form.permanentAddress}
        onChangeText={(v) => set('permanentAddress', v)}
        error={problem('permanentAddress')}
        multiline
        autoComplete="street-address"
      />
      <SelectField
        label={t('personalInfo.fields.district')}
        choices={(districts.data ?? []).map((d) => ({ value: d.id, label: d.name }))}
        value={form.districtId}
        onChange={(v) => {
          // A new district needs its own city.
          if (v !== form.districtId) setForm((f) => ({ ...f, districtId: v, cityId: null }));
          setSaved(false);
        }}
        error={problem('district')}
      />
      <SelectField
        label={t('personalInfo.fields.city')}
        choices={(cities.data ?? []).map((c) => ({ value: c.id, label: c.subName ? `${c.name} (${c.subName})` : c.name }))}
        value={form.cityId}
        onChange={(v) => set('cityId', v)}
        disabled={form.districtId === null}
        error={problem('city')}
      />
      <Field
        label={t('personalInfo.fields.secondaryPhone')}
        value={form.secondaryPhone}
        onChangeText={(v) => set('secondaryPhone', v)}
        keyboardType="phone-pad"
        autoComplete="tel"
      />
      <Field
        label={t('personalInfo.fields.emergencyContactName')}
        value={form.emergencyContactName}
        onChangeText={(v) => set('emergencyContactName', v)}
        error={problem('emergencyContactName')}
      />
      <Field
        label={t('personalInfo.fields.emergencyContactNumber')}
        value={form.emergencyContactNumber}
        onChangeText={(v) => set('emergencyContactNumber', v)}
        error={problem('emergencyContactNumber')}
        keyboardType="phone-pad"
      />
      <Field
        label={t('personalInfo.fields.emergencyContactRelationship')}
        value={form.emergencyContactRelationship}
        onChangeText={(v) => set('emergencyContactRelationship', v)}
        error={problem('emergencyContactRelationship')}
      />
      <Chips
        label={t('personalInfo.fields.preferredContactMethod')}
        choices={CONTACT_METHODS.map((m) => ({ value: m, label: t(`personalInfo.options.contactMethod.${m}`) }))}
        selected={form.preferredContactMethod ? [form.preferredContactMethod] : []}
        onToggle={(m) => set('preferredContactMethod', m)}
      />
      {form.preferredContactMethod === 'PHONE_CALL' ? <Text style={{ fontSize: 13, lineHeight: 18, color: colors.muted }}>{t('personalInfo.hints.phoneCall')}</Text> : null}

      {update.error ? (
        <Text accessibilityRole="alert" style={{ color: colors.danger, fontSize: 15 }}>
          {update.error instanceof ApiError && update.error.message ? update.error.message : t('portal.saveError')}
        </Text>
      ) : null}
      {saved ? (
        <Text accessibilityLiveRegion="polite" style={{ color: colors.brand, fontSize: 15 }}>
          {t('portal.saved')}
        </Text>
      ) : null}
      <Button
        label={update.isPending ? t('common.loading') : t('common.save')}
        busy={update.isPending}
        disabled={!Object.keys(changes).length}
        onPress={() => !update.isPending && onSave()}
      />
    </View>
  );
}

/** Skills or languages, each tick saved straight away; the ticks show what the API holds. */
function Catalog({ kind, selected }: { kind: 'skills' | 'languages'; selected: string[] }) {
  const { t } = useTranslation();
  const colors = useColors();
  const catalog = useCatalog(kind);
  const toggle = useToggleAssignment(kind);
  const [error, setError] = useState<string | null>(null);
  const on = new Set(selected);

  return (
    <View style={{ gap: 8 }}>
      <Text accessibilityRole="header" style={[styles.section, { color: colors.ink }]}>
        {t(`portal.profile.${kind}`)}
      </Text>
      <Text style={{ fontSize: 13, lineHeight: 18, color: colors.muted }}>{t(`portal.profile.${kind}Hint`)}</Text>
      {catalog.isLoading ? <Text style={{ color: colors.muted }}>{t('common.loading')}</Text> : null}
      {catalog.isError ? <Text style={{ color: colors.danger }}>{t('portal.loadError')}</Text> : null}
      {catalog.data ? (
        <Chips
          multiple
          choices={catalog.data.map((item) => ({ value: item.id, label: item.name }))}
          selected={selected}
          onToggle={(itemId) => {
            if (toggle.isPending) return;
            setError(null);
            toggle.mutate(
              { itemId, assigned: on.has(itemId) },
              { onError: (err) => setError(err instanceof ApiError && err.message ? err.message : t('portal.saveError')) },
            );
          }}
        />
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" style={{ color: colors.danger }}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

function StatusBadge({ status }: { status: VerificationStatus }) {
  const { t } = useTranslation();
  const colors = useColors();
  const tone = status === 'REJECTED' ? colors.danger : status === 'VERIFIED' ? colors.brand : colors.ink;
  return <Text style={[styles.badge, { color: tone, borderColor: status === 'PENDING' || status === 'IN_PROGRESS' ? colors.border : tone }]}>{t(`portal.verification.${status}`)}</Text>;
}

/** Qualifications and work history: shown here, added and changed on the website. */
function Records() {
  const { t, locale } = useTranslation();
  const colors = useColors();
  const qualifications = useMyRecords<Qualification>('qualifications');
  const experiences = useMyRecords<Experience>('experiences');
  const day = (iso: string | null) => (iso ? formatDate(iso.slice(0, 10), locale) : t('portal.experience.present'));

  const section = <T extends { id: string; verificationStatus: VerificationStatus }>(
    title: string,
    none: string,
    query: { data?: T[]; isLoading: boolean; isError: boolean },
    titleOf: (r: T) => string,
    detailOf: (r: T) => string,
  ) => (
    <View style={{ gap: 10 }}>
      <Text accessibilityRole="header" style={[styles.section, { color: colors.ink }]}>
        {title}
      </Text>
      {query.isLoading ? <Text style={{ color: colors.muted }}>{t('common.loading')}</Text> : null}
      {query.isError ? <Text style={{ color: colors.danger }}>{t('portal.loadError')}</Text> : null}
      {query.data && !query.data.length ? <Text style={{ color: colors.muted, fontSize: 15 }}>{none}</Text> : null}
      {query.data?.map((r) => (
        <View key={r.id} style={[styles.record, { borderTopColor: colors.border }]}>
          <View style={styles.recordHead}>
            <Text style={{ flex: 1, fontSize: 16, fontWeight: '600', color: colors.ink }}>{titleOf(r)}</Text>
            <StatusBadge status={r.verificationStatus} />
          </View>
          <Text style={{ fontSize: 14, color: colors.muted }}>{detailOf(r)}</Text>
        </View>
      ))}
    </View>
  );

  return (
    <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
      {section(
        t('portal.qualifications.title'),
        t('portal.qualifications.none'),
        qualifications,
        (q) => q.name,
        (q) => [q.institution, t(`portal.qualifications.types.${q.type}`)].filter(Boolean).join(' · '),
      )}
      {section(
        t('portal.experience.title'),
        t('portal.experience.none'),
        experiences,
        (e) => `${e.role} — ${e.employerOrClient}`,
        (e) => [e.country, `${day(e.startDate)} → ${day(e.endDate)}`].filter(Boolean).join(' · '),
      )}
      <Text style={{ fontSize: 14, lineHeight: 20, color: colors.muted }}>{t('portal.profile.recordsOnWebsite')}</Text>
      <Button variant="secondary" label={t('portal.profile.openWebsite')} onPress={() => void Linking.openURL(websiteProfile())} />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: 20, paddingBottom: 40, gap: 16 },
  title: { fontSize: 26, fontWeight: '700' },
  section: { fontSize: 18, fontWeight: '700' },
  card: { borderWidth: 1, borderRadius: 14, padding: 16, gap: 14 },
  record: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10, gap: 4 },
  recordHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  badge: { fontSize: 12, fontWeight: '700', borderWidth: 1, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden' },
});
