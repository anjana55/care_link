import { Linking, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '@/auth/AuthProvider';
import { registerUrl } from '@/auth/sides';
import { useTranslation } from '@/i18n';
import { useColors } from '@/theme';
import { Button, Screen } from '@/ui/controls';
import { LanguagePicker } from '@/ui/LanguagePicker';
import { Text } from '@/ui/Text';

/**
 * A client's account. Signed out: sign in or sign up (searching doesn't need
 * it; contacting and saving caregivers will). Signed in: who they are, the
 * app's language, and signing out.
 */
export default function Account() {
  const { t } = useTranslation();
  const colors = useColors();
  const router = useRouter();
  const { user, signOut } = useAuth();

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.body}>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>
          {t('nav.myAccount')}
        </Text>

        {user ? (
          <View style={styles.section}>
            <Text style={[styles.lead, { color: colors.ink }]}>{t('home.welcome')}</Text>
            {user.phone || user.email ? <Text style={{ color: colors.muted, fontSize: 16 }}>{user.phone ?? user.email}</Text> : null}
          </View>
        ) : (
          <View style={styles.section}>
            <Button label={t('signIn.client')} onPress={() => router.push({ pathname: '/sign-in', params: { role: 'client' } })} />
            <View style={styles.row}>
              <Text style={{ color: colors.muted, fontSize: 15 }}>{t('signIn.noAccount')}</Text>
              <Button variant="link" label={t('signIn.signUp')} onPress={() => Linking.openURL(registerUrl('client'))} />
            </View>
          </View>
        )}

        <View style={styles.section}>
          <Text style={[styles.label, { color: colors.ink }]}>{t('common.language')}</Text>
          <LanguagePicker />
        </View>

        {user ? (
          <Button
            variant="secondary"
            label={t('nav.signOut')}
            onPress={async () => {
              await signOut();
              router.replace('/');
            }}
          />
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { paddingTop: 24, paddingBottom: 32, gap: 28 },
  title: { fontSize: 26, fontWeight: '700' },
  section: { gap: 12 },
  lead: { fontSize: 20, fontWeight: '600' },
  label: { fontSize: 15, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
});
