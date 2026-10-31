import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from '@/i18n';
import { useColors } from '@/theme';
import { Button } from '@/ui/controls';
import { Text } from '@/ui/Text';

/** In place of a client's own list, for someone not signed in as a client. */
export function SignInPrompt({ body }: { body: string }) {
  const { t } = useTranslation();
  const colors = useColors();
  const router = useRouter();
  return (
    <View style={styles.box}>
      <Text style={{ fontSize: 16, lineHeight: 24, color: colors.muted }}>{body}</Text>
      <Button label={t('signIn.client')} onPress={() => router.push({ pathname: '/sign-in', params: { role: 'client' } })} />
    </View>
  );
}

const styles = StyleSheet.create({ box: { gap: 16, marginTop: 8 } });
