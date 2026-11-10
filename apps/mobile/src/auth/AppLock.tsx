import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState, BackHandler, Modal, StyleSheet, Switch, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/auth/AuthProvider';
import { useTranslation } from '@/i18n';
import { useColors } from '@/theme';
import { Button } from '@/ui/controls';
import { Text } from '@/ui/Text';
import { HeroBand } from '@/ui/visual';
import { LOCK_AFTER_MS, confirmOwner, lockClock, readLockChoice, saveLockChoice, unlockKind, type LockChoice, type UnlockKind } from './app-lock';

/**
 * Face / fingerprint unlock (see app-lock.ts for what it is and isn't).
 *
 * - After a fresh sign-in on a phone with face or fingerprint set up, asks
 *   once whether to use it. The answer can be changed in My account.
 * - When it's on, the app asks on launch and after LOCK_AFTER_MS in the
 *   background. The screens stay mounted underneath, so a notification tapped
 *   while locked opens its screen once unlocked.
 * - "Sign in another way" signs out and turns the lock off for that account.
 */
interface AppLockValue {
  /** False until we know whether to show the lock, so the app never flashes open first. */
  ready: boolean;
  /** What this phone offers; null when it has no face or fingerprint set up. */
  kind: UnlockKind | null;
  enabled: boolean;
  /** Turning on checks it's them first. Resolves to whether it is now on. */
  setEnabled(on: boolean): Promise<boolean>;
}

const AppLockContext = createContext<AppLockValue | null>(null);

interface LockState {
  userId: string;
  kind: UnlockKind | null;
  choice: LockChoice | null;
}

export function AppLockProvider({ children }: { children: ReactNode }) {
  const { user, ready: authReady } = useAuth();
  const [state, setState] = useState<LockState | null>(null);
  const [locked, setLocked] = useState(false);
  const [offer, setOffer] = useState(false);
  /** Whether the session the app started with has been looked at (a restore), as opposed to a sign-in since. */
  const startedRef = useRef(false);
  const userId = user?.userId ?? null;

  useEffect(() => {
    if (!authReady) return;
    const restored = !startedRef.current;
    startedRef.current = true;
    setOffer(false);
    if (!userId) {
      setState(null);
      setLocked(false);
      return;
    }
    let current = true;
    (async () => {
      const [kind, choice] = await Promise.all([unlockKind(), readLockChoice(userId)]);
      if (!current) return;
      setState({ userId, kind, choice });
      // Opening the app with a saved session: lock. Having just signed in: they've proved who they are.
      setLocked(restored && choice === 'on' && kind !== null);
      if (!restored && choice === null && kind !== null) setOffer(true);
    })();
    return () => {
      current = false;
    };
  }, [authReady, userId]);

  const enabled = Boolean(state && state.userId === userId && state.choice === 'on' && state.kind !== null);

  // Away for a while: lock again. 'background' only - the face/fingerprint prompt itself makes the app 'inactive'.
  useEffect(() => {
    if (!enabled) return;
    let leftAt: number | null = null;
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'background') leftAt = lockClock.now();
      else if (next === 'active') {
        if (leftAt !== null && lockClock.now() - leftAt >= LOCK_AFTER_MS) setLocked(true);
        leftAt = null;
      }
    });
    return () => sub.remove();
  }, [enabled]);

  const choose = useCallback(
    async (choice: LockChoice) => {
      if (!userId) return;
      await saveLockChoice(userId, choice);
      setState((s) => (s && s.userId === userId ? { ...s, choice } : s));
    },
    [userId],
  );

  const { t } = useTranslation();
  const setEnabled = useCallback(
    async (on: boolean) => {
      if (!on) {
        await choose('off');
        return false;
      }
      const result = await confirmOwner(t('appLock.confirmPrompt'), t('common.cancel'));
      if (result !== 'ok') return false;
      await choose('on');
      return true;
    },
    [choose, t],
  );

  const ready = authReady && (!userId || state?.userId === userId);
  const value = useMemo(() => ({ ready, kind: state?.kind ?? null, enabled, setEnabled }), [ready, state?.kind, enabled, setEnabled]);
  const gate = useMemo(
    () => ({ locked: locked && enabled, unlocked: () => setLocked(false), offer, closeOffer: () => setOffer(false), choose }),
    [locked, enabled, offer, choose],
  );

  return (
    <AppLockContext.Provider value={value}>
      <GateContext.Provider value={gate}>{children}</GateContext.Provider>
    </AppLockContext.Provider>
  );
}

const GateContext = createContext<{ locked: boolean; unlocked(): void; offer: boolean; closeOffer(): void; choose(choice: LockChoice): Promise<void> } | null>(null);

export function useAppLock(): AppLockValue {
  const ctx = useContext(AppLockContext);
  if (!ctx) throw new Error('useAppLock must be used within AppLockProvider');
  return ctx;
}

/** "Face ID", "your fingerprint", ... for the sentence the screen is saying. */
function useKindWords(kind: UnlockKind | null) {
  const { t } = useTranslation();
  return t(`appLock.kind.${kind ?? 'any'}`);
}

/**
 * Wraps the app's screens: the lock screen over them while locked (hidden from
 * screen readers underneath), and the one-time "use your fingerprint?" offer.
 */
export function AppLockGate({ children }: { children: ReactNode }) {
  const gate = useContext(GateContext);
  if (!gate) throw new Error('AppLockGate must be used within AppLockProvider');
  return (
    <View style={{ flex: 1 }}>
      <View style={{ flex: 1 }} importantForAccessibility={gate.locked ? 'no-hide-descendants' : 'auto'} accessibilityElementsHidden={gate.locked}>
        {children}
      </View>
      {gate.locked ? <LockScreen onUnlocked={gate.unlocked} /> : null}
      {gate.offer && !gate.locked ? <Offer onDone={gate.closeOffer} choose={gate.choose} /> : null}
    </View>
  );
}

function LockScreen({ onUnlocked }: { onUnlocked(): void }) {
  const { t } = useTranslation();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signOut } = useAuth();
  const { kind, setEnabled } = useAppLock();
  const words = useKindWords(kind);
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);

  const unlock = useCallback(async () => {
    setBusy(true);
    const result = await confirmOwner(t('appLock.unlockPrompt'), t('common.cancel'));
    setBusy(false);
    setTried(true);
    // A phone that can no longer check anyone must not trap its owner: open, and stop asking.
    if (result === 'unavailable') await setEnabled(false);
    if (result !== 'cancelled') onUnlocked();
  }, [t, setEnabled, onUnlocked]);

  // Android Back while locked leaves the app rather than moving the screens hidden underneath.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      BackHandler.exitApp();
      return true;
    });
    return () => sub.remove();
  }, []);

  // Ask straight away, once; after that, the button.
  const askedRef = useRef(false);
  useEffect(() => {
    if (askedRef.current) return;
    askedRef.current = true;
    if (AppState.currentState === 'active') void unlock();
  }, [unlock]);

  return (
    <View testID="app-lock" accessibilityViewIsModal style={[StyleSheet.absoluteFill, { backgroundColor: colors.background }]}>
      <HeroBand style={{ paddingTop: insets.top + 48, paddingBottom: 40, alignItems: 'center', gap: 16 }}>
        <View style={[styles.lockIcon, { backgroundColor: colors.surface }]}>
          <Ionicons name="lock-closed" size={40} color={colors.deep} />
        </View>
        <Text accessibilityRole="header" style={styles.lockTitle}>
          {t('appLock.lockedTitle')}
        </Text>
        <Text style={styles.lockBody}>{t('appLock.lockedBody', { method: words })}</Text>
      </HeroBand>
      <View style={{ padding: 24, gap: 16 }}>
        {tried ? <Text style={{ color: colors.muted, fontSize: 16, textAlign: 'center' }}>{t('appLock.notUnlocked')}</Text> : null}
        <Button label={t('appLock.unlock')} icon="lock-open-outline" busy={busy} onPress={unlock} />
        <Button
          variant="link"
          label={t('appLock.signInAnotherWay')}
          onPress={async () => {
            await setEnabled(false);
            await signOut();
            onUnlocked();
            router.replace('/');
          }}
        />
      </View>
    </View>
  );
}

function Offer({ onDone, choose }: { onDone(): void; choose(choice: LockChoice): Promise<void> }) {
  const { t } = useTranslation();
  const colors = useColors();
  const { kind, setEnabled } = useAppLock();
  const words = useKindWords(kind);
  const [busy, setBusy] = useState(false);
  return (
    <Modal transparent animationType="fade" visible onRequestClose={() => void choose('off').then(onDone)}>
      <View style={styles.scrim}>
        <View testID="app-lock-offer" style={[styles.offer, { backgroundColor: colors.surface }]}>
          <Ionicons name={kind === 'fingerprint' ? 'finger-print' : 'scan'} size={44} color={colors.deep} />
          <Text accessibilityRole="header" style={[styles.offerTitle, { color: colors.deep }]}>
            {t('appLock.offerTitle', { method: words })}
          </Text>
          <Text style={{ color: colors.muted, fontSize: 17, lineHeight: 24, textAlign: 'center' }}>{t('appLock.offerBody', { method: words })}</Text>
          <View style={{ alignSelf: 'stretch', gap: 10 }}>
            <Button
              label={t('appLock.offerYes')}
              busy={busy}
              onPress={async () => {
                setBusy(true);
                const on = await setEnabled(true);
                setBusy(false);
                // Cancelled the check: leave the question for My account rather than asking again.
                if (!on) await choose('off');
                onDone();
              }}
            />
            <Button
              variant="secondary"
              label={t('appLock.offerNo')}
              onPress={async () => {
                await choose('off');
                onDone();
              }}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

/** The switch in My account. Nothing on a phone without face or fingerprint set up. */
export function AppLockSetting() {
  const { t } = useTranslation();
  const colors = useColors();
  const { kind, enabled, setEnabled } = useAppLock();
  const words = useKindWords(kind);
  const [busy, setBusy] = useState(false);
  if (!kind) return null;
  return (
    <View style={styles.setting}>
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={{ fontSize: 15, fontWeight: '600', color: colors.ink }}>{t('appLock.settingLabel', { method: words })}</Text>
        <Text style={{ fontSize: 14, lineHeight: 20, color: colors.muted }}>{t('appLock.settingHint')}</Text>
      </View>
      <Switch
        accessibilityLabel={t('appLock.settingLabel', { method: words })}
        value={enabled}
        disabled={busy}
        onValueChange={async (on) => {
          setBusy(true);
          await setEnabled(on);
          setBusy(false);
        }}
        trackColor={{ true: colors.brand, false: colors.border }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  lockIcon: { width: 84, height: 84, borderRadius: 42, alignItems: 'center', justifyContent: 'center' },
  lockTitle: { fontSize: 28, lineHeight: 36, fontWeight: '800', color: '#FFFFFF', textAlign: 'center' },
  lockBody: { fontSize: 18, lineHeight: 26, color: '#FFFFFF', textAlign: 'center', paddingHorizontal: 24 },
  scrim: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.45)', justifyContent: 'center', padding: 24 },
  offer: { borderRadius: 24, padding: 24, alignItems: 'center', gap: 14 },
  offerTitle: { fontSize: 22, lineHeight: 30, fontWeight: '800', textAlign: 'center' },
  setting: { flexDirection: 'row', alignItems: 'center', gap: 16 },
});
