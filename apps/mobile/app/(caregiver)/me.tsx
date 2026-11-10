import { ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '@/auth/AuthProvider';
import { useTranslation } from '@/i18n';
import { useColors } from '@/theme';
import { Button, Screen } from '@/ui/controls';
import { LanguagePicker } from '@/ui/LanguagePicker';
import { AppLockSetting } from '@/auth/AppLock';
import { Text } from '@/ui/Text';
import { useWaitingCounts } from '@/notifications/tab-counts';
import { Avatar, Card, Divider, MenuRow, Pill } from '@/ui/visual';
import { useOwnCaregiver } from '@/caregiver/api';

/**
 * The caregiver's account: who they are, their profile and documents, the
 * app's language, and signing out.
 */
export default function Me() {
  const { t } = useTranslation();
  const waiting = useWaitingCounts();
  const said = (count: number) => t('clientHome.waiting', { count });
  const documents = waiting.todos('UPLOAD_DOCUMENT', 'DOCUMENT_REJECTED', 'DOCUMENT_EXPIRING');
  const colors = useColors();
  const router = useRouter();
  const { user, signOut } = useAuth();
  const { data: c } = useOwnCaregiver();

  return (
    <Screen title={t('nav.myAccount')}>
      <ScrollView contentContainerStyle={styles.body}>
        <Card style={styles.profile}>
          <Avatar name={c?.fullName ?? user?.email ?? user?.phone} size={64} />
          <View style={{ flex: 1, gap: 4 }}>
            {c ? <Text style={{ fontSize: 20, fontWeight: '700', color: colors.ink }}>{c.fullName}</Text> : null}
            {c ? (
              <Text style={{ color: colors.muted, fontSize: 14 }}>
                {t('portal.registrationNumber')} {c.registrationNumber}
              </Text>
            ) : null}
            {user?.phone || user?.email ? <Text style={{ color: colors.muted, fontSize: 15 }}>{user.phone ?? user.email}</Text> : null}
            {c ? <Pill icon="ellipse" tone={c.status === 'ACTIVE' ? 'brand' : 'muted'} label={t(`portal.status.${c.status}`)} /> : null}
          </View>
        </Card>

        <Card style={styles.menu}>
          <MenuRow icon="person-outline" label={t('portal.profile.title')} onPress={() => router.navigate('/profile')} />
          <Divider />
          <MenuRow icon="document-text-outline" tone="accent" label={t('portal.nav.documents')} count={documents} countLabel={said(documents)} onPress={() => router.navigate('/documents')} />
          <Divider />
          <MenuRow icon="star-outline" label={t('reviews.caregiver.title')} onPress={() => router.navigate('/ratings')} />
        </Card>

        <View style={styles.section}>
          <Text style={[styles.label, { color: colors.ink }]}>{t('common.language')}</Text>
          <LanguagePicker />
        </View>
        {user ? <AppLockSetting /> : null}
        <Button
          variant="secondary"
          label={t('nav.signOut')}
          onPress={async () => {
            await signOut();
            router.replace('/');
          }}
        />
        <Button variant="link" label={t('deleteAccount.title')} onPress={() => router.push('/delete-account')} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { paddingTop: 24, paddingBottom: 32, gap: 22 },
  profile: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  menu: { padding: 6, gap: 0 },
  section: { gap: 8 },
  label: { fontSize: 15, fontWeight: '600' },
});
