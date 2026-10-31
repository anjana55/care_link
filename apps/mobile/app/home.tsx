import { StyleSheet, View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { useAuth } from '@/auth/AuthProvider';
import { useTranslation } from '@/i18n';
import { useBranding } from '@/branding/BrandingProvider';
import { useColors } from '@/theme';
import { Button, Screen } from '@/ui/controls';
import { Text } from '@/ui/Text';

/**
 * Where a signed-in person lands. A placeholder for the caregiver and client
 * areas that come in Phases 2 and 3: today it proves sign-in end to end.
 */
export default function Home() {
  const { t } = useTranslation();
  const colors = useColors();
  const router = useRouter();
  const { branding } = useBranding();
  const { user, signOut } = useAuth();

  if (!user) return <Redirect href="/" />;
  // Clients' area is Find; this placeholder is the caregiver's home until Phase 3.
  if (user.role !== 'CAREGIVER') return <Redirect href="/find" />;

  return (
    <Screen>
      <View style={styles.body}>
        <Text style={[styles.brand, { color: colors.brand }]}>{branding.companyName}</Text>
        <Text style={[styles.title, { color: colors.ink }]}>{t('home.welcome')}</Text>
        {user.phone || user.email ? <Text style={{ color: colors.muted, fontSize: 16 }}>{user.phone ?? user.email}</Text> : null}
      </View>
      <View style={styles.actions}>
        <Button
          variant="secondary"
          label={t('home.signOut')}
          onPress={async () => {
            await signOut();
            router.replace('/');
          }}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, justifyContent: 'center', gap: 12 },
  brand: { fontSize: 18, fontWeight: '700' },
  title: { fontSize: 28, lineHeight: 40, fontWeight: '700' },
  actions: { marginBottom: 32 },
});
