import { useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { CLIENT_CANCELLABLE_STATUSES, type ClientCareRequest } from '@care-platform/shared';
import { useTranslation } from '@/i18n';
import { useColors } from '@/theme';
import { Button, FormError } from '@/ui/controls';
import { Text } from '@/ui/Text';
import { formatDate } from '@/ui/dates';
import { useCancelRequest, useClient, useMyRequests } from '@/care/api';
import { RequestSheet } from '@/care/RequestSheet';
import { SignInPrompt } from '@/care/SignInPrompt';
import { shortId } from '@/search/ResultCard';

/**
 * The client's requests, as on the website: where each one stands, the
 * caregiver it's about (or "our team is finding someone"), and cancelling
 * while it's still open. "Find a caregiver for me" starts one without a caregiver.
 */
export default function Requests() {
  const { t } = useTranslation();
  const colors = useColors();
  const router = useRouter();
  const client = useClient();
  const requests = useMyRequests();
  const [findForMe, setFindForMe] = useState(false);

  const head = (
    <View style={styles.head}>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>
        {t('account.requests.title')}
      </Text>
      <Text style={{ fontSize: 15, lineHeight: 22, color: colors.muted }}>{t('account.requests.subtitle')}</Text>
      {client ? (
        <Button variant="secondary" label={t('account.requests.newRequest')} onPress={() => setFindForMe(true)} />
      ) : (
        <SignInPrompt body={t('profile.contactCta')} />
      )}
    </View>
  );

  const empty = !client ? null : requests.isLoading ? (
    <ActivityIndicator color={colors.brand} />
  ) : requests.isError ? (
    <View style={{ gap: 8 }}>
      <Text style={{ color: colors.danger }}>{t('care.actionError')}</Text>
      <Button variant="secondary" label={t('error.retry')} onPress={() => requests.refetch()} />
    </View>
  ) : (
    <View style={{ gap: 12 }}>
      <Text style={{ fontSize: 16, color: colors.muted }}>{t('account.requests.empty')}</Text>
      <Button variant="secondary" label={t('account.requests.emptyCta')} onPress={() => router.navigate('/find')} />
    </View>
  );

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.background }}>
      <FlatList
        data={client ? (requests.data ?? []) : []}
        keyExtractor={(r) => r.id}
        ListHeaderComponent={head}
        ListEmptyComponent={empty ?? undefined}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
        renderItem={({ item }) => <RequestCard request={item} />}
      />
      <RequestSheet
        visible={findForMe}
        onClose={() => setFindForMe(false)}
        onViewRequests={() => setFindForMe(false)}
      />
    </SafeAreaView>
  );
}

function RequestCard({ request }: { request: ClientCareRequest }) {
  const { t, locale } = useTranslation();
  const colors = useColors();
  const router = useRouter();
  const cancel = useCancelRequest();
  const [confirming, setConfirming] = useState(false);
  const canCancel = CLIENT_CANCELLABLE_STATUSES.includes(request.status);
  const open = request.status !== 'CLOSED' && request.status !== 'CANCELLED';

  const who = request.caregiverPublicId
    ? request.caregiver
      ? t('profile.anonymousId', { id: shortId(request.caregiver.publicId) })
      : t('account.requests.noCaregiverLabel')
    : t('account.requests.matching');

  return (
    <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
      <View style={styles.row}>
        <Text style={[styles.who, { color: colors.ink }]}>{who}</Text>
        <Text style={[styles.status, { color: open ? colors.brand : colors.muted, borderColor: open ? colors.brand : colors.border }]}>
          {t(`account.requests.status.${request.status}`)}
        </Text>
      </View>
      <Text style={{ fontSize: 15, lineHeight: 22, color: colors.ink }}>{t(`account.requests.statusHelp.${request.status}`)}</Text>
      {request.caregiverPublicId && !request.caregiver ? (
        <Text style={{ fontSize: 14, color: colors.muted }}>{t('account.requests.notOnline')}</Text>
      ) : null}
      <Text style={{ fontSize: 13, color: colors.muted }}>
        {t('account.requests.reference', { reference: request.reference })} · {t('account.requests.sentOn', { date: formatDate(request.createdAt, locale) })}
        {request.desiredStartDate ? ` · ${t('account.requests.startsOn', { date: formatDate(request.desiredStartDate, locale) })}` : ''}
      </Text>

      {request.caregiver ? (
        <Button
          variant="link"
          label={t('account.requests.viewProfile')}
          onPress={() => router.push({ pathname: '/caregivers/[publicId]', params: { publicId: request.caregiver!.publicId } })}
        />
      ) : null}

      {canCancel ? (
        confirming ? (
          <View style={{ gap: 8 }}>
            <Text accessibilityRole="alert" style={{ fontSize: 15, color: colors.ink }}>
              {t('account.requests.cancelConfirm')}
            </Text>
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Button label={t('account.requests.cancelYes')} busy={cancel.isPending} onPress={() => cancel.mutate(request.id, { onSuccess: () => setConfirming(false) })} />
              </View>
              <View style={{ flex: 1 }}>
                <Button variant="secondary" label={t('account.requests.cancelNo')} onPress={() => setConfirming(false)} />
              </View>
            </View>
            <FormError message={cancel.isError ? t('care.actionError') : null} />
          </View>
        ) : (
          <Button variant="link" label={t('account.requests.cancel')} onPress={() => setConfirming(true)} />
        )
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: 20, paddingBottom: 32 },
  head: { gap: 10, paddingTop: 16, paddingBottom: 16 },
  title: { fontSize: 26, fontWeight: '700' },
  card: { borderWidth: 1, borderRadius: 14, padding: 16, gap: 6 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  who: { fontSize: 16, fontWeight: '700', flexShrink: 1 },
  status: { fontSize: 12, fontWeight: '700', borderWidth: 1, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden' },
});
