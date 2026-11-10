import { Linking, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '@/auth/AuthProvider';
import { registerUrl } from '@/auth/sides';
import { useTranslation } from '@/i18n';
import { useColors } from '@/theme';
import { Button, Screen } from '@/ui/controls';
import { LanguagePicker } from '@/ui/LanguagePicker';
import { AppLockSetting } from '@/auth/AppLock';
import { Text } from '@/ui/Text';
import { Avatar, Card, Divider, IconBadge, MenuRow } from '@/ui/visual';

/**
 * A client's account. Signed out: sign in or sign up (searching doesn't need
 * it; contacting and saving caregivers will). Signed in: who they are, their
 * saved caregivers and invoices, the app's language, and signing out.
 */
export default function Account() {
  const { t } = useTranslation();
  const colors = useColors();
  const router = useRouter();
  const { user, signOut } = useAuth();

  return (
    <Screen title={t('nav.myAccount')}>
      <ScrollView contentContainerStyle={styles.body}>

        {user ? (
          <Card style={styles.profile}>
            <Avatar name={user.email ?? user.phone} size={64} />
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={[styles.lead, { color: colors.ink }]}>{t('home.welcome')}</Text>
              {user.phone || user.email ? <Text style={{ color: colors.muted, fontSize: 15 }}>{user.phone ?? user.email}</Text> : null}
            </View>
          </Card>
        ) : (
          <Card style={{ alignItems: 'stretch', gap: 14 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <IconBadge name="person-circle-outline" size={52} />
              <Text style={{ flex: 1, color: colors.muted, fontSize: 15, lineHeight: 22 }}>{t('account.signedOutHint')}</Text>
            </View>
            <Button label={t('signIn.client')} onPress={() => router.push({ pathname: '/sign-in', params: { role: 'client' } })} />
            <View style={styles.row}>
              <Text style={{ color: colors.muted, fontSize: 15 }}>{t('signIn.noAccount')}</Text>
              <Button variant="link" label={t('signIn.signUp')} onPress={() => Linking.openURL(registerUrl('client'))} />
            </View>
          </Card>
        )}

        {user ? (
          <Card style={styles.menu}>
            <MenuRow icon="chatbubbles-outline" label={t('account.nav.requests')} onPress={() => router.navigate('/requests')} />
            <Divider />
            <MenuRow icon="heart-outline" tone="accent" label={t('account.nav.saved')} onPress={() => router.navigate('/saved')} />
            <Divider />
            <MenuRow icon="receipt-outline" label={t('account.nav.invoices')} onPress={() => router.navigate('/invoices')} />
          </Card>
        ) : null}

        <View style={styles.section}>
          <Text style={[styles.label, { color: colors.ink }]}>{t('common.language')}</Text>
          <LanguagePicker />
        </View>
        {user ? <AppLockSetting /> : null}

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
        {user ? <Button variant="link" label={t('deleteAccount.title')} onPress={() => router.push('/delete-account')} /> : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { paddingTop: 24, paddingBottom: 32, gap: 22 },
  profile: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  menu: { padding: 6, gap: 0 },
  section: { gap: 12 },
  lead: { fontSize: 20, fontWeight: '600' },
  label: { fontSize: 15, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
});
