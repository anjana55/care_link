import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { OtpRequestResult, Tokens } from '@care-platform/shared';
import { api } from '@/api';
import { useAuth } from '@/auth/AuthProvider';
import { messageFor } from '@/auth/messages';
import { portalFor, sideFrom, homeFor } from '@/auth/sides';
import { useTranslation } from '@/i18n';
import { useColors } from '@/theme';
import { Button, Field, FormError, Screen } from '@/ui/controls';
import { Text } from '@/ui/Text';

/** The code sent on WhatsApp: verify it, or ask for a new one once the wait is over. */
export default function Verify() {
  const { t } = useTranslation();
  const colors = useColors();
  const router = useRouter();
  const { signIn } = useAuth();
  const params = useLocalSearchParams<{ role?: string; phone?: string; resendAfter?: string; devOtp?: string }>();
  const side = sideFrom(params.role);
  const phone = params.phone ?? '';

  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [devOtp, setDevOtp] = useState(params.devOtp || null);
  const [secondsLeft, setSecondsLeft] = useState(Number(params.resendAfter) || 60);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [secondsLeft]);

  async function verify() {
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<{ tokens: Tokens }>(
        '/auth/whatsapp/verify-otp',
        { phone, purpose: 'LOGIN', portal: portalFor(side), code: code.trim() },
        { anonymous: true },
      );
      const signedIn = await signIn(result.tokens);
      if (signedIn) router.replace(homeFor(signedIn));
      else setError(t('otp.error'));
    } catch (err) {
      setError(messageFor(err, t('otp.error')));
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setError(null);
    setNotice(null);
    try {
      const sent = await api.post<OtpRequestResult>('/auth/whatsapp/request-otp', { phone, purpose: 'LOGIN', portal: portalFor(side) }, { anonymous: true });
      setSecondsLeft(sent.resendAfterSeconds ?? 60);
      setDevOtp(sent.devOtp ?? null);
      setNotice(t('otp.resent'));
    } catch (err) {
      setError(messageFor(err, t('signIn.sendError')));
    }
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={[styles.lead, { color: colors.ink }]}>
          {t('otp.sentTo')} <Text style={styles.phone}>{phone}</Text>
        </Text>
        {devOtp ? (
          <Text style={{ color: colors.muted }}>
            {t('otp.devCode')}: {devOtp}
          </Text>
        ) : null}
        <View style={styles.form}>
          <Field
            label={t('otp.code')}
            value={code}
            onChangeText={(v) => setCode(v.replace(/\D/g, ''))}
            keyboardType="number-pad"
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            maxLength={8}
          />
          <FormError message={error} />
          {notice ? <Text style={{ color: colors.muted }}>{notice}</Text> : null}
          <Button label={t('otp.verify')} onPress={verify} busy={busy} disabled={code.length < 4} />
          <Button
            variant="link"
            label={secondsLeft > 0 ? `${t('otp.resendIn')} ${secondsLeft}s` : t('otp.resend')}
            onPress={resend}
            disabled={secondsLeft > 0}
          />
          <Button variant="link" label={t('otp.changeNumber')} onPress={() => router.back()} />
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { paddingTop: 48, paddingBottom: 24, gap: 16 },
  lead: { fontSize: 18, lineHeight: 28 },
  phone: { fontWeight: '700' },
  form: { gap: 16 },
});
