import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { Tokens } from '@care-platform/shared';
import { useTranslation } from '@/i18n';
import { useColors } from '@/theme';
import { Button } from '@/ui/controls';
import { Text } from '@/ui/Text';
import { phoneSocialDeps, signInWithProvider, useSocialProviders, type SocialDeps, type SocialProvider } from './social';
import type { Side } from './sides';

/** A reason the API (or the app) gave, in the reader's words. */
const MESSAGES: Record<string, (side: Side) => string> = {
  not_registered: (s) => (s === 'client' ? 'signIn.social.errors.notRegisteredClient' : 'signIn.social.errors.notRegisteredCaregiver'),
  wrong_portal: (s) => (s === 'client' ? 'signIn.social.errors.wrongPortalClient' : 'signIn.social.errors.wrongPortalCaregiver'),
  account_disabled: () => 'signIn.social.errors.accountDisabled',
  expired: () => 'signIn.social.errors.expired',
};

/**
 * "Continue with Google / Microsoft / Facebook" on the sign-in screen, for the
 * providers this deployment has switched on. Nothing at all - not even the
 * "or" line - when none are, or on a build without the sign-in browser.
 * `onSignedIn` finishes the sign-in as the email form does; `onWrongSide`
 * offers the other side's sign-in.
 */
export function SocialButtons({
  side,
  onSignedIn,
  onWrongSide,
  deps: given,
}: {
  side: Side;
  onSignedIn: (tokens: Tokens) => Promise<boolean>;
  onWrongSide: () => void;
  deps?: SocialDeps | null;
}) {
  const { t } = useTranslation();
  const colors = useColors();
  const deps = useMemo(() => (given === undefined ? phoneSocialDeps() : given), [given]);
  const providers = useSocialProviders(deps);
  const [pending, setPending] = useState<SocialProvider | null>(null);
  const [error, setError] = useState<{ code: string } | null>(null);

  if (!deps || !providers.data?.length) return null;

  const start = async (provider: SocialProvider) => {
    setPending(provider);
    setError(null);
    try {
      const outcome = await signInWithProvider(provider, side, deps);
      if ('tokens' in outcome) {
        if (!(await onSignedIn(outcome.tokens))) setError({ code: 'generic' });
      } else if ('error' in outcome) {
        setError({ code: outcome.error });
      }
    } finally {
      setPending(null);
    }
  };

  return (
    <View style={styles.group}>
      {providers.data.map((provider) => (
        <Button
          key={provider}
          variant="secondary"
          label={t(`signIn.social.continue.${provider}`)}
          busy={pending === provider}
          disabled={pending !== null}
          onPress={() => void start(provider)}
        />
      ))}
      {error ? (
        <View style={{ gap: 4 }}>
          <Text accessibilityRole="alert" style={{ color: colors.danger, fontSize: 15, lineHeight: 22 }}>
            {t(MESSAGES[error.code]?.(side) ?? 'signIn.social.errors.generic')}
          </Text>
          {error.code === 'wrong_portal' ? (
            <Button variant="link" label={t(side === 'client' ? 'signIn.caregiver' : 'signIn.client')} onPress={onWrongSide} />
          ) : null}
        </View>
      ) : null}
      <View style={styles.or} accessibilityRole="none">
        <View style={[styles.line, { backgroundColor: colors.border }]} />
        <Text style={{ color: colors.muted, fontSize: 14 }}>{t('signIn.social.orEmail')}</Text>
        <View style={[styles.line, { backgroundColor: colors.border }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: 12 },
  or: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  line: { flex: 1, height: StyleSheet.hairlineWidth },
});
