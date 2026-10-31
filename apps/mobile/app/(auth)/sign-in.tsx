import { useMemo } from 'react';
import { Link, useLocalSearchParams } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from '@/i18n';
import { useColors, type Colors } from '@/theme';
import { Text } from '@/ui/Text';

/**
 * Placeholder until the sign-in screens arrive (Phase 1b): WhatsApp OTP, email
 * and the caregiver claim; social sign-in in Phase 4. It exists so routing and
 * the role parameter are wired: `role` becomes the `portal` the API is told.
 */
export default function SignIn() {
  const { t } = useTranslation();
  const { role } = useLocalSearchParams<{ role?: 'client' | 'caregiver' }>();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

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

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background, paddingHorizontal: 24 },
    body: { flex: 1, justifyContent: 'center' },
    title: { fontSize: 26, lineHeight: 38, fontWeight: '700', color: colors.ink },
    back: { minHeight: 48, justifyContent: 'center', marginBottom: 24 },
    backText: { fontSize: 16, color: colors.brand, fontWeight: '600' },
  });
