import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '@/auth/AuthProvider';
import { useTranslation } from '@/i18n';
import { useColors } from '@/theme';
import { Button, FormError } from '@/ui/controls';
import { Text } from '@/ui/Text';
import { useClient, useRelation, useSetSaved } from './api';
import { RequestSheet } from './RequestSheet';

/**
 * Contact and Save on a caregiver's profile. A signed-in client gets both (or
 * "Request sent" when one is open); someone browsing without an account is
 * asked to sign in and comes straight back; a caregiver's account can't use them.
 */
export function CaregiverActions({ publicId }: { publicId: string }) {
  const { t } = useTranslation();
  const colors = useColors();
  const router = useRouter();
  const { user } = useAuth();
  const client = useClient();
  const relation = useRelation(client ? publicId : null);
  const setSaved = useSetSaved();
  const [contacting, setContacting] = useState(false);

  if (user && !client) {
    return <Text style={[styles.note, { color: colors.muted, borderColor: colors.border }]}>{t('care.caregiverAccountNote')}</Text>;
  }

  if (!client) {
    const signIn = () => router.push({ pathname: '/sign-in', params: { role: 'client', returnTo: `/caregivers/${publicId}` } });
    return (
      <View style={styles.actions}>
        <Button label={t('profile.contactCta')} onPress={signIn} />
        <Button variant="secondary" label={t('profile.saveCta')} onPress={signIn} />
      </View>
    );
  }

  const saved = relation.data?.saved ?? false;
  const open = relation.data?.openRequest ?? null;
  return (
    <View style={styles.actions}>
      {open ? (
        <Button variant="link" label={`✓ ${t('care.requestSent', { reference: open.reference })}`} onPress={() => router.push('/requests')} />
      ) : (
        <Button label={t('care.contactCta')} onPress={() => setContacting(true)} disabled={relation.isLoading} />
      )}
      <Button
        variant="secondary"
        label={saved ? `♥ ${t('care.saved')}` : `♡ ${t('care.save')}`}
        busy={setSaved.isPending}
        disabled={relation.isLoading}
        onPress={() => setSaved.mutate({ publicId, saved: !saved })}
      />
      <FormError message={setSaved.isError ? t('care.actionError') : null} />
      <RequestSheet
        visible={contacting}
        caregiverPublicId={publicId}
        onClose={() => setContacting(false)}
        onViewRequests={() => {
          setContacting(false);
          router.push('/requests');
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  actions: { gap: 10, marginTop: 20 },
  note: { marginTop: 20, fontSize: 15, lineHeight: 22, borderWidth: 1, borderRadius: 10, padding: 12 },
});
