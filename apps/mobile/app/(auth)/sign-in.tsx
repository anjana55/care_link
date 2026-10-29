import { Link, useLocalSearchParams } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from '@/i18n';
import { colors } from '@/theme';

/**
 * Placeholder for Phase 1, where WhatsApp OTP, email and (Phase 4) social
 * sign-in arrive. It exists now so routing and the role parameter are wired:
 * `role` becomes the `portal` the API is told on sign-in.
 */
export default function SignIn() {
  const { t } = useTranslation();
  const { role } = useLocalSearchParams<{ role?: 'client' | 'caregiver' }>();

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.body}>
        <Text style={styles.title}>{t(role === 'caregiver' ? 'signIn.caregiver' : 'signIn.client')}</Text>
      </View>
      <Link href="/" asChild>
        <Pressable accessibilityRole="link" style={styles.back}>
          <Text style={styles.backText}>{t('signIn.back')}</Text>
        </Pressable>
      </Link>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, paddingHorizontal: 24 },
  body: { flex: 1, justifyContent: 'center' },
  title: { fontSize: 26, lineHeight: 36, fontWeight: '700', color: colors.ink },
  back: { minHeight: 48, justifyContent: 'center', marginBottom: 24 },
  backText: { fontSize: 16, color: colors.brand, fontWeight: '600' },
});
