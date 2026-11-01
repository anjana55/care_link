import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMutation } from '@tanstack/react-query';
import type { AccountDeletionReceipt } from '@care-platform/shared';
import { api, ApiError } from '@/api';
import { useAuth } from '@/auth/AuthProvider';
import { useTranslation } from '@/i18n';
import { useColors } from '@/theme';
import { Button } from '@/ui/controls';
import { formatDate } from '@/ui/dates';
import { Text } from '@/ui/Text';

/** The Sri Lankan date of an ISO time. */
const colomboDay = (iso: string) => new Date(new Date(iso).getTime() + 330 * 60_000).toISOString().slice(0, 10);

/**
 * "Delete my account", from My account (clients) or Me (caregivers) - the
 * store requirement, and the same request as the website's /delete-account.
 * The account is closed at once (the API ends every session), so after
 * confirming the app forgets the session and says when the details go.
 */
export default function DeleteAccount() {
  const { t, locale } = useTranslation();
  const colors = useColors();
  const router = useRouter();
  const { user, signOut } = useAuth();
  const [confirmed, setConfirmed] = useState(false);
  const [eraseAfter, setEraseAfter] = useState<string | null>(null);
  const remove = useMutation({
    mutationFn: () => api.post<AccountDeletionReceipt>('/me/account/deletion'),
    onSuccess: async (receipt) => {
      setEraseAfter(receipt.eraseAfter);
      await signOut({ serverEnded: true });
    },
  });

  if (eraseAfter) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
        <View style={[styles.page, { flex: 1, justifyContent: 'center' }]}>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>
            {t('deleteAccount.title')}
          </Text>
          <Text accessibilityLiveRegion="polite" style={{ fontSize: 17, lineHeight: 25, color: colors.ink }}>
            {t('deleteAccount.done', { date: formatDate(colomboDay(eraseAfter), locale) })}
          </Text>
          <Text style={{ fontSize: 15, lineHeight: 22, color: colors.muted }}>{t('deleteAccount.changeMind')}</Text>
          <Button label={t('deleteAccount.doneOk')} onPress={() => router.replace('/')} />
        </View>
      </SafeAreaView>
    );
  }
  if (!user) return <Redirect href="/" />;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={styles.page}>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>
          {t('deleteAccount.title')}
        </Text>
        {user.phone || user.email ? (
          <Text style={{ fontSize: 15, color: colors.muted }}>{t('deleteAccount.signedInAs', { name: user.phone ?? user.email ?? '' })}</Text>
        ) : null}

        <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          <Text accessibilityRole="header" style={[styles.section, { color: colors.ink }]}>
            {t('deleteAccount.whatHappens')}
          </Text>
          {(['closed', 'erased', 'open', 'kept'] as const).map((step) => (
            <View key={step} style={styles.step}>
              <Text style={{ fontSize: 15, color: colors.muted }}>•</Text>
              <Text style={{ flex: 1, fontSize: 15, lineHeight: 22, color: colors.ink }}>{t(`deleteAccount.steps.${step}`)}</Text>
            </View>
          ))}
          <Text style={{ fontSize: 15, lineHeight: 22, color: colors.muted }}>{t('deleteAccount.changeMind')}</Text>
        </View>

        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: confirmed }}
          accessibilityLabel={t('deleteAccount.confirm')}
          onPress={() => setConfirmed((c) => !c)}
          style={styles.confirm}
        >
          <View style={[styles.box, { borderColor: confirmed ? colors.danger : colors.border, backgroundColor: confirmed ? colors.danger : 'transparent' }]}>
            {confirmed ? <Text style={{ color: '#fff', fontWeight: '700' }}>✓</Text> : null}
          </View>
          <Text style={{ flex: 1, fontSize: 15, lineHeight: 22, color: colors.ink }}>{t('deleteAccount.confirm')}</Text>
        </Pressable>

        {remove.error ? (
          <Text accessibilityRole="alert" style={{ color: colors.danger, fontSize: 15 }}>
            {remove.error instanceof ApiError && remove.error.message ? remove.error.message : t('deleteAccount.error')}
          </Text>
        ) : null}
        <Button
          label={remove.isPending ? t('common.loading') : t('deleteAccount.delete')}
          busy={remove.isPending}
          disabled={!confirmed}
          onPress={() => confirmed && !remove.isPending && remove.mutate()}
        />
        <Button variant="secondary" label={t('common.cancel')} onPress={() => router.back()} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 20, paddingBottom: 40, gap: 16 },
  title: { fontSize: 26, fontWeight: '700' },
  section: { fontSize: 18, fontWeight: '700' },
  card: { borderWidth: 1, borderRadius: 14, padding: 16, gap: 10 },
  step: { flexDirection: 'row', gap: 8 },
  confirm: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', minHeight: 44 },
  box: { width: 26, height: 26, borderRadius: 6, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
});
