import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ApiError } from '@/api';
import { useTranslation } from '@/i18n';
import { useColors } from '@/theme';
import { Button, Screen } from '@/ui/controls';
import { Text } from '@/ui/Text';
import { useCaregiverProfile } from '@/search/api';
import { shortId } from '@/search/ResultCard';
import { CaregiverActions } from '@/care/CaregiverActions';

/**
 * A caregiver's public profile, as on the website: no name, photo or contact
 * details - those go through staff (Contact sends our team a request).
 */
export default function CaregiverProfile() {
  const { t, locale } = useTranslation();
  const colors = useColors();
  const router = useRouter();
  const { publicId } = useLocalSearchParams<{ publicId?: string }>();
  const { data: c, isLoading, isError, error, refetch } = useCaregiverProfile(publicId ?? null, locale);
  const notFound = error instanceof ApiError && error.status === 404;

  const back = <Button variant="link" label={`‹ ${t('profile.backToResults')}`} onPress={() => (router.canGoBack?.() ? router.back() : router.replace('/find'))} />;

  if (isLoading) {
    return (
      <Screen>
        {back}
        <View accessibilityRole="progressbar" style={styles.state}>
          <ActivityIndicator color={colors.brand} />
        </View>
      </Screen>
    );
  }
  if (isError || !c) {
    return (
      <Screen>
        {back}
        <View accessibilityRole="alert" style={styles.state}>
          <Text style={{ color: colors.ink, fontSize: 17, textAlign: 'center' }}>{notFound ? t('profile.notFound') : t('error.title')}</Text>
          {notFound ? null : <Button variant="secondary" label={t('error.retry')} onPress={() => refetch()} />}
        </View>
      </Screen>
    );
  }

  const sign = c.gender === 'FEMALE' ? '♀ ' : c.gender === 'MALE' ? '♂ ' : '';
  const availability = [
    c.availability.dayDuty && t('profile.availabilityDay'),
    c.availability.nightDuty && t('profile.availabilityNight'),
    c.availability.liveIn24h && t('profile.availabilityLiveIn'),
  ].filter(Boolean) as string[];

  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: colors.muted }]}>{title}</Text>
      {children}
    </View>
  );
  const body = (text: string) => <Text style={[styles.body, { color: colors.ink }]}>{text}</Text>;

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.page}>
        {back}
        <View style={styles.head}>
          <Text style={[styles.id, { color: colors.muted }]}>{t('profile.anonymousId', { id: shortId(c.publicId) })}</Text>
          {c.verified ? (
            <Text accessibilityHint={t('results.verifiedHint')} style={[styles.badge, { color: colors.brand, borderColor: colors.brand }]}>
              ✓ {t('results.verified')}
            </Text>
          ) : null}
        </View>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>
          {sign}
          {t('results.approxAge', { age: c.approxAge })}
        </Text>
        <Text style={[styles.body, { color: colors.muted }]}>{t('results.yearsExperience', { years: c.yearsExperience })}</Text>
        {c.hasVerifiedQualification ? <Text style={[styles.body, { color: colors.brand, fontWeight: '600' }]}>{t('results.verifiedQualification')}</Text> : null}

        {c.careTypes?.length ? <Section title={t('profile.careTypes')}>{body(c.careTypes.map((ct) => t(`careTypes.${ct}`)).join(' · '))}</Section> : null}
        <Section title={`${t('profile.district')} / ${t('profile.city')}`}>{body([c.city, c.district].filter(Boolean).join(', ') || '—')}</Section>
        {c.preferredLocations.length ? <Section title={t('profile.preferredLocations')}>{body(c.preferredLocations.join(', '))}</Section> : null}
        {c.languages.length ? <Section title={t('profile.languages')}>{body(c.languages.map((l) => `${l.name} (${l.proficiency})`).join(', '))}</Section> : null}
        {availability.length ? <Section title={t('profile.availability')}>{body(availability.join(' · '))}</Section> : null}
        {c.skills.length ? (
          <Section title={t('profile.skills')}>
            <View style={styles.skills}>
              {c.skills.map((s) => (
                <Text key={s.id} style={[styles.skill, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.ink }]}>
                  ✓ {s.name}
                </Text>
              ))}
            </View>
          </Section>
        ) : null}
        {c.relevantExperienceSummary.length ? (
          <Section title={t('profile.relevantExperience')}>{c.relevantExperienceSummary.map((e, i) => <View key={i}>{body(`• ${e}`)}</View>)}</Section>
        ) : null}
        {c.qualificationSummary.length ? (
          <Section title={t('profile.qualifications')}>{c.qualificationSummary.map((q, i) => <View key={i}>{body(`• ${q}`)}</View>)}</Section>
        ) : null}

        <CaregiverActions publicId={c.publicId} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  page: { paddingBottom: 40, gap: 10 },
  state: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  id: { fontSize: 12, fontWeight: '600', letterSpacing: 0.5, textTransform: 'uppercase' },
  badge: { fontSize: 12, fontWeight: '700', borderWidth: 1, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden' },
  title: { fontSize: 26, fontWeight: '700' },
  section: { gap: 4, marginTop: 12 },
  sectionTitle: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' },
  body: { fontSize: 16, lineHeight: 24 },
  skills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  skill: { fontSize: 14, borderWidth: 1, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 4, overflow: 'hidden' },
});
