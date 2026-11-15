import { hasNativeModule } from '@/native';

type LocationModule = typeof import('expo-location');
export type Position = { latitude?: number; longitude?: number; accuracyM?: number };

function locationModule(): LocationModule | null {
  if (!hasNativeModule('ExpoLocation')) return null;
  try {
    return require('expo-location') as LocationModule;
  } catch {
    return null;
  }
}

/**
 * Where the phone is, for a check-in: asked at the moment of the tap (the
 * first time, the phone asks the caregiver's permission) and given up on
 * after a few seconds. A phone that cannot or may not say gives nothing, and
 * the check-in goes ahead without it. Never called in the background.
 */
export async function phonePosition(timeoutMs = 8000, load: () => LocationModule | null = locationModule): Promise<Position> {
  const Location = load();
  if (!Location) return {};
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return {};
    const fix = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
    if (!fix) return {};
    return { latitude: fix.coords.latitude, longitude: fix.coords.longitude, accuracyM: fix.coords.accuracy ?? undefined };
  } catch {
    return {};
  }
}
