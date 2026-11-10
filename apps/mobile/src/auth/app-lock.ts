import { Platform } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';

/**
 * Face / fingerprint unlock for the app.
 *
 * This is a lock on the session the phone already keeps (see token-store), not
 * a different way of signing in: the server never sees a face or fingerprint,
 * and nothing about the session changes. The phone's own check decides; when
 * face or fingerprint fails the phone offers its PIN or pattern, so nobody is
 * locked out of their own app.
 */

/** How long the app can sit in the background before it asks again. */
export const LOCK_AFTER_MS = 5 * 60_000;

/** The time, for the lock's timing only - tests move it without touching the global clock React uses. */
export const lockClock = { now: (): number => Date.now() };

/** What the phone offers - so the screen can say "Face ID" or "fingerprint". */
export type UnlockKind = 'faceId' | 'face' | 'fingerprint' | 'iris' | 'any';

/** The phone's face or fingerprint unlock, or null when it has none set up. */
export async function unlockKind(): Promise<UnlockKind | null> {
  try {
    if (!(await LocalAuthentication.hasHardwareAsync()) || !(await LocalAuthentication.isEnrolledAsync())) return null;
    const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
    const face = types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION);
    const finger = types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT);
    if (face && !finger) return Platform.OS === 'ios' ? 'faceId' : 'face';
    if (finger && !face) return 'fingerprint';
    if (types.includes(LocalAuthentication.AuthenticationType.IRIS) && !face && !finger) return 'iris';
    return 'any';
  } catch {
    return null;
  }
}

/**
 * - `ok`: it's them.
 * - `cancelled`: they closed the prompt, or it didn't recognise them - try again.
 * - `unavailable`: the phone can no longer check (face/fingerprint and PIN removed).
 */
export type UnlockResult = 'ok' | 'cancelled' | 'unavailable';

export async function confirmOwner(promptMessage: string, cancelLabel: string): Promise<UnlockResult> {
  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage,
      cancelLabel,
      // The phone's PIN or pattern when face or fingerprint fails: elderly users must never be stuck.
      disableDeviceFallback: false,
    });
    if (result.success) return 'ok';
    return result.error === 'not_enrolled' || result.error === 'passcode_not_set' || result.error === 'not_available' ? 'unavailable' : 'cancelled';
  } catch {
    return 'cancelled';
  }
}

/**
 * The person's choice, on this phone only. Kept per account: someone else
 * signing in on the same phone is asked for themselves. Absent = not asked yet.
 */
export type LockChoice = 'on' | 'off';

const keyFor = (userId: string) => `carelink.appLock.${userId.replace(/[^A-Za-z0-9._-]/g, '_')}`;

export async function readLockChoice(userId: string): Promise<LockChoice | null> {
  try {
    const value = await SecureStore.getItemAsync(keyFor(userId));
    return value === 'on' || value === 'off' ? value : null;
  } catch {
    return null;
  }
}

export async function saveLockChoice(userId: string, choice: LockChoice): Promise<void> {
  await SecureStore.setItemAsync(keyFor(userId), choice, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }).catch(() => undefined);
}
