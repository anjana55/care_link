import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from '@/i18n';
import { useColors } from '@/theme';
import { Button } from '@/ui/controls';
import { Text } from '@/ui/Text';
import { Card, IconBadge } from '@/ui/visual';

/**
 * In place of a client's own list, for someone not signed in as a client.
 * Signing in comes back to `returnTo` - this screen - so a link from an email
 * that opened it ends where it pointed.
 */
export function SignInPrompt({ body, returnTo }: { body: string; returnTo: string }) {
  const { t } = useTranslation();
  const colors = useColors();
  const router = useRouter();
  return (
    <Card style={styles.box}>
      <View style={styles.row}>
        <IconBadge name="lock-closed-outline" tone="accent" size={48} />
        <Text style={{ flex: 1, fontSize: 16, lineHeight: 24, color: colors.muted }}>{body}</Text>
      </View>
      <Button label={t('signIn.client')} onPress={() => router.push({ pathname: '/sign-in', params: { role: 'client', returnTo } })} />
    </Card>
  );
}

const styles = StyleSheet.create({
  box: { gap: 16, marginTop: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14 },
});
