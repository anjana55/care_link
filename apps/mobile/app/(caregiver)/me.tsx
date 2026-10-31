import { ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '@/auth/AuthProvider';
import { useTranslation } from '@/i18n';
import { useColors } from '@/theme';
import { Button, Screen } from '@/ui/controls';
import { LanguagePicker } from '@/ui/LanguagePicker';
import { Text } from '@/ui/Text';
import { useOwnCaregiver } from '@/caregiver/api';

/**
 * The caregiver's account: who they are, their documents, the app's language,
 * and signing out. The profile comes here in Phase 3c.
 */
export default function Me() {
  const { t } = useTranslation();
  const colors = useColors();
  const router = useRouter();
  const { user, signOut } = useAuth();
  const { data: c } = useOwnCaregiver();

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.body}>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>
          {t('nav.myAccount')}
        </Text>
        <View style={styles.section}>
          {c ? <Text style={{ fontSize: 20, fontWeight: '600', color: colors.ink }}>{c.fullName}</Text> : null}
          {c ? (
            <Text style={{ color: colors.muted, fontSize: 15 }}>
              {t('portal.registrationNumber')} {c.registrationNumber}
            </Text>
          ) : null}
          {user?.phone || user?.email ? <Text style={{ color: colors.muted, fontSize: 16 }}>{user.phone ?? user.email}</Text> : null}
        </View>
        <Button variant="secondary" label={t('portal.nav.documents')} onPress={() => router.navigate('/documents')} />
        <View style={styles.section}>
          <Text style={[styles.label, { color: colors.ink }]}>{t('common.language')}</Text>
          <LanguagePicker />
        </View>
        <Button
          variant="secondary"
          label={t('nav.signOut')}
          onPress={async () => {
            await signOut();
            router.replace('/');
          }}
        />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { paddingTop: 24, paddingBottom: 32, gap: 28 },
  title: { fontSize: 26, fontWeight: '700' },
  section: { gap: 8 },
  label: { fontSize: 15, fontWeight: '600' },
});
