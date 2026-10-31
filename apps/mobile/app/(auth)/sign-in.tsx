import { useState } from 'react';
import { Linking, ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import type { OtpRequestResult, Tokens, WhatsappPublicConfig } from '@care-platform/shared';
import { api } from '@/api';
import { useAuth } from '@/auth/AuthProvider';
import { isInvalidCredentials, messageFor } from '@/auth/messages';
import { afterSignIn, portalFor, registerUrl, sideFrom } from '@/auth/sides';
import { useTranslation } from '@/i18n';
import { useColors } from '@/theme';
import { Button, Field, FormError, PasswordField, Screen } from '@/ui/controls';
import { Text } from '@/ui/Text';

/**
 * Sign-in for one side of the app. WhatsApp first when this deployment has it
 * switched on for that side (Settings > WhatsApp), with email as the
 * alternative; email only otherwise. Registering happens on the website for now.
 */
export default function SignIn() {
  const { t } = useTranslation();
  const colors = useColors();
  const router = useRouter();
  const { signIn } = useAuth();
  const { role, returnTo } = useLocalSearchParams<{ role?: string; returnTo?: string }>();
  const side = sideFrom(role);
  const portal = portalFor(side);
  const otherSide = side === 'caregiver' ? 'client' : 'caregiver';

  const whatsapp = useQuery({
    queryKey: ['whatsapp-config'],
    queryFn: () => api.get<WhatsappPublicConfig>('/auth/whatsapp/config'),
  });
  const whatsappOn = Boolean(whatsapp.data?.enabled && whatsapp.data[side === 'caregiver' ? 'caregiver' : 'customer']?.login);
  const [chosen, setChosen] = useState<'whatsapp' | 'email' | null>(null);
  const mode = chosen ?? (whatsappOn ? 'whatsapp' : 'email');

  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showUnverifiedHint, setShowUnverifiedHint] = useState(false);

  async function sendCode() {
    setBusy(true);
    setError(null);
    try {
      const sent = await api.post<OtpRequestResult>('/auth/whatsapp/request-otp', { phone, purpose: 'LOGIN', portal }, { anonymous: true });
      router.push({
        pathname: '/verify',
        params: { role: side, phone, resendAfter: String(sent.resendAfterSeconds ?? 60), devOtp: sent.devOtp ?? '', ...(returnTo ? { returnTo } : {}) },
      });
    } catch (err) {
      setError(messageFor(err, t('signIn.sendError')));
    } finally {
      setBusy(false);
    }
  }

  async function signInWithEmail() {
    setBusy(true);
    setError(null);
    setShowUnverifiedHint(false);
    try {
      const tokens = await api.post<Tokens>('/auth/login', { email: email.trim(), password, portal }, { anonymous: true });
      const signedIn = await signIn(tokens);
      if (signedIn) {
        const next = afterSignIn(signedIn, returnTo);
        // Back to the screen they came from, closing the sign-in screens on the way.
        if (next === returnTo) router.dismissTo(next as never);
        else router.replace(next as never);
      }
      else setError(t('signIn.emailError'));
    } catch (err) {
      // A wrong password, an unknown email and another side's account all come
      // back as 401 "Invalid credentials": say that the reader's way. Any other
      // 401 (an email not yet verified) carries its own message, so show it.
      const refused = isInvalidCredentials(err);
      setError(refused ? t('signIn.emailError') : messageFor(err, t('common.error')));
      setShowUnverifiedHint(refused);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={[styles.title, { color: colors.ink }]}>{t(side === 'caregiver' ? 'signIn.caregiver' : 'signIn.client')}</Text>

        {mode === 'whatsapp' ? (
          <View style={styles.form}>
            <Text style={[styles.subtitle, { color: colors.muted }]}>{t('signIn.whatsappSubtitle')}</Text>
            <Field
              label={t('signIn.phone')}
              hint={t('signIn.phoneHint')}
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              autoComplete="tel"
              textContentType="telephoneNumber"
            />
            <FormError message={error} />
            <Button label={t('signIn.sendCode')} onPress={sendCode} busy={busy} disabled={phone.trim().length < 7} />
            <Button variant="link" label={t('signIn.useEmail')} onPress={() => (setChosen('email'), setError(null))} />
          </View>
        ) : (
          <View style={styles.form}>
            <Field
              label={t('signIn.email')}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              textContentType="username"
            />
            <PasswordField
              label={t('signIn.password')}
              value={password}
              onChangeText={setPassword}
              autoComplete="current-password"
              textContentType="password"
            />
            <FormError message={error} />
            {showUnverifiedHint ? (
              <>
                <Text style={[styles.subtitle, { color: colors.muted }]}>{t('signIn.unverifiedHint')}</Text>
                {/* The same refusal comes back for an account on the other side of the app. */}
                <Button
                  variant="link"
                  label={t(otherSide === 'caregiver' ? 'signIn.caregiver' : 'signIn.client')}
                  onPress={() => router.replace({ pathname: '/sign-in', params: { role: otherSide } })}
                />
              </>
            ) : null}
            <Button label={t('signIn.submit')} onPress={signInWithEmail} busy={busy} disabled={!email.trim() || !password} />
            {whatsappOn ? (
              <Button variant="link" label={t('signIn.useWhatsapp')} onPress={() => (setChosen('whatsapp'), setError(null))} />
            ) : null}
          </View>
        )}

        <View style={styles.signUp}>
          <Text style={{ color: colors.muted, fontSize: 15 }}>{t('signIn.noAccount')}</Text>
          <Button variant="link" label={t('signIn.signUp')} onPress={() => Linking.openURL(registerUrl(side))} />
        </View>
      </ScrollView>

      <Button variant="link" label={t('signIn.back')} onPress={() => router.replace('/')} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { paddingTop: 48, paddingBottom: 24, gap: 20 },
  title: { fontSize: 26, lineHeight: 38, fontWeight: '700' },
  subtitle: { fontSize: 15, lineHeight: 22 },
  form: { gap: 16 },
  signUp: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
});
